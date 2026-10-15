import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preparePurchaseReceiptIntent, readPurchaseReceiptIntent, clearPurchaseReceiptIntent, purchaseReceiptIntentSlot,
  confirmPurchaseReceiptSubmission, definitivePurchaseReceiptRejection } from './purchaseReceiptIntent';
import type { PurchaseReceiptSubmission, ControlledPurchaseReceiptSubmission } from '../../services/procurement.service';
import { createHash } from 'node:crypto';
const facts = { quantity: 3, acceptedQuantity: 2, rejectedQuantity: 1, batchNo: 'SUP-1', discrepancyReason: 'Damaged', note: 'Delivery' };
function storage() { const items = new Map<string, string>(); return { getItem: (k: string) => items.get(k) ?? null,
  setItem: (k: string, v: string) => { items.set(k, v); }, removeItem: (k: string) => { items.delete(k); } }; }
const make = () => 'purchase-receipt-123';
test('unknown ACK survives refresh and never generates another key', () => {
  const s = storage(), intent = preparePurchaseReceiptIntent(s, '9', '7', facts, make);
  assert.deepEqual(readPurchaseReceiptIntent(s, '9', '7'), intent);
  assert.deepEqual(preparePurchaseReceiptIntent(s, '9', '7', facts, () => { throw Error('No new identity'); }), intent);
  assert.equal(readPurchaseReceiptIntent(s, '10', '7'), null); assert.equal(readPurchaseReceiptIntent(s, '9', '8'), null);
});
for (const field of Object.keys(facts)) test(`unknown request cannot change ${field}`, () => {
  const s = storage(); preparePurchaseReceiptIntent(s, '9', '7', facts, make);
  assert.throws(() => preparePurchaseReceiptIntent(s, '9', '7', { ...facts, [field]: typeof facts[field as keyof typeof facts] === 'number' ? 99 : 'Other' }, make));
});
test('corrupt or dropped local persistence prevents a new request', () => {
  const s = storage(); s.setItem(purchaseReceiptIntentSlot('9', '7'), '{}');
  assert.throws(() => preparePurchaseReceiptIntent(s, '9', '7', facts, make));
  assert.throws(() => preparePurchaseReceiptIntent({ ...s, getItem: () => null, setItem: () => undefined }, '9', '7', facts, make));
});
test('unrepresentable inventory fractions are rejected before persisting or posting an intent', () => {
  const s = storage();
  for (const n of [0.0000001, 1.1234567, 1.0000000000004, 0.30000000000000004, Infinity, NaN, 1e15]) {
    assert.throws(() => preparePurchaseReceiptIntent(s, '9', '7', { ...facts, quantity: n, acceptedQuantity: n, rejectedQuantity: 0 }, make));
    assert.equal(readPurchaseReceiptIntent(s, '9', '7'), null);
  }
  assert.equal(preparePurchaseReceiptIntent(s, '9', '7', { ...facts, quantity: 0.000001, acceptedQuantity: 0.000001, rejectedQuantity: 0 }, make).key, make());
});
test('original facts and receipt/audit identities must match before the next batch is enabled', async () => {
  const s = storage(), intent = preparePurchaseReceiptIntent(s, '9', '7', facts, make);
  const fingerprint = createHash('sha256').update(JSON.stringify({ schema: 'purchase-receipt-facts/v1', purchaseOrderId: 7, receivedBy: 9,
    quantity: 3, acceptedQuantity: 2, rejectedQuantity: 1, batchNo: 'SUP-1', receivedAt: null,
    discrepancyReason: 'Damaged', discrepancyType: 'short_shipped', note: 'Delivery' })).digest('hex');
  const submission: PurchaseReceiptSubmission = { schema: 'purchase-receipt-submission/v1', key: intent.key, fingerprint, auditId: 12,
    receipt: { id: 11, receiptNo: 'PRC-11', purchaseOrderId: 7, receivedBy: 9, unit: 'kg', ...facts,
      stockEntryRef: 'PO-7-RCV-PRC-11', receivedAt: '2026-10-13T00:00:00Z', createdAt: '2026-10-13T00:00:01Z' } };
  await confirmPurchaseReceiptSubmission(intent, submission);
  for (const patch of [{ key: 'other-key-123' }, { fingerprint: 'b'.repeat(64) }, { auditId: 0 }, { receipt: { ...submission.receipt, receivedBy: 99 } },
    { receipt: { ...submission.receipt, purchaseOrderId: 8 } }, { receipt: { ...submission.receipt, quantity: 4 } },
    { receipt: { ...submission.receipt, note: 'Different' } }, { receipt: { ...submission.receipt, batchNo: 'Other' } }]) {
    await assert.rejects(() => confirmPurchaseReceiptSubmission(intent, { ...submission, ...patch }));
  }
  assert.throws(() => clearPurchaseReceiptIntent(s, '9', '7', 'different-key-123'));
  clearPurchaseReceiptIntent(s, '9', '7', intent.key); assert.equal(readPurchaseReceiptIntent(s, '9', '7'), null);
});
test('uncertain/identity/corrupt acknowledgement errors never clear the intent', () => {
  for (const code of [undefined, 'PURCHASE_RECEIPT_KEY_CONFLICT', 'PURCHASE_RECEIPT_SUBMISSION_INVALID', 'INTERNAL_ERROR', 'CONFLICT']) assert.equal(definitivePurchaseReceiptRejection(code), false);
  assert.equal(definitivePurchaseReceiptRejection('PURCHASE_RECEIPT_EXCEEDS_REMAINING'), true);
});
test('V2 intent freezes the reviewed revision and actual supplier lot across refresh without rebinding to a new PO', () => {
  const s = storage(), intent = preparePurchaseReceiptIntent(s, '9', '7', { ...facts, expectedRevision: 2 }, make);
  assert.equal(intent.schema, 'purchase-receipt-intent/v2'); assert.deepEqual(readPurchaseReceiptIntent(s, '9', '7'), intent);
  assert.throws(() => preparePurchaseReceiptIntent(s, '9', '7', { ...facts, expectedRevision: 3 }, make));
  assert.throws(() => preparePurchaseReceiptIntent(storage(), '9', '7', { ...facts, expectedRevision: 2, batchNo: '' }, make));
  assert.throws(() => preparePurchaseReceiptIntent(storage(), '9', '7', { ...facts, expectedRevision: 2, quantity: 3.000001 }, make));
});
test('the existing storage slot retains V1 pending intents; upgrading never manufactures a new request', () => {
  const s = storage(), v1 = preparePurchaseReceiptIntent(s, '9', '7', facts, make);
  assert.equal(readPurchaseReceiptIntent(s, '9', '7')?.schema, 'purchase-receipt-intent/v1');
  assert.throws(() => preparePurchaseReceiptIntent(s, '9', '7', { ...facts, expectedRevision: 2 }, make));
  assert.deepEqual(readPurchaseReceiptIntent(s, '9', '7'), v1);
});
test('V2 ACK binds native/base AP, frozen plan, supplier lot and separate internal batch before clearing the original intent', async () => {
  const s = storage(), intent = preparePurchaseReceiptIntent(s, '9', '7', { ...facts, expectedRevision: 2 }, make);
  const recorded = { purchaseOrderId: 7, receivedBy: 9, quantity: 3, acceptedQuantity: 2, rejectedQuantity: 1, batchNo: 'SUP-1', receivedAt: null,
    discrepancyReason: 'Damaged', discrepancyType: 'short_shipped', note: 'Delivery', expectedRevision: 2 };
  const binding = { revision: 2, unit: 'kg', quantity: 10, price: 20, currency: 'USD', exchangeRate: 0.14, supplierId: 3, materialId: 4 };
  const payable = { schema: 'purchase-receipt-payable/v1', purchaseOrderId: 7, receiptNo: 'PRC-11', receivedBy: 9, supplierBatchNo: 'SUP-1', batchNo: 'PO-7-RCV-PRC-11',
    binding, source: { sourceAuditId: 10, approvalAuditId: 11 }, allocation: { receivedQuantity: '2', amountNative: '40.00', amountBase: '285.71' } };
  const submission: ControlledPurchaseReceiptSubmission = { schema: 'purchase-receipt-submission/v2', key: intent.key,
    fingerprint: createHash('sha256').update(JSON.stringify({ schema: 'purchase-receipt-facts/v2', ...recorded })).digest('hex'), auditId: 12, facts: recorded,
    receipt: { id: 11, receiptNo: 'PRC-11', purchaseOrderId: 7, receivedBy: 9, unit: 'kg', ...facts, batchNo: 'PO-7-RCV-PRC-11', supplierBatchNo: 'SUP-1', batchId: 4,
      stockEntryRef: 'PO-7-RCV-PRC-11', receivedAt: '2026-10-14T00:00:00Z', createdAt: '2026-10-14T00:00:01Z', payableAmountNative: '40.00', payableAmountBase: '285.71',
      payableSnapshotJson: JSON.stringify(payable), incomingQualityPlanJson: JSON.stringify({ schema: 'purchase-incoming-quality/v1', binding, plan: { characteristics: [{ code: 'PH' }] } }) } };
  await confirmPurchaseReceiptSubmission(intent, submission);
  for (const patch of [{ supplierBatchNo: 'OTHER' }, { batchNo: 'SUP-1' }, { batchId: null }, { payableAmountNative: '40.01' },
    { payableAmountBase: '285.70' }, { payableSnapshotJson: '{}' }, { incomingQualityPlanJson: 'broken' }]) {
    await assert.rejects(() => confirmPurchaseReceiptSubmission(intent, { ...submission, receipt: { ...submission.receipt, ...patch } }));
    assert.equal(readPurchaseReceiptIntent(s, '9', '7')?.key, intent.key);
  }
});
