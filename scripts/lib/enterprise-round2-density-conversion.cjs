const assert = require('node:assert/strict');
const { assertContinuousLedger } = require('./enterprise-round2-production-lot.cjs');
const mode = 'density_percentage_v1';
const cents = value => Math.round(Number(value) * 100);

function assertDensityCostConservation(evidence) {
  assert.equal(evidence.scope, 'Approved batch density v1 into actual volume issue, frozen at work-order creation');
  const c = evidence.case;
  assert.equal(c.after.stock.quantity, 92);
  assert.equal(c.after.rawBatch.stockQuantity, 92);
  assertContinuousLedger(c.after.rawCosts, 92, 1380);
  assert.equal(c.after.outputBalances.reduce((sum,row)=>sum+Number(row.quantity),0),10);
  assert.equal(c.after.wo.productBatch.stockQuantity,10);
  assert.equal(c.after.wo.productBatch.unit,'kg');
  assert.deepEqual(c.after.costs.map(row=>Number(row.costAmountDelta)).sort((a,b)=>a-b),[-120,120]);
  assert.equal(c.after.costs.reduce((sum,row)=>sum+cents(row.costAmountDelta),0),0);
  assertContinuousLedger(c.after.costs.filter(row=>row.batchId===c.after.wo.batchId),10,120);
  assert.equal(c.after.wo.genealogyEdges.length,1);
  assert.equal(c.after.wo.genealogyEdges[0].quantityConsumed,8);
  assert.equal(c.after.wo.genealogyEdges[0].inputUnit,'L');
  assert.deepEqual(c.replay,c.after);
  const completionAudit=c.after.audits.find(row=>JSON.parse(row.details).status==='completed');
  assert(completionAudit,'the successful density completion must produce one immutable audit event');
  assert.deepEqual(JSON.parse(completionAudit.details).densityActualConditions,[{stockBalanceId:c.stock.id,materialId:c.raw.id,batchNo:c.stock.batchNo,quantity:8,densityRevisionId:c.approved.id,temperatureC:'20',pressureKpaAbs:'101.325',compositionReference:'Synthetic exact composition; no extrapolation'}]);
  for (const readback of c.readbacks) {
    assert.equal(readback.stock.quantity,92); assert.equal(readback.wo.status,'completed');
    assert.equal(readback.wo.densitySnapshotJson,c.workOrderSnapshot);
    assert.equal(readback.bom.items[0].quantityPerUnit,0.8);
  }
  return { case: c, invariants: ['batch-volume issue equals frozen density basis','input/output ledgers conserve 120 carrying cost','replay is idempotent','actual density conditions are immutable in the completion audit','both API instances agree'] };
}

async function densityConversionProbe(ctx, signal) {
  const { request, dataOf, prisma, actors, ensureReleasedMaterial } = ctx;
  const prefix=ctx.runId+'-density-conversion';
  const evidence={scope:'Approved batch density v1 into actual volume issue, frozen at work-order creation',rejected:[],case:null};
  const call=async(url,method='GET',data,actor=actors.admin,instance=0)=>dataOf(await request(url,{method,data,actor,instance,signal}));
  const reject=async(label,action,expected=409)=>{const before=await snapshot();const response=await action();const after=await snapshot();evidence.rejected.push({label,response,before,after});assert.equal(response.status,expected,JSON.stringify(response));assert.deepEqual(after,before);};
  let snapshot=async()=>({});
  try {
    const warehouses=await call('/warehouses');const location=warehouses.flatMap(w=>w.locations||[]).find(l=>l.code==='LOC-FG');assert(location,'Default fixture location is required');
    const raw=await ensureReleasedMaterial({request,code:prefix+'-raw',name:prefix+'-raw-volume',unit:'L',category:'raw_material'});
    const fg=await ensureReleasedMaterial({request,code:prefix+'-fg',name:prefix+'-finished',unit:'kg',category:'finished_good'});
    const batchNo=prefix+'-lot';
    // A physically older lot must not steal the frozen-batch consumption suggestion.
    const other=await call('/warehouses/stock-balances','POST',{materialId:raw.id,productName:raw.nameZh,batchNo:prefix+'-other',locationId:location.id,quantity:10,unit:'L',unitCost:15,sourceRef:prefix+'-other',reason:'Older other-batch negative control'});
    const stock=await call('/warehouses/stock-balances','POST',{materialId:raw.id,productName:raw.nameZh,batchNo,locationId:location.id,quantity:100,unit:'L',unitCost:15,sourceRef:prefix+'-seed',reason:'Isolated approved density conversion fixture'});
    const rawBatch=await prisma.productBatch.findUniqueOrThrow({where:{batchNo}});
    const densityUrl='/materials/'+raw.id+'/densities';
    const source={batchNo,specCode:'DENSITY',version:'v1',densityKgPerL:'1.250000',temperatureC:'20',pressureKpaAbs:'101.325',compositionReference:'Synthetic exact composition; no extrapolation',methodReference:'Synthetic calibrated method',sourceReference:prefix+'-report',measuredAt:'2026-01-01T00:00:00.000Z'};
    const draft=await call(densityUrl,'POST',source,actors.buyer1);
    const approved=await call(densityUrl+'/'+draft.id+'/approve','POST',{expectedUpdatedAt:draft.updatedAt,reason:'Independent density source and actual conditions verified'},actors.admin);
    const body={materialId:fg.id,productName:fg.nameZh,outputUnit:'kg',shelfLifeDays:365,standardBatchSize:10,batchSizeUnit:'kg',status:'active',bomType:'chemical_formula',formulationMode:'percentage',version:prefix+'-v1',items:[{materialId:raw.id,unit:'L',dosageMode:mode,densityRevisionId:approved.id,percentage:100,quantityPerUnit:999,lossRate:0,allowedVarianceRate:0}],qualityCharacteristics:[{code:'VISC',name:'粘度',valueType:'numeric',unit:'mPa.s',lowerLimit:1,upperLimit:2}]};
    const beforeBoms=await prisma.productionBom.count({where:{materialId:fg.id}});
    const missing=await request('/production/boms',{method:'POST',data:{...body,items:[{...body.items[0],densityRevisionId:null}]},signal});
    evidence.rejected.push({ label:'missing-density-basis', response:missing });
    assert.equal(missing.status,400);assert.equal(await prisma.productionBom.count({where:{materialId:fg.id}}),beforeBoms);
    const wrongUnit=await request('/production/boms',{method:'POST',data:{...body,items:[{...body.items[0],unit:'kg'}]},signal});
    evidence.rejected.push({ label:'wrong-volume-unit', response:wrongUnit });
    assert.equal(wrongUnit.status,409);assert.equal(await prisma.productionBom.count({where:{materialId:fg.id}}),beforeBoms);
    const bom=await call('/production/boms','POST',body);assert.equal(bom.items[0].quantityPerUnit,0.8);assert.equal(bom.items[0].densityRevisionId,approved.id);const bomBasis=JSON.parse(bom.items[0].densitySnapshotJson);assert.equal(bomBasis.batchNo,batchNo);assert.equal(bomBasis.densityKgPerL,'1.250000');
    const wo=await call('/production/work-orders','POST',{bomId:bom.id,productName:fg.nameZh,targetQuantity:10,producedQuantity:10},actors.stock0);
    const workOrderSnapshot=JSON.parse((await prisma.productionWorkOrder.findUniqueOrThrow({where:{id:wo.id}})).densitySnapshotJson);assert.equal(workOrderSnapshot.length,1);assert.equal(workOrderSnapshot[0].revisionId,approved.id);assert.equal(workOrderSnapshot[0].batchNo,batchNo);assert.equal(workOrderSnapshot[0].quantityPerUnit,0.8);
    // New work orders cannot be created after a basis retirement, while this already frozen WIP stays valid.
    const retired=await call(densityUrl+'/'+approved.id+'/retire','POST',{expectedUpdatedAt:approved.updatedAt,reason:'No new work order may use this test basis'},actors.admin);
    const deniedNew=await request('/production/work-orders',{method:'POST',actor:actors.stock1,signal,data:{bomId:bom.id,productName:fg.nameZh,targetQuantity:10,producedQuantity:10}});assert.equal(deniedNew.status,409);
    await call('/production/work-orders/'+wo.id+'/status','PATCH',{status:'qc_pending'},actors.stock0);
    const check=await call('/production/work-orders/'+wo.id+'/checks','POST',{sampleNo:prefix+'-qc',measurements:[{characteristicId:bom.qualityCharacteristics[0].id,measuredNumeric:'1.5'}]},actors.stock0);
    await call('/production/work-orders/'+wo.id+'/checks/'+check.id+'/review','POST',{decision:'release',reviewNote:'Independent release of finished output'},actors.buyer1);
    snapshot=async()=>({stock:await prisma.stockBalance.findUniqueOrThrow({where:{id:stock.id}}),rawBatch:await prisma.productBatch.findUniqueOrThrow({where:{id:rawBatch.id}}),rawCosts:await prisma.inventoryCostLedger.findMany({where:{batchId:rawBatch.id},orderBy:{id:'asc'}}),outputBalances:await prisma.stockBalance.findMany({where:{materialId:fg.id},orderBy:{id:'asc'}}),wo:await prisma.productionWorkOrder.findUniqueOrThrow({where:{id:wo.id},include:{productBatch:true,genealogyEdges:true}}),costs:await prisma.inventoryCostLedger.findMany({where:{workOrderId:wo.id},orderBy:{id:'asc'}}),audits:await prisma.auditLog.findMany({where:{action:'UPDATE_PRODUCTION_WORK_ORDER_STATUS',resourceId:wo.id},orderBy:{id:'asc'}})});
    const exactUse={densityRevisionId:approved.id,temperatureC:'20',pressureKpaAbs:'101.325',compositionReference:source.compositionReference};
    evidence.case={raw,fg,stock,rawBatch,bom,wo,approved,retired,workOrderSnapshot:JSON.stringify(workOrderSnapshot)};
    await reject('missing-actual-density-conditions',()=>request('/production/work-orders/'+wo.id+'/status',{method:'PATCH',actor:actors.stock0,signal,data:{status:'completed',consumptionRecords:[{stockBalanceId:stock.id,quantity:8}]}}));
    await reject('wrong-actual-temperature',()=>request('/production/work-orders/'+wo.id+'/status',{method:'PATCH',actor:actors.stock0,signal,data:{status:'completed',consumptionRecords:[{stockBalanceId:stock.id,quantity:8,densityUse:{...exactUse,temperatureC:'21'}}]}}));
    await reject('wrong-actual-pressure',()=>request('/production/work-orders/'+wo.id+'/status',{method:'PATCH',actor:actors.stock0,signal,data:{status:'completed',consumptionRecords:[{stockBalanceId:stock.id,quantity:8,densityUse:{...exactUse,pressureKpaAbs:'101.300'}}]}}));
    for (const [label,patch] of [['wrong-actual-composition',{compositionReference:'other composition'}],['wrong-revision',{densityRevisionId:approved.id+99999}]]) {
      await reject(label,()=>request('/production/work-orders/'+wo.id+'/status',{method:'PATCH',actor:actors.stock0,signal,data:{status:'completed',consumptionRecords:[{stockBalanceId:stock.id,quantity:8,densityUse:{...exactUse,...patch}}]}}));
    }
    for (const quantity of [8.000001,7.999999,8.0000001]) await reject('non-exact-quantity-'+quantity,()=>request('/production/work-orders/'+wo.id+'/status',{method:'PATCH',actor:actors.stock0,signal,data:{status:'completed',consumptionRecords:[{stockBalanceId:stock.id,quantity,densityUse:exactUse}]}}));
    await reject('duplicate-density-issue',()=>request('/production/work-orders/'+wo.id+'/status',{method:'PATCH',actor:actors.stock0,signal,data:{status:'completed',consumptionRecords:[{stockBalanceId:stock.id,quantity:4,densityUse:exactUse},{stockBalanceId:stock.id,quantity:4}]}}));
    await reject('other-real-batch',()=>request('/production/work-orders/'+wo.id+'/status',{method:'PATCH',actor:actors.stock0,signal,data:{status:'completed',consumptionRecords:[{stockBalanceId:other.id,quantity:8,densityUse:exactUse}]}}));
    evidence.case.before=await snapshot();
    await call('/production/work-orders/'+wo.id+'/status','PATCH',{status:'completed',consumptionRecords:[{stockBalanceId:stock.id,quantity:8,densityUse:exactUse}]},actors.stock0);
    evidence.case.after=await snapshot();
    evidence.case.readbacks=await Promise.all([0,1].map(async instance=>({stock:(await call('/warehouses/stock-balances?batchNo='+encodeURIComponent(batchNo)+'&pageSize=100','GET',undefined,actors.stock0,instance)).find(row=>row.id===stock.id),wo:(await call('/production/work-orders','GET',undefined,actors.stock0,instance)).find(row=>row.id===wo.id),bom:(await call('/production/boms','GET',undefined,actors.admin,instance)).find(row=>row.id===bom.id)})));
    const replay=await call('/production/work-orders/'+wo.id+'/status','PATCH',{status:'completed',consumptionRecords:[{stockBalanceId:stock.id,quantity:8,densityUse:exactUse}]},actors.stock0,1);assert.equal(replay.status,'completed');evidence.case.replay=await snapshot();
    assertDensityCostConservation(evidence);
    if (process.env.ROUND2_BROWSER === 'true') evidence.browser = await require('./enterprise-round2-density-conversion-browser.cjs').densityConversionBrowser(ctx, {raw,fg,stock,source,other}, signal);
    return evidence;
  } catch(error) { error.evidence ||= evidence;throw error; }
}
module.exports={densityConversionProbe,assertDensityCostConservation};
