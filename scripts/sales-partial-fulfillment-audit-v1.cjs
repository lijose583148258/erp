const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const assert=require('node:assert/strict');
const {ensureUiAuditUser,createAuditPrismaClient,loginUiAuditUser}=require('./lib/ui-audit-user.cjs');
const {ensureReleasedMaterial}=require('./lib/material-audit-fixture.cjs');
const {launchBrowserWithGuard}=require('./lib/browser-launch-guard.cjs');
const {expect}=require('playwright/test');
process.env.ROUND2_REPORT_PATH ||= path.resolve('output/audit/sales-partial-fulfillment/report.json');
fs.mkdirSync(path.dirname(process.env.ROUND2_REPORT_PATH),{recursive:true});
const urls=[process.env.APP_URL,process.env.SECONDARY_APP_URL].map(url=>String(url||'').replace(/\/$/,''));
const runId=`partial-${Date.now()}`;
const report={name:'Sales partial fulfillment regression',scope:'Two API instances; authorized admin browser creates a line-bound remainder shipment and dispatches; not complete presale/backorder/workforce acceptance',runId,
  commit:process.env.ROUND2_COMMIT||process.env.GITHUB_SHA,dirty:process.env.ROUND2_DIRTY,sourceHash:process.env.ROUND2_SOURCE_HASH,status:'failed',summary:{passedChecks:0,failedChecks:1,remainingChecks:0}};
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
  (report.browserBounds ||= []).push({name,...bounds});
  await page.screenshot({path:path.join(path.dirname(process.env.ROUND2_REPORT_PATH),name)});
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
  dataOf(await request(`/orders/${order.id}/payment`,{method:'POST',data:{amount:1000,method:'bank_transfer',payerName:runId}}));
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
  report.status='passed';report.summary={passedChecks:1,failedChecks:0,remainingChecks:0};
}
main().catch(error=>{report.error=error.stack}).finally(async()=>{
  if(report.error&&page)await page.screenshot({path:path.join(path.dirname(process.env.ROUND2_REPORT_PATH),'sales-partial-failure.png')}).catch(()=>{});
  await browser?.close();
  report.finishedAt=new Date().toISOString();fs.writeFileSync(process.env.ROUND2_REPORT_PATH,JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,stillOwedQuantity:report.stillOwedQuantity,error:report.error,reportPath:process.env.ROUND2_REPORT_PATH}));
  await prisma?.$disconnect();process.exitCode=report.status==='passed'?0:1;
});
