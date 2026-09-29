import { packagingPercentageQuantityV1 } from './production-mass-basis';

export const PACKAGING_PERCENTAGE_V1 = 'packaging_percentage_v1';
export type PackagingBasis = {
  rule: typeof PACKAGING_PERCENTAGE_V1;
  revisionId: number;
  materialId: number;
  specCode: string;
  version: string;
  packageUnit: string;
  netMass: string;
  massUnit: string;
  sourceReference: string;
  approvedBy: number;
  approvedAt: string;
};
export const packagingUnits = ['桶', '袋', '罐', '瓶', 'drum', 'bag', 'can', 'bottle'] as const;
export function assertPackagingBasis(value: PackagingBasis, materialId?: number | null, outputUnit?: string) {
  if (value?.rule !== PACKAGING_PERCENTAGE_V1 || !Number.isSafeInteger(value.revisionId) || value.revisionId < 1
    || !Number.isSafeInteger(value.materialId) || value.materialId < 1 || !value.specCode?.trim() || !value.version?.trim()
    || !value.sourceReference?.trim() || !Number.isSafeInteger(value.approvedBy) || value.approvedBy < 1
    || !Number.isFinite(Date.parse(value.approvedAt)) || !packagingUnits.includes(value.packageUnit as typeof packagingUnits[number])
    || (materialId != null && materialId !== value.materialId) || (outputUnit != null && outputUnit !== value.packageUnit)) {
    throw new Error('BOM_UNIT_PACKAGING_SNAPSHOT_INVALID:包装换算缺少完整且匹配的批准版本快照');
  }
  packagingPercentageQuantityV1(100, value.massUnit, value.netMass, value.massUnit);
}
export function parsePackagingBasis(json: string | null | undefined): PackagingBasis {
  try { const value = JSON.parse(json || 'null'); assertPackagingBasis(value); return value; }
  catch { throw new Error('BOM_UNIT_PACKAGING_SNAPSHOT_INVALID:包装换算缺少完整批准快照'); }
}
// The v1 net-mass check must be required and exact; a client cannot omit QC
// or make it optional while using the governed packaging conversion.
export function assertPackagingQuality(basis: PackagingBasis, characteristics: Array<{ valueType?: string; required?: boolean; unit?: string | null; lowerLimit?: unknown; upperLimit?: unknown }> = []) {
  const match = characteristics.some(c => c.required !== false && (c.valueType || 'numeric') === 'numeric' && c.unit === basis.massUnit
    && c.lowerLimit != null && c.upperLimit != null && String(c.lowerLimit).trim() !== '' && String(c.upperLimit).trim() !== ''
    && Number(c.lowerLimit) === Number(basis.netMass) && Number(c.upperLimit) === Number(basis.netMass));
  if (!match) throw new Error('BOM_UNIT_PACKAGING_QC_REQUIRED:包装 v1 必须具有必检净质量项目，上下限均为批准净量');
}
export function assertWholePackages(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('BOM_UNIT_WHOLE_PACKAGES_REQUIRED:包装换算 v1 仅支持正整数整包装，不支持拆零');
}
export default { PACKAGING_PERCENTAGE_V1, packagingUnits, assertPackagingBasis, parsePackagingBasis, assertPackagingQuality, assertWholePackages };
