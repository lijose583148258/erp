const assert = require('node:assert/strict'), crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const cents = value => { assert(Number.isFinite(value)); const result = Math.round(value * 100); assert(Math.abs(value * 100 - result) < 1e-7 && Number.isSafeInteger(result)); return result; };
const data = response => { assert([200,201].includes(response.status)); assert(response.json?.data); return response.json.data; };
const normalize = value => JSON.parse(JSON.stringify(value));
const iso = value => { assert(value instanceof Date || (typeof value === 'string' && value.length > 0)); const date = new Date(value); assert(Number.isFinite(date.getTime())); return date.toISOString(); };
const positiveId = value => assert(Number.isSafeInteger(value) && value > 0);
const uuid = value => assert.match(value, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
const key = value => assert.match(value, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/);
const same = (actual, expected) => assert.deepEqual(normalize(actual), normalize(expected));
const fields = (actual, expected) => { assert(actual && typeof actual === 'object'); for (const [name, value] of Object.entries(expected)) same(actual[name], value); };
function verifyPaymentReversalApiProof(e) {
  assert.equal(e?.version, 'payment-reversal-api/v1'); assert(Number.isSafeInteger(e.paymentId) && e.paymentId > 0);
  positiveId(e.orderId);
  const original = e.originalPayment;
  fields(original, { id:e.paymentId, orderId:e.orderId, amount:300, currency:'CNY', exchangeRate:1, baseAmount:300, status:'verified' });
  positiveId(original.verifiedBy); assert(!original.barterMetadata);
  assert(['bank_transfer','cash','alipay','wechat','check','wire_transfer'].includes(original.method));
  const originalFacts = { version:'original-payment-facts/v1', ...Object.fromEntries([
    'id','orderId','amount','currency','exchangeRate','baseAmount','method','payerName','isProxy','note','verifiedBy','milestoneId',
  ].map(name => [name,original[name]])), date:iso(original.date), createdAt:iso(original.createdAt) };
  iso(original.updatedAt);
  const labels = ['before-request','rejected-no-financial-effect','posted-original-cash-reversed','original-entry-replays-do-not-restore','later-payment-kept-original-reversal-receipt'];
  assert.deepEqual(e.stages.map(s => s.label), labels);
  const adjustment=e.stages[0].adjustments[0]; assert.equal(e.stages[0].adjustments.length,1);
  fields(adjustment,{domain:'finance',amountDelta:50,status:'posted'}); iso(adjustment.appliedAt);
  for (const [index, stage] of e.stages.entries()) {
    assert.equal(stage.order.id, e.orderId); assert.equal(stage.order.paidAmount, [350,350,50,50,150][index]);
    fields(stage.order,{currency:'CNY',finalAmount:1000,receivableAdjustmentAmount:0,paymentStatus:'partial'});
    same(stage.adjustments,e.stages[0].adjustments);
    assert.equal(stage.order.paymentRecords.length,index===4?2:1);
    assert.equal(new Set(stage.order.paymentRecords.map(p=>p.id)).size,stage.order.paymentRecords.length);
    if(index===4) {
      const later=stage.order.paymentRecords.find(p=>p.id!==e.paymentId); assert(later); positiveId(later.id);
      fields(later,{amount:100,currency:'CNY',exchangeRate:1,baseAmount:100,status:'verified'});
    }
    assert(stage.order.paymentRecords.every(p => p.orderId === e.orderId));
    assert(stage.adjustments.every(a => a.orderId === e.orderId || (a.orderId === null && a.targetId === e.orderId)));
    const canonical = stage.order.paymentRecords.filter(p => p.status === 'verified').reduce((total,p) => total + cents(p.amount), 0)
      + stage.adjustments.filter(a => a.domain === 'finance' && a.appliedAt && ['posted','reversed'].includes(a.status)).reduce((total,a) => total + cents(a.amountDelta), 0);
    assert.equal(canonical, cents(stage.order.paidAmount)); assert.equal(stage.readbacks.length, 2);
    assert(stage.readbacks.every(o => o.id === e.orderId && o.paidAmount === stage.order.paidAmount && o.paymentStatus === stage.order.paymentStatus));
    const original = stage.order.paymentRecords.find(p => p.id === e.paymentId); assert(original);
    assert.equal(original.status, index < 2 ? 'verified' : 'reversed');
    same({ ...original, status: e.originalPayment.status, updatedAt: e.originalPayment.updatedAt }, e.originalPayment);
  }
  assert.deepEqual(e.requestSameKeyRace.map(r => r.status).sort(), [200,201]);
  assert(e.requestSameKeyRace.every(r => JSON.stringify(data(r).receipt) === JSON.stringify(e.originalRequestReceipt)));
  assert.deepEqual(e.requestDifferentKeyRace.map(r => r.status).sort(), [201,409]);
  assert.deepEqual(e.approvalRace.map(r => data(r).replayed).sort(), [false,true]);
  assert(e.approvalRace.every(r => JSON.stringify(data(r).receipt) === JSON.stringify(e.approval.receipt)));
  assert.equal(e.requests.length, 2); assert.deepEqual(e.requests.map(r => r.status).sort(), ['posted','rejected']);
  assert.equal(new Set(e.requests.map(r => r.id)).size,2); assert.equal(new Set(e.requests.map(r => r.requestKey)).size,2);
  assert.equal(new Set(e.requests.map(r => r.reviewKey)).size,2);
  assert.equal(e.audits.length,5); assert.equal(new Set(e.audits.map(a => a.id)).size,5);
  for(const audit of e.audits) { positiveId(audit.id); positiveId(audit.userId); fields(audit,{resource:'payment',resourceId:e.paymentId}); iso(audit.createdAt); }
  const verifiedAudit=e.audits.find(a => a.action==='PAYMENT_VERIFIED'); assert(verifiedAudit); assert.equal(verifiedAudit.userId,original.verifiedBy);
  const formattedRequest = (r,pending=false) => ({ id:r.id,paymentId:e.paymentId,status:pending?'pending':r.status,requestedBy:r.requestedBy,
    reasonCategory:r.reasonCategory,reason:r.reason,createdAt:iso(r.createdAt),reviewedBy:pending?null:r.reviewedBy,
    reviewNote:pending?null:r.reviewNote,reviewedAt:pending?null:iso(r.reviewedAt),originalPayment:originalFacts,
    requestReceipt:JSON.parse(r.requestReceiptJson),reviewReceipt:pending?null:JSON.parse(r.reviewReceiptJson) });
  for (const request of e.requests) {
    uuid(request.id); key(request.requestKey); key(request.reviewKey); positiveId(request.requestedBy); positiveId(request.reviewedBy);
    assert.equal(request.paymentId, e.paymentId); assert.equal(request.activePaymentId, null); assert.notEqual(request.requestedBy, request.reviewedBy);
    const original = JSON.parse(request.originalPaymentJson), receipt = JSON.parse(request.requestReceiptJson);
    same(original,originalFacts); assert.equal(request.originalAuditId,verifiedAudit.id);
    assert.equal(request.fingerprint, hash({ version:'payment-reversal-request-facts/v1', paymentId:e.paymentId, userId:request.requestedBy,
      reasonCategory:request.reasonCategory,reason:request.reason,original:request.originalPaymentJson }));
    assert.equal(receipt.requestId,request.id); assert.equal(receipt.status,'pending'); assert.equal(receipt.amount,300);
    assert.equal(receipt.currency,'CNY'); assert.equal(receipt.orderId,e.orderId); assert.equal(receipt.auditId,request.requestAuditId);
    assert.equal(receipt.requestedBy,request.requestedBy); assert.equal(receipt.requestedAt,new Date(request.createdAt).toISOString());
    same(receipt,{version:'payment-reversal-request/v1',requestId:request.id,requestKey:request.requestKey,paymentId:e.paymentId,orderId:e.orderId,
      requestedBy:request.requestedBy,amount:300,currency:'CNY',status:'pending',auditId:request.requestAuditId,requestedAt:iso(request.createdAt),
      reasonCategory:request.reasonCategory,reason:request.reason});
    const review = JSON.parse(request.reviewReceiptJson), isPosted=request.status==='posted';
    assert.equal(request.reviewFingerprint, hash({version:'payment-reversal-review-facts/v1',requestId:request.id,userId:request.reviewedBy,decision:isPosted?'approve':'reject',note:request.reviewNote}));
    assert.equal(review.status,request.status); assert.equal(review.paymentId,e.paymentId); assert.equal(review.reviewedBy,request.reviewedBy);
    assert.equal(review.auditId,request.reviewAuditId); assert.equal(review.amount,isPosted?-300:0);
    assert.equal(review.beforePaidAmount,350); assert.equal(review.afterPaidAmount,isPosted?50:350);
    same(review,{version:'payment-reversal-review/v1',requestId:request.id,reviewKey:request.reviewKey,paymentId:e.paymentId,orderId:e.orderId,
      reversalId:isPosted?e.reversals[0]?.id:null,status:request.status,requestedBy:request.requestedBy,reviewedBy:request.reviewedBy,
      amount:isPosted?-300:0,currency:'CNY',auditId:request.reviewAuditId,reviewedAt:iso(request.reviewedAt),beforePaidAmount:350,afterPaidAmount:isPosted?50:350});
    const requestedAudit=e.audits.find(a=>a.id===request.requestAuditId),reviewAudit=e.audits.find(a=>a.id===request.reviewAuditId);
    fields(requestedAudit,{action:'PAYMENT_REVERSAL_REQUESTED',userId:request.requestedBy});
    same(JSON.parse(requestedAudit.details),{requestId:request.id,orderId:e.orderId,amount:300,currency:'CNY',
      reasonCategory:request.reasonCategory,reason:request.reason,fingerprint:request.fingerprint,originalAuditId:verifiedAudit.id});
    fields(reviewAudit,{action:isPosted?'PAYMENT_REVERSED':'PAYMENT_REVERSAL_REJECTED',userId:request.reviewedBy});
    same(JSON.parse(reviewAudit.details),{requestId:request.id,reversalId:review.reversalId,requestedBy:request.requestedBy,reviewedBy:request.reviewedBy,
      decision:isPosted?'approve':'reject',note:request.reviewNote,orderId:e.orderId,amount:isPosted?-300:0,currency:'CNY',beforePaidAmount:350,afterPaidAmount:isPosted?50:350});
  }
  assert.equal(e.reversals.length,1); const effect=e.reversals[0], request=e.requests.find(r=>r.status==='posted');
  const rejected=e.requests.find(r=>r.status==='rejected');
  fields(request,{requestedBy:rejected.requestedBy,reviewedBy:rejected.reviewedBy});
  assert.equal(e.firstRequestId,rejected.id); assert.equal(e.acceptedRequestId,request.id);
  same(e.originalRequestReceipt,JSON.parse(rejected.requestReceiptJson));
  fields(data(e.firstRequest),{request:formattedRequest(rejected,true),receipt:e.originalRequestReceipt,replayed:false});
  for(const response of e.requestSameKeyRace) fields(data(response),{request:formattedRequest(rejected,true),receipt:e.originalRequestReceipt});
  assert.deepEqual(e.requestSameKeyRace.map(r=>data(r).replayed).sort(),[false,true]);
  fields(data(e.requestDifferentKeyRace.find(r=>r.status===201)),{request:formattedRequest(request,true),receipt:JSON.parse(request.requestReceiptJson),replayed:false});
  fields(e.rejection,{request:formattedRequest(rejected),receipt:JSON.parse(rejected.reviewReceiptJson),replayed:false});
  fields(e.approval,{request:formattedRequest(request),receipt:JSON.parse(request.reviewReceiptJson),replayed:false});
  for(const response of e.approvalRace) fields(data(response),{request:formattedRequest(request),receipt:JSON.parse(request.reviewReceiptJson)});
  uuid(effect.id); assert.equal(iso(effect.createdAt),iso(request.reviewedAt));
  assert.equal(effect.paymentId,e.paymentId); assert.equal(effect.requestId,request.id); assert.equal(effect.amount,-300); assert.equal(effect.currency,'CNY');
  assert.equal(effect.postedBy,request.reviewedBy); assert.equal(effect.auditId,request.reviewAuditId); assert.equal(effect.receiptJson,request.reviewReceiptJson);
  same(JSON.parse(effect.beforeStateJson),{orderId:e.orderId,paidAmount:350,paymentStatus:e.stages[1].order.paymentStatus});
  same(JSON.parse(effect.afterStateJson),{orderId:e.orderId,paidAmount:50,paymentStatus:e.stages[2].order.paymentStatus});
  for (const action of ['PAYMENT_VERIFIED','PAYMENT_REVERSED','PAYMENT_REVERSAL_REJECTED']) assert.equal(e.audits.filter(a=>a.action===action).length,1);
  assert.equal(e.audits.filter(a=>a.action==='PAYMENT_REVERSAL_REQUESTED').length,2);
  assert.equal(e.events.length,2); assert.equal(new Set(e.events.map(v=>v.id)).size,2);
  for (const type of ['payment.verified','payment.reversed']) {
    const events=e.events.filter(v=>v.eventKey===`${type}:${e.paymentId}`); assert.equal(events.length,1);
    const event=events[0],payload=JSON.parse(event.payloadJson); assert.equal(payload.type,type); assert.equal(payload.resourceId,e.paymentId);
    positiveId(event.id); uuid(payload.id); fields(event,{aggregateType:'payment',aggregateId:String(e.paymentId)});
    assert.equal(payload.resourceType,'payment'); assert.equal(iso(payload.occurredAt),iso(event.createdAt));
    assert.equal(event.eventType,type); assert.equal(payload.data.orderId,e.orderId); assert.equal(payload.data.amount,type==='payment.reversed'?-300:300);
    assert(event.deliveries.some(d=>d.channel==='realtime'&&d.destinationKey==='finance-notifications'));
    assert(event.deliveries.every(d=>d.eventId===event.id));
    assert.equal(new Set(event.deliveries.map(d=>`${d.channel}:${d.destinationKey}`)).size,event.deliveries.length);
    if(type==='payment.reversed') {
      assert.equal(iso(payload.occurredAt),iso(effect.createdAt));
      same(payload.data,{paymentId:e.paymentId,orderId:e.orderId,reversalId:effect.id,requestId:request.id,amount:-300,currency:'CNY',
        requestedBy:request.requestedBy,reviewedBy:request.reviewedBy,auditId:effect.auditId,beforePaidAmount:350,afterPaidAmount:50});
    } else {
      same(payload.data,{orderId:e.orderId,paymentId:e.paymentId,amount:300,currency:'CNY',verifiedBy:original.verifiedBy,auditId:verifiedAudit.id});
      same(JSON.parse(verifiedAudit.details),{eventId:payload.id,eventKey:event.eventKey,orderId:e.orderId,paymentId:e.paymentId,
        amount:300,currency:'CNY',verifiedBy:original.verifiedBy});
    }
  }
  assert.equal(new Set(e.events.map(v=>JSON.parse(v.payloadJson).id)).size,2);
  assert.deepEqual(e.immutableDenials.map(d=>d.label),['original-amount','original-date','original-verifier','original-revive','request-receipt','effect-amount','effect-delete','original-audit','reversal-audit-delete','original-delete']);
  assert(e.immutableDenials.every(d=>/PAYMENT_REVERSAL_|foreign key constraint/i.test(d.message)));
  assert.match(e.immutableBeforeSha256,/^[a-f0-9]{64}$/); assert.equal(e.immutableAfterSha256,e.immutableBeforeSha256);
  assert.equal(e.immutableBeforeSha256,hash({payment:e.stages.at(-1).order.paymentRecords.find(p=>p.id===e.paymentId),
    requests:e.requests,effects:e.reversals,audits:e.audits}));
  assert.equal(e.history.length,2); assert(e.history.every(h=>h.paymentStatus==='reversed'&&!h.eligibility.allowed&&h.currentOrder.paidAmount===150&&h.originalPayment.amount===300&&h.reversal.amount===-300));
  for(const history of e.history) {
    fields(history,{paymentId:e.paymentId,paymentStatus:'reversed',originalPayment:originalFacts,
      reversal:{id:effect.id,requestId:effect.requestId,amount:effect.amount,currency:effect.currency,postedBy:effect.postedBy,
        auditId:effect.auditId,postedAt:iso(effect.createdAt),receipt:JSON.parse(effect.receiptJson)}});
    fields(history.currentOrder,{id:e.orderId,currency:'CNY',paidAmount:150,paymentStatus:e.stages.at(-1).order.paymentStatus,
      finalAmount:e.stages.at(-1).order.finalAmount,receivableAdjustmentAmount:e.stages.at(-1).order.receivableAdjustmentAmount});
    assert.equal(history.requests.length,2); assert.equal(new Set(history.requests.map(r=>r.id)).size,2);
    for(const raw of e.requests) same(history.requests.find(r=>r.id===raw.id),formattedRequest(raw));
  }
  assert.equal(e.pendingPaymentRequest.status,409); assert.equal(e.strictBodyRequest.status,400);
  return { version:'payment-reversal-api-proof/v1',orderId:e.orderId,paymentId:e.paymentId,requestId:request.id,reversalId:effect.id,
    states:labels.length,requestRaces:2,approvalEffects:1,immutableDenials:e.immutableDenials.length,
    scope:'API/database proof only; browser/recovery/cloud/37-check promotion not established' };
}
module.exports={verifyPaymentReversalApiProof};
