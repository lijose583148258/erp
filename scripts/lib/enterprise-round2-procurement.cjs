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

module.exports = { purchaseRevisionProbe };
