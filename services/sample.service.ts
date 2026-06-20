import api, { ApiRequestOptions } from '../utils/api';
import { SampleRecord } from '../types';

export type CreateSampleInput = Partial<SampleRecord> & {
    customerId?: string | number;
    shippingAddress?: string;
    unit?: string;
};

export const sampleService = {
    /**
     * 获取所有样品记录
     */
    async getAll(options: ApiRequestOptions = {}): Promise<SampleRecord[]> {
        const response = await api.get<any, { success: boolean; data: any[] }>('/samples', { signal: options.signal });
        const data = response.data || [];
        return data.map((item: any) => ({
            ...item,
            id: String(item.id),
            customerName: item.customer?.name || 'Unknown',
            customerNameZh: item.customer?.nameZh || undefined,
            customerNameEn: item.customer?.nameEn || undefined,
            customerNameVi: item.customer?.nameVi || undefined,
            customerDisplayName: item.customer?.nameZh || item.customer?.nameEn || item.customer?.nameVi || item.customer?.name || 'Unknown',
            productName: item.productName || 'Unknown Product',
            specifications: item.specifications || '-',
            quantity: String(item.quantity) || '1',
            status: item.status || 'requested',
            requestDate: item.createdAt ? new Date(item.createdAt).toISOString().split('T')[0] : '',
            needsFollowUp: false,
            followUpDate: ''
        }));
    },

    /**
     * 创建样品申请
     */
    async create(sample: CreateSampleInput): Promise<SampleRecord> {
        const response = await api.post<any, { success: boolean; data: any }>('/samples', sample);
        const item = response.data || {};
        return {
            ...item,
            id: String(item.id),
            requestDate: new Date().toISOString().split('T')[0],
            customerName: sample.customerName || 'Unknown',
            customerNameZh: sample.customerNameZh,
            customerNameEn: sample.customerNameEn,
            customerNameVi: sample.customerNameVi,
            customerDisplayName: sample.customerDisplayName || sample.customerName || 'Unknown',
            productName: sample.productName || 'Unknown Product',
            specifications: sample.specifications || '-',
            quantity: String(sample.quantity) || '1',
            status: item.status || 'requested',
            needsFollowUp: false,
            followUpDate: ''
        };
    },

    /**
     * 更新样品状态
     */
    async updateStatus(id: string, status: string): Promise<SampleRecord> {
        const response = await api.patch<any, { success: boolean; data: any }>(`/samples/${id}/status`, { status });
        const item = response.data;
        return {
            ...item,
            id: String(item.id),
            customerName: item.customer?.name || 'Unknown',
            customerNameZh: item.customer?.nameZh || undefined,
            customerNameEn: item.customer?.nameEn || undefined,
            customerNameVi: item.customer?.nameVi || undefined,
            customerDisplayName: item.customer?.nameZh || item.customer?.nameEn || item.customer?.nameVi || item.customer?.name || 'Unknown',
            productName: item.productName || 'Unknown Product',
            specifications: item.specifications || '-',
            quantity: String(item.quantity) || '1',
            status: item.status || 'requested',
            requestDate: item.createdAt ? new Date(item.createdAt).toISOString().split('T')[0] : '',
            needsFollowUp: false,
            followUpDate: ''
        };
    }
};
