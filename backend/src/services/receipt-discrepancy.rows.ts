import type {
  ReceiptDiscrepancyAction,
  ReceiptDiscrepancyCase,
  ReceiptToleranceRule,
} from './receipt-discrepancy.types';
import {
  VALID_COUNTERPARTIES,
  VALID_DISCREPANCY_ACTION_STATUSES,
  VALID_DISCREPANCY_ACTION_TYPES,
  VALID_DISCREPANCY_TYPES,
  VALID_MODULES,
  VALID_SOURCE_TYPES,
  VALID_STATUSES,
  VALID_TOLERANCE_ACTIONS,
  VALID_TOLERANCE_COUNTERPARTIES,
  VALID_TOLERANCE_DISCREPANCY_TYPES,
  VALID_TOLERANCE_SOURCE_TYPES,
} from './receipt-discrepancy.policy';

export type RawRow = Record<string, unknown>;

const toNullableNumber = (value: unknown) => value === null || value === undefined ? null : Number(value);
const toNullableString = (value: unknown) => value === null || value === undefined || value === '' ? null : String(value);
const toRowString = (value: unknown, fallback = '') => value === null || value === undefined ? fallback : String(value);
const toRowBoolean = (value: unknown) => value === true || Number(value || 0) === 1;
const normalizeEnumValue = <T extends string>(value: unknown, valid: ReadonlySet<T>, fallback: T): T => {
  const candidate = String(value || '').trim() as T;
  return valid.has(candidate) ? candidate : fallback;
};

export const normalizeCaseRow = (row: RawRow): ReceiptDiscrepancyCase => ({
  id: Number(row.id),
  caseNo: toRowString(row.caseNo),
  sourceType: normalizeEnumValue(row.sourceType, VALID_SOURCE_TYPES, 'purchase_receipt'),
  sourceRef: toRowString(row.sourceRef),
  sourceId: toNullableNumber(row.sourceId),
  relatedModule: normalizeEnumValue(row.relatedModule, VALID_MODULES, 'procurement'),
  relatedId: Number(row.relatedId),
  businessRef: toNullableString(row.businessRef),
  counterpartyType: normalizeEnumValue(row.counterpartyType, VALID_COUNTERPARTIES, 'supplier'),
  counterpartyId: toNullableNumber(row.counterpartyId),
  counterpartyName: toNullableString(row.counterpartyName),
  productName: toRowString(row.productName),
  quantity: Number(row.quantity || 0),
  unit: toRowString(row.unit, 'kg'),
  discrepancyType: normalizeEnumValue(row.discrepancyType, VALID_DISCREPANCY_TYPES, 'other'),
  reason: toRowString(row.reason),
  severity: toRowString(row.severity, 'normal'),
  status: normalizeEnumValue(row.status, VALID_STATUSES, 'pending'),
  toleranceRuleId: toNullableNumber(row.toleranceRuleId),
  toleranceAction: normalizeEnumValue(row.toleranceAction, VALID_TOLERANCE_ACTIONS, 'manual_review'),
  tolerancePercent: toNullableNumber(row.tolerancePercent),
  toleranceQuantity: toNullableNumber(row.toleranceQuantity),
  varianceRate: toNullableNumber(row.varianceRate),
  withinTolerance: toRowBoolean(row.withinTolerance),
  requiresQualityCheck: toRowBoolean(row.requiresQualityCheck),
  suggestedAction: toNullableString(row.suggestedAction),
  resolution: toNullableString(row.resolution),
  actionRef: toNullableString(row.actionRef),
  note: toNullableString(row.note),
  createdBy: toNullableNumber(row.createdBy),
  resolvedBy: toNullableNumber(row.resolvedBy),
  resolvedAt: toNullableString(row.resolvedAt),
  createdAt: toRowString(row.createdAt),
  updatedAt: toRowString(row.updatedAt),
});

export const CASE_SELECT_SQL = `
  SELECT
    id,
    case_no AS caseNo,
    source_type AS sourceType,
    source_ref AS sourceRef,
    source_id AS sourceId,
    related_module AS relatedModule,
    related_id AS relatedId,
    business_ref AS businessRef,
    counterparty_type AS counterpartyType,
    counterparty_id AS counterpartyId,
    counterparty_name AS counterpartyName,
    product_name AS productName,
    quantity,
    unit,
    discrepancy_type AS discrepancyType,
    reason,
    severity,
    status,
    tolerance_rule_id AS toleranceRuleId,
    tolerance_action AS toleranceAction,
    tolerance_percent AS tolerancePercent,
    tolerance_quantity AS toleranceQuantity,
    variance_rate AS varianceRate,
    within_tolerance AS withinTolerance,
    requires_quality_check AS requiresQualityCheck,
    suggested_action AS suggestedAction,
    resolution,
    action_ref AS actionRef,
    note,
    created_by AS createdBy,
    resolved_by AS resolvedBy,
    resolved_at AS resolvedAt,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM receipt_discrepancy_cases
`;

export const RULE_SELECT_SQL = `
  SELECT
    id,
    rule_no AS ruleNo,
    name,
    source_type AS sourceType,
    discrepancy_type AS discrepancyType,
    counterparty_type AS counterpartyType,
    counterparty_id AS counterpartyId,
    product_name AS productName,
    quantity_tolerance_percent AS quantityTolerancePercent,
    quantity_tolerance_abs AS quantityToleranceAbs,
    action_within_tolerance AS actionWithinTolerance,
    action_outside_tolerance AS actionOutsideTolerance,
    severity_within_tolerance AS severityWithinTolerance,
    severity_outside_tolerance AS severityOutsideTolerance,
    requires_quality_check AS requiresQualityCheck,
    status,
    priority,
    note,
    created_by AS createdBy,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM receipt_tolerance_rules
`;

export const ACTION_SELECT_SQL = `
  SELECT
    id,
    action_no AS actionNo,
    case_id AS caseId,
    action_type AS actionType,
    status,
    source_module AS sourceModule,
    source_ref AS sourceRef,
    target_module AS targetModule,
    target_id AS targetId,
    target_ref AS targetRef,
    quantity,
    unit,
    amount,
    currency,
    reason_code AS reasonCode,
    disposition_code AS dispositionCode,
    note,
    created_by AS createdBy,
    approved_by AS approvedBy,
    posted_at AS postedAt,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM receipt_discrepancy_actions
`;

export const normalizeRuleRow = (row: RawRow): ReceiptToleranceRule => ({
  id: Number(row.id),
  ruleNo: toRowString(row.ruleNo),
  name: toRowString(row.name),
  sourceType: normalizeEnumValue(row.sourceType, VALID_TOLERANCE_SOURCE_TYPES, 'all'),
  discrepancyType: normalizeEnumValue(row.discrepancyType, VALID_TOLERANCE_DISCREPANCY_TYPES, 'all'),
  counterpartyType: normalizeEnumValue(row.counterpartyType, VALID_TOLERANCE_COUNTERPARTIES, 'all'),
  counterpartyId: toNullableNumber(row.counterpartyId),
  productName: toNullableString(row.productName),
  quantityTolerancePercent: Number(row.quantityTolerancePercent || 0),
  quantityToleranceAbs: Number(row.quantityToleranceAbs || 0),
  actionWithinTolerance: normalizeEnumValue(row.actionWithinTolerance, VALID_TOLERANCE_ACTIONS, 'warn'),
  actionOutsideTolerance: normalizeEnumValue(row.actionOutsideTolerance, VALID_TOLERANCE_ACTIONS, 'manual_review'),
  severityWithinTolerance: toRowString(row.severityWithinTolerance, 'low'),
  severityOutsideTolerance: toRowString(row.severityOutsideTolerance, 'normal'),
  requiresQualityCheck: toRowBoolean(row.requiresQualityCheck),
  status: toRowString(row.status, 'active'),
  priority: Number(row.priority || 100),
  note: toNullableString(row.note),
  createdBy: toNullableNumber(row.createdBy),
  createdAt: toRowString(row.createdAt),
  updatedAt: toRowString(row.updatedAt),
});

export const normalizeActionRow = (row: RawRow): ReceiptDiscrepancyAction => ({
  id: Number(row.id),
  actionNo: toRowString(row.actionNo),
  caseId: Number(row.caseId),
  actionType: normalizeEnumValue(row.actionType, VALID_DISCREPANCY_ACTION_TYPES, 'close_no_action'),
  status: normalizeEnumValue(row.status, VALID_DISCREPANCY_ACTION_STATUSES, 'pending'),
  sourceModule: toNullableString(row.sourceModule),
  sourceRef: toNullableString(row.sourceRef),
  targetModule: toNullableString(row.targetModule),
  targetId: toNullableNumber(row.targetId),
  targetRef: toNullableString(row.targetRef),
  quantity: toNullableNumber(row.quantity),
  unit: toNullableString(row.unit),
  amount: toNullableNumber(row.amount),
  currency: toRowString(row.currency, 'CNY'),
  reasonCode: toNullableString(row.reasonCode),
  dispositionCode: toNullableString(row.dispositionCode),
  note: toNullableString(row.note),
  createdBy: toNullableNumber(row.createdBy),
  approvedBy: toNullableNumber(row.approvedBy),
  postedAt: toNullableString(row.postedAt),
  createdAt: toRowString(row.createdAt),
  updatedAt: toRowString(row.updatedAt),
});
