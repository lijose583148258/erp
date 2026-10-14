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
module.exports = { purchaseReceiptSubmissionProofFixture, purchaseReceiptRecoveryProofFixture };
