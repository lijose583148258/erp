const assert = require('node:assert/strict');
const { assertContinuousLedger } = require('./enterprise-round2-production-lot.cjs');

function densityWorkforceProfile(profile, actor) {
  assert.equal(Number(profile?.id), actor.id, 'Density session identity changed');
  for (const field of ['username', 'role', 'segment', 'isActive', 'mustChangePassword']) assert.equal(profile[field], actor.profile[field], `Density ${field} changed`);
  assert.equal(profile.username, actor.account.username); assert.equal(profile.role, actor.role);
  assert.equal(profile.isActive, true); assert.equal(profile.mustChangePassword, false);
  for (const field of ['permissions', 'dataScopes']) {
    assert(Array.isArray(profile[field]) && profile[field].every(value => typeof value === 'string'));
    assert.equal(new Set(profile[field]).size, profile[field].length);
    assert.deepEqual([...profile[field]].sort(), [...actor.profile[field]].sort(), `Density ${field} drift`);
  }
  assert(profile.permissions.every(value => !value.includes('*')) && !profile.permissions.includes('assets.read'));
  assert(!profile.dataScopes.includes('all'));
  return profile;
}

function densityWorkforcePeople(ctx) {
  if (!ctx.productionActors) { assert(!ctx.workforce, 'Density workforce duties are missing'); return null; }
  assert.equal(ctx.workforce?.actors?.length, 20, 'Density browser needs the original twenty-person cohort');
  assert.equal(new Set(ctx.workforce.actors.map(actor => actor.id)).size, 20);
  const people = { research: ctx.productionActors.research, planner: ctx.productionActors.planner,
    operator: ctx.productionActors.operators?.[0], qc: ctx.productionActors.qc, qa: ctx.productionActors.qa };
  const expected = { research: ['research', 'production.bom.write'], planner: ['production_planner', 'production.plan.write'],
    operator: ['production_operator', 'production.execute'], qc: ['qc', 'production.quality.inspect'], qa: ['qa', 'production.quality.release'] };
  for (const [duty, actor] of Object.entries(people)) {
    const [job, permission] = expected[duty];
    assert(actor?.id && actor.id !== ctx.actors.admin.id && actor.id !== ctx.actors.stock0.id, 'Explicit non-bootstrap density duties are required');
    assert(actor === ctx.workforce.byJob?.[job]?.[0], 'Density duty borrowed another principal');
    assert(ctx.workforce.actors.includes(actor)); assert.equal(actor.job, job); assert.equal(actor.index, 1);
    assert.equal(actor.account?.role, actor.role); densityWorkforceProfile(actor.profile, actor);
    assert(actor.profile.permissions.includes('production.read') && actor.profile.permissions.includes(permission));
  }
  assert.equal(new Set(Object.values(people).map(actor => actor.id)).size, 5, 'Density duties must be independent');
  return people;
}

async function densityNativeWrite(response, actor, origin, method, endpoint, status) {
  const request = response.request(), url = new URL(response.url());
  assert.equal(url.origin, origin); assert.equal(url.pathname, endpoint);
  assert.equal(request.method(), method); assert.equal(response.status(), status);
  const authorization = (await request.allHeaders()).authorization;
  assert(authorization === `Bearer ${actor.token}`, 'Density browser write used another session');
  return { actorId: actor.id, role: actor.role, instance: 1, method, path: endpoint, status,
    sent: request.postDataJSON(), json: await response.json() };
}

async function densityConversionBrowser(ctx, fixture, signal) {
  const { expect } = require('playwright/test');
  const fs = require('node:fs'), path = require('node:path');
  const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
  const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');
  const { raw, fg, stock, source, other } = fixture;
  const duties = densityWorkforcePeople(ctx);
  const research = duties?.research || ctx.actors.admin, planner = duties?.planner || ctx.actors.stock0;
  const operator = duties?.operator || ctx.actors.admin;
  const e = { scope: 'Browser authors density BOM and confirms actual conditions at completion; API prepares independent QC fixture', errors: [], rejected: [] };
  if (duties) e.workforce = { version: 'density-native-workforce/v1', actors: [], browserWrites: [], roleActions: [], assetRequests: [],
    boundary: 'Research BOM, planner work-order and operator completion are native node1; QC/QA prepare this fixture through APIs. Separate calibration governance fixtures remain outside the cohort.' };
  const call = async (url, method='GET', data, actor=ctx.actors.admin, instance=0) => {
    const result = await ctx.request(url,{method,data,actor,instance,signal});
    if (duties) e.workforce.roleActions.push({ actorId: actor.id, role: actor.role, instance, method, path: url, sent: data ?? null, status: result.status, json: result.json });
    return ctx.dataOf(result);
  };
  if (duties) for (const [duty, actor] of Object.entries(duties)) {
    const profiles = [];
    for (const instance of [0, 1]) profiles.push({ instance, profile: densityWorkforceProfile(await call('/auth/me', 'GET', undefined, actor, instance), actor) });
    e.workforce.actors.push({ duty, actorId: actor.id, role: actor.role, profiles, browserProfile: null });
  }
  const draft = await call(`/materials/${raw.id}/densities`,'POST',{...source,version:'browser'},ctx.actors.buyer1);
  const approved = await call(`/materials/${raw.id}/densities/${draft.id}/approve`,'POST',{expectedUpdatedAt:draft.updatedAt,reason:'Independent approval for browser conversion fixture'});
  const browser = (await launchBrowserWithGuard({launchTimeoutMs:15000,totalTimeoutMs:30000,maxAttemptsPerStrategy:1})).browser;
  const abort = () => { void browser.close().catch(()=>{}); }; signal.addEventListener('abort',abort,{once:true});
  const dir = path.join(path.dirname(ctx.reportPath),`${ctx.runId}-density-conversion`);fs.mkdirSync(dir,{recursive:true});
  try {
    let expectedConflictUrl = '';
    const origin = new URL(ctx.urls[1]).origin;
    const openProduction = async actor => {
      const page = await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});page.setDefaultTimeout(15000);
      page.on('pageerror',error=>e.errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
      page.on('request',request=>{const url=new URL(request.url());if(duties&&url.origin===origin&&url.pathname.startsWith('/api/assets'))e.workforce.assetRequests.push({actorId:actor.id,method:request.method(),path:url.pathname});});
      page.on('response',response=>{if(response.status()>=400&&new URL(response.url()).origin===origin&&response.url().includes('/api/')) {
        const pathname=new URL(response.url()).pathname;
        if(response.status()===409&&pathname===expectedConflictUrl)e.rejected.push({status:409,path:pathname,actorId:actor.id});
        else e.errors.push(`${response.status()} ${pathname}`);
      }});
      if(duties){
        const { loginUiAuditUser }=require('./ui-audit-user.cjs');
        const login=await loginUiAuditUser(page,`${ctx.urls[1]}/`,{account:actor.account,reuseExistingAccount:true,storage:{'ailao.language':'zh',language:'zh-CN'}});
        densityWorkforceProfile(login.user,actor);actor.token=login.token;
        const current=page.waitForResponse(response=>new URL(response.url()).origin===origin&&new URL(response.url()).pathname==='/api/auth/me'&&response.request().method()==='GET');
        void current.catch(()=>{});await page.goto(`${ctx.urls[1]}/#production`);
        const response=await current;assert.equal(response.status(),200);
        e.workforce.actors.find(row=>row.actorId===actor.id).browserProfile=densityWorkforceProfile((await response.json()).data,actor);
      }else{
        await page.addInitScript(({token,user})=>{
          for(const key of ['token','auth_token','erp_auth_token'])localStorage.setItem(key,token);
          for(const key of ['user','currentUser','erp_current_user'])localStorage.setItem(key,JSON.stringify(user));
          localStorage.setItem('ailao.language','zh');
        },{token:actor.token,user:{id:String(actor.id),name:actor.job,role:actor.role,segment:'mixed'}});
        await page.goto(`${ctx.urls[1]}/#production`);
      }
      await page.locator('#loading').waitFor({state:'hidden'});return page;
    };
    let page=await openProduction(research);
    const panel=page.getByTestId('density-conversion-workbench');await panel.locator('summary').click();
    for(const [id,material] of [['density-conversion-output',fg],['density-conversion-input',raw]]) {
      await page.getByTestId(id).fill(material.code);await page.getByRole('option').filter({hasText:material.code}).first().click();
    }
    await page.getByTestId('density-conversion-revision').selectOption(String(approved.id));
    for(const [id,value] of [['version',ctx.runId+'-density-browser'],['standard-batch','10'],['qc-code','VISC'],['qc-name','粘度'],['qc-lower','1'],['qc-upper','2']])await page.getByTestId('density-conversion-'+id).fill(value);
    const creation=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/production/boms');
    await page.getByTestId('density-conversion-save').click();const created=await creation;assert.equal(created.status(),201);
    if(duties)e.workforce.browserWrites.push(await densityNativeWrite(created,research,origin,'POST','/api/production/boms',201));
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
    let wo;
    if(duties){
      // A later same-product version must not override the explicitly selected BOM.
      e.newerBom=await call('/production/boms','POST',{...created.request().postDataJSON(),version:ctx.runId+'-density-newer-control'},research);
      const planning=await openProduction(planner);
      await planning.getByTestId('production-desk-bom').click();
      await planning.getByRole('row').filter({hasText:bom.bomNo}).getByRole('button',{name:'选中回读/带入工单',exact:true}).click();
      await expect(planning.getByTestId('production-bom-readback')).toContainText(bom.version);
      await planning.getByTestId('production-desk-work-orders').click();
      await expect(planning.getByTestId('production-work-order-product-name')).toHaveValue(fg.nameZh);
      await planning.getByTestId('production-work-order-target-quantity').fill('10');await planning.getByLabel('已产数量',{exact:true}).fill('10');
      e.planningScreenshot=path.join(dir,'density-selected-version-planning.png');await planning.screenshot({path:e.planningScreenshot,animations:'disabled'});
      const creation=planning.waitForResponse(response=>new URL(response.url()).origin===origin&&new URL(response.url()).pathname==='/api/production/work-orders'&&response.request().method()==='POST');
      await planning.getByTestId('production-work-order-save').click();const response=await creation;
      e.workforce.browserWrites.push(await densityNativeWrite(response,planner,origin,'POST','/api/production/work-orders',201));
      wo=(await response.json()).data;assert.equal(wo.bomId,bom.id,'Native planning overrode the explicitly selected BOM version');
      assert.equal(wo.createdBy,planner.id);assert.equal(wo.producedQuantity,10);
      page=await openProduction(operator);
    }else wo=await call('/production/work-orders','POST',{bomId:bom.id,productName:fg.nameZh,targetQuantity:10,producedQuantity:10},planner);
    e.workOrder=wo;
    await call(`/production/work-orders/${wo.id}/status`,'PATCH',{status:'qc_pending'},duties?.operator||ctx.actors.stock0);
    const qc=await call(`/production/work-orders/${wo.id}/checks`,'POST',{sampleNo:ctx.runId+'-density-browser-qc',measurements:[{characteristicId:bom.qualityCharacteristics[0].id,measuredNumeric:'1.5'}]},duties?.qc||ctx.actors.stock0);
    await call(`/production/work-orders/${wo.id}/checks/${qc.id}/review`,'POST',{decision:'release',reviewNote:'Independent browser fixture QC release'},duties?.qa||ctx.actors.buyer1);
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
    await page.getByTestId('production-complete-confirm').click();const rejected=await conflict;assert.equal(rejected.status(),409);
    if(duties)e.workforce.browserWrites.push(await densityNativeWrite(rejected,operator,origin,'PATCH',expectedConflictUrl,409));
    await expect(modal).toContainText('实际领料条件必须逐项匹配');assert.deepEqual(await snapshot(),e.before);
    await page.getByTestId(`production-complete-density-temperature-${stock.id}`).fill(source.temperatureC);
    e.completionScreenshot=path.join(dir,'density-actual-conditions.png');await modal.screenshot({path:e.completionScreenshot,animations:'disabled'});
    const completed=page.waitForResponse(r=>new URL(r.url()).pathname===expectedConflictUrl&&r.request().method()==='PATCH');
    await page.getByTestId('production-complete-confirm').click();const posted=await completed;assert.equal(posted.status(),200);
    if(duties)e.workforce.browserWrites.push(await densityNativeWrite(posted,operator,origin,'PATCH',expectedConflictUrl,200));
    await expect(modal).toHaveCount(0);
    e.after=await snapshot();assert.equal(e.after.stock.quantity,e.before.stock.quantity-8);assert.deepEqual(e.after.other,e.before.other);
    assert.equal(e.after.wo.status,'completed');assert.equal(e.after.wo.productBatch.stockQuantity,10);assert.equal(e.after.wo.genealogyEdges[0].quantityConsumed,8);
    assert.deepEqual(e.after.costs.map(c=>Number(c.costAmountDelta)).sort((a,b)=>a-b),[-120,120]);assertContinuousLedger(e.after.costs.filter(c=>c.batchId===e.after.wo.batchId),10,120);
    const successful=e.after.audits.filter(a=>JSON.parse(a.details).status==='completed');assert.equal(successful.length,1);
    assert.equal(JSON.parse(successful[0].details).densityActualConditions[0].temperatureC,source.temperatureC);
    if(duties){
      assert.equal(bom.createdBy,research.id);assert.equal(e.after.wo.createdBy,planner.id);
      assert.equal(successful[0].userId,operator.id);
      assert.equal(e.after.wo.bomId,bom.id);
      e.workforce.quality=await ctx.prisma.productionQualityCheck.findUniqueOrThrow({where:{id:qc.id}});
      assert.equal(e.workforce.quality.workOrderId,wo.id);assert.equal(e.workforce.quality.inspectorUserId,duties.qc.id);
      assert.equal(e.workforce.quality.reviewedByUserId,duties.qa.id);assert.equal(e.workforce.quality.status,'released');
      e.workforce.databaseAudits=await ctx.prisma.auditLog.findMany({where:{resource:'production',OR:[{action:'CREATE_PRODUCTION_BOM',resourceId:bom.id},{action:'CREATE_PRODUCTION_WORK_ORDER',resourceId:wo.id}]},orderBy:{id:'asc'}});
      for(const [action,resourceId,actor] of [['CREATE_PRODUCTION_BOM',bom.id,research],['CREATE_PRODUCTION_WORK_ORDER',wo.id,planner]]){
        const rows=e.workforce.databaseAudits.filter(row=>row.action===action&&row.resourceId===resourceId);assert.equal(rows.length,1);assert.equal(rows[0].userId,actor.id);
      }
      assert.deepEqual(e.workforce.assetRequests,[],'Native density duties must not request the customer asset catalog');
    }
    e.readbacks=await Promise.all([0,1].map(async instance=>({bom:(await call('/production/boms','GET',undefined,research,instance)).find(row=>row.id===bom.id),wo:(await call('/production/work-orders','GET',undefined,operator,instance)).find(row=>row.id===wo.id)})));
    assert.deepEqual(e.readbacks[0],e.readbacks[1]);assert.equal(e.readbacks[0].wo.status,'completed');
    await page.reload();await page.locator('#loading').waitFor({state:'hidden'});await page.getByTestId('production-desk-work-orders').click();await page.getByPlaceholder('搜索工单').fill(wo.workOrderNo);
    await expect(page.getByTestId(`production-work-order-row-${wo.id}`)).toContainText('已完成');
    assert.equal(e.rejected.length,1);assert.deepEqual(e.errors,[]);return e;
  }catch(error){error.evidence=e;throw error;}finally{signal.removeEventListener('abort',abort);await browser.close();}
}
module.exports={densityConversionBrowser};
