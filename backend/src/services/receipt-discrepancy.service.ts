import { buildBusinessNo } from '../utils/businessNo';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import type { TransactionClient } from './stock-movement.service';

export type ReceiptDiscrepancySourceType = 'purchase_receipt' | 'shipment_receipt';
export type ReceiptDiscrepancyStatus = 'pending' | 'in_review' | 'resolved' | 'cancelled';
export type ReceiptDiscrepancyModule = 'procurement' | 'shipping';
export type ReceiptDiscrepancyCounterpartyType = 'supplier' | 'customer';
export type ReceiptDiscrepancyType =
  | 'short_shipped'
  | 'quality_rejected'
  | 'damaged'
  | 'wrong_item'
  | 'over_received'
  | 'late_delivery'
  | 'document_mismatch'
  | 'customer_short_signed'
  | 'customer_damaged'
  | 'other';
export type ReceiptToleranceAction = 'allow' | 'warn' | 'block' | 'manual_review';
export type ReceiptToleranceSourceType = ReceiptDiscrepancySourceType | 'all';
export type ReceiptToleranceCounterpartyType = ReceiptDiscrepancyCounterpartyType | 'all';
export type ReceiptToleranceDiscrepancyType = ReceiptDiscrepancyType | 'all';
export type ReceiptDiscrepancyActionType =
  | 'quality_check'
  | 'customer_rma'
  | 'supplier_return'
  | 'replacement_shipment'
  | 'credit_or_deduction'
  | 'stock_adjustment'
  | 'accept_with_concession'
  | 'close_no_action';
export type ReceiptDiscrepancyActionStatus = 'pending' | 'approved' | 'posted' | 'cancelled';

export interface ReceiptDiscrepancyCase {
  id: number;
  caseNo: string;
  sourceType: ReceiptDiscrepancySourceType;
  sourceRef: string;
  sourceId: number | null;
  relatedModule: ReceiptDiscrepancyModule;
  relatedId: number;
  businessRef: string | null;
  counterpartyType: ReceiptDiscrepancyCounterpartyType;
  counterpartyId: number | null;
  counterpartyName: string | null;
  productName: string;
  quantity: number;
  unit: string;
  discrepancyType: ReceiptDiscrepancyType;
  reason: string;
  severity: string;
  status: ReceiptDiscrepancyStatus;
  toleranceRuleId: number | null;
  toleranceAction: ReceiptToleranceAction;
  tolerancePercent: number | null;
  toleranceQuantity: number | null;
  varianceRate: number | null;
  withinTolerance: boolean;
  requiresQualityCheck: boolean;
  suggestedAction: string | null;
  resolution: string | null;
  actionRef: string | null;
  note: string | null;
  createdBy: number | null;
  resolvedBy: number | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReceiptDiscrepancyCaseInput {
  sourceType: ReceiptDiscrepancySourceType;
  sourceRef: string;
  sourceId?: number | null;
  relatedModule: ReceiptDiscrepancyModule;
  relatedId: number;
  businessRef?: string | null;
  counterpartyType: ReceiptDiscrepancyCounterpartyType;
  counterpartyId?: number | null;
  counterpartyName?: string | null;
  productName: string;
  quantity: number;
  unit: string;
  referenceQuantity?: number | null;
  discrepancyType?: ReceiptDiscrepancyType | null;
  reason?: string | null;
  severity?: string | null;
  suggestedAction?: string | null;
  note?: string | null;
  createdBy?: number | null;
}

export interface ReceiptDiscrepancyAction {
  id: number;
  actionNo: string;
  caseId: number;
  actionType: ReceiptDiscrepancyActionType;
  status: ReceiptDiscrepancyActionStatus;
  sourceModule: string | null;
  sourceRef: string | null;
  targetModule: string | null;
  targetId: number | null;
  targetRef: string | null;
  quantity: number | null;
  unit: string | null;
  amount: number | null;
  currency: string;
  reasonCode: string | null;
  dispositionCode: string | null;
  note: string | null;
  createdBy: number | null;
  approvedBy: number | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReceiptDiscrepancyActionInput {
  actionType: ReceiptDiscrepancyActionType;
  status?: ReceiptDiscrepancyActionStatus | null;
  quantity?: number | null;
  unit?: string | null;
  amount?: number | null;
  currency?: string | null;
  reasonCode?: string | null;
  dispositionCode?: string | null;
  note?: string | null;
  createdBy?: number | null;
}

export interface ReceiptDiscrepancyCaseFilters {
  sourceType?: string;
  sourceRef?: string;
  status?: string;
  relatedModule?: string;
  relatedId?: number;
  counterpartyType?: string;
  counterpartyId?: number;
  page: number;
  pageSize: number;
}

export interface ReceiptToleranceRule {
  id: number;
  ruleNo: string;
  name: string;
  sourceType: ReceiptToleranceSourceType;
  discrepancyType: ReceiptToleranceDiscrepancyType;
  counterpartyType: ReceiptToleranceCounterpartyType;
  counterpartyId: number | null;
  productName: string | null;
  quantityTolerancePercent: number;
  quantityToleranceAbs: number;
  actionWithinTolerance: ReceiptToleranceAction;
  actionOutsideTolerance: ReceiptToleranceAction;
  severityWithinTolerance: string;
  severityOutsideTolerance: string;
  requiresQualityCheck: boolean;
  status: string;
  priority: number;
  note: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReceiptToleranceRuleInput {
  name: string;
  sourceType?: ReceiptToleranceSourceType;
  discrepancyType?: ReceiptToleranceDiscrepancyType;
  counterpartyType?: ReceiptToleranceCounterpartyType;
  counterpartyId?: number | null;
  productName?: string | null;
  quantityTolerancePercent?: number | null;
  quantityToleranceAbs?: number | null;
  actionWithinTolerance?: ReceiptToleranceAction;
  actionOutsideTolerance?: ReceiptToleranceAction;
  severityWithinTolerance?: string | null;
  severityOutsideTolerance?: string | null;
  requiresQualityCheck?: boolean | null;
  status?: string | null;
  priority?: number | null;
  note?: string | null;
}

const VALID_STATUSES = new Set<ReceiptDiscrepancyStatus>(['pending', 'in_review', 'resolved', 'cancelled']);
const VALID_SOURCE_TYPES = new Set<ReceiptDiscrepancySourceType>(['purchase_receipt', 'shipment_receipt']);
const VALID_MODULES = new Set<ReceiptDiscrepancyModule>(['procurement', 'shipping']);
const VALID_COUNTERPARTIES = new Set<ReceiptDiscrepancyCounterpartyType>(['supplier', 'customer']);
const VALID_DISCREPANCY_TYPES = new Set<ReceiptDiscrepancyType>([
  'short_shipped',
  'quality_rejected',
  'damaged',
  'wrong_item',
  'over_received',
  'late_delivery',
  'document_mismatch',
  'customer_short_signed',
  'customer_damaged',
  'other',
]);
const VALID_TOLERANCE_ACTIONS = new Set<ReceiptToleranceAction>(['allow', 'warn', 'block', 'manual_review']);
const VALID_DISCREPANCY_ACTION_TYPES = new Set<ReceiptDiscrepancyActionType>([
  'quality_check',
  'customer_rma',
  'supplier_return',
  'replacement_shipment',
  'credit_or_deduction',
  'stock_adjustment',
  'accept_with_concession',
  'close_no_action',
]);
const VALID_DISCREPANCY_ACTION_STATUSES = new Set<ReceiptDiscrepancyActionStatus>(['pending', 'approved', 'posted', 'cancelled']);
const VALID_TOLERANCE_SOURCE_TYPES = new Set<ReceiptToleranceSourceType>(['all', 'purchase_receipt', 'shipment_receipt']);
const VALID_TOLERANCE_COUNTERPARTIES = new Set<ReceiptToleranceCounterpartyType>(['all', 'supplier', 'customer']);
const VALID_TOLERANCE_DISCREPANCY_TYPES = new Set<ReceiptToleranceDiscrepancyType>([
  'all',
  ...Array.from(VALID_DISCREPANCY_TYPES),
]);

const DEFAULT_TOLERANCE_DECISION = {
  ruleId: null as number | null,
  action: 'manual_review' as ReceiptToleranceAction,
  tolerancePercent: null as number | null,
  toleranceQuantity: null as number | null,
  varianceRate: null as number | null,
  withinTolerance: false,
  requiresQualityCheck: false,
  severity: 'normal',
};

type RawRow = Record<string, unknown>;

const toNullableNumber = (value: unknown) => value === null || value === undefined ? null : Number(value);
const toNullableString = (value: unknown) => value === null || value === undefined || value === '' ? null : String(value);
const toRowString = (value: unknown, fallback = '') => value === null || value === undefined ? fallback : String(value);
const toRowBoolean = (value: unknown) => value === true || Number(value || 0) === 1;
const normalizeEnumValue = <T extends string>(value: unknown, valid: ReadonlySet<T>, fallback: T): T => {
  const candidate = String(value || '').trim() as T;
  return valid.has(candidate) ? candidate : fallback;
};

const normalizeCaseRow = (row: RawRow): ReceiptDiscrepancyCase => ({
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

const CASE_SELECT_SQL = `
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

const RULE_SELECT_SQL = `
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

const ACTION_SELECT_SQL = `
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

const normalizeRuleRow = (row: RawRow): ReceiptToleranceRule => ({
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

const normalizeActionRow = (row: RawRow): ReceiptDiscrepancyAction => ({
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

function validateCreateInput(input: CreateReceiptDiscrepancyCaseInput) {
  if (!VALID_SOURCE_TYPES.has(input.sourceType)) {
    throw new Error(`Invalid discrepancy source type: ${input.sourceType}`);
  }
  if (!VALID_MODULES.has(input.relatedModule)) {
    throw new Error(`Invalid discrepancy related module: ${input.relatedModule}`);
  }
  if (!VALID_COUNTERPARTIES.has(input.counterpartyType)) {
    throw new Error(`Invalid discrepancy counterparty type: ${input.counterpartyType}`);
  }
  if (input.discrepancyType && !VALID_DISCREPANCY_TYPES.has(input.discrepancyType)) {
    throw new Error(`Invalid discrepancy type: ${input.discrepancyType}`);
  }
}

function normalizeDiscrepancyType(value: unknown, fallback: ReceiptDiscrepancyType): ReceiptDiscrepancyType {
  const normalized = String(value || '').trim() as ReceiptDiscrepancyType;
  return VALID_DISCREPANCY_TYPES.has(normalized) ? normalized : fallback;
}

function normalizeToleranceAction(value: unknown, fallback: ReceiptToleranceAction): ReceiptToleranceAction {
  const normalized = String(value || '').trim() as ReceiptToleranceAction;
  return VALID_TOLERANCE_ACTIONS.has(normalized) ? normalized : fallback;
}

function normalizeDiscrepancyActionType(value: unknown): ReceiptDiscrepancyActionType {
  const normalized = String(value || '').trim() as ReceiptDiscrepancyActionType;
  if (!VALID_DISCREPANCY_ACTION_TYPES.has(normalized)) {
    throw new Error(`Invalid discrepancy action type: ${normalized}`);
  }
  return normalized;
}

function normalizeDiscrepancyActionStatus(value: unknown, fallback: ReceiptDiscrepancyActionStatus): ReceiptDiscrepancyActionStatus {
  const normalized = String(value || '').trim() as ReceiptDiscrepancyActionStatus;
  return VALID_DISCREPANCY_ACTION_STATUSES.has(normalized) ? normalized : fallback;
}

function defaultRequiresQualityCheck(discrepancyType: ReceiptDiscrepancyType) {
  return ['quality_rejected', 'damaged', 'wrong_item', 'customer_damaged'].includes(discrepancyType);
}

function resolveAutoStatus(action: ReceiptToleranceAction): ReceiptDiscrepancyStatus {
  return action === 'allow' ? 'resolved' : 'pending';
}

function resolveDefaultSuggestedAction(discrepancyType: ReceiptDiscrepancyType, sourceType: ReceiptDiscrepancySourceType) {
  const purchaseActions: Record<string, string> = {
    short_shipped: 'supplier_claim_or_replacement',
    quality_rejected: 'quality_hold_or_supplier_return',
    damaged: 'carrier_or_supplier_claim',
    wrong_item: 'supplier_return_or_replacement',
    document_mismatch: 'document_correction_review',
    over_received: 'over_receipt_review',
    late_delivery: 'supplier_delivery_review',
  };
  const shippingActions: Record<string, string> = {
    customer_short_signed: 'after_sales_or_reship_review',
    customer_damaged: 'carrier_claim_or_rma_review',
    damaged: 'carrier_claim_or_rma_review',
    document_mismatch: 'document_correction_review',
    late_delivery: 'customer_delivery_review',
  };
  return sourceType === 'purchase_receipt'
    ? (purchaseActions[discrepancyType] || 'manual_review')
    : (shippingActions[discrepancyType] || 'manual_review');
}

async function resolveToleranceDecision(tx: TransactionClient, input: {
  sourceType: ReceiptDiscrepancySourceType;
  discrepancyType: ReceiptDiscrepancyType;
  counterpartyType: ReceiptDiscrepancyCounterpartyType;
  counterpartyId?: number | null;
  productName: string;
  quantity: number;
  referenceQuantity?: number | null;
}) {
  const rows = await tx.$queryRawUnsafe<RawRow[]>(
    `${RULE_SELECT_SQL}
     WHERE status = 'active'
       AND (source_type = 'all' OR source_type = ?)
       AND (discrepancy_type = 'all' OR discrepancy_type = ?)
       AND (counterparty_type = 'all' OR counterparty_type = ?)
       AND (counterparty_id IS NULL OR counterparty_id = ?)
       AND (product_name IS NULL OR product_name = ?)
     ORDER BY
       (CASE WHEN source_type = ? THEN 32 ELSE 0 END
       + CASE WHEN discrepancy_type = ? THEN 16 ELSE 0 END
       + CASE WHEN counterparty_id = ? THEN 8 ELSE 0 END
       + CASE WHEN counterparty_type = ? THEN 4 ELSE 0 END
       + CASE WHEN product_name = ? THEN 2 ELSE 0 END) DESC,
       priority ASC,
       id DESC
     LIMIT 1`,
    input.sourceType,
    input.discrepancyType,
    input.counterpartyType,
    input.counterpartyId ?? null,
    input.productName,
    input.sourceType,
    input.discrepancyType,
    input.counterpartyId ?? null,
    input.counterpartyType,
    input.productName,
  );

  const rule = rows.length > 0 ? normalizeRuleRow(rows[0]) : null;
  if (!rule) {
    return {
      ...DEFAULT_TOLERANCE_DECISION,
      requiresQualityCheck: defaultRequiresQualityCheck(input.discrepancyType),
    };
  }

  const quantity = Math.max(0, Number(input.quantity || 0));
  const referenceQuantity = Math.max(0, Number(input.referenceQuantity || 0));
  const percentLimit = referenceQuantity > 0 ? referenceQuantity * (rule.quantityTolerancePercent / 100) : 0;
  const absLimit = Math.max(0, Number(rule.quantityToleranceAbs || 0));
  const toleranceQuantity = Math.max(percentLimit, absLimit);
  const withinTolerance = toleranceQuantity > 0 && quantity <= toleranceQuantity + 0.000001;
  const action = withinTolerance ? rule.actionWithinTolerance : rule.actionOutsideTolerance;
  const varianceRate = referenceQuantity > 0 ? Number(((quantity / referenceQuantity) * 100).toFixed(6)) : null;

  return {
    ruleId: rule.id,
    action,
    tolerancePercent: rule.quantityTolerancePercent,
    toleranceQuantity,
    varianceRate,
    withinTolerance,
    requiresQualityCheck: rule.requiresQualityCheck || defaultRequiresQualityCheck(input.discrepancyType),
    severity: withinTolerance ? rule.severityWithinTolerance : rule.severityOutsideTolerance,
  };
}

export class ReceiptDiscrepancyService {
  static normalizeDiscrepancyType(value: unknown, fallback: ReceiptDiscrepancyType) {
    return normalizeDiscrepancyType(value, fallback);
  }

  static async createCaseForRejectedReceipt(tx: TransactionClient, input: CreateReceiptDiscrepancyCaseInput) {
    const rejectedQuantity = Number(input.quantity || 0);
    if (!Number.isFinite(rejectedQuantity) || rejectedQuantity <= 0.000001) {
      return null;
    }
    validateCreateInput(input);
    const discrepancyType = normalizeDiscrepancyType(
      input.discrepancyType,
      input.sourceType === 'purchase_receipt' ? 'short_shipped' : 'customer_short_signed',
    );
    const decision = await resolveToleranceDecision(tx, {
      sourceType: input.sourceType,
      discrepancyType,
      counterpartyType: input.counterpartyType,
      counterpartyId: input.counterpartyId ?? null,
      productName: input.productName,
      quantity: rejectedQuantity,
      referenceQuantity: input.referenceQuantity ?? null,
    });
    if (decision.action === 'block') {
      throw new AppError('RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE', 409, ErrorCode.CONFLICT, {
        discrepancyType,
        quantity: rejectedQuantity,
        toleranceRuleId: decision.ruleId,
        tolerancePercent: decision.tolerancePercent,
        toleranceQuantity: decision.toleranceQuantity,
        varianceRate: decision.varianceRate,
      });
    }

    const existing = await tx.$queryRawUnsafe<RawRow[]>(
      `${CASE_SELECT_SQL} WHERE source_type = ? AND source_ref = ? LIMIT 1`,
      input.sourceType,
      input.sourceRef,
    );
    if (existing.length > 0) {
      return normalizeCaseRow(existing[0]);
    }

    const caseNo = buildBusinessNo('DSC');
    const status = resolveAutoStatus(decision.action);
    const resolvedBy = status === 'resolved' ? (input.createdBy ?? null) : null;
    const resolvedAtSql = status === 'resolved' ? 'CURRENT_TIMESTAMP' : 'NULL';
    const resolution = status === 'resolved' ? 'Auto resolved by receipt tolerance rule' : null;
    await tx.$executeRawUnsafe(
      `INSERT INTO receipt_discrepancy_cases
        (case_no, source_type, source_ref, source_id, related_module, related_id, business_ref,
         counterparty_type, counterparty_id, counterparty_name, product_name, quantity, unit,
         discrepancy_type, reason, severity, status, tolerance_rule_id, tolerance_action, tolerance_percent,
         tolerance_quantity, variance_rate, within_tolerance, requires_quality_check, suggested_action, resolution,
         note, created_by, resolved_by, resolved_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${resolvedAtSql}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      caseNo,
      input.sourceType,
      input.sourceRef,
      input.sourceId ?? null,
      input.relatedModule,
      Number(input.relatedId),
      input.businessRef ?? null,
      input.counterpartyType,
      input.counterpartyId ?? null,
      input.counterpartyName ?? null,
      input.productName,
      rejectedQuantity,
      input.unit || 'kg',
      discrepancyType,
      input.reason || 'Receipt discrepancy pending review',
      input.severity || decision.severity || 'normal',
      status,
      decision.ruleId,
      decision.action,
      decision.tolerancePercent,
      decision.toleranceQuantity,
      decision.varianceRate,
      decision.withinTolerance ? 1 : 0,
      decision.requiresQualityCheck ? 1 : 0,
      input.suggestedAction ?? resolveDefaultSuggestedAction(discrepancyType, input.sourceType),
      resolution,
      input.note ?? null,
      input.createdBy ?? null,
      resolvedBy,
    );

    const rows = await tx.$queryRawUnsafe<RawRow[]>(
      `${CASE_SELECT_SQL} WHERE case_no = ? LIMIT 1`,
      caseNo,
    );
    return rows.length > 0 ? normalizeCaseRow(rows[0]) : null;
  }

  static async listToleranceRules(tx: TransactionClient, filters: {
    sourceType?: string;
    discrepancyType?: string;
    counterpartyType?: string;
    status?: string;
    page: number;
    pageSize: number;
  }) {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.sourceType) {
      where.push('source_type = ?');
      params.push(filters.sourceType);
    }
    if (filters.discrepancyType) {
      where.push('discrepancy_type = ?');
      params.push(filters.discrepancyType);
    }
    if (filters.counterpartyType) {
      where.push('counterparty_type = ?');
      params.push(filters.counterpartyType);
    }
    if (filters.status) {
      where.push('status = ?');
      params.push(filters.status);
    }

    const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const [items, countRows] = await Promise.all([
      tx.$queryRawUnsafe<RawRow[]>(
        `${RULE_SELECT_SQL}${whereSql} ORDER BY priority ASC, id DESC LIMIT ? OFFSET ?`,
        ...params,
        pageSize,
        offset,
      ),
      tx.$queryRawUnsafe(
        `SELECT COUNT(*) AS count FROM receipt_tolerance_rules${whereSql}`,
        ...params,
      ) as Promise<Array<{ count: unknown }>>,
    ]);

    return {
      items: items.map(normalizeRuleRow),
      total: Number(countRows[0]?.count || 0),
      page,
      pageSize,
    };
  }

  static async createToleranceRule(tx: TransactionClient, input: CreateReceiptToleranceRuleInput, createdBy?: number | null) {
    const sourceType = String(input.sourceType || 'all') as ReceiptToleranceSourceType;
    const discrepancyType = String(input.discrepancyType || 'all') as ReceiptToleranceDiscrepancyType;
    const counterpartyType = String(input.counterpartyType || 'all') as ReceiptToleranceCounterpartyType;
    if (!VALID_TOLERANCE_SOURCE_TYPES.has(sourceType)) throw new Error(`Invalid sourceType: ${sourceType}`);
    if (!VALID_TOLERANCE_DISCREPANCY_TYPES.has(discrepancyType)) throw new Error(`Invalid discrepancyType: ${discrepancyType}`);
    if (!VALID_TOLERANCE_COUNTERPARTIES.has(counterpartyType)) throw new Error(`Invalid counterpartyType: ${counterpartyType}`);

    const actionWithinTolerance = normalizeToleranceAction(input.actionWithinTolerance, 'warn');
    const actionOutsideTolerance = normalizeToleranceAction(input.actionOutsideTolerance, 'manual_review');
    const ruleNo = buildBusinessNo('DTR');

    await tx.$executeRawUnsafe(
      `INSERT INTO receipt_tolerance_rules
        (rule_no, name, source_type, discrepancy_type, counterparty_type, counterparty_id, product_name,
         quantity_tolerance_percent, quantity_tolerance_abs, action_within_tolerance, action_outside_tolerance,
         severity_within_tolerance, severity_outside_tolerance, requires_quality_check, status, priority, note,
         created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ruleNo,
      input.name,
      sourceType,
      discrepancyType,
      counterpartyType,
      input.counterpartyId ?? null,
      input.productName || null,
      Number(input.quantityTolerancePercent || 0),
      Number(input.quantityToleranceAbs || 0),
      actionWithinTolerance,
      actionOutsideTolerance,
      input.severityWithinTolerance || 'low',
      input.severityOutsideTolerance || 'normal',
      input.requiresQualityCheck ? 1 : 0,
      input.status || 'active',
      Number(input.priority || 100),
      input.note || null,
      createdBy ?? null,
    );

    const rows = await tx.$queryRawUnsafe<RawRow[]>(
      `${RULE_SELECT_SQL} WHERE rule_no = ? LIMIT 1`,
      ruleNo,
    );
    return rows.length > 0 ? normalizeRuleRow(rows[0]) : null;
  }

  static async listActions(tx: TransactionClient, caseId: number) {
    const rows = await tx.$queryRawUnsafe<RawRow[]>(
      `${ACTION_SELECT_SQL} WHERE case_id = ? ORDER BY id DESC`,
      Number(caseId),
    );
    return rows.map(normalizeActionRow);
  }

  static async createAction(tx: TransactionClient, caseId: number, input: CreateReceiptDiscrepancyActionInput) {
    const caseRows = await tx.$queryRawUnsafe<RawRow[]>(
      `${CASE_SELECT_SQL} WHERE id = ? LIMIT 1`,
      Number(caseId),
    );
    if (caseRows.length === 0) return null;

    const discrepancyCase = normalizeCaseRow(caseRows[0]);
    const actionType = normalizeDiscrepancyActionType(input.actionType);
    let status = normalizeDiscrepancyActionStatus(input.status, 'pending');
    let targetModule: string | null = null;
    let targetId: number | null = null;
    let targetRef: string | null = null;
    let postedAtSql = 'NULL';

    const existingRows = await tx.$queryRawUnsafe<RawRow[]>(
      `${ACTION_SELECT_SQL} WHERE case_id = ? AND action_type = ? AND status <> 'cancelled' ORDER BY id DESC LIMIT 1`,
      discrepancyCase.id,
      actionType,
    );
    if (existingRows.length > 0) {
      return normalizeActionRow(existingRows[0]);
    }

    if (discrepancyCase.status === 'resolved' || discrepancyCase.status === 'cancelled') {
      throw new Error('Closed discrepancy case cannot create new actions');
    }

    if (actionType === 'customer_rma') {
      if (discrepancyCase.counterpartyType !== 'customer' || !discrepancyCase.counterpartyId) {
        throw new Error('Customer RMA action requires a customer discrepancy case');
      }

      const customerRows = await tx.$queryRawUnsafe(
        'SELECT id, status FROM customers WHERE id = ? LIMIT 1',
        discrepancyCase.counterpartyId,
      ) as Array<{ id: number; status: string }>;
      if (customerRows.length === 0) {
        throw new Error('Customer for RMA action was not found');
      }
      if (String(customerRows[0].status || 'active') !== 'active') {
        throw new Error('Customer RMA action requires an active customer');
      }

      const rmaNo = buildBusinessNo('RMA');
      await tx.$executeRawUnsafe(
        `INSERT INTO rmas
          (rma_no, customer_id, product_name, quantity, unit, reason, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        rmaNo,
        discrepancyCase.counterpartyId,
        discrepancyCase.productName,
        Number(input.quantity ?? discrepancyCase.quantity),
        input.unit || discrepancyCase.unit || 'kg',
        input.note || discrepancyCase.reason || 'Receipt discrepancy customer RMA',
        input.createdBy ?? discrepancyCase.createdBy ?? 1,
      );

      const rmaRows = await tx.$queryRawUnsafe(
        'SELECT id, rma_no AS rmaNo FROM rmas WHERE rma_no = ? LIMIT 1',
        rmaNo,
      ) as Array<{ id: number; rmaNo: string }>;
      targetModule = 'rma';
      targetId = Number(rmaRows[0]?.id || 0) || null;
      targetRef = rmaNo;
      status = 'posted';
      postedAtSql = 'CURRENT_TIMESTAMP';
    }

    if (actionType === 'close_no_action') {
      status = 'posted';
      postedAtSql = 'CURRENT_TIMESTAMP';
    }

    const actionNo = buildBusinessNo('DCA');
    await tx.$executeRawUnsafe(
      `INSERT INTO receipt_discrepancy_actions
        (action_no, case_id, action_type, status, source_module, source_ref, target_module, target_id, target_ref,
         quantity, unit, amount, currency, reason_code, disposition_code, note, created_by, approved_by, posted_at,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${postedAtSql}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      actionNo,
      discrepancyCase.id,
      actionType,
      status,
      discrepancyCase.relatedModule,
      discrepancyCase.sourceRef,
      targetModule,
      targetId,
      targetRef,
      input.quantity ?? discrepancyCase.quantity,
      input.unit || discrepancyCase.unit || null,
      input.amount ?? null,
      input.currency || 'CNY',
      input.reasonCode || null,
      input.dispositionCode || null,
      input.note || null,
      input.createdBy ?? null,
      status === 'posted' ? (input.createdBy ?? null) : null,
    );

    await tx.$executeRawUnsafe(
      `UPDATE receipt_discrepancy_cases
       SET action_ref = ?,
           status = CASE WHEN status = 'pending' THEN 'in_review' ELSE status END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      actionNo,
      discrepancyCase.id,
    );

    const rows = await tx.$queryRawUnsafe<RawRow[]>(
      `${ACTION_SELECT_SQL} WHERE action_no = ? LIMIT 1`,
      actionNo,
    );
    return rows.length > 0 ? normalizeActionRow(rows[0]) : null;
  }

  static async listCases(tx: TransactionClient, filters: ReceiptDiscrepancyCaseFilters) {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.sourceType) {
      if (!VALID_SOURCE_TYPES.has(filters.sourceType as ReceiptDiscrepancySourceType)) {
        throw new Error(`Invalid sourceType: ${filters.sourceType}`);
      }
      where.push('source_type = ?');
      params.push(filters.sourceType);
    }

    if (filters.sourceRef) {
      where.push('source_ref = ?');
      params.push(filters.sourceRef);
    }

    if (filters.status) {
      if (!VALID_STATUSES.has(filters.status as ReceiptDiscrepancyStatus)) {
        throw new Error(`Invalid status: ${filters.status}`);
      }
      where.push('status = ?');
      params.push(filters.status);
    }

    if (filters.relatedModule) {
      if (!VALID_MODULES.has(filters.relatedModule as ReceiptDiscrepancyModule)) {
        throw new Error(`Invalid relatedModule: ${filters.relatedModule}`);
      }
      where.push('related_module = ?');
      params.push(filters.relatedModule);
    }

    if (filters.relatedId) {
      where.push('related_id = ?');
      params.push(Number(filters.relatedId));
    }

    if (filters.counterpartyType) {
      if (!VALID_COUNTERPARTIES.has(filters.counterpartyType as ReceiptDiscrepancyCounterpartyType)) {
        throw new Error(`Invalid counterpartyType: ${filters.counterpartyType}`);
      }
      where.push('counterparty_type = ?');
      params.push(filters.counterpartyType);
    }

    if (filters.counterpartyId) {
      where.push('counterparty_id = ?');
      params.push(Number(filters.counterpartyId));
    }

    const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const [items, countRows] = await Promise.all([
      tx.$queryRawUnsafe<RawRow[]>(
        `${CASE_SELECT_SQL}${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
        ...params,
        pageSize,
        offset,
      ),
      tx.$queryRawUnsafe(
        `SELECT COUNT(*) AS count FROM receipt_discrepancy_cases${whereSql}`,
        ...params,
      ) as Promise<Array<{ count: unknown }>>,
    ]);

    return {
      items: items.map(normalizeCaseRow),
      total: Number(countRows[0]?.count || 0),
      page,
      pageSize,
    };
  }

  static async resolveCase(tx: TransactionClient, input: {
    id: number;
    status: ReceiptDiscrepancyStatus;
    resolution?: string | null;
    actionRef?: string | null;
    note?: string | null;
    resolvedBy?: number | null;
  }) {
    if (!VALID_STATUSES.has(input.status)) {
      throw new Error(`Invalid status: ${input.status}`);
    }

    const rows = await tx.$queryRawUnsafe<RawRow[]>(
      `${CASE_SELECT_SQL} WHERE id = ? LIMIT 1`,
      Number(input.id),
    );
    if (rows.length === 0) {
      return null;
    }

    const isTerminal = input.status === 'resolved' || input.status === 'cancelled';
    await tx.$executeRawUnsafe(
      `UPDATE receipt_discrepancy_cases
       SET status = ?,
           resolution = COALESCE(?, resolution),
           action_ref = COALESCE(?, action_ref),
           note = COALESCE(?, note),
           resolved_by = CASE WHEN ? THEN ? ELSE resolved_by END,
           resolved_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE resolved_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      input.status,
      input.resolution ?? null,
      input.actionRef ?? null,
      input.note ?? null,
      isTerminal ? 1 : 0,
      input.resolvedBy ?? null,
      isTerminal ? 1 : 0,
      Number(input.id),
    );

    const updated = await tx.$queryRawUnsafe<RawRow[]>(
      `${CASE_SELECT_SQL} WHERE id = ? LIMIT 1`,
      Number(input.id),
    );
    return updated.length > 0 ? normalizeCaseRow(updated[0]) : null;
  }
}
