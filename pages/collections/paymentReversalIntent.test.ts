import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReversalAcknowledgment, assertReversalHistory, clearReversalIntent, isDefinitiveReversalRejection, mayReviewReversal,
  prepareLockedReversalIntent, prepareReversalIntent, readReversalIntent, reversalIntentStorageKey, type ReversalIntentStorage } from './paymentReversalIntent.ts';
import { can, hasDataScope } from '../../app/permissions.ts';
import type { CurrentUser } from '../../types';
import type { PaymentReversalHistory, PaymentReversalRequestRecord, PaymentReversalResult } from '../../src/services/collections.service';

const requestFacts = { reasonCategory: 'registration_error' as const, reason: 'Original registration was wrong' };
const reviewFacts = { decision: 'approve' as const, note: 'Independently matched original cash receipt' };
const at = '2026-10-03T09:00:00.000Z', reviewedAt = '2026-10-03T10:00:00.000Z';
function storage(): ReversalIntentStorage { const items = new Map<string, string>(); return { getItem: k => items.get(k) ?? null, setItem: (k, v) => { items.set(k, v); }, removeItem: k => { items.delete(k); } }; }
const original = { version: 'original-payment-facts/v1' as const, id: 10, orderId: 20, amount: 300, currency: 'CNY', exchangeRate: 1,
  baseAmount: 300, method: 'bank_transfer', date: at, payerName: 'Buyer', isProxy: false, note: 'Original note', verifiedBy: 3, milestoneId: null, createdAt: at };
const order = { id: 20, currency: 'CNY', finalAmount: 1000, paidAmount: 350, receivableAdjustmentAmount: 0, paymentStatus: 'partial' };
function pending(): PaymentReversalRequestRecord {
  const receipt = { version: 'payment-reversal-request/v1' as const, requestId: 'request-id', requestKey: 'request-key-123', paymentId: 10, orderId: 20,
    requestedBy: 3, amount: 300, currency: 'CNY', status: 'pending' as const, auditId: 81, requestedAt: at, ...requestFacts };
  return { id: receipt.requestId, paymentId: 10, status: 'pending', requestedBy: 3, ...requestFacts, createdAt: at,
    reviewedBy: null, reviewNote: null, reviewedAt: null, originalPayment: { ...original }, requestReceipt: receipt, reviewReceipt: null };
}
function posted(): PaymentReversalRequestRecord {
  const r = pending();
  return { ...r, status: 'posted', reviewedBy: 4, reviewNote: reviewFacts.note, reviewedAt, reviewReceipt: { version: 'payment-reversal-review/v1',
    requestId: r.id, reviewKey: 'review-key-123', paymentId: 10, orderId: 20, requestedBy: 3, reviewedBy: 4, amount: -300, currency: 'CNY',
    status: 'posted', auditId: 82, reviewedAt, beforePaidAmount: 350, afterPaidAmount: 50, reversalId: 'reversal-id' } };
}
function history(requests: PaymentReversalRequestRecord[] = []): PaymentReversalHistory {
  const effect = requests.find(r => r.status === 'posted');
  return { paymentId: 10, paymentStatus: effect ? 'reversed' : 'verified', originalPayment: { ...original }, currentOrder: { ...order, paidAmount: effect ? 150 : 350 },
    eligibility: { allowed: !requests.some(r => r.status !== 'rejected') }, requests,
    reversal: effect ? { id: 'reversal-id', requestId: effect.id, amount: -300, currency: 'CNY', postedBy: 4, auditId: 82, postedAt: reviewedAt, receipt: effect.reviewReceipt! } : null };
}
function requestResult(r = pending()): PaymentReversalResult { return { replayed: true, request: r, receipt: { ...r.requestReceipt }, currentOrder: { ...order } }; }
function reviewResult(): PaymentReversalResult { const r = posted(); return { replayed: true, request: r, receipt: { ...r.reviewReceipt! }, currentOrder: { ...order, paidAmount: 150 } }; }
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

test('unknown request result survives refresh with original identity and normalized facts', () => {
  const s = storage(), first = prepareReversalIntent(s, 'request', '3', '10', requestFacts, () => 'request-key-123');
  assert.deepEqual(readReversalIntent(s, 'request', '3', '10'), first);
  assert.deepEqual(prepareReversalIntent(s, 'request', '3', '10', { ...requestFacts, reason: ` ${requestFacts.reason} ` }, () => { throw Error('new identity forbidden'); }), first);
});
test('unknown request facts cannot change category or reason under the original key', () => {
  const s = storage(); prepareReversalIntent(s, 'request', '3', '10', requestFacts, () => 'request-key-123');
  for (const facts of [{ ...requestFacts, reasonCategory: 'bank_return' as const }, { ...requestFacts, reason: 'A different reason' }])
    assert.throws(() => prepareReversalIntent(s, 'request', '3', '10', facts, () => 'another-key-123'));
});
test('unknown review keeps decision and explanation; reject cannot silently replace approve', () => {
  const s = storage(), first = prepareReversalIntent(s, 'review', '4', 'request-id', reviewFacts, () => 'review-key-123');
  assert.deepEqual(readReversalIntent(s, 'review', '4', 'request-id'), first);
  for (const facts of [{ ...reviewFacts, decision: 'reject' as const }, { ...reviewFacts, note: 'Different approval note' }])
    assert.throws(() => prepareReversalIntent(s, 'review', '4', 'request-id', facts, () => 'another-key-123'));
});
test('actor, target and request/review namespaces cannot reuse another outstanding intent', () => {
  const s = storage(); prepareReversalIntent(s, 'request', '3', '10', requestFacts, () => 'request-key-123');
  for (const [kind, actor, target] of [['request', '4', '10'], ['request', '3', '11'], ['review', '3', '10']] as const) assert.equal(readReversalIntent(s, kind, actor, target), null);
});
test('request facts and generated identity are validated before any stored or network write', () => {
  const s = storage();
  assert.throws(() => prepareReversalIntent(s, 'request', '3', '10', { ...requestFacts, reason: 'bad' }, () => 'request-key-123'));
  assert.throws(() => prepareReversalIntent(s, 'request', '3', '10', requestFacts, () => 'bad/key'));
  assert.equal(readReversalIntent(s, 'request', '3', '10'), null);
  for (const user of ['', 'guest', '-1', '1.5', '9007199254740993']) assert.throws(() => reversalIntentStorageKey('request', user, '10'));
});
test('corrupt/foreign outstanding identity fails closed; it is never rotated automatically', () => {
  for (const raw of ['{broken', 'null', '{}', JSON.stringify({ version: 'payment-reversal-intent/v1', kind: 'request', userId: '4', targetId: '10' })]) {
    const s = storage(); s.setItem(reversalIntentStorageKey('request', '3', '10'), raw);
    assert.throws(() => prepareReversalIntent(s, 'request', '3', '10', requestFacts, () => 'new-key-123'));
    assert.equal(s.getItem(reversalIntentStorageKey('request', '3', '10')), raw);
  }
});
test('blocked, quota-exhausted and silently dropped storage prevents a new money-write identity', () => {
  const s = storage(); s.setItem = () => { throw Error('quota'); };
  assert.throws(() => prepareReversalIntent(s, 'request', '3', '10', requestFacts, () => 'request-key-123'));
  s.setItem = () => {}; assert.throws(() => prepareReversalIntent(s, 'request', '3', '10', requestFacts, () => 'request-key-123'));
});
test('only a confirmed matching identity can be cleared; genuine later action gets a fresh key', () => {
  const s = storage(), first = prepareReversalIntent(s, 'request', '3', '10', requestFacts, () => 'request-key-123');
  assert.throws(() => clearReversalIntent(s, { ...first, key: 'foreign-key-123' }));
  clearReversalIntent(s, first);
  assert.equal(prepareReversalIntent(s, 'request', '3', '10', requestFacts, () => 'new-key-123').key, 'new-key-123');
});
test('failed cleanup does not pretend that the old identity is gone', () => {
  const s = storage(), first = prepareReversalIntent(s, 'review', '4', 'request-id', reviewFacts, () => 'review-key-123');
  s.removeItem = () => {}; assert.throws(() => clearReversalIntent(s, first)); assert.deepEqual(readReversalIntent(s, 'review', '4', 'request-id'), first);
});
test('a retained retry cannot silently adopt an identity replaced or cleared by another tab', () => {
  const s = storage(), first = prepareReversalIntent(s, 'request', '3', '10', requestFacts, () => 'request-key-123');
  s.setItem(reversalIntentStorageKey('request', '3', '10'), JSON.stringify({ ...first, key: 'different-key-123' }));
  assert.throws(() => prepareReversalIntent(s, 'request', '3', '10', requestFacts, () => 'new-key-123', first.key));
  s.removeItem(reversalIntentStorageKey('request', '3', '10'));
  assert.throws(() => prepareReversalIntent(s, 'request', '3', '10', requestFacts, () => 'new-key-123', first.key));
});
test('multi-tab preparation uses a scoped exclusive lock and returns one shared durable identity', async () => {
  let queued = Promise.resolve(), locksTaken = 0;
  const lock = { request: (name: string, work: () => unknown) => {
    assert.equal(name, reversalIntentStorageKey('request', '3', '10')); locksTaken++;
    const result = queued.then(work); queued = result.then(() => undefined); return result;
  } } as unknown as Pick<LockManager, 'request'>;
  const s = storage(); let made = 0;
  const results = await Promise.all([1, 2, 3].map(() => prepareLockedReversalIntent(lock, s, 'request', '3', '10', requestFacts, () => `request-key-${++made}`)));
  assert.equal(made, 1); assert.equal(locksTaken, 3); assert(results.every(r => r.key === 'request-key-1'));
  await assert.rejects(() => prepareLockedReversalIntent(undefined, s, 'request', '3', '10', requestFacts, () => 'new-key-123'));
});
test('transport, scope, reconciliation and identity conflicts retain the intent', () => {
  for (const code of [undefined, 'TIMEOUT', 'PAYMENT_REVERSAL_KEY_CONFLICT', 'PAYMENT_REVERSAL_ALREADY_PENDING', 'PAYMENT_REVERSAL_RECEIPT_INVALID',
    'PAYMENT_REVERSAL_SCOPE_DENIED', 'PAYMENT_REVERSAL_INVALID_STATE']) assert.equal(isDefinitiveReversalRejection(code), false);
  assert.equal(isDefinitiveReversalRejection('PAYMENT_REVERSAL_INVALID'), true);
});
test('applicant is never an independent reviewer, including administrators', () => {
  const r = pending(); assert.equal(mayReviewReversal('3', r, true), false); assert.equal(mayReviewReversal('4', r, false), false);
  assert.equal(mayReviewReversal('4', r, true), true);
  for (const id of ['', 'guest', 'NaN', '0']) assert.equal(mayReviewReversal(id, r, true), false);
  assert.equal(mayReviewReversal('4', posted(), true), false);
});
test('only built-in finance/admin grants or explicit governed permissions have reversal entry rights', () => {
  for (const role of ['finance', 'admin', 'sales', 'warehouse', 'manager'] as const) {
    const user: CurrentUser = { id: '3', name: role, role, avatar: '', dataScopes: role === 'finance' ? ['finance_visible'] : [] };
    for (const p of ['orders.payment.reversal.request', 'orders.payment.reversal.review'] as const)
      assert.equal(can(user, p) && hasDataScope(user, 'finance_visible'), role === 'finance' || role === 'admin');
  }
  assert.equal(can({ id: '3', name: 'Finance', role: 'finance', avatar: '', permissions: ['collections.read'] }, 'orders.payment.reversal.request'), false);
});
for (const role of ['finance', 'admin', 'sales'] as const) test(`explicit empty ${role} grants deny all even with finance_visible scope`, () => {
  const user: CurrentUser = { id: '3', name: role, role, avatar: '', permissions: [], dataScopes: ['finance_visible'] };
  assert.equal(hasDataScope(user, 'finance_visible'), true);
  for (const p of ['orders.payment.reversal.request', 'orders.payment.reversal.review', 'orders.payment.verify', 'orders.read', 'collections.read'] as const)
    assert.equal(can(user, p), false, `${role} explicit empty permission list must deny ${p}`);
});
test('only undefined permission list preserves legacy role defaults; explicit nonempty grants stay authoritative', () => {
  for (const role of ['finance', 'admin', 'sales'] as const) {
    const legacy: CurrentUser = { id: '3', name: role, role, avatar: '', dataScopes: ['finance_visible'] };
    assert.equal(can(legacy, 'orders.read'), can(role, 'orders.read'));
    assert.equal(can(legacy, 'orders.payment.reversal.request'), role !== 'sales');
    const limited = { ...legacy, permissions: ['collections.read'] };
    assert.equal(can(limited, 'collections.read'), true); assert.equal(can(limited, 'orders.payment.reversal.request'), false);
  }
});
test('history accepts pending, rejected attempts and a single final effect without pretending old receipt is today total', () => {
  assert.doesNotThrow(() => assertReversalHistory(history(), 10, 20));
  assert.doesNotThrow(() => assertReversalHistory(history([pending()]), 10, 20));
  assert.doesNotThrow(() => assertReversalHistory(history([posted()]), 10, 20));
  const rejected = posted(); rejected.status = 'rejected'; rejected.reviewReceipt = { ...rejected.reviewReceipt!, status: 'rejected', amount: 0, afterPaidAmount: 350, reversalId: null };
  assert.doesNotThrow(() => assertReversalHistory(history([rejected]), 10, 20));
});
for (const field of ['amount', 'date', 'verifiedBy', 'payerName', 'note', 'exchangeRate'] as const) test(`history rejects original financial facts changed under existing request: ${field}`, () => {
  const h = history([posted()]); const r = h.requests[0].originalPayment;
  Object.assign(r, { [field]: typeof r[field] === 'number' ? Number(r[field]) + 1 : 'Changed original fact' });
  assert.throws(() => assertReversalHistory(h, 10, 20));
});
test('history never defaults a malformed response to an empty, eligible list', () => {
  for (const h of [undefined, {}, { ...history(), requests: null }, { ...history(), eligibility: undefined }, { ...history(), originalPayment: undefined }])
    assert.throws(() => assertReversalHistory(h as PaymentReversalHistory, 10, 20));
});
test('eligibility false preserves verified noncash/foreign records as read-only, never coerces currency', () => {
  const h = history(); h.originalPayment.currency = 'USD'; h.currentOrder.currency = 'USD'; h.eligibility = { allowed: false, message: 'CNY only' };
  assert.doesNotThrow(() => assertReversalHistory(h, 10, 20));
  h.eligibility.allowed = true; assert.throws(() => assertReversalHistory(h, 10, 20));
});
test('duplicate active/final requests, missing final effect and wrong negative amount all fail read-back', () => {
  const a = pending(), b = { ...pending(), id: 'other-request', requestReceipt: { ...pending().requestReceipt, requestId: 'other-request', requestKey: 'other-key-123' } };
  assert.throws(() => assertReversalHistory(history([a, b]), 10, 20));
  const h = history([posted()]); h.reversal = null; assert.throws(() => assertReversalHistory(h, 10, 20));
  const h2 = history([posted()]); h2.reversal!.amount = -299; assert.throws(() => assertReversalHistory(h2, 10, 20));
});
test('original request replay can return its pending acknowledgment after final approval without reopening it', () => {
  const intent = prepareReversalIntent(storage(), 'request', '3', '10', requestFacts, () => 'request-key-123');
  assert.doesNotThrow(() => assertReversalAcknowledgment(requestResult(posted()), intent, 10, 20));
});
test('approval replay returns original 350→50 receipt while actual current order may already be 150', () => {
  const intent = prepareReversalIntent(storage(), 'review', '4', 'request-id', reviewFacts, () => 'review-key-123');
  assert.doesNotThrow(() => assertReversalAcknowledgment(reviewResult(), intent, 10, 20));
});
test('missing / wrong request acknowledgment never clears the original key', () => {
  const intent = prepareReversalIntent(storage(), 'request', '3', '10', requestFacts, () => 'request-key-123');
  for (const mutation of [(r: PaymentReversalResult) => { r.receipt = undefined as any; }, (r: PaymentReversalResult) => { r.currentOrder.id = 21; },
    (r: PaymentReversalResult) => { r.request.reason = 'Different facts'; }, (r: PaymentReversalResult) => { (r.receipt as any).requestKey = 'different-key-123'; },
    (r: PaymentReversalResult) => { (r.receipt as any).requestedBy = 4; }]) {
    const r = clone(requestResult()); mutation(r); assert.throws(() => assertReversalAcknowledgment(r, intent, 10, 20));
  }
});
test('review response rejects changed reviewer, explanation, amount, decision and receipt arithmetic', () => {
  const intent = prepareReversalIntent(storage(), 'review', '4', 'request-id', reviewFacts, () => 'review-key-123');
  for (const mutation of [(r: PaymentReversalResult) => { r.request.reviewedBy = 3; }, (r: PaymentReversalResult) => { r.request.reviewNote = 'Changed explanation'; },
    (r: PaymentReversalResult) => { (r.receipt as any).amount = -299; }, (r: PaymentReversalResult) => { (r.receipt as any).status = 'rejected'; },
    (r: PaymentReversalResult) => { (r.receipt as any).afterPaidAmount = 150; }, (r: PaymentReversalResult) => { (r.receipt as any).reviewedBy = 8; }]) {
    const r = clone(reviewResult()); mutation(r); assert.throws(() => assertReversalAcknowledgment(r, intent, 10, 20));
  }
});

for (const kind of ['request', 'review'] as const) {
  const fields = kind === 'request' ? ['requestedBy', 'status', 'auditId', 'requestedAt'] : ['requestedBy', 'reviewedBy', 'auditId', 'reviewedAt'];
  for (const field of fields) for (const omit of [false, true]) test(`${kind} acknowledgment ${field} ${omit ? 'omission' : 'mutation'} retains original unknown intent`, () => {
    const s = storage(), intent = kind === 'request'
      ? prepareReversalIntent(s, kind, '3', '10', requestFacts, () => 'request-key-123')
      : prepareReversalIntent(s, kind, '4', 'request-id', reviewFacts, () => 'review-key-123');
    const r = clone(kind === 'request' ? requestResult() : reviewResult()), receipt = r.receipt as unknown as Record<string, unknown>;
    if (omit) delete receipt[field]; else receipt[field] = field.endsWith('At') ? '2026-10-03T13:00:00.000Z' : field === 'status' ? 'posted' : 999;
    assert.throws(() => { assertReversalAcknowledgment(r, intent, 10, 20); clearReversalIntent(s, intent); });
    assert.deepEqual(readReversalIntent(s, kind, intent.userId, intent.targetId), intent);
  });
  const storedFields = kind === 'request' ? ['auditId', 'requestedAt'] : ['auditId', 'reviewedAt'];
  for (const field of storedFields) for (const omit of [false, true]) test(`${kind} stored receipt ${field} ${omit ? 'omission' : 'mismatch'} cannot clear unknown intent`, () => {
    const s = storage(), intent = kind === 'request'
      ? prepareReversalIntent(s, kind, '3', '10', requestFacts, () => 'request-key-123')
      : prepareReversalIntent(s, kind, '4', 'request-id', reviewFacts, () => 'review-key-123');
    const r = clone(kind === 'request' ? requestResult() : reviewResult());
    const stored = (kind === 'request' ? r.request.requestReceipt : r.request.reviewReceipt) as unknown as Record<string, unknown>;
    if (omit) delete stored[field]; else stored[field] = field.endsWith('At') ? '2026-10-03T13:00:00.000Z' : 999;
    assert.throws(() => { assertReversalAcknowledgment(r, intent, 10, 20); clearReversalIntent(s, intent); });
    assert.deepEqual(readReversalIntent(s, kind, intent.userId, intent.targetId), intent);
  });
  for (const audit of [0, -1, 1.5, '82', undefined, null, NaN]) test(`${kind} invalid audit identity ${String(audit)} cannot clear unknown intent`, () => {
    const s = storage(), intent = kind === 'request'
      ? prepareReversalIntent(s, kind, '3', '10', requestFacts, () => 'request-key-123')
      : prepareReversalIntent(s, kind, '4', 'request-id', reviewFacts, () => 'review-key-123');
    const r = clone(kind === 'request' ? requestResult() : reviewResult());
    Object.assign(r.receipt, { auditId: audit }); Object.assign(kind === 'request' ? r.request.requestReceipt : r.request.reviewReceipt!, { auditId: audit });
    assert.throws(() => { assertReversalAcknowledgment(r, intent, 10, 20); clearReversalIntent(s, intent); });
    assert.deepEqual(readReversalIntent(s, kind, intent.userId, intent.targetId), intent);
  });
  for (const badTime of [undefined, 'not-a-timestamp']) test(`${kind} mutually missing/invalid timestamps ${String(badTime)} do not establish a receipt`, () => {
    const s = storage(), intent = kind === 'request'
      ? prepareReversalIntent(s, kind, '3', '10', requestFacts, () => 'request-key-123')
      : prepareReversalIntent(s, kind, '4', 'request-id', reviewFacts, () => 'review-key-123');
    const r = clone(kind === 'request' ? requestResult() : reviewResult());
    const field = kind === 'request' ? 'requestedAt' : 'reviewedAt';
    Object.assign(r.receipt, { [field]: badTime }); Object.assign(kind === 'request' ? r.request.requestReceipt : r.request.reviewReceipt!, { [field]: badTime });
    Object.assign(r.request, { [kind === 'request' ? 'createdAt' : 'reviewedAt']: badTime });
    assert.throws(() => { assertReversalAcknowledgment(r, intent, 10, 20); clearReversalIntent(s, intent); });
    assert.deepEqual(readReversalIntent(s, kind, intent.userId, intent.targetId), intent);
  });
}
test('review cannot clear an intent when both DTOs omit the original applicant identity', () => {
  const s = storage(), intent = prepareReversalIntent(s, 'review', '4', 'request-id', reviewFacts, () => 'review-key-123');
  const r = clone(reviewResult()); Object.assign(r.request, { requestedBy: undefined }); Object.assign(r.receipt, { requestedBy: undefined });
  assert.throws(() => { assertReversalAcknowledgment(r, intent, 10, 20); clearReversalIntent(s, intent); });
  assert.deepEqual(readReversalIntent(s, 'review', intent.userId, intent.targetId), intent);
});
