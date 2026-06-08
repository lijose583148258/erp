import api, { ApiRequestOptions } from '../utils/api';
import { ApiDataResponse, toApiRecord, toNumberValue, toOptionalString, toStringValue, toUnknownArray } from '../utils/apiMapping';
import { RmaRecord, RmaStatus } from '../types';

export type CreateRmaInput = Partial<RmaRecord> & {
    customerId?: string | number;
    productName?: string;
    quantity?: string | number;
    unit?: string;
    reason?: string;
};

const toDateOnly = (value: unknown, fallback = ''): string => {
    const text = toOptionalString(value);
    if (!text) return fallback;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return fallback;
    return date.toISOString().split('T')[0];
};

const mapRmaRecord = (value: unknown, fallback: Partial<RmaRecord> = {}): RmaRecord => {
    const item = toApiRecord(value);
    const customer = toApiRecord(item.customer);
    const order = toApiRecord(item.order);
    const customerName = toOptionalString(customer.name) || fallback.customerName || 'Unknown';
    const customerNameZh = toOptionalString(customer.nameZh) || fallback.customerNameZh;
    const customerNameEn = toOptionalString(customer.nameEn) || fallback.customerNameEn;
    const customerNameVi = toOptionalString(customer.nameVi) || fallback.customerNameVi;

    return {
        ...fallback,
        ...item,
        id: toStringValue(item.id),
        orderNo: toOptionalString(order.orderNo) || fallback.orderNo || '',
        customerName,
        customerNameZh,
        customerNameEn,
        customerNameVi,
        customerDisplayName: customerNameZh || customerNameEn || customerNameVi || customerName,
        productName: toOptionalString(item.productName) || fallback.productName,
        quantity: item.quantity != null ? toStringValue(item.quantity) : fallback.quantity,
        unit: toOptionalString(item.unit) || fallback.unit,
        reason: toStringValue(item.reason, fallback.reason || ''),
        status: toStringValue(item.status, fallback.status || RmaStatus.PENDING) as RmaRecord['status'],
        type: toStringValue(item.type, fallback.type || 'return'),
        createdAt: toStringValue(item.createdAt, fallback.createdAt || ''),
        orderId: toStringValue(item.orderId),
        refundAmount: toNumberValue(item.refundAmount),
        requestDate: toDateOnly(item.createdAt, fallback.createdAt ? toDateOnly(fallback.createdAt) : ''),
    };
};

export const rmaService = {
    /**
     * 获取所有售后记录
     */
    async getAll(options: ApiRequestOptions = {}): Promise<RmaRecord[]> {
        const response = await api.get<unknown, ApiDataResponse<unknown[]>>('/rma?pageSize=100', { signal: options.signal });
        return toUnknownArray(response.data).map((item) => mapRmaRecord(item));
    },

    /**
     * 创建售后记录
     */
    async create(rma: CreateRmaInput): Promise<RmaRecord> {
        const response = await api.post<unknown, ApiDataResponse<unknown>>('/rma', rma);
        return mapRmaRecord(response.data, {
            ...rma,
            createdAt: new Date().toISOString(),
        });
    },

    /**
     * 更新售后状态
     */
    async updateStatus(id: string, status: string, resolution?: string, fallback: Partial<RmaRecord> = {}): Promise<RmaRecord> {
        const response = await api.patch<unknown, ApiDataResponse<unknown>>(`/rma/${id}/resolve`, { status, resolution });
        return mapRmaRecord(response.data, fallback);
    }
};
