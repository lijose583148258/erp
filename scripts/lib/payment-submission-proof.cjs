// Built-ins only: fail-closed validator also used by the pre-install source gate.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { assertCjkRasterEvidence } = require('./browser-cjk-font-guard.cjs');
const { paymentWorkforceProfile } = require('./enterprise-round2-payment-actor-proof.cjs');
function verifyWorkforce(e) {
  const w = e.workforce; assert.equal(w.version, 'payment-submission-workforce/v1');
  assert.equal(w.cohort.length, 20); assert.equal(new Set(w.cohort.map(row => row.id)).size, 20);
  const people = {};
  for (const [duty, job, index] of [['sales','sales',3], ['requester','receivables',1], ['reviewer','owner',1]]) {
    const row = w.actors[duty]; assert.equal(row.job, job); assert.equal(row.index, index);
    const cohort = w.cohort.filter(person => person.id === row.actorId); assert.equal(cohort.length, 1);
    assert.equal(cohort[0].job, job); assert.equal(cohort[0].index, index); assert.equal(cohort[0].role, row.role);
    const actor = { ...row, id: row.actorId, account: { username: row.profile.username, role: row.role, segment: row.profile.segment } };
    paymentWorkforceProfile(row.profile, actor); people[duty] = actor;
    const profiles = w.profiles.filter(p => p.duty === duty); assert.equal(profiles.length, 2);
    assert.deepEqual(profiles.map(p => p.instance).sort(), [0,1]);
    for (const p of profiles) { assert.equal(p.actorId, actor.id); paymentWorkforceProfile(p.profile, actor); }
    const sessions = w.sessions.filter(p => p.duty === duty); assert.equal(sessions.length, 1);
    const session = sessions[0]; assert.equal(session.actorId, actor.id); assert.equal(session.instance, duty === 'reviewer' ? 1 : 0);
    assert.equal(session.authorizationMatched, true); paymentWorkforceProfile(session.profile, actor);
  }
  assert.equal(new Set(Object.values(people).map(person => person.id)).size, 3);
  assert.equal(w.profiles.length, 6); assert.equal(w.sessions.length, 3);
  const { sales, requester, reviewer } = people;
  assert.equal(e.browser.actorId, sales.id); assert.equal(e.browser.role, sales.role);
  assert.equal(w.order.id, e.orderId); assert.equal(w.order.createdBy, sales.id);
  assert.equal(w.customer.salespersonId, sales.id); assert.equal(w.order.customerId, w.customer.id);
  for (const snapshot of [e.before,e.twoGenuine,e.afterVerification,e.finalSnapshot,e.afterAllReplays]) assert.equal(snapshot.order.createdBy, sales.id);
  for (const receipt of [e.originalReceipt,e.genuineSecondReceipt,e.browser.originalReceipt]) assert.equal(receipt.submittedBy, sales.id);
  assert(e.finalSnapshot.submissions.every(row => row.userId === sales.id));
  assert(e.finalSnapshot.audits.every(row => row.userId === sales.id));
  assert(e.finalSnapshot.payments.every(row => row.verifiedBy === requester.id));
  assert.equal(w.verificationAudits.length, 3);
  for (const payment of e.finalSnapshot.payments) {
    const rows = w.verificationAudits.filter(row => row.resourceId === payment.id); assert.equal(rows.length, 1);
    assert.equal(rows[0].resource, 'payment'); assert.equal(rows[0].action, 'PAYMENT_VERIFIED'); assert.equal(rows[0].userId, requester.id);
  }
  assert.equal(e.negatives.find(row => row.label === 'different-principal').actorId, requester.id);
  assert.equal(w.nativeRequests.length, 4);
  for (const phase of ['lost-ack','recovered-ack']) {
    const rows = w.nativeRequests.filter(row => row.phase === phase); assert.equal(rows.length, 1);
    const row = rows[0]; assert.equal(row.actorId, sales.id); assert.equal(row.role, sales.role); assert.equal(row.instance, 0);
    assert.equal(row.method, 'POST'); assert.equal(row.path, `/api/orders/${e.orderId}/payment`);
  }
  for (const [instance, actor] of [requester, reviewer].entries()) {
    const api = e.apiReadbacks.filter(row => row.instance === instance); assert.equal(api.length, 1); assert.equal(api[0].actorId, actor.id);
    const screenshots = e.screenshots.filter(row => row.kind === 'finance-readback' && row.instance === instance);
    assert.equal(screenshots.length, 1); assert.equal(screenshots[0].actorId, actor.id);
    const native = w.nativeRequests.filter(row => row.phase === 'collections-readback' && row.instance === instance); assert.equal(native.length, 1);
    const row = native[0]; assert.equal(row.actorId, actor.id); assert.equal(row.role, actor.role);
    assert.equal(row.method, 'GET'); assert.equal(row.path, '/api/collections/workbench');
    assert.equal(row.payment.id, e.browser.originalReceipt.paymentId); assert.equal(row.payment.amount, 300); assert.equal(row.payment.status, 'verified');
  }
  for (const row of w.nativeRequests) { assert.equal(row.status, 200); assert.equal(row.authorizationMatched, true); }
}
function verifyPaymentSubmissionProof(e, provider) {
  assert.equal(e.provider, provider); assert.equal(e.browserErrors.length, 0);
  const boot = e.bootstrapRecovery; assert.equal(boot.version, 'bootstrap-script-failure/v1');
  assert.match(boot.mainEntryPath, /^\/assets\/index-[^/]+\.js$/); assert.equal(boot.cases.length, 2);
  for (const [index, kind, blockedPath] of [[0, 'legacy-script', '/app-shell.js'], [1, 'main-entry', boot.mainEntryPath]]) {
    const row = boot.cases[index]; assert.equal(row.kind, kind); assert.equal(row.blockedPath, blockedPath);
    assert.deepEqual(row.failedScriptPaths, [blockedPath]); assert.equal(row.readyState, 'complete'); assert(row.screenshot);
    assert.equal(row.loadingCount, index); assert(index === 0 ? row.rootChildren > 0 : row.rootChildren === 0);
  }
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
  const b = e.browser; assert.equal(b.role, e.workforce ? e.workforce.actors.sales.role : 'sales'); assert.equal(b.faultRequests, 1); assert(b.lockedUnknownFacts);
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
  if (e.workforce) verifyWorkforce(e);
  return { registrations: 3, submissionAudits: 3, paidAmount: 900, sameKeyConcurrentRequests: 8, negativeCases: 10, financeBrowsers: 2, databaseRestarted: false };
}
module.exports = { verifyPaymentSubmissionProof };
