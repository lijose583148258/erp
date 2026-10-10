import { packagingPercentageQuantityV1 } from './production-mass-basis';
import { PACKAGING_PERCENTAGE_V1, assertWholePackages, parsePackagingBasis, assertPackagingQuality, type PackagingBasis } from './production-packaging-basis';
import { assertBomPercentageUnits } from '../services/production-unit-safety.service';
import { createPackagingRevisionSchema } from '../validators/material-packaging';

const basis: PackagingBasis = { rule: PACKAGING_PERCENTAGE_V1, revisionId: 2, materialId: 9, specCode: 'DRUM-20', version: 'v1', packageUnit: '桶', netMass: '20', massUnit: 'kg', sourceReference: 'SPEC-2026-01', approvedBy: 7, approvedAt: '2026-09-29T00:00:00.000Z' };
const item = { dosageMode: PACKAGING_PERCENTAGE_V1, percentage: 100, quantityPerUnit: 20, unit: 'kg', lossRate: 0, allowedVarianceRate: 0 };
const bom = { materialId: 9, packagingRevisionId: 2, outputUnit: '桶', packagingSnapshotJson: JSON.stringify(basis), items: [item] };
describe('governed packaging v1 dimensional contract', () => {
  it.each([[100,'kg','20','kg',20],[35,'g','20','kg',7000],[100,'t','20','kg',0.02],[1,'kg','1000000','mg',0.01]])('computes %s%% %s with %s %s per package', (p,unit,mass,massUnit,expected) => {
    expect(packagingPercentageQuantityV1(p,String(unit),mass,String(massUnit))).toBe(expected);
  });
  it.each(['L','桶','constructor','__proto__'])('rejects non-mass raw unit %s',unit=>expect(()=>packagingPercentageQuantityV1(100,unit,20,'kg')).toThrow('MASS_BASIS_REQUIRED'));
  it('never silently rounds micro quantities',()=>expect(()=>packagingPercentageQuantityV1(1,'t','0.000001','mg')).toThrow('PRECISION_UNSUPPORTED'));
  it.each([0,0.5,1.2,-1,Infinity,Number.MAX_SAFE_INTEGER+1])('rejects broken packages %s',n=>expect(()=>assertWholePackages(n)).toThrow('WHOLE_PACKAGES_REQUIRED'));
  it('validates frozen provenance and exact dosage',()=>{
    expect(()=>assertBomPercentageUnits(bom)).not.toThrow();
    expect(()=>assertBomPercentageUnits({...bom,outputUnit:'袋'})).toThrow('SNAPSHOT_INVALID');
    expect(()=>assertBomPercentageUnits({...bom,materialId:10})).toThrow('SNAPSHOT_INVALID');
    expect(()=>assertBomPercentageUnits({...bom,items:[{...item,quantityPerUnit:1}]})).toThrow('SNAPSHOT_MISMATCH');
    expect(()=>parsePackagingBasis(JSON.stringify({...basis,sourceReference:''}))).toThrow('SNAPSHOT_INVALID');
    expect(()=>parsePackagingBasis('null')).toThrow('SNAPSHOT_INVALID');
  });
  it('requires a complete 100% mass formula without mixed semantics, loss or tolerance',()=>{
    for(const patch of [{dosageMode:'fixed'},{lossRate:1},{allowedVarianceRate:0.1},{substituteGroup:'x'}]) expect(()=>assertBomPercentageUnits({...bom,items:[{...item,...patch}]})).toThrow('PACKAGING_V1_SCOPE');
    expect(()=>assertBomPercentageUnits({...bom,items:[{...item,percentage:50,quantityPerUnit:10}]})).toThrow('PERCENTAGE_TOTAL');
    expect(()=>assertBomPercentageUnits({...bom,packagingSnapshotJson:null})).toThrow('SNAPSHOT_INVALID');
    expect(()=>assertBomPercentageUnits({outputUnit:'桶',items:[{...item,dosageMode:'packaging_percentage_v2'}]})).toThrow('VERSION_UNSUPPORTED');
  });
  it('accepts only explicit sourced positive net mass; no client approval fields',()=>{
    const value={specCode:'DRUM',version:'v1',packageUnit:'桶',netMass:'20.000001',massUnit:'kg',sourceReference:'DOC-1'};
    expect(createPackagingRevisionSchema.safeParse(value).success).toBe(true);
    for(const patch of [{sourceReference:''},{netMass:'0'},{netMass:'1e2'},{netMass:'0.0000001'},{status:'approved'},{approvedBy:1},{massUnit:'L'}]) expect(createPackagingRevisionSchema.safeParse({...value,...patch}).success).toBe(false);
  });
});

it('requires an exact mandatory net-mass QC characteristic, not merely a UI default',()=>{
  const qc={valueType:'numeric',unit:'kg',required:true,lowerLimit:'20',upperLimit:'20'};
  expect(()=>assertPackagingQuality(basis,[qc])).not.toThrow();
  expect(()=>assertPackagingQuality(basis,[])).toThrow('QC_REQUIRED');
  for(const patch of [{required:false},{unit:'L'},{lowerLimit:19},{upperLimit:21},{lowerLimit:null},{valueType:'text'}]) expect(()=>assertPackagingQuality(basis,[{...qc,...patch}])).toThrow('QC_REQUIRED');
});
