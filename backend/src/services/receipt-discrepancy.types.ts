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
