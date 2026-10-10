const assert = require('node:assert/strict');
const { assertContinuousLedger } = require('./enterprise-round2-production-lot.cjs');
const { synchronizedBurst } = require('./enterprise-round2-runner.cjs');
const mode = 'packaging_percentage_v1';

async function packagingProbe(ctx, signal) {
  const { request, dataOf, prisma, actors, ensureReleasedMaterial } = ctx;
  const prefix = ctx.runId + '-pack';
  const e = { scope: 'Approved mass-to-whole-package v1; no density, loss, split packages or full R2-06', rejected: [], cases: [] };
  const call = async (url, method='GET', data, actor=actors.admin, instance=0) => dataOf(await request(url,{method,data,actor,instance,signal}));
  const raw = await ensureReleasedMaterial({request,code:prefix+'-kg',name:prefix+'-kg',unit:'kg'});
  const rawG = await ensureReleasedMaterial({request,code:prefix+'-g',name:prefix+'-g',unit:'g'});
  const fg = await ensureReleasedMaterial({request,code:prefix+'-fg',name:prefix+'-fg',unit:'桶',category:'finished_good'});
  const url = `/materials/${fg.id}/packaging`;
  const spec = {specCode:'DRUM',version:'v1',packageUnit:'桶',netMass:'20',massUnit:'kg',sourceReference:prefix+'-source-document'};
  const snapshot = () => prisma.materialPackagingRevision.findMany({where:{materialId:fg.id},orderBy:{id:'asc'}});
  async function reject(label, path, method, data, actor=actors.admin, expected=409) {
    const before=await snapshot(), response=await request(path,{method,data,actor,signal}), after=await snapshot();
    e.rejected.push({label,before,response,after});assert.equal(response.status,expected,JSON.stringify(response));assert.deepEqual(after,before);
  }
  try {
    await reject('unauthorized-create',url,'POST',spec,actors.stock0,403);
    await reject('missing-source',url,'POST',{...spec,sourceReference:''},actors.buyer1,400);
    const self=await call(url,'POST',{...spec,version:'self'});
    await reject('self-approval',url+`/${self.id}/approve`,'POST',{expectedUpdatedAt:self.updatedAt,reason:'self control'});
    const draft=await call(url,'POST',spec,actors.buyer1);
    await reject('duplicate-version',url,'POST',spec,actors.buyer1);
    await reject('unauthorized-approval',url+`/${draft.id}/approve`,'POST',{expectedUpdatedAt:draft.updatedAt,reason:'unauthorized'},actors.buyer1,403);
    const body = {materialId:fg.id,productName:fg.nameZh,packagingRevisionId:draft.id,outputUnit:'桶',shelfLifeDays:365,status:'active',bomType:'chemical_formula',formulationMode:'percentage',standardBatchSize:1,batchSizeUnit:'桶',version:prefix+'-v1',
      items:[{materialId:raw.id,unit:'kg',dosageMode:mode,percentage:60,quantityPerUnit:999,allowedVarianceRate:0},{materialId:rawG.id,unit:'g',dosageMode:mode,percentage:40,quantityPerUnit:999,allowedVarianceRate:0}],
      qualityCharacteristics:[{code:'NET',name:'单包装净质量',valueType:'numeric',unit:'kg',lowerLimit:20,upperLimit:20}]};
    await reject('unapproved-bom','/production/boms','POST',body);
    const countBefore=await prisma.auditLog.count({where:{resource:'material_packaging',resourceId:draft.id,action:'APPROVE_PACKAGING_REVISION'}});
    // Same approver's duplicate submissions, through two instances (not two distinct approval actors).
    e.duplicateApproval=await Promise.all([0,1].map(instance=>request(url+`/${draft.id}/approve`,{method:'POST',instance,signal,data:{expectedUpdatedAt:draft.updatedAt,reason:'Independent source document verified'}})));
    assert.deepEqual(e.duplicateApproval.map(r=>r.status).sort(),[200,409]);
    assert.equal(await prisma.auditLog.count({where:{resource:'material_packaging',resourceId:draft.id,action:'APPROVE_PACKAGING_REVISION'}}),countBefore+1);
    const approved=dataOf(e.duplicateApproval.find(r=>r.status===200));
    await reject('immutable-version',url+`/${draft.id}`,'PATCH',{netMass:'25'},actors.admin,404);
    const v1=await call('/production/boms','POST',body);
    assert.deepEqual(v1.items.map(i=>i.quantityPerUnit),[12,8000]);assert.equal(JSON.parse(v1.packagingSnapshotJson).netMass,'20');
    for(const [label,patch] of [['no-net-mass-qc',{bomType:'standard',qualityCharacteristics:[]}],['optional-net-mass-qc',{qualityCharacteristics:body.qualityCharacteristics.map(c=>({...c,required:false}))}],['relaxed-net-mass-qc',{qualityCharacteristics:body.qualityCharacteristics.map(c=>({...c,lowerLimit:19}))}],['missing-basis',{packagingRevisionId:null}],['wrong-package',{outputUnit:'袋'}],['loss-not-supported',{items:body.items.map(i=>({...i,lossRate:1}))}]]) {
      const before=await prisma.productionBom.count({where:{materialId:fg.id}});await reject(label,'/production/boms','POST',{...body,...patch});assert.equal(await prisma.productionBom.count({where:{materialId:fg.id}}),before);
    }
    const incompleteBefore=await prisma.productionBom.count({where:{materialId:fg.id}});
    await reject('incomplete-percentage','/production/boms','POST',{...body,items:[{...body.items[0],percentage:50}]},actors.admin,400);
    assert.equal(await prisma.productionBom.count({where:{materialId:fg.id}}),incompleteBefore);
    const warehouses=await call('/warehouses'), location=warehouses.flatMap(w=>w.locations||[]).find(l=>l.code==='LOC-FG');assert(location);
    const stocks=[];
    for(const [material,quantity,cost] of [[raw,100,10],[rawG,100000,0.01]]) stocks.push(await call('/warehouses/stock-balances','POST',{materialId:material.id,productName:material.nameZh,batchNo:prefix+'-'+material.baseUnit,locationId:location.id,quantity,unit:material.baseUnit,unitCost:cost,sourceRef:prefix+'-'+material.id,reason:'Isolated packaging conversion'}));
    const woBody=bom=>({bomId:bom.id,productName:fg.nameZh,targetQuantity:2,producedQuantity:2});
    await reject('split-packages','/production/work-orders','POST',{...woBody(v1),targetQuantity:0.5,producedQuantity:0.5});
    const old=await call('/production/work-orders','POST',woBody(v1),actors.stock0);
    const draft2=await call(url,'POST',{...spec,version:'v2',netMass:'25'},actors.buyer1);
    const approved2=await call(url+`/${draft2.id}/approve`,'POST',{expectedUpdatedAt:draft2.updatedAt,reason:'Independent revised document'});
    const v2=await call('/production/boms','POST',{...body,packagingRevisionId:approved2.id,version:prefix+'-v2',qualityCharacteristics:[{...body.qualityCharacteristics[0],lowerLimit:25,upperLimit:25}]});
    const newer=await call('/production/work-orders','POST',woBody(v2),actors.stock0);
    await call(url+`/${approved.id}/retire`,'POST',{expectedUpdatedAt:approved.updatedAt,reason:'Superseded; existing WIP keeps frozen basis'});
    await reject('retired-new-bom','/production/boms','POST',body);
    await reject('retired-new-work-order','/production/work-orders','POST',woBody(v1));
    for(const [bom,wo,kg,g,mass] of [[v1,old,24,16000,20],[v2,newer,30,20000,25]]) {
      const item={bomId:bom.id,woId:wo.id,netMass:mass};e.cases.push(item);
      item.previews=await Promise.all([0,1].map(instance=>call(`/production/work-orders/${wo.id}/preview-consumption`,'GET',undefined,actors.stock0,instance)));
      for(const preview of item.previews)assert.deepEqual(preview.map(p=>p.requiredQty),[kg,g]);
      const state=async()=>({stocks:await prisma.stockBalance.findMany({where:{id:{in:stocks.map(s=>s.id)}},orderBy:{id:'asc'}}),wo:await prisma.productionWorkOrder.findUniqueOrThrow({where:{id:wo.id},include:{productBatch:true,genealogyEdges:true}}),costs:await prisma.inventoryCostLedger.findMany({where:{workOrderId:wo.id},orderBy:{id:'asc'}}),audits:await prisma.auditLog.findMany({where:{action:'UPDATE_PRODUCTION_WORK_ORDER_STATUS',resourceId:wo.id},orderBy:{id:'asc'}})});
      const records=[{stockBalanceId:stocks[0].id,quantity:kg},{stockBalanceId:stocks[1].id,quantity:g}];
      await call(`/production/work-orders/${wo.id}/status`,'PATCH',{status:'qc_pending'},actors.stock0);
      const beforeQc=await state();item.noRelease=await request(`/production/work-orders/${wo.id}/status`,{method:'PATCH',signal,data:{status:'completed',consumptionRecords:records}});assert.equal(item.noRelease.status,409);assert.deepEqual(await state(),beforeQc);
      const check=await call(`/production/work-orders/${wo.id}/checks`,'POST',{sampleNo:prefix+'-'+wo.id,measurements:[{characteristicId:bom.qualityCharacteristics[0].id,measuredNumeric:String(mass)}]},actors.stock0);
      await call(`/production/work-orders/${wo.id}/checks/${check.id}/review`,'POST',{decision:'release',reviewNote:'Independent package net mass release'},actors.buyer1);
      item.before=await state();item.wrongRecipe=await request(`/production/work-orders/${wo.id}/status`,{method:'PATCH',signal,data:{status:'completed',consumptionRecords:records.map(r=>({...r,quantity:r.quantity*1.25}))}});assert.equal(item.wrongRecipe.status,409);assert.deepEqual(await state(),item.before);
      const complete=instance=>call(`/production/work-orders/${wo.id}/status`,'PATCH',{status:'completed',consumptionRecords:records},actors.stock0,instance);
      await complete(0);item.after=await state();assert.deepEqual(item.after.costs.map(c=>Number(c.costAmountDelta)).sort((a,b)=>a-b),[-kg*10,-g*0.01,kg*10+g*0.01].sort((a,b)=>a-b));

      for (let n=0;n<stocks.length;n++) {
        const used=[kg,g][n], beforeStock=item.before.stocks.find(s=>s.id===stocks[n].id), afterStock=item.after.stocks.find(s=>s.id===stocks[n].id);
        assert.equal(afterStock.quantity,beforeStock.quantity-used);assert(afterStock.quantity>=0);
        const batch=await prisma.productBatch.findUniqueOrThrow({where:{batchNo:afterStock.batchNo}});
        const ledger=await prisma.inventoryCostLedger.findMany({where:{batchId:batch.id},orderBy:{id:'asc'}});
        assertContinuousLedger(ledger,afterStock.quantity,afterStock.quantity*[10,0.01][n]);
        assert.equal(batch.stockQuantity,afterStock.quantity);
        item.rawConservation ||= []; item.rawConservation.push({stockBalanceId:afterStock.id,batch,ledger});
      }
      assert.equal(item.after.wo.productBatch.unit,'桶');assert.equal(item.after.wo.productBatch.stockQuantity,2);assert.equal(item.after.wo.genealogyEdges.length,2);
      assert.deepEqual(item.after.wo.genealogyEdges.map(x=>x.quantityConsumed).sort((a,b)=>a-b),[kg,g]);
      assertContinuousLedger(item.after.costs.filter(c=>c.batchId===item.after.wo.batchId),2,mass*20);
      assert.equal(item.after.audits.length,item.before.audits.length+1);await complete(1);item.replay=await state();assert.deepEqual(item.replay,item.after);
      item.readbacks=await Promise.all([0,1].map(async instance=>({bom:(await call('/production/boms','GET',undefined,actors.admin,instance)).find(b=>b.id===bom.id),wo:(await call('/production/work-orders','GET',undefined,actors.stock0,instance)).find(w=>w.id===wo.id)})));
      for(const r of item.readbacks){assert.equal(r.bom.packagingSnapshotJson,bom.packagingSnapshotJson);assert.equal(r.wo.bomId,bom.id);assert.equal(r.wo.status,'completed');}
    }
    // Retirement and first WO creation must serialize on the approved revision.
    e.retireRace=await synchronizedBurst([actors.admin,actors.stock0],actor=>actor.id===actors.admin.id
      ? request(url+`/${approved2.id}/retire`,{method:'POST',actor,instance:0,signal,data:{expectedUpdatedAt:approved2.updatedAt,reason:'Retirement race'}})
      : request('/production/work-orders',{method:'POST',actor,instance:1,signal,data:woBody(v2)}),signal);
    assert.equal(e.retireRace[0].status,200);assert([201,409].includes(e.retireRace[1].status));await reject('post-race-new-wo','/production/work-orders','POST',woBody(v2));
    e.browserFixture={fg,raw,rawG,specCode:'BROWSER',version:prefix+'-browser'};
    return e;
  } catch(error){error.evidence=e;throw error;}
}

async function packagingBrowser(ctx,browser,fixture,dir,signal) {
  const path=require('node:path'), {expect}=require('playwright/test');
  const e={scope:'Manager prepares, independent admin approves, actual browser creates frozen packaging BOM',errors:[]};
  const open=async actor=>{const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
    await page.addInitScript(({token,user})=>{for(const k of ['token','auth_token','erp_auth_token'])localStorage.setItem(k,token);for(const k of ['user','currentUser','erp_current_user'])localStorage.setItem(k,JSON.stringify(user));localStorage.setItem('ailao.language','zh');},{token:actor.token,user:{id:String(actor.id),name:actor.job,role:actor.role,segment:'mixed'}});
    page.on('pageerror',x=>e.errors.push(x.message));page.on('response',r=>{if(r.status()>=400&&r.url().includes('/api/'))e.errors.push(r.status()+' '+new URL(r.url()).pathname);});
    await page.goto(ctx.urls[1]+'/#production');await page.locator('#loading').waitFor({state:'hidden'});await page.getByTestId('packaging-workbench').locator('summary').click();return page;};
  const select=async(page,id,m)=>{await page.getByTestId(id).fill(m.code);await page.getByRole('option').filter({hasText:m.code}).first().click();};
  const manager=await open(ctx.actors.buyer1);let admin;
  try {
    await select(manager,'packaging-output',fixture.fg);
    for(const [id,value] of [['packaging-spec-code',fixture.specCode],['packaging-spec-version','v1'],['packaging-net-mass','20'],['packaging-source',fixture.version+'-source']])await manager.getByTestId(id).fill(value);
    await manager.getByRole('button',{name:'保存包装规格草稿并回读',exact:true}).click();await expect(manager.getByRole('status')).toContainText('等待另一人批准');
    const revision=await ctx.prisma.materialPackagingRevision.findUniqueOrThrow({where:{materialId_specCode_version:{materialId:fixture.fg.id,specCode:fixture.specCode,version:'v1'}}});assert.equal(revision.createdBy,ctx.actors.buyer1.id);assert.equal(revision.status,'draft');
    await expect(manager.getByTestId('packaging-revision-'+revision.id).getByRole('button',{name:'独立批准'})).toHaveCount(0);
    admin=await open(ctx.actors.admin);await select(admin,'packaging-output',fixture.fg);
    const row=admin.getByTestId('packaging-revision-'+revision.id);await row.getByRole('button',{name:'独立批准',exact:true}).click();await admin.getByTestId('packaging-review-reason').fill('独立核对包装净量来源');await admin.getByRole('button',{name:'确认包装版本操作',exact:true}).click();await expect(row).toContainText('已批准');
    await admin.getByTestId('packaging-bom-revision').selectOption(String(revision.id));await admin.getByTestId('packaging-bom-version').fill(fixture.version);await select(admin,'packaging-raw-0',fixture.raw);await expect(admin.getByTestId('packaging-preview-0')).toContainText('20 kg/桶');
    await admin.getByRole('button',{name:'创建包装 BOM 并回读',exact:true}).click();await expect(admin.getByRole('status')).toContainText('净量版本已冻结');
    const bom=await ctx.prisma.productionBom.findFirstOrThrow({where:{materialId:fixture.fg.id,version:fixture.version},include:{items:true}});assert.equal(bom.packagingRevisionId,revision.id);assert.equal(bom.items[0].quantityPerUnit,20);
    await admin.reload();await admin.locator('#loading').waitFor({state:'hidden'});const saved=admin.locator('tr').filter({hasText:bom.bomNo});await saved.getByRole('button').click();const snapshot=admin.getByTestId('packaging-bom-snapshot');await expect(snapshot).toContainText('20 kg/桶');await expect(snapshot).toContainText(fixture.version+'-source');await snapshot.scrollIntoViewIfNeeded();
    e.screenshot=path.join(dir,'packaging-bom-frozen.png');await admin.screenshot({path:e.screenshot,animations:'disabled'});
    await admin.setViewportSize({width:390,height:844});await snapshot.scrollIntoViewIfNeeded();await expect(snapshot).toBeVisible();
    e.mobileOverflow=await admin.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2);assert.equal(e.mobileOverflow,false,'Packaging readback causes horizontal overflow');
    e.mobileScreenshot=path.join(dir,'packaging-bom-mobile.png');await admin.screenshot({path:e.mobileScreenshot,animations:'disabled'});
    e.readbacks=await Promise.all([0,1].map(async instance=>({revision:ctx.dataOf(await ctx.request(`/materials/${fixture.fg.id}/packaging`,{instance,signal})).find(r=>r.id===revision.id),bom:ctx.dataOf(await ctx.request('/production/boms',{instance,signal})).find(b=>b.id===bom.id)})));
    for(const r of e.readbacks){assert.equal(r.revision.approvedBy,ctx.actors.admin.id);assert.equal(r.bom.packagingSnapshotJson,bom.packagingSnapshotJson);assert.equal(r.bom.items[0].quantityPerUnit,20);}assert.deepEqual(e.errors,[]);return e;
  } catch(error){error.evidence=e;throw error;}finally{await manager.close();await admin?.close();}
}
module.exports={packagingProbe,packagingBrowser};
