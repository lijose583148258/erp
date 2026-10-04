const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { expect } = require('playwright/test');
const { ensureReleasedMaterial } = require('./material-audit-fixture.cjs');
const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');
const { restartIsolatedApps } = require('./enterprise-round2-app-restart.cjs');

async function paymentReversalBrowserProbe(ctx, signal) {
  const { request, dataOf, actors, prisma, runId, urls, reportPath } = ctx;
  const e = { version:'payment-reversal-browser/v2',provider:process.env.AUDIT_PRISMA_PROVIDER||'sqlite',
    scope:'Two real finance browser actors, original full-CNY cash reversal, lost acknowledgments, signed consumer and actual application crash; not DB-server restart',
    errors:[],screenshots:[],frames:[[],[]] };
  const folder = path.join(path.dirname(reportPath),`${runId}-payment-reversal`); fs.mkdirSync(folder,{recursive:true});
  const receiverUrl = new URL(process.env.ROUND2_PAYMENT_RECEIVER_URL || ''); assert.equal(receiverUrl.hostname,'127.0.0.1');
  const receiver = async (endpoint,body) => {
    const res = await fetch(`${receiverUrl.origin}${endpoint}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${process.env.ROUND2_PAYMENT_RECEIVER_TOKEN}`,'content-type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])}); assert.equal(res.status,200); return res.json();
  };
  const until = async (read,accepts,timeout=45000) => {
    const end=Date.now()+timeout; let last;
    while(Date.now()<end) { signal.throwIfAborted(); last=await read(); if(accepts(last)) return last; await delay(100,undefined,{signal}); }
    const error=new Error('Original-payment reversal evidence deadline exceeded'); error.last=last; throw error;
  };
  const call=(endpoint,actor,body,instance=0)=>request(endpoint,{actor,method:'POST',data:body,instance,signal});
  let browser, paymentId;
  try {
    const customer=dataOf(await call('/customers',actors.admin,{name:`${runId}-browser-reversal`,nameZh:`${runId}-browser-reversal`,creditLimit:100000,termsDays:30,
      segment:'direct',poolState:'private',salespersonId:actors.sales.id}));
    const material=await ensureReleasedMaterial({request:(endpoint,opts)=>request(endpoint,{...opts,signal}),code:`${runId}-browser-reversal`,name:`${runId}-browser-reversal`,category:'finished_good',unit:'kg'});
    const order=dataOf(await call('/orders',actors.sales,{customerId:Number(customer.id),items:[{materialId:material.id,productName:material.nameZh,quantity:10,unit:'kg',unitPrice:100}],paymentTerms:30}));
    e.orderId=Number(order.id); e.orderNo=order.orderNo;
    const registration={idempotencyKey:crypto.randomUUID(),amount:300,method:'bank_transfer',payerName:'Browser reversal payer',note:runId};
    const pending=await call(`/orders/${e.orderId}/payment`,actors.sales,registration); dataOf(pending); e.submissionReceipt=pending.json.paymentSubmission;
    paymentId=e.submissionReceipt.paymentId; e.paymentId=paymentId;
    dataOf(await call(`/orders/${e.orderId}/payment/${paymentId}/verify`,actors.finance1));
    dataOf(await call('/adjustments',actors.finance1,{domain:'finance',targetType:'order',orderId:e.orderId,amountDelta:50,status:'posted',reasonCategory:'payment_correction',reason:`${runId} keep independent adjustment`}));
    e.originalPayment=await prisma.paymentRecord.findUniqueOrThrow({where:{id:paymentId}});
    await receiver('/arm',{paymentId,eventType:'payment.reversed'});
    const snapshot=async()=>({payment:await prisma.paymentRecord.findUniqueOrThrow({where:{id:paymentId}}),
      order:await prisma.order.findUniqueOrThrow({where:{id:e.orderId},select:{id:true,paidAmount:true,paymentStatus:true}}),
      adjustments:await prisma.adjustmentRecord.findMany({where:{orderId:e.orderId},orderBy:{id:'asc'}}),
      requests:await prisma.paymentReversalRequest.findMany({where:{paymentId},orderBy:{createdAt:'asc'}}),
      effects:await prisma.paymentReversal.findMany({where:{paymentId}}),
      audits:await prisma.auditLog.findMany({where:{resource:'payment',resourceId:paymentId},orderBy:{id:'asc'}}),
      events:await prisma.businessEvent.findMany({where:{aggregateType:'payment',aggregateId:String(paymentId)},orderBy:{id:'asc'}})});
    e.initialSnapshot=await snapshot(); assert.equal(e.initialSnapshot.order.paidAmount,350);
    browser=(await launchBrowserWithGuard({retryLimit:1})).browser;
    const abort=()=>{void browser.close().catch(()=>{});}; signal.addEventListener('abort',abort,{once:true});
    const pages=[], identities=new Map();
    const profile=user=>({id:user.id,role:user.role,permissions:user.permissions,dataScopes:user.dataScopes});
    const login=async(actor,index)=>{
      const page=await browser.newPage({viewport:{width:1600,height:1000}}); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
      page.on('pageerror',error=>e.errors.push(error.message));
      page.on('websocket',ws=>ws.on('framereceived',frame=>{try{const event=JSON.parse(String(frame.payload)); if(event.type==='payment.reversed'&&Number(event.resourceId)===paymentId)e.frames[index]?.push(event);}catch{}}));
      await page.addInitScript(({token,user})=>{for(const k of ['token','auth_token','erp_auth_token'])localStorage.setItem(k,token);for(const k of ['user','currentUser','erp_current_user'])localStorage.setItem(k,JSON.stringify(user));localStorage.setItem('ailao.language','zh');localStorage.setItem('language','zh-CN');},
        {token:actor.token,user:{id:String(actor.id),name:actor.job,role:actor.role,segment:actor.role==='sales'?'direct':'mixed'}});
      // Retain the actual login response, not the role from the fixture label.
      const loginProfile=profile(actor.loginUser); assert.equal(loginProfile.id,actor.id); assert.equal(loginProfile.role,actor.role);
      identities.set(page,{actorId:actor.id,instance:index===1?1:0,loginProfile,browserProfiles:[]});
      return page;
    };
    const open=async page=>{
      const identity=identities.get(page), auth=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/me'&&r.request().method()==='GET'&&r.status()===200);
      await page.goto(`${urls[pages.indexOf(page)===1?1:0]}/#collections`,{waitUntil:'domcontentloaded'}); await page.locator('#loading').waitFor({state:'hidden'});
      const authResponse=await auth, actual=profile((await authResponse.json()).data);
      assert.deepEqual(actual,identity.loginProfile); identity.browserProfiles.push({url:authResponse.url(),method:'GET',actualHTTP:authResponse.status(),observedAt:new Date().toISOString(),profile:actual});
      await page.getByTestId('collection-tab-ledger').click(); await page.getByTestId('collection-ledger-search').fill(order.orderNo);
      await page.getByTestId(`collection-ledger-reversal-${paymentId}`).click();
      const modal=page.getByTestId('collection-payment-reversal-dialog'); await expect(modal.getByTestId('collection-reversal-original')).toContainText('CNY 300.00');
      return modal;
    };
    for(const [index,actor]of[actors.finance1,actors.finance2].entries()){pages.push(await login(actor,index));await open(pages[index]);}
    e.financeActors=[actors.finance1,actors.finance2].map((a,instance)=>({id:a.id,role:a.role,instance,...identities.get(pages[instance])}));
    const endpoint=`/api/collections/payments/${paymentId}/reversal-requests`;
    // Commit through the real UI but drop ONLY the response. No forged UI data.
    let droppedRequest;
    await pages[0].route(`**${endpoint}`,async route=>{
      if(route.request().method()!=='POST'||droppedRequest){await route.continue();return;}
      const response=await route.fetch(); assert.equal(response.status(),201);
      droppedRequest={body:route.request().postDataJSON(),response:await response.json(),httpStatus:response.status(),url:route.request().url(),method:route.request().method(),actualHTTP:response.status(),committedResponseReceivedAt:new Date().toISOString()};
      await route.abort('connectionfailed'); droppedRequest.responseDroppedAt=new Date().toISOString();
    });
    await pages[0].getByTestId('collection-reversal-reason').fill(`${runId} independently traceable original bank registration error`);
    await pages[0].getByTestId('collection-reversal-request-submit').click();
    await expect(pages[0].getByTestId('collection-reversal-request-submit')).toHaveText('原申请身份重试'); assert(droppedRequest);
    e.requestLostAck=droppedRequest;
    e.requestIntentBeforeReload=await pages[0].evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('ailaoda.payment-reversal-intent/v1.request.')).map(([,v])=>JSON.parse(v)));
    assert.equal(e.requestIntentBeforeReload.length,1); assert.equal(e.requestIntentBeforeReload[0].key,droppedRequest.body.requestKey);
    const requestId=droppedRequest.response.data.request.id; e.requestId=requestId;
    await pages[0].unroute(`**${endpoint}`); await pages[0].reload(); await open(pages[0]);
    await expect(pages[0].getByTestId(`collection-reversal-request-${requestId}`)).toContainText('申请人不能审批自己的申请');
    await expect(pages[0].getByTestId(`collection-reversal-review-submit-${requestId}`)).toHaveCount(0);
    e.requestIntentAfterReadback=await pages[0].evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('ailaoda.payment-reversal-intent/v1.request.')));
    assert.deepEqual(e.requestIntentAfterReadback,[]);
    e.afterRequestSnapshot=await snapshot(); assert.equal(e.afterRequestSnapshot.order.paidAmount,350); assert.equal(e.afterRequestSnapshot.requests.length,1);
    await pages[1].getByTestId('collection-reversal-refresh').click();
    const reviewEndpoint=`/api/collections/payment-reversal-requests/${requestId}/review`; let droppedReview;
    await pages[1].route(`**${reviewEndpoint}`,async route=>{
      if(route.request().method()!=='POST'||droppedReview){await route.continue();return;}
      const response=await route.fetch(); assert.equal(response.status(),200); droppedReview={body:route.request().postDataJSON(),response:await response.json(),httpStatus:response.status(),url:route.request().url(),method:route.request().method(),actualHTTP:response.status(),committedResponseReceivedAt:new Date().toISOString()};
      await route.abort('connectionfailed'); droppedReview.responseDroppedAt=new Date().toISOString();
    });
    await pages[1].getByTestId(`collection-reversal-review-note-${requestId}`).fill(`${runId} independently reviewed original full payment`);
    await pages[1].getByTestId(`collection-reversal-review-submit-${requestId}`).click();
    await expect(pages[1].getByTestId(`collection-reversal-review-submit-${requestId}`)).toHaveText('原审批身份重试'); assert(droppedReview);
    e.reviewLostAck=droppedReview;
    e.reviewIntentBeforeReload=await pages[1].evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('ailaoda.payment-reversal-intent/v1.review.')).map(([,v])=>JSON.parse(v)));
    assert.equal(e.reviewIntentBeforeReload.length,1); assert.equal(e.reviewIntentBeforeReload[0].key,droppedReview.body.reviewKey);
    await pages[1].unroute(`**${reviewEndpoint}`);
    e.beforeSnapshot=await snapshot(); assert.equal(e.beforeSnapshot.order.paidAmount,50); assert.equal(e.beforeSnapshot.effects.length,1);
    const reversedEvent=e.beforeSnapshot.events.find(v=>v.eventKey===`payment.reversed:${paymentId}`); assert(reversedEvent); e.eventId=JSON.parse(reversedEvent.payloadJson).id;
    await until(()=>receiver('/state'),s=>s.target.phase==='accepted-awaiting-ack');
    e.claimBeforeCrash=await prisma.businessEventDelivery.findFirstOrThrow({where:{eventId:reversedEvent.id,channel:'webhook'}}); assert.equal(e.claimBeforeCrash.status,'sending'); e.claimBeforeCrashObservedAt=new Date().toISOString();
    e.restart=await restartIsolatedApps(urls,signal,async()=>{
      e.claimAfterKill=await prisma.businessEventDelivery.findUniqueOrThrow({where:{id:e.claimBeforeCrash.id}}); assert.equal(e.claimAfterKill.status,'sending'); e.claimAfterKillObservedAt=new Date().toISOString();
      await receiver('/release',{});
    });
    e.deliveryAfterRecovery=await until(()=>prisma.businessEventDelivery.findUniqueOrThrow({where:{id:e.claimBeforeCrash.id}}),r=>r.status==='delivered'); e.deliveryAfterRecoveryObservedAt=new Date().toISOString();
    e.receiver=await receiver('/state'); e.finalSnapshot=await snapshot(); assert.deepEqual(e.finalSnapshot,e.beforeSnapshot);
    e.replays=[];
    for(const instance of[0,1]){
      const r=dataOf(await call(`/collections/payments/${paymentId}/reversal-requests`,actors.finance1,droppedRequest.body,instance)); assert.deepEqual(r.receipt,droppedRequest.response.data.receipt);
      const v=dataOf(await call(`/collections/payment-reversal-requests/${requestId}/review`,actors.finance2,droppedReview.body,instance)); assert.deepEqual(v.receipt,droppedReview.response.data.receipt);
      e.replays.push({instance,request:r,review:v});
    }
    e.selfReview=await call(`/collections/payment-reversal-requests/${requestId}/review`,actors.finance1,droppedReview.body); assert.equal(e.selfReview.status,403);
    e.verifyReentry=await Promise.all([0,1].map(instance=>call(`/collections/payments/${paymentId}/verify`,actors.finance2,undefined,instance))); assert(e.verifyReentry.every(r=>r.status===409));
    for(const [index,page]of pages.entries()){
      await page.reload();const modal=await open(page);const effect=modal.getByTestId('collection-reversal-effect'),current=modal.getByTestId('collection-reversal-current-order');
      await expect(current).toHaveText('最新订单累计已收：CNY 50.00');await expect(effect).toContainText('CNY -300.00');
      await expect(modal.getByTestId('collection-reversal-original')).toContainText('已冲销');await expect(page.getByTestId(`collection-ledger-verify-${paymentId}`)).toHaveCount(0);
      await expect(modal.getByTestId(`collection-reversal-review-submit-${requestId}`)).toHaveCount(0);await expect(modal.getByTestId('collection-reversal-request-submit')).toHaveCount(0);
      await current.scrollIntoViewIfNeeded();
      const unobscured=await effect.getByRole('heading').evaluate(el=>{const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return!!top&&(el===top||el.contains(top));});assert(unobscured);
      const file=path.join(folder,`finance-${index+1}-original-reversal.png`);await page.screenshot({path:file});
      e.screenshots.push({path:file,actorId:[actors.finance1,actors.finance2][index].id,instance:index,role:'finance',unobscured,orderPaid:50,originalAmount:300,reversalAmount:-300,
        url:page.url(),requestButtons:await modal.getByTestId('collection-reversal-request-submit').count(),reviewButtons:await modal.getByTestId(`collection-reversal-review-submit-${requestId}`).count(),verifyButtons:await page.getByTestId(`collection-ledger-verify-${paymentId}`).count(),
        text:await modal.innerText(),font:await verifyRenderedCjk(page,'[data-testid="collection-payment-reversal-dialog"]')});
    }
    e.reviewIntentAfterReadback=await pages[1].evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('ailaoda.payment-reversal-intent/v1.review.')));assert.deepEqual(e.reviewIntentAfterReadback,[]);
    const sales=await login(actors.sales,2);const salesModal=await open(sales);await expect(salesModal).toContainText('当前角色只读');
    await expect(salesModal.getByTestId('collection-reversal-request-submit')).toHaveCount(0);await expect(salesModal.getByTestId(`collection-reversal-review-submit-${requestId}`)).toHaveCount(0);
    e.salesReadOnly={actorId:actors.sales.id,role:'sales',...identities.get(sales),url:sales.url(),text:await salesModal.innerText(),requestButtons:await salesModal.getByTestId('collection-reversal-request-submit').count(),reviewButtons:await salesModal.getByTestId(`collection-reversal-review-submit-${requestId}`).count(),originalVisible:await salesModal.getByTestId('collection-reversal-original').isVisible()};
    e.finalReadbacks=await Promise.all([0,1].map(async instance=>dataOf(await request(`/orders/${e.orderId}`,{actor:actors.finance2,instance,signal}))));
    assert(e.finalReadbacks.every(r=>r.paidAmount===50));assert.deepEqual(e.errors,[]);signal.removeEventListener('abort',abort);
    return e;
  }catch(error){if(browser)try{for(const [index,page]of browser.contexts().flatMap(c=>c.pages()).entries()){const f=path.join(folder,`failure-${index}.png`);await page.screenshot({path:f});e.failureScreenshots??=[];e.failureScreenshots.push(f);}}catch{}error.evidence=e;throw error;}
  finally{if(paymentId)await receiver('/release',{}).catch(()=>{});if(browser)await browser.close();fs.writeFileSync(path.join(folder,'evidence.json'),JSON.stringify(e,null,2));}
}
module.exports={paymentReversalBrowserProbe};
