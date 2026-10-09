const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {verifyPaymentSubmissionProof}=require('./lib/payment-submission-proof.cjs');
const {paymentSubmissionProofFixture}=require('./fixtures/payment-submission-proof-fixture.cjs');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
test('strict registration proof accepts SQLite and PostgreSQL fixtures without conflating app and DB restart',()=>{
  for(const provider of ['sqlite','postgresql'])assert.equal(verifyPaymentSubmissionProof(paymentSubmissionProofFixture(provider),provider).registrations,3);
});
for(const [name,mutate] of [
  ['expired-time-window-not-replayed',e=>{e.elapsedMs=100;}],['duplicate-burst-owner',e=>{e.burst[1].json.replayed=false;}],
  ['different-key-on-browser-retry',e=>{e.browser.recoveredResponse.json.paymentSubmission={...e.browser.originalReceipt,requestKey:'new-key'};}],
  ['no-real-commit-before-lost-ack',e=>{e.browser.committedResponse.status=500;}],['no-process-crash',e=>{e.restart.killed=0;}],
  ['wrong-cloud-exit',e=>{e.restart.exitCodes=[0,0];}],['facts-unlocked-after-unknown',e=>{e.browser.lockedUnknownFacts=false;}],
  ['lost-local-request-identity',e=>{e.browser.storageBefore={};}],['failed-identity-cleanup',e=>{e.browser.storageAfter=['slot'];}],
  ['cross-order-record-leak',e=>{e.negatives.find(n=>n.label==='different-order').paymentCount=1;}],
  ['missing-negative-case',e=>{e.negatives.pop();}],['duplicated-audit',e=>{e.finalSnapshot.audits.push(e.finalSnapshot.audits[0]);e.afterAllReplays=structuredClone(e.finalSnapshot);}],
  ['duplicate-money',e=>{e.finalSnapshot.order.paidAmount=1200;e.afterAllReplays=structuredClone(e.finalSnapshot);}],
  ['altered-receipt',e=>{e.finalSnapshot.submissions[0].resultJson='{}';e.afterAllReplays=structuredClone(e.finalSnapshot);}],
  ['no-second-node-readback',e=>{e.apiReadbacks.pop();}],['covered-finance-amount',e=>{e.screenshots[1].amountVisible=false;}],
  ['one-finance-actor-twice',e=>{e.screenshots[2].actorId=e.screenshots[1].actorId;}],['missing-Chinese-glyphs',e=>{e.screenshots[0].font.glyphs=[];}],
  ['mutable-ledger',e=>{e.immutabilityGuards[0].rejected=false;}],
  ['missing-ai-fault-proof',e=>{delete e.optionalAiModuleFailure;}],
  ['cached-ai-module-not-faulted',e=>{e.optionalAiModuleFailure.failedRequests=0;}],
  ['root-shell-crashed',e=>{e.optionalAiModuleFailure.issues.push({scope:'root-error-boundary'});}],
  ['no-local-ai-boundary',e=>{e.optionalAiModuleFailure.issues=[];}],
  ['ai-not-recovered',e=>{e.optionalAiModuleFailure.recovered=false;}],
  ['ai-recovery-duplicated-payment',e=>{e.optionalAiModuleFailure.afterRecovery.order.paidAmount=1200;}],
  ['missing-page-recovery',e=>{delete e.businessPageRecovery;}],
  ['no-core-page-fault',e=>{e.businessPageRecovery.failedRequests=0;}],
  ['unbounded-page-reloads',e=>{e.businessPageRecovery.reloadClicks=2;}],
  ['failed-user-page-recovery',e=>{e.businessPageRecovery.recovered=false;}],
  ['lost-intent-on-page-failure',e=>{e.businessPageRecovery.storageAtFailure={};}],
  ['cross-order-loser-not-rolled-back',e=>{e.crossOrderRace.paymentCount=2;}],['concurrent-over-capacity',e=>{e.capacityRace.amount=1200;}],
])test(`submission proof rejects ${name}`,()=>{const e=paymentSubmissionProofFixture();mutate(e);assert.throws(()=>verifyPaymentSubmissionProof(e,'postgresql'));});
test('active submission boundary is durable and all accepted identities are append-only',()=>{
  const service=read('backend/src/services/payment-submission.service.ts');
  for(const token of ['paymentSubmission.findUnique','paymentSubmission.create','auditLog.create','paymentRecord.create','Prisma.TransactionIsolationLevel.Serializable','PAYMENT_SUBMISSION_KEY_CONFLICT'])assert(service.includes(token));
  const controller=read('backend/src/controllers/order-payment.controller.ts');assert(controller.includes('normalizePaymentSubmissionKey'));assert(!controller.includes('15000'));
  const sqlite=read('backend/src/database/runtime-schema-payment-submission-repair.ts'),pg=read('backend/prisma/postgres-migrations/202610030001_payment-submission-identities/migration.sql');
  for(const sql of [sqlite,pg])assert(sql.includes('PAYMENT_SUBMISSION_IMMUTABLE')&&sql.includes('payment_submissions_request_key_key'));
  assert(pg.includes('jsonb_typeof')&&pg.includes('ON DELETE RESTRICT'));assert(sqlite.includes('json_type'));
  const workflow=read('.github/workflows/enterprise-cloud-sandbox.yml');assert(workflow.includes('scripts/payment-submission-migration-audit-v1.cjs'));assert(workflow.includes('test:unit:payment-submission'));
});
