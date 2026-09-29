const assert = require('node:assert/strict');
const { synchronizedBurst } = require('./enterprise-round2-runner.cjs');

async function bomFreezeProbe(ctx, signal) {
  const { request, dataOf, actors, prisma, runId, ensureReleasedMaterial } = ctx;
  const evidence = { scope: 'API revision binding and governance freeze; existing admin/warehouse/manager roles, not complete workforce RBAC', cases: [] };
  const call = async (url, method = 'GET', data, actor = actors.admin, instance = 0) => dataOf(await request(url, { method, data, actor, instance, signal }));
  const change = (url, data, actor = actors.admin, instance = 1) => request(url, { method: 'POST', data, actor, instance, signal });
  const readBom = id => prisma.productionBom.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } }, qualityCharacteristics: { orderBy: { id: 'asc' } } } });
  try {
    const raw = await ensureReleasedMaterial({ request, code: `${runId}-freeze-raw`, name: `${runId}-canonical-resin`, category: 'raw_material' });
    const fg = await ensureReleasedMaterial({ request, code: `${runId}-freeze-fg`, name: `${runId}-freeze-finished`, category: 'finished_good' });
    const warehouses = await call('/warehouses'); const loc = warehouses.flatMap(w => w.locations || []).find(l => l.code === 'LOC-FG'); assert(loc);
    const stock = await call('/warehouses/stock-balances', 'POST', { locationId: loc.id, materialId: raw.id, productName: raw.nameZh,
      batchNo: `${runId}-freeze-raw-batch`, quantity: 100, unit: 'kg', unitCost: 10, sourceRef: `${runId}-freeze-stock`, reason: 'isolated BOM freeze test' });
    const makeBom = (label, linked = true, quantity = 1) => call('/production/boms', 'POST', {
      materialId: fg.id, productName: fg.nameZh, version: label, status: linked ? 'active' : 'draft', outputUnit: 'kg', shelfLifeDays: 365,
      items: [{ ...(linked ? { materialId: raw.id } : { materialName: `${runId}-legacy-${label}` }), quantityPerUnit: quantity, unit: 'kg', allowedVarianceRate: 0 }],
      qualityCharacteristics: [{ code: 'VISC', name: '粘度', valueType: 'numeric', unit: 'mPa.s', lowerLimit: quantity, upperLimit: quantity + 1 }],
    });
    const woData = bom => ({ bomId: bom.id, productName: fg.nameZh, targetQuantity: 10, producedQuantity: 10 });
    const makeWo = bom => call('/production/work-orders', 'POST', woData(bom), actors.stock0);
    const status = (wo, value) => call(`/production/work-orders/${wo.id}/status`, 'PATCH', { status: value }, actors.stock0);
    const preview = (wo, instance = 0) => call(`/production/work-orders/${wo.id}/preview-consumption`, 'GET', undefined, actors.stock0, instance);
    const mapping = async bom => {
      const candidates = await call('/materials/governance/backfill-candidates?limit=50');
      const c = candidates.items.find(row => row.source.materialName === bom.items[0].materialName); assert(c);
      return { source: c.source, materialId: raw.id, expectedCount: c.occurrenceCount, expectedFingerprint: c.expectedFingerprint };
    };
    const apply = mappings => change('/materials/governance/backfill', { mappings });
    const v1 = await makeBom('freeze-v1'); const old = await makeWo(v1); await status(old, 'in_progress');
    const oldDefinition = await readBom(v1.id); const oldPreview = await preview(old);
    const v2 = await makeBom('freeze-v2', true, 2); const newer = await makeWo(v2);
    assert.equal((await preview(old, 1))[0].requiredQty, 10); assert.equal((await preview(newer, 1))[0].requiredQty, 20);
    assert.deepEqual(await preview(old), oldPreview); assert.deepEqual(await readBom(v1.id), oldDefinition);
    for (const wo of [old, newer]) await status(wo, 'qc_pending');
    const inspect = (wo, bom) => call(`/production/work-orders/${wo.id}/checks`, 'POST', { sampleNo: `${runId}-${wo.id}`,
      measurements: [{ characteristicId: bom.qualityCharacteristics[0].id, measuredNumeric: '1.5' }] }, actors.stock0);
    const oldQc = await inspect(old, v1); const newQc = await inspect(newer, v2);
    assert.equal(oldQc.result, 'pass'); assert.equal(newQc.result, 'fail');
    await call(`/production/work-orders/${old.id}/checks/${oldQc.id}/review`, 'POST', { decision: 'release', reviewNote: 'Original v1 specification, independent reviewer' }, actors.buyer1);
    const wrongRecipe = await request(`/production/work-orders/${old.id}/status`, { method: 'PATCH', actor: actors.stock0, signal,
      data: { status: 'completed', consumptionRecords: [{ stockBalanceId: stock.id, quantity: 20 }] } });
    assert.equal(wrongRecipe.status, 409, JSON.stringify(wrongRecipe));
    await call(`/production/work-orders/${old.id}/status`, 'PATCH', { status: 'completed', consumptionRecords: [{ stockBalanceId: stock.id, quantity: 10 }] }, actors.stock0);
    const persisted = await prisma.productionWorkOrder.findUnique({ where: { id: old.id }, include: { productBatch: true, qualityChecks: { include: { measurements: true } }, genealogyEdges: true } });
    const costs = await prisma.inventoryCostLedger.findMany({ where: { workOrderId: old.id }, orderBy: { id: 'asc' } });
    assert.equal(persisted.bomId, v1.id); assert.equal(persisted.status, 'completed'); assert.equal(persisted.productBatch.stockQuantity, 10);
    assert.equal((await prisma.stockBalance.findUnique({ where: { id: stock.id } })).quantity, 90);
    assert.equal(persisted.genealogyEdges.length, 1); assert.equal(persisted.genealogyEdges[0].quantityConsumed, 10);
    assert.equal(costs.length, 2); assert.deepEqual(costs.map(row => row.costAmountDelta).sort((a,b) => a-b), [-100, 100]);
    assert.equal(Number(persisted.qualityChecks[0].measurements[0].lowerLimit), 1);
    assert.equal(Number(persisted.qualityChecks[0].measurements[0].upperLimit), 2);
    assert.deepEqual(await readBom(v1.id), oldDefinition);
    const readbacks = await Promise.all([0,1].map(instance => call('/production/work-orders', 'GET', undefined, actors.stock0, instance)));
    for (const rows of readbacks) { assert.equal(rows.find(r => r.id === old.id).bom.version, v1.version); assert.equal(rows.find(r => r.id === newer.id).bom.version, v2.version); }
    evidence.history = { old, newer, v1, v2, oldDefinition, persisted, costs, oldQc, newQc, wrongRecipe, readbacks };

    const legacy = await makeBom('legacy-rollback', false); const legacyMapping = await mapping(legacy);
    const run = dataOf(await apply([legacyMapping])).run; const legacyWo = await makeWo(legacy); await status(legacyWo, 'in_progress');
    const before = { bom: await readBom(legacy.id), preview: await preview(legacyWo), run: await prisma.materialGovernanceRun.findUnique({ where: { id: run.id } }) };
    const rejected = await change(`/materials/governance/runs/${run.id}/rollback`, {}); assert.equal(rejected.status, 409, JSON.stringify(rejected)); assert.match(rejected.json.message, /冻结/);
    const after = { bom: await readBom(legacy.id), preview: await preview(legacyWo, 1), run: await prisma.materialGovernanceRun.findUnique({ where: { id: run.id } }) };
    assert.deepEqual(after, before); assert.equal(await prisma.auditLog.count({ where: { action: 'ROLLBACK_MATERIAL_BOM_BACKFILL', resourceId: run.id } }), 0);
    evidence.cases.push({ name: 'in-progress rollback rejected without side effects', before, after, rejected });

    const used = await makeBom('cancelled-used', false); const unused = await makeBom('unused-control', false);
    const cancelled = await makeWo(used); await status(cancelled, 'cancelled');
    const mappings = await Promise.all([used, unused].map(mapping));
    const originalRows = await Promise.all([used, unused].map(b => readBom(b.id)));
    const mixed = await apply(mappings); assert.equal(mixed.status, 409, JSON.stringify(mixed));
    assert.deepEqual(await Promise.all([used, unused].map(b => readBom(b.id))), originalRows);
    const allowed = dataOf(await apply([mappings[1]])).run; dataOf(await change(`/materials/governance/runs/${allowed.id}/rollback`, {}));
    assert.deepEqual(await readBom(unused.id), originalRows[1]);
    evidence.cases.push({ name: 'cancelled history protected; mixed batch atomic; unused revision remains governable', mixed, originalRows, allowed });
    for (const operation of ['apply', 'rollback']) for (let attempt = 0; attempt < 2; attempt++) {
      const bom = await makeBom(`race-${operation}-${attempt}`, false); const m = await mapping(bom);
      const prior = operation === 'rollback' ? dataOf(await apply([m])).run : null;
      const race = await synchronizedBurst([actors.admin, actors.stock0], async actor => {
        const creation = actor.id === actors.stock0.id;
        const response = creation ? await change('/production/work-orders', woData(bom), actor, 0)
          : operation === 'apply' ? await apply([m]) : await change(`/materials/governance/runs/${prior.id}/rollback`, {});
        return { operation: creation ? 'create' : operation, ...response };
      }, signal);
      const creation = race.find(r => r.operation === 'create'); const mutation = race.find(r => r.operation !== 'create');
      assert.equal(creation.status, 201, JSON.stringify(race)); assert([200,201,409].includes(mutation.status), JSON.stringify(race));
      const finalBom = await readBom(bom.id); const linked = finalBom.items[0].materialId === raw.id;
      assert.equal(linked, operation === 'apply' ? mutation.status === 201 : mutation.status === 409);
      const counter = linked ? await change(`/materials/governance/runs/${operation === 'apply' ? mutation.json.data.run.id : prior.id}/rollback`, {}) : await apply([m]);
      assert.equal(counter.status, 409); assert.deepEqual(await readBom(bom.id), finalBom);
      evidence.cases.push({ name: `first work order versus ${operation}`, race, finalBom, counter });
    }
    evidence.history.massV1 = await require('./enterprise-round2-mass-conversion.cjs').massConversionProbe(ctx, signal);
    evidence.history.unitSafety = await require('./enterprise-round2-unit-safety.cjs').unitSafetyProbe(ctx, signal);
    return evidence;
  } catch (error) { error.evidence ||= evidence; throw error; }
}

async function bomHistoryBrowser(ctx, history, signal) {
  assert(history, 'BOM API evidence is required');
  const fs = require('node:fs'), path = require('node:path');
  const { expect } = require('playwright/test');
  const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
  const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');
  const browser = (await launchBrowserWithGuard({ launchTimeoutMs: 15000, totalTimeoutMs: 30000, maxAttemptsPerStrategy: 1 })).browser;
  const abort = () => { void browser.close().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  let unitFormActive = false;
  const expectedUnitResponses = [];
  const evidence = { scope: 'Warehouse browser readback of bound revisions; not browser formulation authoring or full workforce validation', readbacks: [], errors: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000);
    const actor = ctx.actors.stock0;
    await page.addInitScript(({ token, user }) => {
      for (const key of ['token','auth_token','erp_auth_token']) localStorage.setItem(key, token);
      for (const key of ['user','currentUser','erp_current_user']) localStorage.setItem(key, JSON.stringify(user));
      localStorage.setItem('ailao.language','zh'); localStorage.setItem('language','zh-CN');
    }, { token: actor.token, user: { id: String(actor.id), name: actor.job, role: actor.role, segment: 'mixed' } });
    page.on('pageerror', error => evidence.errors.push(error.message));
    page.on('response', response => { if (unitFormActive && response.status() === 409 && new URL(response.url()).pathname === '/api/production/boms' && response.request().method() === 'POST') { expectedUnitResponses.push(response.status()); return; } if (response.status() >= 400 && response.url().includes('/api/')) evidence.errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    await page.goto(`${ctx.urls[1]}/#production`); await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.getByTestId('production-desk-work-orders').click();
    const dir = path.join(path.dirname(ctx.reportPath), `${ctx.runId}-bom-history`); fs.mkdirSync(dir, { recursive: true });
    for (const [wo, bom] of [[history.old, history.v1], [history.newer, history.v2]]) {
      await page.getByPlaceholder('搜索工单').fill(wo.workOrderNo);
      await page.getByTestId(`production-work-order-row-${wo.id}`).click();
      const bound = page.getByTestId(`production-work-order-bom-${wo.id}`);
      await expect(bound).toContainText(bom.bomNo); await expect(bound).toContainText(bom.version);
      await bound.scrollIntoViewIfNeeded(); await expect(bound).toBeVisible();
      const visible = await bound.evaluate(el => { const b=el.getBoundingClientRect(); const top=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2); return !!top&&(el===top||el.contains(top)); });
      assert(visible, 'Bound BOM is covered by an overlay'); const font = await verifyRenderedCjk(page, `[data-testid="production-work-order-bom-${wo.id}"]`);
      const screenshot = path.join(dir, `${bom.version}.png`); await page.screenshot({ path: screenshot });
      evidence.readbacks.push({ workOrderId: wo.id, bomId: bom.id, version: bom.version, text: await bound.innerText(), visible, font, screenshot });
    }
    unitFormActive = true;
    evidence.unitSafety = await require('./enterprise-round2-unit-safety.cjs').unitSafetyBrowser(ctx, page, history.unitSafety.browserFixture, dir, signal);
    unitFormActive = false;
    evidence.massV1 = await require('./enterprise-round2-mass-conversion.cjs').massConversionBrowser(ctx, page, history.massV1.browserFixture, dir, signal);
    assert.deepEqual(expectedUnitResponses, [409]);
    assert.equal(evidence.errors.length, 0, JSON.stringify(evidence.errors)); return evidence;
  } catch (error) { error.evidence ||= evidence; throw error; }
  finally { signal.removeEventListener('abort', abort); await browser.close(); }
}
module.exports = { bomFreezeProbe, bomHistoryBrowser };
