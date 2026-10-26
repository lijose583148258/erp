const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyPaymentLedgerRows } = require('./lib/payment-reconcile-policy.cjs');
const classify = overrides => classifyPaymentLedgerRows([{ id: 1, finalAmount: 1000, orderPaidAmount: 450,
  verifiedPaymentAmount: 400, financeAdjustmentAmount: 50, paymentStatus: 'partial', ...overrides }]);
test('canonical applied +50 is clean, not legacy inconsistency', () => {
  const r = classify(); assert.equal(r.counters.cleanCurrentPolicy, 1); assert.equal(r.counters.unresolvedDataDrift, 0);
  assert.equal(r.counters.legacyFinanceAdjustmentApplied, 1);
});
test('reproduced 400 instead of 450 is actionable, never accepted as current policy', () => {
  const r = classify({ orderPaidAmount: 400 }); assert.equal(r.counters.cleanCurrentPolicy, 0);
  assert.equal(r.counters.legacyFinanceAdjustmentIgnoredByCurrentPolicy, 1); assert.equal(r.counters.unresolvedDataDrift, 1);
});
test('applied original and inverse net zero leave verified cash unchanged', () => {
  assert.equal(classify({ financeAdjustmentAmount: 0, orderPaidAmount: 400 }).counters.cleanCurrentPolicy, 1);
});
test('negative applied contributions are retained, and negative net is a risk', () => {
  assert.equal(classify({ financeAdjustmentAmount: -40, orderPaidAmount: 360 }).counters.cleanCurrentPolicy, 1);
  assert.equal(classify({ financeAdjustmentAmount: -500, orderPaidAmount: 0, paymentStatus: 'unpaid' }).counters.negativeLegacyFinanceWouldBelowZero, 1);
});
test('effective AR is separate from paid contributions and includes positive adjustments in overbalance', () => {
  assert.equal(classify({ receivableAdjustmentAmount: 550, paymentStatus: 'paid' }).counters.paymentStatusDrift, 0);
  assert.equal(classify({ receivableAdjustmentAmount: 600 }).counters.verifiedPaymentsExceedEffectiveReceivable, 1);
});
test('one cent lost is not green', () => {
  assert.equal(classify({ orderPaidAmount: 449.99 }).counters.unresolvedDataDrift, 1);
});

const { verifyPaymentAdjustmentProof } = require('./lib/payment-adjustment-proof.cjs');
const { paymentAdjustmentProofFixture } = require('./fixtures/payment-adjustment-proof-fixture.cjs');
test('strict proof recomputes every supporting stage and the real barter rebuild', () => {
  assert.equal(verifyPaymentAdjustmentProof(paymentAdjustmentProofFixture()).stages, 13);
});
for (const [label, mutate] of [
  ['erased positive adjustment', e => { e.stages[4].order.paidAmount = 400; }],
  ['unapplied cancellation counted', e => { e.stages[3].adjustments.find(a => a.id === e.cancelledId).appliedAt = '2026-01-01T00:00:01Z'; }],
  ['original effect silently removed', e => { e.stages[5].adjustments.shift(); }],
  ['original cash facts rewritten', e => { e.originalPayment.amount = 301; }],
  ['overbalance acknowledgement green', e => { e.overbalance.response.status = 200; }],
  ['rejected verification still emits event', e => { e.overbalance.eventCount = 1; }],
  ['one application stale', e => { e.stages[4].readbacks[1].paidAmount = 400; }],
  ['barter reversal erased adjustment', e => { e.barterRebuild.reversed.order.paidAmount = 0; }],
  ['API-only proof replaces barter flow', e => { delete e.barterRebuild; }],
]) test(`reject ${label}, regardless of forged passed flags`, () => {
  const e = paymentAdjustmentProofFixture(); mutate(e); e.status = 'passed'; e.proof = { passed: true };
  assert.throws(() => verifyPaymentAdjustmentProof(e));
});
