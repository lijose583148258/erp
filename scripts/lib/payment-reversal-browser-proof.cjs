const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { assertCjkRasterEvidence } = require('./browser-cjk-font-guard.cjs');
const sha = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const positive = value => assert(Number.isSafeInteger(value) && value > 0, 'Positive persisted identifier required');
const uuid = value => assert.match(value, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
const iso = value => { assert.equal(typeof value, 'string'); const time = Date.parse(value); assert(Number.isFinite(time)); assert.equal(new Date(time).toISOString(), value); return time; };
const cents = value => { assert(Number.isFinite(value)); const n = Math.round(value * 100); assert(Number.isSafeInteger(n) && Math.abs(value * 100 - n) < 1e-7); return n; };
const json = value => { assert.equal(typeof value, 'string'); return JSON.parse(value); };
const one = (values, predicate = () => true) => { assert(Array.isArray(values)); const found = values.filter(predicate); assert.equal(found.length, 1); return found[0]; };
const facts = p => ({version:'original-payment-facts/v1',id:p.id,orderId:p.orderId,amount:p.amount,currency:p.currency,exchangeRate:p.exchangeRate,baseAmount:p.baseAmount,
  method:p.method,date:p.date,payerName:p.payerName,isProxy:p.isProxy,note:p.note,verifiedBy:p.verifiedBy,milestoneId:p.milestoneId,createdAt:p.createdAt});
const requestDto = r => ({id:r.id,paymentId:r.paymentId,status:r.status,requestedBy:r.requestedBy,reasonCategory:r.reasonCategory,reason:r.reason,createdAt:r.createdAt,
  reviewedBy:r.reviewedBy,reviewNote:r.reviewNote,reviewedAt:r.reviewedAt,originalPayment:json(r.originalPaymentJson),requestReceipt:json(r.requestReceiptJson),reviewReceipt:r.reviewReceiptJson===null?null:json(r.reviewReceiptJson)});

/** Raw observation contract, not a trusted-report/status flag. Synthetic callers prove only this validator. */
function verifyPaymentReversalBrowserProof(e, provider, { allowLegacy = false } = {}) {
  // The executor supplies live Prisma Date objects; saved JSON supplies ISO
  // strings. Validate the same serialized raw evidence in both cases, without
  // changing any financial value, identity, required field or the input itself.
  e = JSON.parse(JSON.stringify(e));
  assert(['sqlite','postgresql'].includes(provider), 'Explicit provider required'); assert.equal(e?.provider, provider);
  const legacy = e.version === 'payment-reversal-browser/v1';
  assert(e.version === 'payment-reversal-browser/v2' || (legacy && allowLegacy), 'Fresh browser/v2 transport and authentication observations required');
  assert.deepEqual(e.errors, []); positive(e.orderId); positive(e.paymentId); assert.equal(typeof e.orderNo, 'string'); assert(e.orderNo.length > 0);
  assert.equal(e.financeActors.length, 2); assert.deepEqual(e.financeActors.map(a => a.instance), [0,1]);
  const [applicant, reviewer] = e.financeActors.map(a => { positive(a.id); assert.equal(a.role,'finance'); return a.id; }); assert.notEqual(applicant,reviewer);
  const sale = e.salesReadOnly; positive(sale.actorId); assert.equal(sale.role,'sales'); assert(![applicant,reviewer].includes(sale.actorId));
  const authOrigins = new Map();
  function identity(a, id, role, instance) {
    if (legacy) return;
    assert.equal(a.actorId,id); assert.equal(a.instance,instance);
    const p=a.loginProfile; assert.equal(p.id,id); assert.equal(p.role,role); assert(Array.isArray(p.permissions)); assert(Array.isArray(p.dataScopes));
    if(role==='finance') { for(const grant of ['orders.payment.reversal.request','orders.payment.reversal.review']) assert(p.permissions.includes(grant)); assert(p.dataScopes.includes('finance_visible')); }
    else { assert(!p.permissions.includes('orders.payment.reversal.request')); assert(!p.permissions.includes('orders.payment.reversal.review')); }
    assert(a.browserProfiles.length > 0);
    for(const read of a.browserProfiles) {
      const url=new URL(read.url); assert.equal(url.hostname,'127.0.0.1'); assert.equal(url.pathname,'/api/auth/me'); assert.equal(read.method,'GET'); assert.equal(read.actualHTTP,200); iso(read.observedAt);
      assert.deepEqual(read.profile,p); if(authOrigins.has(instance)) assert.equal(url.origin,authOrigins.get(instance)); else authOrigins.set(instance,url.origin);
    }
  }
  e.financeActors.forEach(a=>identity(a,a.id,'finance',a.instance)); identity(sale,sale.actorId,'sales',0);
  if(!legacy) assert.notEqual(authOrigins.get(0),authOrigins.get(1), 'Independent application origins required');
  const p=e.originalPayment; assert.equal(p.id,e.paymentId); assert.equal(p.orderId,e.orderId); assert.equal(p.status,'verified'); assert.equal(p.amount,300);
  assert.equal(p.currency,'CNY'); assert.equal(p.exchangeRate,1); assert.equal(p.baseAmount,300); assert.equal(p.method,'bank_transfer'); assert.equal(p.barterMetadata,null); assert.equal(p.verifiedBy,applicant);
  iso(p.date); iso(p.createdAt); iso(p.updatedAt); assert.equal(typeof p.payerName,'string'); assert.equal(typeof p.isProxy,'boolean');
  const sr=e.submissionReceipt; assert.equal(sr.version,'payment-submission/v1'); uuid(sr.requestKey); positive(sr.auditId); assert.equal(sr.paymentId,p.id); assert.equal(sr.orderId,e.orderId);
  assert.equal(sr.amount,300); assert.equal(sr.method,p.method); assert.equal(sr.date,p.date); assert.equal(sr.status,'pending'); assert.equal(sr.submittedBy,sale.actorId); iso(sr.submittedAt);
  const stages=[e.initialSnapshot,e.afterRequestSnapshot,e.beforeSnapshot,e.finalSnapshot];
  for(const [index,s] of stages.entries()) {
    assert.equal(s.payment.status,index<2?'verified':'reversed'); iso(s.payment.updatedAt); assert(iso(s.payment.updatedAt)>=iso(p.updatedAt));
    assert.deepEqual({...s.payment,status:p.status,updatedAt:p.updatedAt},p, 'Original financial and identity fields cannot be rewritten');
    assert.equal(s.order.id,e.orderId); assert.equal(s.order.paidAmount,index<2?350:50); assert.equal(s.order.paymentStatus,'partial');
    const adjustment=one(s.adjustments); assert.equal(adjustment.orderId,e.orderId); assert.equal(adjustment.domain,'finance'); assert.equal(adjustment.targetType,'order'); assert.equal(adjustment.status,'posted'); assert.equal(adjustment.amountDelta,50); iso(adjustment.appliedAt);
    const canonical=(s.payment.status==='verified'?cents(s.payment.amount):0)+s.adjustments.filter(a=>a.domain==='finance'&&a.appliedAt&&['posted','reversed'].includes(a.status)).reduce((n,a)=>n+cents(a.amountDelta),0);
    assert.equal(canonical,cents(s.order.paidAmount)); assert.deepEqual(s.adjustments,e.initialSnapshot.adjustments, 'Independent +50 must survive every stage');
    assert.equal(s.requests.length,index===0?0:1); assert.equal(s.effects.length,index<2?0:1); assert.equal(s.audits.length,[1,2,3,3][index]); assert.equal(s.events.length,index<2?1:2);
  }
  assert.deepEqual(e.initialSnapshot.payment,p); assert.deepEqual(e.afterRequestSnapshot.payment,p); assert.deepEqual(e.afterRequestSnapshot.order,e.initialSnapshot.order);
  assert.deepEqual(e.finalSnapshot,e.beforeSnapshot, 'Recovery/replays must not mutate raw financial history');
  const pending=one(e.afterRequestSnapshot.requests), r=one(e.beforeSnapshot.requests), effect=one(e.beforeSnapshot.effects);
  uuid(r.id); assert.equal(e.requestId,r.id); assert.equal(r.paymentId,p.id); assert.equal(r.status,'posted'); assert.equal(r.activePaymentId,null); assert.equal(r.requestedBy,applicant); assert.equal(r.reviewedBy,reviewer);
  assert.match(r.requestKey,/^reversal-[a-f0-9-]{36}$/i); uuid(r.requestKey.slice(9)); assert.match(r.reviewKey,/^reversal-[a-f0-9-]{36}$/i); uuid(r.reviewKey.slice(9)); assert.notEqual(r.requestKey,r.reviewKey);
  assert(['registration_error','bank_return'].includes(r.reasonCategory)); assert.equal(typeof r.reason,'string'); assert(r.reason.trim().length>0); assert.equal(typeof r.reviewNote,'string'); assert(r.reviewNote.trim().length>0);
  assert.deepEqual(json(r.originalPaymentJson),facts(p)); assert.equal(r.fingerprint,sha({version:'payment-reversal-request-facts/v1',paymentId:p.id,userId:applicant,reasonCategory:r.reasonCategory,reason:r.reason,original:r.originalPaymentJson}));
  assert.equal(r.reviewFingerprint,sha({version:'payment-reversal-review-facts/v1',requestId:r.id,userId:reviewer,decision:'approve',note:r.reviewNote}));
  const mutable=['status','activePaymentId','reviewKey','reviewFingerprint','reviewedBy','reviewNote','reviewAuditId','reviewReceiptJson','reviewedAt'];
  assert.deepEqual(Object.fromEntries(Object.entries(r).filter(([k])=>!mutable.includes(k))),Object.fromEntries(Object.entries(pending).filter(([k])=>!mutable.includes(k))));
  assert.equal(pending.status,'pending'); assert.equal(pending.activePaymentId,p.id); for(const key of mutable.filter(k=>!['status','activePaymentId'].includes(k))) assert.equal(pending[key],null);
  const requestReceipt={version:'payment-reversal-request/v1',requestId:r.id,requestKey:r.requestKey,paymentId:p.id,orderId:e.orderId,requestedBy:applicant,amount:300,currency:'CNY',status:'pending',auditId:r.requestAuditId,requestedAt:r.createdAt,reasonCategory:r.reasonCategory,reason:r.reason};
  positive(r.requestAuditId); positive(r.originalAuditId); positive(r.reviewAuditId); assert.equal(new Set([r.requestAuditId,r.originalAuditId,r.reviewAuditId]).size,3); iso(r.createdAt); assert(iso(r.reviewedAt)>iso(r.createdAt));
  const reviewReceipt={version:'payment-reversal-review/v1',requestId:r.id,reviewKey:r.reviewKey,paymentId:p.id,orderId:e.orderId,reversalId:effect.id,status:'posted',requestedBy:applicant,reviewedBy:reviewer,amount:-300,currency:'CNY',auditId:r.reviewAuditId,reviewedAt:r.reviewedAt,beforePaidAmount:350,afterPaidAmount:50};
  assert.deepEqual(json(r.requestReceiptJson),requestReceipt); assert.deepEqual(json(pending.requestReceiptJson),requestReceipt); assert.deepEqual(json(r.reviewReceiptJson),reviewReceipt);
  uuid(effect.id); assert.equal(effect.paymentId,p.id); assert.equal(effect.requestId,r.id); assert.equal(effect.postedBy,reviewer); assert.equal(effect.auditId,r.reviewAuditId); assert.equal(effect.amount,-300); assert.equal(effect.currency,'CNY');
  assert.equal(effect.receiptJson,r.reviewReceiptJson); assert.equal(effect.createdAt,r.reviewedAt); assert.deepEqual(json(effect.beforeStateJson),{orderId:e.orderId,paidAmount:350,paymentStatus:'partial'}); assert.deepEqual(json(effect.afterStateJson),{orderId:e.orderId,paidAmount:50,paymentStatus:'partial'});
  const verifiedAudit=one(e.initialSnapshot.audits); assert.equal(verifiedAudit.id,r.originalAuditId); assert.equal(verifiedAudit.action,'PAYMENT_VERIFIED'); assert.equal(verifiedAudit.userId,applicant);
  for(const s of stages) for(const a of s.audits) { positive(a.id); assert.equal(a.resource,'payment'); assert.equal(a.resourceId,p.id); iso(a.createdAt); }
  for(const s of stages.slice(1)) assert.deepEqual(one(s.audits,a=>a.id===verifiedAudit.id),verifiedAudit);
  const requestAudit=one(e.afterRequestSnapshot.audits,a=>a.action==='PAYMENT_REVERSAL_REQUESTED'), reviewAudit=one(e.beforeSnapshot.audits,a=>a.action==='PAYMENT_REVERSED');
  assert.equal(requestAudit.id,r.requestAuditId); assert.equal(requestAudit.userId,applicant); assert.deepEqual(json(requestAudit.details),{requestId:r.id,orderId:e.orderId,amount:300,currency:'CNY',reasonCategory:r.reasonCategory,reason:r.reason,fingerprint:r.fingerprint,originalAuditId:r.originalAuditId});
  assert.deepEqual(one(e.beforeSnapshot.audits,a=>a.id===requestAudit.id),requestAudit); assert.equal(reviewAudit.id,r.reviewAuditId); assert.equal(reviewAudit.userId,reviewer);
  assert.deepEqual(json(reviewAudit.details),{requestId:r.id,reversalId:effect.id,requestedBy:applicant,reviewedBy:reviewer,decision:'approve',note:r.reviewNote,orderId:e.orderId,amount:-300,currency:'CNY',beforePaidAmount:350,afterPaidAmount:50});
  assert(iso(requestAudit.createdAt)>=iso(r.createdAt)); assert(iso(reviewAudit.createdAt)>=iso(r.reviewedAt));
  const oldEvent=one(e.initialSnapshot.events); for(const s of stages.slice(1)) assert.deepEqual(one(s.events,v=>v.id===oldEvent.id),oldEvent);
  function event(v,type,amount) { positive(v.id); assert.equal(v.eventKey,`${type}:${p.id}`); assert.equal(v.eventType,type); assert.equal(v.aggregateType,'payment'); assert.equal(v.aggregateId,String(p.id));
    const payload=json(v.payloadJson); uuid(payload.id); assert.equal(payload.type,type); assert.equal(payload.resourceType,'payment'); assert.equal(payload.resourceId,p.id); iso(payload.occurredAt); iso(v.createdAt);
    assert.equal(payload.data.paymentId,p.id); assert.equal(payload.data.orderId,e.orderId); assert.equal(payload.data.amount,amount); assert.equal(payload.data.currency,'CNY'); return payload; }
  const oldPayload=event(oldEvent,'payment.verified',300); assert.equal(oldPayload.data.auditId,verifiedAudit.id); assert.equal(oldPayload.data.verifiedBy,applicant);
  assert.deepEqual(json(verifiedAudit.details),{eventId:oldPayload.id,eventKey:oldEvent.eventKey,orderId:e.orderId,paymentId:p.id,amount:300,currency:'CNY',verifiedBy:applicant});
  const reversedEvent=one(e.beforeSnapshot.events,v=>v.eventType==='payment.reversed'), payload=event(reversedEvent,'payment.reversed',-300); assert.notEqual(payload.id,oldPayload.id); assert.equal(e.eventId,payload.id);
  assert.equal(payload.occurredAt,r.reviewedAt); assert.deepEqual(payload.data,{paymentId:p.id,orderId:e.orderId,reversalId:effect.id,requestId:r.id,amount:-300,currency:'CNY',requestedBy:applicant,reviewedBy:reviewer,auditId:r.reviewAuditId,beforePaidAmount:350,afterPaidAmount:50});
  function current(o,paid,includesOwnership=true) { assert.equal(o.id,e.orderId); assert.equal(o.currency,'CNY'); assert.equal(o.finalAmount,1000); assert.equal(o.paidAmount,paid); assert.equal(o.receivableAdjustmentAmount,0); assert.equal(o.paymentStatus,'partial'); assert.equal(o.createdBy,sale.actorId); if(includesOwnership) { assert.equal(o.customer.salespersonId,sale.actorId); assert.equal(o.customer.poolState,'private'); } }
  function result(d,receipt,row,paid,replayed) { assert.equal(d.replayed,replayed); assert.deepEqual(d.receipt,receipt); assert.deepEqual(d.request,requestDto(row)); current(d.currentOrder,paid); }
  function dropped(d,status,endpoint,instance,receipt,row,paid) {
    assert.equal(d.httpStatus,status); assert.equal(d.response.success,true); result(d.response.data,receipt,row,paid,false);
    if(!legacy) { const url=new URL(d.url); assert.equal(url.origin,authOrigins.get(instance)); assert.equal(url.pathname,endpoint); assert.equal(d.method,'POST'); assert.equal(d.actualHTTP,status);
      // Backend receipt time and browser-probe time are different clock domains.
      // Exact receipt/DB equality above proves commit; this probe's monotonic clock proves transport order.
      iso(d.committedResponseReceivedAt); iso(d.responseDroppedAt);
      assert(Array.isArray(d.transportOrderNs)); assert.equal(d.transportOrderNs.length,3);
      const [started,received,dropped]=d.transportOrderNs.map(value=>{ assert.equal(typeof value,'string'); assert.match(value,/^[1-9]\d*$/); return BigInt(value); });
      assert(started<received && received<dropped, 'Fetch must finish before the committed response is dropped'); }
  }
  dropped(e.requestLostAck,201,`/api/collections/payments/${p.id}/reversal-requests`,0,requestReceipt,pending,350);
  dropped(e.reviewLostAck,200,`/api/collections/payment-reversal-requests/${r.id}/review`,1,reviewReceipt,r,50);
  assert.deepEqual(e.requestLostAck.body,{requestKey:r.requestKey,reasonCategory:r.reasonCategory,reason:r.reason}); assert.deepEqual(e.reviewLostAck.body,{reviewKey:r.reviewKey,decision:'approve',note:r.reviewNote});
  if(!legacy) assert(BigInt(e.requestLostAck.transportOrderNs[2])<BigInt(e.reviewLostAck.transportOrderNs[0]));
  const reqIntent=one(e.requestIntentBeforeReload), revIntent=one(e.reviewIntentBeforeReload);
  assert.deepEqual(reqIntent,{version:'payment-reversal-intent/v1',kind:'request',userId:String(applicant),targetId:String(p.id),key:r.requestKey,facts:{reasonCategory:r.reasonCategory,reason:r.reason}});
  assert.deepEqual(revIntent,{version:'payment-reversal-intent/v1',kind:'review',userId:String(reviewer),targetId:r.id,key:r.reviewKey,facts:{decision:'approve',note:r.reviewNote}});
  assert.deepEqual(e.requestIntentAfterReadback,[]); assert.deepEqual(e.reviewIntentAfterReadback,[]); assert.equal(e.replays.length,2); assert.deepEqual(e.replays.map(v=>v.instance),[0,1]);
  for(const replay of e.replays) { result(replay.request,requestReceipt,r,50,true); result(replay.review,reviewReceipt,r,50,true); }
  assert.equal(e.selfReview.status,403); assert.equal(e.selfReview.ok,false); assert.equal(e.selfReview.json.success,false); assert.equal(e.selfReview.json.errorCode,'PAYMENT_REVERSAL_SEPARATION_REQUIRED');
  assert.equal(e.verifyReentry.length,2); for(const denied of e.verifyReentry) { assert.equal(denied.status,409); assert.equal(denied.ok,false); assert.equal(denied.json.success,false); }
  const claim=e.claimBeforeCrash, killed=e.claimAfterKill, delivered=e.deliveryAfterRecovery; positive(claim.id); assert.equal(claim.eventId,reversedEvent.id); assert.equal(claim.channel,'webhook'); assert.match(claim.destinationKey,/^[a-f0-9]{64}$/);
  assert.equal(claim.status,'sending'); assert.equal(claim.attempts,2); uuid(claim.leaseToken); assert.equal(claim.deliveredAt,null); assert.equal(claim.lastErrorCode,'HTTP_503'); iso(claim.nextAttemptAt); iso(claim.createdAt); const expiry=iso(claim.leaseExpiresAt);
  assert.deepEqual(killed,claim); for(const key of ['id','eventId','channel','destinationKey','createdAt']) assert.equal(delivered[key],claim[key]);
  assert.equal(delivered.status,'delivered'); assert.equal(delivered.attempts,3); assert.equal(delivered.leaseToken,null); assert.equal(delivered.leaseExpiresAt,null); assert.equal(delivered.lastErrorCode,null); assert(iso(delivered.deliveredAt)>=expiry);
  const restart=e.restart; assert.equal(restart.killed,2); assert.equal(restart.restarted,2); assert.equal(restart.signal,'SIGKILL'); assert.equal(restart.databaseRestarted,false);
  assert(iso(restart.startedAt)<=iso(restart.finishedAt)); assert(iso(restart.startedAt)<expiry);
  if(restart.exit) { assert.equal(restart.exit.length,2); assert(restart.exit.every(v=>v.code===null&&v.signal==='SIGKILL')); } else assert.deepEqual(restart.exitCodes,[137,137]);
  if(!legacy) { assert(iso(e.claimBeforeCrashObservedAt)<=iso(restart.startedAt)); assert(iso(e.claimAfterKillObservedAt)>=iso(restart.startedAt)); assert(iso(e.claimAfterKillObservedAt)<=iso(restart.finishedAt)); assert(iso(e.claimAfterKillObservedAt)<expiry);
    assert(iso(e.deliveryAfterRecoveryObservedAt)>=iso(delivered.deliveredAt)); assert(iso(e.reviewLostAck.responseDroppedAt)<=iso(e.claimBeforeCrashObservedAt)); }
  const receiver=e.receiver; assert.deepEqual(receiver.target,{paymentId:p.id,eventType:'payment.reversed',requests:3,phase:'acknowledged',release:true}); assert.equal(receiver.attempts.length,3);
  const digest=sha(reversedEvent.payloadJson); assert.deepEqual(receiver.attempts.map(a=>a.status),[503,'ack-withheld',202]);
  for(const a of receiver.attempts) { assert.equal(a.paymentId,p.id); assert.equal(a.eventType,'payment.reversed'); assert.equal(a.eventId,payload.id); assert.equal(a.digest,digest); assert.equal(a.signatureValid,true); iso(a.at); }
  const [first,second,last]=receiver.attempts; assert(iso(first.at)>=iso(payload.occurredAt)); assert(iso(first.at)<iso(second.at)); assert(iso(second.at)<=iso(restart.startedAt)); assert(iso(second.at)<expiry); assert(iso(last.at)>=expiry); assert(iso(delivered.deliveredAt)>=iso(last.at));
  const accepted=one(receiver.accepted), {acceptedAt,...acceptedFacts}=accepted;
  assert.deepEqual(acceptedFacts,{eventId:payload.id,eventType:'payment.reversed',paymentId:p.id,orderId:e.orderId,amount:-300,digest,effects:1});
  // Arrival and durable acceptance are separate clock reads. Prove causal order,
  // not accidental same-millisecond equality, and still require pre-crash acceptance.
  assert(iso(acceptedAt)>=iso(second.at));
  assert(iso(acceptedAt)<=iso(legacy?restart.startedAt:e.claimBeforeCrashObservedAt));
  assert.equal(e.frames.length,2); const count=e.frames.map(a=>a.length); if(provider==='postgresql') assert.deepEqual(count,[1,1]); else assert.equal(count.reduce((n,v)=>n+v,0),1);
  for(const frame of e.frames.flat()) { assert.equal(frame.id,payload.id); assert.equal(frame.occurredAt,payload.occurredAt); assert.equal(frame.type,'payment.reversed'); assert.equal(frame.title,'Payment reversed'); assert.equal(frame.resourceType,'payment'); assert.equal(frame.resourceId,p.id); assert.equal(frame.severity,'warning'); assert(frame.message.includes(String(e.orderId))); assert.deepEqual(frame.audience.roles,['admin','manager','finance']); }
  assert.equal(e.screenshots.length,2); assert.deepEqual(e.screenshots.map(s=>s.instance),[0,1]);
  function visibleText(text,readOnly=false) { assert.equal(typeof text,'string'); for(const token of [e.orderNo,`原回款 #${p.id}`,'原金额：CNY 300.00',`原核销人：#${applicant}`,'已冲销','最新订单累计已收：CNY 50.00','CNY -300.00',effect.id,r.id,`审计 #${r.requestAuditId}`,`审计 #${r.reviewAuditId}`,r.reason,r.reviewNote]) assert(text.includes(token),`Missing browser readback: ${token}`); if(readOnly) assert(text.includes('当前角色只读')); }
  for(const s of e.screenshots) { assert.equal(s.actorId,e.financeActors[s.instance].id); assert.equal(s.role,'finance'); assert.equal(s.unobscured,true); assert.equal(s.orderPaid,50); assert.equal(s.originalAmount,300); assert.equal(s.reversalAmount,-300); assert.equal(typeof s.path,'string'); assert.match(s.path,/finance-[12]-original-reversal\.png$/); visibleText(s.text); assertCjkRasterEvidence(s.font);
    if(!legacy) { const url=new URL(s.url); assert.equal(url.origin,authOrigins.get(s.instance)); assert.equal(url.hash,'#collections'); for(const key of ['requestButtons','reviewButtons','verifyButtons']) assert.equal(s[key],0); } }
  assert.equal(sale.requestButtons,0); assert.equal(sale.reviewButtons,0); assert.equal(sale.originalVisible,true);
  if(!legacy) { const url=new URL(sale.url); assert.equal(url.origin,authOrigins.get(0)); assert.equal(url.hash,'#collections'); visibleText(sale.text,true); }
  assert.equal(e.finalReadbacks.length,2);
  for(const o of e.finalReadbacks) { current(o,50,false); assert.equal(o.orderNo,e.orderNo); const read=one(o.paymentRecords); assert.equal(read.status,'reversed'); for(const key of ['id','amount','method','date','payerName','isProxy','note','verifiedBy','milestoneId','createdAt']) assert.deepEqual(read[key],p[key]); }
  return {version:'payment-reversal-browser-proof/v2',provider,orderId:e.orderId,paymentId:p.id,requestId:r.id,reversalId:effect.id,eventId:payload.id,digest,
    financeActors:2,lostAcknowledgments:2,consumerEffects:1,rawImmutableSnapshots:4,orderPaid:50,applicationCrashVerified:true,databaseRestartVerified:false,
    transportTraceVerified:!legacy,explicitProfilesVerified:!legacy,legacyEvidence:legacy,synthetic:e.synthetic===true,imagesVisuallyInspected:false,
    scope:'Raw browser/API/database/application-crash evidence only; no database restart, external refund, partial refund or balance carry-forward claim'};
}
module.exports={verifyPaymentReversalBrowserProof};
