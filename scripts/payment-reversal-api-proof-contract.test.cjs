const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyPaymentReversalApiProof } = require('./lib/payment-reversal-api-proof.cjs');
const { paymentReversalApiProofFixture } = require('./fixtures/payment-reversal-api-proof-fixture.cjs');
const editJson = (object, key, mutate) => { const value = JSON.parse(object[key]); mutate(value); object[key] = JSON.stringify(value); };
test('independent API validator accepts an explicitly synthetic complete raw fixture, not business acceptance', () => {
  const proof = verifyPaymentReversalApiProof(paymentReversalApiProofFixture());
  assert.equal(proof.states, 5); assert.equal(proof.approvalEffects, 1);
  assert.match(proof.scope, /API\/database proof only/);
});
test('independent API validator accepts raw Prisma Date values and serialized ISO values equivalently', () => {
  const evidence=paymentReversalApiProofFixture();
  for(const payment of [evidence.originalPayment,...evidence.stages.flatMap(stage=>stage.order.paymentRecords)])
    for(const name of ['date','createdAt','updatedAt']) payment[name]=new Date(payment[name]);
  for(const request of evidence.requests) for(const name of ['createdAt','reviewedAt']) request[name]=new Date(request[name]);
  for(const effect of evidence.reversals) effect.createdAt=new Date(effect.createdAt);
  for(const event of evidence.events) event.createdAt=new Date(event.createdAt);
  for(const audit of evidence.audits) audit.createdAt=new Date(audit.createdAt);
  assert.equal(verifyPaymentReversalApiProof(evidence).states,5);
});
const negatives = [
  ['wrong net paid amount', e => { e.stages[2].order.paidAmount = 51; }],
  ['negative final paid amount', e => { e.stages[2].order.paidAmount = -1; }],
  ['stale readback on one instance', e => { e.stages[2].readbacks[1].paidAmount = 350; }],
  ['invented payment status despite unchanged cash amounts', e => { for(const stage of e.stages) { stage.order.paymentStatus='unknown'; for(const readback of stage.readbacks) readback.paymentStatus='unknown'; } }],
  ['different original amount', e => { e.stages[3].order.paymentRecords[0].amount = 301; }],
  ['altered original verifier', e => { e.stages[3].order.paymentRecords[0].verifiedBy = 99; }],
  ['cross-order stage', e => { e.stages[2].order.id = 99; }],
  ['adjustment belonging to another order', e => { e.stages[2].adjustments[0].orderId = 99; }],
  ['reversal silently changes the independent adjustment', e => { e.stages[2].adjustments[0].reason = 'changed after reversal'; }],
  ['extra same-order fake cash hides an adjustment drift', e => { e.stages[2].adjustments[0].amountDelta=20; e.stages[2].order.paymentRecords.push({id:99,orderId:e.orderId,amount:30,status:'verified'}); }],
  ['extra posted effect', e => { e.reversals.push({ ...e.reversals[0], id: 'extra-effect' }); }],
  ['positive reversal amount', e => { e.reversals[0].amount = 300; }],
  ['requester reviews their own request', e => { e.requests[1].reviewedBy = e.requests[1].requestedBy; }],
  ['changed request fingerprint', e => { e.requests[1].fingerprint = 'f'.repeat(64); }],
  ['stored request receipt points to another payment', e => { editJson(e.requests[1], 'requestReceiptJson', r => { r.paymentId = 99; }); }],
  ['stored request receipt uses another request key', e => { editJson(e.requests[1], 'requestReceiptJson', r => { r.requestKey = 'different-request-key'; }); }],
  ['stored original snapshot changes exchange rate', e => { editJson(e.requests[1], 'originalPaymentJson', r => { r.exchangeRate = 2; });
    const r=e.requests[1]; r.fingerprint=require('node:crypto').createHash('sha256').update(JSON.stringify({version:'payment-reversal-request-facts/v1',paymentId:e.paymentId,userId:r.requestedBy,reasonCategory:r.reasonCategory,reason:r.reason,original:r.originalPaymentJson})).digest('hex'); }],
  ['stored review receipt points to another request', e => { editJson(e.requests[0], 'reviewReceiptJson', r => { r.requestId = 'different-request-id'; }); }],
  ['stored review receipt uses another review key', e => { editJson(e.requests[0], 'reviewReceiptJson', r => { r.reviewKey = 'different-review-key'; }); }],
  ['stored review receipt requester was changed', e => { editJson(e.requests[0], 'reviewReceiptJson', r => { r.requestedBy = 99; }); }],
  ['stored review receipt timestamp was changed', e => { editJson(e.requests[0], 'reviewReceiptJson', r => { r.reviewedAt = '2026-10-04T12:00:00.000Z'; }); }],
  ['approval response uses another durable request', e => { e.approval.request.id = e.requests[0].id; }],
  ['same-key race receipt has wrong requester', e => { e.requestSameKeyRace[0].json.data.receipt.requestedBy = 99; }],
  ['different-key race winner has wrong durable identity', e => { e.requestDifferentKeyRace[0].json.data.receipt.requestId = 'different-request-id'; }],
  ['approval race both claim first posting', e => { e.approvalRace[1].json.data.replayed = false; }],
  ['review audit belongs to another actor', e => { e.audits.find(a => a.action === 'PAYMENT_REVERSED').userId = 99; }],
  ['review audit points to another payment', e => { e.audits.find(a => a.action === 'PAYMENT_REVERSED').resourceId = 99; }],
  ['review audit contains another request', e => { editJson(e.audits.find(a => a.action === 'PAYMENT_REVERSED'), 'details', d => { d.requestId = 'different-request-id'; }); }],
  ['verification audit was not used by original request', e => { e.requests[1].originalAuditId = 999; }],
  ['request audit contains another fingerprint', e => { editJson(e.audits.find(a => a.action === 'PAYMENT_REVERSAL_REQUESTED'), 'details', d => { d.fingerprint = 'f'.repeat(64); }); }],
  ['event UUID is malformed but distinct', e => { editJson(e.events[1], 'payloadJson', p => { p.id = 'not-a-uuid'; }); }],
  ['verified and reversed event reuse one UUID', e => { editJson(e.events[1], 'payloadJson', p => { p.id=JSON.parse(e.events[0].payloadJson).id; }); }],
  ['extra duplicate business event', e => { e.events.push({...e.events[1],id:99}); }],
  ['event payload points to another payment', e => { editJson(e.events[1], 'payloadJson', p => { p.data.paymentId = 99; }); }],
  ['event references another aggregate', e => { e.events[1].aggregateId = '99'; }],
  ['event delivery belongs to another row', e => { e.events[1].deliveries[0].eventId = 999; }],
  ['event before balance was changed', e => { editJson(e.events[1], 'payloadJson', p => { p.data.beforePaidAmount = 500; }); }],
  ['event occurrence timestamp mismatches immutable effect', e => { editJson(e.events[1], 'payloadJson', p => { p.occurredAt = '2026-10-04T12:00:00.000Z'; }); }],
  ['immutable snapshot changed after rejected tamper', e => { e.immutableAfterSha256 = 'b'.repeat(64); }],
  ['matching but fabricated immutable hashes are not evidence of raw facts', e => { e.immutableBeforeSha256='a'.repeat(64);e.immutableAfterSha256='a'.repeat(64); }],
  ['arbitrary network error disguised as immutability denial', e => { e.immutableDenials[0].message = 'request timed out'; }],
  ['history shows current 150 as original reversal 50 receipt', e => { e.history[0].reversal.amount = -150; }],
  ['history points to another payment', e => { e.history[0].paymentId = 99; }],
  ['history points to another order', e => { e.history[0].currentOrder.id = 99; }],
  ['history omits a durable rejected request', e => { e.history[0].requests.pop(); }],
  ['historical original payer changed', e => { e.history[0].originalPayment.payerName = 'another payer'; }],
  ['historical reversal receipt was rebased to new cash total', e => { e.history[0].reversal.receipt.afterPaidAmount = 150; }],
];
for (const [name, mutate] of negatives) test(`independent API validator rejects ${name}`, () => {
  const evidence = paymentReversalApiProofFixture(); mutate(evidence);
  assert.throws(() => verifyPaymentReversalApiProof(evidence));
});
