const assert = require('node:assert/strict');
const { assertContinuousLedger } = require('./enterprise-round2-production-lot.cjs');
const mode = 'mass_percentage_v1';

async function massConversionProbe(ctx, signal) {
  const { request, dataOf, prisma, ensureReleasedMaterial } = ctx;
  const prefix = `${ctx.runId}-mass`;
  const evidence = { scope: 'Explicit mass v1 frozen BOM tuple; not packaging/density or complete R2-06', cases: [], rejected: [] };
  const call = async (url, method = 'GET', data, instance = 0) => dataOf(await request(url, { method, data, instance, signal }));
  try {
    const warehouses = await call('/warehouses'); const loc = warehouses.flatMap(w => w.locations || []).find(l => l.code === 'LOC-FG'); assert(loc);
    for (const s of [
      { name: 'g-kg', input: 'g', output: 'kg', stock: 20000, cost: 0.02, produced: 10, perUnit: 1000, consumed: 10000, amount: 200 },
      { name: 'kg-t', input: 'kg', output: 't', stock: 2000, cost: 10, produced: 1, perUnit: 1000, consumed: 1000, amount: 10000 },
      { name: 't-kg', input: 't', output: 'kg', stock: 2, cost: 10000, produced: 10, perUnit: 0.001, consumed: 0.01, amount: 100 },
    ]) {
      const item = { scenario: s }; evidence.cases.push(item);
      const raw = await ensureReleasedMaterial({ request, code: `${prefix}-${s.name}-raw`, name: `${prefix}-${s.name}-raw`, unit: s.input });
      const fg = await ensureReleasedMaterial({ request, code: `${prefix}-${s.name}-fg`, name: `${prefix}-${s.name}-fg`, unit: s.output, category: 'finished_good' });
      const body = { materialId: fg.id, productName: fg.nameZh, outputUnit: s.output, status: 'active', version: `${prefix}-v1`, shelfLifeDays: 365,
        items: [{ materialId: raw.id, unit: s.input, dosageMode: mode, percentage: 100, quantityPerUnit: 1, allowedVarianceRate: 0 }] };
      // Never trust a client-supplied canonical quantity. Persist the computed v1 tuple.
      const bom = await call('/production/boms', 'POST', body); assert.equal(bom.items[0].quantityPerUnit, s.perUnit);
      const definition = () => prisma.productionBom.findUniqueOrThrow({ where: { id: bom.id }, include: { items: true } });
      item.frozenBefore = await definition();
      const batchNo = `${prefix}-${s.name}`;
      const stock = await call('/warehouses/stock-balances', 'POST', { materialId: raw.id, productName: raw.nameZh, batchNo, locationId: loc.id, quantity: s.stock, unit: s.input, unitCost: s.cost, sourceRef: batchNo, reason: 'isolated mass conversion' });
      const rawBatch = await prisma.productBatch.findUniqueOrThrow({ where: { batchNo } });
      const wo = await call('/production/work-orders', 'POST', { bomId: bom.id, productName: fg.nameZh, targetQuantity: s.produced, producedQuantity: s.produced });
      const snapshot = async () => ({
        rawBatch: await prisma.productBatch.findUniqueOrThrow({ where: { id: rawBatch.id } }),
        rawCosts: await prisma.inventoryCostLedger.findMany({ where: { batchId: rawBatch.id }, orderBy: { id: 'asc' } }),
        outputBalances: await prisma.stockBalance.findMany({ where: { materialId: fg.id }, orderBy: { id: 'asc' } }),
        stock: await prisma.stockBalance.findUniqueOrThrow({ where: { id: stock.id } }),
        wo: await prisma.productionWorkOrder.findUniqueOrThrow({ where: { id: wo.id }, include: { productBatch: true, genealogyEdges: true } }),
        costs: await prisma.inventoryCostLedger.findMany({ where: { workOrderId: wo.id }, orderBy: { id: 'asc' } }),
        moves: await prisma.stockMovement.findMany({ where: { OR: [{ batchNo }, { materialId: fg.id }] }, orderBy: { id: 'asc' } }),
        audits: await prisma.auditLog.findMany({ where: { action: 'UPDATE_PRODUCTION_WORK_ORDER_STATUS', resourceId: wo.id }, orderBy: { id: 'asc' } }),
      });
      const revision = await call('/production/boms', 'POST', { ...body, version: `${prefix}-v2`, items: [{ ...body.items[0], percentage: 50 }] });
      assert.equal(revision.items[0].quantityPerUnit, s.perUnit / 2);
      item.previews = await Promise.all([0,1].map(instance => call(`/production/work-orders/${wo.id}/preview-consumption`, 'GET', undefined, instance)));
      for (const rows of item.previews) assert.equal(rows[0].requiredQty, s.consumed);
      item.beforeWrongRecipe = await snapshot();
      item.wrongRecipe = await request(`/production/work-orders/${wo.id}/status`, { method: 'PATCH', instance: 1, signal, data: { status: 'completed', consumptionRecords: [{ stockBalanceId: stock.id, quantity: s.consumed / 2 }] } });
      item.afterWrongRecipe = await snapshot(); assert.equal(item.wrongRecipe.status, 409); assert.deepEqual(item.afterWrongRecipe, item.beforeWrongRecipe);
      const complete = instance => call(`/production/work-orders/${wo.id}/status`, 'PATCH', { status: 'completed', consumptionRecords: [{ stockBalanceId: stock.id, quantity: s.consumed }] }, instance);
      await complete(0); item.after = await snapshot();
      assert.equal(item.after.stock.quantity, s.stock - s.consumed);
      assert.equal(item.after.rawBatch.stockQuantity, item.after.stock.quantity);
      assertContinuousLedger(item.after.rawCosts, item.after.stock.quantity, s.stock * s.cost - s.amount);
      assert.equal(item.after.outputBalances.reduce((sum,b)=>sum+b.quantity,0), s.produced);
      assert.equal(item.after.wo.productBatch.stockQuantity, s.produced); assert.equal(item.after.wo.productBatch.unit, s.output);
      assert.equal(item.after.wo.genealogyEdges.length, 1); assert.equal(item.after.wo.genealogyEdges[0].quantityConsumed, s.consumed); assert.equal(item.after.wo.genealogyEdges[0].inputUnit, s.input);
      assert.deepEqual(item.after.costs.map(c => c.costAmountDelta).sort((a,b)=>a-b), [-s.amount, s.amount]); assert.equal(item.after.audits.length, 1);
      assertContinuousLedger(item.after.costs.filter(c=>c.batchId===item.after.wo.batchId), s.produced, s.amount);
      await complete(1); item.replay = await snapshot(); assert.deepEqual(item.replay, item.after);
      item.frozenAfter = await definition(); assert.deepEqual(item.frozenAfter, item.frozenBefore);
      item.readbacks = await Promise.all([0,1].map(async instance => ({
        rawCost: await call(`/production/batches/${rawBatch.id}/cost-ledger?pageSize=100`, 'GET', undefined, instance),
        bom: (await call('/production/boms', 'GET', undefined, instance)).find(b=>b.id===bom.id),
        wo: (await call('/production/work-orders', 'GET', undefined, instance)).find(w=>w.id===wo.id),
        stock: (await call(`/warehouses/stock-balances?batchNo=${batchNo}&pageSize=100`, 'GET', undefined, instance)).find(b=>b.id===stock.id),
      })));
      for (const r of item.readbacks) { assert.equal(r.rawCost.summary.currentCostAmount, s.stock * s.cost - s.amount); assert.equal(r.bom.items[0].quantityPerUnit, s.perUnit); assert.equal(r.bom.items[0].dosageMode, mode); assert.equal(r.wo.bomId, bom.id); assert.equal(r.wo.status, 'completed'); assert.equal(r.stock.quantity, item.after.stock.quantity); }
      if (s.name === 'kg-t') evidence.browserFixture.ton = { raw, fg, version: `${prefix}-browser-ton` };
      if (s.name === 'g-kg') {
        evidence.browserFixture = { raw, fg, version: `${prefix}-browser` };
        for (const patch of [{ dosageMode: 'mass_percentage_v2' }, { unit: 'L' }, { percentage: 0.00000001 }]) {
          const before = await prisma.productionBom.count({ where: { materialId: fg.id } });
          const response = await request('/production/boms', { method: 'POST', signal, data: { ...body, items: [{ ...body.items[0], ...patch }] } });
          const after = await prisma.productionBom.count({ where: { materialId: fg.id } }); evidence.rejected.push({ patch, before, after, response });
          assert.equal(response.status, patch.dosageMode ? 400 : 409); assert.equal(after, before);
          if (!patch.dosageMode) assert.match(response.json.message, /^BOM_UNIT_/);
        }
      }
    }
    return evidence;
  } catch (error) { error.evidence = evidence; throw error; }
}


async function massConversionBrowser(ctx, page, fixture, dir, signal) {
  const path = require('node:path');
  const { expect } = require('playwright/test');
  const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');
  const evidence = { scope: 'Real mass-v1 form, precision block, mobile calculation readback and saved frozen tuple' };
  const persisted = () => ctx.prisma.productionBom.findMany({ where: { materialId: fixture.fg.id, version: fixture.version }, include: { items: true } });
  await page.getByTestId('production-desk-bom').click();
  const select = async (id, material) => { await page.getByTestId(id).fill(material.code); await page.getByRole('option').filter({ hasText: material.code }).first().click(); };
  await select('production-bom-product-name', fixture.fg);
  await page.getByTestId('production-bom-version').fill(fixture.version);
  await page.getByTestId('production-bom-status').selectOption('active');
  await page.getByTestId('production-bom-standard-batch-size').fill('10');
  await page.getByTestId('production-bom-formulation-mode').selectOption('percentage');
  let writes = 0;
  const listen = request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/production/boms') writes++; };
  page.on('request', listen);
  try {
    await page.getByTestId('production-bom-open-paste-panel').click();
    await page.getByTestId('production-bom-paste-textarea').fill(`${fixture.raw.nameZh}\t${fixture.raw.code}\t主树脂\tmass_percentage_v2\t100\t1\tg`);
    await page.getByTestId('production-bom-apply-paste').click();
    const row = page.getByTestId('production-bom-line-row-0');
    await expect(page.getByTestId('production-bom-row-0-dosage-mode')).toHaveValue('mass_percentage_v2');
    await expect(row.getByRole('alert')).toContainText('BOM_UNIT_MASS_VERSION_UNSUPPORTED');
    await page.getByTestId('production-bom-save').click();
    evidence.unknownPaste = { draft: await row.innerText(), persisted: await persisted(), writes };
    assert.equal(evidence.unknownPaste.persisted.length, 0); assert.equal(writes, 0);
    await expect(page.getByTestId('production-bom-row-0-dosage-mode')).toHaveValue('mass_percentage_v2');
    await select('production-bom-row-0-material-code', fixture.raw);
    await page.getByTestId('production-bom-row-0-dosage-mode').selectOption(mode);
    await expect(page.getByText(/BOM_UNIT_MASS_VERSION_UNSUPPORTED/)).toHaveCount(0);
    await page.getByTestId('production-bom-row-0-percentage').fill('0.00000001');
    await expect(row.getByRole('alert')).toContainText('BOM_UNIT_PRECISION_UNSUPPORTED');
    await page.getByTestId('production-bom-save').click();
    evidence.rejected = await persisted(); assert.equal(evidence.rejected.length, 0); assert.equal(writes, 0);
    await page.getByTestId('production-bom-row-0-percentage').fill('100');
    await expect(row).toContainText('1000 g/kg'); await expect(row).toContainText('10000 g');
    await expect(page.getByText(/BOM_UNIT_PRECISION_UNSUPPORTED/)).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = page.getByTestId('production-bom-mobile-row-0'); await mobile.scrollIntoViewIfNeeded();
    await expect(mobile).toContainText('1000 g/kg'); await expect(mobile).toContainText('10000 g');
    evidence.mobileScreenshot = path.join(dir, 'mass-v1-mobile.png'); await page.screenshot({ path: evidence.mobileScreenshot });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/production/boms');
    await page.getByTestId('production-bom-save').click(); const result = await response;
    evidence.response = { status: result.status(), json: await result.json() }; assert.equal(result.status(), 201);
    await expect(page.getByText('BOM 已创建，回读核对通过', { exact: true })).toBeVisible(); assert.equal(writes, 1);
    const bom = evidence.response.json.data; evidence.persisted = await persisted(); assert.equal(evidence.persisted.length, 1);
    const item = evidence.persisted[0].items[0]; assert.equal(item.quantityPerUnit, 1000); assert.equal(item.dosageMode, mode); assert.equal(item.unit, 'g'); assert.equal(item.percentage, 100);
    evidence.readbacks = await Promise.all([0,1].map(async instance => ctx.dataOf(await ctx.request('/production/boms', { instance, signal })).find(b => b.id === bom.id)));
    for (const b of evidence.readbacks) { assert.equal(b.items[0].quantityPerUnit, 1000); assert.equal(b.outputUnit, 'kg'); assert.equal(b.items[0].dosageMode, mode); }
    await page.reload(); await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.getByTestId('production-desk-bom').click();
    const saved = page.locator('tr').filter({ hasText: bom.bomNo }); await saved.scrollIntoViewIfNeeded(); await expect(saved).toContainText(fixture.version);
    await saved.getByRole('button').click();
    const panel = page.getByTestId('production-bom-readback');
    await expect(panel).toContainText('质量百分比换算 v1'); await expect(panel).toContainText('100%');
    await expect(panel.getByText('1000 g', { exact: true })).toBeVisible();
    await panel.getByText('1000 g', { exact: true }).scrollIntoViewIfNeeded();
    evidence.reloadReadbackText = await panel.innerText();
    await expect(page.getByText(/BOM_UNIT_PRECISION_UNSUPPORTED/)).toHaveCount(0);
    evidence.font = await verifyRenderedCjk(page, 'body');
    evidence.savedScreenshot = path.join(dir, 'mass-v1-saved.png'); await page.screenshot({ path: evidence.savedScreenshot });
    // A non-kg output catches payload builders that accidentally default to kg.
    const ton = fixture.ton; assert(ton);
    await select('production-bom-product-name', ton.fg);
    await page.getByTestId('production-bom-version').fill(ton.version);
    await page.getByTestId('production-bom-status').selectOption('active');
    await page.getByTestId('production-bom-standard-batch-size').fill('1');
    await page.getByTestId('production-bom-formulation-mode').selectOption('percentage');
    await select('production-bom-row-0-material-code', ton.raw);
    await page.getByTestId('production-bom-row-0-dosage-mode').selectOption(mode);
    await page.getByTestId('production-bom-row-0-percentage').fill('100');
    await expect(page.getByTestId('production-bom-line-row-0')).toContainText('1000 kg/t');
    const tonResponse = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/production/boms');
    await page.getByTestId('production-bom-save').click(); const tonResult = await tonResponse;
    const tonBody = await tonResult.json(); assert.equal(tonResult.status(), 201); assert.equal(writes, 2);
    await expect(page.getByText('BOM 已创建，回读核对通过', { exact: true })).toBeVisible();
    const tonBom = await ctx.prisma.productionBom.findUniqueOrThrow({ where: { id: tonBody.data.id }, include: { items: true } });
    assert.equal(tonBom.outputUnit, 't'); assert.equal(tonBom.items[0].quantityPerUnit, 1000); assert.equal(tonBom.items[0].unit, 'kg');
    const tonReadbacks = await Promise.all([0,1].map(async instance => ctx.dataOf(await ctx.request('/production/boms', { instance, signal })).find(b => b.id === tonBom.id)));
    for (const b of tonReadbacks) { assert.equal(b.outputUnit, 't'); assert.equal(b.items[0].quantityPerUnit, 1000); assert.equal(b.items[0].dosageMode, mode); }
    await page.reload(); await page.locator('#loading').waitFor({ state: 'hidden' }); await page.getByTestId('production-desk-bom').click();
    const tonSaved = page.locator('tr').filter({ hasText: tonBom.bomNo }); await tonSaved.scrollIntoViewIfNeeded(); await tonSaved.getByRole('button').click();
    await expect(panel).toContainText('质量百分比换算 v1'); await expect(panel.getByText('1000 kg', { exact: true })).toBeVisible();
    await panel.getByText('1000 kg', { exact: true }).scrollIntoViewIfNeeded();
    evidence.ton = { persisted: tonBom, readbacks: tonReadbacks, reloadText: await panel.innerText(), screenshot: path.join(dir, 'mass-v1-ton-saved.png') };
    await page.screenshot({ path: evidence.ton.screenshot });
    return evidence;
  } finally { page.off('request', listen); }
}
module.exports = { massConversionProbe, massConversionBrowser };
