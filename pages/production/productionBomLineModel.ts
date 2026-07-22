export type BomItemDraft = {
  materialName: string;
  materialCode: string;
  ingredientRole: string;
  dosageMode: string;
  percentage: string;
  quantityPerUnit: string;
  unit: string;
  lossRate: string;
  allowedVarianceRate: string;
  processStage: string;
  substituteGroup: string;
  yieldContribution: string;
  notes: string;
  availableStock?: string;
  lockedStock?: string;
  unitCost?: string;
  currency?: string;
};

export const CHEMICAL_ROLE_OPTIONS = [
  { value: 'main_resin', label: '主树脂' },
  { value: 'modifier_resin', label: '改性树脂' },
  { value: 'tackifier', label: '增粘剂' },
  { value: 'curing_agent', label: '固化剂' },
  { value: 'crosslinker', label: '交联剂' },
  { value: 'solvent', label: '溶剂' },
  { value: 'diluent', label: '稀释剂/水' },
  { value: 'pigment', label: '颜填料' },
  { value: 'surfactant', label: '润湿/分散剂' },
  { value: 'defoamer', label: '消泡剂' },
  { value: 'thickener', label: '增稠/流变剂' },
  { value: 'preservative', label: '防腐/稳定剂' },
  { value: 'ph_adjuster', label: 'pH调节剂' },
  { value: 'catalyst', label: '催化/引发剂' },
  { value: 'additive', label: '助剂' },
  { value: 'recycled', label: '回用料' },
  { value: 'package', label: '包材' },
  { value: 'other', label: '其他' },
] as const;
export const DOSAGE_MODE_OPTIONS = [
  { value: 'fixed', label: '固定单耗' },
  { value: 'percentage', label: '按百分比' },
] as const;
type ChemicalRoleValue = (typeof CHEMICAL_ROLE_OPTIONS)[number]['value'];
type DosageModeValue = (typeof DOSAGE_MODE_OPTIONS)[number]['value'];
const ROLE_VALUE_SET = new Set(CHEMICAL_ROLE_OPTIONS.map((option) => option.value));
const DOSAGE_VALUE_SET = new Set(DOSAGE_MODE_OPTIONS.map((option) => option.value));
const ROLE_VALUE_ALIASES: Record<string, ChemicalRoleValue> = {
  主树脂: 'main_resin',
  改性树脂: 'modifier_resin',
  增粘剂: 'tackifier',
  增粘树脂: 'tackifier',
  固化剂: 'curing_agent',
  交联剂: 'crosslinker',
  溶剂: 'solvent',
  稀释剂: 'diluent',
  水: 'diluent',
  颜填料: 'pigment',
  颜料: 'pigment',
  填料: 'pigment',
  润湿剂: 'surfactant',
  分散剂: 'surfactant',
  表面活性剂: 'surfactant',
  消泡剂: 'defoamer',
  增稠剂: 'thickener',
  流变剂: 'thickener',
  防腐剂: 'preservative',
  稳定剂: 'preservative',
  pH调节剂: 'ph_adjuster',
  酸碱调节: 'ph_adjuster',
  催化剂: 'catalyst',
  引发剂: 'catalyst',
  助剂: 'additive',
  回用料: 'recycled',
  包材: 'package',
  包装: 'package',
  其他: 'other',
};
const DOSAGE_VALUE_ALIASES: Record<string, DosageModeValue> = {
  固定: 'fixed',
  固定单耗: 'fixed',
  固定量: 'fixed',
  百分比: 'percentage',
  按百分比: 'percentage',
};
export const normalizeRoleValue = (value?: string): ChemicalRoleValue => {
  const raw = (value || '').trim();
  if (!raw) return 'other';
  if (ROLE_VALUE_SET.has(raw as ChemicalRoleValue)) return raw as ChemicalRoleValue;
  const alias = ROLE_VALUE_ALIASES[raw];
  return alias || 'other';
};
export const normalizeDosageValue = (value?: string): DosageModeValue => {
  const raw = (value || '').trim();
  if (!raw) return 'fixed';
  if (DOSAGE_VALUE_SET.has(raw as DosageModeValue)) return raw as DosageModeValue;
  const alias = DOSAGE_VALUE_ALIASES[raw];
  return alias || 'fixed';
};
export const createEmptyItem = (): BomItemDraft => ({
  materialName: '',
  materialCode: '',
  ingredientRole: 'other',
  dosageMode: 'fixed',
  percentage: '',
  quantityPerUnit: '',
  unit: 'kg',
  lossRate: '',
  allowedVarianceRate: '',
  processStage: '',
  substituteGroup: '',
  yieldContribution: '',
  notes: '',
});
export const GLUE_FORMULA_SKELETON: BomItemDraft[] = [
  { ...createEmptyItem(), ingredientRole: 'main_resin', processStage: '预混', notes: '主体成膜/粘结原料，填写具体牌号' },
  { ...createEmptyItem(), ingredientRole: 'modifier_resin', processStage: '预混', notes: '改性树脂或共聚体系，按实际配方填写' },
  { ...createEmptyItem(), ingredientRole: 'tackifier', processStage: '预混', notes: '提升初粘/持粘，若不用可留空' },
  { ...createEmptyItem(), ingredientRole: 'diluent', processStage: '稀释', notes: '水、溶剂或活性稀释剂' },
  { ...createEmptyItem(), ingredientRole: 'curing_agent', processStage: '后添加', notes: '固化剂，注意适用期和投料时点' },
  { ...createEmptyItem(), ingredientRole: 'crosslinker', processStage: '后添加', notes: '交联剂，可与固化剂分开管理' },
  { ...createEmptyItem(), ingredientRole: 'pigment', processStage: '分散', notes: '填料/颜料/粉体，关注分散和沉降' },
  { ...createEmptyItem(), ingredientRole: 'surfactant', processStage: '分散', notes: '润湿、分散或乳化助剂' },
  { ...createEmptyItem(), ingredientRole: 'defoamer', processStage: '调漆', notes: '消泡剂，通常小比例后添加' },
  { ...createEmptyItem(), ingredientRole: 'thickener', processStage: '调粘', notes: '增稠/流变控制，影响施工手感' },
];
export const getPasteLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim().length > 0);
export const toFiniteNumber = (value: string | number | null | undefined) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
export const formatDecimal = (value: number, precision = 6) => {
  if (!Number.isFinite(value)) return '';
  return Number(value.toFixed(precision)).toString();
};
export const hasItemIdentity = (item: BomItemDraft) => Boolean(item.materialName.trim() || item.materialCode.trim());
export const getEffectiveBomQuantityPerUnit = (item: BomItemDraft) => {
  const dosageMode = normalizeDosageValue(item.dosageMode);
  const percentageValue = toFiniteNumber(item.percentage);
  const rawQuantityPerUnit = toFiniteNumber(item.quantityPerUnit);
  if (dosageMode === 'percentage' && percentageValue > 0) {
    return getPerUnitFromPercentage(percentageValue);
  }
  return rawQuantityPerUnit;
};
export const isEffectiveBomItemDraft = (item: BomItemDraft) =>
  hasItemIdentity(item) && getEffectiveBomQuantityPerUnit(item) > 0;
export const cloneItem = (item: BomItemDraft): BomItemDraft => ({ ...item });
export const getPerUnitFromPercentage = (percentage: string | number | null | undefined) => {
  const percentageValue = toFiniteNumber(percentage);
  return percentageValue > 0 ? percentageValue / 100 : 0;
};
type NormalizedPasteQuantity = {
  value: string;
  notice?: string;
};
export const normalizePastedQuantityPerUnit = ({
  dosageMode,
  percentage,
  quantityPerUnit,
  standardBatchSize,
  unit,
}: {
  dosageMode: DosageModeValue;
  percentage: string;
  quantityPerUnit: string;
  standardBatchSize: number;
  unit: string;
}): NormalizedPasteQuantity => {
  const rawQuantity = toFiniteNumber(quantityPerUnit);
  const percentageValue = toFiniteNumber(percentage);
  if (dosageMode !== 'percentage' || percentageValue <= 0) {
    return { value: quantityPerUnit };
  }
  if (rawQuantity <= 0) {
    return { value: formatDecimal(getPerUnitFromPercentage(percentage)) };
  }
  const expectedBatchQuantity = standardBatchSize > 0 ? (standardBatchSize * percentageValue) / 100 : 0;
  const looksLikeBatchQuantity =
    expectedBatchQuantity > 0
    && rawQuantity > 1
    && Math.abs(rawQuantity - expectedBatchQuantity) <= Math.max(0.01, expectedBatchQuantity * 0.005);
  if (looksLikeBatchQuantity) {
    const value = formatDecimal(rawQuantity / standardBatchSize);
    return {
      value,
      notice: `已按标准批量 ${standardBatchSize}${unit || 'kg'} 换算为单位单耗 ${value}`,
    };
  }
  return { value: quantityPerUnit };
};

export type BomPasteImportResult = {
  importedItems: BomItemDraft[];
  conversionNotices: string[];
};

export const parseBomPasteText = (
  text: string,
  standardBatchSize: number,
): BomPasteImportResult => {
  const conversionNotices = new Set<string>();
  const importedItems = getPasteLines(text).map((line) => {
    const parts = line.split('\t').map((part) => part.trim());
    const dosageMode = normalizeDosageValue(parts[3]);
    const percentage = parts[4] || '';
    const unit = parts[6] || 'kg';
    const normalizedQuantity = normalizePastedQuantityPerUnit({
      dosageMode,
      percentage,
      quantityPerUnit: parts[5] || '',
      standardBatchSize,
      unit,
    });
    if (normalizedQuantity.notice) conversionNotices.add(normalizedQuantity.notice);
    return {
      materialName: parts[0] || '',
      materialCode: parts[1] || '',
      ingredientRole: normalizeRoleValue(parts[2]),
      dosageMode,
      percentage,
      quantityPerUnit: normalizedQuantity.value,
      unit,
      lossRate: parts[7] || '',
      allowedVarianceRate: parts[8] || '',
      processStage: parts[9] || '',
      substituteGroup: parts[10] || '',
      yieldContribution: parts[11] || '',
      notes: parts[12] || '',
    } satisfies BomItemDraft;
  });

  return {
    importedItems,
    conversionNotices: Array.from(conversionNotices),
  };
};
