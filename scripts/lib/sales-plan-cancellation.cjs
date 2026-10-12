const assert = require('node:assert/strict');

async function salesPlanCancellation({ request, dataOf, prisma, actors, browser, urls, runId, customer, material, supplier, eta, delivery, capture }) {
  const { expect } = require('playwright/test');
  const order = dataOf(await request('/orders', { auth: actors.sales.token, method: 'POST', data: { customerId: Number(customer.id),
    items: [{ materialId: material.id, productName: material.nameZh, quantity: 100, unit: 'kg', unitPrice: 10 }], paymentTerms: 30 } }));
  const original = dataOf(await request(`/orders/${order.id}`)), lineId = original.items[0].id;
  const po = dataOf(await request('/procurement/orders', { method: 'POST', data: { supplierId: Number(supplier.id), materialId: material.id,
    salesOrderId: Number(order.id), item: material.nameZh, quantity: 100, price: 10, unit: 'kg', eta, currency: 'CNY', status: 'approved' } }));
  const endpoint = `/orders/${order.id}/fulfillment-plans`;
  const input = { orderItemId: lineId, fulfillmentOption: 'linked_purchase', sourceDocumentId: Number(po.id), plannedQuantity: 100,
    expectedFulfillmentAt: delivery, note: 'Replace obsolete supply without cancelling customer demand' };
  const create = key => request(endpoint, { auth: actors.sales.token, method: 'POST', data: { ...input, idempotencyKey: `${runId}-${key}` } }).then(dataOf);
  const approve = plan => request(`${endpoint}/${plan.id}/approve`, { auth: actors.reviewer.token, method: 'POST',
    data: { expectedUpdatedAt: plan.updatedAt, reason: 'Independent replenishment approval' } });
  const first = dataOf(await approve(await create('cancel-original')));
  dataOf(await request(`/procurement/orders/${po.id}`, { method: 'PATCH', data: { expectedRevision: po.revision, expectedUpdatedAt: po.updatedAt,
    quantity: 100, price: 11, taxAmount: 0, eta, reason: 'Supplier revised purchase before any receipt' } }));
  dataOf(await request(`/procurement/orders/${po.id}/status`, { method: 'PATCH', data: { status: 'approved', expectedRevision: po.revision + 1 } }));
  const replacement = await create('cancel-replacement');
  const state = async () => ({
    order: await prisma.order.findUnique({ where: { id: Number(order.id) }, include: { items: true, shipments: true, paymentRecords: true } }),
    purchase: await prisma.purchaseOrder.findUnique({ where: { id: Number(po.id) }, include: { receipts: true } }),
    balances: await prisma.stockBalance.findMany({ where: { materialId: material.id }, orderBy: { id: 'asc' } }),
    cost: await prisma.inventoryCostLedger.findMany({ where: { productBatch: { materialId: material.id } }, orderBy: { id: 'asc' } }),
    plans: await prisma.salesFulfillmentPlan.findMany({ where: { orderId: Number(order.id) }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { resource: 'sales_fulfillment_plan', resourceId: { in: [first.id, replacement.id] } }, orderBy: { id: 'asc' } }),
  });
  const evidence = { orderId: order.id, original: first, replacement, before: await state(), rejections: [] };
  const reject = async (label, action, status) => {
    const before = await state(), response = await action(); assert.equal(response.status, status, `${label}: ${JSON.stringify(response)}`);
    assert.deepEqual(await state(), before); evidence.rejections.push({ label, status, errorCode: response.json.errorCode, unchanged: true });
  };
  const reason = 'Replace obsolete purchase revision; customer still owed 100 kg';
  const cancelInput = { expectedUpdatedAt: first.updatedAt, expectedStatus: first.status, idempotencyKey: `sales-plan-cancel:${first.id}`, reason };
  const cancel = (data, auth = actors.reviewer.token, instance = 0) => request(`${endpoint}/${first.id}/cancel`, { method: 'POST', data, auth, instance });
  await reject('replacement blocked before cancellation', () => approve(replacement), 409);
  await reject('old source cannot close', () => request(`${endpoint}/${first.id}/close`, { method: 'POST', data: { reason, idempotencyKey: `${runId}-stale-close` } }), 409);
  await reject('sales cannot cancel approved supply', () => cancel(cancelInput, actors.sales.token), 403);
  await reject('stale cancellation', () => cancel({ ...cancelInput, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }), 409);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    page.setDefaultTimeout(15000);
    await page.addInitScript(({ token, user }) => {
      for (const k of ['token', 'auth_token', 'erp_auth_token']) localStorage.setItem(k, token);
      for (const k of ['user', 'currentUser', 'erp_current_user']) localStorage.setItem(k, JSON.stringify(user));
      localStorage.setItem('ailao.language', 'zh'); localStorage.setItem('language', 'zh-CN');
    }, actors.reviewer);
    await page.goto(`${urls[1]}/#orders`); await page.getByTestId('sales-desk-fulfillment').click();
    await page.getByTestId(`sales-order-plan-${order.id}`).click(); await page.getByTestId('sales-plan-reason').fill(reason);
    const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api${endpoint}/${first.id}/cancel` && r.request().method() === 'POST');
    await page.getByTestId(`sales-plan-cancel-${first.id}`).dblclick(); const result = await response; assert.equal(result.status(), 200);
    evidence.browser = { actorId: Number(actors.reviewer.user.id), instance: 1, cancelStatus: result.status(), cancelled: (await result.json()).data };
    const cancelled = page.getByTestId(`sales-plan-${first.id}`); await expect(cancelled).toContainText('已取消'); await expect(cancelled).toContainText(reason);
    await capture(page, 'sales-plan-cancelled-history.png', cancelled);
    evidence.afterCancel = await state();
    evidence.replays = await Promise.all([0, 1].map(instance => cancel(cancelInput, actors.reviewer.token, instance)));
    assert(evidence.replays.every(r => r.status === 200)); assert.deepEqual(await state(), evidence.afterCancel);
    await reject('changed cancellation reason', () => cancel({ ...cancelInput, reason: 'Changed explanation' }), 409);
    await reject('different cancelling actor', () => cancel(cancelInput, actors.admin.token), 409);
    const approval = page.waitForResponse(r => new URL(r.url()).pathname === `/api${endpoint}/${replacement.id}/approve` && r.request().method() === 'POST');
    await page.getByTestId(`sales-plan-approve-${replacement.id}`).click(); const approved = await approval; assert.equal(approved.status(), 200);
    evidence.browser.approveStatus = approved.status(); evidence.browser.approved = (await approved.json()).data;
    await expect(page.getByTestId(`sales-plan-${replacement.id}`)).toContainText('已批准');
    await capture(page, 'sales-plan-replacement-approved.png', page.getByTestId(`sales-plan-${replacement.id}`));
    evidence.final = await state();
    evidence.readbacks = await Promise.all([0, 1].map(instance => request(endpoint, { instance }).then(dataOf)));
    // Two nodes act on the same draft: approval and cancellation must not both
    // succeed, even when they observed the same revision and timestamp.
    const raceOrder = dataOf(await request('/orders', { auth: actors.sales.token, method: 'POST', data: { customerId: Number(customer.id),
      items: [{ materialId: material.id, productName: material.nameZh, quantity: 100, unit: 'kg', unitPrice: 10 }], paymentTerms: 30 } }));
    const raceBase = `/orders/${raceOrder.id}/fulfillment-plans`, raceLine = dataOf(await request(`/orders/${raceOrder.id}`)).items[0];
    const racePo = dataOf(await request('/procurement/orders', { method: 'POST', data: { supplierId: Number(supplier.id), materialId: material.id,
      salesOrderId: Number(raceOrder.id), item: material.nameZh, quantity: 100, price: 10, unit: 'kg', eta, currency: 'CNY', status: 'approved' } }));
    const racePlan = dataOf(await request(raceBase, { auth: actors.sales.token, method: 'POST', data: { ...input, idempotencyKey: `${runId}-cancel-race`, orderItemId: raceLine.id, sourceDocumentId: Number(racePo.id) } }));
    const results = await Promise.all([
      request(`${raceBase}/${racePlan.id}/approve`, { auth: actors.reviewer.token, instance: 0, method: 'POST', data: { expectedUpdatedAt: racePlan.updatedAt, reason } }),
      request(`${raceBase}/${racePlan.id}/cancel`, { auth: actors.admin.token, instance: 1, method: 'POST', data: { expectedUpdatedAt: racePlan.updatedAt, expectedStatus: 'draft', reason, idempotencyKey: `${runId}-cancel-race-result` } }),
    ]);
    evidence.race = { orderId: raceOrder.id, planId: racePlan.id, results,
      plan: await prisma.salesFulfillmentPlan.findUnique({ where: { id: racePlan.id } }),
      audits: await prisma.auditLog.findMany({ where: { resource: 'sales_fulfillment_plan', resourceId: racePlan.id }, orderBy: { id: 'asc' } }),
      readbacks: await Promise.all([0, 1].map(instance => request(raceBase, { instance }).then(dataOf))) };
    verifySalesPlanCancellation(evidence);
    return evidence;
  } finally { await page.close(); }
}

function verifySalesPlanCancellation(e) {
  assert(e && e.before && e.afterCancel && e.final, 'Cancellation evidence is required');
  assert.notEqual(e.original.id, e.replacement.id); assert.equal(e.original.status, 'approved');
  assert.equal(e.browser.cancelStatus, 200); assert.equal(e.browser.approveStatus, 200); assert.equal(e.browser.instance, 1);
  for (const stage of [e.afterCancel, e.final]) for (const key of ['order', 'purchase', 'balances', 'cost']) assert.deepEqual(stage[key], e.before[key], `Cancellation changed ${key}`);
  const old = e.final.plans.find(p => p.id === e.original.id), next = e.final.plans.find(p => p.id === e.replacement.id);
  assert.equal(old.status, 'cancelled'); assert.equal(next.status, 'approved'); assert.equal(old.closedBy, e.browser.actorId);
  assert.equal(next.approvedBy, e.browser.actorId); assert.notEqual(next.createdBy, next.approvedBy);
  const before = e.before.plans.find(p => p.id === old.id);
  for (const key of ['sourceSnapshot', 'approvedBy', 'approvedAt', 'plannedQuantity', 'createdBy', 'createdAt']) assert.deepEqual(old[key], before[key]);
  const snapshot = JSON.parse(old.closeoutSnapshot); assert.equal(snapshot.kind, 'cancellation'); assert.equal(snapshot.stockChanged, false); assert.equal(snapshot.moneyChanged, false);
  assert.equal(snapshot.reason, e.browser.cancelled.closeoutSnapshot.reason); assert.equal(snapshot.fulfillment.lines[0].outstandingQuantity, 100);
  assert.equal(e.final.audits.filter(a => a.resourceId === old.id && a.action === 'CANCEL_SALES_FULFILLMENT_PLAN').length, 1);
  assert.equal(e.final.audits.filter(a => a.resourceId === next.id && a.action === 'APPROVE_SALES_FULFILLMENT_PLAN').length, 1);
  assert.equal(e.replays.length, 2); assert(e.replays.every(r => r.status === 200 && r.json.data.id === old.id));
  assert.equal(e.rejections.length, 6); assert(e.rejections.every(r => r.unchanged && [403, 409].includes(r.status)));
  assert.equal(e.readbacks.length, 2);
  for (const r of e.readbacks) { assert.equal(r.fulfillment.lines[0].outstandingQuantity, 100); assert.equal(r.fulfillment.fullyDelivered, false);
    assert.equal(r.plans.find(p => p.id === old.id).status, 'cancelled'); assert.equal(r.plans.find(p => p.id === next.id).status, 'approved'); }
  assert.deepEqual(e.race.results.map(r => r.status).sort(), [200, 409]);
  const winner = e.race.results[0].status === 200 ? 'approved' : 'cancelled';
  assert.equal(e.race.plan.status, winner); assert.equal(e.race.plan.id, e.race.planId);
  assert.deepEqual(e.race.audits.map(a => a.action).sort(), ['CREATE_SALES_FULFILLMENT_PLAN', winner === 'approved' ? 'APPROVE_SALES_FULFILLMENT_PLAN' : 'CANCEL_SALES_FULFILLMENT_PLAN'].sort());
  assert.equal(e.race.readbacks.length, 2);
  for (const r of e.race.readbacks) { assert.equal(r.plans.find(p => p.id === e.race.planId).status, winner); assert.equal(r.fulfillment.lines[0].outstandingQuantity, 100); }
  return { orderId: e.orderId, cancelledPlanId: old.id, replacementPlanId: next.id, outstandingQuantity: 100, stockAndMoneyUnchanged: true };
}
module.exports = { salesPlanCancellation, verifySalesPlanCancellation };
