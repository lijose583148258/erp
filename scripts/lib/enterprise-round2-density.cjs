const assert = require('node:assert/strict');

async function densityProbe(ctx, signal, fixture) {
  const {prisma,actors,request,dataOf}=ctx, material=fixture.raw;
  const url=`/materials/${material.id}/densities`;
  const spec={batchNo:fixture.batchNo,specCode:'LAB',version:'v1',densityKgPerL:'1.200000',temperatureC:'20',pressureKpaAbs:'101.325',compositionReference:'Synthetic sample composition A; no extrapolation',methodReference:'Synthetic method A',sourceReference:ctx.runId+'-density-source',measuredAt:'2026-01-01T00:00:00.000Z'};
  const e={scope:'Immutable batch density evidence only, not mass/volume conversion or QC release',rejected:[]};
  const call=async(path,method='GET',data,actor=actors.admin,instance=0)=>dataOf(await request(path,{method,data,actor,instance,signal}));
  const business=async()=>({batch:await prisma.productBatch.findUniqueOrThrow({where:{id:fixture.batchId}}),stocks:await prisma.stockBalance.findMany({where:{materialId:material.id},orderBy:{id:'asc'}}),costs:await prisma.inventoryCostLedger.findMany({where:{batchId:fixture.batchId},orderBy:{id:'asc'}}),moves:await prisma.stockMovement.findMany({where:{materialId:material.id},orderBy:{id:'asc'}}),checks:await prisma.productionQualityCheck.findMany({where:{workOrderId:fixture.upstream.id},orderBy:{id:'asc'}}),bomCount:await prisma.productionBom.count(),workOrderCount:await prisma.productionWorkOrder.count()});
  const sourceState=async()=>({rows:await prisma.materialDensityRevision.findMany({where:{materialId:material.id},orderBy:{id:'asc'}}),audits:await prisma.auditLog.findMany({where:{resource:'material_density'},orderBy:{id:'asc'}})});
  const reject=async(label,path,method,data,expected=409,actor=actors.admin)=>{const before=await sourceState(),r=await request(path,{method,data,actor,signal});e.rejected.push({label,response:r});assert.equal(r.status,expected,JSON.stringify(r));assert.deepEqual(await sourceState(),before);};
  try {
    e.before=await business();assert.equal(e.before.batch.qualityStatus,'quarantine');
    await reject('sales-no-batch-evidence',url,'GET',undefined,403,actors.sales);
    await reject('warehouse-no-authoring',url,'POST',spec,403,actors.stock0);
    for(const [key,value] of [['sourceReference',''],['pressureKpaAbs',''],['temperatureC',''],['compositionReference',''],['methodReference',''],['densityKgPerL','1e2']])await reject('missing-or-invalid-'+key,url,'POST',{...spec,[key]:value},400,actors.buyer1);
    await reject('future-measurement',url,'POST',{...spec,measuredAt:'2999-01-01T00:00:00.000Z'});
    await reject('foreign-batch',url,'POST',{...spec,batchNo:ctx.runId+'-nonexistent'});
    const foreign=await prisma.productBatch.findFirstOrThrow({where:{materialId:{not:material.id}}});
    await reject('other-material-real-batch',url,'POST',{...spec,batchNo:foreign.batchNo});
    const self=await call(url,'POST',{...spec,version:'self'});
    await reject('self-approval',url+`/${self.id}/approve`,'POST',{expectedUpdatedAt:self.updatedAt,reason:'not independent'});
    const draft=await call(url,'POST',spec,actors.buyer1);
    await reject('duplicate-version',url,'POST',spec,409,actors.buyer1);
    await reject('no-govern-permission',url+`/${draft.id}/approve`,'POST',{expectedUpdatedAt:draft.updatedAt,reason:'not permitted'},403,actors.buyer1);
    await reject('stale-approval',url+`/${draft.id}/approve`,'POST',{expectedUpdatedAt:'2025-01-01T00:00:00.000Z',reason:'stale'});
    // Duplicate submissions by the same independent approver, across two app instances.
    e.duplicateApproval=await Promise.all([0,1].map(instance=>request(url+`/${draft.id}/approve`,{method:'POST',instance,signal,data:{expectedUpdatedAt:draft.updatedAt,reason:'Independent source and conditions verified'}})));
    assert.deepEqual(e.duplicateApproval.map(r=>r.status).sort(),[200,409]);const approved=dataOf(e.duplicateApproval.find(r=>r.status===200));
    assert.equal(await prisma.auditLog.count({where:{resource:'material_density',resourceId:approved.id,action:'APPROVE_DENSITY_REVISION'}}),1);
    await reject('immutable-values',url+`/${approved.id}`,'PATCH',{densityKgPerL:'0.8'},404);
    await reject('cross-material-approval',`/materials/${fixture.fg.id}/densities/${approved.id}/approve`,'POST',{expectedUpdatedAt:approved.updatedAt,reason:'foreign'},404);
    const next=await call(url,'POST',{...spec,version:'v2',densityKgPerL:'1.250000'},actors.buyer1);
    await call(url+`/${next.id}/approve`,'POST',{expectedUpdatedAt:next.updatedAt,reason:'Revised sourced point'});
    const retired=await call(url+`/${approved.id}/retire`,'POST',{expectedUpdatedAt:approved.updatedAt,reason:'Superseded, preserve old source evidence'});
    for(const key of Object.keys(spec))assert.equal(retired[key],approved[key]);
    assert.equal(retired.approvedBy,approved.approvedBy);assert.equal(retired.approvedAt,approved.approvedAt);
    await reject('retired-cannot-approve',url+`/${retired.id}/approve`,'POST',{expectedUpdatedAt:retired.updatedAt,reason:'cannot revive'});
    // A supplied free-text density never authorizes ungoverned dimensional arithmetic.
    await reject('free-density-not-conversion','/production/boms','POST',{materialId:fixture.fg.id,productName:fixture.fg.nameZh,outputUnit:'kg',shelfLifeDays:365,status:'active',density:1.25,items:[{materialId:material.id,unit:'L',dosageMode:'percentage',percentage:100,quantityPerUnit:1}]});
    await reject('approved-id-not-conversion','/production/boms','POST',{materialId:fixture.fg.id,productName:fixture.fg.nameZh,outputUnit:'kg',shelfLifeDays:365,status:'active',densityRevisionId:next.id,items:[{materialId:material.id,unit:'L',dosageMode:'percentage',percentage:100,quantityPerUnit:1}]},400);
    e.after=await business();assert.deepEqual(e.after,e.before);
    e.readbacks=await Promise.all([0,1].map(instance=>call(url,'GET',undefined,actors.admin,instance)));assert.deepEqual(e.readbacks[0],e.readbacks[1]);
    e.browserFixture={material,batchId:fixture.batchId,spec:{...spec,specCode:'BROWSER',version:'v1'}};return e;
  } catch(error){error.evidence=e;throw error;}
}

async function densityBrowser(ctx,browser,fixture,dir,signal) {
  const {expect}=require('playwright/test'),path=require('node:path');
  const e={scope:'Manager records density source, admin independently approves; no stock/QC mutation',errors:[]};
  const snapshot=async()=>({batch:await ctx.prisma.productBatch.findUniqueOrThrow({where:{id:fixture.batchId}}),costs:await ctx.prisma.inventoryCostLedger.findMany({where:{batchId:fixture.batchId},orderBy:{id:'asc'}}),stocks:await ctx.prisma.stockBalance.findMany({where:{materialId:fixture.material.id},orderBy:{id:'asc'}})});
  const open=async actor=>{const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
    await page.addInitScript(({token,user})=>{for(const k of ['token','auth_token','erp_auth_token'])localStorage.setItem(k,token);for(const k of ['user','currentUser','erp_current_user'])localStorage.setItem(k,JSON.stringify(user));localStorage.setItem('ailao.language','zh');},{token:actor.token,user:{id:String(actor.id),name:actor.job,role:actor.role,segment:'mixed'}});
    page.on('pageerror',x=>e.errors.push(x.message));page.on('response',r=>{if(r.status()>=400&&r.url().includes('/api/'))e.errors.push(r.status()+' '+new URL(r.url()).pathname);});
    await page.goto(ctx.urls[1]+'/#production');await page.locator('#loading').waitFor({state:'hidden'});await page.getByTestId('density-workbench').locator('summary').click();await page.getByTestId('density-material').fill(fixture.material.code);await page.getByRole('option').filter({hasText:fixture.material.code}).first().click();return page;};
  const manager=await open(ctx.actors.buyer1);let admin;
  try {
    e.before=await snapshot();for(const [key,value] of Object.entries(fixture.spec))await manager.getByTestId('density-'+key).fill(key==='measuredAt'?'2026-01-01T08:00':value);
    await manager.getByRole('button',{name:'保存密度依据草稿并回读',exact:true}).click();await expect(manager.getByRole('status')).toContainText('等待另一人核对');
    const revision=await ctx.prisma.materialDensityRevision.findFirstOrThrow({where:{materialId:fixture.material.id,specCode:'BROWSER',version:'v1'}});assert.equal(revision.createdBy,ctx.actors.buyer1.id);assert.equal(revision.status,'draft');
    await expect(manager.getByTestId('density-revision-'+revision.id).getByRole('button',{name:'独立核对批准'})).toHaveCount(0);
    admin=await open(ctx.actors.admin);let row=admin.getByTestId('density-revision-'+revision.id);await row.getByRole('button',{name:'独立核对批准',exact:true}).click();await admin.getByTestId('density-review-reason').fill('独立核对报告及测定条件');await admin.getByRole('button',{name:'确认密度版本操作',exact:true}).click();await expect(row).toContainText('已核对批准');
    await admin.reload();await admin.locator('#loading').waitFor({state:'hidden'});await admin.getByTestId('density-workbench').locator('summary').click();await admin.getByTestId('density-material').fill(fixture.material.code);await admin.getByRole('option').filter({hasText:fixture.material.code}).first().click();row=admin.getByTestId('density-revision-'+revision.id);
    for(const value of [fixture.spec.batchNo,'1.200000 kg/L','20 °C','101.325 kPa',fixture.spec.sourceReference,'已核对批准'])await expect(row).toContainText(value);
    await row.scrollIntoViewIfNeeded();e.screenshot=path.join(dir,'density-approved.png');await admin.screenshot({path:e.screenshot,animations:'disabled'});
    await admin.setViewportSize({width:390,height:844});await row.scrollIntoViewIfNeeded();e.mobileOverflow=await admin.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);assert.equal(e.mobileOverflow,false);e.mobileScreenshot=path.join(dir,'density-approved-mobile.png');await admin.screenshot({path:e.mobileScreenshot,animations:'disabled'});
    e.readbacks=await Promise.all([0,1].map(async instance=>ctx.dataOf(await ctx.request(`/materials/${fixture.material.id}/densities`,{instance,signal})).find(r=>r.id===revision.id)));assert.deepEqual(e.readbacks[0],e.readbacks[1]);assert.equal(e.readbacks[0].approvedBy,ctx.actors.admin.id);e.after=await snapshot();assert.deepEqual(e.after,e.before);assert.deepEqual(e.errors,[]);return e;
  } catch(error){error.evidence=e;throw error;}finally{await manager.close();await admin?.close();}
}
module.exports={densityProbe,densityBrowser};
