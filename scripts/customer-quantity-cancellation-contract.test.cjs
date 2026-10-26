const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { verifyCustomerCancellation } = require('./lib/customer-quantity-cancellation-proof.cjs');
const { cancellationFixture } = require('./fixtures/customer-quantity-cancellation-fixture.cjs');
test('synthetic verifier fixture checks cancellation without claiming reservation or refunds', () => {
  const proof = verifyCustomerCancellation(cancellationFixture());
  assert.equal(proof.cancelled, 60); assert.equal(proof.reservationAccepted, false); assert.equal(proof.refundsAccepted, false);
});
for (const [name, mutate] of [
  ['summary only', r => { delete r.cancellation; }],
  ['cash rewritten', r => { r.cancellation.posted.order.paidAmount = 1000; }],
  ['original quantity rewritten', r => { r.cancellation.final.order.items[0].quantity = 40; }],
  ['original receipt rewritten', r => { r.cancellation.posted.order.shipments[0].receipts[0].acceptedQuantity = 100; }],
  ['cost drift', r => { r.cancellation.final.cost[0].costAmountDelta = 1000; }],
  ['stock erased', r => { r.cancellation.before.balances = []; }],
  ['financial adjustment before approval', r => { r.cancellation.pending.persisted.order.receivableAdjustmentAmount = 600; }],
  ['foreign pending request', r => { r.cancellation.pending.persisted.adjustments[0].requestKey = 'other'; }],
  ['ACK absent', r => { delete r.cancellation.lostAck; }],
  ['response failed before commit', r => { r.cancellation.lostAck.upstreamStatus = 500; }],
  ['failure occurred before commit', r => { r.cancellation.lostAck.failedAt = 0; }],
  ['recovery is another voucher', r => { r.cancellation.lostAck.recoveryText = 'other 待财务过账'; }],
  ['finance actor is admin', r => { r.cancellation.financePost.data.adjustment.poster.role = 'admin'; }],
  ['self approval', r => { r.cancellation.actors.finance = 2; }],
  ['fake delivery', r => { r.cancellation.readbacks[1].fulfillment.fullyDelivered = true; }],
  ['second node missing', r => { r.cancellation.readbacks.pop(); }],
  ['hidden UI', r => { r.browserBounds[0].notCovered = false; }],
  ['clipped UI', r => { r.browserBounds[0].rect.right = 1500; }],
  ['wrong money UI', r => { r.browserBounds[0].text = '有效 1000.00 CNY'; }],
  ['money-only credit erases demand', r => { r.cancellation.boundaries.financialReadback.fulfillment.lines[0].outstandingQuantity = 0; }],
  ['refund fabricates cash', r => { r.cancellation.boundaries.afterRefund.paidAmount = 200; }],
  ['self-post changes money', r => { r.cancellation.boundaries.afterSelfPost.receivableAdjustmentAmount = 200; }],
  ['reversal loses obligation', r => { r.cancellation.restored.fulfillment.lines[0].outstandingQuantity = 0; }],
  ['history deleted', r => { r.cancellation.final.adjustments.shift(); }],
  ['historical request rewritten', r => { r.cancellation.final.adjustments[0].evidenceJson = '{"other":true}'; }],
  ['duplicate audit', r => { r.cancellation.audit.push(r.cancellation.audit[0]); }],
  ['race duplicate voucher', r => { r.cancellation.races[0].duplicates[1].json.data.id++; }],
  ['race double effect', r => { r.cancellation.races[0].outcomes[1].json.data.changed = true; }],
  ['race oversold physical obligation', r => { r.cancellation.races[1].after.shipments = [{ quantity: 40 }]; }],
  ['missing scope denial', r => { r.cancellation.rejections.shift(); }],
]) test(`cancellation verifier rejects ${name}`, () => {
  const data = cancellationFixture(); mutate(data); assert.throws(() => verifyCustomerCancellation(data));
});
test('maintained audit has independent non-fail-fast cloud execution and original fixed obligation', () => {
  const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
  const workflow = read('../.github/workflows/enterprise-cloud-sandbox.yml');
  assert.match(workflow, /id: customer_quantity_cancellation\s+if:.*always\(\).*\s+continue-on-error: true/);
  assert.match(workflow, /run: node \.\/scripts\/customer-quantity-cancellation-audit-v1.cjs/);
  assert.match(read('enterprise-round2-audit-v1.cjs'), /runner.run\('backorder-adjustment-closeout'/);
  assert.match(read('enterprise-round2-local-v1.cjs'), /\['customer-cancellation', 'scripts\/customer-quantity-cancellation-audit-v1.cjs'/);
  assert.match(read('enterprise-cumulative-regression-v1.cjs'), /cancellation: safeRead/);
  assert.match(read('enterprise-cloud-business-audit-summary-v1.cjs'), /\['customer_quantity_cancellation',/);
});
test('cloud aggregate rejects failed, missing or skipped cancellation even with a green conclusion', () => {
  const source = fs.readFileSync(path.join(__dirname, 'enterprise-cloud-business-audit-summary-v1.cjs'), 'utf8');
  const ids = [...source.matchAll(/\['([a-z0-9_]+)',/g)].map(match => match[1]).filter(id => id !== 'round2_business');
  for (const outcome of ['success', 'failure', 'cancelled', 'skipped', undefined]) {
    const steps = Object.fromEntries(ids.map(id => [id, { outcome: 'success' }]));
    if (outcome) steps.customer_quantity_cancellation = { outcome, conclusion: 'success' }; else delete steps.customer_quantity_cancellation;
    let report, exitCode = 0;
    require('node:vm').runInNewContext(source, {
      require: name => name === 'node:fs' ? { mkdirSync() {}, writeFileSync(_file, data) { report = JSON.parse(data); } } : require(name),
      process: { env: { BUSINESS_AUDIT_STEPS_JSON: JSON.stringify(steps) }, exit(code) { exitCode = code; } }, console: { log() {}, error() {} },
    });
    assert.equal(exitCode, outcome === 'success' ? 0 : 1); assert.equal(report.summary.failed, outcome === 'success' ? 0 : 1);
    assert(report.audits.filter(a => a.id !== 'customer_quantity_cancellation').every(a => a.status === 'passed'));
  }
});
