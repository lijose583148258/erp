import api, { ApiRequestOptions } from '../utils/api';

export type ReceiptDiscrepancyStatus = 'pending' | 'in_review' | 'resolved' | 'cancelled';
export type ReceiptDiscrepancySourceType = 'purchase_receipt' | 'shipment_receipt';
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
  id: string;
  caseNo: string;
  sourceType: ReceiptDiscrepancySourceType;
  sourceRef: string;
  sourceId: string | null;
  relatedModule: ReceiptDiscrepancyModule;
  relatedId: string;
  businessRef: string | null;
  counterpartyType: ReceiptDiscrepancyCounterpartyType;
  counterpartyId: string | null;
  counterpartyName: string | null;
  productName: string;
  quantity: number;
  unit: string;
  discrepancyType: ReceiptDiscrepancyType;
  reason: string;
  severity: string;
  status: ReceiptDiscrepancyStatus;
  toleranceRuleId: string | null;
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
  createdBy: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptToleranceRule {
  id: string;
  ruleNo: string;
  name: string;
  sourceType: ReceiptToleranceSourceType;
  discrepancyType: ReceiptToleranceDiscrepancyType;
  counterpartyType: ReceiptToleranceCounterpartyType;
  counterpartyId: string | null;
  productName: string | null;
  quantityTolerancePercent: number;
  quantityToleranceAbs: number;
  actionWithinTolerance: ReceiptToleranceAction;
  actionOutsideTolerance: ReceiptToleranceAction;
  severityWithinTolerance: string;
  severityOutsideTolerance: string;
  requiresQualityCheck: boolean;
  status: 'active' | 'inactive' | string;
  priority: number;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptDiscrepancyAction {
  id: string;
  actionNo: string;
  caseId: string;
  actionType: ReceiptDiscrepancyActionType;
  status: ReceiptDiscrepancyActionStatus;
  sourceModule: string | null;
  sourceRef: string | null;
  targetModule: string | null;
  targetId: string | null;
  targetRef: string | null;
  quantity: number | null;
  unit: string | null;
  amount: number | null;
  currency: string;
  reasonCode: string | null;
  dispositionCode: string | null;
  note: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptDiscrepancyListResponse {
  success: boolean;
  data: ReceiptDiscrepancyCase[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ReceiptToleranceRuleListResponse {
  success: boolean;
  data: ReceiptToleranceRule[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export const mapReceiptDiscrepancyCase = (item: any): ReceiptDiscrepancyCase => ({
  ...item,
  id: String(item.id),
  sourceId: item.sourceId === null || item.sourceId === undefined ? null : String(item.sourceId),
  relatedId: String(item.relatedId),
  counterpartyId: item.counterpartyId === null || item.counterpartyId === undefined ? null : String(item.counterpartyId),
  quantity: Number(item.quantity || 0),
  discrepancyType: item.discrepancyType || 'other',
  toleranceRuleId: item.toleranceRuleId === null || item.toleranceRuleId === undefined ? null : String(item.toleranceRuleId),
  toleranceAction: item.toleranceAction || 'manual_review',
  tolerancePercent: item.tolerancePercent === null || item.tolerancePercent === undefined ? null : Number(item.tolerancePercent),
  toleranceQuantity: item.toleranceQuantity === null || item.toleranceQuantity === undefined ? null : Number(item.toleranceQuantity),
  varianceRate: item.varianceRate === null || item.varianceRate === undefined ? null : Number(item.varianceRate),
  withinTolerance: Boolean(item.withinTolerance),
  requiresQualityCheck: Boolean(item.requiresQualityCheck),
  createdBy: item.createdBy === null || item.createdBy === undefined ? null : String(item.createdBy),
  resolvedBy: item.resolvedBy === null || item.resolvedBy === undefined ? null : String(item.resolvedBy),
  businessRef: item.businessRef || null,
  counterpartyName: item.counterpartyName || null,
  suggestedAction: item.suggestedAction || null,
  resolution: item.resolution || null,
  actionRef: item.actionRef || null,
  note: item.note || null,
  resolvedAt: item.resolvedAt || null,
});

export const mapReceiptToleranceRule = (item: any): ReceiptToleranceRule => ({
  ...item,
  id: String(item.id),
  counterpartyId: item.counterpartyId === null || item.counterpartyId === undefined ? null : String(item.counterpartyId),
  productName: item.productName || null,
  quantityTolerancePercent: Number(item.quantityTolerancePercent || 0),
  quantityToleranceAbs: Number(item.quantityToleranceAbs || 0),
  requiresQualityCheck: Boolean(item.requiresQualityCheck),
  priority: Number(item.priority || 100),
  note: item.note || null,
  createdBy: item.createdBy === null || item.createdBy === undefined ? null : String(item.createdBy),
});

export const mapReceiptDiscrepancyAction = (item: any): ReceiptDiscrepancyAction => ({
  ...item,
  id: String(item.id),
  caseId: String(item.caseId),
  targetId: item.targetId === null || item.targetId === undefined ? null : String(item.targetId),
  quantity: item.quantity === null || item.quantity === undefined ? null : Number(item.quantity),
  amount: item.amount === null || item.amount === undefined ? null : Number(item.amount),
  currency: item.currency || 'CNY',
  sourceModule: item.sourceModule || null,
  sourceRef: item.sourceRef || null,
  targetModule: item.targetModule || null,
  targetRef: item.targetRef || null,
  reasonCode: item.reasonCode || null,
  dispositionCode: item.dispositionCode || null,
  note: item.note || null,
  createdBy: item.createdBy === null || item.createdBy === undefined ? null : String(item.createdBy),
  approvedBy: item.approvedBy === null || item.approvedBy === undefined ? null : String(item.approvedBy),
  postedAt: item.postedAt || null,
});

export const receiptDiscrepancyService = {
  async getAll(params?: {
    page?: number;
    pageSize?: number;
    sourceType?: ReceiptDiscrepancySourceType;
    sourceRef?: string;
    status?: ReceiptDiscrepancyStatus;
    relatedModule?: ReceiptDiscrepancyModule;
    relatedId?: string | number;
    counterpartyType?: ReceiptDiscrepancyCounterpartyType;
    counterpartyId?: string | number;
  }, options: ApiRequestOptions = {}): Promise<ReceiptDiscrepancyListResponse> {
    const response = await api.get<any, ReceiptDiscrepancyListResponse>('/receipt-discrepancies', { params, signal: options.signal });
    return {
      ...response,
      data: Array.isArray(response.data) ? response.data.map(mapReceiptDiscrepancyCase) : [],
    };
  },

  async resolve(id: string, data: {
    status: ReceiptDiscrepancyStatus;
    resolution?: string;
    actionRef?: string;
    note?: string;
  }): Promise<ReceiptDiscrepancyCase> {
    const response = await api.patch<any, { success: boolean; data: ReceiptDiscrepancyCase }>(
      `/receipt-discrepancies/${id}/resolve`,
      data,
    );
    return mapReceiptDiscrepancyCase(response.data);
  },

  async getToleranceRules(params?: {
    page?: number;
    pageSize?: number;
    sourceType?: ReceiptToleranceSourceType;
    discrepancyType?: ReceiptToleranceDiscrepancyType;
    counterpartyType?: ReceiptToleranceCounterpartyType;
    status?: 'active' | 'inactive';
  }, options: ApiRequestOptions = {}): Promise<ReceiptToleranceRuleListResponse> {
    const response = await api.get<any, ReceiptToleranceRuleListResponse>('/receipt-discrepancies/tolerance-rules', { params, signal: options.signal });
    return {
      ...response,
      data: Array.isArray(response.data) ? response.data.map(mapReceiptToleranceRule) : [],
    };
  },

  async createToleranceRule(data: {
    name: string;
    sourceType?: ReceiptToleranceSourceType;
    discrepancyType?: ReceiptToleranceDiscrepancyType;
    counterpartyType?: ReceiptToleranceCounterpartyType;
    counterpartyId?: string | number | null;
    productName?: string | null;
    quantityTolerancePercent?: number | null;
    quantityToleranceAbs?: number | null;
    actionWithinTolerance?: ReceiptToleranceAction;
    actionOutsideTolerance?: ReceiptToleranceAction;
    severityWithinTolerance?: string | null;
    severityOutsideTolerance?: string | null;
    requiresQualityCheck?: boolean | null;
    status?: 'active' | 'inactive';
    priority?: number | null;
    note?: string | null;
  }): Promise<ReceiptToleranceRule> {
    const response = await api.post<any, { success: boolean; data: ReceiptToleranceRule }>(
      '/receipt-discrepancies/tolerance-rules',
      data,
    );
    return mapReceiptToleranceRule(response.data);
  },

  async getActions(caseId: string | number): Promise<ReceiptDiscrepancyAction[]> {
    const response = await api.get<any, { success: boolean; data: ReceiptDiscrepancyAction[] }>(
      `/receipt-discrepancies/${caseId}/actions`,
    );
    return Array.isArray(response.data) ? response.data.map(mapReceiptDiscrepancyAction) : [];
  },

  async createAction(caseId: string | number, data: {
    actionType: ReceiptDiscrepancyActionType;
    status?: ReceiptDiscrepancyActionStatus | null;
    quantity?: number | null;
    unit?: string | null;
    amount?: number | null;
    currency?: string | null;
    reasonCode?: string | null;
    dispositionCode?: string | null;
    note?: string | null;
  }): Promise<ReceiptDiscrepancyAction> {
    const response = await api.post<any, { success: boolean; data: ReceiptDiscrepancyAction }>(
      `/receipt-discrepancies/${caseId}/actions`,
      data,
    );
    return mapReceiptDiscrepancyAction(response.data);
  },
};
