import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearPaymentIntent, isDefinitivePaymentRejection, paymentIntentStorageKey, preparePaymentIntent, readPaymentIntent, type IntentStorage } from './paymentSubmissionIntent';
const facts = { amount: 300, date: '2026-10-03', method: 'bank_transfer', isProxy: false, payerName: 'Payer', note: 'Evidence' };
test('invalid generated identity is rejected before storage or submission', () => {
  const s = storage(); assert.throws(() => preparePaymentIntent(s, '3', '10', facts, () => 'bad/key'));
  assert.equal(readPaymentIntent(s, '3', '10'), null);
});
function storage(): IntentStorage { const items = new Map<string,string>(); return { getItem: k => items.get(k) ?? null, setItem: (k,v) => { items.set(k,v); }, removeItem: k => { items.delete(k); } }; }
test('refresh/unknown acknowledgement retains exactly the original request and facts', () => {
  const s = storage(), original = preparePaymentIntent(s, '3', '10', facts, () => 'request-key-123');
  assert.deepEqual(readPaymentIntent(s, '3', '10'), original);
  assert.deepEqual(preparePaymentIntent(s, '3', '10', facts, () => { throw Error('must not generate a new key'); }), original);
});
test('same intent normalizes only harmless textual whitespace', () => {
  const s = storage(); preparePaymentIntent(s, '3', '10', facts, () => 'request-key-123');
  assert.equal(preparePaymentIntent(s, '3', '10', { ...facts, note: ' Evidence ' }, () => 'new-key-123').key, 'request-key-123');
});
for (const field of ['amount', 'date', 'method', 'payerName', 'note', 'isProxy'] as const) test(`unknown result cannot be silently changed: ${field}`, () => {
  const s = storage(); preparePaymentIntent(s, '3', '10', facts, () => 'request-key-123');
  const different = { ...facts, [field]: field === 'amount' ? 301 : field === 'isProxy' ? true : 'different' };
  assert.throws(() => preparePaymentIntent(s, '3', '10', different, () => 'new-key-123'));
});
test('user and order scopes isolate drafts and keys', () => {
  const s = storage(); preparePaymentIntent(s, '3', '10', facts, () => 'request-key-123');
  assert.equal(readPaymentIntent(s, '4', '10'), null); assert.equal(readPaymentIntent(s, '3', '11'), null);
});
test('known success clears only its own key, then a genuine new payment gets a new identity', () => {
  const s = storage(); preparePaymentIntent(s, '3', '10', facts, () => 'request-key-123');
  assert.throws(() => clearPaymentIntent(s, '3', '10', 'different-key-123'));
  clearPaymentIntent(s, '3', '10', 'request-key-123');
  assert.equal(preparePaymentIntent(s, '3', '10', facts, () => 'new-key-123').key, 'new-key-123');
});
test('corrupt or foreign draft fails closed rather than generating another key', () => {
  for (const raw of ['{broken', 'null', '{}', JSON.stringify({ version: 'payment-intent/v1', userId: '4', orderId: '10' })]) {
    const s = storage(); s.setItem(paymentIntentStorageKey('3', '10'), raw);
    assert.throws(() => preparePaymentIntent(s, '3', '10', facts, () => 'new-key-123'));
  }
});
test('quota / blocked / silently lost storage never permits an unstored request', () => {
  const s = storage(); s.setItem = () => { throw Error('quota'); }; assert.throws(() => preparePaymentIntent(s, '3', '10', facts, () => 'new-key-123'));
  s.setItem = () => {}; assert.throws(() => preparePaymentIntent(s, '3', '10', facts, () => 'new-key-123'));
});
test('silently failed cleanup does not clear the original identity', () => {
  const s = storage(); preparePaymentIntent(s, '3', '10', facts, () => 'request-key-123'); s.removeItem = () => {};
  assert.throws(() => clearPaymentIntent(s, '3', '10', 'request-key-123')); assert.equal(readPaymentIntent(s, '3', '10')?.key, 'request-key-123');
});
test('only explicit rollback/rejection codes clear an intent; transport, scope and conflicts do not', () => {
  assert(isDefinitivePaymentRejection('PAYMENT_SUBMISSION_PENDING_CAPACITY'));
  for (const code of [undefined, 'PAYMENT_SUBMISSION_KEY_CONFLICT', 'PAYMENT_SUBMISSION_STATE_INVALID', 'PAYMENT_SUBMISSION_SCOPE_DENIED', 'TIMEOUT']) assert(!isDefinitivePaymentRejection(code));
});
