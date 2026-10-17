const { fixture, browserFixture } = require('./fixtures/barter-browser-proof-fixture.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertPartialBarterStage, assertBarterBrowserChain } = require('./lib/enterprise-round2-barter-partial.cjs');
const fs = require('node:fs');
const vm = require('node:vm');
const { isBuiltin } = require('node:module');
// This import must also remain usable in the source gate without installed packages.
const { barterNegativeCashProbe } = require('./lib/enterprise-round2-barter-negative.cjs');
test('negative-cash probe is discoverable before browser dependencies are installed', () => {
  assert.equal(typeof barterNegativeCashProbe, 'function');
});

test('browser cumulative barter path creates from existing actual lots instead of seeding a generated batch', () => {
  const source=fs.readFileSync(require.resolve('./lib/enterprise-round2-barter-partial.cjs'),'utf8');
  assert.match(source,/await openRole\(actors.sales, 0\)/);
  assert.match(source,/await financeAction\(batch, 'approve', actors.finance1, 0\)/);
  assert.match(source,/await financeAction\(batch, 'post', actors.finance2, 1\)/);
  assert.match(source,/await financeAction\(second, 'reverse', actors.finance2, 1\)/);
  assert.match(source,/sourceDocument:our.batchNo/);
  assert.match(source,/sourceDocument:incomingBatch/);
  assert.match(source,/await expect\(page.getByRole\('button',\{name:'创建批次',exact:true\}\)\).toBeDisabled\(\)/);
  assert.match(source,/await expect\(sourceReadback\).toContainText\(our.batchNo\)/);
  assert.doesNotMatch(source,/seedOurStockForSettlement|BARTER-\$\{batch.id\}-OUR/);
});

test('source-gate barter assertions load with built-ins only, before npm install', () => {
  const loaded = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/enterprise-round2-barter-partial.cjs'), 'utf8'), {
    module: loaded,
    require(name) {
      assert(isBuiltin(name), `Source gate must not eagerly load ${name}`);
      return require(name);
    },
  });
  loaded.exports.assertPartialBarterStage(fixture(), expected);
});

const expected = { executed: 800, remaining: 1200, outgoingStock: 60, incomingStock: 80, verifiedPayments: 1, status: 'partial' };
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

test('barter browser chain binds three actors, all operations and four reconciled business stages', () => {
  assert.deepEqual(assertBarterBrowserChain(browserFixture()).actors, [2, 3, 4]);
});
for (const [name, mutate] of [
  ['missing agreement UI creation', e => { e.roleOperations.shift(); }],
  ['same approving and posting actor', e => { e.roleOperations[3].actorId = 3; }],
  ['forged sales role', e => { e.roleOperations[1].role = 'admin'; }],
  ['wrong saved creator', e => { e.stages.at(-1).persisted.createdBy = 3; }],
  ['wrong saved approver', e => { e.stages.at(-1).persisted.settlements[0].approvedBy = 4; }],
  ['wrong saved batch lot', e => { e.stages.at(-1).persisted.settlements[0].items = structuredClone(e.stages.at(-1).persisted.settlements[0].items); e.stages.at(-1).persisted.settlements[0].items[0].sourceDocument = 'fake'; }],
  ['missing stage', e => { e.stages.pop(); }],
  ['incorrect stock cost', e => { e.stages[1].received.costs[0].costAmountDelta++; }],
  ['lost original batch', e => { e.stages.at(-1).persisted.settlements[0].status = 'reversed'; }],
  ['changed reversal reason', e => { e.roleOperations[7].body.reason = 'rewritten'; }],
  ['successful duplicate posting', e => { e.replays[0].status = 200; }],
  ['denial side effect', e => { e.denials[0].after.amount++; }],
  ['denial not forbidden', e => { e.denials[0].status = 409; }],
  ['missing denial', e => { e.denials.pop(); }],
  ['missing actual-lot readback', e => { e.browser[0].sourceReadback = ''; }],
  ['missing operation screenshot', e => { delete e.roleOperations[2].screenshot; }],
  ['hidden browser error', e => { e.browserErrors.push({ status: 500 }); }],
]) test(`barter browser proof rejects ${name}`, () => {
  const evidence = browserFixture(); mutate(evidence); assert.throws(() => assertBarterBrowserChain(evidence));
});
