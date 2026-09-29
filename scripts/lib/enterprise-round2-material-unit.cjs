const assert = require('node:assert/strict');
const { synchronizedBurst } = require('./enterprise-round2-runner.cjs');

async function materialUnitProbe(ctx, fixture, signal) {
  const { request, dataOf, prisma, runId } = ctx;
  const evidence = { scope: 'Released base-unit immutability and unused-draft lifecycle race; not packaging conversion', rejected: [], races: [] };
  const call = async (url, method = 'GET', data, instance = 0) => dataOf(await request(url, { method, data, instance, signal }));
  const patch = (id, data, instance = 1, actor = ctx.actors.admin) => request('/materials/'+id, { method: 'PATCH', data, instance, actor, signal });
  const read = (id, instance = 0) => call('/materials/'+id, 'GET', undefined, instance);
  const materialSnapshot = async id => ({ material: await prisma.material.findUniqueOrThrow({ where: { id } }), audits: await prisma.auditLog.findMany({ where: { resource: 'material', resourceId: id }, orderBy: { id: 'asc' } }) });
  const draft = label => call('/materials', 'POST', { code: runId+'-unit-'+label, nameZh: runId+'-unit-'+label, baseUnit: 'kg', status: 'draft', isTemporary: true, category: 'raw_material', aliases: [] });
  async function reject(id, data, code) {
    const before = await materialSnapshot(id), response = await patch(id, data), after = await materialSnapshot(id);
    const result = { id, before, response, after, readbacks: await Promise.all([0,1].map(i=>read(id,i))) }; evidence.rejected.push(result);
    assert.equal(response.status, 409, JSON.stringify(response)); assert.equal(response.json.code, code); assert.deepEqual(after,before);
    for(const r of result.readbacks) assert.equal(r.baseUnit, before.material.baseUnit);
  }
  try {
    const businessSnapshot = async () => ({
      bom: await prisma.productionBom.findUniqueOrThrow({ where: { id: fixture.v1.id }, include: { items: true } }),
      workOrder: await prisma.productionWorkOrder.findUniqueOrThrow({ where: { id: fixture.old.id }, include: { productBatch: true, genealogyEdges: true } }),
      stock: await prisma.stockBalance.findUniqueOrThrow({ where: { id: fixture.stock.id } }),
      costs: await prisma.inventoryCostLedger.findMany({ where: { workOrderId: fixture.old.id }, orderBy: { id: 'asc' } }),
      movements: await prisma.stockMovement.findMany({ where: { materialId: { in: [fixture.raw.id, fixture.fg.id] } }, orderBy: { id: 'asc' } }),
    });
    evidence.businessBefore = await businessSnapshot();
    for (const material of [fixture.raw, fixture.fg]) {
      const current = await read(material.id); assert.equal(current.baseUnitEditable,false);
      await reject(material.id, { baseUnit: 't', expectedUpdatedAt: current.updatedAt }, 'MATERIAL_BASE_UNIT_FROZEN');
    }
    evidence.businessAfter = await businessSnapshot(); assert.deepEqual(evidence.businessAfter,evidence.businessBefore);
    const blocked = await draft('blocked'); const frozen = await call('/materials/'+blocked.id,'PATCH',{ status:'blocked',expectedUpdatedAt:blocked.updatedAt });
    await reject(blocked.id,{baseUnit:'g',expectedUpdatedAt:frozen.updatedAt},'MATERIAL_BASE_UNIT_FROZEN');
    const unused = await draft('unused'); assert.equal(unused.baseUnitEditable,true);
    await reject(unused.id,{baseUnit:'g'},'MATERIAL_UNIT_VERSION_REQUIRED');
    const changed = await call('/materials/'+unused.id,'PATCH',{baseUnit:'g',expectedUpdatedAt:unused.updatedAt});
    assert.equal(changed.baseUnit,'g'); assert.equal(changed.baseUnitEditable,true); assert(Date.parse(changed.updatedAt)>Date.parse(unused.updatedAt));
    const updated = await materialSnapshot(unused.id); const details=JSON.parse(updated.audits.at(-1).details);
    assert.equal(details.beforeBaseUnit,'kg');assert.equal(details.afterBaseUnit,'g');
    evidence.draftCorrection = updated;
    await reject(unused.id,{baseUnit:'t',expectedUpdatedAt:unused.updatedAt},'MATERIAL_CONCURRENT_UPDATE');
    // A synthetic legacy draft with a zero balance remains referenced; no normal business posting creates this fixture.
    const legacy = await draft('legacy-zero');
    await prisma.stockBalance.create({ data:{ materialId:legacy.id,locationId:fixture.stock.locationId,productName:legacy.nameZh,batchNo:runId+'-legacy-zero',quantity:0,unit:'kg' } });
    assert.equal((await read(legacy.id)).baseUnitEditable,false);
    await reject(legacy.id,{baseUnit:'g',expectedUpdatedAt:legacy.updatedAt},'MATERIAL_BASE_UNIT_FROZEN');
    for (const kind of ['activate', 'edit']) for(let attempt=0;attempt<2;attempt++) {
      const m=await draft(kind+'-'+attempt), before=await materialSnapshot(m.id);
      const result={ kind,id:m.id,before };evidence.races.push(result);
      result.responses=await synchronizedBurst([ctx.actors.admin,ctx.actors.buyer1],actor=>{
        const i=actor.id===ctx.actors.admin.id?0:1;
        return patch(m.id,i===0?{baseUnit:'g',expectedUpdatedAt:m.updatedAt}:kind==='activate'?{status:'active',isTemporary:false,expectedUpdatedAt:m.updatedAt}:{baseUnit:'t',expectedUpdatedAt:m.updatedAt},i,actor);
      },signal);
      assert.deepEqual(result.responses.map(r=>r.status).sort(),[200,409],JSON.stringify(result.responses));
      result.after=await materialSnapshot(m.id); assert.equal(result.after.audits.length,before.audits.length+1);
      const winner=dataOf(result.responses.find(r=>r.status===200));assert.equal(result.after.material.baseUnit,winner.baseUnit);
      result.readbacks=await Promise.all([0,1].map(i=>read(m.id,i)));for(const r of result.readbacks){assert.equal(r.baseUnit,winner.baseUnit);assert.equal(r.status,winner.status);}
      const released=winner.status==='active'?winner:await call('/materials/'+m.id,'PATCH',{status:'active',isTemporary:false,expectedUpdatedAt:winner.updatedAt});
      await reject(m.id,{baseUnit:released.baseUnit==='g'?'t':'g',expectedUpdatedAt:released.updatedAt},'MATERIAL_BASE_UNIT_FROZEN');
    }
    const current=await read(fixture.fg.id);
    evidence.descriptionUpdate=await call('/materials/'+current.id,'PATCH',{baseUnit:current.baseUnit,complianceNotes:'Unit governance control',expectedUpdatedAt:current.updatedAt});
    assert.equal(evidence.descriptionUpdate.baseUnit,'kg');assert.equal(evidence.descriptionUpdate.baseUnitEditable,false);
    evidence.browserFixture={active:evidence.descriptionUpdate,draft:await draft('browser')};
    return evidence;
  } catch(error) { error.evidence=evidence;throw error; }
}

async function materialUnitBrowser(ctx, browser, fixture, dir, signal) {
  const path=require('node:path'); const { expect }=require('playwright/test');
  const { verifyRenderedCjk }=require('./browser-cjk-font-guard.cjs');
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
  const evidence={scope:'Real admin master-data unit lock and draft correction, not full workforce permissions',errors:[]};
  const actor=ctx.actors.admin;
  await page.addInitScript(({token,user})=>{for(const k of ['token','auth_token','erp_auth_token'])localStorage.setItem(k,token);for(const k of ['user','currentUser','erp_current_user'])localStorage.setItem(k,JSON.stringify(user));localStorage.setItem('ailao.language','zh');localStorage.setItem('language','zh-CN');},{token:actor.token,user:{id:String(actor.id),name:actor.job,role:actor.role,segment:'mixed'}});
  page.on('pageerror',e=>evidence.errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&r.url().includes('/api/'))evidence.errors.push(r.status()+' '+new URL(r.url()).pathname);});
  const open=async material=>{await page.getByTestId('material-search-input').fill(material.code);await page.getByTestId('material-row-'+material.id).getByRole('button').click();await expect(page.getByRole('dialog')).toHaveCSS('opacity','1');await expect(page.getByRole('dialog').locator('..')).toHaveCSS('opacity','1');};
  try {
    await page.goto(ctx.urls[1]+'/#materials');await page.locator('#loading').waitFor({state:'hidden'});await open(fixture.active);
    const unit=page.getByTestId('material-editor-unit'); await expect(unit).toHaveValue('kg');await expect(unit).toHaveAttribute('readonly','');
    await expect(page.getByText('基本单位已锁定；新建替代物料并通过受控调整承接，不直接改写历史库存或配方。',{exact:true})).toBeVisible();
    await unit.scrollIntoViewIfNeeded();evidence.lockedScreenshot=path.join(dir,'material-unit-locked.png');await page.screenshot({path:evidence.lockedScreenshot,animations:'disabled'});
    await page.getByRole('button',{name:'关闭物料编辑',exact:true}).click();await open(fixture.draft);
    await expect(unit).toBeEditable();await unit.fill('g');
    const response=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname==='/api/materials/'+fixture.draft.id);
    await page.getByRole('button',{name:'保存并回读',exact:true}).click();const result=await response;assert.equal(result.status(),200);
    await expect(page.getByText('物料修改已保存并回读。',{exact:true})).toBeVisible();await expect(unit).toHaveValue('g');
    await page.reload();await page.locator('#loading').waitFor({state:'hidden'});await open(fixture.draft);await expect(unit).toHaveValue('g');await expect(unit).toBeEditable();
    evidence.readbacks=await Promise.all([0,1].map(async instance=>ctx.dataOf(await ctx.request('/materials/'+fixture.draft.id,{instance,signal}))));for(const r of evidence.readbacks){assert.equal(r.baseUnit,'g');assert.equal(r.baseUnitEditable,true);}
    evidence.persisted=await ctx.prisma.material.findUniqueOrThrow({where:{id:fixture.draft.id}});assert.equal(evidence.persisted.baseUnit,'g');
    evidence.font=await verifyRenderedCjk(page,'body');evidence.correctedScreenshot=path.join(dir,'material-unit-draft-corrected.png');await page.screenshot({path:evidence.correctedScreenshot,animations:'disabled'});assert.deepEqual(evidence.errors,[]);
    let lifecycleWrites=0;
    page.on('request',r=>{if(r.method()==='PATCH'&&new URL(r.url()).pathname==='/api/materials/'+fixture.draft.id)lifecycleWrites++;});
    await unit.fill('t');await page.getByRole('button',{name:'审核并启用',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('请先保存并回读当前修改');await expect(unit).toHaveValue('t');
    evidence.unsavedApproval={writes:lifecycleWrites,persisted:await ctx.prisma.material.findUniqueOrThrow({where:{id:fixture.draft.id}})};
    assert.equal(lifecycleWrites,0);assert.equal(evidence.unsavedApproval.persisted.status,'draft');assert.equal(evidence.unsavedApproval.persisted.baseUnit,'g');
    await unit.fill('g');await page.getByRole('button',{name:'审核并启用',exact:true}).click();
    const confirm=page.getByRole('dialog').filter({has:page.getByText('确认审核并启用该物料？',{exact:true})});
    const approval=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname==='/api/materials/'+fixture.draft.id);
    await confirm.getByRole('button',{name:'审核并启用',exact:true}).click();assert.equal((await approval).status(),200);
    await expect(page.getByText('物料已审核并启用。',{exact:true})).toBeVisible();await expect(unit).toHaveAttribute('readonly','');await expect(unit).toHaveValue('g');
    await page.reload();await page.locator('#loading').waitFor({state:'hidden'});await open(fixture.draft);await expect(unit).toHaveValue('g');await expect(unit).toHaveAttribute('readonly','');
    evidence.activated=await Promise.all([0,1].map(async instance=>ctx.dataOf(await ctx.request('/materials/'+fixture.draft.id,{instance,signal}))));for(const r of evidence.activated){assert.equal(r.status,'active');assert.equal(r.baseUnit,'g');assert.equal(r.baseUnitEditable,false);}
    evidence.updateAudits=await ctx.prisma.auditLog.findMany({where:{resource:'material',resourceId:fixture.draft.id,action:'UPDATE_MATERIAL'},orderBy:{id:'asc'}});assert.equal(evidence.updateAudits.length,2);assert.equal(lifecycleWrites,1);
    evidence.activatedScreenshot=path.join(dir,'material-unit-activated.png');await page.screenshot({path:evidence.activatedScreenshot,animations:'disabled'});assert.deepEqual(evidence.errors,[]);
    return evidence;
  } catch(error){error.evidence=evidence;throw error;}finally{await page.close();}
}
module.exports={materialUnitProbe,materialUnitBrowser};
