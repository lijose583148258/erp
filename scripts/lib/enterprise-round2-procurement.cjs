const { ensureReleasedMaterial } = require('./material-audit-fixture.cjs');
const { synchronizedBurst } = require('./enterprise-round2-runner.cjs');

async function purchaseRevisionProbe({ request, dataOf, actors, prisma, runId, verify }, signal) {
  const material = await ensureReleasedMaterial({ request: (endpoint, options) => request(endpoint, { ...options, signal }),
    code: `${runId}-po-revise`, name: `${runId}-po-revise`, category: 'raw_material', unit: 'kg' });
  const supplier = dataOf(await request('/procurement/suppliers', { actor: actors.buyer1, method: 'POST', signal,
    data: { name: `${runId}-supplier`, category: 'Raw Materials', contact: 'Synthetic' } }));
  const original = dataOf(await request('/procurement/orders', { actor: actors.buyer1, method: 'POST', signal,
    data: { supplierId: Number(supplier.id), materialId: material.id, item: material.nameZh, quantity: 100, price: 10,
      unit: 'kg', eta: '2026-10-01', currency: 'CNY', status: 'approved' } }));
  const id = Number(original.id);
  const terms = [
    { quantity: 120, price: 11, taxAmount: 0, eta: '2026-10-02', reason: 'Buyer A revised offer' },
    { quantity: 80, price: 9, taxAmount: 0, eta: '2026-10-03', reason: 'Buyer B revised offer' },
  ];
  const snapshot = async () => ({
    order: await prisma.purchaseOrder.findUnique({ where: { id } }),
    receipts: await prisma.purchaseReceipt.findMany({ where: { purchaseOrderId: id }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { resource: 'purchase_order', resourceId: id }, orderBy: { id: 'asc' } }),
  });
  const responses = await synchronizedBurst([actors.buyer1, actors.buyer2], async actor => {
    const index = actor.id === actors.buyer1.id ? 0 : 1;
    const result = await request(`/procurement/orders/${id}`, { actor, instance: index, method: 'PATCH', signal,
      data: { ...terms[index], expectedRevision: original.revision, expectedUpdatedAt: original.updatedAt } });
    return { index, status: result.status, body: result.json };
  }, signal);
  const state = await snapshot();
  const winner = responses.find(row => row.status === 200);
  const requirements = {
    one_winner_one_conflict: responses.filter(row => row.status === 200).length === 1 && responses.filter(row => row.status === 409).length === 1,
    revision_increments_once: state.order.revision === 1,
    old_approval_invalidated: state.order.status === 'pending',
    revision_audit_exactly_once: state.audits.filter(row => row.action === 'REVISE').length === 1,
    no_receipt_created: state.receipts.length === 0,
  };
  const evidence = { original, responses, state, roleBoundary: 'Two distinct manager-backed purchasing actors; not a least-privilege workforce proof' };
  verify(requirements, evidence);
  const winningTerms = terms[winner.index];
  requirements.only_winning_terms_persist = state.order.quantity === winningTerms.quantity && state.order.price === winningTerms.price
    && state.order.landedCostAmount === winningTerms.quantity * winningTerms.price;
  const audit = JSON.parse(state.audits.find(row => row.action === 'REVISE').details);
  requirements.audit_has_both_versions_and_actor = audit.before.revision === 0 && audit.after.revision === 1
    && audit.reason === winningTerms.reason && state.audits.find(row => row.action === 'REVISE').userId === winner.actorId;
  const replay = await request(`/procurement/orders/${id}`, { actor: actors.buyer1, instance: 1, method: 'PATCH', signal,
    data: { ...terms[0], expectedRevision: 0, expectedUpdatedAt: original.updatedAt } });
  const staleApproval = await request(`/procurement/orders/${id}/status`, { actor: actors.buyer2, instance: 1, method: 'PATCH', signal, data: { status: 'approved', expectedRevision: 0 } });
  const unversionedApproval = await request(`/procurement/orders/${id}/status`, { actor: actors.buyer2, method: 'PATCH', signal, data: { status: 'approved' } });
  const pendingReceipt = await request(`/procurement/orders/${id}/receipts`, { actor: actors.buyer1, method: 'POST', signal,
    data: { quantity: 1, acceptedQuantity: 1, rejectedQuantity: 0, batchNo: `${runId}-po-blocked` } });
  const deniedEdit = await request(`/procurement/orders/${id}`, { actor: actors.sales, method: 'PATCH', signal,
    data: { ...terms[0], expectedRevision: 1, expectedUpdatedAt: state.order.updatedAt.toISOString() } });
  requirements.stale_replay_and_approvals_rejected = [replay, staleApproval, unversionedApproval].every(result => result.status === 409);
  requirements.unapproved_receipt_blocked = pendingReceipt.status === 409;
  requirements.sales_cannot_edit_purchase = deniedEdit.status === 403;
  requirements.denials_have_no_side_effect = JSON.stringify(await snapshot()) === JSON.stringify(state);
  const apiReadbacks = await Promise.all([0, 1].map(async instance => dataOf(await request(`/procurement/orders/${id}/revisions`, { actor: actors.buyer2, instance, signal }))));
  requirements.both_nodes_agree = apiReadbacks.every(result => result.purchaseOrder.revision === 1
    && Number(result.purchaseOrder.quantity) === winningTerms.quantity && result.history.filter(row => row.action === 'REVISE').length === 1);
  const approved = dataOf(await request(`/procurement/orders/${id}/status`, { actor: actors.buyer2, method: 'PATCH', signal, data: { status: 'approved', expectedRevision: 1 } }));
  const statusBeforeReplay = await snapshot();
  dataOf(await request(`/procurement/orders/${id}/status`, { actor: actors.buyer2, instance: 1, method: 'PATCH', signal, data: { status: 'approved', expectedRevision: 1 } }));
  requirements.approval_replay_does_not_duplicate_audit = JSON.stringify(await snapshot()) === JSON.stringify(statusBeforeReplay);
  dataOf(await request(`/procurement/orders/${id}/receipts`, { actor: actors.buyer1, method: 'POST', signal,
    data: { quantity: 1, acceptedQuantity: 1, rejectedQuantity: 0, batchNo: `${runId}-po-received` } }));
  const received = await snapshot();
  const receiptEdit = await request(`/procurement/orders/${id}`, { actor: actors.buyer1, instance: 1, method: 'PATCH', signal,
    data: { ...terms[0], quantity: 999, expectedRevision: received.order.revision, expectedUpdatedAt: received.order.updatedAt.toISOString() } });
  requirements.received_order_cannot_be_rewritten = receiptEdit.status === 409 && JSON.stringify(await snapshot()) === JSON.stringify(received);
  return verify(requirements, { ...evidence, apiReadbacks, approved, received, statuses: { replay: replay.status, staleApproval: staleApproval.status,
    unversionedApproval: unversionedApproval.status, pendingReceipt: pendingReceipt.status, deniedEdit: deniedEdit.status, receiptEdit: receiptEdit.status } });
}

function verifyPurchaseRoleProof(e) {
  const assert = require('node:assert/strict');
  assert.equal(e.version, 'purchase-role-browser/v1'); assert.equal(e.status, 'passed');
  const jobs = { buyer: 'procurement.write', approver: 'procurement.approve', receiver: 'procurement.receive' };
  assert.deepEqual(e.actors.map(a => a.job), Object.keys(jobs));
  assert.equal(new Set(e.actors.map(a => a.id)).size, 3); assert.equal(new Set(e.actors.map(a => a.role)).size, 3);
  for (const a of e.actors) {
    assert.deepEqual([...a.permissions].sort(), ['dashboard.read', 'procurement.read', 'procurement.suppliers.read', 'materials.read', jobs[a.job]].sort());
    assert.deepEqual(a.dataScopes, ['procurement_visible']);
  }
  const people = Object.fromEntries(e.actors.map(a => [a.job, a]));
  const matrix = [['buyer', 'approve'], ['buyer', 'approve-alias'], ['buyer', 'receive'], ['buyer', 'receive-alias'], ['buyer', 'create-approved'], ['buyer', 'create-transit-alias'],
    ['approver', 'create'], ['approver', 'receive'], ['receiver', 'approve-alias'], ['receiver', 'revise'], ...Object.keys(jobs).map(job => [job, 'sync-bypass'])];
  assert.deepEqual(e.denied.map(({ job, operation, instance, status }) => ({ job, operation, instance, status })),
    [0, 1].flatMap(instance => matrix.map(([job, operation]) => ({ job, operation, instance, status: 403 }))));
  for (const r of e.denied) {
    const required = r.operation === 'sync-bypass' ? Object.values(jobs) : [r.operation.startsWith('receive') ? jobs.receiver : ['create', 'revise'].includes(r.operation) ? jobs.buyer : jobs.approver];
    assert.equal(r.response.success, false); assert.deepEqual(r.response.requiredPermissions, required);
  }
  assert.equal(e.denialAudits.length, 26); assert.equal(new Set(e.denialAudits.map(a => a.id)).size, 26);
  for (const a of e.actors) assert.equal(e.denialAudits.filter(r => r.userId === a.id && r.resource.startsWith('/api/procurement/') && r.details.startsWith('Status: 403,')).length, e.denied.filter(r => r.job === a.job).length);
  assert.deepEqual(e.afterDenied, e.before); assert.equal(e.before.audits.length, 1); assert.equal(e.before.orders.length, 1); assert.equal(e.before.orders[0].revision, 0); assert.equal(e.before.orders[0].status, 'pending');
  for (const key of ['receipts', 'balances', 'movements', 'entries', 'batches', 'costs']) assert.deepEqual(e.before[key], []);
  assert.deepEqual(e.writes.map(({ job, operation, instance, status }) => ({ job, operation, instance, status })), [
    { job: 'buyer', operation: 'revise', instance: 1, status: 200 }, { job: 'approver', operation: '/status', instance: 1, status: 200 },
    { job: 'buyer', operation: '/status', instance: 1, status: 200 }, { job: 'receiver', operation: '/receipts', instance: 1, status: 201 }]);
  for (const [i, w] of e.writes.entries()) {
    assert.equal(w.response.success, true); const order = i === 3 ? w.response.data.purchaseOrder : w.response.data;
    assert.equal(Number(order.id), e.orderId); assert.equal(order.revision, 1); assert.equal(order.quantity, 12);
    assert.equal(order.status, ['pending', 'approved', 'in_transit', 'in_transit'][i]);
  }
  const f = e.final; for (const key of ['orders', 'receipts', 'balances', 'movements', 'entries', 'batches', 'costs']) assert.equal(f[key].length, 1);
  const [order] = f.orders, [receipt] = f.receipts, [balance] = f.balances, [movement] = f.movements, [entry] = f.entries, [batch] = f.batches, [cost] = f.costs;
  assert.equal(order.id, e.orderId); assert.equal(order.materialId, e.materialId); assert.equal(order.quantity, 12); assert.equal(order.revision, 1); assert.equal(order.status, 'in_transit'); assert.equal(order.landedCostAmount, 120);
  assert.equal(receipt.purchaseOrderId, e.orderId); assert.equal(receipt.batchNo, e.batchNo); assert.equal(receipt.receivedBy, people.receiver.id); assert.equal(receipt.quantity, 5); assert.equal(receipt.acceptedQuantity, 5); assert.equal(receipt.rejectedQuantity, 0);
  assert.equal(entry.sourceType, 'procurement_receipt'); assert.equal(entry.sourceRef, receipt.stockEntryRef); assert.equal(entry.createdBy, people.receiver.id); assert.equal(entry.status, 'posted');
  assert.equal(movement.entryId, entry.id); assert.equal(movement.stockBalanceId, balance.id); assert.equal(movement.quantityBefore, 0); assert.equal(movement.quantityDelta, 5); assert.equal(movement.quantityAfter, 5);
  assert.equal(balance.materialId, e.materialId); assert.equal(balance.batchNo, e.batchNo); assert.equal(balance.unit, 'kg'); assert.equal(balance.quantity, 5);
  assert.equal(batch.materialId, e.materialId); assert.equal(batch.batchNo, e.batchNo); assert.equal(batch.stockQuantity, 5);
  assert.equal(cost.batchId, batch.id); assert.equal(cost.sourceRef, entry.entryNo); assert.equal(cost.createdBy, people.receiver.id); assert.equal(cost.quantityBefore, 0); assert.equal(cost.quantityDelta, 5); assert.equal(cost.quantityAfter, 5);
  assert.equal(cost.costBefore, 0); assert.equal(cost.costAmountDelta, 50); assert.equal(cost.costAfter, 50); assert.equal(cost.unitCost, 10);
  assert.deepEqual(f.audits.map(a => [a.action, a.userId, a.resourceId]), [['CREATE', people.buyer.id, e.orderId], ['REVISE', people.buyer.id, e.orderId], ['STATUS_CHANGE', people.approver.id, e.orderId], ['STATUS_CHANGE', people.buyer.id, e.orderId], ['CREATE_RECEIPT', people.receiver.id, e.orderId]]);
  assert.deepEqual(f.audits.slice(0, e.before.audits.length), e.before.audits);
  assert.deepEqual(e.readbacks.map(r => r.instance), [0, 1]);
  for (const r of e.readbacks) { assert.equal(Number(r.purchaseOrder.id), e.orderId); assert.equal(r.purchaseOrder.revision, 1); assert.equal(r.purchaseOrder.quantity, 12); assert.equal(r.purchaseOrder.status, 'in_transit');
    assert.deepEqual(r.receiptSummary, { orderedQuantity: 12, processedQuantity: 5, acceptedQuantity: 5, rejectedQuantity: 0, remainingQuantity: 7, receiptCount: 1 }); assert.equal(r.receipts.length, 1); assert.equal(Number(r.receipts[0].id), receipt.id); assert.equal(r.receipts[0].batchNo, e.batchNo); }
  assert.deepEqual(e.browser.map(b => b.job), Object.keys(jobs));
  for (const b of e.browser) { assert.equal(b.actorId, people[b.job].id); assert.equal(b.role, people[b.job].role); assert.equal(b.orderId, e.orderId); assert.equal(b.instance, 1); assert.equal(b.approveVisible, b.job === 'approver'); assert.equal(b.receiveEnabled, b.job === 'receiver'); assert.equal(b.batchReadback, e.batchNo); assert.equal(b.acceptedReadback, '合格 5kg'); assert.deepEqual(b.errors, []); assert(b.permissionScreenshot && b.receiptScreenshot); }
  for (const b of e.browser) {
    assert.equal(b.purchaseNotice, b.job === 'buyer' ? null : '当前角色不能新增或修改采购单；审批与收货按对应操作权限控制。');
    assert.equal(b.receiptNotice, b.job === 'receiver' ? null : '当前角色只能查看收货批次，保存收货需要采购收货登记权限。');
  }
  return { actors: 3, deniedWrites: 26, browserWrites: 4, receivedQuantity: 5, remainingQuantity: 7, receivedCost: 50 };
}
module.exports = { purchaseRevisionProbe, verifyPurchaseRoleProof };
