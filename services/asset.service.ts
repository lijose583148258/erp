import api, { ApiRequestOptions } from '../utils/api';

export interface AssetBalance {
    id: number;
    customerId: number;
    customerName?: string;
    customerNameZh?: string;
    customerNameEn?: string;
    customerNameVi?: string;
    customerDisplayName?: string;
    assetType: string;
    balance: number;
    updatedAt: string;
}

export interface AssetTransaction {
    id: number;
    customerId: number;
    customerName?: string;
    customerNameZh?: string;
    customerNameEn?: string;
    customerNameVi?: string;
    customerDisplayName?: string;
    assetType: string;
    quantity: number;
    action: 'inbound' | 'outbound';
    note: string | null;
    createdBy: number;
    createdByName?: string;
    createdAt: string;
}

export interface ProductBatch {
    id: number;
    batchNo: string;
    productName: string;
    productionDate: string;
    expiryDate: string;
    storageTemp?: string | null;
    isColdChain: boolean;
    stockQuantity: number;
    unit: string;
    notes?: string | null;
    remainingDays?: number;
    status?: 'expired' | 'expiring' | 'healthy';
}

export interface ProductBatchPaginationMeta {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
}

export type ProductBatchQuery = {
    status?: 'expired' | 'expiring' | 'healthy';
    keyword?: string;
    page?: number;
    pageSize?: number;
};

export interface ProductBatchPage {
    data: ProductBatch[];
    meta: ProductBatchPaginationMeta;
}

const defaultProductBatchMeta: ProductBatchPaginationMeta = {
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
};

export const assetService = {
    /**
     * 获取所有客户的资产余额
     */
    async getBalances(options: ApiRequestOptions = {}): Promise<AssetBalance[]> {
        const response = await api.get<any, { success: boolean; data: AssetBalance[] }>('/assets/balance', { signal: options.signal });
        return response.data || [];
    },

    /**
     * 获取指定客户的资产余额
     */
    async getCustomerBalance(customerId: number): Promise<AssetBalance[]> {
        const response = await api.get<any, { success: boolean; data: AssetBalance[] }>(`/assets/balance/${customerId}`);
        return response.data;
    },

    /**
     * 获取资产流转历史
     */
    async getHistory(options: ApiRequestOptions = {}): Promise<AssetTransaction[]> {
        const response = await api.get<any, { success: boolean; data: AssetTransaction[] }>('/assets/history', { signal: options.signal });
        return response.data || [];
    },

    /**
     * 录入资产流转记录
     */
    async recordMove(data: {
        customerId: number;
        assetType: string;
        quantity: number;
        action: 'inbound' | 'outbound';
        note?: string;
    }): Promise<AssetTransaction> {
        const response = await api.post<any, { success: boolean; data: AssetTransaction }>('/assets/record', data);
        return response.data;
    },

    async getBatchesPage(params?: ProductBatchQuery, options: ApiRequestOptions = {}): Promise<ProductBatchPage> {
        const response = await api.get<any, { success: boolean; data: ProductBatch[]; meta?: ProductBatchPaginationMeta }>('/assets/batches', { params, signal: options.signal });
        return {
            data: response.data || [],
            meta: response.meta || {
                ...defaultProductBatchMeta,
                total: Array.isArray(response.data) ? response.data.length : 0,
            },
        };
    },

    async getBatches(params?: ProductBatchQuery, options: ApiRequestOptions = {}): Promise<ProductBatch[]> {
        const response = await this.getBatchesPage(params, options);
        return response.data;
    },

    async createBatch(data: {
        batchNo?: string;
        productName: string;
        productionDate: string;
        expiryDate: string;
        storageTemp?: string;
        isColdChain?: boolean;
        stockQuantity: number;
        unit: string;
        notes?: string;
    }): Promise<ProductBatch> {
        const response = await api.post<any, { success: boolean; data: ProductBatch }>('/assets/batches', data);
        return response.data;
    },

    async updateBatch(id: number, data: Partial<Omit<ProductBatch, 'id' | 'batchNo'>> & { batchNo?: string }): Promise<ProductBatch> {
        const response = await api.patch<any, { success: boolean; data: ProductBatch }>(`/assets/batches/${id}`, data);
        return response.data;
    },

    async deleteBatch(id: number): Promise<void> {
        await api.delete(`/assets/batches/${id}`);
    },

    // --- 向後兼容別名 (對接 Shipping.tsx 等存量頁面) ---
    /** @deprecated 使用 getBalances */
    async getSummaries(options: ApiRequestOptions = {}): Promise<any[]> {
        return this.getBalances(options);
    },
    /** @deprecated 使用 getHistory */
    async getAll(options: ApiRequestOptions = {}): Promise<AssetTransaction[]> {
        return this.getHistory(options);
    },
    /** @deprecated 使用 recordMove */
    async create(data: any): Promise<AssetTransaction> {
        return this.recordMove({
            ...data,
            assetType: data.type, // 兼容 type -> assetType
        });
    }
};
