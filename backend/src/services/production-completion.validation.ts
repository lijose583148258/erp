type ProductionCompletionIssueType =
  | 'missing_material'
  | 'unit_mismatch'
  | 'quantity_under'
  | 'quantity_over';

export type ProductionCompletionIssue = {
  type: ProductionCompletionIssueType;
  severity: 'blocking' | 'approval_required';
  material: string;
  expected?: number;
  actual?: number;
  unit?: string;
  toleranceRate?: number;
  message: string;
};

export class ProductionCompletionValidationError extends Error {
  issues: ProductionCompletionIssue[];

  constructor(issues: ProductionCompletionIssue[]) {
    super(issues.map(issue => issue.message).join('; '));
    this.name = 'ProductionCompletionValidationError';
    this.issues = issues;
  }
}

type BomValidationItem = {
  id?: number | null;
  materialCode?: string | null;
  materialName?: string | null;
  ingredientRole?: string | null;
  dosageMode?: string | null;
  quantityPerUnit?: number | null;
  unit?: string | null;
  lossRate?: number | null;
  allowedVarianceRate?: number | string | null;
  substituteGroup?: string | null;
};

type StockValidationSnapshot = {
  productName?: string | null;
  batchNo?: string | null;
  unit?: string | null;
  locationId?: number | null;
};

const DEFAULT_CONSUMPTION_TOLERANCE_RATE = 0.08;
const ROLE_TOLERANCE_RATE: Record<string, number> = {
  main_resin: 0.03,
  base_resin: 0.03,
  resin: 0.03,
  curing_agent: 0.02,
  hardener: 0.02,
  catalyst: 0.02,
  initiator: 0.02,
  additive: 0.05,
  filler: 0.05,
  pigment: 0.05,
  solvent: 0.05,
  packaging: 0,
  container: 0,
  label: 0,
};

const normalizeMaterialToken = (value: unknown) => String(value ?? '').trim().toLowerCase();
const normalizeUnitToken = (value: unknown) => String(value ?? '').trim().toLowerCase();
const toPositiveNumber = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const materialTokenMatches = (left: string, right: string) => {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 3 && right.includes(left)) return true;
  if (right.length >= 3 && left.includes(right)) return true;
  return false;
};

const getMaterialLabel = (item: BomValidationItem) => String(item.materialCode || item.materialName || `BOM item ${item.id}`);

const getToleranceRateForBomItem = (item: BomValidationItem) => {
  if (item.allowedVarianceRate === null || item.allowedVarianceRate === undefined || item.allowedVarianceRate === '') {
    const role = normalizeMaterialToken(item.ingredientRole);
    if (role && ROLE_TOLERANCE_RATE[role] !== undefined) {
      return ROLE_TOLERANCE_RATE[role];
    }
    return DEFAULT_CONSUMPTION_TOLERANCE_RATE;
  }

  const rowRate = Number(item.allowedVarianceRate);
  if (Number.isFinite(rowRate) && rowRate >= 0) {
    return rowRate > 1 ? rowRate / 100 : rowRate;
  }

  const role = normalizeMaterialToken(item.ingredientRole);
  if (role && ROLE_TOLERANCE_RATE[role] !== undefined) {
    return ROLE_TOLERANCE_RATE[role];
  }
  return DEFAULT_CONSUMPTION_TOLERANCE_RATE;
};

const bomItemMatchesStock = (bomItem: BomValidationItem, stock: StockValidationSnapshot | null | undefined) => {
  const itemTokens = [
    normalizeMaterialToken(bomItem.materialCode),
    normalizeMaterialToken(bomItem.materialName),
  ].filter(Boolean);
  const stockTokens = [
    normalizeMaterialToken(stock?.productName),
    normalizeMaterialToken(stock?.batchNo),
  ].filter(Boolean);

  return itemTokens.some(itemToken =>
    stockTokens.some(stockToken => materialTokenMatches(itemToken, stockToken)),
  );
};

export const assertBomConsumptionCoverage = (
  bomItems: BomValidationItem[],
  consumptionRecords: Array<{ stock: StockValidationSnapshot | null; quantity: number }>,
  outputQuantity: number,
) => {
  const activeBomItems = (bomItems || []).filter(item => Number(item.quantityPerUnit || 0) > 0);
  if (activeBomItems.length === 0) {
    return;
  }

  const consumedStocks = consumptionRecords
    .filter(record => Number(record.quantity || 0) > 0)
    .map(record => record.stock);

  const issues: ProductionCompletionIssue[] = [];
  const substituteGroups = new Map<string, BomValidationItem[]>();

  const assertQuantityReasonable = (item: BomValidationItem, matchedRecords: Array<{ stock: StockValidationSnapshot | null; quantity: number }>, label: string) => {
    const dosageMode = String(item.dosageMode || '').trim();
    if (dosageMode === 'percentage') {
      return;
    }

    const expectedBase = toPositiveNumber(item.quantityPerUnit) * outputQuantity;
    if (expectedBase <= 0) {
      return;
    }

    const itemUnit = normalizeUnitToken(item.unit);
    const mismatchedUnit = matchedRecords.find(record => normalizeUnitToken(record.stock?.unit) !== itemUnit);
    if (mismatchedUnit) {
      issues.push({
        type: 'unit_mismatch',
        severity: 'blocking',
        material: label,
        unit: item.unit || undefined,
        message: `${label} unit mismatch: BOM expects ${item.unit}, stock ${mismatchedUnit.stock?.batchNo || mismatchedUnit.stock?.productName} uses ${mismatchedUnit.stock?.unit || 'unknown'}`,
      });
      return;
    }

    const expected = expectedBase * (1 + Number(item.lossRate || 0) / 100);
    const actual = matchedRecords.reduce((sum, record) => sum + Number(record.quantity || 0), 0);
    const toleranceRate = getToleranceRateForBomItem(item);
    const tolerance = Math.max(expected * toleranceRate, 0.001);

    if (actual + tolerance < expected) {
      issues.push({
        type: 'quantity_under',
        severity: toleranceRate <= 0.03 ? 'blocking' : 'approval_required',
        material: label,
        expected,
        actual,
        unit: item.unit || undefined,
        toleranceRate,
        message: `${label} consumption is below expected: expected ${expected.toFixed(3)} ${item.unit}, actual ${actual.toFixed(3)} ${item.unit}, tolerance ${(toleranceRate * 100).toFixed(0)}%`,
      });
    } else if (actual - tolerance > expected) {
      issues.push({
        type: 'quantity_over',
        severity: toleranceRate <= 0.03 ? 'blocking' : 'approval_required',
        material: label,
        expected,
        actual,
        unit: item.unit || undefined,
        toleranceRate,
        message: `${label} consumption is above expected: expected ${expected.toFixed(3)} ${item.unit}, actual ${actual.toFixed(3)} ${item.unit}, tolerance ${(toleranceRate * 100).toFixed(0)}%`,
      });
    }
  };

  for (const item of activeBomItems) {
    const substituteGroup = String(item.substituteGroup || '').trim();
    if (substituteGroup) {
      const groupItems = substituteGroups.get(substituteGroup) || [];
      groupItems.push(item);
      substituteGroups.set(substituteGroup, groupItems);
      continue;
    }

    const matchedRecords = consumptionRecords.filter(record => bomItemMatchesStock(item, record.stock));
    const covered = matchedRecords.length > 0;
    if (!covered) {
      const label = getMaterialLabel(item);
      issues.push({
        type: 'missing_material',
        severity: 'blocking',
        material: label,
        message: `${label} has no confirmed consumption record`,
      });
    } else {
      assertQuantityReasonable(item, matchedRecords, getMaterialLabel(item));
    }
  }

  for (const [groupName, groupItems] of substituteGroups.entries()) {
    const coveredItem = groupItems.find(item => consumedStocks.some(stock => bomItemMatchesStock(item, stock)));
    const covered = Boolean(coveredItem);
    if (!covered) {
      issues.push({
        type: 'missing_material',
        severity: 'blocking',
        material: `substitute group ${groupName}`,
        message: `Substitute group ${groupName} has no confirmed consumption record`,
      });
    } else if (coveredItem) {
      const matchedRecords = consumptionRecords.filter(record => bomItemMatchesStock(coveredItem, record.stock));
      assertQuantityReasonable(coveredItem, matchedRecords, `substitute group ${groupName}`);
    }
  }

  const blockingIssues = issues.filter(issue => issue.severity === 'blocking');
  if (blockingIssues.length > 0) {
    throw new ProductionCompletionValidationError(blockingIssues);
  }

  const approvalIssues = issues.filter(issue => issue.severity === 'approval_required');
  if (approvalIssues.length > 0) {
    throw new ProductionCompletionValidationError(approvalIssues);
  }
};
