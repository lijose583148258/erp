import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  supplierPaymentCents, supplierPaymentFormFacts, supplierPaymentInput, supplierPaymentIntentSlot,
  prepareSupplierPaymentIntent, readSupplierPaymentIntent, clearSupplierPaymentIntent,
  confirmSupplierPaymentSubmission, confirmSupplierPaymentSubmissionReadBack,
  definitiveSupplierPaymentRegistrationRejection, confirmSupplierPaymentRegistrationRejected,
  prepareSupplierPaymentDecision, readSupplierPaymentDecision, clearSupplierPaymentDecision,
  confirmSupplierPaymentVerification, confirmSupplierPaymentCancellation, confirmSupplierPaymentDecision,
  confirmSupplierPaymentDecisionReadBack,
} from './supplierPaymentIntent';
import type { SupplierPaymentBundle, SupplierPaymentRecord, SupplierPaymentSubmission,
  SupplierPaymentVerification, SupplierPaymentCancellation } from '../../services/supplierPayment.service';

const form = { amountNative: '4.50', currency: 'USD', method: 'bank_transfer' as const, date: '2026-10-14',
  paymentAccountRef: 'Acc-AbC', externalTransactionRef: 'Txn-XyZ', evidenceRef: 'FIN-ARCHIVE-01', note: '' };
const facts = supplierPaymentFormFacts(form), makeKey = () => 'sp-original-key-123';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
// Explicit synthetic journal fixtures; these are not API, browser or database acceptance evidence.
function submission(): SupplierPaymentSubmission {
  const recorded = { purchaseReceiptId: 7, submittedByUserId: 9, amountNative: facts.amountNative,
    currency: facts.currency, method: facts.method, date: `${facts.date}T00:00:00.000Z`,
    paymentAccountRef: facts.paymentAccountRef, externalTransactionRef: facts.externalTransactionRef,
    evidenceRef: facts.evidenceRef, note: facts.note };
  return { schema: 'supplier-payment-submission/v1', key: makeKey(), auditId: 20, status: 'draft',
    fingerprint: createHash('sha256').update(JSON.stringify({ schema: 'supplier-payment-facts/v1', ...recorded })).digest('hex'),
    payment: { id: 11, paymentNo: 'SP-11', ...recorded, baseAmount: '32.14', createdAt: '2026-10-14T08:00:00.000Z' },
    allocationBasis: { payableSnapshotJson: JSON.stringify({ schema: 'purchase-receipt-payable/v1',
      currency: 'USD', baseCurrency: 'CNY', allocation: { amountNative: '9.00', amountBase: '64.29' } }),
    receiptSubmissionHash: 'a'.repeat(64), paidAmountNativeBefore: '0.00', paidAmountBaseBefore: '0.00' } };
}
function draft(): SupplierPaymentRecord {
  const original = submission();
  return { ...original.payment, status: 'draft', verifiedByUserId: null, verifiedAt: null,
    submission: original, verification: null, cancellation: null };
}
function verified(): SupplierPaymentRecord {
  const original = draft();
  const verification: SupplierPaymentVerification = { schema: 'supplier-payment-verification/v1', paymentId: 11,
    purchaseReceiptId: 7, amountNative: '4.50', baseAmount: '32.14', currency: 'USD', submittedByUserId: 9,
    verifiedByUserId: 10, verifiedAt: '2026-10-14T08:01:00.000Z', auditId: 21, draftAuditId: 20,
    qualityCheckId: 31, qualityRevision: 2, qualityReviewerUserId: 13,
    paidAmountNativeBefore: '0.00', paidAmountBaseBefore: '0.00', paidAmountNativeAfter: '4.50', paidAmountBaseAfter: '32.14' };
  return { ...original, status: 'verified', verifiedByUserId: 10, verifiedAt: verification.verifiedAt, verification };
}
function cancelled(): SupplierPaymentRecord {
  const original = draft();
  const cancellation: SupplierPaymentCancellation = { schema: 'supplier-payment-cancellation/v1', paymentId: 11,
    purchaseReceiptId: 7, cancelledByUserId: 9, cancelledAt: '2026-10-14T08:01:00.000Z', reason: '凭据登记有误',
    draftAuditId: 20, auditId: 21 };
  return { ...original, status: 'cancelled', cancellation };
}
function bundle(row = draft()): SupplierPaymentBundle {
  const isPaid = row.status === 'verified';
  return { purchaseReceiptId: 7, currency: 'USD', payableAmountNative: '9.00', payableAmountBase: '64.29',
    paidAmountNative: isPaid ? '4.50' : '0.00', paidAmountBase: isPaid ? '32.14' : '0.00',
    outstandingAmountNative: isPaid ? '4.50' : '9.00', outstandingAmountBase: isPaid ? '32.15' : '64.29',
    paymentEligibility: { eligible: false, reason: 'INCOMING_QA_RELEASE_REQUIRED' }, payments: [row] };
}

test('unknown registration ACK retains the original actor/receipt/key/facts across refresh', () => {
  const s = storage(), intent = prepareSupplierPaymentIntent(s, '9', '7', facts, makeKey);
  assert.deepEqual(readSupplierPaymentIntent(s, '9', '7'), intent);
  assert.deepEqual(prepareSupplierPaymentIntent(s, '9', '7', facts, () => { throw Error('must not rotate key'); }), intent);
  assert.equal(readSupplierPaymentIntent(s, '10', '7'), null);
  assert.equal(readSupplierPaymentIntent(s, '9', '8'), null);
});
for (const field of Object.keys(facts)) test(`an uncertain payment cannot change ${field}`, () => {
  const s = storage(); prepareSupplierPaymentIntent(s, '9', '7', facts, makeKey);
  const replacement = field === 'amountNative' ? '4.51' : field === 'currency' ? 'CNY'
    : field === 'method' ? 'cash' : field === 'date' ? '2026-10-15' : 'Other-value';
  assert.throws(() => prepareSupplierPaymentIntent(s, '9', '7', { ...facts, [field]: replacement }, makeKey));
  assert.equal(readSupplierPaymentIntent(s, '9', '7')?.key, makeKey());
});
test('form facts preserve opaque account/transaction case and fixed cents without guessing a date', () => {
  const normalized = supplierPaymentFormFacts({ ...form, amountNative: '4.5', currency: ' usd ', paymentAccountRef: ' Acc-AbC ' });
  assert.deepEqual(normalized, facts);
  assert.equal(supplierPaymentInput(normalized).amountNative, 4.5);
  assert.equal(supplierPaymentInput(normalized).note, undefined);
  for (const date of ['', '2026-02-30', '2026-2-03', '2026-10-14T00:00:00Z']) assert.throws(() => supplierPaymentFormFacts({ ...form, date }));
});
test('money rejects unknown, fractional, unsafe and JSON-wire cent loss before persistence', () => {
  for (const value of [null, undefined, 0, '', '4.5', '-1.00', '00.10', '0.001', '90071992547409.92']) assert.throws(() => supplierPaymentCents(value));
  for (const amountNative of ['0', '-1', '1.001', 'NaN', '1e2', '90071992547409.91']) {
    assert.throws(() => supplierPaymentFormFacts({ ...form, amountNative }));
  }
  // Number.toFixed(2) misleadingly preserves this display, but JSON sends a different decimal value.
  assert.equal(Number('90071992547409.91').toFixed(2), '90071992547409.91');
  assert.equal(JSON.stringify(Number('90071992547409.91')), '90071992547409.9');
  const s = storage();
  assert.throws(() => prepareSupplierPaymentIntent(s, '9', '7', { ...facts, amountNative: '90071992547409.91' }, makeKey));
  assert.equal(readSupplierPaymentIntent(s, '9', '7'), null);
});
test('invalid or silently dropped durable storage prevents creating a new request', () => {
  const s = storage(); s.setItem(supplierPaymentIntentSlot('9', '7'), '{}');
  assert.throws(() => prepareSupplierPaymentIntent(s, '9', '7', facts, makeKey));
  assert.throws(() => prepareSupplierPaymentIntent({ ...s, getItem: () => null, setItem: () => undefined }, '9', '7', facts, makeKey));
  for (const actor of ['0', '01', 'NaN', '9007199254740992']) assert.throws(() => supplierPaymentIntentSlot(actor, '7'));
  assert.throws(() => prepareSupplierPaymentIntent(storage(), '9', '7', facts, () => 'short'));
});
test('registration ACK must bind original owner, receipt, facts, fingerprint and frozen AP', async () => {
  const s = storage(), intent = prepareSupplierPaymentIntent(s, '9', '7', facts, makeKey), ack = submission();
  await confirmSupplierPaymentSubmission(intent, ack);
  const patches = [ { key: 'other-key-123' }, { fingerprint: 'b'.repeat(64) }, { auditId: 0 },
    { payment: { ...ack.payment, submittedByUserId: 10 } }, { payment: { ...ack.payment, purchaseReceiptId: 8 } },
    { payment: { ...ack.payment, externalTransactionRef: 'TXN-XYZ' } }, { payment: { ...ack.payment, amountNative: '4.51' } },
    { allocationBasis: { ...ack.allocationBasis, payableSnapshotJson: '{}' } },
    { allocationBasis: { ...ack.allocationBasis, paidAmountNativeBefore: '5.00' } },
    { allocationBasis: { ...ack.allocationBasis, receiptSubmissionHash: 'invalid' } } ];
  for (const patch of patches) {
    await assert.rejects(() => confirmSupplierPaymentSubmission(intent, { ...ack, ...patch }));
    assert.equal(readSupplierPaymentIntent(s, '9', '7')?.key, intent.key);
  }
});
test('POST acknowledgement alone cannot clear the key; separate original journal read-back is required', async () => {
  const s = storage(), intent = prepareSupplierPaymentIntent(s, '9', '7', facts, makeKey), ack = submission();
  await confirmSupplierPaymentSubmission(intent, ack);
  assert.ok(readSupplierPaymentIntent(s, '9', '7'));
  for (const readBack of [{ ...bundle(), payments: [] }, { ...bundle(), purchaseReceiptId: 8 },
    { ...bundle(), payments: [{ ...draft(), submission: { ...ack, auditId: 22 } }] }]) {
    await assert.rejects(() => confirmSupplierPaymentSubmissionReadBack(intent, ack, readBack));
    assert.ok(readSupplierPaymentIntent(s, '9', '7'));
  }
  await confirmSupplierPaymentSubmissionReadBack(intent, ack, bundle());
  assert.throws(() => clearSupplierPaymentIntent(s, { ...intent, key: 'different-key-123' }));
  clearSupplierPaymentIntent(s, intent); assert.equal(readSupplierPaymentIntent(s, '9', '7'), null);
});
test('original registration recovery remains valid after immutable verification or cancellation', async () => {
  const intent = prepareSupplierPaymentIntent(storage(), '9', '7', facts, makeKey);
  for (const row of [verified(), cancelled()]) await confirmSupplierPaymentSubmissionReadBack(intent, row.submission, bundle(row));
});
test('only three explicit no-effect registration rejection codes can release an unused key after independent read-back', () => {
  for (const code of ['SUPPLIER_PAYMENT_BANK_TRANSACTION_DUPLICATE', 'SUPPLIER_PAYMENT_EXCEEDS_PAYABLE', 'SUPPLIER_PAYMENT_DRAFT_PENDING']) {
    const s = storage(), intent = prepareSupplierPaymentIntent(s, '9', '7', facts, makeKey);
    assert.equal(definitiveSupplierPaymentRegistrationRejection(code), true);
    confirmSupplierPaymentRegistrationRejected(intent, code, { ...bundle(), payments: [] });
    clearSupplierPaymentIntent(s, intent);
    assert.equal(readSupplierPaymentIntent(s, '9', '7'), null);
    const corrected = { ...facts, externalTransactionRef: 'Corrected-Txn-XyZ' };
    assert.deepEqual(prepareSupplierPaymentIntent(s, '9', '7', corrected, () => 'sp-corrected-key-123').facts, corrected);
  }
});
test('unknown, key-conflict, history, permission and read failures never count as definitive registration rejection', () => {
  const s = storage(), intent = prepareSupplierPaymentIntent(s, '9', '7', facts, makeKey);
  for (const code of [undefined, 'SUPPLIER_PAYMENT_KEY_CONFLICT', 'SUPPLIER_PAYMENT_HISTORY_UNRECONCILED',
    'SUPPLIER_PAYMENT_SCOPE_DENIED', 'PURCHASE_SOURCE_HISTORY_UNRECONCILED', 'SUPPLIER_PAYMENT_INTERNAL_ERROR',
    'CONFLICT', 'ERR_NETWORK']) {
    assert.equal(definitiveSupplierPaymentRegistrationRejection(code), false);
    assert.throws(() => confirmSupplierPaymentRegistrationRejected(intent, code, { ...bundle(), payments: [] }));
    assert.ok(readSupplierPaymentIntent(s, '9', '7'));
  }
});
test('a rejected POST cannot release a key that is present, or a key checked against another receipt/currency', () => {
  const s = storage(), intent = prepareSupplierPaymentIntent(s, '9', '7', facts, makeKey);
  for (const readBack of [bundle(), bundle(verified()), bundle(cancelled()),
    { ...bundle(), payments: [], purchaseReceiptId: 8 }, { ...bundle(), payments: [], currency: 'CNY' }]) {
    assert.throws(() => confirmSupplierPaymentRegistrationRejected(intent, 'SUPPLIER_PAYMENT_BANK_TRANSACTION_DUPLICATE', readBack));
    assert.ok(readSupplierPaymentIntent(s, '9', '7'));
  }
});
test('independent verification and own unverified cancellation apply equally to administrators', () => {
  const s = storage();
  assert.throws(() => prepareSupplierPaymentDecision(s, '9', '7', 'verify', draft()));
  assert.throws(() => prepareSupplierPaymentDecision(s, '10', '7', 'cancel', draft(), '凭据登记有误'));
  assert.throws(() => prepareSupplierPaymentDecision(s, '9', '8', 'cancel', draft(), '凭据登记有误'));
  assert.throws(() => prepareSupplierPaymentDecision(s, '9', '7', 'cancel', verified(), '不能撤销已核验付款'));
  assert.throws(() => prepareSupplierPaymentDecision(s, '10', '7', 'verify', cancelled()));
});
test('decision identity survives refresh, does not rotate original draft or cancellation reason', () => {
  const s = storage(), pending = prepareSupplierPaymentDecision(s, '9', '7', 'cancel', draft(), '凭据登记有误');
  assert.deepEqual(readSupplierPaymentDecision(s, '9', '7'), pending);
  assert.deepEqual(prepareSupplierPaymentDecision(s, '9', '7', 'cancel', draft(), ' 凭据登记有误 '), pending);
  assert.throws(() => prepareSupplierPaymentDecision(s, '9', '7', 'cancel', draft(), '另一个取消原因'));
  assert.throws(() => prepareSupplierPaymentDecision(s, '9', '7', 'cancel', { ...draft(), id: 12 }, '凭据登记有误'));
  assert.throws(() => clearSupplierPaymentDecision(s, { ...pending, paymentId: 12 }));
  assert.equal(readSupplierPaymentDecision(s, '10', '7'), null);
});
test('verified journal binds independent actor, native/base totals and original QA reference', () => {
  const row = verified(); confirmSupplierPaymentVerification(row, row.verification!);
  for (const patch of [{ verifiedByUserId: 9 }, { paymentId: 12 }, { draftAuditId: 19 }, { paidAmountBaseAfter: '32.15' },
    { qualityCheckId: 0 }, { amountNative: '4.51' }, { auditId: 20 }]) {
    const broken = { ...row.verification!, ...patch };
    assert.throws(() => confirmSupplierPaymentVerification({ ...row, verification: broken,
      verifiedByUserId: broken.verifiedByUserId }, broken));
  }
});
test('cancelled journal binds original owner/reason and never acts as a refund', () => {
  const row = cancelled(); confirmSupplierPaymentCancellation(row, row.cancellation!);
  const pending = prepareSupplierPaymentDecision(storage(), '9', '7', 'cancel', draft(), '凭据登记有误');
  assert.equal(confirmSupplierPaymentDecision(pending, row), 'cancelled');
  for (const patch of [{ cancelledByUserId: 10 }, { paymentId: 12 }, { reason: '其他取消原因' }, { auditId: 20 }]) {
    const broken = { ...row, cancellation: { ...row.cancellation!, ...patch } };
    assert.throws(() => confirmSupplierPaymentDecision(pending, broken));
  }
});
test('verification/cancellation clear only after the same decision is independently read back', () => {
  for (const [kind, actor, row] of [['verify', '10', verified()], ['cancel', '9', cancelled()]] as const) {
    const s = storage(), pending = prepareSupplierPaymentDecision(s, actor, '7', kind, draft(), '凭据登记有误');
    for (const readBack of [{ ...bundle(row), payments: [] }, bundle(draft()), { ...bundle(row), purchaseReceiptId: 8 }]) {
      assert.throws(() => confirmSupplierPaymentDecisionReadBack(pending, row, readBack));
      assert.ok(readSupplierPaymentDecision(s, actor, '7'));
    }
    assert.deepEqual(confirmSupplierPaymentDecisionReadBack(pending, row, bundle(row)), row);
    clearSupplierPaymentDecision(s, pending); assert.equal(readSupplierPaymentDecision(s, actor, '7'), null);
  }
});
test('lost ACK may resolve to the immutable concurrent winner, never re-verify after a later QA hold', () => {
  const s = storage(), pending = prepareSupplierPaymentDecision(s, '12', '7', 'verify', draft());
  const row = verified();
  assert.equal(bundle(row).paymentEligibility.eligible, false);
  assert.equal(confirmSupplierPaymentDecision(pending, row), 'verified');
  assert.deepEqual(confirmSupplierPaymentDecisionReadBack(pending, row, bundle(row)), row);
  const cancelIntent = prepareSupplierPaymentDecision(storage(), '9', '7', 'cancel', draft(), '凭据登记有误');
  assert.equal(confirmSupplierPaymentDecision(cancelIntent, row), 'verified');
  assert.equal(confirmSupplierPaymentDecision(pending, cancelled()), 'cancelled');
});
test('read-back with a changed original fingerprint or different decision cannot clear pending intent', () => {
  const pending = prepareSupplierPaymentDecision(storage(), '10', '7', 'verify', draft()), row = verified();
  const broken = clone(row); broken.submission.fingerprint = 'c'.repeat(64);
  assert.throws(() => confirmSupplierPaymentDecisionReadBack(pending, row, bundle(broken)));
  const different = clone(row); different.verification!.qualityCheckId = 32;
  assert.throws(() => confirmSupplierPaymentDecisionReadBack(pending, row, bundle(different)));
});
test('failed storage removal leaves confirmed identity visible, not silently reusable', () => {
  const s = storage(), intent = prepareSupplierPaymentIntent(s, '9', '7', facts, makeKey);
  assert.throws(() => clearSupplierPaymentIntent({ ...s, removeItem: () => undefined }, intent));
  assert.ok(readSupplierPaymentIntent(s, '9', '7'));
  const decision = prepareSupplierPaymentDecision(s, '10', '7', 'verify', draft());
  assert.throws(() => clearSupplierPaymentDecision({ ...s, removeItem: () => undefined }, decision));
  assert.ok(readSupplierPaymentDecision(s, '10', '7'));
});
