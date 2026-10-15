const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('playwright/test');
const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
const { ensureUiAuditUser, loginUiAuditUser } = require('./ui-audit-user.cjs');

async function probeReservationWorkspace(ctx, evidence) {
  const { runId, password, urls, prisma, request, dataOf, order, original, material, batchNo, onLogin } = ctx;
  evidence.scope = 'Real warehouse reservation UI and sales readback; not the original20/final37 acceptance';
  evidence.version = 'reservation-workspace-probe/v1';
  const account = { username: `${runId}-warehouse`, password, role: 'warehouse', segment: 'mixed' };
  await ensureUiAuditUser(account);
  const browser = (await launchBrowserWithGuard({ retryLimit: 1 })).browser;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' });
  const sales = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' });
  const folder = path.join(path.dirname(process.env.ROUND2_REPORT_PATH), 'reservation-workspace'); fs.mkdirSync(folder, { recursive: true });
  evidence.screenshots = [];
  const shipment = evidence.shipments[0], id = shipment.id, base = `/shipping/${id}`;
  const snapshot = async () => ({ shipment: await prisma.shipment.findUnique({ where: { id } }),
    audits: await prisma.auditLog.findMany({ where: { resource: 'shipment', resourceId: id }, orderBy: { id: 'asc' } }),
    balances: await prisma.stockBalance.findMany({ where: { materialId: material.id, batchNo }, orderBy: { id: 'asc' } }),
    batch: await prisma.productBatch.findUnique({ where: { batchNo } }),
    costs: await prisma.inventoryCostLedger.findMany({ where: { productBatch: { batchNo } }, orderBy: { id: 'asc' } }),
  });
  page.setDefaultTimeout(12000);
  try {
    const login = await loginUiAuditUser(page, `${urls[0]}/`, { account, storage: { 'ailao.language': 'zh', language: 'zh-CN' } });
    assert.equal(login.user.role, 'warehouse'); evidence.warehouseActor = { id: Number(login.user.id), role: login.user.role };
    await page.goto(`${urls[0]}/#shipping`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId(`shipment-reservation-${id}`)).toBeVisible();
    const salesLogin = await loginUiAuditUser(sales, `${urls[1]}/`, { account: { username: `${runId}-sales`, password, role: 'sales', segment: 'direct' },
      storage: { 'ailao.language': 'zh', language: 'zh-CN' } });
    assert.equal(salesLogin.user.role, 'sales'); assert.notEqual(salesLogin.user.id, login.user.id);
    evidence.salesActor = { id: Number(salesLogin.user.id), role: salesLogin.user.role };
    const shot = async (target, name) => { const file = path.join(folder, `${name}.png`); await target.screenshot({ path: file }); evidence.screenshots.push(file); };
    const responseFor = (suffix, method) => page.waitForResponse(r => new URL(r.url()).pathname === `/api${base}/${suffix}` && r.request().method() === method);
    const salesRead = async (name, held, dispatched, accepted) => {
      onLogin(salesLogin.token);
      const detail = dataOf(await request(`/orders/${order.id}`, { instance: 1 }));
      const listed = dataOf(await request(`/orders?search=${encodeURIComponent(order.orderNo)}`, { instance: 0 })).find(o => Number(o.id) === Number(order.id));
      assert(listed); const expected = { reservedQuantity: held, reservationEvidenceState: 'verified', allocatedQuantity: 30, dispatchedQuantity: dispatched,
        acceptedQuantity: accepted, outstandingQuantity: 100 - accepted, unallocatedQuantity: 70, unit: 'kg' };
      for (const value of [detail, listed]) for (const [key, n] of Object.entries(expected)) assert.equal(value.fulfillment.lines[0][key], n, `${name}/${key}`);
      await sales.goto(`${urls[1]}/#orders`, { waitUntil: 'domcontentloaded' }); await sales.reload({ waitUntil: 'domcontentloaded' });
      await sales.locator('#loading').waitFor({ state: 'hidden' }); await sales.getByTestId('sales-desk-fulfillment').click(); await sales.getByTestId('sales-order-search').fill(order.orderNo);
      await expect(sales.getByTestId(`order-reserved-${order.id}-${original.items[0].id}`)).toContainText(new RegExp(`${held}\\s*kg`));
      const obligation = sales.getByTestId(`order-line-obligation-${order.id}-${original.items[0].id}`);
      await expect(obligation).toContainText(new RegExp(`已签收:\\s*${accepted}\\s*kg`));
      await expect(obligation).toContainText(new RegExp(`待交:\\s*${100 - accepted}\\s*kg`));
      const crop = path.join(folder, `${name}-quantities.png`); await obligation.screenshot({ path: crop }); evidence.screenshots.push(crop);
      await shot(sales, name); onLogin(login.token); return { detail, listed, expected };
    };
    evidence.before = await snapshot(); onLogin(login.token);
    await page.getByTestId(`shipment-reservation-${id}`).click();
    await expect(page.getByTestId('shipment-reservation-state')).toHaveText('未预留');
    let resolveAck; const lostAck = new Promise(resolve => { resolveAck = resolve; });
    await page.route(`**/api${base}/reserve`, async route => {
      try { const r = await route.fetch(); evidence.lostAck = { status: r.status(), json: await r.json(), sent: route.request().postDataJSON() }; await route.abort('failed'); }
      finally { resolveAck(); }
    });
    await page.getByTestId('shipment-reservation-reserve').click(); await lostAck;
    assert.equal(evidence.lostAck.status, 201); await expect(page.getByTestId('shipment-reservation-reserve')).toBeDisabled();
    await page.unroute(`**/api${base}/reserve`); evidence.beforeRecovery = await snapshot();
    const recovered = responseFor('reservation', 'GET'); await page.getByTestId('shipment-reservation-refresh').click(); await recovered;
    await expect(page.getByTestId('shipment-reservation-state')).toHaveText('已预留'); assert.deepEqual(await snapshot(), evidence.beforeRecovery);
    evidence.salesAfterReserve = await salesRead('sales-hold-not-delivery', 30, 0, 0);
    const deniedBefore = evidence.deniedBefore = await snapshot(); onLogin(salesLogin.token);
    evidence.deniedSalesReserve = await request(`${base}/reserve`, { method: 'POST', instance: 1, data: { expectedAuditId: null } });
    assert.equal(evidence.deniedSalesReserve.status, 403); evidence.deniedAfter = await snapshot(); assert.deepEqual(evidence.deniedAfter, deniedBefore); onLogin(login.token);
    await page.getByTestId('shipment-reservation-reason').fill('Documents delayed across countries; release this allocation');
    const release = responseFor('release-reservation', 'POST'); await page.getByTestId('shipment-reservation-release').click(); const released = await release;
    evidence.release = { status: released.status(), sent: released.request().postDataJSON(), json: await released.json() }; assert.equal(evidence.release.status, 201);
    await expect(page.getByTestId('shipment-reservation-state')).toHaveText('已释放'); evidence.salesAfterRelease = await salesRead('sales-released-hold', 0, 0, 0);
    // Fault injection only, not evidence that a QA-role workflow was exercised.
    await prisma.productBatch.update({ where: { batchNo }, data: { qualityStatus: 'hold' } }); const beforeQA = evidence.beforeQA = await snapshot();
    const blocked = responseFor('reserve', 'POST'); await page.getByTestId('shipment-reservation-reserve').click(); evidence.qaBlocked = { status: (await blocked).status(), json: await (await blocked).json() };
    assert.equal(evidence.qaBlocked.status, 409); await expect(page.getByTestId('shipment-reservation-reserve')).toBeDisabled(); evidence.afterQA = await snapshot(); assert.deepEqual(evidence.afterQA, beforeQA);
    await prisma.productBatch.update({ where: { batchNo }, data: { qualityStatus: 'not_required' } });
    await page.getByTestId('shipment-reservation-refresh').click(); await expect(page.getByTestId('shipment-reservation-reserve')).toBeEnabled();
    const second = responseFor('reserve', 'POST'); await page.getByTestId('shipment-reservation-reserve').click(); evidence.newGeneration = { status: (await second).status(), json: await (await second).json() };
    assert.equal(evidence.newGeneration.status, 201); await expect(page.getByTestId('shipment-reservation-state')).toHaveText('已预留');
    const afterNew = evidence.beforeStale = await snapshot(); evidence.staleRelease = await request(`${base}/release-reservation`, { method: 'POST', instance: 1, data: evidence.release.sent });
    assert.equal(evidence.staleRelease.status, 409); evidence.afterStale = await snapshot(); assert.deepEqual(evidence.afterStale, afterNew);
    evidence.salesAfterNew = await salesRead('sales-new-generation-hold', 30, 0, 0);
    for (const state of [evidence.beforeRecovery, afterNew]) { assert.deepEqual(state.balances, evidence.before.balances); assert.deepEqual(state.costs, evidence.before.costs); }
    await page.setViewportSize({ width: 390, height: 844 }); await shot(page, 'warehouse-mobile-hold');
    const bounds = await page.getByRole('dialog').boundingBox(); assert(bounds.x >= 0 && bounds.x + bounds.width <= 391);
    await page.getByTestId('shipment-reservation-close').click(); await page.setViewportSize({ width: 1440, height: 1000 });
    const dispatched = responseFor('status', 'PATCH'); await page.getByTestId(`shipment-dispatch-${id}`).click(); evidence.dispatch = { status: (await dispatched).status(), json: await (await dispatched).json() };
    assert.equal(evidence.dispatch.status, 200); await expect(page.getByTestId(`shipment-reserved-${id}`)).toContainText(/0\s*kg/);
    evidence.salesAfterDispatch = await salesRead('sales-dispatched-not-yet-accepted', 0, 30, 0);
    evidence.partialReceipt = await request(`${base}/receipt-events`, { method: 'POST', instance: 1, data: { quantity: 20, acceptedQuantity: 20, rejectedQuantity: 0,
      note: 'Synthetic independent partial receipt, not another stock issue', fileName: 'isolated-pod.png', mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' } });
    assert.equal(evidence.partialReceipt.status, 201, JSON.stringify(evidence.partialReceipt));
    evidence.salesAfterPartialReceipt = await salesRead('sales-partial-receipt-owes80', 0, 30, 20);
    evidence.final = await snapshot(); assert.equal(evidence.final.shipment.status, 'in_transit'); assert.equal(evidence.final.shipment.reservationState, 'consumed');
    assert.equal(evidence.final.balances[0].quantity, 10); assert.equal(evidence.final.batch.stockQuantity, 10);
    assert.equal(evidence.final.costs.reduce((sum, row) => sum + row.costAmountDelta, 0), 100);
    assert.deepEqual(evidence.final.audits.filter(a => a.action === 'RESERVE_STOCK').map(a => a.userId), [Number(login.user.id), Number(login.user.id)]);
    // A real six-place chemical hold must not disappear through display rounding.
    const target = evidence.shipments[1]; onLogin(login.token);
    const micro = dataOf(await request('/shipping', { method: 'POST', data: { customerId: target.customerId, orderId: target.orderId,
      orderItemId: target.orderItemId, materialId: material.id, productName: material.nameZh, batchNo, quantity: 0.000001, unit: 'kg',
      idempotencyKey: `${runId}-micro-display` } }));
    evidence.micro = { shipment: micro, before: await snapshot() };
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByTestId(`shipment-reservation-${micro.id}`).click();
    await expect(page.getByTestId('shipment-reservation-reserve')).toBeEnabled(); await page.getByTestId('shipment-reservation-reserve').click();
    await expect(page.getByTestId('shipment-reservation-state')).toHaveText('已预留');
    onLogin(salesLogin.token); evidence.micro.order = dataOf(await request(`/orders/${target.orderId}`, { instance: 1 }));
    assert.equal(evidence.micro.order.fulfillment.lines[0].reservedQuantity, 0.000001);
    await sales.reload({ waitUntil: 'domcontentloaded' }); await sales.getByTestId('sales-order-search').fill(target.orderNo);
    const microCell = sales.getByTestId(`order-reserved-${target.orderId}-${target.orderItemId}`);
    await expect(microCell).toContainText(/0\.000001\s*kg/); const microShot = path.join(folder, 'sales-micro-quantity.png');
    await microCell.screenshot({ path: microShot }); evidence.screenshots.push(microShot);
    await page.getByTestId('shipment-reservation-reason').fill('End isolated micro-quantity UI verification');
    await page.getByTestId('shipment-reservation-release').click(); await expect(page.getByTestId('shipment-reservation-state')).toHaveText('已释放');
    onLogin(login.token); evidence.micro.after = await snapshot();
    for (const key of ['balances', 'batch', 'costs']) assert.deepEqual(evidence.micro.after[key], evidence.micro.before[key]);
  } finally { await sales.close().catch(() => {}); await page.close().catch(() => {}); await browser.close(); }
}
module.exports = { probeReservationWorkspace };
