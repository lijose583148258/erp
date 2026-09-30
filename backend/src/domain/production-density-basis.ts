import { densityPercentageQuantityV1 } from './production-mass-basis';

export const DENSITY_PERCENTAGE_V1 = 'density_percentage_v1';
export type DensityBasis = {
  rule: typeof DENSITY_PERCENTAGE_V1;
  revisionId: number;
  materialId: number;
  batchId: number;
  batchNo: string;
  baseUnit: string;
  specCode: string;
  version: string;
  densityKgPerL: string;
  temperatureC: string;
  pressureKpaAbs: string;
  compositionReference: string;
  methodReference: string;
  sourceReference: string;
  measuredAt: string;
  approvedBy: number;
  approvedAt: string;
};
export type WorkOrderDensityBasis = DensityBasis & { bomItemId: number; quantityPerUnit: number; inputUnit: string };
const densityError = (detail: string): never => { throw new Error('BOM_UNIT_DENSITY_SNAPSHOT_INVALID:'+detail); };
const decimal = (value: unknown, positive = false) => /^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(String(value ?? '').trim())
  && Number.isFinite(Number(value)) && (!positive || Number(value) > 0);

export function assertDensityBasis(value: DensityBasis, materialId?: number | null, inputUnit?: string) {
  if (value?.rule !== DENSITY_PERCENTAGE_V1 || !Number.isSafeInteger(value.revisionId) || value.revisionId < 1
    || !Number.isSafeInteger(value.materialId) || value.materialId < 1 || !Number.isSafeInteger(value.batchId) || value.batchId < 1
    || !value.batchNo?.trim() || !value.baseUnit?.trim() || !value.specCode?.trim() || !value.version?.trim()
    || !decimal(value.densityKgPerL, true) || !decimal(value.temperatureC) || !decimal(value.pressureKpaAbs, true)
    || !value.compositionReference?.trim() || !value.methodReference?.trim() || !value.sourceReference?.trim()
    || !Number.isFinite(Date.parse(value.measuredAt)) || !Number.isSafeInteger(value.approvedBy) || value.approvedBy < 1
    || !Number.isFinite(Date.parse(value.approvedAt)) || (materialId != null && materialId !== value.materialId)
    || (inputUnit != null && value.baseUnit.trim().toLowerCase() !== inputUnit.trim().toLowerCase())) densityError('完整的批准批次/条件快照缺失或不匹配');
  densityPercentageQuantityV1(100, value.baseUnit, 'kg', value.densityKgPerL);
}
export function parseDensityBasis(json: string | null | undefined): DensityBasis {
  try { const value=JSON.parse(json || 'null');assertDensityBasis(value);return value; }
  catch (error) { if (error instanceof Error && error.message.startsWith('BOM_UNIT_')) throw error; return densityError('无法读取批准批次密度快照'); }
}
export function parseWorkOrderDensityBases(json: string | null | undefined): WorkOrderDensityBasis[] {
  if (!json) return [];
  try {
    const values=JSON.parse(json);if(!Array.isArray(values)||values.length===0) densityError('工单密度快照必须为非空数组');
    const ids=new Set<number>();
    return values.map((value: WorkOrderDensityBasis)=>{if(!Number.isSafeInteger(value?.bomItemId)||value.bomItemId<1||ids.has(value.bomItemId)||!decimal(value.quantityPerUnit,true)||value.inputUnit!==value.baseUnit) densityError('工单密度快照行无效');ids.add(value.bomItemId);assertDensityBasis(value,value.materialId,value.inputUnit);return value;});
  } catch (error) { if(error instanceof Error&&error.message.startsWith('BOM_UNIT_'))throw error;return densityError('无法读取工单密度快照'); }
}
export function assertDensityBasisCurrent(snapshot: DensityBasis, current: DensityBasis) {
  assertDensityBasis(snapshot);assertDensityBasis(current,snapshot.materialId,snapshot.baseUnit);
  for (const key of ['revisionId','materialId','batchId','batchNo','baseUnit','specCode','version','densityKgPerL','temperatureC','pressureKpaAbs','compositionReference','methodReference','sourceReference','measuredAt','approvedBy','approvedAt'] as const) if(snapshot[key]!==current[key]) densityError('当前批准依据与已保存 BOM 快照不一致');
}
