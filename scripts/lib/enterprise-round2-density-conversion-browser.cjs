const assert = require('node:assert/strict');
const { assertContinuousLedger } = require('./enterprise-round2-production-lot.cjs');

async function densityConversionBrowser(ctx, fixture, signal) {
  const { expect } = require('playwright/test');
  const fs = require('node:fs'), path = require('node:path');
  const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
  const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');
  const { raw, fg, stock, source, other } = fixture;
  const e = { scope: 'Browser authors density BOM and confirms actual conditions at completion; API prepares independent QC fixture', errors: [], rejected: [] };
  const call = async (url, method='GET', data, actor=ctx.actors.admin, instance=0) => ctx.dataOf(await ctx.request(url,{method,data,actor,instance,signal}));
  const draft = await call(`/materials/${raw.id}/densities`,'POST',{...source,version:'browser'},ctx.actors.buyer1);
  const approved = await call(`/materials/${raw.id}/densities/${draft.id}/approve`,'POST',{expectedUpdatedAt:draft.updatedAt,reason:'Independent approval for browser conversion fixture'});
  const browser = (await launchBrowserWithGuard({launchTimeoutMs:15000,totalTimeoutMs:30000,maxAttemptsPerStrategy:1})).browser;
  const abort = () => { void browser.close().catch(()=>{}); }; signal.addEventListener('abort',abort,{once:true});
  const dir = path.join(path.dirname(ctx.reportPath),`${ctx.runId}-density-conversion`);fs.mkdirSync(dir,{recursive:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
    page.on('pageerror',error=>e.errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    let expectedConflictUrl = '';
    page.on('response',response=>{if(response.status()>=400&&response.url().includes('/api/')) {
      const pathname=new URL(response.url()).pathname;
      if(response.status()===409&&pathname===expectedConflictUrl)e.rejected.push({status:409,path:pathname});
      else e.errors.push(`${response.status()} ${pathname}`);
    }});
    const actor=ctx.actors.admin;
    await page.addInitScript(({token,user})=>{
      for(const key of ['token','auth_token','erp_auth_token'])localStorage.setItem(key,token);
      for(const key of ['user','currentUser','erp_current_user'])localStorage.setItem(key,JSON.stringify(user));
      localStorage.setItem('ailao.language','zh');
    },{token:actor.token,user:{id:String(actor.id),name:actor.job,role:actor.role,segment:'mixed'}});
    await page.goto(ctx.urls[1]+'/#production');await page.locator('#loading').waitFor({state:'hidden'});
    const panel=page.getByTestId('density-conversion-workbench');await panel.locator('summary').click();
    for(const [id,material] of [['density-conversion-output',fg],['density-conversion-input',raw]]) {
      await page.getByTestId(id).fill(material.code);await page.getByRole('option').filter({hasText:material.code}).first().click();
    }
    await page.getByTestId('density-conversion-revision').selectOption(String(approved.id));
    for(const [id,value] of [['version',ctx.runId+'-density-browser'],['standard-batch','10'],['qc-code','VISC'],['qc-name','粘度'],['qc-lower','1'],['qc-upper','2']])await page.getByTestId('density-conversion-'+id).fill(value);
    const creation=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/production/boms');
    await page.getByTestId('density-conversion-save').click();const created=await creation;assert.equal(created.status(),201);
    const bom=(await created.json()).data;assert.equal(bom.items[0].quantityPerUnit,0.8);
    await expect(panel.getByRole('status')).toContainText('已保存并回读');
    e.bom=bom;e.font=await verifyRenderedCjk(page,'[data-testid="density-conversion-workbench"]');
    e.bomScreenshot=path.join(dir,'density-bom-created.png');await panel.screenshot({path:e.bomScreenshot,animations:'disabled'});
    await page.setViewportSize({width:390,height:844});e.mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);assert.equal(e.mobileOverflow,false);
    await panel.locator('summary').scrollIntoViewIfNeeded();
    e.mobileScreenshot=path.join(dir,'density-bom-mobile.png');await page.screenshot({path:e.mobileScreenshot,animations:'disabled'});
    await page.getByTestId('density-conversion-save').click({trial:true});
    await expect(page.getByTestId('density-conversion-frozen-source')).toBeInViewport();
    e.mobileSourceScreenshot=path.join(dir,'density-bom-mobile-source.png');await page.screenshot({path:e.mobileSourceScreenshot,animations:'disabled'});
    await page.setViewportSize({width:1440,height:1000});
    const wo=await call('/production/work-orders','POST',{bomId:bom.id,productName:fg.nameZh,targetQuantity:10,producedQuantity:10},ctx.actors.stock0);
    await call(`/production/work-orders/${wo.id}/status`,'PATCH',{status:'qc_pending'},ctx.actors.stock0);
    const qc=await call(`/production/work-orders/${wo.id}/checks`,'POST',{sampleNo:ctx.runId+'-density-browser-qc',measurements:[{characteristicId:bom.qualityCharacteristics[0].id,measuredNumeric:'1.5'}]},ctx.actors.stock0);
    await call(`/production/work-orders/${wo.id}/checks/${qc.id}/review`,'POST',{decision:'release',reviewNote:'Independent browser fixture QC release'},ctx.actors.buyer1);
    const snapshot=async()=>({
      stock:await ctx.prisma.stockBalance.findUniqueOrThrow({where:{id:stock.id}}),other:await ctx.prisma.stockBalance.findUniqueOrThrow({where:{id:other.id}}),
      wo:await ctx.prisma.productionWorkOrder.findUniqueOrThrow({where:{id:wo.id},include:{productBatch:true,genealogyEdges:true}}),
      costs:await ctx.prisma.inventoryCostLedger.findMany({where:{workOrderId:wo.id},orderBy:{id:'asc'}}),
      audits:await ctx.prisma.auditLog.findMany({where:{action:'UPDATE_PRODUCTION_WORK_ORDER_STATUS',resourceId:wo.id},orderBy:{id:'asc'}}),
    });
    e.before=await snapshot();
    await page.reload();await page.locator('#loading').waitFor({state:'hidden'});
    await page.getByTestId('production-desk-work-orders').click();await page.getByPlaceholder('搜索工单').fill(wo.workOrderNo);
    await page.getByTestId(`production-work-order-row-${wo.id}`).click();await page.getByTestId('production-quality-enter-completion').click();
    const modal=page.getByTestId('production-complete-modal');await expect(modal).toBeVisible();
    await expect(page.getByTestId(`production-complete-deduct-${stock.id}`)).toHaveValue('8');
    await expect(page.getByTestId(`production-complete-deduct-${other.id}`)).toHaveCount(0);
    for(const field of ['temperature','pressure','composition'])await expect(page.getByTestId(`production-complete-density-${field}-${stock.id}`)).toHaveValue('');
    await page.getByTestId('production-complete-confirm').click();await expect(modal).toContainText('必须逐项填写');assert.deepEqual(await snapshot(),e.before);
    await page.getByTestId(`production-complete-density-temperature-${stock.id}`).fill('21');
    await page.getByTestId(`production-complete-density-pressure-${stock.id}`).fill(source.pressureKpaAbs);
    await page.getByTestId(`production-complete-density-composition-${stock.id}`).fill(source.compositionReference);
    expectedConflictUrl=`/api/production/work-orders/${wo.id}/status`;
    const conflict=page.waitForResponse(r=>new URL(r.url()).pathname===expectedConflictUrl&&r.request().method()==='PATCH');
    await page.getByTestId('production-complete-confirm').click();assert.equal((await conflict).status(),409);
    await expect(modal).toContainText('实际领料条件必须逐项匹配');assert.deepEqual(await snapshot(),e.before);
    await page.getByTestId(`production-complete-density-temperature-${stock.id}`).fill(source.temperatureC);
    e.completionScreenshot=path.join(dir,'density-actual-conditions.png');await modal.screenshot({path:e.completionScreenshot,animations:'disabled'});
    const completed=page.waitForResponse(r=>new URL(r.url()).pathname===expectedConflictUrl&&r.request().method()==='PATCH');
    await page.getByTestId('production-complete-confirm').click();assert.equal((await completed).status(),200);await expect(modal).toHaveCount(0);
    e.after=await snapshot();assert.equal(e.after.stock.quantity,e.before.stock.quantity-8);assert.deepEqual(e.after.other,e.before.other);
    assert.equal(e.after.wo.status,'completed');assert.equal(e.after.wo.productBatch.stockQuantity,10);assert.equal(e.after.wo.genealogyEdges[0].quantityConsumed,8);
    assert.deepEqual(e.after.costs.map(c=>Number(c.costAmountDelta)).sort((a,b)=>a-b),[-120,120]);assertContinuousLedger(e.after.costs.filter(c=>c.batchId===e.after.wo.batchId),10,120);
    const successful=e.after.audits.filter(a=>JSON.parse(a.details).status==='completed');assert.equal(successful.length,1);
    assert.equal(JSON.parse(successful[0].details).densityActualConditions[0].temperatureC,source.temperatureC);
    e.readbacks=await Promise.all([0,1].map(async instance=>({bom:(await call('/production/boms','GET',undefined,actor,instance)).find(row=>row.id===bom.id),wo:(await call('/production/work-orders','GET',undefined,actor,instance)).find(row=>row.id===wo.id)})));
    assert.deepEqual(e.readbacks[0],e.readbacks[1]);assert.equal(e.readbacks[0].wo.status,'completed');
    await page.reload();await page.locator('#loading').waitFor({state:'hidden'});await page.getByTestId('production-desk-work-orders').click();await page.getByPlaceholder('搜索工单').fill(wo.workOrderNo);
    await expect(page.getByTestId(`production-work-order-row-${wo.id}`)).toContainText('已完成');
    assert.equal(e.rejected.length,1);assert.deepEqual(e.errors,[]);return e;
  }catch(error){error.evidence=e;throw error;}finally{signal.removeEventListener('abort',abort);await browser.close();}
}
module.exports={densityConversionBrowser};
