// SYNTHETIC SOURCE-CONTRACT FIXTURE ONLY. Never an executor, acceptance report, or business-count evidence.
const crypto = require('node:crypto');
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
function paymentReversalBrowserProofFixture(provider = 'sqlite') {
  const applicant=103, reviewer=104, salesId=102, paymentId=42, orderId=12, orderNo='SYNTHETIC-ORDER-12';
  const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000000`;
  const date=s=>`2026-10-03T16:00:${String(s).padStart(2,'0')}.000Z`;
  const requestId=id(1), reversalId=id(2), eventId=id(3), originalEventId=id(4), requestKey=`reversal-${id(5)}`, reviewKey=`reversal-${id(6)}`;
  const payment={id:paymentId,orderId,amount:300,currency:'CNY',exchangeRate:1,baseAmount:300,method:'bank_transfer',date:date(0),payerName:'SYNTHETIC PAYER',isProxy:false,
    note:'SYNTHETIC ONLY',status:'verified',verifiedBy:applicant,milestoneId:null,barterMetadata:null,createdAt:date(0),updatedAt:date(1)};
  const originalPayment={version:'original-payment-facts/v1',...Object.fromEntries(Object.entries(payment).filter(([k])=>!['status','updatedAt','barterMetadata'].includes(k)))};
  const requestReceipt={version:'payment-reversal-request/v1',requestId,requestKey,paymentId,orderId,requestedBy:applicant,amount:300,currency:'CNY',status:'pending',auditId:62,
    requestedAt:date(10),reasonCategory:'registration_error',reason:'SYNTHETIC independently traceable reason'};
  const reviewReceipt={version:'payment-reversal-review/v1',requestId,reviewKey,paymentId,orderId,reversalId,status:'posted',requestedBy:applicant,reviewedBy:reviewer,amount:-300,
    currency:'CNY',auditId:64,reviewedAt:date(12),beforePaidAmount:350,afterPaidAmount:50};
  const pending={id:requestId,requestKey,paymentId,activePaymentId:paymentId,requestedBy:applicant,reasonCategory:requestReceipt.reasonCategory,reason:requestReceipt.reason,
    originalPaymentJson:JSON.stringify(originalPayment),requestReceiptJson:JSON.stringify(requestReceipt),requestAuditId:62,originalAuditId:58,status:'pending',reviewKey:null,
    reviewFingerprint:null,reviewedBy:null,reviewNote:null,reviewAuditId:null,reviewReceiptJson:null,reviewedAt:null,createdAt:date(10)};
  pending.fingerprint=hash({version:'payment-reversal-request-facts/v1',paymentId,userId:applicant,reasonCategory:pending.reasonCategory,reason:pending.reason,original:pending.originalPaymentJson});
  const posted={...pending,activePaymentId:null,status:'posted',reviewKey,reviewedBy:reviewer,reviewNote:'SYNTHETIC independent approval',reviewAuditId:64,
    reviewReceiptJson:JSON.stringify(reviewReceipt),reviewedAt:date(12)};
  posted.reviewFingerprint=hash({version:'payment-reversal-review-facts/v1',requestId,userId:reviewer,decision:'approve',note:posted.reviewNote});
  const beforeOrder={id:orderId,paidAmount:350,paymentStatus:'partial'}, afterOrder={id:orderId,paidAmount:50,paymentStatus:'partial'};
  const effect={id:reversalId,paymentId,requestId,postedBy:reviewer,auditId:64,amount:-300,currency:'CNY',beforeStateJson:JSON.stringify({orderId,paidAmount:350,paymentStatus:'partial'}),afterStateJson:JSON.stringify({orderId,paidAmount:50,paymentStatus:'partial'}),receiptJson:posted.reviewReceiptJson,createdAt:date(12)};
  const adjustment={id:2,orderId,domain:'finance',targetType:'order',status:'posted',amountDelta:50,appliedAt:date(2)};
  const audit=(id,action,userId,details,createdAt)=>({id,action,userId,resource:'payment',resourceId:paymentId,details:JSON.stringify(details),createdAt});
  const originalAudit=audit(58,'PAYMENT_VERIFIED',applicant,{eventId:originalEventId,eventKey:`payment.verified:${paymentId}`,orderId,paymentId,amount:300,currency:'CNY',verifiedBy:applicant},date(1));
  const requestAudit=audit(62,'PAYMENT_REVERSAL_REQUESTED',applicant,{requestId,orderId,amount:300,currency:'CNY',reasonCategory:pending.reasonCategory,reason:pending.reason,fingerprint:pending.fingerprint,originalAuditId:58},date(10));
  const reviewAudit=audit(64,'PAYMENT_REVERSED',reviewer,{requestId,reversalId,requestedBy:applicant,reviewedBy:reviewer,decision:'approve',note:posted.reviewNote,orderId,amount:-300,currency:'CNY',beforePaidAmount:350,afterPaidAmount:50},date(12));
  const businessEvent=(id,uuid,type,occurredAt,data)=>({id,eventKey:`${type}:${paymentId}`,eventType:type,aggregateType:'payment',aggregateId:String(paymentId),
    payloadJson:JSON.stringify({id:uuid,type,resourceType:'payment',resourceId:paymentId,occurredAt,data}),createdAt:occurredAt});
  const verified=businessEvent(4,originalEventId,'payment.verified',date(1),{orderId,paymentId,amount:300,currency:'CNY',verifiedBy:applicant,auditId:58});
  const reversed=businessEvent(5,eventId,'payment.reversed',date(12),{paymentId,orderId,reversalId,requestId,amount:-300,currency:'CNY',requestedBy:applicant,reviewedBy:reviewer,auditId:64,beforePaidAmount:350,afterPaidAmount:50});
  const snapshot=(stage)=>({payment:{...payment,...(stage>=2?{status:'reversed',updatedAt:date(12)}:{})},order:stage<2?beforeOrder:afterOrder,adjustments:[adjustment],
    requests:stage===0?[]:[stage===1?pending:posted],effects:stage<2?[]:[effect],audits:[originalAudit,...(stage>0?[requestAudit]:[]),...(stage>=2?[reviewAudit]:[])],events:[verified,...(stage>=2?[reversed]:[])]});
  const dto=r=>({id:r.id,paymentId:r.paymentId,status:r.status,requestedBy:r.requestedBy,reasonCategory:r.reasonCategory,reason:r.reason,createdAt:r.createdAt,reviewedBy:r.reviewedBy,
    reviewNote:r.reviewNote,reviewedAt:r.reviewedAt,originalPayment,requestReceipt,reviewReceipt:r.reviewReceiptJson===null?null:reviewReceipt});
  const order=paidAmount=>({id:orderId,orderNo,currency:'CNY',finalAmount:1000,paidAmount,receivableAdjustmentAmount:0,paymentStatus:'partial',createdBy:salesId,customer:{salespersonId:salesId,poolState:'private'}});
  const result=(row,receipt,paid,replayed)=>({replayed,request:dto(row),receipt,currentOrder:order(paid)});
  const origins=['http://127.0.0.1:5006','http://127.0.0.1:5008'];
  const identity=(actorId,role,instance)=>{const loginProfile={id:actorId,role,permissions:role==='finance'?['orders.payment.reversal.request','orders.payment.reversal.review']:['orders.view'],dataScopes:role==='finance'?['finance_visible']:['self']};
    return {actorId,instance,loginProfile,browserProfiles:[{url:`${origins[instance]}/api/auth/me`,method:'GET',actualHTTP:200,observedAt:date(3),profile:loginProfile}]};};
  const requestBody={requestKey,reasonCategory:pending.reasonCategory,reason:pending.reason}, reviewBody={reviewKey,decision:'approve',note:posted.reviewNote};
  const lost=(body,receipt,row,paid,httpStatus,path,instance,at)=>({body,response:{success:true,data:result(row,receipt,paid,false)},httpStatus,
    url:`${origins[instance]}${path}`,method:'POST',actualHTTP:httpStatus,committedResponseReceivedAt:date(at),responseDroppedAt:date(at),
    transportOrderNs:[String(at*1000),String(at*1000+1),String(at*1000+2)]});
  const claim={id:10,eventId:5,channel:'webhook',destinationKey:'a'.repeat(64),status:'sending',attempts:2,nextAttemptAt:date(14),leaseToken:id(7),leaseExpiresAt:date(45),
    deliveredAt:null,lastErrorCode:'HTTP_503',createdAt:date(12)};
  const digest=hash(reversed.payloadJson);
  const frame={id:eventId,occurredAt:date(12),type:'payment.reversed',title:'Payment reversed',message:`订单 ${orderId} 原回款已冲销`,resourceType:'payment',resourceId:paymentId,severity:'warning',audience:{roles:['admin','manager','finance']}};
  const text=`订单 ${orderNo} · 原回款 #${paymentId}\n原金额：CNY 300.00\n原核销人：#${applicant}\n已冲销\n最新订单累计已收：CNY 50.00\n唯一全额负冲销效果：CNY -300.00\n${reversalId} 审计 #64\n${requestId} 审计 #62\n${pending.reason}\n${posted.reviewNote}`;
  const font={missingSignatures:['missing1','missing2'],glyphs:Array.from('采购版本变更数量审批').map((character,i)=>({character,signature:`synthetic-glyph-${i}`,inkPixels:i+1}))};
  const evidence={version:'payment-reversal-browser/v2',synthetic:true,provider,scope:'SYNTHETIC SOURCE CONTRACT ONLY; zero real execution/count evidence',errors:[],orderId,orderNo,paymentId,requestId,eventId,
    originalPayment:payment,submissionReceipt:{version:'payment-submission/v1',requestKey:id(8),paymentId,orderId,amount:300,method:payment.method,date:payment.date,submittedBy:salesId,auditId:56,submittedAt:date(0),status:'pending'},
    financeActors:[applicant,reviewer].map((id,instance)=>({id,role:'finance',...identity(id,'finance',instance)})),initialSnapshot:snapshot(0),afterRequestSnapshot:snapshot(1),beforeSnapshot:snapshot(2),finalSnapshot:snapshot(2),
    requestLostAck:lost(requestBody,requestReceipt,pending,350,201,`/api/collections/payments/${paymentId}/reversal-requests`,0,11),
    reviewLostAck:lost(reviewBody,reviewReceipt,posted,50,200,`/api/collections/payment-reversal-requests/${requestId}/review`,1,13),
    requestIntentBeforeReload:[{version:'payment-reversal-intent/v1',kind:'request',userId:String(applicant),targetId:String(paymentId),key:requestKey,facts:{reasonCategory:pending.reasonCategory,reason:pending.reason}}],
    reviewIntentBeforeReload:[{version:'payment-reversal-intent/v1',kind:'review',userId:String(reviewer),targetId:requestId,key:reviewKey,facts:{decision:'approve',note:posted.reviewNote}}],requestIntentAfterReadback:[],reviewIntentAfterReadback:[],
    replays:[0,1].map(instance=>({instance,request:result(posted,requestReceipt,50,true),review:result(posted,reviewReceipt,50,true)})),selfReview:{status:403,ok:false,json:{success:false,errorCode:'PAYMENT_REVERSAL_SEPARATION_REQUIRED'}},
    verifyReentry:[0,1].map(()=>({status:409,ok:false,json:{success:false}})),claimBeforeCrash:claim,claimAfterKill:claim,claimBeforeCrashObservedAt:date(16),claimAfterKillObservedAt:date(18),
    restart:{startedAt:date(17),finishedAt:date(20),killed:2,restarted:2,signal:'SIGKILL',exit:[{code:null,signal:'SIGKILL'},{code:null,signal:'SIGKILL'}],databaseRestarted:false},
    deliveryAfterRecovery:{...claim,status:'delivered',attempts:3,leaseToken:null,leaseExpiresAt:null,deliveredAt:date(47),lastErrorCode:null},deliveryAfterRecoveryObservedAt:date(48),
    receiver:{target:{paymentId,eventType:'payment.reversed',requests:3,phase:'acknowledged',release:true},attempts:[503,'ack-withheld',202].map((status,i)=>({paymentId,eventType:'payment.reversed',eventId,digest,at:date([14,15,46][i]),signatureValid:true,status})),accepted:[{eventId,eventType:'payment.reversed',paymentId,orderId,amount:-300,digest,acceptedAt:date(15),effects:1}]},
    frames:provider==='postgresql'?[[frame],[frame]]:[[frame],[]],screenshots:[applicant,reviewer].map((actorId,instance)=>({path:`SYNTHETIC-NOT-REAL/finance-${instance+1}-original-reversal.png`,actorId,instance,role:'finance',unobscured:true,orderPaid:50,originalAmount:300,reversalAmount:-300,text,font,url:`${origins[instance]}/#collections`,requestButtons:0,reviewButtons:0,verifyButtons:0})),
    salesReadOnly:{...identity(salesId,'sales',0),role:'sales',url:`${origins[0]}/#collections`,text:`${text}\n当前角色只读`,requestButtons:0,reviewButtons:0,originalVisible:true},
    finalReadbacks:[0,1].map(()=>({...order(50),paymentRecords:[{...payment,status:'reversed'}]}))};
  return copy(evidence);
}
module.exports={paymentReversalBrowserProofFixture};
