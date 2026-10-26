import { purchaseGovernanceSnapshots } from './purchase-governance';
import { buildPurchaseReceiptPayable } from './purchase-payable';
import { controlledPurchaseReceiptFingerprint, controlledPurchaseReceiptAuditDetails, controlledPurchaseReceiptFactsSchema,
  normalizeControlledPurchaseReceipt, readControlledPurchaseReceiptSubmission, type ControlledPurchaseReceiptFacts } from './purchase-controlled-receipt';

function fixture(accepted = 2) {
  const binding = { revision: 2, supplierId: 3, materialId: 7, unit: 'kg', quantity: 10, price: 20, currency: 'USD', exchangeRate: 0.14 };
  const governance = purchaseGovernanceSnapshots(binding,
    { taxTreatment: 'additional_supplier_tax', supplierTaxAmount: 10, supplierChargesAmount: 5, evidenceRef: 'Signed quote Q-1' },
    { specificationRef: 'Signed incoming specification', specificationRevision: 'R1', characteristics: [{ code: 'PH', name: 'pH', valueType: 'numeric',
      unit: 'pH', lowerLimit: '6.5', upperLimit: '7.5', testMethod: 'Calibrated meter', required: true }] });
  const facts: ControlledPurchaseReceiptFacts = { purchaseOrderId: 41, receivedBy: 8, quantity: 2, acceptedQuantity: accepted, rejectedQuantity: 2 - accepted,
    batchNo: 'REAL-SUPPLIER-LOT', receivedAt: null, discrepancyReason: accepted === 0 ? 'Damaged at door' : null, discrepancyType: 'other', note: null, expectedRevision: 2 };
  const payable = buildPurchaseReceiptPayable({ purchaseOrderId: 41, receiptNo: 'PRC-42', batchNo: 'PO-41-RCV-PRC-42', supplierBatchNo: facts.batchNo,
    receivedBy: 8, binding, supplierPayableBasisJson: governance.supplierPayableBasisJson!, sourceAuditId: 10, approvalAuditId: 11,
    receivedQuantity: accepted, receivedQuantityBefore: 0, postedAmountNativeBefore: 0, postedAmountBaseBefore: 0 });
  const receipt = normalizeControlledPurchaseReceipt({ id: 42, receiptNo: 'PRC-42', purchaseOrderId: 41, quantity: 2, acceptedQuantity: accepted,
    rejectedQuantity: 2 - accepted, unit: 'kg', batchNo: 'PO-41-RCV-PRC-42', supplierBatchNo: facts.batchNo, batchId: accepted ? 99 : null,
    stockEntryRef: accepted ? 'PO-41-RCV-PRC-42' : null, discrepancyReason: facts.discrepancyReason, note: null, receivedBy: 8,
    receivedAt: new Date('2026-10-14T01:00:00Z'), createdAt: new Date('2026-10-14T01:00:01Z'), ...payable,
    incomingQualityPlanJson: governance.incomingQualityPlanJson });
  const key = 'controlled-receipt-42', fingerprint = controlledPurchaseReceiptFingerprint(facts);
  const ack = { schema: 'purchase-receipt-submission/v2', key, fingerprint, auditId: 20, facts, receipt };
  const stored = { submissionKey: key, submissionFingerprint: fingerprint, submissionJson: JSON.stringify(ack) };
  const audit = { id: 20, userId: 8, action: 'CREATE_RECEIPT', resource: 'purchase_order', resourceId: 41,
    details: JSON.stringify(controlledPurchaseReceiptAuditDetails(key, fingerprint, receipt)) };
  return { receipt, facts, ack, stored, audit, key };
}
test.each([0, 2])('committed controlled receipt %s retains supplier lot, internal batch, two currencies, plan and original facts', accepted => {
  const f = fixture(accepted); expect(readControlledPurchaseReceiptSubmission(f.stored, f.receipt, f.audit)).toEqual(f.ack);
  expect(readControlledPurchaseReceiptSubmission(f.stored, f.receipt, f.audit, { key: f.key, facts: f.facts })).toEqual(f.ack);
  if (!accepted) expect(f.receipt).toMatchObject({ payableAmountNative: '0.00', payableAmountBase: '0.00', batchId: null, stockEntryRef: null });
});
test.each(['expectedRevision', 'quantity', 'batchNo', 'receivedBy', 'discrepancyType', 'note'])('same key cannot acknowledge changed caller %s', field => {
  const f = fixture(), changed = { ...f.facts, [field]: field === 'expectedRevision' || field === 'receivedBy' ? 9 : field === 'quantity' ? 3 : 'changed' };
  expect(() => readControlledPurchaseReceiptSubmission(f.stored, f.receipt, f.audit, { key: f.key, facts: changed as ControlledPurchaseReceiptFacts })).toThrow();
});
test.each(['supplierBatchNo', 'batchId', 'payableAmountNative', 'payableAmountBase', 'payableSnapshotJson', 'incomingQualityPlanJson'])('rewriting both typed row and JSON cannot alter frozen %s without contradicting the audit', field => {
  const f = fixture(), r = { ...f.receipt, [field]: field === 'batchId' ? 100 : field.includes('Amount') ? '99.00' : 'changed' };
  const stored = { ...f.stored, submissionJson: JSON.stringify({ ...f.ack, receipt: r }) };
  expect(() => readControlledPurchaseReceiptSubmission(stored, r, f.audit)).toThrow();
});
test('legacy NULL AP or V1 acknowledgement is not a controlled receipt', () => {
  const f = fixture();
  expect(() => normalizeControlledPurchaseReceipt({ ...f.receipt, payableAmountBase: null })).toThrow('RECONCILIATION_REQUIRED');
  expect(() => readControlledPurchaseReceiptSubmission({ ...f.stored, submissionJson: JSON.stringify({ ...f.ack, schema: 'purchase-receipt-submission/v1' }) }, f.receipt, f.audit)).toThrow('SUBMISSION_INVALID');
});
test('one micro-unit mismatch, absent actual supplier lot and seven-decimal quantities are not silently accepted', () => {
  const f = fixture();
  for (const changed of [{ ...f.facts, rejectedQuantity: 0.000001 }, { ...f.facts, batchNo: '' }, { ...f.facts, quantity: 2.0000001 }]) {
    expect(controlledPurchaseReceiptFactsSchema.safeParse(changed).success).toBe(false);
  }
});
test.each(['userId', 'resourceId', 'action', 'details'])('requires the exact original receipt audit %s', field => {
  const f = fixture();
  expect(() => readControlledPurchaseReceiptSubmission(f.stored, f.receipt, { ...f.audit, [field]: field === 'userId' || field === 'resourceId' ? 999 : 'changed' })).toThrow('SUBMISSION_INVALID');
});
