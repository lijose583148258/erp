import { MASS_PERCENTAGE_V1, assertMassSnapshotV1 } from '../domain/production-mass-basis';
// This is a dimensional safety gate, NOT a conversion engine. Fixed dosage is
// explicitly input-unit / output-unit; percentage is currently mass / mass only.
const unitToken = (value: unknown) => String(value ?? '').trim().toLowerCase();
const massUnits = new Set(['mg', 'g', 'kg', 't', '毫克', '克', '千克', '公斤', '吨']);

type BomUnitDefinition = {
  outputUnit: string;
  items?: Array<{ unit: string; dosageMode?: string | null; percentage?: number | null; quantityPerUnit?: number | null }>;
};

export const assertBomOutputUnit = (submitted: string, canonical: string) => {
  if (!unitToken(submitted) || unitToken(submitted) !== unitToken(canonical)) {
    throw new Error(`BOM_UNIT_OUTPUT_MISMATCH:输出单位 ${submitted} 与物料主单位 ${canonical} 不一致；禁止仅改单位而不换算单耗`);
  }
};

export const assertBomPercentageUnits = (bom: BomUnitDefinition) => {
  for (const [index, item] of (bom.items || []).entries()) {
    const mode = String(item.dosageMode || '').trim();
    if (mode === MASS_PERCENTAGE_V1) { assertMassSnapshotV1(item, bom.outputUnit); continue; }
    if (mode.startsWith('mass_percentage')) throw new Error('BOM_UNIT_MASS_VERSION_UNSUPPORTED:未知的质量换算规则版本');
    if (mode !== 'percentage') continue;
    const output = unitToken(bom.outputUnit);
    if (!massUnits.has(output) || unitToken(item.unit) !== output) {
      throw new Error(`BOM_UNIT_PERCENTAGE_BASIS_REQUIRED:第 ${index + 1} 行百分比仅支持与输出相同的质量单位；${item.unit}/${bom.outputUnit} 尚无受控换算依据，请使用已核定的固定单耗`);
    }
  }
};
