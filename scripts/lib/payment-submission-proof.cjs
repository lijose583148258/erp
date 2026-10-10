// Built-ins only: fail-closed validator also used by the pre-install source gate.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { assertCjkRasterEvidence } = require('./browser-cjk-font-guard.cjs');
function verifyPaymentSubmissionProof(e, provider) {
  assert.equal(e.provider, provider); assert.equal(e.browserErrors.length, 0);
  assert(Number.isSafeInteger(e.orderId) && e.orderId > 0); assert(e.elapsedMs >= 16000);
  const receipt = e.originalReceipt;
  assert.equal(receipt.requestKey, e.key); assert.equal(receipt.orderId, e.orderId); assert.equal(receipt.amount, 300);
  assert.equal(e.burst.length, 8); assert(e.burst.every(r => r.status === 200));
  assert.equal(e.burst.filter(r => r.json.replayed === false).length, 1);
  for (const r of [...e.burst, ...e.responses, e.verifiedReplay]) assert.deepEqual(r.json.paymentSubmission, receipt);
  assert.equal(e.before.payments.length, 1); assert.equal(e.before.submissions.length, 1); assert.equal(e.before.audits.length, 1);
  assert.equal(e.genuineSecondReceipt.amount, 300); assert.notEqual(e.genuineSecondReceipt.paymentId, receipt.paymentId);
  assert.equal(e.twoGenuine.payments.length, 2); assert.equal(Number(e.afterVerification.order.paidAmount), 600);
  const negatives = ['changed-amount','changed-method','changed-date','changed-note','changed-payer','changed-proxy','different-principal','missing-key','different-order','pending-capacity'];
  assert.equal(e.negatives.length, negatives.length); assert.equal(new Set(e.negatives.map(n => n.label)).size, negatives.length);
  for (const label of negatives) {
    const n = e.negatives.find(n => n.label === label); assert(n); assert.equal(n.status, label === 'missing-key' ? 400 : 409);
    assert.equal(n.code, label === 'missing-key' ? 'PAYMENT_SUBMISSION_KEY_REQUIRED' : label === 'pending-capacity' ? 'PAYMENT_SUBMISSION_PENDING_CAPACITY' : 'PAYMENT_SUBMISSION_KEY_CONFLICT');
    if (label === 'different-order') { assert.equal(n.paymentCount, 0); assert.equal(n.auditCount, 0); }
  }
  const b = e.browser; assert.equal(b.role, 'sales'); assert.equal(b.faultRequests, 1); assert(b.lockedUnknownFacts);
  assert.equal(b.committedResponse.status, 200); assert.equal(b.committedResponse.json.replayed, false);
  assert.equal(b.recoveredResponse.status, 200); assert.equal(b.recoveredResponse.json.replayed, true);
  assert.deepEqual(b.committedResponse.json.paymentSubmission, b.originalReceipt); assert.deepEqual(b.recoveredResponse.json.paymentSubmission, b.originalReceipt);
  assert.equal(b.payload.idempotencyKey, b.originalReceipt.requestKey); assert.equal(b.originalReceipt.amount, 300);
  const intents = Object.values(b.storageBefore).map(s => JSON.parse(s)); assert.equal(intents.length, 1);
  assert.equal(intents[0].key, b.originalReceipt.requestKey); assert.equal(intents[0].userId, String(b.actorId)); assert.equal(intents[0].orderId, String(e.orderId));
  for (const key of ['amount','date','method','isProxy','payerName','note']) assert.equal(intents[0].facts[key], b.payload[key]);
  assert.deepEqual(b.storageAfter, []);
  assert.equal(e.restart.killed, 2); assert.equal(e.restart.restarted, 2); assert.equal(e.restart.signal, 'SIGKILL'); assert.equal(e.restart.databaseRestarted, false);
  if (provider === 'postgresql') assert.deepEqual(e.restart.exitCodes, [137,137]);
  assert.deepEqual(e.finalSnapshot, e.afterAllReplays);
  const ai = e.optionalAiModuleFailure;
  assert(ai && Number.isInteger(ai.failedRequests) && ai.failedRequests >= 1);
  assert.equal(ai.recovered, true); assert(ai.screenshot);
  assert(ai.issues.some(issue => issue.scope === 'page-error-boundary:ai-tools'));
  assert(!ai.issues.some(issue => issue.scope === 'root-error-boundary'));
  assert.deepEqual(ai.afterRecovery, e.finalSnapshot);
  const page = e.businessPageRecovery;
  assert(page && Number.isInteger(page.failedRequests) && page.failedRequests >= 1);
  assert.equal(page.reloadClicks, 1); assert.equal(page.recovered, true);
  assert(page.issues.some(issue => issue.scope === 'page-error-boundary:orders'));
  assert(!page.issues.some(issue => issue.scope === 'root-error-boundary'));
  assert.deepEqual(page.storageAtFailure, b.storageBefore);
  const { payments, submissions, audits, order } = e.finalSnapshot;
  assert.equal(payments.length, 3); assert.equal(submissions.length, 3); assert.equal(audits.length, 3);
  assert(payments.every(p => Number(p.amount) === 300 && p.status === 'verified' && p.orderId === e.orderId));
  assert.equal(Number(order.paidAmount), 900); assert.equal(order.paymentStatus, 'partial');
  const expectedReceipts = [receipt,e.genuineSecondReceipt,b.originalReceipt];
  for (const r of expectedReceipts) {
    const submission = submissions.find(s => s.paymentId === r.paymentId), payment = payments.find(p => p.id === r.paymentId), audit = audits.find(a => a.id === r.auditId);
    assert(submission && payment && audit); assert.deepEqual(JSON.parse(submission.resultJson), r);
    assert.equal(submission.requestKey, r.requestKey); assert.equal(submission.userId, r.submittedBy);
    const details = JSON.parse(audit.details); assert.equal(details.paymentId, payment.id); assert.equal(details.fingerprint, submission.fingerprint);
    assert.equal(details.submissionKeyHash, crypto.createHash('sha256').update(r.requestKey).digest('hex'));
    assert.equal(audit.action, 'PAYMENT_SUBMITTED'); assert.equal(audit.resourceId, e.orderId); assert.equal(audit.userId, r.submittedBy);
    assert.equal(new Date(payment.date).toISOString(), r.date); assert.equal(payment.method, r.method);
  }
  assert.equal(e.apiReadbacks.length, 2); assert.equal(new Set(e.apiReadbacks.map(r => r.instance)).size, 2);
  assert(e.apiReadbacks.every(r => r.orderId === e.orderId && Number(r.paidAmount) === 900 && r.count === 3 && r.paymentStatus === 'partial'));
  assert.equal(e.screenshots.length, 3); assert.equal(e.screenshots.filter(s => s.kind === 'unknown-ack').length, 1);
  const finance = e.screenshots.filter(s => s.kind === 'finance-readback'); assert.equal(finance.length, 2); assert.equal(new Set(finance.map(s => s.actorId)).size, 2);
  for (const s of e.screenshots) { assert(s.path); assertCjkRasterEvidence(s.font); }
  assert(finance.every(s => s.statusVisible && s.amountVisible && s.text.includes('300.00') && s.text.includes('已核销')));
  assert.deepEqual(e.immutabilityGuards, [{ operation: 'update', rejected: true }, { operation: 'delete', rejected: true }]);
  for (const race of [e.crossOrderRace,e.capacityRace]) {
    assert.deepEqual([...race.statuses].sort(), [200,409]); assert.equal(race.paymentCount, 1); assert.equal(race.auditCount, 1); assert.equal(race.identityCount, 1);
  }
  assert.equal(new Set(e.crossOrderRace.orderIds).size, 2); assert.equal(e.capacityRace.amount, 600);
  return { registrations: 3, submissionAudits: 3, paidAmount: 900, sameKeyConcurrentRequests: 8, negativeCases: 10, financeBrowsers: 2, databaseRestarted: false };
}
module.exports = { verifyPaymentSubmissionProof };
