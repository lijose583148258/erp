import { purchaseReceiptFingerprint, purchaseReceiptAuditDetails, requirePurchaseReceiptKey, readPurchaseReceiptSubmission,
  type PurchaseReceiptFacts, type PurchaseReceiptSubmission } from './purchase-receipt-submission';

const key = 'receipt-request-123';
const facts: PurchaseReceiptFacts = { purchaseOrderId: 7, receivedBy: 9, quantity: 3, acceptedQuantity: 2, rejectedQuantity: 1,
  batchNo: null, receivedAt: null, discrepancyReason: 'Door refused damaged goods', discrepancyType: 'damaged', note: null };
const receipt: PurchaseReceiptSubmission['receipt'] = { id: 13, receiptNo: 'PRC-13', purchaseOrderId: 7, quantity: 3,
  acceptedQuantity: 2, rejectedQuantity: 1, unit: 'kg', batchNo: 'PO-7-RCV-PRC-13', stockEntryRef: 'PO-7-RCV-PRC-13',
  discrepancyReason: facts.discrepancyReason, note: null, receivedBy: 9, receivedAt: '2026-10-13T00:00:00.000Z', createdAt: '2026-10-13T00:00:01.000Z' };
function fixture() {
  const fingerprint = purchaseReceiptFingerprint(facts);
  const submission: PurchaseReceiptSubmission = { schema: 'purchase-receipt-submission/v1', key, fingerprint, auditId: 19, receipt };
  const stored = { submissionKey: key, submissionFingerprint: fingerprint, submissionJson: JSON.stringify(submission) };
  const audit = { id: 19, userId: 9, action: 'CREATE_RECEIPT', resource: 'purchase_order', resourceId: 7,
    details: JSON.stringify(purchaseReceiptAuditDetails(key, fingerprint, receipt)) };
  return { stored, audit, submission };
}

describe('immutable purchase receipt acknowledgement', () => {
  it.each([undefined, null, '', 'short', 'bad/key-123', 'a'.repeat(121)])('requires a durable request key: %s', value => {
    expect(() => requirePurchaseReceiptKey(value)).toThrow('KEY_REQUIRED');
  });
  it('keeps server-assigned default batch/time outside caller identity', () => {
    const f = fixture(); expect(readPurchaseReceiptSubmission(f.stored, receipt, facts, key, f.audit)).toEqual(f.submission);
  });
  it.each(Object.keys(facts))('same key cannot acknowledge changed caller facts: %s', field => {
    const f = fixture(), changed = { ...facts, [field]: typeof facts[field as keyof PurchaseReceiptFacts] === 'number' ? 999 : 'Changed' };
    expect(() => readPurchaseReceiptSubmission(f.stored, receipt, changed as PurchaseReceiptFacts, key, f.audit)).toThrow('KEY_CONFLICT');
  });
  it.each(['id', 'receiptNo', 'purchaseOrderId', 'quantity', 'acceptedQuantity', 'rejectedQuantity', 'unit', 'batchNo', 'stockEntryRef', 'note', 'discrepancyReason', 'receivedAt', 'createdAt'])('changed durable receipt is not silently rebooked: %s', field => {
    const f = fixture(), changed = { ...receipt, [field]: typeof receipt[field as keyof typeof receipt] === 'number' ? 999 : 'Changed' };
    expect(() => readPurchaseReceiptSubmission(f.stored, changed as typeof receipt, facts, key, f.audit)).toThrow('SUBMISSION_INVALID');
  });
  it.each(['id', 'userId', 'action', 'resource', 'resourceId', 'details'])('an unrelated audit cannot prove a committed receipt: %s', field => {
    const f = fixture(), changed = { ...f.audit, [field]: typeof f.audit[field as keyof typeof f.audit] === 'number' ? 999 : 'Changed' };
    expect(() => readPurchaseReceiptSubmission(f.stored, receipt, facts, key, changed)).toThrow('SUBMISSION_INVALID');
  });
  it.each([null, '', 'broken', 'null', '{}'])('missing/corrupt historical acknowledgement fails closed: %s', raw => {
    const f = fixture(); expect(() => readPurchaseReceiptSubmission({ ...f.stored, submissionJson: raw }, receipt, facts, key, f.audit)).toThrow('SUBMISSION_INVALID');
  });
  it('never treats a legacy NULL key or missing audit as a fresh submission', () => {
    const f = fixture(); expect(() => readPurchaseReceiptSubmission({ ...f.stored, submissionKey: null }, receipt, facts, key, f.audit)).toThrow('SUBMISSION_INVALID');
    expect(() => readPurchaseReceiptSubmission(f.stored, receipt, facts, key, null)).toThrow('SUBMISSION_INVALID');
  });
  it.each(['quantity', 'acceptedQuantity', 'note', 'unit', 'batchNo', 'stockEntryRef', 'receivedAt', 'createdAt'])('synchronizing both row and receipt JSON cannot rewrite the original audit: %s', field => {
    const f = fixture(), altered = { ...receipt, [field]: typeof receipt[field as keyof typeof receipt] === 'number' ? 999 : 'Rewritten' };
    const stored = { ...f.stored, submissionJson: JSON.stringify({ ...f.submission, receipt: altered }) };
    expect(() => readPurchaseReceiptSubmission(stored, altered as typeof receipt, facts, key, f.audit)).toThrow('SUBMISSION_INVALID');
  });
});
