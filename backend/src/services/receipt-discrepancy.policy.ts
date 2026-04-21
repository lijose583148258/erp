import type {
  CreateReceiptDiscrepancyCaseInput,
  ReceiptDiscrepancyActionStatus,
  ReceiptDiscrepancyActionType,
  ReceiptDiscrepancyCounterpartyType,
  ReceiptDiscrepancyModule,
  ReceiptDiscrepancySourceType,
  ReceiptDiscrepancyStatus,
  ReceiptDiscrepancyType,
  ReceiptToleranceAction,
  ReceiptToleranceCounterpartyType,
  ReceiptToleranceDiscrepancyType,
  ReceiptToleranceSourceType,
} from './receipt-discrepancy.types';

export const VALID_STATUSES = new Set<ReceiptDiscrepancyStatus>(['pending', 'in_review', 'resolved', 'cancelled']);
export const VALID_SOURCE_TYPES = new Set<ReceiptDiscrepancySourceType>(['purchase_receipt', 'shipment_receipt']);
export const VALID_MODULES = new Set<ReceiptDiscrepancyModule>(['procurement', 'shipping']);
export const VALID_COUNTERPARTIES = new Set<ReceiptDiscrepancyCounterpartyType>(['supplier', 'customer']);
export const VALID_DISCREPANCY_TYPES = new Set<ReceiptDiscrepancyType>([
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
export const VALID_TOLERANCE_ACTIONS = new Set<ReceiptToleranceAction>(['allow', 'warn', 'block', 'manual_review']);
export const VALID_DISCREPANCY_ACTION_TYPES = new Set<ReceiptDiscrepancyActionType>([
  'quality_check',
  'customer_rma',
  'supplier_return',
  'replacement_shipment',
  'credit_or_deduction',
  'stock_adjustment',
  'accept_with_concession',
  'close_no_action',
]);
export const VALID_DISCREPANCY_ACTION_STATUSES = new Set<ReceiptDiscrepancyActionStatus>(['pending', 'approved', 'posted', 'cancelled']);
export const VALID_TOLERANCE_SOURCE_TYPES = new Set<ReceiptToleranceSourceType>(['all', 'purchase_receipt', 'shipment_receipt']);
export const VALID_TOLERANCE_COUNTERPARTIES = new Set<ReceiptToleranceCounterpartyType>(['all', 'supplier', 'customer']);
export const VALID_TOLERANCE_DISCREPANCY_TYPES = new Set<ReceiptToleranceDiscrepancyType>([
  'all',
  ...Array.from(VALID_DISCREPANCY_TYPES),
]);

export const DEFAULT_TOLERANCE_DECISION = {
  ruleId: null as number | null,
  action: 'manual_review' as ReceiptToleranceAction,
  tolerancePercent: null as number | null,
  toleranceQuantity: null as number | null,
  varianceRate: null as number | null,
  withinTolerance: false,
  requiresQualityCheck: false,
  severity: 'normal',
};

export function validateCreateInput(input: CreateReceiptDiscrepancyCaseInput) {
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

export function normalizeDiscrepancyType(value: unknown, fallback: ReceiptDiscrepancyType): ReceiptDiscrepancyType {
  const normalized = String(value || '').trim() as ReceiptDiscrepancyType;
  return VALID_DISCREPANCY_TYPES.has(normalized) ? normalized : fallback;
}

export function normalizeToleranceAction(value: unknown, fallback: ReceiptToleranceAction): ReceiptToleranceAction {
  const normalized = String(value || '').trim() as ReceiptToleranceAction;
  return VALID_TOLERANCE_ACTIONS.has(normalized) ? normalized : fallback;
}

export function normalizeDiscrepancyActionType(value: unknown): ReceiptDiscrepancyActionType {
  const normalized = String(value || '').trim() as ReceiptDiscrepancyActionType;
  if (!VALID_DISCREPANCY_ACTION_TYPES.has(normalized)) {
    throw new Error(`Invalid discrepancy action type: ${normalized}`);
  }
  return normalized;
}

export function normalizeDiscrepancyActionStatus(value: unknown, fallback: ReceiptDiscrepancyActionStatus): ReceiptDiscrepancyActionStatus {
  const normalized = String(value || '').trim() as ReceiptDiscrepancyActionStatus;
  return VALID_DISCREPANCY_ACTION_STATUSES.has(normalized) ? normalized : fallback;
}

export function defaultRequiresQualityCheck(discrepancyType: ReceiptDiscrepancyType) {
  return ['quality_rejected', 'damaged', 'wrong_item', 'customer_damaged'].includes(discrepancyType);
}

export function resolveAutoStatus(action: ReceiptToleranceAction): ReceiptDiscrepancyStatus {
  return action === 'allow' ? 'resolved' : 'pending';
}

export function resolveDefaultSuggestedAction(discrepancyType: ReceiptDiscrepancyType, sourceType: ReceiptDiscrepancySourceType) {
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
