import { PACKAGING_PERCENTAGE_V1, parsePackagingBasis, assertPackagingBasis } from '../domain/production-packaging-basis';
import { packagingPercentageQuantityV1 } from '../domain/production-mass-basis';
import { MASS_PERCENTAGE_V1, assertMassSnapshotV1, densityPercentageQuantityV1 } from '../domain/production-mass-basis';
import { DENSITY_PERCENTAGE_V1, assertDensityBasis, parseDensityBasis } from '../domain/production-density-basis';
// Dimensional safety gate. Fixed dosage is input-unit / output-unit; mass, packaging, and density conversion modes each have independently frozen evidence.
const unitToken = (value: unknown) => String(value ?? '').trim().toLowerCase();
const massUnits = new Set(['mg', 'g', 'kg', 't', '毫克', '克', '千克', '公斤', '吨']);

type BomUnitDefinition = {
  materialId?: number | null;
  packagingSnapshotJson?: string | null;
  packagingRevisionId?: number | null;
  outputUnit: string;
  items?: Array<{ materialId?: number | null; unit: string; dosageMode?: string | null; percentage?: number | null; quantityPerUnit?: number | null; lossRate?: number | null; allowedVarianceRate?: number | null; substituteGroup?: string | null; densityRevisionId?: number | null; densitySnapshotJson?: string | null }>;
};

export const assertBomOutputUnit = (submitted: string, canonical: string) => {
  if (!unitToken(submitted) || unitToken(submitted) !== unitToken(canonical)) {
    throw new Error(`BOM_UNIT_OUTPUT_MISMATCH:输出单位 ${submitted} 与物料主单位 ${canonical} 不一致；禁止仅改单位而不换算单耗`);
  }
};

const percentageMicros = (value: unknown) => {
  const text=String(value ?? '');if(!/^\d+(?:\.\d{1,6})?$/.test(text)) throw new Error('BOM_UNIT_DENSITY_V1_SCOPE:密度换算百分比最多 6 位小数');
  const [whole,decimal='']=text.split('.');return BigInt(whole)*1000000n+BigInt(decimal.padEnd(6,'0'));
};

export const assertBomPercentageUnits = (bom: BomUnitDefinition) => {
  const hasPackaging = (bom.items || []).some(i => i.dosageMode === PACKAGING_PERCENTAGE_V1);
  const densityItems = (bom.items || []).filter(i => i.dosageMode === DENSITY_PERCENTAGE_V1);
  if (densityItems.length) {
    if (densityItems.length !== 1 || (bom.items || []).length !== densityItems.length || (bom.items || []).some(i => i.dosageMode === PACKAGING_PERCENTAGE_V1)) {
      throw new Error('BOM_UNIT_DENSITY_V1_SCOPE:密度换算 v1 仅支持一条冻结批次依据，不能混用其他配方行或包装换算');
    }
    let total = 0n;
    for (const item of densityItems) {
      if (!item.materialId || !item.densityRevisionId || Number(item.lossRate || 0) !== 0 || Number(item.allowedVarianceRate ?? 0) !== 0 || item.substituteGroup) {
        throw new Error('BOM_UNIT_DENSITY_V1_SCOPE:密度换算 v1 要求物料/批准依据、零损耗/容差且无替代组');
      }
      const basis=parseDensityBasis(item.densitySnapshotJson);assertDensityBasis(basis,item.materialId,item.unit);
      if (basis.revisionId !== item.densityRevisionId || Number(item.quantityPerUnit) !== densityPercentageQuantityV1(item.percentage,item.unit,bom.outputUnit,basis.densityKgPerL)) {
        throw new Error('BOM_UNIT_DENSITY_SNAPSHOT_MISMATCH:冻结密度依据与单耗不一致');
      }
      total += percentageMicros(item.percentage);
    }
    if(total!==100000000n) throw new Error('BOM_UNIT_DENSITY_PERCENTAGE_TOTAL:密度换算配方质量占比必须恰好为100%');
  }
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
    if (mode === PACKAGING_PERCENTAGE_V1 || mode === DENSITY_PERCENTAGE_V1) continue;
    if (mode.startsWith('packaging_percentage')) throw new Error('BOM_UNIT_PACKAGING_VERSION_UNSUPPORTED');
    if (mode.startsWith('density_percentage')) throw new Error('BOM_UNIT_DENSITY_VERSION_UNSUPPORTED:未知的密度换算规则版本');
    if (mode === MASS_PERCENTAGE_V1) { assertMassSnapshotV1(item, bom.outputUnit); continue; }
    if (mode.startsWith('mass_percentage')) throw new Error('BOM_UNIT_MASS_VERSION_UNSUPPORTED:未知的质量换算规则版本');
    if (mode !== 'percentage') continue;
    const output = unitToken(bom.outputUnit);
    if (!massUnits.has(output) || unitToken(item.unit) !== output) {
      throw new Error(`BOM_UNIT_PERCENTAGE_BASIS_REQUIRED:第 ${index + 1} 行百分比仅支持与输出相同的质量单位；${item.unit}/${bom.outputUnit} 尚无受控换算依据，请使用已核定的固定单耗`);
    }
  }
};
