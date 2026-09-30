jest.mock('../config/database',()=>({__esModule:true,default:{$transaction:jest.fn()}}));
import prisma from '../config/database';
import { MaterialDensityService } from './material-density.service';
import { createDensityRevisionSchema } from '../validators/material-density';

const input={batchNo:'LOT-A',specCode:'DENS',version:'v1',densityKgPerL:'1.200000',temperatureC:'20',pressureKpaAbs:'101.325',compositionReference:'FORMULA-A / concentration per source',methodReference:'METHOD-1',sourceReference:'LAB-1',measuredAt:'2026-01-01T00:00:00.000Z'};
function fixture(patch:Record<string,unknown>={}) {
  const row={...input,id:2,materialId:9,batchId:10,baseUnit:'L',status:'draft',createdBy:5,updatedAt:new Date('2026-01-01T00:00:00Z'),...patch};
  const tx={$executeRaw:jest.fn(),material:{findUnique:jest.fn().mockResolvedValue({id:9,baseUnit:'L',status:'active',category:'raw_material',isTemporary:false})},productBatch:{findUnique:jest.fn().mockResolvedValue({id:10,batchNo:'LOT-A',materialId:9,unit:'L',qualityStatus:'quarantine'})},materialDensityRevision:{findUnique:jest.fn().mockResolvedValue(row),create:jest.fn().mockResolvedValue(row),updateMany:jest.fn().mockResolvedValue({count:1}),findUniqueOrThrow:jest.fn().mockResolvedValue(row)},auditLog:{create:jest.fn()}};
  (prisma.$transaction as jest.Mock).mockImplementation(f=>f(tx));return {tx,row};
}
describe('density source evidence only',()=>{
  it('requires decimal text and explicit batch/point/method/source; no client approval',()=>{
    expect(createDensityRevisionSchema.safeParse(input).success).toBe(true);
    for(const patch of [{batchNo:''},{densityKgPerL:'1e2'},{densityKgPerL:1.2},{densityKgPerL:'0'},{temperatureC:''},{temperatureC:'-273.15'},{pressureKpaAbs:'0'},{compositionReference:''},{methodReference:''},{sourceReference:''},{status:'approved'},{batchId:10}])expect(createDensityRevisionSchema.safeParse({...input,...patch}).success).toBe(false);
  });
  it('copies batch and unit identity, leaving QC and accounting untouched',async()=>{
    const {tx}=fixture();await MaterialDensityService.create(9,input,5);
    expect(tx.materialDensityRevision.create).toHaveBeenCalledWith({data:expect.objectContaining({batchId:10,baseUnit:'L',densityKgPerL:'1.200000',measuredAt:new Date(input.measuredAt)})});
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('rejects future measurement and foreign batch before persistence',async()=>{
    const {tx}=fixture();expect(()=>MaterialDensityService.create(9,{...input,measuredAt:'2999-01-01T00:00:00.000Z'},5)).toThrow('IN_FUTURE');
    tx.productBatch.findUnique.mockResolvedValue({id:10,materialId:11,unit:'L'});
    await expect(MaterialDensityService.create(9,input,5)).rejects.toThrow('BATCH_IDENTITY_INVALID');expect(tx.materialDensityRevision.create).not.toHaveBeenCalled();
  });
  it('prevents self, stale and cross-material approvals without audit',async()=>{
    const {row,tx}=fixture(),review={expectedUpdatedAt:row.updatedAt.toISOString(),reason:'verified'};
    await expect(MaterialDensityService.transition(9,2,'approved',review,5)).rejects.toThrow('INDEPENDENT_REVIEW');
    await expect(MaterialDensityService.transition(9,2,'approved',{...review,expectedUpdatedAt:'2025-01-01T00:00:00.000Z'},7)).rejects.toThrow('CONCURRENT_UPDATE');
    await expect(MaterialDensityService.transition(8,2,'approved',review,7)).rejects.toThrow('NOT_FOUND');expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('locks before reading, changes lifecycle only and records a version CAS',async()=>{
    const {row,tx}=fixture();await MaterialDensityService.transition(9,2,'approved',{expectedUpdatedAt:row.updatedAt.toISOString(),reason:'verified'},7);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.materialDensityRevision.findUnique.mock.invocationCallOrder[0]);
    const {data,where}=tx.materialDensityRevision.updateMany.mock.calls[0][0];expect(where).toEqual({id:2,status:'draft',updatedAt:row.updatedAt});
    expect(Object.keys(data).sort()).toEqual(['status','updatedAt','approvedBy','approvedAt','reviewReason'].sort());expect(data.approvedBy).toBe(7);expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('can retire after material blocking without rewriting source values',async()=>{
    const {row,tx}=fixture({status:'approved'});await MaterialDensityService.transition(9,2,'retired',{expectedUpdatedAt:row.updatedAt.toISOString(),reason:'superseded'},7);
    expect(tx.material.findUnique).not.toHaveBeenCalled();const {data}=tx.materialDensityRevision.updateMany.mock.calls[0][0];expect(data.densityKgPerL).toBeUndefined();expect(data.approvedBy).toBeUndefined();
  });
  it('rejects failed CAS and repeat lifecycle changes without audit',async()=>{
    const {row,tx}=fixture();tx.materialDensityRevision.updateMany.mockResolvedValue({count:0});await expect(MaterialDensityService.transition(9,2,'approved',{expectedUpdatedAt:row.updatedAt.toISOString(),reason:'x'},7)).rejects.toThrow('CONCURRENT_UPDATE');expect(tx.auditLog.create).not.toHaveBeenCalled();
    const other=fixture({status:'retired'});await expect(MaterialDensityService.transition(9,2,'retired',{expectedUpdatedAt:row.updatedAt.toISOString(),reason:'x'},7)).rejects.toThrow('STATE_INVALID');expect(other.tx.auditLog.create).not.toHaveBeenCalled();
  });
});
