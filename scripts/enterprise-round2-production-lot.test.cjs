const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertContinuousLedger, productionLotProbe, genealogyReadback } = require('./lib/enterprise-round2-production-lot.cjs');
const fixture = () => [
  { id: 1, quantityBefore: 0, quantityDelta: 100, quantityAfter: 100, costBefore: 0, costAmountDelta: 1000, costAfter: 1000 },
  { id: 2, quantityBefore: 100, quantityDelta: -50, quantityAfter: 50, costBefore: 1000, costAmountDelta: -500, costAfter: 500 },
  { id: 3, quantityBefore: 50, quantityDelta: -50, quantityAfter: 0, costBefore: 500, costAmountDelta: -500, costAfter: 0 },
];
test('production lot probes load without eager browser dependencies', () => {
  assert.equal(typeof productionLotProbe, 'function'); assert.equal(typeof genealogyReadback, 'function');
});
test('dual work order ledger must be continuous, not just have correct final sums', () => {
  assert.doesNotThrow(() => assertContinuousLedger(fixture(), 0, 0));
});
for (const [name, mutate] of [
  ['stale same-lot quantity boundary', rows => { rows[2].quantityBefore = 100; rows[2].quantityAfter = 50; }],
  ['stale carrying cost boundary', rows => { rows[2].costBefore = 1000; rows[2].costAfter = 500; }],
  ['wrong arithmetic', rows => { rows[1].quantityAfter = 49; }],
  ['duplicate debit', rows => { rows.push({ ...rows[2], id: 4 }); }],
  ['missing ledger', rows => { rows.length = 0; }],
]) test(`rejects ${name}`, () => { const rows = fixture(); mutate(rows); assert.throws(() => assertContinuousLedger(rows, 0, 0)); });
