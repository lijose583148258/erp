const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const assert=require('node:assert/strict');
const {readRegressionStamp}=require('./lib/enterprise-regression.cjs');
const {ensureUiAuditUser,createAuditPrismaClient,loginUiAuditUser}=require('./lib/ui-audit-user.cjs');
const {ensureReleasedMaterial}=require('./lib/material-audit-fixture.cjs');
const {launchBrowserWithGuard}=require('./lib/browser-launch-guard.cjs');
const {expect}=require('playwright/test');
const cancellationAudit = process.env.ROUND2_QUANTITY_CANCELLATION === 'true';
process.env.ROUND2_REPORT_PATH ||= path.resolve(cancellationAudit ? 'output/audit/customer-quantity-cancellation/report.json' : 'output/audit/sales-partial-fulfillment/report.json');
fs.mkdirSync(path.dirname(process.env.ROUND2_REPORT_PATH),{recursive:true});
const urls=[process.env.APP_URL,process.env.SECONDARY_APP_URL].map(url=>String(url||'').replace(/\/$/,''));
const runId=`partial-${Date.now()}`;
const report={name:'Sales partial fulfillment regression',scope:'Two API instances; authorized admin browser creates a line-bound remainder shipment and dispatches; not complete presale/backorder/workforce acceptance',runId,
  commit:process.env.ROUND2_COMMIT||process.env.GITHUB_SHA,dirty:process.env.ROUND2_DIRTY,sourceHash:process.env.ROUND2_SOURCE_HASH,status:'failed',summary:{passedChecks:0,failedChecks:1,remainingChecks:0}};
report.regression=readRegressionStamp();report.startedAt=new Date().toISOString();report.provider=process.env.AUDIT_PRISMA_PROVIDER||'sqlite';
let prisma;let token;let browser;let page;
async function request(endpoint,{method='GET',data,instance=0}={}){
  const response=await fetch(`${urls[instance]}/api${endpoint}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
  const json=await response.json();return{status:response.status,ok:response.ok,json};
}
function dataOf(result){assert(result.ok,`HTTP ${result.status}: ${JSON.stringify(result.json)}`);assert(result.json.data);return result.json.data;}
async function captureFulfillment(axis, name) {
  await page.locator('#loading').waitFor({state:'hidden',timeout:10000});
  await axis.evaluate(element=>element.scrollIntoView({block:'center',inline:'center',behavior:'instant'}));
  await expect(axis).toBeVisible();
  const bounds=await axis.evaluate(element=>{
    const box=element.getBoundingClientRect();const top=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
    return{rect:box.toJSON(),notCovered:!!top&&(top===element||element.contains(top))};
  });
  assert(bounds.notCovered,'Fulfillment readback is covered by sticky columns or overlays');
  (report.browserBounds ||= []).push({name,text:await axis.innerText(),...bounds});
  await page.screenshot({path:path.join(path.dirname(process.env.ROUND2_REPORT_PATH),name)});
}
async function auditQuantityCancellation({order,original,batch,batchNo,password,sales,salesLogin,adminToken,material,customer}){
  report.name='Customer quantity cancellation audit';report.scope='Explicit unallocated-demand cancellation with independent finance, immutable originals and exact AR; excludes refunds and physical stock reservation';
  await ensureUiAuditUser({username:`${runId}-finance`,password,role:'finance',segment:'mixed'});
  await ensureUiAuditUser({username:`${runId}-outsider`,password,role:'sales',segment:'direct'});
  const financeLogin=dataOf(await request('/auth/login',{method:'POST',data:{username:`${runId}-finance`,password}}));
  const outsider=dataOf(await request('/auth/login',{method:'POST',data:{username:`${runId}-outsider`,password}}));
  const state=async()=>({order:await prisma.order.findUnique({where:{id:Number(order.id)},include:{items:true,shipments:{include:{receipts:true}},paymentRecords:true}}),
    adjustments:await prisma.receivableAdjustment.findMany({where:{orderId:Number(order.id)},orderBy:{id:'asc'}}),
    balances:await prisma.stockBalance.findMany({where:{materialId:material.id,batchNo},orderBy:{id:'asc'}}),
    cost:await prisma.inventoryCostLedger.findMany({where:{batchId:batch.id},orderBy:{id:'asc'}})});
  const before=await state();report.cancellation={before,rejections:[],actors:{sales:sales.id,finance:financeLogin.user.id}};
  const input={orderItemId:original.items[0].id,quantity:60,expectedUpdatedAt:dataOf(await request('/orders/'+order.id)).updatedAt,idempotencyKey:crypto.randomUUID(),reason:'Customer written cancellation of the remaining 60 kg'};
  const endpoint='/orders/'+order.id+'/quantity-cancellations';
  const reject=async(name,promise,status,code)=>{const result=await promise;report.cancellation.rejections.push({name,...result});assert.equal(result.status,status,JSON.stringify(result));if(code)assert.equal(result.json.errorCode,code);};
  token=outsider.token;await reject('foreign customer',request(endpoint,{method:'POST',data:input}),404,'ORDER_CANCELLATION_NOT_FOUND');
  token=salesLogin.token;
  await reject('exceeds unallocated',request(endpoint,{method:'POST',data:{...input,quantity:61}}),409,'ORDER_CANCELLATION_QUANTITY_EXCEEDED');
  await reject('stale order version',request(endpoint,{method:'POST',data:{...input,expectedUpdatedAt:'2020-01-01T00:00:00.000Z'}}),409,'ORDER_CANCELLATION_STATE_CHANGED');
  await reject('client-chosen price',request(endpoint,{method:'POST',data:{...input,amount:1}}),400);
  assert.deepEqual(await state(),before);

  const launched=await launchBrowserWithGuard({launchTimeoutMs:15000,totalTimeoutMs:45000,maxAttemptsPerStrategy:1});browser=launched.browser;
  page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
  salesLogin.token=(await loginUiAuditUser(page,urls[0]+'/',{account:{username:`${runId}-sales`,password,role:'sales',segment:'direct'},storage:{'ailao.language':'zh','language':'zh-CN'}})).token;token=salesLogin.token;
  await page.goto(urls[0]+'/#orders');await page.getByTestId('sales-desk-fulfillment').click();
  await page.getByTestId('sales-order-cancellation-'+order.id).click();
  await page.getByTestId('sales-cancellation-line').selectOption(String(input.orderItemId));
  await page.getByTestId('sales-cancellation-quantity').fill('60');await page.getByTestId('sales-cancellation-reason').fill(input.reason);
  let captured;let release;const intercepted=new Promise(resolve=>{release=resolve});
  const lostAck={endpoint,instance:0};
  const failedRequest=page.waitForEvent('requestfailed',{predicate:r=>r.url().endsWith(endpoint)&&r.method()==='POST'});
  await page.route('**/api'+endpoint,async route=>{try{const response=await route.fetch();captured={status:response.status(),json:await response.json(),sent:route.request().postDataJSON()};lostAck.receivedAt=performance.now();await route.abort('failed');}finally{release();}});
  await page.getByTestId('sales-cancellation-submit').click();await intercepted;
  lostAck.failure=(await failedRequest).failure();lostAck.failedAt=performance.now();
  assert.equal(captured.status,201,JSON.stringify(captured));const created=captured.json.data,sent=captured.sent;
  await expect(page.getByTestId('sales-cancellation-dialog')).toContainText('结果未确认');
  await expect(page.getByTestId('sales-cancellation-submit')).toBeDisabled();
  lostAck.failureText=await page.getByTestId('sales-cancellation-dialog').innerText();lostAck.submitDisabled=true;
  await page.screenshot({path:path.join(path.dirname(process.env.ROUND2_REPORT_PATH),'sales-cancellation-lost-ack.png')});
  await page.unroute('**/api'+endpoint);await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByTestId('sales-order-cancellation-'+order.id).click();
  await expect(page.getByTestId('sales-cancellation-history')).toContainText(created.adjustmentNo);
  await expect(page.getByTestId('sales-cancellation-history')).toContainText('待财务过账');
  lostAck.recoveryText=await page.getByTestId('sales-cancellation-history').innerText();lostAck.recoveredAt=performance.now();
  await page.screenshot({path:path.join(path.dirname(process.env.ROUND2_REPORT_PATH),'sales-cancellation-pending.png')});
  const pending=await state();assert.equal(pending.order.receivableAdjustmentAmount,0);assert.equal(pending.order.paidAmount,400);
  assert.equal(dataOf(await request('/orders/'+order.id)).fulfillment.lines[0].outstandingQuantity,60);
  const replay=await request(endpoint,{method:'POST',data:sent,instance:1});assert.equal(dataOf(replay).id,created.id);
  await reject('same key altered reason',request(endpoint,{method:'POST',data:{...sent,reason:'different reason'}}),409,'ORDER_CANCELLATION_IDEMPOTENCY_CONFLICT');
  await reject('sales cannot post',request('/finance/receivable-adjustments/'+created.id+'/post',{method:'POST'}),403);
  report.cancellation.pending={created,sent,replay,persisted:pending};
  report.cancellation.lostAck={...lostAck,upstreamStatus:captured.status,upstreamId:created.id};

  const financePage=await browser.newPage({viewport:{width:1440,height:1000}});financePage.setDefaultTimeout(15000);
  financeLogin.token=(await loginUiAuditUser(financePage,urls[1]+'/',{account:{username:`${runId}-finance`,password,role:'finance',segment:'mixed'},storage:{'ailao.language':'zh','language':'zh-CN'}})).token;
  await financePage.goto(urls[1]+'/#financeAnalytics');
  await financePage.getByRole('tab',{name:/台账回读/}).click();
  const postResponse=financePage.waitForResponse(r=>r.url().endsWith('/finance/receivable-adjustments/'+created.id+'/post'));
  await financePage.getByTestId('receivable-adjustment-post-'+created.id).click();const postedResponse=await postResponse;
  assert.equal(postedResponse.status(),200,await postedResponse.text());report.cancellation.financePost=await postedResponse.json();
  await expect(financePage.getByTestId('receivable-adjustment-reverse-'+created.id)).toBeVisible();
  const effective=financePage.getByText('有效 400.00 CNY',{exact:true});await expect(effective).toBeVisible();
  const salesPage=page;page=financePage;try{await captureFulfillment(effective,'finance-cancellation-posted.png');}finally{page=salesPage;}
  token=financeLogin.token;const posted=await state();report.cancellation.posted=posted;
  assert.equal(posted.order.receivableAdjustmentAmount,600);assert.equal(posted.order.paidAmount,400);assert.equal(posted.order.finalAmount,1000);assert.equal(posted.order.paymentStatus,'paid');
  for(const key of ['items','shipments','paymentRecords'])assert.deepEqual(posted.order[key],before.order[key]);
  for(const key of ['balances','cost'])assert.deepEqual(posted[key],before[key]);
  token=salesLogin.token;
  report.cancellation.readbacks=await Promise.all([0,1].map(instance=>request('/orders/'+order.id,{instance}).then(dataOf)));
  for(const detail of report.cancellation.readbacks){assert.equal(detail.fulfillmentStatus,'resolved_with_cancellation');assert.equal(detail.fulfillment.fullyDelivered,false);assert.equal(detail.fulfillment.fullyResolved,true);assert.equal(detail.fulfillment.lines[0].cancelledQuantity,60);assert.equal(detail.fulfillment.lines[0].acceptedQuantity,40);assert.equal(detail.fulfillment.lines[0].outstandingQuantity,0);}
  await page.getByRole('button',{name:'刷新回读',exact:true}).click();await expect(page.getByTestId('sales-cancellation-history')).toContainText('已过账');
  await page.getByRole('button',{name:'关闭',exact:true}).click();const axis=page.getByTestId('order-fulfillment-'+order.id);
  await expect(axis).toContainText('履约已解决（含取消）');await expect(axis).toContainText('已取消待交量 60 kg');
  await captureFulfillment(axis,'sales-cancellation-resolved.png');
  token=adminToken;
  const shipmentData={customerId:Number(customer.id),orderId:Number(order.id),orderItemId:Number(input.orderItemId),materialId:material.id,productName:material.nameZh,quantity:1,unit:'kg',batchNo,carrier:'Synthetic'};
  await reject('cannot ship cancelled quantity',request('/shipping',{method:'POST',data:shipmentData}),409);
  await reject('cannot omit line binding',request('/shipping',{method:'POST',data:{...shipmentData,orderItemId:undefined}}),409);
  await reject('not a physical delivery',request('/orders/'+order.id+'/status',{method:'PATCH',data:{status:'delivered'}}),409,'ORDER_FULFILLMENT_INCOMPLETE');
  token=financeLogin.token;
  const replayPost=dataOf(await request('/finance/receivable-adjustments/'+created.id+'/post',{method:'POST',instance:0}));assert.equal(replayPost.changed,false);
  const reversed=dataOf(await request('/finance/receivable-adjustments/'+created.id+'/reverse',{method:'POST',data:{note:'Restore obligation before renewed customer confirmation'}}));assert.equal(reversed.changed,true);
  token=salesLogin.token;const restored=dataOf(await request('/orders/'+order.id));assert.equal(restored.fulfillment.lines[0].outstandingQuantity,60);assert.equal(restored.receivableAdjustmentAmount,0);
  const replacement=dataOf(await request(endpoint,{method:'POST',data:{...input,expectedUpdatedAt:restored.updatedAt,idempotencyKey:crypto.randomUUID(),reason:'Renewed customer written cancellation of remaining 60 kg'}}));
  token=financeLogin.token;dataOf(await request('/finance/receivable-adjustments/'+replacement.id+'/post',{method:'POST'}));
  token=adminToken;const completed=dataOf(await request('/orders/'+order.id+'/complete',{method:'PUT',data:{}}));assert.equal(completed.status,'completed');assert.equal(completed.fulfillment.fullyDelivered,false);
  token=financeLogin.token;await reject('cannot reopen closed order',request('/finance/receivable-adjustments/'+replacement.id+'/reverse',{method:'POST',data:{note:'Forbidden reversal after closure'}}),409);
  const final=await state();for(const key of ['items','shipments','paymentRecords'])assert.deepEqual(final.order[key],before.order[key]);for(const key of ['balances','cost'])assert.deepEqual(final[key],before[key]);
  const audit=await prisma.auditLog.findMany({where:{resource:'receivable_adjustment',resourceId:{in:[created.id,replacement.id]}},orderBy:{id:'asc'}});
  assert.equal(audit.filter(r=>r.action==='REQUEST_ORDER_QUANTITY_CANCELLATION').length,2);assert.equal(audit.filter(r=>r.action==='POST_ORDER_QUANTITY_CANCELLATION').length,2);assert.equal(audit.filter(r=>r.action==='REVERSE_ORDER_QUANTITY_CANCELLATION').length,1);
  Object.assign(report.cancellation,{replayPost,reversed,restored,replacement,completed,final,audit});
  report.cancellation.races=[];
  for(const kind of ['double-post','post-vs-shipment']){
    token=salesLogin.token;const fresh=dataOf(await request('/orders',{method:'POST',data:{customerId:Number(customer.id),items:[{materialId:material.id,productName:material.nameZh,quantity:100,unit:'kg',unitPrice:10}],paymentTerms:30}}));
    token=adminToken;dataOf(await request('/orders/'+fresh.id+'/status',{method:'PATCH',data:{status:'confirmed'}}));
    const originalRace=dataOf(await request('/orders/'+fresh.id));
    token=salesLogin.token;const intent={orderItemId:originalRace.items[0].id,quantity:70,expectedUpdatedAt:originalRace.updatedAt,idempotencyKey:crypto.randomUUID(),reason:'Race fixture customer quantity cancellation'};
    const duplicates=await Promise.all([0,1].map(instance=>request('/orders/'+fresh.id+'/quantity-cancellations',{method:'POST',data:intent,instance})));
    const credit=dataOf(duplicates[0]);assert.equal(dataOf(duplicates[1]).id,credit.id);
    token=financeLogin.token;const postOp=request('/finance/receivable-adjustments/'+credit.id+'/post',{method:'POST',instance:0});
    token=kind==='double-post'?financeLogin.token:adminToken;
    const competing=kind==='double-post'?request('/finance/receivable-adjustments/'+credit.id+'/post',{method:'POST',instance:1}):request('/shipping',{method:'POST',instance:1,data:{...shipmentData,orderId:Number(fresh.id),orderItemId:Number(originalRace.items[0].id),quantity:40}});
    const outcomes=await Promise.all([postOp,competing]);assert(outcomes.every(r=>[200,201,409].includes(r.status)),JSON.stringify(outcomes));
    const afterRace=await prisma.order.findUnique({where:{id:Number(fresh.id)},include:{items:true,receivableAdjustments:true,shipments:true}});
    const postedCredits=afterRace.receivableAdjustments.filter(r=>r.status==='posted');const cancelled=postedCredits.reduce((s,r)=>s+r.cancelledQuantity,0),allocated=afterRace.shipments.reduce((s,r)=>s+r.quantity,0);
    assert.equal(afterRace.receivableAdjustmentAmount,cancelled*10);assert.equal(afterRace.paidAmount,0);assert.equal(afterRace.items[0].quantity,100);assert.equal(afterRace.finalAmount,1000);assert(cancelled+allocated<=100);
    if(kind==='double-post'){assert.equal(cancelled,70);assert.equal(outcomes.filter(r=>r.json.data?.changed===true).length,1)}
    else{assert.equal(outcomes.filter(r=>r.ok).length,1);assert((cancelled===70&&allocated===0)||(cancelled===0&&allocated===40));}
    const audits=await prisma.auditLog.findMany({where:{resource:'receivable_adjustment',resourceId:credit.id},orderBy:{id:'asc'}});
    assert.equal(audits.filter(r=>r.action==='REQUEST_ORDER_QUANTITY_CANCELLATION').length,1);assert.equal(audits.filter(r=>r.action==='POST_ORDER_QUANTITY_CANCELLATION').length,postedCredits.length);
    report.cancellation.races.push({kind,original:originalRace,duplicates,outcomes,after:afterRace,audits});
  }
  // Financial-only credits must not erase demand; unsupported refunds fail without writes.
  token=salesLogin.token;
  const boundaryOrder=dataOf(await request('/orders',{method:'POST',data:{customerId:Number(customer.id),items:[{materialId:material.id,productName:material.nameZh,quantity:100,unit:'kg',unitPrice:10}],paymentTerms:30}}));
  token=adminToken;dataOf(await request('/orders/'+boundaryOrder.id+'/status',{method:'PATCH',data:{status:'confirmed'}}));
  dataOf(await request('/orders/'+boundaryOrder.id+'/payment',{method:'POST',data:{idempotencyKey:crypto.randomUUID(),amount:800,method:'bank_transfer',payerName:runId}}));
  const boundaryPayment=dataOf(await request('/orders/'+boundaryOrder.id)).paymentRecords.find(row=>row.status==='pending');
  assert(boundaryPayment);dataOf(await request(`/orders/${boundaryOrder.id}/payment/${boundaryPayment.id}/verify`,{method:'POST'}));
  const boundaryState=()=>prisma.order.findUnique({where:{id:Number(boundaryOrder.id)},include:{items:true,receivableAdjustments:true,paymentRecords:true,shipments:true}});
  const boundaryBefore=await boundaryState();const boundaryDetail=dataOf(await request('/orders/'+boundaryOrder.id));
  assert.equal(boundaryBefore.paidAmount,800);
  const boundaryInput={orderItemId:boundaryDetail.items[0].id,quantity:60,expectedUpdatedAt:boundaryDetail.updatedAt,idempotencyKey:crypto.randomUUID(),reason:'Unsupported refund must not silently change cash'};
  token=salesLogin.token;
  const refund=await request('/orders/'+boundaryOrder.id+'/quantity-cancellations',{method:'POST',data:boundaryInput});
  assert.equal(refund.status,409);assert.equal(refund.json.errorCode,'ORDER_CANCELLATION_REFUND_REQUIRED');
  const afterRefund=await boundaryState();assert.deepEqual(afterRefund,boundaryBefore);
  token=financeLogin.token;
  const financialCredit=dataOf(await request('/finance/receivable-adjustments',{method:'POST',data:{orderId:Number(boundaryOrder.id),adjustmentType:'credit_memo',amount:100,currency:'CNY',reason:'Money-only commercial concession'}}));
  dataOf(await request('/finance/receivable-adjustments/'+financialCredit.id+'/post',{method:'POST'}));
  const financialReadback=dataOf(await request('/orders/'+boundaryOrder.id));
  assert.equal(financialReadback.fulfillment.lines[0].outstandingQuantity,100);assert.equal(financialReadback.fulfillment.lines[0].cancelledQuantity,0);
  token=adminToken;
  const ownRequest=dataOf(await request('/orders/'+boundaryOrder.id+'/quantity-cancellations',{method:'POST',data:{...boundaryInput,quantity:10,expectedUpdatedAt:financialReadback.updatedAt,idempotencyKey:crypto.randomUUID()}}));
  const beforeSelfPost=await boundaryState();
  const selfPost=await request('/finance/receivable-adjustments/'+ownRequest.id+'/post',{method:'POST'});
  assert.equal(selfPost.status,409);assert.equal(selfPost.json.message,'取消申请必须由另一名财务审核。');
  const afterSelfPost=await boundaryState();assert.deepEqual(afterSelfPost,beforeSelfPost);
  report.cancellation.boundaries={before:boundaryBefore,refund,afterRefund,financialCredit,financialReadback,beforeSelfPost,selfPost,afterSelfPost};
  await financePage.close();
}
async function main(){
  assert.equal(process.env.ROUND2_ALLOW_MUTATIONS,'true');
  if(process.env.AUDIT_PRISMA_PROVIDER==='postgresql') assert.equal(new URL(process.env.AUDIT_DATABASE_URL).hostname,'127.0.0.1');
  else assert(process.env.DATABASE_URL&&String(process.env.AILAODA_RUNTIME_DB_PATH).includes('output'));
  assert(urls.every(url=>new URL(url).hostname==='127.0.0.1'));
  prisma=createAuditPrismaClient();
  const password=crypto.randomBytes(24).toString('base64url')+'!Aa1';
  await ensureUiAuditUser({username:runId,password,role:'admin',segment:'mixed'});
  await ensureUiAuditUser({username:`${runId}-sales`,password,role:'sales',segment:'direct'});
  const salesLogin=dataOf(await request('/auth/login',{method:'POST',data:{username:`${runId}-sales`,password}}));
  const sales=salesLogin.user;
  token=dataOf(await request('/auth/login',{method:'POST',data:{username:runId,password}})).token;
  const material=await ensureReleasedMaterial({request,code:runId,name:runId,category:'finished_good',unit:'kg'});
  const customer=dataOf(await request('/customers',{method:'POST',data:{name:runId,nameZh:runId,creditLimit:100000,termsDays:30,segment:'direct',poolState:'private',salespersonId:Number(sales.id)}}));
  const adminToken=token;token=salesLogin.token;
  const order=dataOf(await request('/orders',{method:'POST',data:{customerId:Number(customer.id),items:[{materialId:material.id,productName:material.nameZh,quantity:100,unit:'kg',unitPrice:10}],paymentTerms:30}}));
  token=adminToken;
  dataOf(await request(`/orders/${order.id}/status`,{method:'PATCH',data:{status:'confirmed'}}));
  token=salesLogin.token;
  dataOf(await request(`/orders/${order.id}/payment`,{method:'POST',data:{ idempotencyKey: require('node:crypto').randomUUID(),amount:cancellationAudit?400:1000,method:'bank_transfer',payerName:runId}}));
  token=adminToken;
  const payment=dataOf(await request(`/orders/${order.id}`)).paymentRecords.find(row=>row.status==='pending');
  assert(payment);dataOf(await request(`/orders/${order.id}/payment/${payment.id}/verify`,{method:'POST'}));
  const original=dataOf(await request(`/orders/${order.id}`));
  const warehouses=dataOf(await request('/warehouses'));
  let source=warehouses.flatMap(w=>w.locations||[]).find(loc=>loc.code==='LOC-FG');
  if(!source){const warehouse=dataOf(await request('/warehouses',{method:'POST',data:{code:runId,name:runId,type:'physical'}}));source=dataOf(await request(`/warehouses/${warehouse.id}/locations`,{method:'POST',data:{code:'LOC-FG',name:runId,type:'internal'}}));}
  const batchNo=`${runId}-batch`;
  dataOf(await request('/warehouses/stock-balances',{method:'POST',data:{locationId:Number(source.id),materialId:material.id,productName:material.nameZh,batchNo,quantity:40,unit:'kg',unitCost:10,sourceRef:runId,reason:'isolated partial fulfillment reproduction'}}));
  const shipment=dataOf(await request('/shipping',{method:'POST',data:{customerId:Number(customer.id),orderId:Number(order.id),orderItemId:Number(original.items[0].id),materialId:material.id,productName:material.nameZh,quantity:40,unit:'kg',batchNo,carrier:'Synthetic'}}));
  dataOf(await request(`/shipping/${shipment.id}/status`,{method:'PATCH',data:{status:'in_transit'}}));
  const receipt=dataOf(await request(`/shipping/${shipment.id}/receipt-events`,{method:'POST',data:{quantity:40,acceptedQuantity:40,rejectedQuantity:0,note:'Synthetic 40/100 kg partial delivery'}}));
  const readbacks=await Promise.all(urls.map((_,instance)=>request(`/orders/${order.id}`,{instance}).then(dataOf)));
  const persisted=await prisma.order.findUnique({where:{id:Number(order.id)},include:{items:true,shipments:{include:{receipts:true}}}});
  const balances=await prisma.stockBalance.findMany({where:{materialId:material.id,batchNo}});
  const batch=await prisma.productBatch.findUnique({where:{batchNo}});
  const ledger=await prisma.inventoryCostLedger.findMany({where:{batchId:batch.id}});
  const accepted=persisted.shipments.flatMap(s=>s.receipts).reduce((sum,r)=>sum+r.acceptedQuantity,0);
  assert.equal(accepted,40);assert.equal(persisted.items[0].quantity,100);
  assert.equal(balances.reduce((sum,r)=>sum+r.quantity,0),0);
  Object.assign(report,{orderId:order.id,shipmentId:shipment.id,original,receipt,readbacks,persisted,balances,batch,ledger,stillOwedQuantity:60});
  assert.equal(persisted.status,'shipped');
  assert(readbacks.every(o=>o.fulfillmentStatus==='partially_delivered'&&o.fulfillment.lines[0].outstandingQuantity===60));
  const ready=dataOf(await request('/orders/shipping-ready',{instance:1}));
  assert(ready.some(o=>o.id===order.id&&o.fulfillment.lines[0].unallocatedQuantity===60));
  if(cancellationAudit){
    await auditQuantityCancellation({order,original,batch,batchNo,password,sales,salesLogin,adminToken,material,customer});
    report.status='passed';report.summary={passedChecks:1,failedChecks:0,remainingChecks:0};return;
  }
  report.earlyClose=[];
  for(const target of ['complete','completed','delivered']){
    const response=await request(`/orders/${order.id}/${target==='complete'?'complete':'status'}`,{method:target==='complete'?'PUT':'PATCH',data:target==='complete'?{}:{status:target},instance:1});
    report.earlyClose.push({target,...response});
    if(target==='completed'){
      assert.equal(response.status,400,JSON.stringify(response)); // Existing route validator already rejects this spelling.
      assert(response.json.errors.some(error=>error.field==='status'));
    }else{
      assert.equal(response.status,409,JSON.stringify(response));
      assert.equal(response.json.errorCode,'ORDER_FULFILLMENT_INCOMPLETE');
    }
  }
  assert.equal((await prisma.order.findUnique({where:{id:order.id}})).status,'shipped');
  assert.equal(await prisma.auditLog.count({where:{resource:'order',resourceId:order.id,action:'COMPLETE'}}),0);

  const launched=await launchBrowserWithGuard({launchTimeoutMs:15000,totalTimeoutMs:45000,maxAttemptsPerStrategy:1});
  browser=launched.browser;page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(15000);
  const salesPage=await browser.newPage({viewport:{width:1440,height:1000}});
  try {
    await loginUiAuditUser(salesPage,`${urls[0]}/`,{account:{username:`${runId}-sales`,password,role:'sales',segment:'direct'},storage:{'ailao.language':'zh','language':'zh-CN'}});
    await salesPage.goto(`${urls[0]}/#orders`);
    await expect(salesPage.getByTestId(`order-fulfillment-${order.id}`)).toContainText('待交 60 kg');
    await salesPage.getByTestId('sales-desk-fulfillment').click();
    await salesPage.locator('[data-enterprise-grid]').scrollIntoViewIfNeeded();
    await expect(salesPage.getByTestId(`sales-order-row-${order.id}`)).toBeVisible();
    await expect(salesPage.getByTestId(`sales-order-ship-${order.id}`)).toHaveCount(0);
    report.salesWriteBoundary='Sales can read remaining obligation but has no shipping-write action';
  } finally { await salesPage.close(); }
  const browserLogin=await loginUiAuditUser(page,`${urls[0].replace(/\/$/,'')}/`,{account:{username:runId,password,role:'admin',segment:'mixed'},storage:{'ailao.language':'zh','language':'zh-CN'}});
  token=browserLogin.token; // The helper refreshes the fixture account and invalidates the earlier token.
  await page.goto(`${urls[0].replace(/\/$/,'')}/#orders`);
  const axis=page.getByTestId(`order-fulfillment-${order.id}`);
  await expect(axis).toContainText('部分交付');await expect(axis).toContainText('待交 60 kg');
  report.partialBrowserText=await axis.innerText();await captureFulfillment(axis,'sales-partial-40-of-100.png');

  // Explicit legacy fixture only: reproduce the persisted status produced by
  // the old 40/100 defect. Never rewrite real historical orders as migration.
  await prisma.order.update({where:{id:order.id},data:{status:'delivered'}});
  report.legacyStatusFixture={injectedStatus:'delivered',reason:'Old application closed a 40/100 kg partial order',
    readback:dataOf(await request(`/orders/${order.id}`,{instance:1}))};
  assert.equal(report.legacyStatusFixture.readback.fulfillmentStatus,'partially_delivered');
  assert(dataOf(await request('/orders/shipping-ready',{instance:1})).some(o=>o.id===order.id));
  const legacyClose=await request(`/orders/${order.id}/complete`,{method:'PUT',data:{},instance:1});
  assert.equal(legacyClose.status,409);report.legacyStatusFixture.completion=legacyClose;

  const nextBatch=`${batchNo}-replenished`;
  dataOf(await request('/warehouses/stock-balances',{method:'POST',data:{locationId:Number(source.id),materialId:material.id,productName:material.nameZh,batchNo:nextBatch,quantity:60,unit:'kg',unitCost:10,sourceRef:`${runId}-replenish`,reason:'Synthetic remainder replenishment'}}));
  await page.reload();
  await page.getByTestId('sales-desk-fulfillment').click();
  await page.locator('[data-enterprise-grid]').scrollIntoViewIfNeeded();
  await expect(page.getByTestId(`sales-order-row-${order.id}`)).toBeVisible();
  await page.getByTestId(`sales-order-ship-${order.id}`).click();
  const modal=page.getByTestId('sales-order-shipment-modal');
  await expect(modal).toBeVisible();
  await page.getByTestId('sales-order-shipment-line').selectOption(String(original.items[0].id));
  await page.getByTestId('sales-order-shipment-quantity').fill('61');
  await page.getByTestId('sales-order-shipment-batch').fill(nextBatch);
  await expect(page.getByTestId('sales-order-shipment-create')).toBeDisabled();
  assert.equal(await prisma.shipment.count({where:{orderId:order.id}}),1);
  await page.getByTestId('sales-order-shipment-quantity').fill('60');
  await page.setViewportSize({width:390,height:844});
  const modalBounds=await modal.getByRole('dialog').boundingBox();
  assert(modalBounds&&modalBounds.x>=0&&modalBounds.x+modalBounds.width<=391,'Mobile shipment form overflows viewport');
  await page.screenshot({path:path.join(path.dirname(process.env.ROUND2_REPORT_PATH),'sales-remainder-form-mobile.png')});
  report.mobileDraftBounds=modalBounds;
  await page.setViewportSize({width:1440,height:1000});
  await page.getByTestId('sales-order-shipment-batch').fill(`${runId}-missing-batch`);
  const rejectedCreate=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shipping'&&response.request().method()==='POST');
  await page.getByTestId('sales-order-shipment-create').click();
  report.browserRejectedBatch={status:(await rejectedCreate).status()};
  await expect(page.getByTestId('sales-order-shipment-error')).toBeVisible();
  assert.equal(report.browserRejectedBatch.status,404);
  assert.equal(await prisma.shipment.count({where:{orderId:order.id}}),1);
  await page.getByTestId('sales-order-shipment-batch').fill(nextBatch);
  // Browser-only fault injection: POST is real; fail its first GET readback.
  // This proves UI retry boundaries, not a database restart or uncertain commit.
  let failedReadbacks=0;
  const readbackPattern=`**/api/orders/${order.id}`;
  const failFirstReadback=async route=>{
    if(route.request().method()==='GET'&&failedReadbacks===0){
      failedReadbacks++;
      await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,message:'Synthetic readback unavailable'})});
    }else await route.continue();
  };
  await page.route(readbackPattern,failFirstReadback);
  const createResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shipping'&&response.request().method()==='POST');
  await page.getByTestId('sales-order-shipment-create').dblclick();
  const createdResponse=await createResponse;
  assert(createdResponse.ok(),await createdResponse.text());
  const second=(await createdResponse.json()).data;
  await expect(page.getByTestId('sales-order-shipment-success')).toContainText(second.shipmentNo);
  await expect(page.getByTestId('sales-order-shipment-error')).toContainText('创建已成功');
  await expect(page.getByTestId('sales-order-shipment-create')).toBeDisabled();
  assert.equal(failedReadbacks,1);
  await page.getByRole('button',{name:'只重试读取',exact:true}).click();
  await expect(page.getByTestId('sales-order-shipment-close')).toBeEnabled();
  await expect(page.getByTestId('sales-order-shipment-error')).toHaveCount(0);
  await page.unroute(readbackPattern,failFirstReadback);
  report.browserReadbackFault={injected503:failedReadbacks,recoveredBy:'GET-only retry; real POST count verified in database'};
  await page.screenshot({path:path.join(path.dirname(process.env.ROUND2_REPORT_PATH),'sales-remainder-draft-created.png')});
  const persistedDraft=await prisma.shipment.findUnique({where:{id:Number(second.id)}});
  assert.equal(persistedDraft.status,'pending');assert.equal(persistedDraft.orderItemId,original.items[0].id);
  assert.equal(persistedDraft.quantity,60);assert.equal(persistedDraft.unit,'kg');assert.equal(persistedDraft.batchNo,nextBatch);
  assert.equal(await prisma.shipment.count({where:{orderId:order.id}}),2);
  assert.equal((await prisma.productBatch.findUnique({where:{batchNo:nextBatch}})).stockQuantity,60,'Draft creation must not issue stock');
  report.browserCreatedDraft=persistedDraft;
  await page.getByTestId('sales-order-shipment-close').click();
  await expect(page.getByTestId(`sales-order-ship-${order.id}`)).toHaveCount(0);
  await page.goto(`${urls[0]}/#shipping`);
  await page.locator('#loading').waitFor({state:'hidden',timeout:10000});
  const dispatchResponse=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/shipping/${second.id}/status`&&response.request().method()==='PATCH');
  await page.getByTestId(`shipment-dispatch-${second.id}`).click();
  assert((await dispatchResponse).ok());
  await expect(page.getByTestId(`shipment-receipts-button-${second.id}`)).toBeVisible();
  assert.equal((await prisma.shipment.findUnique({where:{id:Number(second.id)}})).status,'in_transit');
  assert.equal(dataOf(await request(`/orders/${order.id}`)).fulfillment.lines[0].outstandingQuantity,60);
  report.concurrentReceipts=await Promise.all([0,1].map(instance=>request(`/shipping/${second.id}/receipt-events`,{method:'POST',instance,data:{quantity:30,acceptedQuantity:30,rejectedQuantity:0,note:`Synthetic remainder ${instance}`}})));
  for(const result of report.concurrentReceipts)dataOf(result);
  report.finalReadbacks=await Promise.all(urls.map((_,instance)=>request(`/orders/${order.id}`,{instance}).then(dataOf)));
  assert(report.finalReadbacks.every(o=>o.status==='delivered'&&o.fulfillmentStatus==='delivered'&&o.fulfillment.fullyDelivered&&o.fulfillment.lines[0].outstandingQuantity===0));
  assert(!dataOf(await request('/orders/shipping-ready')).some(o=>o.id===order.id));
  await page.goto(`${urls[0]}/#orders`);await expect(axis).toContainText('已交付');await expect(axis).not.toContainText('待交');
  report.finalBrowserText=await axis.innerText();await captureFulfillment(axis,'sales-delivered-100-of-100.png');
  dataOf(await request(`/orders/${order.id}/complete`,{method:'PUT',data:{},instance:1}));
  report.finalPersisted=await prisma.order.findUnique({where:{id:order.id},include:{shipments:{include:{receipts:true}}}});
  assert.equal(report.finalPersisted.status,'completed');
  assert.equal(await prisma.auditLog.count({where:{resource:'order',resourceId:order.id,action:'COMPLETE'}}),1);
  const completedRetry=await request('/shipping',{method:'POST',data:{customerId:Number(customer.id),orderItemId:Number(original.items[0].id),materialId:material.id,
    productName:material.nameZh,quantity:1,unit:'kg',batchNo:nextBatch}});
  assert.equal(completedRetry.status,409);assert.equal(completedRetry.json.message,'SHIPMENT_ORDER_STATUS_INVALID');
  report.completedOrderImplicitLinkRejection=completedRetry;
  report.finalBalances=await prisma.stockBalance.findMany({where:{materialId:material.id}});
  report.finalBatches=await prisma.productBatch.findMany({where:{materialId:material.id}});
  report.finalCostLedger=await prisma.inventoryCostLedger.findMany({where:{batchId:{in:report.finalBatches.map(b=>b.id)}}});
  assert.equal(report.finalBalances.reduce((sum,row)=>sum+row.quantity,0),0);
  assert.equal(report.finalBatches.reduce((sum,row)=>sum+row.stockQuantity,0),0);
  assert.equal(report.finalCostLedger.reduce((sum,row)=>sum+Number(row.quantityDelta),0),0);
  assert.equal(report.finalCostLedger.reduce((sum,row)=>sum+Number(row.costAmountDelta),0),0);
  const issues=report.finalCostLedger.filter(row=>row.quantityDelta<0);
  assert.equal(issues.length,2);assert.equal(issues.reduce((sum,row)=>sum+row.quantityDelta,0),-100);
  assert.equal(issues.reduce((sum,row)=>sum+row.costAmountDelta,0),-1000);
  // Existing drafts do not retain dispatch authority after cancellation.
  // Reuse real APIs and the stock transaction; no status-only fixture writes.
  const cancellationMaterial=await ensureReleasedMaterial({request,code:`${runId}-cancel`,name:`${runId}-cancel`,category:'finished_good'});
  const currentSalesToken=dataOf(await request('/auth/login',{method:'POST',data:{username:`${runId}-sales`,password}})).token;
  async function cancellationFixture(suffix){
    token=currentSalesToken;
    const pending=dataOf(await request('/orders',{method:'POST',data:{customerId:customer.id,items:[{materialId:cancellationMaterial.id,productName:cancellationMaterial.nameZh,quantity:10,unit:'kg',unitPrice:10}],paymentTerms:30}}));
    token=browserLogin.token;
    dataOf(await request(`/orders/${pending.id}/status`,{method:'PATCH',data:{status:'confirmed'}}));
    const detail=dataOf(await request(`/orders/${pending.id}`));const batchNo=`${runId}-cancel-${suffix}`;
    dataOf(await request('/warehouses/stock-balances',{method:'POST',data:{locationId:source.id,materialId:cancellationMaterial.id,productName:cancellationMaterial.nameZh,batchNo,quantity:10,unit:'kg',unitCost:10,sourceRef:batchNo,reason:'Isolated cancellation/dispatch regression'}}));
    const draft=dataOf(await request('/shipping',{method:'POST',data:{customerId:customer.id,orderId:pending.id,orderItemId:detail.items[0].id,materialId:cancellationMaterial.id,productName:cancellationMaterial.nameZh,quantity:10,unit:'kg',batchNo,carrier:'Synthetic'}}));
    async function snapshot(){
      const batch=await prisma.productBatch.findUnique({where:{batchNo}});
      return{order:await prisma.order.findUnique({where:{id:pending.id}}),shipment:await prisma.shipment.findUnique({where:{id:draft.id}}),batch,
        balances:await prisma.stockBalance.findMany({where:{materialId:cancellationMaterial.id,batchNo}}),
        cost:await prisma.inventoryCostLedger.findMany({where:{batchId:batch.id},orderBy:{id:'asc'}}),
        issues:await prisma.stockEntry.findMany({where:{sourceType:'shipping_issue',sourceRef:draft.shipmentNo},orderBy:{id:'asc'}})};
    }
    return{orderId:pending.id,shipmentId:draft.id,snapshot};
  }
  const cancelled=await cancellationFixture('serial');
  await page.goto(`${urls[0]}/#shipping`);
  const cancelledDispatchButton=page.getByTestId(`shipment-dispatch-${cancelled.shipmentId}`);
  await expect(cancelledDispatchButton).toBeVisible();
  dataOf(await request(`/orders/${cancelled.orderId}/status`,{method:'PATCH',data:{status:'cancelled'},instance:1}));
  report.cancelledDispatch=[];
  for(const status of ['pending','exception']){
    if(status==='exception') dataOf(await request(`/shipping/${cancelled.shipmentId}/status`,{method:'PATCH',data:{status}}));
    const before=await cancelled.snapshot();
    let response;
    if(status==='pending'){
      const awaiting=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/shipping/${cancelled.shipmentId}/status`&&r.request().method()==='PATCH');
      await cancelledDispatchButton.click();const http=await awaiting;
      response={status:http.status(),ok:http.ok(),json:await http.json()};
      const failureToast=page.getByTestId('global-toast').filter({hasText:'保存失败'});
      await expect(failureToast).toHaveAttribute('role','alert');
      await expect(failureToast).toBeVisible();
      await expect(page.getByTestId(`shipment-status-${cancelled.shipmentId}`)).toHaveText('待发货');
      await expect(cancelledDispatchButton).toBeVisible();
      report.cancelledDispatchBrowser={shipmentId:cancelled.shipmentId,httpStatus:response.status,toast:await failureToast.innerText(),shipmentStatus:'待发货'};
      report.cancelledDispatchScreenshot='sales-cancelled-dispatch-blocked.png';
      await page.screenshot({path:path.join(path.dirname(process.env.ROUND2_REPORT_PATH),report.cancelledDispatchScreenshot)});
    }else response=await request(`/shipping/${cancelled.shipmentId}/status`,{method:'PATCH',data:{status:'in_transit'},instance:1});
    const after=await cancelled.snapshot();report.cancelledDispatch.push({status,response,before,after});
    assert.equal(response.status,409);assert.equal(response.json.message,'SHIPMENT_ORDER_DISPATCH_BLOCKED');assert.deepEqual(after,before);
  }
  const racing=await cancellationFixture('race');
  const [cancel,dispatch]=await Promise.all([
    request(`/orders/${racing.orderId}/status`,{method:'PATCH',data:{status:'cancelled'}}),
    request(`/shipping/${racing.shipmentId}/status`,{method:'PATCH',data:{status:'in_transit'},instance:1}),
  ]);
  const after=await racing.snapshot();report.cancelDispatchRace={cancel,dispatch,after};
  assert.equal(Number(cancel.ok)+Number(dispatch.ok),1,'Cancellation and first dispatch must not both succeed');
  assert([400,409].includes(cancel.ok?dispatch.status:cancel.status));
  assert.equal(after.order.status,cancel.ok?'cancelled':'shipped');assert.equal(after.shipment.status,cancel.ok?'pending':'in_transit');
  assert.equal(after.issues.length,cancel.ok?0:1);
  assert.equal(after.balances.reduce((sum,row)=>sum+row.quantity,0),cancel.ok?10:0);
  assert.equal(after.batch.stockQuantity,cancel.ok?10:0);
  assert.equal(after.cost.reduce((sum,row)=>sum+Number(row.quantityDelta),0),cancel.ok?10:0);
  assert.equal(after.cost.reduce((sum,row)=>sum+Number(row.costAmountDelta),0),cancel.ok?100:0);
  report.status='passed';report.summary={passedChecks:1,failedChecks:0,remainingChecks:0};
}
main().catch(error=>{report.error=error.stack}).finally(async()=>{
  if(report.error&&page)await page.screenshot({path:path.join(path.dirname(process.env.ROUND2_REPORT_PATH),'sales-partial-failure.png')}).catch(()=>{});
  await browser?.close();
  report.finishedAt=new Date().toISOString();fs.writeFileSync(process.env.ROUND2_REPORT_PATH,JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,stillOwedQuantity:report.stillOwedQuantity,error:report.error,reportPath:process.env.ROUND2_REPORT_PATH}));
  await prisma?.$disconnect();process.exitCode=report.status==='passed'?0:1;
});
