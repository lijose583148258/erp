import { PACKAGING_PERCENTAGE_V1, parsePackagingBasis, assertPackagingBasis } from '../domain/production-packaging-basis';
import { packagingPercentageQuantityV1 } from '../domain/production-mass-basis';
import { MASS_PERCENTAGE_V1, assertMassSnapshotV1 } from '../domain/production-mass-basis';
// This is a dimensional safety gate, NOT a conversion engine. Fixed dosage is
// explicitly input-unit / output-unit; percentage is currently mass / mass only.
const unitToken = (value: unknown) => String(value ?? '').trim().toLowerCase();
const massUnits = new Set(['mg', 'g', 'kg', 't', '毫克', '克', '千克', '公斤', '吨']);

type BomUnitDefinition = {
  materialId?: number | null;
  packagingSnapshotJson?: string | null;
  packagingRevisionId?: number | null;
  outputUnit: string;
  items?: Array<{ materialId?: number | null; unit: string; dosageMode?: string | null; percentage?: number | null; quantityPerUnit?: number | null; lossRate?: number | null; allowedVarianceRate?: number | null; substituteGroup?: string | null }>;
};

export const assertBomOutputUnit = (submitted: string, canonical: string) => {
  if (!unitToken(submitted) || unitToken(submitted) !== unitToken(canonical)) {
    throw new Error(`BOM_UNIT_OUTPUT_MISMATCH:输出单位 ${submitted} 与物料主单位 ${canonical} 不一致；禁止仅改单位而不换算单耗`);
  }
};

export const assertBomPercentageUnits = (bom: BomUnitDefinition) => {
  const hasPackaging = (bom.items || []).some(i => i.dosageMode === PACKAGING_PERCENTAGE_V1);
  if (hasPackaging || bom.packagingSnapshotJson) {
    const basis = parsePackagingBasis(bom.packagingSnapshotJson);
    assertPackagingBasis(basis, bom.materialId, bom.outputUnit);
    if (bom.packagingRevisionId !== basis.revisionId) throw new Error('BOM_UNIT_PACKAGING_SNAPSHOT_INVALID:批准规格与冻结快照不一致');
    const ids = (bom.items || []).map(i=>i.materialId).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw new Error('BOM_UNIT_PACKAGING_DUPLICATE_MATERIAL:同一配方原料请合并为一行');
    if (!bom.items?.length) throw new Error('BOM_UNIT_PACKAGING_ROWS_REQUIRED');
    let total = 0n;
    for (const item of bom.items) {
      const percentage = String(item.percentage ?? '');
      if (item.dosageMode !== PACKAGING_PERCENTAGE_V1 || !/^\d+(?:\.\d{1,6})?$/.test(percentage)
        || Number(item.lossRate || 0) !== 0 || Number(item.allowedVarianceRate ?? 0) !== 0 || item.substituteGroup) {
        throw new Error('BOM_UNIT_PACKAGING_V1_SCOPE:包装 v1 要求所有行使用质量百分比、最多6位小数、零损耗/容差且不使用替代组');
      }
      const [whole, fraction = ''] = percentage.split('.'); total += BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6,'0'));
      if (item.quantityPerUnit !== packagingPercentageQuantityV1(item.percentage,item.unit,basis.netMass,basis.massUnit)) throw new Error('BOM_UNIT_PACKAGING_SNAPSHOT_MISMATCH');
    }
    if (total !== 100000000n) throw new Error('BOM_UNIT_PACKAGING_PERCENTAGE_TOTAL:包装配方质量占比必须恰好为100%');
  }
  for (const [index, item] of (bom.items || []).entries()) {
    const mode = String(item.dosageMode || '').trim();
    if (mode === PACKAGING_PERCENTAGE_V1) continue;
    if (mode.startsWith('packaging_percentage')) throw new Error('BOM_UNIT_PACKAGING_VERSION_UNSUPPORTED');
    if (mode === MASS_PERCENTAGE_V1) { assertMassSnapshotV1(item, bom.outputUnit); continue; }
    if (mode.startsWith('mass_percentage')) throw new Error('BOM_UNIT_MASS_VERSION_UNSUPPORTED:未知的质量换算规则版本');
    if (mode !== 'percentage') continue;
    const output = unitToken(bom.outputUnit);
    if (!massUnits.has(output) || unitToken(item.unit) !== output) {
      throw new Error(`BOM_UNIT_PERCENTAGE_BASIS_REQUIRED:第 ${index + 1} 行百分比仅支持与输出相同的质量单位；${item.unit}/${bom.outputUnit} 尚无受控换算依据，请使用已核定的固定单耗`);
    }
  }
};
