const { ensureReleasedMaterial } = require('./material-audit-fixture.cjs');
const { synchronizedBurst } = require('./enterprise-round2-runner.cjs');

async function purchaseReceiptSubmissionProbe({ request, dataOf, actors, prisma, runId, verify, material, supplier }, signal) {
  const create = async quantity => dataOf(await request('/procurement/orders', { actor: actors.buyer1, method: 'POST', signal,
    data: { supplierId: Number(supplier.id), materialId: material.id, item: material.nameZh, quantity, price: 10,
      unit: 'kg', eta: '2026-10-01', status: 'approved' } }));
  const original = await create(2), id = Number(original.id), key = `${runId}-durable-receipt`;
  const facts = { quantity: 1, acceptedQuantity: 1, rejectedQuantity: 0, batchNo: `${runId}-durable-batch`, note: 'One physical delivery, one immutable receipt' };
  const post = async (actor, instance, requestKey, data) => ({ ...await request(`/procurement/orders/${id}/receipts`, { actor, instance, method: 'POST', signal,
    headers: requestKey ? { 'Idempotency-Key': requestKey } : {}, data }), purchaseOrderId: id, actorId: actor.id, instance, method: 'POST', requestKey: requestKey || null, requestBody: data });
  const batchNames = [`${runId}-durable-batch`, `${runId}-remaining-batch`, `${runId}-audit-fault-batch`];
  const snapshot = async poId => {
    const receipts = await prisma.purchaseReceipt.findMany({ where: { purchaseOrderId: poId }, orderBy: { id: 'asc' } });
    const entries = await prisma.stockEntry.findMany({ where: { sourceType: 'procurement_receipt', sourceRef: { startsWith: `PO-${poId}-RCV-` } }, include: { movements: true }, orderBy: { id: 'asc' } });
    const batches = await prisma.productBatch.findMany({ where: { batchNo: { in: batchNames } }, orderBy: { id: 'asc' } });
    return { order: await prisma.purchaseOrder.findUnique({ where: { id: poId } }), receipts, entries,
      batches, balances: await prisma.stockBalance.findMany({ where: { batchNo: { in: batchNames } }, orderBy: { id: 'asc' } }),
      costs: await prisma.inventoryCostLedger.findMany({ where: { OR: [{ sourceRef: { in: entries.map(e => e.entryNo) } }, { batchId: { in: batches.map(b => b.id) } }] }, orderBy: { id: 'asc' } }),
      audits: await prisma.auditLog.findMany({ where: { resource: 'purchase_order', resourceId: poId }, orderBy: { id: 'asc' } }) };
  };
  const before = await snapshot(id), missingKey = await post(actors.buyer1, 0, null, facts), afterMissing = await snapshot(id);
  // A duplicated intent is deliberately the same authenticated receiver on two
  // nodes, not two invented workforce identities. Rendezvous before dispatch.
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const queued = [0, 1].map(async instance => { await barrier; return post(actors.buyer1, instance, key, facts); });
  release();
  const concurrent = await Promise.all(queued);
  const committed = await snapshot(id), receipt = concurrent.map(r => dataOf(r))[0].submission;
  const changed = await post(actors.buyer1, 1, key, { ...facts, quantity: 0.5, acceptedQuantity: 0.5 });
  const differentActor = await post(actors.buyer2, 0, key, facts), afterConflicts = await snapshot(id);
  dataOf(await post(actors.buyer1, 1, `${runId}-remaining-receipt`, { ...facts, batchNo: `${runId}-remaining-batch` }));
  const full = await snapshot(id), replay = await post(actors.buyer1, 0, key, facts), afterReplay = await snapshot(id);
  const blockedOrder = await create(1), faultId = Number(blockedOrder.id), faultBefore = await snapshot(faultId);
  const faultName = `receipt_audit_fault_${faultId}`, pg = process.env.AUDIT_PRISMA_PROVIDER === 'postgresql';
  const readFault = () => pg
    ? prisma.$queryRawUnsafe('SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal', faultName)
    : prisma.$queryRawUnsafe("SELECT sql AS definition FROM sqlite_master WHERE type = 'trigger' AND name = ?", faultName);
  const readFaultFunction = () => pg ? prisma.$queryRawUnsafe('SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname = $1 AND pronargs = 0', faultName) : Promise.resolve([]);
  const faultInjection = { name: faultName, targetAction: 'CREATE_RECEIPT', purchaseOrderId: faultId, before: await readFault(), beforeFunctions: await readFaultFunction() };
  let auditFailure;
  // Fault injection is scoped to this synthetic PO and removed in finally. It
  // demonstrates database rollback, not a mocked audit call or a status-only check.
  try {
    if (pg) {
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ${faultName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic receipt audit unavailable'; END; $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ${faultName} BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action = 'CREATE_RECEIPT' AND NEW.resource = 'purchase_order' AND NEW.resource_id = ${faultId}) EXECUTE FUNCTION ${faultName}()`);
    } else await prisma.$executeRawUnsafe(`CREATE TRIGGER ${faultName} BEFORE INSERT ON audit_logs WHEN NEW.action = 'CREATE_RECEIPT' AND NEW.resource = 'purchase_order' AND NEW.resource_id = ${faultId} BEGIN SELECT RAISE(ABORT, 'Synthetic receipt audit unavailable'); END`);
    faultInjection.installed = await readFault();
    faultInjection.installedFunctions = await readFaultFunction();
    const requestBody = { quantity: 1, batchNo: `${runId}-audit-fault-batch` }, requestKey = `${runId}-audit-rollback`;
    auditFailure = { ...await request(`/procurement/orders/${faultId}/receipts`, { actor: actors.buyer1, instance: 1, method: 'POST', signal,
      headers: { 'Idempotency-Key': requestKey }, data: requestBody }), purchaseOrderId: faultId, actorId: actors.buyer1.id, instance: 1, method: 'POST', requestKey, requestBody };
  } finally {
    await prisma.$executeRawUnsafe(pg ? `DROP TRIGGER IF EXISTS ${faultName} ON audit_logs` : `DROP TRIGGER IF EXISTS ${faultName}`);
    if (pg) await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${faultName}()`);
  }
  faultInjection.removed = await readFault();
  faultInjection.removedFunctions = await readFaultFunction();
  const faultAfter = await snapshot(faultId);
  const orphanFaultBatch = await prisma.productBatch.findUnique({ where: { batchNo: `${runId}-audit-fault-batch` } });
  const requirements = {
    missing_identity_rejected_without_effect: missingKey.status === 400 && missingKey.json.errorCode === 'PURCHASE_RECEIPT_KEY_REQUIRED' && JSON.stringify(before) === JSON.stringify(afterMissing),
    two_nodes_one_owner_one_acknowledgement: concurrent.every(r => r.status === 201) && concurrent.map(r => r.json.data.replayed).filter(Boolean).length === 1
      && concurrent.every(r => JSON.stringify(r.json.data.submission) === JSON.stringify(receipt)) && committed.receipts.length === 1 && committed.entries.length === 1 && committed.costs.length === 1,
    committed_identity_and_audit_bound: committed.receipts[0]?.submissionKey === key && committed.receipts[0]?.submissionFingerprint === receipt.fingerprint
      && committed.receipts[0]?.submissionJson === JSON.stringify(receipt) && receipt.receipt.receivedBy === actors.buyer1.id
      && committed.audits.filter(a => a.action === 'CREATE_RECEIPT').length === 1 && committed.audits.some(a => a.id === receipt.auditId),
    changed_facts_and_actor_do_not_rebook: changed.status === 409 && differentActor.status === 409 && JSON.stringify(committed) === JSON.stringify(afterConflicts),
    full_order_returns_original_receipt_not_a_new_posting: full.order.status === 'received' && replay.status === 201 && replay.json.data.replayed === true
      && JSON.stringify(replay.json.data.submission) === JSON.stringify(receipt) && replay.json.data.receiptSummary.remainingQuantity === 0 && JSON.stringify(full) === JSON.stringify(afterReplay),
    failed_audit_rolls_back_receipt_stock_cost_status: auditFailure.status === 500 && JSON.stringify(faultBefore) === JSON.stringify(faultAfter) && orphanFaultBatch === null,
  };
  const evidence = verify(requirements, { version: 'purchase-receipt-submission/v1', original, before, missingKey, afterMissing, concurrent, committed,
    changed, differentActor, afterConflicts, full, replay, afterReplay, faultBefore, auditFailure, faultAfter, orphanFaultBatch,
    faultInjection, scope: 'Real two-node durable receipt and atomic audit rollback; not incoming QA, supplier AP/payment or a database restart', provider: pg ? 'postgresql' : 'sqlite' });
  require('./enterprise-round2-purchase-receipt-proof.cjs').verifyPurchaseReceiptSubmissionProof(evidence);
  return evidence;
}

async function purchaseGovernanceProbe({ request, dataOf, actors, prisma, runId, verify, material, supplier }, signal) {
  const terms = { taxTreatment: 'none_or_third_party', supplierTaxAmount: 0, supplierChargesAmount: 3, evidenceRef: `${runId}-supplier-quote` };
  const plan = { specificationRef: `${runId}-incoming-spec`, specificationRevision: 'R1', characteristics: [
    { code: 'PH', name: 'pH', valueType: 'numeric', lowerLimit: '7.0', upperLimit: '8.0', testMethod: 'Calibrated meter', required: true },
  ] };
  const created = dataOf(await request('/procurement/orders', { actor: actors.buyer1, method: 'POST', signal,
    data: { supplierId: Number(supplier.id), materialId: material.id, item: material.nameZh, quantity: 1, price: 10, otherCost: 7,
      unit: 'kg', eta: '2026-10-01', status: 'approved', supplierPayableTerms: terms, incomingQualityPlan: plan } }));
  const id = Number(created.id), amendedPlan = { ...plan, specificationRevision: 'R2', characteristics: [{ ...plan.characteristics[0], upperLimit: '7.9' }] };
  const revision = dataOf(await request(`/procurement/orders/${id}`, { actor: actors.buyer1, method: 'PATCH', signal,
    data: { expectedRevision: created.revision, expectedUpdatedAt: created.updatedAt, quantity: 1, price: 10, taxAmount: 0,
      eta: '2026-10-01', reason: 'Supplier confirmed incoming standard revision', supplierPayableTerms: terms, incomingQualityPlan: amendedPlan } }));
  const staleApproval = await request(`/procurement/orders/${id}/status`, { actor: actors.buyer2, instance: 1, method: 'PATCH', signal, data: { status: 'approved', expectedRevision: 0 } });
  const apiReadbacks = await Promise.all([0, 1].map(async instance => dataOf(await request(`/procurement/orders/${id}/revisions`, { actor: actors.buyer2, instance, signal }))));
  const approved = dataOf(await request(`/procurement/orders/${id}/status`, { actor: actors.buyer2, instance: 1, method: 'PATCH', signal, data: { status: 'approved', expectedRevision: 1 } }));
  const receive = await request(`/procurement/orders/${id}/receipts`, { actor: actors.buyer1, method: 'POST', signal,
    headers: { 'Idempotency-Key': `${runId}-source-receipt` },
    data: { quantity: 1, acceptedQuantity: 1, rejectedQuantity: 0, batchNo: `${runId}-governed-source` } });
  const snapshot = async () => ({ order: await prisma.purchaseOrder.findUnique({ where: { id } }),
    receipts: await prisma.purchaseReceipt.findMany({ where: { purchaseOrderId: id }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { resource: 'purchase_order', resourceId: id }, orderBy: { id: 'asc' } }) });
  const beforeBlocked = await snapshot();
  const denied = await request(`/procurement/orders/${id}`, { actor: actors.buyer1, instance: 1, method: 'PATCH', signal,
    data: { expectedRevision: 1, expectedUpdatedAt: beforeBlocked.order.updatedAt.toISOString(), quantity: 1, price: 10, taxAmount: 0,
      eta: '2026-10-01', reason: 'Cannot replace standards after physical receipt', supplierPayableTerms: terms, incomingQualityPlan: plan } });
  const afterBlocked = await snapshot();
  const basis0 = JSON.parse(created.supplierPayableBasisJson), basis1 = JSON.parse(revision.supplierPayableBasisJson);
  const plan0 = JSON.parse(created.incomingQualityPlanJson), plan1 = JSON.parse(revision.incomingQualityPlanJson);
  return verify({
    frozen_server_amount_not_inventory_cost: basis0.amountNative === 13 && basis0.amountBase === 13 && created.landedCostAmount === 17
      && basis0.binding.revision === 0 && basis0.binding.supplierId === Number(supplier.id) && basis0.binding.materialId === material.id,
    only_standard_changed_creates_pending_revision: revision.revision === 1 && revision.status === 'pending' && revision.quantity === created.quantity && revision.price === created.price
      && basis1.binding.revision === 1 && plan1.binding.revision === 1 && plan0.plan.characteristics[0].upperLimit === '8' && plan1.plan.characteristics[0].upperLimit === '7.9',
    stale_approval_denied_and_both_nodes_agree: staleApproval.status === 409 && apiReadbacks.every(r => r.purchaseOrder.incomingQualityPlanJson === revision.incomingQualityPlanJson
      && r.purchaseOrder.supplierPayableBasisJson === revision.supplierPayableBasisJson),
    independent_approval_preserves_sources: approved.revision === 1 && approved.incomingQualityPlanJson === revision.incomingQualityPlanJson && receive.status === 201,
    received_sources_immutable_without_side_effects: denied.status === 409 && JSON.stringify(beforeBlocked) === JSON.stringify(afterBlocked),
  }, { version: 'purchase-governance-binding/v1', created, revision, staleApproval, apiReadbacks, approved, receive, denied, beforeBlocked, afterBlocked,
    scope: 'Frozen PO sources and actual post-receipt no-change guard, not a claim of CAS rollback, live incoming inspection/AP/payment gates or least-privilege workforce proof' });
}

async function purchaseReceiptCostProbe({ request, dataOf, actors, prisma, runId, verify, material, supplier }, signal) {
  const original = dataOf(await request('/procurement/orders', { actor: actors.buyer1, method: 'POST', signal,
    data: { supplierId: Number(supplier.id), materialId: material.id, item: material.nameZh, quantity: 3, price: 1 / 3,
      unit: 'kg', eta: '2026-10-01', currency: 'CNY', status: 'approved' } }));
  const id = Number(original.id), batchNo = `${runId}-fractional-receipt`;
  const receive = async (actor, instance, index) => {
    const result = await request(`/procurement/orders/${id}/receipts`, { actor, instance, method: 'POST', signal,
      headers: { 'Idempotency-Key': `${runId}-fractional-${index}` },
      data: { quantity: 0.5, acceptedQuantity: 0.5, rejectedQuantity: 0, batchNo } });
    return { actorId: actor.id, instance, status: result.status, body: result.json };
  };
  const responses = [];
  for (let index = 0; index < 4; index++) responses.push(await receive(actors.buyer1, index % 2, index));
  responses.push(...await synchronizedBurst([actors.buyer1, actors.buyer2], actor =>
    receive(actor, actor.id === actors.buyer1.id ? 0 : 1, actor.id === actors.buyer1.id ? 4 : 5), signal));
  const order = await prisma.purchaseOrder.findUnique({ where: { id } });
  const receipts = await prisma.purchaseReceipt.findMany({ where: { purchaseOrderId: id }, orderBy: { id: 'asc' } });
  const entries = await prisma.stockEntry.findMany({ where: { sourceType: 'procurement_receipt', sourceRef: { startsWith: `PO-${id}-RCV-` } },
    include: { movements: true }, orderBy: { id: 'asc' } });
  const ledgers = await prisma.inventoryCostLedger.findMany({ where: { sourceRef: { in: entries.map(e => e.entryNo) } }, orderBy: { id: 'asc' } });
  const batch = await prisma.productBatch.findUnique({ where: { batchNo } });
  const audits = await prisma.auditLog.findMany({ where: { resource: 'purchase_order', resourceId: id, action: 'CREATE_RECEIPT' }, orderBy: { id: 'asc' } });
  const apiReadbacks = await Promise.all([0, 1].map(async instance => dataOf(await request(`/procurement/orders/${id}/receipts`, { actor: actors.buyer2, instance, signal }))));
  const evidence = { version: 'purchase-receipt-cost/v1', original, responses, order, receipts, entries, ledgers, batch, audits, apiReadbacks,
    scope: 'Actual immutable cost history and concurrent fractional receipts; not incoming QC, supplier AP or durable receipt replay' };
  return verify({
    six_real_receipts: responses.length === 6 && responses.every(r => r.status === 201) && receipts.length === 6
      && receipts.every(r => r.quantity === 0.5 && r.acceptedQuantity === 0.5 && r.rejectedQuantity === 0),
    one_voucher_and_cost_per_receipt: entries.length === 6 && ledgers.length === 6
      && entries.every(e => e.status === 'posted' && e.movements.length === 1 && e.movements[0].quantityDelta === 0.5
        && e.movements[0].materialId === material.id && e.movements[0].batchNo === batchNo && e.movements[0].unit === 'kg'
        && receipts.filter(r => r.stockEntryRef === e.sourceRef).length === 1
        && ledgers.filter(l => l.sourceRef === e.entryNo && l.batchId === batch?.id && l.sourceType === 'inventory_adjustment' && l.quantityDelta === 0.5).length === 1),
    no_split_rounding_drift: JSON.stringify(ledgers.map(l => l.costAmountDelta)) === JSON.stringify([0.17, 0.16, 0.17, 0.17, 0.16, 0.17])
      && ledgers.reduce((sum, l) => sum + Math.round(l.costAmountDelta * 100), 0) === 100,
    physical_quantity_and_original_value_unchanged: batch?.stockQuantity === 3 && batch.unit === 'kg'
      && order.quantity === original.quantity && order.price === original.price && order.landedCostAmount === 1 && order.status === 'received',
    six_receipt_audits: audits.length === 6,
    both_nodes_read_same_receipts: apiReadbacks.every(r => r.receipts.length === 6 && r.receiptSummary.acceptedQuantity === 3 && r.receiptSummary.remainingQuantity === 0),
  }, evidence);
}

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
    headers: { 'Idempotency-Key': `${runId}-unapproved-receipt` },
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
    headers: { 'Idempotency-Key': `${runId}-revised-receipt` },
    data: { quantity: 1, acceptedQuantity: 1, rejectedQuantity: 0, batchNo: `${runId}-po-received` } }));
  const received = await snapshot();
  const receiptEdit = await request(`/procurement/orders/${id}`, { actor: actors.buyer1, instance: 1, method: 'PATCH', signal,
    data: { ...terms[0], quantity: 999, expectedRevision: received.order.revision, expectedUpdatedAt: received.order.updatedAt.toISOString() } });
  requirements.received_order_cannot_be_rewritten = receiptEdit.status === 409 && JSON.stringify(await snapshot()) === JSON.stringify(received);
  const receiptCost = await purchaseReceiptCostProbe({ request, dataOf, actors, prisma, runId, verify, material, supplier }, signal);
  const governance = await purchaseGovernanceProbe({ request, dataOf, actors, prisma, runId, verify, material, supplier }, signal);
  const receiptSubmission = await purchaseReceiptSubmissionProbe({ request, dataOf, actors, prisma, runId, verify, material, supplier }, signal);
  return verify(requirements, { ...evidence, apiReadbacks, approved, received, receiptCost, governance, receiptSubmission, statuses: { replay: replay.status, staleApproval: staleApproval.status,
    unversionedApproval: unversionedApproval.status, pendingReceipt: pendingReceipt.status, deniedEdit: deniedEdit.status, receiptEdit: receiptEdit.status } });
}

function verifyPurchaseRoleProof(e) {
  const assert = require('node:assert/strict');
  assert.equal(e.version, 'purchase-role-browser/v1'); assert.equal(e.status, 'passed');
  assert.deepEqual(e.receiptLoadingGuard, { inputsDisabled: 6, saveDisabled: true });
  assert.deepEqual(e.writes.find(w => w.operation === '/receipts')?.request,
    { quantity: 5, acceptedQuantity: 5, rejectedQuantity: 0, batchNo: e.batchNo });
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
