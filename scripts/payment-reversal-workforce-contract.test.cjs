// Synthetic validator tests only, never business execution or promotion evidence.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {verifyPaymentReversalWorkforceProof:verify}=require('./lib/payment-reversal-browser-proof.cjs');
const {paymentReversalBrowserProofFixture}=require('./fixtures/payment-reversal-browser-proof-fixture.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(){
  const file=path.join(__dirname,'lib/enterprise-round2-payment-actor-proof.cjs'),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nmodule.exports.testPolicies=policies;',{module,exports:module.exports,require,URL});
  const policies=copy(module.exports.testPolicies),legacy=paymentReversalBrowserProofFixture(),origins=['http://127.0.0.1:5006','http://127.0.0.1:5008'];
  const actor=(id,job,index)=>{const role=`r2wf_synthetic_${job}`,username=`synthetic_${job}_${index}`;
    const profile={id,username,role,segment:'mixed',isActive:true,mustChangePassword:false,...policies[job]};
    return{id,job,index,role,profile,account:{username,role,segment:'mixed'}};};
  const people={sales:actor(102,'sales',3),requester:actor(103,'receivables',1),reviewer:actor(104,'owner',1)};
  const payables={id:105,role:'r2wf_synthetic_payables',profile:{permissions:['barter.post'],dataScopes:['finance_visible']}};
  const w={version:'payment-reversal-workforce/v1',errors:[],orderId:legacy.orderId,orderNo:legacy.orderNo,paymentId:legacy.paymentId,requestId:legacy.requestId,customerId:7,
    actors:Object.entries(people).map(([duty,a])=>({duty,actorId:a.id,role:a.role,profiles:[0,1].map(instance=>({instance,profile:copy(a.profile)})),
      nativeProfiles:duty==='sales'?[]:[{instance:duty==='requester'?0:1,url:origins[duty==='requester'?0:1]+'/api/auth/me',method:'GET',actualHTTP:200,observedAt:'2026-10-20T00:00:00.000Z',profile:copy(a.profile)}]})),
    initial:copy(legacy.initialSnapshot),afterRequest:copy(legacy.afterRequestSnapshot),final:copy(legacy.finalSnapshot),
    submissionReceipt:copy(legacy.submissionReceipt),submissionAudit:{id:legacy.submissionReceipt.auditId,userId:102,action:'PAYMENT_SUBMITTED',resource:'order',resourceId:legacy.orderId},
    adjustment:copy(legacy.initialSnapshot.adjustments[0]),adjustmentActorId:1,payablesProfile:{id:105,role:payables.role,isActive:true,mustChangePassword:false,...copy(payables.profile)},
    nativeWrites:[],denials:[],readbacks:[0,1].map(instance=>({instance,json:copy(legacy.finalReadbacks[0])})),
    screenshots:legacy.screenshots.map((s,index)=>({...copy(s),role:index?people.reviewer.role:people.requester.role}))};
  for(const stage of[w.initial,w.afterRequest,w.final])stage.order={...copy(legacy.finalReadbacks[0]),...stage.order,customerId:7,paymentRecords:[copy(stage.payment)]};
  w.adjustmentResponse={adjustment:copy(w.adjustment),effects:{finance:{orderId:w.orderId,paidAmount:350}}};
  const r=w.final.requests[0],paths=[`/api/collections/payments/${w.paymentId}/reversal-requests`,`/api/collections/payment-reversal-requests/${r.id}/review`];
  w.nativeWrites=[legacy.requestLostAck,legacy.reviewLostAck].map((entry,index)=>({actorId:index?104:103,role:index?people.reviewer.role:people.requester.role,
    instance:index,method:'POST',path:paths[index],status:index?200:201,authorizationMatched:true,sent:copy(entry.body),json:copy(entry.response)}));
  const pending=copy(w.initial);pending.payment.status='pending';pending.payment.verifiedBy=null;pending.order.paidAmount=0;
  const rows=[['payables-cannot-verify-receivable',payables,`/orders/${w.orderId}/payment/${w.paymentId}/verify`,'orders.payment.verify',pending],
    ['owner-cannot-request',people.reviewer,paths[0].slice(4),'orders.payment.reversal.request',w.initial],
    ['sales-cannot-request',people.sales,paths[0].slice(4),'orders.payment.reversal.request',w.initial],
    ['requester-cannot-review',people.requester,paths[1].slice(4),'orders.payment.reversal.review',w.afterRequest],
    ['sales-cannot-review',people.sales,paths[1].slice(4),'orders.payment.reversal.review',w.afterRequest],
    ['sales-cannot-read-collections',people.sales,paths[0].slice(4),'collections.read',w.afterRequest]];
  w.denials=rows.map(([label,a,path,permission,state],index)=>({label,actorId:a.id,role:a.role,instance:1,method:index===5?'GET':'POST',path,status:403,
    sent:index===1||index===2?{requestKey:'00000001-0000-4000-8000-000000000000',reasonCategory:'registration_error',reason:'Synthetic valid forbidden request'}:
      index===3||index===4?{reviewKey:'00000002-0000-4000-8000-000000000000',decision:'approve',note:'Synthetic valid forbidden review'}:null,
    json:{success:false,requiredPermissions:[permission]},before:copy(state),after:copy(state)}));
  return{w,expected:{people,payables,bootstrapId:1}};
}
test('synthetic same20 financial duty proof is accepted without promoting legacy controls or cloud',()=>{
  const {w,expected}=fixture(),before=copy(w),proof=verify(w,expected);assert.equal(proof.requesterId,103);assert.equal(proof.reviewerId,104);
  assert.equal(proof.orderPaid,50);assert.equal(proof.denials,6);assert.deepEqual(w,before);
});
for(const[label,mutate]of[
  ['missing workforce',e=>{e.w=undefined;}],['missing ready profile',e=>{delete e.w.actors[1].profiles[0].profile.isActive;}],
  ['wrong sales principal',e=>{e.w.actors[0].actorId=999;}],['legacy finance role substitution',e=>{e.w.actors[1].role='finance';}],
  ['borrowed profile',e=>{e.w.actors[2].nativeProfiles[0].profile.id=103;}],['missing real native auth',e=>{e.w.actors[1].nativeProfiles=[];}],
  ['same origin',e=>{e.w.actors[2].nativeProfiles[0].url=e.w.actors[1].nativeProfiles[0].url;}],
  ['unowned customer',e=>{e.w.final.order.customer.salespersonId=999;}],['wrong order creator',e=>{e.w.initial.order.createdBy=1;}],
  ['wrong submitted principal',e=>{e.w.submissionAudit.userId=1;}],['payment verifier replaced',e=>{e.w.final.payment.verifiedBy=104;}],
  ['original amount mutated',e=>{e.w.final.payment.amount=0;}],['request has early effect',e=>{e.w.afterRequest.effects.push({});}],
  ['missing actual adjustment DTO',e=>{delete e.w.adjustmentResponse;}],['wrong adjustment DTO record',e=>{e.w.adjustmentResponse.adjustment.id++;}],
  ['wrong adjustment DTO effect',e=>{e.w.adjustmentResponse.effects.finance.paidAmount=300;}],['outer adjustment wrapper as record',e=>{e.w.adjustment=copy(e.w.adjustmentResponse);}],
  ['duplicate posting',e=>{e.w.final.effects.push(copy(e.w.final.effects[0]));}],['independent adjustment erased',e=>{e.w.final.adjustments=[];}],
  ['wrong posting user',e=>{e.w.final.effects[0].postedBy=103;}],['audit attribution forged',e=>{e.w.final.audits[2].userId=103;}],
  ['native request borrowed session',e=>{e.w.nativeWrites[0].authorizationMatched=false;}],['native response wrong receipt',e=>{e.w.nativeWrites[1].json.data.receipt.amount=-301;}],
  ['native submitted facts changed',e=>{e.w.nativeWrites[0].sent.reason='other';}],['denial side effects',e=>{e.w.denials[0].after.payment.status='verified';}],
  ['missing duty denial',e=>{e.w.denials.pop();}],['permission rejection mislabeled as SoD',e=>{e.w.denials[3].json={success:false,errorCode:'PAYMENT_REVERSAL_SEPARATION_REQUIRED'};}],
  ['missing denial body',e=>{delete e.w.denials[1].sent;}],['empty denial body',e=>{e.w.denials[3].sent={};}],
  ['short request reason',e=>{e.w.denials[1].sent.reason=' x ';}],['long request reason',e=>{e.w.denials[2].sent.reason='x'.repeat(2001);}],
  ['short review note',e=>{e.w.denials[3].sent.note=' x ';}],['long review note',e=>{e.w.denials[4].sent.note='x'.repeat(2001);}],
  ['extra request field',e=>{e.w.denials[1].sent.unrecognized=true;}],['extra review field',e=>{e.w.denials[4].sent.unrecognized=true;}],
  ['unexpected verify body',e=>{e.w.denials[0].sent={};}],['unexpected read body',e=>{e.w.denials[5].sent={};}],
  ['AP overprivileged',e=>{e.w.payablesProfile.permissions.push('orders.payment.verify');}],['stale readback',e=>{e.w.readbacks[1].json.paidAmount=350;}],
  ['wrong reversal event actor',e=>{const event=e.w.final.events[1],p=JSON.parse(event.payloadJson);p.data.reviewedBy=103;event.payloadJson=JSON.stringify(p);}],
  ['hidden effect',e=>{e.w.screenshots[0].unobscured=false;}],['unauthorized UI action',e=>{e.w.screenshots[1].requestButtons=1;}],
])test(`synthetic same20 financial proof rejects ${label}`,()=>{const e=fixture();mutate(e);assert.throws(()=>verify(e.w,e.expected));});
