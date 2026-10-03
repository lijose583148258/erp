const assert = require('node:assert/strict');
const { assertCjkRasterEvidence } = require('./browser-cjk-font-guard.cjs');

function verifyPaymentEventProof(e, provider) {
  assert.equal(e.provider, provider); assert.equal(e.errors.length, 0);
  assert(Number.isSafeInteger(e.paymentId) && Number.isSafeInteger(e.orderId));
  assert.equal(e.browser.length, 2); assert.equal(new Set(e.browser.map(b => b.actorId)).size, 2);
  assert(e.browser.every(b => b.role === 'finance' && b.pendingVisible));
  assert.equal(e.browserVerification.httpStatus, 200); assert.equal(e.browserVerification.entry, 'collections');
  assert.equal(e.restart.killed, 2); assert.equal(e.restart.restarted, 2); assert.equal(e.restart.signal, 'SIGKILL');
  assert.equal(e.restart.databaseRestarted, false);
  assert.equal(e.claimBeforeCrash.status, 'sending'); assert.equal(e.claimAfterKill.status, 'sending');
  assert.equal(e.claimAfterKill.leaseToken, e.claimBeforeCrash.leaseToken); assert(e.claimAfterKill.leaseToken);
  const receipt = e.deliveryAfterRecovery;
  assert.equal(receipt.status, 'delivered'); assert(receipt.attempts >= 3);
  assert.equal(receipt.leaseToken, null); assert.equal(receipt.leaseExpiresAt, null);
  assert(Date.parse(receipt.deliveredAt) >= Date.parse(e.claimBeforeCrash.leaseExpiresAt), 'Recovery must wait for the real original lease to expire');
  assert.deepEqual(e.beforeSnapshot, e.finalSnapshot, 'Financial facts/history changed during recovery');
  const { payment, order, audits, events } = e.finalSnapshot;
  assert.equal(payment.id, e.paymentId); assert.equal(payment.orderId, e.orderId); assert.equal(payment.status, 'verified');
  assert.equal(Number(payment.amount), 300); assert.equal(Number(order.paidAmount), 300); assert.equal(order.paymentStatus, 'partial');
  assert.equal(audits.length, 1); assert.equal(events.length, 1); assert.equal(events[0].eventKey, `payment.verified:${e.paymentId}`);
  const event = JSON.parse(events[0].payloadJson); assert.equal(event.data.auditId, audits[0].id);
  assert.equal(JSON.parse(audits[0].details).eventId, event.id);
  assert.equal(e.crossEntryReplays.length, 8); assert(e.crossEntryReplays.every(r => r.httpStatus === 200));
  assert.equal(new Set(e.crossEntryReplays.map(r => r.entry)).size, 2); assert.equal(new Set(e.crossEntryReplays.map(r => r.instance)).size, 2);
  assert.equal(e.apiReadbacks.length, 2); assert(e.apiReadbacks.every(r => Number(r.paidAmount) === 300 && r.paymentCount === 1 && r.paymentStatus === 'partial'));
  assert.equal(e.deliveryReceipts.length, 2);
  assert(e.deliveryReceipts.every(r => r.status === 'delivered' && r.eventId === events[0].id));
  assert.deepEqual(e.deliveryReceipts.map(r => r.channel).sort(), ['realtime', 'webhook']);
  const attempts = e.receiver.attempts;
  assert(attempts.length >= 3 && attempts[0].status === 503 && attempts.some(a => a.status === 'ack-withheld') && attempts.some(a => a.status === 202));
  assert(attempts.every(a => a.eventId === event.id && a.digest === attempts[0].digest && a.signatureValid));
  assert.equal(e.receiver.accepted.length, 1); const accepted = e.receiver.accepted[0];
  assert.equal(accepted.eventId, event.id); assert.equal(accepted.effects, 1); assert.equal(accepted.amount, 300); assert.equal(accepted.digest, attempts[0].digest);
  assert.equal(e.screenshots.length, 2);
  for (const shot of e.screenshots) { assert(shot.path && shot.unobscured && shot.statusVisible && shot.amountVisible && shot.loadingHidden); assert(shot.text.includes('已核销') && shot.text.includes('300')); assertCjkRasterEvidence(shot.font); }
  assert.equal(e.frames.length, 2); const frames = e.frames.flat();
  assert.equal(frames.length, provider === 'postgresql' ? 2 : 1); assert(frames.every(f => f.id === event.id && Number(f.resourceId) === e.paymentId));
  if (provider === 'postgresql') assert(e.frames.every(f => f.length === 1));
  return { paymentId: e.paymentId, eventId: event.id, financialEffects: 1, auditCount: 1, eventCount: 1,
    downstreamEffects: accepted.effects, transportAttempts: attempts.length, financeBrowsers: 2, databaseRestarted: false };
}
module.exports = { verifyPaymentEventProof };
