import api, { ApiRequestOptions } from '../utils/api';
import { ApiDataResponse, toApiRecord, toNumberValue, toOptionalString, toStringValue } from '../utils/apiMapping';

export type AdjustmentDomain = 'finance' | 'production' | 'inventory';
export type AdjustmentTargetType = 'order' | 'productBatch' | 'manual';
export type AdjustmentStatus = 'pending' | 'posted' | 'reversed' | 'rejected';

export interface AdjustmentSummary {
    total: number;
    byDomain: Record<string, number>;
    byStatus: Record<string, number>;
    byReasonCategory?: Record<string, number>;
    amountDelta: number;
    quantityDelta: number;
    recentAdjustments?: AdjustmentRecord[];
}

export interface AdjustmentRecord {
    id: number;
    adjustmentNo: string;
    domain: AdjustmentDomain;
    targetType: AdjustmentTargetType;
    targetId: number | null;
    targetRef: string | null;
    orderId: number | null;
    orderNo: string | null;
    batchId: number | null;
    batchNo: string | null;
    productName: string | null;
    customerId: number | null;
    customerName: string | null;
    customerNameZh?: string | null;
    customerNameEn?: string | null;
    customerNameVi?: string | null;
    customerDisplayName?: string | null;
    quantityDelta: number | null;
    amountDelta: number | null;
    reason: string;
    reasonCategory: string | null;
    lossType: string | null;
    note: string | null;
    status: AdjustmentStatus;
    createdBy: number;
    creator?: {
        id: number;
        username: string;
        role: string;
    } | null;
    approvedBy: number | null;
    approver?: {
        id: number;
        username: string;
        role: string;
    } | null;
    approvedAt: string | null;
    appliedAt: string | null;
    beforeSnapshot: Record<string, unknown> | null;
    afterSnapshot: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
}

export interface AdjustmentListResponse {
    success: boolean;
    data: AdjustmentRecord[];
    meta: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    };
}

const toNullableNumber = (value: unknown): number | null =>
    value !== null && value !== undefined ? toNumberValue(value) : null;

const parseSnapshot = (value: unknown): Record<string, unknown> | null => {
    if (!value) {
        return null;
    }

    if (typeof value === 'object') {
        return value as Record<string, unknown>;
    }

    if (typeof value === 'string') {
        try {
            return toApiRecord(JSON.parse(value));
        } catch {
            return null;
        }
    }

    return null;
};

const mapAdjustment = (value: unknown): AdjustmentRecord => {
    const item = toApiRecord(value);
    return {
    ...item,
    id: toNumberValue(item.id),
    adjustmentNo: toStringValue(item.adjustmentNo),
    domain: item.domain as AdjustmentDomain,
    targetType: item.targetType as AdjustmentTargetType,
    targetId: toNullableNumber(item.targetId),
    targetRef: toOptionalString(item.targetRef) || null,
    orderId: toNullableNumber(item.orderId),
    orderNo: toOptionalString(item.orderNo) || null,
    batchId: toNullableNumber(item.batchId),
    batchNo: toOptionalString(item.batchNo) || null,
    productName: toOptionalString(item.productName) || null,
    customerId: toNullableNumber(item.customerId),
    customerName: toOptionalString(item.customerName) || null,
    quantityDelta: toNullableNumber(item.quantityDelta),
    amountDelta: toNullableNumber(item.amountDelta),
    reason: toStringValue(item.reason),
    reasonCategory: toOptionalString(item.reasonCategory) || null,
    lossType: toOptionalString(item.lossType) || null,
    note: toOptionalString(item.note) || null,
    status: item.status as AdjustmentStatus,
    createdBy: toNumberValue(item.createdBy),
    approvedBy: toNullableNumber(item.approvedBy),
    beforeSnapshot: parseSnapshot(item.beforeSnapshot),
    afterSnapshot: parseSnapshot(item.afterSnapshot),
    approvedAt: toOptionalString(item.approvedAt) || null,
    appliedAt: toOptionalString(item.appliedAt) || null,
    createdAt: toStringValue(item.createdAt),
    updatedAt: toStringValue(item.updatedAt),
    };
};

export const adjustmentService = {
    async getSummary(options: ApiRequestOptions = {}): Promise<AdjustmentSummary> {
        const response = await api.get<unknown, ApiDataResponse<AdjustmentSummary>>('/adjustments/summary', { signal: options.signal });
        return response.data || {
            total: 0,
            byDomain: {},
            byStatus: {},
            byReasonCategory: {},
            amountDelta: 0,
            quantityDelta: 0,
            recentAdjustments: [],
        };
    },

    async getAll(params?: {
        page?: number;
        pageSize?: number;
        domain?: string;
        targetType?: string;
        status?: string;
        orderId?: number;
        batchId?: number;
        customerId?: number;
    }, options: ApiRequestOptions = {}): Promise<AdjustmentListResponse> {
        const response = await api.get<unknown, AdjustmentListResponse>('/adjustments', { params, signal: options.signal });
        return {
            ...response,
            data: Array.isArray(response.data) ? response.data.map(mapAdjustment) : [],
        };
    },

    async getById(id: number): Promise<AdjustmentRecord> {
        const response = await api.get<unknown, ApiDataResponse<unknown>>(`/adjustments/${id}`);
        return mapAdjustment(response.data);
    },

    async create(data: {
        domain: AdjustmentDomain;
        targetType: AdjustmentTargetType;
        targetId?: number | null;
        orderId?: number | null;
        batchId?: number | null;
        customerId?: number | null;
        targetRef?: string | null;
        quantityDelta?: number | null;
        amountDelta?: number | null;
        reason: string;
        reasonCategory?: string | null;
        lossType?: string | null;
        note?: string | null;
        status?: AdjustmentStatus;
    }): Promise<{ adjustment: AdjustmentRecord; effects: unknown }> {
        const response = await api.post<unknown, ApiDataResponse<{ adjustment: unknown; effects: unknown }>>('/adjustments', data);
        return {
            adjustment: mapAdjustment(response.data.adjustment),
            effects: response.data.effects,
        };
    },

    async apply(id: number): Promise<{ adjustment: AdjustmentRecord; effects: unknown }> {
        const response = await api.post<unknown, ApiDataResponse<{ adjustment: unknown; effects: unknown }>>(`/adjustments/${id}/apply`);
        return {
            adjustment: mapAdjustment(response.data.adjustment),
            effects: response.data.effects,
        };
    },

    async reverse(id: number, note?: string): Promise<{ original: AdjustmentRecord; reverse: AdjustmentRecord | null }> {
        const response = await api.post<unknown, ApiDataResponse<{ original: unknown; reverse: unknown | null }>>(`/adjustments/${id}/reverse`, { note });
        return {
            original: mapAdjustment(response.data.original),
            reverse: response.data.reverse ? mapAdjustment(response.data.reverse) : null,
        };
    },
};
