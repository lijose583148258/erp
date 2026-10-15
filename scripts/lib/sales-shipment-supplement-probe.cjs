const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('playwright/test');
const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
const { loginUiAuditUser } = require('./ui-audit-user.cjs');

async function probeShipmentSupplement(ctx, report) {
  const { prisma, request, dataOf, order, original, material, batchNo, runId, password, urls, salesToken, adminToken, onLogin } = ctx;
  onLogin(adminToken);
  const e = report.shipmentSupplement = { version: 'shipment-supplement-probe/v2', scope: 'Native late-fill, real batch binding/reservation/dispatch and foreign event time; admin diagnostic, not original20/full sales acceptance', screenshots: [] };
  const folder = path.join(path.dirname(process.env.ROUND2_REPORT_PATH), 'shipment-supplement'); fs.mkdirSync(folder, { recursive: true });
  const stock = async () => ({ balances: await prisma.stockBalance.findMany({ where: { materialId: material.id, batchNo }, orderBy: { id: 'asc' } }),
    batch: await prisma.productBatch.findUnique({ where: { batchNo } }), costs: await prisma.inventoryCostLedger.findMany({ where: { productBatch: { batchNo } }, orderBy: { id: 'asc' } }) });
  const all = async id => ({ shipment: await prisma.shipment.findUnique({ where: { id } }),
    audits: await prisma.auditLog.findMany({ where: { resource: 'shipment', resourceId: id }, orderBy: { id: 'asc' } }), stock: await stock() });
  const browser = (await launchBrowserWithGuard({ retryLimit: 1 })).browser;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
  try {
    const login = await loginUiAuditUser(page, `${urls[0]}/`, { account: { username: runId, password, role: 'admin', segment: 'mixed' },
      storage: { 'ailao.language': 'zh', language: 'zh-CN' } }); onLogin(login.token);
    const shot = async name => { const file = path.join(folder, `${name}.png`); await page.screenshot({ path: file }); e.screenshots.push(file); };
    const responseFor = (pathname, method) => page.waitForResponse(response => new URL(response.url()).pathname === pathname && response.request().method() === method);
    await page.goto(`${urls[0]}/#orders`, { waitUntil: 'domcontentloaded' }); await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.getByTestId('sales-desk-fulfillment').click(); await page.getByTestId('sales-order-search').fill(order.orderNo);
    await page.getByTestId(`sales-order-ship-${order.id}`).click(); await page.getByTestId('sales-order-shipment-line').selectOption(String(original.items[0].id));
    await page.getByTestId('sales-order-shipment-quantity').fill('30');
    await expect(page.getByTestId('sales-order-shipment-batch')).toHaveValue('');
    await expect(page.getByTestId('sales-order-shipment-create')).toBeEnabled(); await shot('optional-information-draft');
    e.beforeDraft = await stock(); const creationResponse = responseFor('/api/shipping', 'POST');
    await page.getByTestId('sales-order-shipment-create').click(); const created = await creationResponse;
    e.creation = { status: created.status(), json: await created.json(), sent: created.request().postDataJSON(), key: created.request().headers()['idempotency-key'] };
    assert.equal(e.creation.status, 201); const shipment = e.creation.json.data, id = shipment.id;
    assert.equal(shipment.batchNo, null); assert.equal(shipment.carrier, null); assert.equal(shipment.trackingNo, null);
    assert.deepEqual(await stock(), e.beforeDraft);
    const base = `/shipping/${id}`, view = async () => dataOf(await request(`${base}/supplement`));
    e.initialView = await request(`${base}/supplement`); assert.equal(e.initialView.status, 200);
    const beforeUnbound = await all(id);
    e.unboundDispatch = await request(`${base}/status`, { method: 'PATCH', data: { status: 'in_transit' } });
    e.unboundReserve = await request(`${base}/reserve`, { method: 'POST', data: { expectedAuditId: null } });
    assert.equal(e.unboundDispatch.status, 409); assert.equal(e.unboundDispatch.json.errorCode || e.unboundDispatch.json.message, 'SHIPMENT_BATCH_REQUIRED_BEFORE_DISPATCH');
    assert.equal(e.unboundReserve.status, 409); assert.deepEqual(await all(id), beforeUnbound);
    const openSupplement = async () => { await page.goto(`${urls[0]}/#shipping`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId(`shipment-supplement-${id}`).click(); await expect(page.getByTestId('shipment-supplement-carrier')).toBeEnabled(); };
    await openSupplement(); await page.getByTestId('shipment-supplement-carrier').fill('Cross-border carrier');
    await expect(page.getByTestId('shipment-supplement-reason')).toHaveCount(0);
    const firstFill = responseFor(`/api${base}/supplement`, 'PATCH'); await page.getByTestId('shipment-supplement-save').click();
    e.carrierFill = { status: (await firstFill).status(), json: await (await firstFill).json() }; assert.equal(e.carrierFill.status, 200);
    await expect(page.getByTestId('shipment-supplement-saved')).toBeVisible(); assert.equal((await view()).shipment.batchNo, null);
    await shot('carrier-only-batch-still-unknown');
    await page.getByTestId('shipment-supplement-batch').fill(batchNo);
    let resolveLost; const lost = new Promise(resolve => { resolveLost = resolve; });
    await page.route(`**/api${base}/supplement`, async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      try { const response = await route.fetch(); e.lostAck = { status: response.status(), json: await response.json() }; await route.abort('failed'); }
      finally { resolveLost(); }
    });
    await page.getByTestId('shipment-supplement-save').click(); await lost;
    await expect(page.getByTestId('shipment-supplement-save')).toBeDisabled(); assert.equal(e.lostAck.status, 200);
    await page.unroute(`**/api${base}/supplement`); e.beforeReadRecovery = await all(id);
    const recovered = responseFor(`/api${base}/supplement`, 'GET'); await page.getByTestId('shipment-supplement-refresh').click(); await recovered;
    await expect(page.getByTestId('shipment-supplement-batch')).toHaveValue(batchNo); await expect(page.getByTestId('shipment-supplement-batch')).toBeDisabled();
    assert.deepEqual(await all(id), e.beforeReadRecovery, 'Lost supplementary ACK recovery is read-only');
    e.originalAfterBinding = await request(`/shipping/submissions/${e.creation.key}`);
    assert.equal(e.originalAfterBinding.status, 200); assert.deepEqual(e.originalAfterBinding.json.submission, e.creation.json.submission);
    assert.deepEqual(await stock(), e.beforeDraft); await shot('batch-supplied-original-preserved');
    const v = await view(), token = { expectedAuditId: v.versionId, expectedUpdatedAt: v.shipment.updatedAt };
    e.race = await Promise.all(['TRACK-A', 'TRACK-B'].map((trackingNo, instance) => request(`${base}/supplement`, { method: 'PATCH', instance, data: { ...token, patch: { trackingNo } } })));
    assert.deepEqual(e.race.map(r => r.status).sort(), [200, 409]);
    const current = await view(), beforeDenied = await all(id);
    e.overwriteWithoutReason = await request(`${base}/supplement`, { method: 'PATCH', data: { expectedAuditId: current.versionId, expectedUpdatedAt: current.shipment.updatedAt, patch: { trackingNo: 'UNEXPLAINED' } } });
    assert.equal(e.overwriteWithoutReason.status, 409);
    onLogin(salesToken); e.denied = await request(`${base}/supplement`, { method: 'PATCH', data: { ...token, patch: { carrier: 'Forbidden actor' } } });
    assert.equal(e.denied.status, 403); onLogin(login.token); assert.deepEqual(await all(id), beforeDenied);
    e.reserved = await request(`${base}/reserve`, { method: 'POST', data: { expectedAuditId: null } }); assert.equal(e.reserved.status, 201);
    e.dispatch = await request(`${base}/status`, { method: 'PATCH', instance: 1, data: { status: 'in_transit' } }); assert.equal(e.dispatch.status, 200, JSON.stringify(e.dispatch));
    e.afterDispatch = await all(id); assert.equal(e.afterDispatch.stock.balances[0].quantity, 10); assert.equal(e.afterDispatch.stock.batch.stockQuantity, 10);
    assert.equal(e.afterDispatch.shipment.reservationState, 'consumed');
    await page.getByTestId('shipment-supplement-close').click(); await page.reload({ waitUntil: 'domcontentloaded' }); await openSupplement();
    await page.getByTestId('shipment-supplement-zone').selectOption('Asia/Ho_Chi_Minh');
    await page.getByTestId('shipment-supplement-local-time').fill('2026-10-14T23:30');
    const actualTime = responseFor(`/api${base}/supplement`, 'PATCH'); await page.getByTestId('shipment-supplement-save').click();
    e.actualTime = { status: (await actualTime).status(), json: await (await actualTime).json(), sent: (await actualTime).request().postDataJSON() };
    assert.equal(e.actualTime.status, 200); assert.deepEqual(e.actualTime.sent.patch.dispatchOccurrence,
      { occurredAt: '2026-10-14T23:30:00+07:00', timeZone: 'Asia/Ho_Chi_Minh' });
    assert(Date.parse(e.actualTime.sent.patch.dispatchOccurrence.occurredAt) < Date.parse(e.afterDispatch.shipment.createdAt));
    await expect(page.getByTestId('shipment-supplement-history')).toContainText('Asia/Ho_Chi_Minh'); await shot('cross-midnight-delayed-event');
    await page.setViewportSize({ width: 390, height: 844 }); await shot('mobile-delayed-event');
    const bounds = await page.getByRole('dialog').boundingBox(); assert(bounds.x >= 0 && bounds.x + bounds.width <= 391);
    await page.getByTestId('shipment-supplement-history').scrollIntoViewIfNeeded(); await shot('mobile-readable-history');
    e.afterLateTime = await all(id); assert.deepEqual(e.afterLateTime.stock, e.afterDispatch.stock);
    for (const field of ['createdAt', 'shippedAt', 'quantity', 'materialId', 'batchNo']) assert.deepEqual(e.afterLateTime.shipment[field], e.afterDispatch.shipment[field]);
    e.originalAfterDispatch = await request('/shipping', { method: 'POST', instance: 1, data: { ...e.creation.sent, idempotencyKey: e.creation.key } });
    assert.equal(e.originalAfterDispatch.status, 200); assert.deepEqual(e.originalAfterDispatch.json.submission, e.creation.json.submission);
    const latest = await view(), correction = { expectedAuditId: latest.versionId, expectedUpdatedAt: latest.shipment.updatedAt,
      patch: { trackingNo: 'TRACK-CORRECTED' }, reason: 'Carrier sent corrected customs reference later' };
    const trigger = `shipment_supplement_fault_${Date.now()}`, pg = process.env.AUDIT_PRISMA_PROVIDER === 'postgresql';
    const beforeFault = await all(id);
    try {
      if (pg) {
        await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic supplement audit failure'; END; $$`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.resource='shipment' AND NEW.action='SUPPLEMENT_SHIPMENT') EXECUTE FUNCTION ${trigger}()`);
      } else await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs WHEN NEW.resource='shipment' AND NEW.action='SUPPLEMENT_SHIPMENT' BEGIN SELECT RAISE(ABORT,'Synthetic supplement audit failure'); END`);
      e.auditFault = await request(`${base}/supplement`, { method: 'PATCH', data: correction }); assert.equal(e.auditFault.status, 500);
    } finally {
      await prisma.$executeRawUnsafe(pg ? `DROP TRIGGER IF EXISTS ${trigger} ON audit_logs` : `DROP TRIGGER IF EXISTS ${trigger}`);
      if (pg) await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`);
    }
    assert.deepEqual(await all(id), beforeFault); e.corrected = await request(`${base}/supplement`, { method: 'PATCH', data: correction }); assert.equal(e.corrected.status, 200);
    e.correctedReplay = await request(`${base}/supplement`, { method: 'PATCH', instance: 1, data: correction }); assert.equal(e.correctedReplay.status, 200);
    e.final = await all(id); assert.equal(e.final.audits.filter(a => a.action === 'SUPPLEMENT_SHIPMENT').length, 5);
    assert.deepEqual(e.final.stock, e.afterDispatch.stock);
    assert.equal(e.final.stock.costs.reduce((sum, row) => sum + row.costAmountDelta, 0), 100);
    e.finalView = await view();
  } finally { await page.close().catch(() => {}); await browser.close(); }
}
module.exports = { probeShipmentSupplement };
