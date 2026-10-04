const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { verifyPaymentReversalBrowserProof: verify } = require('./lib/payment-reversal-browser-proof.cjs');
const { paymentReversalBrowserProofFixture: fixture } = require('./fixtures/payment-reversal-browser-proof-fixture.cjs');
// Every case is synthetic. Passing this file establishes validator coverage, never real business execution.
for(const provider of ['sqlite','postgresql']) test(`SYNTHETIC valid raw ${provider} fixture, no business promotion`,()=>{
  const proof=verify(fixture(provider),provider); assert.equal(proof.synthetic,true); assert.equal(proof.legacyEvidence,false); assert.equal(proof.orderPaid,50);
  assert.equal(proof.databaseRestartVerified,false); assert.equal(proof.imagesVisuallyInspected,false);
});

test('Live Prisma Dates and persisted ISO evidence have identical strict proof without mutating input',()=>{
  const e=fixture('sqlite'), serialized=JSON.parse(JSON.stringify(e));
  const dateKeys=new Set(['date','createdAt','updatedAt','reviewedAt','appliedAt','nextAttemptAt','leaseExpiresAt','deliveredAt']);
  const dates=value=>{
    if(Array.isArray(value)) { for(const item of value) dates(item); return; }
    if(!value||typeof value!=='object') return;
    for(const [key,item]of Object.entries(value)) {
      if(dateKeys.has(key)&&typeof item==='string'&&/^\d{4}-\d\d-\d\dT/.test(item)) value[key]=new Date(item);
      else dates(item);
    }
  };
  for(const field of ['originalPayment','initialSnapshot','afterRequestSnapshot','beforeSnapshot','finalSnapshot','claimBeforeCrash','claimAfterKill','deliveryAfterRecovery']) dates(e[field]);
  assert(e.originalPayment.date instanceof Date);
  assert.deepEqual(verify(e,'sqlite'),verify(serialized,'sqlite'));
  assert(e.originalPayment.date instanceof Date,'Validator must not rewrite executor evidence');
  e.originalPayment.date=new Date('invalid');
  assert.throws(()=>verify(e,'sqlite'),'Invalid Dates still fail closed');
});
test('Explicit historical compatibility is weaker and cannot pass the default fresh gate',()=>{
  const e=fixture(); e.version='payment-reversal-browser/v1'; assert.throws(()=>verify(e,'sqlite'));
  const proof=verify(e,'sqlite',{allowLegacy:true}); assert.equal(proof.legacyEvidence,true); assert.equal(proof.transportTraceVerified,false); assert.equal(proof.explicitProfilesVerified,false);
});
test('passed flags and report summaries never replace raw observations',()=>{
  assert.throws(()=>verify({version:'payment-reversal-browser/v2',provider:'sqlite',passed:true,status:'passed',proof:{financeActors:2,orderPaid:50}},'sqlite'));
});
const negatives=[
  ['provider substitution',e=>{e.provider='postgresql';}],
  ['missing raw stage',e=>{delete e.afterRequestSnapshot;}],
  ['browser exception',e=>{e.errors.push('runtime exception');}],
  ['same finance identity',e=>{e.financeActors[1].id=e.financeActors[0].id;}],
  ['administrator mislabeled finance',e=>{e.financeActors[0].role='admin';}],
  ['missing actual login profile',e=>{delete e.financeActors[0].loginProfile;}],
  ['login id substituted',e=>{e.financeActors[0].loginProfile.id=999;}],
  ['finance explicit empty permissions',e=>{e.financeActors[0].loginProfile.permissions=[]; e.financeActors[0].browserProfiles[0].profile.permissions=[];}],
  ['missing review grant',e=>{e.financeActors[1].loginProfile.permissions=['orders.payment.reversal.request'];}],
  ['missing finance scope',e=>{e.financeActors[0].loginProfile.dataScopes=[];}],
  ['missing browser authentication read',e=>{e.financeActors[0].browserProfiles=[];}],
  ['cached role differs from real browser authentication',e=>{e.financeActors[0].browserProfiles[0].profile.role='sales';}],
  ['auth response not HTTP200',e=>{e.financeActors[0].browserProfiles[0].actualHTTP=401;}],
  ['same application origin',e=>{e.financeActors[1].browserProfiles[0].url=e.financeActors[0].browserProfiles[0].url;}],
  ['original amount rewritten',e=>{e.beforeSnapshot.payment.amount=0;}],
  ['original date rewritten',e=>{e.finalSnapshot.payment.date='2026-10-02T16:00:00.000Z';}],
  ['original verifier rewritten',e=>{e.beforeSnapshot.payment.verifiedBy=104;}],
  ['terminal payment revived',e=>{e.finalSnapshot.payment.status='verified';}],
  ['unknown payment status interpreted as pending',e=>{e.beforeSnapshot.payment.status='unrecognized';}],
  ['barter disguised as cash',e=>{e.originalPayment.barterMetadata={barterSettlementId:1};}],
  ['foreign currency silently defaulted CNY',e=>{e.originalPayment.currency='USD';}],
  ['negative effect duplicated',e=>{e.beforeSnapshot.effects.push({...e.beforeSnapshot.effects[0],id:'00000099-0000-4000-8000-000000000000'});}],
  ['independent finance adjustment erased',e=>{e.beforeSnapshot.adjustments=[];}],
  ['independent finance adjustment mutated after recovery',e=>{e.finalSnapshot.adjustments[0].amountDelta=0;}],
  ['nonfinite money',e=>{e.beforeSnapshot.order.paidAmount=NaN;}],
  ['request financially changes order',e=>{e.afterRequestSnapshot.order.paidAmount=50;}],
  ['request effect before approval',e=>{e.afterRequestSnapshot.effects.push(e.beforeSnapshot.effects[0]);}],
  ['request original snapshot altered',e=>{e.beforeSnapshot.requests[0].originalPaymentJson='{}';}],
  ['request fingerprint unbound',e=>{e.beforeSnapshot.requests[0].fingerprint='0'.repeat(64);}],
  ['review fingerprint unbound',e=>{e.beforeSnapshot.requests[0].reviewFingerprint='0'.repeat(64);}],
  ['self-approved DB history',e=>{e.beforeSnapshot.requests[0].reviewedBy=103;}],
  ['original request receipt regenerated at terminal status',e=>{const r=e.beforeSnapshot.requests[0]; const v=JSON.parse(r.requestReceiptJson); v.status='posted'; r.requestReceiptJson=JSON.stringify(v);}],
  ['request audit reused',e=>{e.beforeSnapshot.requests[0].requestAuditId=58;}],
  ['approval audit attribution forged',e=>{e.beforeSnapshot.audits[2].userId=103;}],
  ['request audit rewritten after approval',e=>{e.beforeSnapshot.audits[1].details='{}';}],
  ['original audit erased',e=>{e.beforeSnapshot.audits.shift();}],
  ['original event erased',e=>{e.beforeSnapshot.events.shift();}],
  ['new business-event UUID absent',e=>{e.eventId=null;}],
  ['forged UUID reused across financial events',e=>{const r=e.beforeSnapshot.events[1]; const p=JSON.parse(r.payloadJson); p.id=JSON.parse(e.initialSnapshot.events[0].payloadJson).id; r.payloadJson=JSON.stringify(p);}],
  ['wrong negative effect event',e=>{const r=e.beforeSnapshot.events[1]; const p=JSON.parse(r.payloadJson); p.data.amount=300; r.payloadJson=JSON.stringify(p);}],
  ['request HTTP did not commit',e=>{e.requestLostAck.httpStatus=409;}],
  ['request actual response transport absent',e=>{delete e.requestLostAck.actualHTTP;}],
  ['response drop observed before committed response',e=>{e.requestLostAck.responseDroppedAt='2026-10-03T16:00:09.000Z';}],
  ['request network endpoint substituted',e=>{e.requestLostAck.url='http://127.0.0.1:5006/api/orders/12/payment';}],
  ['review sent to wrong application',e=>{e.reviewLostAck.url=e.reviewLostAck.url.replace('5008','5006');}],
  ['lost receipt not raw original receipt',e=>{e.requestLostAck.response.data.receipt.auditId=999;}],
  ['lost request regenerated identity',e=>{e.requestLostAck.body.requestKey='reversal-00000099-0000-4000-8000-000000000000';}],
  ['persisted request identity silently cleared',e=>{e.requestIntentBeforeReload=[];}],
  ['persisted review identity replaced',e=>{e.reviewIntentBeforeReload[0].key='reversal-00000099-0000-4000-8000-000000000000';}],
  ['unknown review facts changed under same identity',e=>{e.reviewIntentBeforeReload[0].facts.decision='reject';}],
  ['unresolved request intent remains after readback',e=>{e.requestIntentAfterReadback=['stale-intent'];}],
  ['one application replay absent',e=>{e.replays.pop();}],
  ['replay generated new receipt',e=>{e.replays[1].review.receipt.afterPaidAmount=0;}],
  ['replay reports new financial effect',e=>{e.replays[0].request.replayed=false;}],
  ['self-review accepted',e=>{e.selfReview.status=200;}],
  ['self-review denied for unrelated reason',e=>{e.selfReview.json.errorCode='UNRELATED';}],
  ['terminal re-verification accepted',e=>{e.verifyReentry[1].status=200;}],
  ['database restart misreported as application-only recovery',e=>{e.restart.databaseRestarted=true;}],
  ['graceful shutdown substituted',e=>{e.restart.signal='SIGTERM';}],
  ['no actual killed application exit',e=>{e.restart.exit[0].signal=null;}],
  ['claim released or rewritten during crash',e=>{e.claimAfterKill.status='pending';}],
  ['original claim not a sending lease',e=>{e.claimBeforeCrash.leaseToken=null;}],
  ['crash occurs after leased window',e=>{e.claimAfterKillObservedAt='2026-10-03T16:00:46.000Z';}],
  ['recovery bypasses unexpired lease',e=>{e.receiver.attempts[2].at='2026-10-03T16:00:44.000Z';}],
  ['database delivered before consumer ACK',e=>{e.deliveryAfterRecovery.deliveredAt='2026-10-03T16:00:44.000Z';}],
  ['no real HTTP503',e=>{e.receiver.attempts[0].status=202;}],
  ['no consumer ACK loss',e=>{e.receiver.attempts[1].status=202;}],
  ['invalid signed payload accepted',e=>{e.receiver.attempts[1].signatureValid=false;}],
  ['digest only internally consistent but not raw persisted bytes',e=>{for(const a of [...e.receiver.attempts,...e.receiver.accepted]) a.digest='0'.repeat(64);}],
  ['consumer negative effect duplicated',e=>{e.receiver.accepted[0].effects=2;}],
  ['consumer accepts only after recovery instead of before crash',e=>{e.receiver.accepted[0].acceptedAt=e.receiver.attempts[2].at;}],
  ['recovery attempt does not release lease',e=>{e.deliveryAfterRecovery.leaseToken=e.claimBeforeCrash.leaseToken;}],
  ['missing realtime event',e=>{e.frames=[[],[]];}],
  ['realtime sends original verification UUID',e=>{e.frames[0][0].id=JSON.parse(e.initialSnapshot.events[0].payloadJson).id;}],
  ['sales receives financial realtime audience',e=>{e.frames[0][0].audience.roles.push('sales');}],
  ['second real finance browser screenshot missing',e=>{e.screenshots.pop();}],
  ['finance evidence contains only stale total',e=>{e.screenshots[0].text=e.screenshots[0].text.replace('最新订单累计已收：CNY 50.00','最新订单累计已收：CNY 350.00');}],
  ['unobscured flag false',e=>{e.screenshots[0].unobscured=false;}],
  ['missing CJK glyph raster',e=>{e.screenshots[0].font.glyphs=[];}],
  ['missing glyph box treated as Chinese',e=>{e.screenshots[0].font.glyphs[0].signature='missing1';}],
  ['reversed payment still has verify UI',e=>{e.screenshots[0].verifyButtons=1;}],
  ['sales granted illegal reversal capability',e=>{e.salesReadOnly.loginProfile.permissions.push('orders.payment.reversal.request');}],
  ['sales has request form',e=>{e.salesReadOnly.requestButtons=1;}],
  ['sales original record invisible',e=>{e.salesReadOnly.originalVisible=false;}],
  ['sales read-only actual DOM missing',e=>{e.salesReadOnly.text=e.salesReadOnly.text.replace('当前角色只读','');}],
  ['order readback stale on second instance',e=>{e.finalReadbacks[1].paidAmount=350;}],
  ['original amount removed from final API',e=>{e.finalReadbacks[0].paymentRecords[0].amount=-300;}],
];
for(const [label,mutate] of negatives) test(`SYNTHETIC fail closed: ${label}`,()=>{ const e=fixture(); mutate(e); assert.throws(()=>verify(e,'sqlite')); });
test('PostgreSQL needs exactly one matching realtime notification on each app',()=>{const e=fixture('postgresql'); e.frames[1]=[]; assert.throws(()=>verify(e,'postgresql'));});
test('Cloud Docker SIGKILL exit codes are supported without any DB restart claim',()=>{const e=fixture('postgresql'); delete e.restart.exit; e.restart.exitCodes=[137,137]; assert.equal(verify(e,'postgresql').applicationCrashVerified,true); e.restart.exitCodes[1]=0; assert.throws(()=>verify(e,'postgresql'));});
test('Source instrumentation observes actual committed HTTP then actual route.abort completion',()=>{
  const source=fs.readFileSync(path.join(__dirname,'lib/payment-reversal-browser-probe.cjs'),'utf8');
  assert.match(source,/version:'payment-reversal-browser\/v2'/); assert.equal((source.match(/await route\.fetch\(\)/g)||[]).length,2);
  assert.equal((source.match(/committedResponseReceivedAt:new Date\(\)\.toISOString\(\)/g)||[]).length,2);
  assert.match(source,/await route\.abort\('connectionfailed'\); droppedRequest\.responseDroppedAt=new Date\(\)\.toISOString\(\)/);
  assert.match(source,/await route\.abort\('connectionfailed'\); droppedReview\.responseDroppedAt=new Date\(\)\.toISOString\(\)/);
  assert.match(source,/profile\(actor\.loginUser\)/); assert.match(source,/page\.waitForResponse/); assert.match(source,/assert\.deepEqual\(actual,identity\.loginProfile\)/);
  assert.match(source,/collection-reversal-request-submit'\)\.click\(\)/); assert.match(source,/collection-reversal-review-submit-\$\{requestId\}`\)\.click\(\)/);
  assert.match(source,/e\.claimAfterKillObservedAt=new Date/); assert.match(source,/requestButtons:await salesModal/);
  assert(!/prisma\.[A-Za-z]+\.(?:create|update|delete|upsert)\(/.test(source),'Probe must not patch business database to manufacture evidence');
  assert(!source.includes('payment-reversal-browser-proof-fixture'),'Synthetic fixture is forbidden in real executor');
});
test('Crash helper is scoped to two owned applications, not database services',()=>{
  const source=fs.readFileSync(path.join(__dirname,'lib/enterprise-round2-app-restart.cjs'),'utf8');
  assert.match(source,/const services = \['app-primary', 'app-secondary'\]/); assert.match(source,/'compose', 'kill', '-s', 'SIGKILL', \.\.\.services/);
  assert.match(source,/ROUND2_ALLOW_MUTATIONS/); assert.match(source,/GITHUB_RUN_ID/); assert.match(source,/databaseRestarted: false/);
  assert(!source.includes("'postgres'")); assert(!source.includes("'database'"));
});
