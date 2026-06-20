import api, { ApiRequestOptions } from '../utils/api';
import { ApiDataResponse, toApiRecord, toNumberValue, toOptionalString, toStringValue } from '../utils/apiMapping';

export type ReceivableAdjustmentType =
  | 'credit_memo'
  | 'discount_allowance'
  | 'bad_debt_writeoff'
  | 'short_payment_writeoff'
  | 'fx_difference';

export type ReceivableAdjustmentStatus = 'pending' | 'posted' | 'reversed' | 'posting' | 'reversing';

export interface ReceivableAdjustmentRecord {
  id: number;
  adjustmentNo: string;
  adjustmentType: ReceivableAdjustmentType;
  customerId: number;
  customerName: string | null;
  customerNameZh?: string | null;
  customerNameEn?: string | null;
  customerNameVi?: string | null;
  orderId: number;
  orderNo: string | null;
  amount: number;
  currency: string;
  exchangeRate: number;
  baseAmount: number;
  reason: string;
  evidenceJson: string | null;
  note: string | null;
  status: ReceivableAdjustmentStatus;
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown> | null;
  postedAt: string | null;
  reversedAt: string | null;
  createdAt: string;
  updatedAt: string;
  orderSnapshot: {
    finalAmount: number;
    paidAmount: number;
    receivableAdjustmentAmount: number;
    effectiveReceivableAmount: number;
    outstandingAmount: number;
    paymentStatus: string;
  } | null;
}

export interface ReceivableAdjustmentListResponse {
  success?: boolean;
  data: ReceivableAdjustmentRecord[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface CreateReceivableAdjustmentPayload {
  orderId: number;
  adjustmentType: ReceivableAdjustmentType;
  amount: number;
  currency?: string;
  exchangeRate?: number;
  reason: string;
  evidenceJson?: string | null;
  note?: string | null;
}

const parseSnapshot = (value: unknown): Record<string, unknown> | null => {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try {
    return toApiRecord(JSON.parse(value));
  } catch {
    return null;
  }
};

const mapReceivableAdjustment = (value: unknown): ReceivableAdjustmentRecord => {
  const item = toApiRecord(value);
  const snapshot = toApiRecord(item.orderSnapshot);
  return {
    id: toNumberValue(item.id),
    adjustmentNo: toStringValue(item.adjustmentNo),
    adjustmentType: toStringValue(item.adjustmentType, 'credit_memo') as ReceivableAdjustmentType,
    customerId: toNumberValue(item.customerId),
    customerName: toOptionalString(item.customerName) || null,
    customerNameZh: toOptionalString(item.customerNameZh) || null,
    customerNameEn: toOptionalString(item.customerNameEn) || null,
    customerNameVi: toOptionalString(item.customerNameVi) || null,
    orderId: toNumberValue(item.orderId),
    orderNo: toOptionalString(item.orderNo) || null,
    amount: toNumberValue(item.amount),
    currency: toStringValue(item.currency, 'CNY'),
    exchangeRate: toNumberValue(item.exchangeRate, 1),
    baseAmount: toNumberValue(item.baseAmount),
    reason: toStringValue(item.reason),
    evidenceJson: toOptionalString(item.evidenceJson) || null,
    note: toOptionalString(item.note) || null,
    status: toStringValue(item.status, 'pending') as ReceivableAdjustmentStatus,
    beforeSnapshot: parseSnapshot(item.beforeSnapshot),
    afterSnapshot: parseSnapshot(item.afterSnapshot),
    postedAt: toOptionalString(item.postedAt) || null,
    reversedAt: toOptionalString(item.reversedAt) || null,
    createdAt: toStringValue(item.createdAt),
    updatedAt: toStringValue(item.updatedAt),
    orderSnapshot: item.orderSnapshot ? {
      finalAmount: toNumberValue(snapshot.finalAmount),
      paidAmount: toNumberValue(snapshot.paidAmount),
      receivableAdjustmentAmount: toNumberValue(snapshot.receivableAdjustmentAmount),
      effectiveReceivableAmount: toNumberValue(snapshot.effectiveReceivableAmount),
      outstandingAmount: toNumberValue(snapshot.outstandingAmount),
      paymentStatus: toStringValue(snapshot.paymentStatus),
    } : null,
  };
};

export const receivableAdjustmentService = {
  async getAll(params?: {
    page?: number;
    pageSize?: number;
    status?: string;
    adjustmentType?: string;
    orderId?: number;
    customerId?: number;
  }, options: ApiRequestOptions = {}): Promise<ReceivableAdjustmentListResponse> {
    const response = await api.get<unknown, ReceivableAdjustmentListResponse>('/finance/receivable-adjustments', { params, signal: options.signal });
    return {
      ...response,
      data: Array.isArray(response.data) ? response.data.map(mapReceivableAdjustment) : [],
      meta: response.meta || { page: params?.page || 1, pageSize: params?.pageSize || 20, total: 0, totalPages: 1 },
    };
  },

  async create(payload: CreateReceivableAdjustmentPayload): Promise<ReceivableAdjustmentRecord> {
    const response = await api.post<unknown, ApiDataResponse<unknown>>('/finance/receivable-adjustments', payload);
    return mapReceivableAdjustment(response.data);
  },

  async post(id: number): Promise<{ adjustment: ReceivableAdjustmentRecord; changed: boolean; effects: unknown }> {
    const response = await api.post<unknown, ApiDataResponse<{ adjustment: unknown; changed: boolean; effects: unknown }>>(`/finance/receivable-adjustments/${id}/post`);
    return {
      adjustment: mapReceivableAdjustment(response.data.adjustment),
      changed: Boolean(response.data.changed),
      effects: response.data.effects,
    };
  },

  async reverse(id: number, note?: string): Promise<{ adjustment: ReceivableAdjustmentRecord; changed: boolean; effects: unknown }> {
    const response = await api.post<unknown, ApiDataResponse<{ adjustment: unknown; changed: boolean; effects: unknown }>>(`/finance/receivable-adjustments/${id}/reverse`, { note });
    return {
      adjustment: mapReceivableAdjustment(response.data.adjustment),
      changed: Boolean(response.data.changed),
      effects: response.data.effects,
    };
  },
};
