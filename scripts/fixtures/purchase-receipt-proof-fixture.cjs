// Explicitly synthetic verifier inputs. Never runner/business evidence and never
// copied from output/, cloud artifacts, or a real database.
const { createHash } = require('node:crypto');
const { purchaseRoleProofFixture } = require('./purchase-role-proof-fixture.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const date = '2026-10-14T00:00:00.000Z';
function identity(r, key, body) {
  const fingerprint = hash(JSON.stringify({ schema: 'purchase-receipt-facts/v1', purchaseOrderId: r.purchaseOrderId, receivedBy: r.receivedBy,
    quantity: body.quantity, acceptedQuantity: body.acceptedQuantity ?? body.quantity, rejectedQuantity: body.rejectedQuantity ?? 0,
    batchNo: body.batchNo ?? null, receivedAt: null, discrepancyReason: body.discrepancyReason ?? null,
    discrepancyType: 'short_shipped', note: body.note ?? null }));
  const submission = { schema: 'purchase-receipt-submission/v1', key, fingerprint, auditId: 50 + r.id, receipt: r };
  const audit = { id: submission.auditId, userId: r.receivedBy, action: 'CREATE_RECEIPT', resource: 'purchase_order', resourceId: r.purchaseOrderId,
    details: JSON.stringify({ schema: 'purchase-receipt-audit/v1', receiptId: r.id, receiptNo: r.receiptNo,
      submissionKeyHash: hash(key), fingerprint, receiptHash: hash(JSON.stringify(r)) }) };
  return { submission, audit, raw: { ...r, submissionKey: key, submissionFingerprint: fingerprint, submissionJson: JSON.stringify(submission) } };
}
function bundle(snapshot) {
  const order = snapshot.order || snapshot.orders[0], fields = ['id', 'receiptNo', 'purchaseOrderId', 'quantity', 'acceptedQuantity', 'rejectedQuantity', 'unit',
    'batchNo', 'stockEntryRef', 'discrepancyReason', 'note', 'receivedBy', 'receivedAt', 'createdAt'];
  const processed = snapshot.receipts.reduce((sum, r) => sum + r.quantity, 0), accepted = snapshot.receipts.reduce((sum, r) => sum + r.acceptedQuantity, 0);
  return { purchaseOrder: copy(order), receipts: snapshot.receipts.map(r => Object.fromEntries(fields.map(f => [f, r[f]]))), discrepancyCases: [], discrepancyCase: null,
    receiptSummary: { orderedQuantity: order.quantity, processedQuantity: processed, acceptedQuantity: accepted,
      rejectedQuantity: processed - accepted, remainingQuantity: order.quantity - processed, receiptCount: snapshot.receipts.length } };
}
function purchaseReceiptSubmissionProofFixture(provider = 'sqlite') {
  const order = { id: 11, materialId: 9, quantity: 2, price: 10, currency: 'CNY', exchangeRate: 1, unit: 'kg', landedCostAmount: 20,
    revision: 0, status: 'approved', updatedAt: date };
  const firstBody = { quantity: 1, acceptedQuantity: 1, rejectedQuantity: 0, batchNo: 'synthetic-first', note: 'One synthetic physical receipt' };
  const secondBody = { ...firstBody, batchNo: 'synthetic-remaining' };
  const firstKey = 'synthetic-receipt-first', secondKey = 'synthetic-receipt-remaining';
  function record(n, key, body) {
    const r = { id: n, receiptNo: `PRC-synthetic-${n}`, purchaseOrderId: 11, quantity: 1, acceptedQuantity: 1, rejectedQuantity: 0,
      unit: 'kg', batchNo: body.batchNo, stockEntryRef: `PO-11-RCV-PRC-synthetic-${n}`, discrepancyReason: null, note: body.note,
      receivedBy: 10, receivedAt: date, createdAt: date };
    const bound = identity(r, key, body);
    const movement = { id: 30 + n, entryId: 40 + n, stockBalanceId: 10 + n, materialId: 9, batchNo: r.batchNo, unit: 'kg', quantityBefore: 0, quantityDelta: 1, quantityAfter: 1 };
    return { ...bound, entry: { id: 40 + n, entryNo: `STK-synthetic-${n}`, sourceType: 'procurement_receipt', sourceRef: r.stockEntryRef,
      createdBy: 10, status: 'posted', movements: [movement] },
    batch: { id: 20 + n, materialId: 9, batchNo: r.batchNo, stockQuantity: 1, unit: 'kg' },
    balance: { id: 10 + n, materialId: 9, batchNo: r.batchNo, unit: 'kg', quantity: 1 },
    cost: { id: 60 + n, batchId: 20 + n, sourceRef: `STK-synthetic-${n}`, sourceType: 'inventory_adjustment', createdBy: 10,
      quantityBefore: 0, quantityDelta: 1, quantityAfter: 1, costBefore: 0, costAmountDelta: 10, costAfter: 10 } };
  }
  const first = record(1, firstKey, firstBody), second = record(2, secondKey, secondBody);
  const initialAudit = { id: 1, userId: 10, action: 'CREATE', resource: 'purchase_order', resourceId: 11 };
  const before = { order, receipts: [], entries: [], batches: [], balances: [], costs: [], audits: [initialAudit] };
  const committed = { order: { ...order, status: 'in_transit', updatedAt: '2026-10-14T00:00:01.000Z' }, receipts: [first.raw], entries: [first.entry],
    batches: [first.batch], balances: [first.balance], costs: [first.cost], audits: [initialAudit, first.audit] };
  const full = { order: { ...order, status: 'received', updatedAt: '2026-10-14T00:00:02.000Z' }, receipts: [first.raw, second.raw], entries: [first.entry, second.entry],
    batches: [first.batch, second.batch], balances: [first.balance, second.balance], costs: [first.cost, second.cost], audits: [initialAudit, first.audit, second.audit] };
  const metadata = (actorId, instance, requestKey, requestBody, purchaseOrderId = 11) => ({ actorId, instance, method: 'POST', requestKey, requestBody, purchaseOrderId });
  const success = (instance, replayed, snapshot) => ({ status: 201, ...metadata(10, instance, firstKey, firstBody),
    json: { success: true, data: { ...bundle(snapshot), submission: first.submission, replayed } } });
  const faultBefore = { order: { ...order, id: 12, quantity: 1, landedCostAmount: 10 }, receipts: [], entries: [],
    batches: full.batches, balances: full.balances, costs: full.costs, audits: [{ ...initialAudit, id: 2, resourceId: 12 }] };
  const faultName = 'receipt_audit_fault_12', pg = provider === 'postgresql';
  const definition = pg
    ? `CREATE TRIGGER ${faultName} BEFORE INSERT ON public.audit_logs FOR EACH ROW WHEN (((new.action = 'CREATE_RECEIPT'::text) AND (new.resource = 'purchase_order'::text) AND (new.resource_id = 12))) EXECUTE FUNCTION ${faultName}()`
    : `CREATE TRIGGER ${faultName} BEFORE INSERT ON audit_logs WHEN NEW.action = 'CREATE_RECEIPT' AND NEW.resource = 'purchase_order' AND NEW.resource_id = 12 BEGIN SELECT RAISE(ABORT, 'Synthetic receipt audit unavailable'); END`;
  const faultInjection = { name: faultName, targetAction: 'CREATE_RECEIPT', purchaseOrderId: 12, before: [], installed: [{ definition }], removed: [],
    beforeFunctions: [], installedFunctions: pg ? [{ definition: `CREATE OR REPLACE FUNCTION public.${faultName}() RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN RAISE EXCEPTION 'Synthetic receipt audit unavailable'; END; $function$` }] : [], removedFunctions: [] };
  return copy({ synthetic: true, version: 'purchase-receipt-submission/v1', provider, original: order, before, afterMissing: before,
    missingKey: { status: 400, ...metadata(10, 0, null, firstBody), json: { success: false, errorCode: 'PURCHASE_RECEIPT_KEY_REQUIRED' } },
    concurrent: [success(0, false, committed), success(1, true, committed)], committed,
    changed: { status: 409, ...metadata(10, 1, firstKey, { ...firstBody, quantity: 0.5, acceptedQuantity: 0.5 }), json: { success: false, errorCode: 'PURCHASE_RECEIPT_KEY_CONFLICT' } },
    differentActor: { status: 409, ...metadata(20, 0, firstKey, firstBody), json: { success: false, errorCode: 'PURCHASE_RECEIPT_KEY_CONFLICT' } },
    afterConflicts: committed, full, replay: success(0, true, full), afterReplay: full, faultBefore, faultAfter: faultBefore, orphanFaultBatch: null, faultInjection,
    auditFailure: { status: 500, ...metadata(10, 1, 'synthetic-audit-rollback', { quantity: 1, batchNo: 'synthetic-fault-batch' }, 12), json: { success: false, errorCode: 'PURCHASE_RECEIPT_INTERNAL_ERROR' } } });
}
function purchaseReceiptRecoveryProofFixture() {
  const e = purchaseRoleProofFixture(), raw = e.final.receipts[0], body = e.writes[3].request, key = 'synthetic-recovery-key';
  const r = { id: raw.id, receiptNo: 'PRC-test', purchaseOrderId: raw.purchaseOrderId, quantity: raw.quantity, acceptedQuantity: raw.acceptedQuantity,
    rejectedQuantity: raw.rejectedQuantity, unit: 'kg', batchNo: raw.batchNo, stockEntryRef: raw.stockEntryRef, discrepancyReason: null, note: null,
    receivedBy: raw.receivedBy, receivedAt: date, createdAt: date };
  const bound = identity(r, key, body); bound.audit.id = 5; bound.submission.auditId = 5; bound.raw.submissionJson = JSON.stringify(bound.submission);
  e.final.receipts = [bound.raw]; e.final.audits[4] = bound.audit;
  Object.assign(e.final.movements[0], { id: 1, materialId: 1, batchNo: e.batchNo, unit: 'kg' });
  Object.assign(e.final.costs[0], { id: 1, sourceType: 'inventory_adjustment' });
  const data = { ...bundle(e.final), submission: bound.submission }, firstRequest = { instance: 1, method: 'POST', requestKey: key, body };
  const intent = { schema: 'purchase-receipt-intent/v1', userId: '12', orderId: '1', key,
    facts: { quantity: 5, acceptedQuantity: 5, rejectedQuantity: 0, batchNo: e.batchNo, discrepancyReason: '', note: '' } };
  const beforeOwner = { orders: e.final.orders, receipts: [], entries: [], movements: [], batches: [], balances: [], costs: [], audits: e.final.audits.slice(0, 4) };
  const ownerResponse = { status: 201, body: { success: true, data: { ...data, replayed: false } } };
  const replayResponse = { status: 201, body: { success: true, data: { ...data, replayed: true } } };
  e.writes[3].requestKey = key; e.writes[3].response = replayResponse.body;
  e.readbacks = [0, 1].map(instance => ({ instance, ...bundle(e.final) }));
  e.receiptRecovery = { version: 'purchase-receipt-browser-recovery/v1', status: 'passed', actorId: 12, orderId: 1,
    storageSlot: 'ailaoda.purchase-receipt-intent/v1.12.1', firstRequest, replayRequest: firstRequest, ownerResponse, replayResponse,
    persistedBeforeRefresh: JSON.stringify(intent), persistedAfterRefresh: JSON.stringify(intent), intent, refreshed: true, refreshDialogs: [],
    refreshGuard: { inputsDisabled: 6, retryEnabled: true }, restoredValues: ['5', '5', '0', e.batchNo, '', ''],
    beforeOwner, afterOwner: e.final, beforeReplay: e.final, afterReplay: e.final, storageAfterReplay: null, mutableRemainingQuantity: 7,
    unknownScreenshot: 'synthetic-unknown.png', refreshedScreenshot: 'synthetic-refreshed.png', confirmedScreenshot: 'synthetic-confirmed.png' };
  return copy({ ...e, synthetic: true });
}
// Explicitly synthetic V2 contracts for the independent reader. They are not
// an upgrade of any real/cloud evidence; runner producers must collect V2 facts.
function controlledSnapshot(snapshot) {
  const s = copy(snapshot), order = s.order || s.orders[0];
  const binding = { revision: order.revision, supplierId: 2, materialId: order.materialId, unit: order.unit,
    quantity: order.quantity, price: order.price, currency: order.currency || 'CNY', exchangeRate: order.exchangeRate || 1 };
  const total = Number((binding.quantity * binding.price).toFixed(2));
  const basis = { schema: 'supplier-payable-basis/v1', binding, terms: { taxTreatment: 'none_or_third_party', supplierTaxAmount: 0,
    supplierChargesAmount: 0, evidenceRef: `Synthetic explicit quote ${order.id}` }, goodsAmountNative: total, amountNative: total, amountBase: total,
    baseCurrency: 'CNY', rateDirection: 'foreign_per_CNY' };
  const quality = { schema: 'purchase-incoming-quality/v1', binding, plan: { specificationRef: `Synthetic explicit specification ${order.id}`,
    specificationRevision: 'R1', characteristics: [{ code:'PH', name:'pH', valueType:'numeric', unit:null, lowerLimit:'7', upperLimit:'8',
      targetText:null, testMethod:'Synthetic calibrated meter', required:true, sortOrder:0 }] } };
  const supplierPayableBasisJson = JSON.stringify(basis), incomingQualityPlanJson = JSON.stringify(quality);
  const meta = { revision: binding.revision, supplierPayableHash: hash(supplierPayableBasisJson), incomingQualityHash: hash(incomingQualityPlanJson), restoreOperationalStatus:null };
  Object.assign(order, { supplierId:2, currency:binding.currency, exchangeRate:binding.exchangeRate, supplierPayableBasisJson, incomingQualityPlanJson });
  const source = { id:1, userId:10, action:binding.revision === 0 ? 'CREATE' : 'REVISE', resource:'purchase_order', resourceId:order.id,
    details: JSON.stringify({ schema:binding.revision === 0 ? 'purchase-create/v1' : 'purchase-revision/v1', after:{ ...order, status:'pending', updatedAt:date }, source:meta }) };
  const approval = { id:2, userId:20, action:'STATUS_CHANGE', resource:'purchase_order', resourceId:order.id,
    details:JSON.stringify({ schema:'purchase-status/v2', revision:binding.revision, from:'pending', to:'approved', isSourceApproval:true,
      sourceAuditId:1, supplierPayableHash:meta.supplierPayableHash, incomingQualityHash:meta.incomingQualityHash }) };
  s.audits = [source, approval, ...s.audits.filter(a => a.id > 2)];
  let received = 0, posted = 0;
  for (const raw of s.receipts) {
    const original = JSON.parse(raw.submissionJson), supplierBatchNo = raw.batchNo;
    const batch = s.batches.find(b => b.batchNo === supplierBatchNo);
    const ref = raw.stockEntryRef;
    batch.batchNo = ref; batch.qualityStatus = 'hold';
    for (const balance of s.balances.filter(b => b.batchNo === supplierBatchNo)) balance.batchNo = ref;
    for (const entry of s.entries) for (const movement of entry.movements || []) if (movement.batchNo === supplierBatchNo) movement.batchNo = ref;
    for (const movement of s.movements || []) if (movement.batchNo === supplierBatchNo) movement.batchNo = ref;
    const after = received + raw.acceptedQuantity, target = Number((total * after / binding.quantity).toFixed(2)), amount = (target - posted).toFixed(2);
    const payable = { schema:'purchase-receipt-payable/v1', allocationPolicy:'cumulative_received_target_less_actual_posted/v1', purchaseOrderId:order.id,
      receiptNo:raw.receiptNo, supplierBatchNo, batchNo:ref, receivedBy:raw.receivedBy, binding, source:{ sourceAuditId:1, approvalAuditId:2, supplierPayableBasisJson },
      allocation:{ receivedQuantity:String(raw.acceptedQuantity), receivedQuantityBefore:String(received), receivedQuantityAfter:String(after),
        postedAmountNativeBefore:posted.toFixed(2), postedAmountBaseBefore:posted.toFixed(2), targetAmountNative:target.toFixed(2), targetAmountBase:target.toFixed(2), amountNative:amount, amountBase:amount },
      currency:binding.currency, baseCurrency:'CNY', rateDirection:'foreign_per_CNY' };
    const r = { ...original.receipt, batchNo:ref, supplierBatchNo, batchId:batch.id, payableAmountNative:amount, payableAmountBase:amount,
      payableSnapshotJson:JSON.stringify(payable), incomingQualityPlanJson };
    const facts = { purchaseOrderId:r.purchaseOrderId, receivedBy:r.receivedBy, quantity:r.quantity, acceptedQuantity:r.acceptedQuantity,
      rejectedQuantity:r.rejectedQuantity, batchNo:supplierBatchNo, receivedAt:null, discrepancyReason:r.discrepancyReason,
      discrepancyType:'short_shipped', note:r.note, expectedRevision:binding.revision };
    const fingerprint = hash(JSON.stringify({ schema:'purchase-receipt-facts/v2', ...facts }));
    const ack = { schema:'purchase-receipt-submission/v2', key:original.key, fingerprint, auditId:original.auditId, facts, receipt:r };
    Object.assign(raw, r, { submissionFingerprint:fingerprint, submissionJson:JSON.stringify(ack) });
    const audit = s.audits.find(a => a.id === original.auditId); audit.details = JSON.stringify({ schema:'purchase-receipt-audit/v2', receiptId:r.id, receiptNo:r.receiptNo,
      submissionKeyHash:hash(ack.key), fingerprint, receiptHash:hash(JSON.stringify(r)) });
    received = after; posted = target;
  }
  return s;
}
function controlledBundle(snapshot) {
  const b = bundle(snapshot);
  b.receipts = b.receipts.map(row => { const raw = snapshot.receipts.find(r => r.id === row.id);
    return { ...row, supplierBatchNo:raw.supplierBatchNo, batchId:raw.batchId, payableAmountNative:raw.payableAmountNative, payableAmountBase:raw.payableAmountBase }; });
  return b;
}
function controlledReply(reply, snapshot) {
  const r = copy(reply);
  if (r.requestBody) r.requestBody.expectedRevision = (snapshot.order || snapshot.orders[0]).revision;
  if (r.status === 201) {
    const raw = snapshot.receipts.find(row => row.id === r.json.data.submission.receipt.id);
    r.json.data = { ...controlledBundle(snapshot), submission:JSON.parse(raw.submissionJson), replayed:r.json.data.replayed };
  }
  return r;
}
function controlledPurchaseReceiptSubmissionProofFixture(provider = 'sqlite') {
  const e = purchaseReceiptSubmissionProofFixture(provider);
  for (const key of ['before','afterMissing','committed','afterConflicts','full','afterReplay','faultBefore','faultAfter']) e[key] = controlledSnapshot(e[key]);
  e.original = copy(e.before.order);
  for (const key of ['missingKey','changed','differentActor']) e[key] = controlledReply(e[key], e.before);
  e.concurrent = e.concurrent.map(r => controlledReply(r, e.committed)); e.replay = controlledReply(e.replay, e.full);
  e.auditFailure = controlledReply(e.auditFailure, e.faultBefore);
  return e;
}
module.exports = { purchaseReceiptSubmissionProofFixture, purchaseReceiptRecoveryProofFixture, controlledPurchaseReceiptSubmissionProofFixture };
