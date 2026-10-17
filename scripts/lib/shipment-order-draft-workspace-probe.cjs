const assert = require('node:assert/strict');
const path = require('node:path');
const { expect } = require('playwright/test');

// A concrete sub-flow of the mandatory warehouse probe, not another runner or
// an original37 acceptance credit. Fixture order/payment setup remains explicit.
async function probeOrderDraftWorkspace(ctx, evidence) {
  const { page, login, folder, prisma, request, dataOf, onLogin, batchNo } = ctx;
  const e = evidence.nativeOrderDraft = { browserRequests: [], screenshots: [] };
  onLogin(login.token);
  e.actor = dataOf(await request('/auth/me'));
  assert(e.actor.permissions.includes('orders.shippingReady.read'));
  assert(e.actor.permissions.includes('shipping.write'));
  assert(!e.actor.permissions.includes('orders.read'));
  assert(!e.actor.dataScopes.includes('all') && !e.actor.dataScopes.includes('finance_visible'));
  e.denied = await Promise.all(['/orders', `/orders/${evidence.dispatchTargets[0].order.id}`].map(endpoint => request(endpoint)));
  for (const denied of e.denied) assert.equal(denied.status, 403);
  const assertLogisticsOnly = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert(!/amount|price|discount|tax|payment|receivable|adjustments/i.test(key), `Warehouse DTO exposed ${key}`);
      assertLogisticsOnly(child);
    }
  };
  e.ready = await Promise.all([0, 1].map(instance => request('/orders/shipping-ready?view=dispatch', { instance }).then(dataOf)));
  for (const ready of e.ready) {
    assertLogisticsOnly(ready);
    for (const target of evidence.dispatchTargets) assert(ready.some(row => row.id === Number(target.order.id)));
  }
  page.on('request', r => {
    const url = new URL(r.url());
    if (url.pathname === '/api/shipping' || url.pathname.startsWith('/api/shipping/submissions/'))
      e.browserRequests.push({ method: r.method(), path: url.pathname, key: r.headers()['idempotency-key'], sent: r.method() === 'POST' ? r.postDataJSON() : null });
  });
  const shot = async name => { const file = path.join(folder, `${name}.png`); await page.screenshot({ path: file }); e.screenshots.push(file); evidence.screenshots.push(file); };
  const stock = async () => ({
    balances: await prisma.stockBalance.findMany({ where: { materialId: ctx.material.id, batchNo }, orderBy: { id: 'asc' } }),
    batch: await prisma.productBatch.findUnique({ where: { batchNo } }),
    costs: await prisma.inventoryCostLedger.findMany({ where: { productBatch: { batchNo } }, orderBy: { id: 'asc' } }),
  });
  e.before = await stock();
  const begin = async (target, quantity, batch) => {
    await page.getByTestId('shipping-order-draft-open').click();
    await page.getByTestId('shipping-order-draft-order').selectOption(String(target.order.id));
    await page.getByTestId('shipping-order-shipment-line').selectOption(String(target.line.id));
    await page.getByTestId('shipping-order-shipment-quantity').fill(String(quantity));
    await expect(page.getByTestId('shipping-order-shipment-batch')).toHaveValue('');
    if (batch) await page.getByTestId('shipping-order-shipment-batch').fill(batch);
    await expect(page.getByTestId('shipping-order-shipment-create')).toBeEnabled();
  };
  const responseData = async (response, sent, key) => ({ status: response.status(), json: await response.json(),
    sent: sent === undefined ? response.request().postDataJSON() : sent,
    key: key === undefined ? response.request().headers()['idempotency-key'] : key });
  const creates = [];
  for (const [index, target] of evidence.dispatchTargets.slice(0, 2).entries()) {
    await begin(target, 30, index ? batchNo : null);
    if (!index) await shot('warehouse-unknown-batch-draft');
    let failedRead = false;
    if (!index) await page.route('**/api/shipping', async route => {
      if (route.request().method() === 'GET' && !failedRead) {
        failedRead = true; e.readbackFailure = { path: '/api/shipping', method: 'GET', status: 500 };
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Synthetic current shipment readback failure' }) });
      } else await route.continue();
    });
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/shipping' && r.request().method() === 'POST');
    await page.getByTestId('shipping-order-shipment-create').click();
    const result = await responseData(await response); assert.equal(result.status, 201, JSON.stringify(result));
    const row = result.json.data;
    assert.equal(row.createdBy, Number(login.user.id)); assert.equal(row.orderId, Number(target.order.id));
    assert.equal(row.orderItemId, Number(target.line.id)); assert.equal(row.quantity, 30);
    assert.equal(row.batchNo, index ? batchNo : null); assert.equal(row.status, 'pending');
    assert.equal(row.carrier, null); assert.equal(row.trackingNo, null);
    creates.push(result); await expect(page.getByTestId('shipping-order-shipment-success')).toContainText(row.shipmentNo);
    if (!index) {
      await expect(page.getByTestId('shipping-order-shipment-error')).toContainText('禁止重复创建');
      assert(failedRead); await expect(page.getByTestId('shipping-order-shipment-create')).toBeDisabled();
      const posts = e.browserRequests.filter(r => r.method === 'POST').length;
      await shot('warehouse-created-current-readback-failed');
      const read = page.waitForResponse(r => new URL(r.url()).pathname === '/api/shipping' && r.request().method() === 'GET');
      await page.getByRole('button', { name: '只重试读取', exact: true }).click();
      e.readbackRecovery = { status: (await read).status() }; assert.equal(e.readbackRecovery.status, 200);
      await expect(page.getByTestId('shipping-order-shipment-error')).toHaveCount(0);
      assert.equal(e.browserRequests.filter(r => r.method === 'POST').length, posts);
      await page.unroute('**/api/shipping');
    }
    await page.getByTestId('shipping-order-shipment-close').click();
  }
  e.creates = creates; evidence.shipments = creates.map((r, i) => ({ ...r.json.data, orderNo: evidence.dispatchTargets[i].order.orderNo }));
  assert.deepEqual(await stock(), e.before);

  // Full allocation removes this order from ready candidates. Neither a missing
  // candidate nor a fresh page may erase the original ambiguous create identity.
  const last = evidence.dispatchTargets[2]; await begin(last, 5, null);
  let finish; const lost = new Promise(resolve => { finish = resolve; });
  await page.route('**/api/shipping', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    try { const response = await route.fetch(); e.lostAck = await responseData(response, route.request().postDataJSON(), route.request().headers()['idempotency-key']); await route.abort('failed'); }
    finally { finish(); }
  });
  await page.getByTestId('shipping-order-shipment-create').click(); await lost;
  assert.equal(e.lostAck.status, 201); await expect(page.getByTestId('shipping-order-shipment-create')).toBeDisabled();
  await expect(page.getByTestId('shipping-order-shipment-recover')).toBeEnabled();
  await page.unroute('**/api/shipping'); await shot('warehouse-last-allocation-lost-ack');
  e.lastId = Number(e.lostAck.json.data.id);
  e.lastBeforeRecovery = { shipment: await prisma.shipment.findUnique({ where: { id: e.lastId } }),
    audits: await prisma.auditLog.findMany({ where: { resource: 'shipment', resourceId: e.lastId }, orderBy: { id: 'asc' } }) };
  assert.equal(e.lastBeforeRecovery.audits.filter(row => row.action === 'CREATE').length, 1);
  assert.equal(e.lastBeforeRecovery.shipment.createdBy, Number(login.user.id));
  const posts = e.browserRequests.filter(r => r.method === 'POST').length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  const ready = dataOf(await request('/orders/shipping-ready?view=dispatch', { instance: 1 }));
  assert(!ready.some(row => row.id === Number(last.order.id)));
  await page.getByTestId('shipping-order-draft-open').click();
  await expect(page.getByTestId('shipping-order-draft-order').locator(`option[value="${last.order.id}"]`)).toHaveCount(0);
  await page.getByTestId(`shipping-order-recover-${last.order.id}`).click();
  const recovery = page.waitForResponse(r => new URL(r.url()).pathname === `/api/shipping/submissions/${e.lostAck.key}` && r.request().method() === 'GET');
  await page.getByTestId('shipping-order-shipment-recover').click();
  e.recovery = await responseData(await recovery); assert.equal(e.recovery.status, 200);
  assert.deepEqual(e.recovery.json.submission, e.lostAck.json.submission);
  await expect(page.getByTestId('shipping-order-shipment-success')).toContainText(e.lastBeforeRecovery.shipment.shipmentNo);
  assert.equal(e.browserRequests.filter(r => r.method === 'POST').length, posts);
  assert.deepEqual({ shipment: await prisma.shipment.findUnique({ where: { id: e.lastId } }),
    audits: await prisma.auditLog.findMany({ where: { resource: 'shipment', resourceId: e.lastId }, orderBy: { id: 'asc' } }) }, e.lastBeforeRecovery);
  await shot('warehouse-disappeared-candidate-original-recovered');
  await page.getByTestId('shipping-order-shipment-close').click();
  await expect(page.getByTestId(`shipping-order-recover-${last.order.id}`)).toHaveCount(0);

  const id = Number(evidence.shipments[0].id), base = `/api/shipping/${id}`;
  e.missingBatchHold = await request(`/shipping/${id}/reserve`, { method: 'POST', data: { expectedAuditId: null } });
  assert.equal(e.missingBatchHold.status, 409);
  assert.match(JSON.stringify(e.missingBatchHold.json), /SHIPMENT_RESERVATION_IDENTITY_REQUIRED/);
  await page.getByTestId(`shipment-supplement-${id}`).click();
  await page.getByTestId('shipment-supplement-batch').fill(batchNo);
  await expect(page.getByTestId('shipment-supplement-reason')).toHaveCount(0);
  const supplement = page.waitForResponse(r => new URL(r.url()).pathname === `${base}/supplement` && r.request().method() === 'PATCH');
  await page.getByTestId('shipment-supplement-save').click(); e.supplement = await responseData(await supplement);
  assert.equal(e.supplement.status, 200); await expect(page.getByTestId('shipment-supplement-batch')).toBeDisabled();
  await shot('warehouse-real-batch-later-no-fabrication'); await page.getByTestId('shipment-supplement-close').click();
  e.after = await stock(); assert.deepEqual(e.after, e.before);
  e.firstPersisted = await prisma.shipment.findUnique({ where: { id } });
  assert.equal(e.firstPersisted.batchNo, batchNo); assert.equal(e.firstPersisted.createdBy, Number(login.user.id));
  assert.equal(e.firstPersisted.status, 'pending'); assert.equal(e.firstPersisted.shippedAt, null);
  assert.deepEqual(JSON.parse(e.firstPersisted.submissionJson).shipment, creates[0].json.submission.shipment);
  e.supplementAudits = await prisma.auditLog.findMany({ where: { resource: 'shipment', resourceId: id, action: 'SUPPLEMENT_SHIPMENT' } });
  assert.equal(e.supplementAudits.length, 1); assert.equal(e.supplementAudits[0].userId, Number(login.user.id));
}
module.exports = { probeOrderDraftWorkspace };
