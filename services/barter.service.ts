import api, { ApiRequestOptions } from '../utils/api';
import {
  ApiDataResponse,
  ApiRecord,
  toApiRecord,
  toNumberValue,
  toOptionalString,
  toStringValue,
  toUnknownArray,
} from '../utils/apiMapping';

export type BarterSide = 'our' | 'counterparty';
export type BarterCounterpartyType = 'customer' | 'supplier' | 'other';
export type BarterSettlementMode = 'barter' | 'mixed' | 'cash_top_up' | 'cash_refund';
export type BarterSettlementStatus = 'draft' | 'quoted' | 'approved' | 'posted' | 'reversed' | 'closed';
export type BarterAgreementStatus = 'draft' | 'active' | 'partial' | 'completed' | 'closed' | 'terminated';

export interface BarterItem {
  id?: number;
  side: BarterSide;
  itemName: string;
  specification?: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  qualityFactor?: number;
  lossFactor?: number;
  marketValue?: number;
  valuationMethod?: string | null;
  sourceDocument?: string | null;
  note?: string | null;
}

export interface BarterSettlement {
  id: number;
  settlementNo: string;
  agreementId?: number | null;
  agreementNo?: string | null;
  batchIndex?: number | null;
  counterpartyType: BarterCounterpartyType;
  counterpartyName: string;
  customerId?: number | null;
  supplierId?: number | null;
  orderId?: number | null;
  settlementMode: BarterSettlementMode;
  totalPartyAValue: number;
  totalPartyBValue: number;
  cashDifference: number;
  currency: string;
  status: BarterSettlementStatus;
  valuationDate?: string | null;
  approvedAt?: string | null;
  postedAt?: string | null;
  reversedAt?: string | null;
  note?: string | null;
  customerDisplayName?: string | null;
  supplierDisplayName?: string | null;
  items?: BarterItem[];
  valuationSnapshots?: ApiRecord[];
  offsetPostings?: ApiRecord[];
  reversalLogs?: ApiRecord[];
  paymentRecord?: ApiRecord | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface BarterAgreement {
  id: number;
  agreementNo: string;
  counterpartyType: BarterCounterpartyType;
  counterpartyName: string;
  customerId?: number | null;
  supplierId?: number | null;
  orderId?: number | null;
  settlementMode: BarterSettlementMode;
  totalPartyAValue: number;
  totalPartyBValue: number;
  agreedOffsetAmount: number;
  executedOffsetAmount: number;
  remainingOffsetAmount: number;
  completionRatio: number;
  currency: string;
  status: BarterAgreementStatus;
  agreementDate?: string | null;
  valuationDate?: string | null;
  note?: string | null;
  customerDisplayName?: string | null;
  supplierDisplayName?: string | null;
  batchCount?: number;
  items?: BarterItem[];
  settlements?: BarterSettlement[];
  createdAt?: string;
  updatedAt?: string;
}

export interface BarterSummary {
  settlementCount: number;
  quotedCount: number;
  approvedCount: number;
  postedCount: number;
  reversedCount: number;
  totalOffset: number;
  totalCashDifference: number;
}

export interface BarterPreview {
  totalPartyAValue: number;
  totalPartyBValue: number;
  cashDifference: number;
  settlementMode: BarterSettlementMode;
  suggestedOffsetAmount: number;
  items: BarterItem[];
}

export interface BarterListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: BarterSettlement[];
}

export interface BarterAgreementListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: BarterAgreement[];
}

export interface CreateBarterSettlementInput {
  agreementId?: number | null;
  batchIndex?: number | null;
  counterpartyType: BarterCounterpartyType;
  counterpartyName: string;
  customerId?: number | null;
  supplierId?: number | null;
  orderId?: number | null;
  settlementMode?: BarterSettlementMode;
  currency?: string;
  valuationDate?: string | null;
  note?: string | null;
  items: BarterItem[];
}

export interface CreateBarterAgreementInput {
  counterpartyType: BarterCounterpartyType;
  counterpartyName: string;
  customerId?: number | null;
  supplierId?: number | null;
  orderId?: number | null;
  settlementMode?: BarterSettlementMode;
  currency?: string;
  agreementDate?: string | null;
  valuationDate?: string | null;
  note?: string | null;
  items: BarterItem[];
}

export interface CreateBarterBatchInput {
  orderId?: number | null;
  valuationDate?: string | null;
  note?: string | null;
  items: BarterItem[];
}

const toNullableNumber = (value: unknown): number | null =>
  value === null || value === undefined || value === '' ? null : toNumberValue(value);

const toNullableString = (value: unknown): string | null =>
  value === null || value === undefined || value === '' ? null : toStringValue(value);

const toBarterSide = (value: unknown): BarterSide =>
  toStringValue(value, 'our') === 'counterparty' ? 'counterparty' : 'our';

const toCounterpartyType = (value: unknown): BarterCounterpartyType => {
  const normalized = toStringValue(value, 'customer');
  return normalized === 'supplier' || normalized === 'other' ? normalized : 'customer';
};

const toSettlementMode = (value: unknown): BarterSettlementMode => {
  const normalized = toStringValue(value, 'mixed');
  return ['barter', 'mixed', 'cash_top_up', 'cash_refund'].includes(normalized)
    ? normalized as BarterSettlementMode
    : 'mixed';
};

const toSettlementStatus = (value: unknown): BarterSettlementStatus => {
  const normalized = toStringValue(value, 'quoted');
  return ['draft', 'quoted', 'approved', 'posted', 'reversed', 'closed'].includes(normalized)
    ? normalized as BarterSettlementStatus
    : 'quoted';
};

const toAgreementStatus = (value: unknown): BarterAgreementStatus => {
  const normalized = toStringValue(value, 'active');
  return ['draft', 'active', 'partial', 'completed', 'closed', 'terminated'].includes(normalized)
    ? normalized as BarterAgreementStatus
    : 'active';
};

const mapBarterItem = (value: unknown): BarterItem => {
  const item = toApiRecord(value);
  return {
    ...item,
    id: item.id == null ? undefined : toNumberValue(item.id),
    side: toBarterSide(item.side),
    itemName: toStringValue(item.itemName || item.name),
    specification: toNullableString(item.specification),
    unit: toStringValue(item.unit, 'kg'),
    quantity: toNumberValue(item.quantity),
    unitPrice: toNumberValue(item.unitPrice),
    qualityFactor: toNumberValue(item.qualityFactor, 1),
    lossFactor: toNumberValue(item.lossFactor, 1),
    marketValue: toNumberValue(item.marketValue),
    valuationMethod: toNullableString(item.valuationMethod),
    sourceDocument: toNullableString(item.sourceDocument),
    note: toNullableString(item.note),
  };
};

const toApiRecordList = (value: unknown): ApiRecord[] =>
  toUnknownArray(value).map(toApiRecord);

const mapSettlement = (value: unknown): BarterSettlement => {
  const item = toApiRecord(value);
  return {
    ...item,
    id: toNumberValue(item.id),
    settlementNo: toStringValue(item.settlementNo),
    agreementId: toNullableNumber(item.agreementId),
    agreementNo: toNullableString(item.agreementNo),
    batchIndex: toNullableNumber(item.batchIndex),
    counterpartyType: toCounterpartyType(item.counterpartyType),
    counterpartyName: toStringValue(item.counterpartyName),
    customerId: toNullableNumber(item.customerId),
    supplierId: toNullableNumber(item.supplierId),
    orderId: toNullableNumber(item.orderId),
    settlementMode: toSettlementMode(item.settlementMode),
    totalPartyAValue: toNumberValue(item.totalPartyAValue),
    totalPartyBValue: toNumberValue(item.totalPartyBValue),
    cashDifference: toNumberValue(item.cashDifference),
    currency: toStringValue(item.currency, 'CNY'),
    status: toSettlementStatus(item.status),
    valuationDate: toNullableString(item.valuationDate),
    approvedAt: toNullableString(item.approvedAt),
    postedAt: toNullableString(item.postedAt),
    reversedAt: toNullableString(item.reversedAt),
    note: toNullableString(item.note),
    customerDisplayName: toNullableString(item.customerDisplayName),
    supplierDisplayName: toNullableString(item.supplierDisplayName),
    items: toUnknownArray(item.items).map(mapBarterItem),
    valuationSnapshots: toApiRecordList(item.valuationSnapshots),
    offsetPostings: toApiRecordList(item.offsetPostings),
    reversalLogs: toApiRecordList(item.reversalLogs),
    paymentRecord: item.paymentRecord == null ? null : toApiRecord(item.paymentRecord),
    createdAt: toOptionalString(item.createdAt),
    updatedAt: toOptionalString(item.updatedAt),
  };
};

const mapAgreement = (value: unknown): BarterAgreement => {
  const item = toApiRecord(value);
  return {
    ...item,
    id: toNumberValue(item.id),
    agreementNo: toStringValue(item.agreementNo),
    counterpartyType: toCounterpartyType(item.counterpartyType),
    counterpartyName: toStringValue(item.counterpartyName),
    customerId: toNullableNumber(item.customerId),
    supplierId: toNullableNumber(item.supplierId),
    orderId: toNullableNumber(item.orderId),
    settlementMode: toSettlementMode(item.settlementMode),
    totalPartyAValue: toNumberValue(item.totalPartyAValue),
    totalPartyBValue: toNumberValue(item.totalPartyBValue),
    agreedOffsetAmount: toNumberValue(item.agreedOffsetAmount),
    executedOffsetAmount: toNumberValue(item.executedOffsetAmount),
    remainingOffsetAmount: toNumberValue(item.remainingOffsetAmount),
    completionRatio: toNumberValue(item.completionRatio),
    currency: toStringValue(item.currency, 'CNY'),
    status: toAgreementStatus(item.status),
    agreementDate: toNullableString(item.agreementDate),
    valuationDate: toNullableString(item.valuationDate),
    note: toNullableString(item.note),
    customerDisplayName: toNullableString(item.customerDisplayName),
    supplierDisplayName: toNullableString(item.supplierDisplayName),
    batchCount: toNumberValue(item.batchCount),
    items: toUnknownArray(item.items).map(mapBarterItem),
    settlements: toUnknownArray(item.settlements).map(mapSettlement),
    createdAt: toOptionalString(item.createdAt),
    updatedAt: toOptionalString(item.updatedAt),
  };
};

const mapSummary = (value: unknown): BarterSummary => {
  const item = toApiRecord(value);
  return {
    settlementCount: toNumberValue(item.settlementCount),
    quotedCount: toNumberValue(item.quotedCount),
    approvedCount: toNumberValue(item.approvedCount),
    postedCount: toNumberValue(item.postedCount),
    reversedCount: toNumberValue(item.reversedCount),
    totalOffset: toNumberValue(item.totalOffset),
    totalCashDifference: toNumberValue(item.totalCashDifference),
  };
};

const mapPreview = (value: unknown): BarterPreview => {
  const item = toApiRecord(value);
  return {
    totalPartyAValue: toNumberValue(item.totalPartyAValue),
    totalPartyBValue: toNumberValue(item.totalPartyBValue),
    cashDifference: toNumberValue(item.cashDifference),
    settlementMode: toSettlementMode(item.settlementMode),
    suggestedOffsetAmount: toNumberValue(item.suggestedOffsetAmount),
    items: toUnknownArray(item.items).map(mapBarterItem),
  };
};

const mapAgreementList = (value: unknown): BarterAgreementListResponse => {
  const item = toApiRecord(value);
  return {
    total: toNumberValue(item.total),
    page: toNumberValue(item.page, 1),
    pageSize: toNumberValue(item.pageSize, 20),
    items: toUnknownArray(item.items).map(mapAgreement),
  };
};

const mapSettlementList = (value: unknown): BarterListResponse => {
  const item = toApiRecord(value);
  return {
    total: toNumberValue(item.total),
    page: toNumberValue(item.page, 1),
    pageSize: toNumberValue(item.pageSize, 20),
    items: toUnknownArray(item.items).map(mapSettlement),
  };
};

export const barterService = {
  async getSummary(options: ApiRequestOptions = {}): Promise<BarterSummary> {
    const response = await api.get<unknown, ApiDataResponse<unknown>>('/barter/summary', { signal: options.signal });
    return mapSummary(response.data);
  },

  async listAgreements(query: { page?: number; pageSize?: number; search?: string; status?: string; counterpartyType?: string } = {}, options: ApiRequestOptions = {}): Promise<BarterAgreementListResponse> {
    const response = await api.get<unknown, ApiDataResponse<unknown>>('/barter/agreements', { params: query, signal: options.signal });
    return mapAgreementList(response.data);
  },

  async getAgreementById(id: number, options: ApiRequestOptions = {}): Promise<BarterAgreement> {
    const response = await api.get<unknown, ApiDataResponse<unknown>>(`/barter/agreements/${id}`, { signal: options.signal });
    return mapAgreement(response.data);
  },

  async list(query: { page?: number; pageSize?: number; search?: string; status?: string; counterpartyType?: string } = {}, options: ApiRequestOptions = {}): Promise<BarterListResponse> {
    const response = await api.get<unknown, ApiDataResponse<unknown>>('/barter/settlements', { params: query, signal: options.signal });
    return mapSettlementList(response.data);
  },

  async getById(id: number, options: ApiRequestOptions = {}): Promise<BarterSettlement> {
    const response = await api.get<unknown, ApiDataResponse<unknown>>(`/barter/settlements/${id}`, { signal: options.signal });
    return mapSettlement(response.data);
  },

  async preview(payload: CreateBarterSettlementInput): Promise<BarterPreview> {
    const response = await api.post<unknown, ApiDataResponse<unknown>>('/barter/preview', payload);
    return mapPreview(response.data);
  },

  async create(payload: CreateBarterSettlementInput): Promise<BarterSettlement> {
    const response = await api.post<unknown, ApiDataResponse<unknown>>('/barter/settlements', payload);
    return mapSettlement(response.data);
  },

  async createAgreement(payload: CreateBarterAgreementInput): Promise<BarterAgreement> {
    const response = await api.post<unknown, ApiDataResponse<unknown>>('/barter/agreements', payload);
    return mapAgreement(response.data);
  },

  async createBatch(agreementId: number, payload: CreateBarterBatchInput): Promise<BarterSettlement> {
    const response = await api.post<unknown, ApiDataResponse<unknown>>(`/barter/agreements/${agreementId}/batches`, payload);
    return mapSettlement(response.data);
  },

  async approve(id: number, note?: string): Promise<BarterSettlement> {
    const response = await api.patch<unknown, ApiDataResponse<unknown>>(`/barter/settlements/${id}/approve`, { note });
    return mapSettlement(response.data);
  },

  async post(id: number, payload?: { orderId?: number | null; postingAmount?: number; offsetType?: string; note?: string | null }): Promise<ApiRecord> {
    const response = await api.post<unknown, ApiDataResponse<unknown>>(`/barter/settlements/${id}/post`, payload || {});
    return toApiRecord(response.data);
  },

  async reverse(id: number, reason: string): Promise<BarterSettlement> {
    const response = await api.post<unknown, ApiDataResponse<unknown>>(`/barter/settlements/${id}/reverse`, { reason });
    return mapSettlement(response.data);
  },
};

export default barterService;
