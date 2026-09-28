const assert = require('node:assert/strict');

function assertRejectedUnitCase(item) {
  assert.equal(item.response.status, 409, `${item.name}: unsafe recipe was accepted`);
  assert(item.response.json?.message?.startsWith(item.code), 'Wrong dimensional rejection');
  assert.deepEqual(item.after, item.before, 'Rejected recipe changed BOM or creation audit');
  assert.equal(item.readbacks.length, 2);
  for (const rows of item.readbacks) assert.deepEqual(rows, item.before.boms);
}

async function unitSafetyProbe(ctx, signal) {
  const { request, dataOf, prisma, ensureReleasedMaterial, actors } = ctx;
  const prefix = `${ctx.runId}-units`;
  const evidence = { scope: 'Dimensional rejection and explicit fixed-dosage cost conservation; NOT mass/packaging/density conversion acceptance', rejected: [], controls: [] };
  const call = async (url, method = 'GET', data, instance = 0) => dataOf(await request(url, { method, data, instance, signal }));
  try {
    const raw = {}, output = {};
    for (const [key, unit] of [['kg','kg'],['g','g'],['l','L'],['drum','桶']]) {
      raw[key] = await ensureReleasedMaterial({ request, code: `${prefix}-raw-${key}`, name: `${prefix}-raw-${key}`, unit });
      output[key] = await ensureReleasedMaterial({ request, code: `${prefix}-fg-${key}`, name: `${prefix}-fg-${key}`, unit, category: 'finished_good' });
    }
    const body = (fg, material, dosageMode, quantityPerUnit = 1) => ({ materialId: fg.id, productName: fg.nameZh, version: prefix, outputUnit: fg.baseUnit, shelfLifeDays: 365, status: 'active',
      items: [{ materialId: material.id, unit: material.baseUnit, dosageMode, quantityPerUnit, ...(dosageMode === 'percentage' ? { percentage: 100 } : {}), allowedVarianceRate: 0 }] });
    for (const scenario of [
      { name: 'silent-output-unit', fg: output.kg, material: raw.kg, dosage: 'fixed', patch: { outputUnit: 'g' }, code: 'BOM_UNIT_OUTPUT_MISMATCH' },
      { name: 'percentage-g-kg', fg: output.kg, material: raw.g },
      { name: 'percentage-L-kg-with-density', fg: output.kg, material: raw.l, patch: { density: 1.2 } },
      { name: 'percentage-kg-drum', fg: output.drum, material: raw.kg },
      { name: 'percentage-drum-drum', fg: output.drum, material: raw.drum },
      { name: 'percentage-L-L', fg: output.l, material: raw.l },
    ]) {
      const item = { name: scenario.name, code: scenario.code || 'BOM_UNIT_PERCENTAGE_BASIS_REQUIRED' }; evidence.rejected.push(item);
      const snapshot = async () => ({
        boms: await prisma.productionBom.findMany({ where: { materialId: scenario.fg.id }, orderBy: { id: 'asc' } }),
        audits: await prisma.auditLog.findMany({ where: { action: 'CREATE_PRODUCTION_BOM', userId: actors.admin.id }, orderBy: { id: 'asc' } }),
      });
      item.before = await snapshot();
      item.response = await request('/production/boms', { method: 'POST', signal, instance: 1, data: { ...body(scenario.fg, scenario.material, scenario.dosage || 'percentage'), ...scenario.patch } });
      item.after = await snapshot();
      item.readbacks = await Promise.all([0,1].map(async instance => (await call('/production/boms', 'GET', undefined, instance)).filter(b => b.materialId === scenario.fg.id)));
      assertRejectedUnitCase(item);
    }
    const warehouses = await call('/warehouses'); const location = warehouses.flatMap(w => w.locations || []).find(l => l.code === 'LOC-FG'); assert(location);
    for (const scenario of [{ name: 'same-mass-percentage', fg: output.kg, mode: 'percentage', quantityPerUnit: 1, quantity: 10, consumed: 10 },
      { name: 'explicit-20kg-per-drum', fg: output.drum, mode: 'fixed', quantityPerUnit: 20, quantity: 2, consumed: 40 }]) {
      const item = { name: scenario.name }; evidence.controls.push(item);
      const batchNo = `${prefix}-${scenario.name}`;
      const stock = await call('/warehouses/stock-balances', 'POST', { materialId: raw.kg.id, productName: raw.kg.nameZh, batchNo, locationId: location.id, quantity: 100, unit: 'kg', unitCost: 10, sourceRef: batchNo, reason: 'Isolated explicit dosage control' });
      const bom = await call('/production/boms', 'POST', body(scenario.fg, raw.kg, scenario.mode, scenario.quantityPerUnit));
      const wo = await call('/production/work-orders', 'POST', { bomId: bom.id, productName: scenario.fg.nameZh, targetQuantity: scenario.quantity, producedQuantity: scenario.quantity });
      item.preview = await call(`/production/work-orders/${wo.id}/preview-consumption`, 'GET', undefined, 1);
      assert.equal(item.preview[0].requiredQty, scenario.consumed);
      const snapshot = async () => ({
        stock: await prisma.stockBalance.findUniqueOrThrow({ where: { id: stock.id } }),
        wo: await prisma.productionWorkOrder.findUniqueOrThrow({ where: { id: wo.id }, include: { productBatch: true, genealogyEdges: true } }),
        costs: await prisma.inventoryCostLedger.findMany({ where: { workOrderId: wo.id }, orderBy: { id: 'asc' } }),
        movements: await prisma.stockMovement.findMany({ where: { OR: [{ batchNo }, { materialId: scenario.fg.id }] }, orderBy: { id: 'asc' } }),
        audits: await prisma.auditLog.findMany({ where: { action: 'UPDATE_PRODUCTION_WORK_ORDER_STATUS', resourceId: wo.id }, orderBy: { id: 'asc' } }),
      });
      const complete = instance => call(`/production/work-orders/${wo.id}/status`, 'PATCH', { status: 'completed', consumptionRecords: [{ stockBalanceId: stock.id, quantity: scenario.consumed }] }, instance);
      await complete(0); item.after = await snapshot();
      assert.equal(item.after.stock.quantity, 100 - scenario.consumed); assert.equal(item.after.stock.unit, 'kg');
      assert.equal(item.after.wo.productBatch.stockQuantity, scenario.quantity); assert.equal(item.after.wo.productBatch.unit, scenario.fg.baseUnit);
      assert.equal(item.after.wo.genealogyEdges.length, 1); assert.equal(item.after.wo.genealogyEdges[0].quantityConsumed, scenario.consumed); assert.equal(item.after.wo.genealogyEdges[0].inputUnit, 'kg');
      assert.deepEqual(item.after.costs.map(c => c.costAmountDelta).sort((a,b) => a-b), [-scenario.consumed * 10, scenario.consumed * 10]);
      assert.equal(item.after.audits.length, 1);
      await complete(1); item.replayed = await snapshot(); assert.deepEqual(item.replayed, item.after);
      item.readbacks = await Promise.all([0,1].map(async instance => ({
        stock: (await call(`/warehouses/stock-balances?batchNo=${encodeURIComponent(batchNo)}&pageSize=100`, 'GET', undefined, instance)).find(s => s.id === stock.id),
        wo: (await call('/production/work-orders', 'GET', undefined, instance)).find(w => w.id === wo.id),
      })));
      for (const r of item.readbacks) {
        assert.equal(r.stock.quantity, item.after.stock.quantity); assert.equal(r.wo.status, 'completed');
        assert.equal(r.wo.productBatch.unit, scenario.fg.baseUnit); assert.equal(r.wo.productBatch.stockQuantity, scenario.quantity);
      }
      Object.assign(item, { bom, workOrderId: wo.id });
    }
    evidence.browserFixture = { raw: raw.kg, fg: output.kg, version: `${prefix}-browser` };
    return evidence;
  } catch (error) { error.evidence = evidence; throw error; }
}


async function unitSafetyBrowser(ctx, page, fixture, dir, signal) {
  const path = require('node:path');
  const { expect } = require('playwright/test');
  const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');
  const evidence = { scope: 'Real form rejection, correction and persisted readback; not conversion authoring' };
  const rows = () => ctx.prisma.productionBom.findMany({ where: { materialId: fixture.fg.id, version: fixture.version }, include: { items: true } });
  await page.getByTestId('production-desk-bom').click();
  const select = async (id, material) => {
    await page.getByTestId(id).fill(material.code);
    await page.getByRole('option').filter({ hasText: material.code }).first().click();
  };
  await select('production-bom-product-name', fixture.fg);
  await page.getByTestId('production-bom-version').fill(fixture.version);
  await page.getByTestId('production-bom-type').selectOption('standard');
  await page.getByTestId('production-bom-formulation-mode').selectOption('fixed');
  await page.getByTestId('production-bom-status').selectOption('active');
  await page.getByTestId('production-bom-standard-batch-size').fill('10');
  await select('production-bom-row-0-material-code', fixture.raw);
  await page.getByTestId('production-bom-row-0-dosage-mode').selectOption('fixed');
  await page.getByTestId('production-bom-row-0-quantity-per-unit').fill('0.001');
  await page.getByTestId('production-bom-output-unit').fill('g');
  const send = async () => {
    const result = page.waitForResponse(r => new URL(r.url()).pathname === '/api/production/boms' && r.request().method() === 'POST');
    await page.getByTestId('production-bom-save').click(); return result;
  };
  evidence.before = await rows();
  const rejected = await send(); evidence.rejected = { status: rejected.status(), json: await rejected.json() };
  assert.equal(evidence.rejected.status, 409); assert.match(evidence.rejected.json.message, /^BOM_UNIT_OUTPUT_MISMATCH/);
  await expect(page.getByText(evidence.rejected.json.message, { exact: true })).toBeVisible();
  evidence.afterRejected = await rows(); assert.deepEqual(evidence.afterRejected, evidence.before);
  await expect(page.getByTestId('production-bom-output-unit')).toHaveValue('g');
  await expect(page.getByTestId('production-bom-row-0-quantity-per-unit')).toHaveValue('0.001');
  evidence.rejectedScreenshot = path.join(dir, 'unit-rejected.png'); await page.screenshot({ path: evidence.rejectedScreenshot });
  await page.getByTestId('production-bom-output-unit').fill('kg');
  await page.getByTestId('production-bom-row-0-quantity-per-unit').fill('1');
  const saved = await send(); assert.equal(saved.status(), 201); const bom = (await saved.json()).data;
  await expect(page.getByText('BOM 已创建，回读核对通过', { exact: true })).toBeVisible();
  await expect(page.getByTestId('production-bom-save')).toBeEnabled();
  const row = page.locator('tr').filter({ hasText: bom.bomNo }); await row.scrollIntoViewIfNeeded(); await expect(row).toContainText(fixture.version);
  evidence.persisted = await rows(); assert.equal(evidence.persisted.length, 1); assert.equal(evidence.persisted[0].outputUnit, 'kg');
  assert.equal(evidence.persisted[0].items.length, 1); assert.equal(evidence.persisted[0].items[0].quantityPerUnit, 1);
  evidence.readbacks = await Promise.all([0,1].map(async instance => ctx.dataOf(await ctx.request('/production/boms', { signal, instance })).find(b => b.id === bom.id)));
  for (const value of evidence.readbacks) { assert.equal(value.outputUnit, 'kg'); assert.equal(value.items[0].quantityPerUnit, 1); }
  await expect(page.getByText(evidence.rejected.json.message, { exact: true })).toBeHidden();
  evidence.font = await verifyRenderedCjk(page, 'body');
  evidence.savedScreenshot = path.join(dir, 'unit-corrected.png'); await page.screenshot({ path: evidence.savedScreenshot });
  return evidence;
}

module.exports = { unitSafetyProbe, unitSafetyBrowser, assertRejectedUnitCase };
