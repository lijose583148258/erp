const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertPartialBarterStage } = require('./lib/enterprise-round2-barter-partial.cjs');

const expected = { executed: 800, remaining: 1200, outgoingStock: 60, incomingStock: 80, verifiedPayments: 1, status: 'partial' };
function fixture() {
  const agreement = { status: 'partial', executedOffsetAmount: 800, remainingOffsetAmount: 1200, agreedOffsetAmount: 2000 };
  const stock = quantity => ({ balances: [{ id: 1, quantity }], batch: { stockQuantity: quantity },
    costs: [{ quantityDelta: quantity, costAmountDelta: quantity * 10 }],
    movements: [{ stockBalanceId: 1, quantityDelta: quantity }], apiBalances: [[{ quantity }], [{ quantity }]] });
  return { label: 'partial', readbacks: [structuredClone(agreement), structuredClone(agreement)], persisted: agreement,
    paid: { paidAmount: 800, paymentStatus: 'partial', paymentRecords: [{ status: 'verified', amount: 800 }] },
    ourStock: stock(60), received: stock(80) };
}
test('partial barter reconciles both instances, payment records, quantities and carrying cost', () => {
  assert.doesNotThrow(() => assertPartialBarterStage(fixture(), expected));
});
for (const [name, mutate] of [
  ['premature completion', s => { s.readbacks[0].status = 'completed'; }],
  ['stale secondary API', s => { s.readbacks[1].executedOffsetAmount = 0; }],
  ['missing secondary API', s => { s.readbacks.pop(); }],
  ['duplicated payment', s => { s.paid.paymentRecords.push({ status: 'verified', amount: 800 }); }],
  ['wrong payment total', s => { s.paid.paymentRecords[0].amount = 799; }],
  ['cost drift despite correct quantity', s => { s.ourStock.costs[0].costAmountDelta = 599; }],
  ['batch drift', s => { s.received.batch.stockQuantity = 79; }],
  ['movement drift', s => { s.received.movements[0].quantityDelta = 79; }],
  ['empty inventory API evidence', s => { s.received.apiBalances[1] = []; }],
  ['missing ledger evidence', s => { s.ourStock.costs = []; }],
]) test(`partial barter rejects ${name}`, () => {
  const stage = fixture(); mutate(stage);
  assert.throws(() => assertPartialBarterStage(stage, expected));
});
