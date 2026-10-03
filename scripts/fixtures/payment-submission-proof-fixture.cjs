// Synthetic validator-unit evidence only; never imported by the actual business executor.
const crypto = require('node:crypto');
function paymentSubmissionProofFixture(provider='postgresql') {
  const receipts=[1,2,3].map(paymentId=>({version:'payment-submission/v1',requestKey:`fixture-key-${paymentId}`,paymentId,orderId:9,
    amount:300,method:'bank_transfer',date:'2026-10-03T00:00:00.000Z',submittedBy:10,auditId:paymentId+20,submittedAt:'2026-10-03T12:00:00.000Z',status:'pending'}));
  const state=n=>({payments:receipts.slice(0,n).map(r=>({id:r.paymentId,orderId:9,amount:300,date:r.date,method:r.method,status:'verified'})),
    submissions:receipts.slice(0,n).map(r=>({requestKey:r.requestKey,userId:10,paymentId:r.paymentId,fingerprint:'a'.repeat(64),resultJson:JSON.stringify(r)})),
    audits:receipts.slice(0,n).map(r=>({id:r.auditId,userId:10,action:'PAYMENT_SUBMITTED',resourceId:9,details:JSON.stringify({paymentId:r.paymentId,fingerprint:'a'.repeat(64),submissionKeyHash:crypto.createHash('sha256').update(r.requestKey).digest('hex')})})),
    order:{id:9,paidAmount:n*300,paymentStatus:'partial'}});
  const response=(r,replayed)=>({status:200,json:{paymentSubmission:r,replayed}});
  const payload={amount:300,date:'2026-10-03',method:'bank_transfer',isProxy:false,payerName:'payer',note:'note',idempotencyKey:receipts[2].requestKey};
  const {idempotencyKey,...facts}=payload;
  const font={missingSignatures:['missing1','missing2'],glyphs:Array.from({length:8},(_,i)=>({signature:`glyph${i}`,inkPixels:10}))};
  return {provider,orderId:9,key:receipts[0].requestKey,elapsedMs:16000,originalReceipt:receipts[0],browserErrors:[],
    burst:Array.from({length:8},(_,i)=>response(receipts[0],i!==0)),responses:[response(receipts[0],false),response(receipts[0],true)],
    verifiedReplay:response(receipts[0],true),before:state(1),twoGenuine:state(2),genuineSecondReceipt:receipts[1],afterVerification:state(2),
    negatives:['changed-amount','changed-method','changed-date','changed-note','changed-payer','changed-proxy','different-principal','missing-key','different-order','pending-capacity'].map(label=>({label,
      status:label==='missing-key'?400:409,code:label==='missing-key'?'PAYMENT_SUBMISSION_KEY_REQUIRED':label==='pending-capacity'?'PAYMENT_SUBMISSION_PENDING_CAPACITY':'PAYMENT_SUBMISSION_KEY_CONFLICT',paymentCount:0,auditCount:0})),
    browser:{role:'sales',actorId:10,faultRequests:1,lockedUnknownFacts:true,payload,originalReceipt:receipts[2],committedResponse:response(receipts[2],false),recoveredResponse:response(receipts[2],true),
      storageBefore:{slot:JSON.stringify({version:'payment-intent/v1',key:idempotencyKey,userId:'10',orderId:'9',facts})},storageAfter:[]},
    restart:{killed:2,restarted:2,signal:'SIGKILL',databaseRestarted:false,exitCodes:[137,137]},finalSnapshot:state(3),afterAllReplays:state(3),
    apiReadbacks:[0,1].map(instance=>({instance,orderId:9,paidAmount:900,count:3,paymentStatus:'partial'})),
    screenshots:[{kind:'unknown-ack',path:'fixture-unknown.png',font},...[11,12].map(actorId=>({kind:'finance-readback',actorId,path:`fixture-${actorId}.png`,statusVisible:true,amountVisible:true,text:'300.00 已核销',font}))],
    immutabilityGuards:[{operation:'update',rejected:true},{operation:'delete',rejected:true}],
    crossOrderRace:{statuses:[200,409],orderIds:[11,12],paymentCount:1,auditCount:1,identityCount:1},
    capacityRace:{statuses:[200,409],orderId:13,paymentCount:1,auditCount:1,identityCount:1,amount:600}};
}
module.exports={paymentSubmissionProofFixture};
