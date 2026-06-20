import api from '../utils/api';
import freeAIService from './freeAIService';

export const contractService = {
    /**
     * 获取合同列表
     */
    async getAll(params: {
        page?: number;
        pageSize?: number;
        status?: string;
        customerId?: string;
        type?: 'sales' | 'purchase';
    } = {}): Promise<{ data: any[], meta: any }> {
        const response = await api.get('/contracts', { params });
        return response.data;
    },

    /**
     * 兼容订单工作台旧调用口径
     */
    async getContracts(params: {
        page?: number;
        pageSize?: number;
        status?: string;
        customerId?: string;
        type?: 'sales' | 'purchase';
    } = {}): Promise<{ contracts: any[]; meta: any }> {
        const response = await this.getAll(params);
        return {
            contracts: response.data || [],
            meta: response.meta || null,
        };
    },

    /**
     * 获取单个合同详情
     */
    async getById(id: string): Promise<any> {
        const response = await api.get(`/contracts/${id}`);
        return response.data;
    },

    /**
     * 创建合同
     */
    async create(contract: any): Promise<any> {
        const response = await api.post('/contracts', contract);
        return response.data;
    },

    /**
     * 更新合同
     */
    async update(id: string, data: any): Promise<any> {
        const response = await api.patch(`/contracts/${id}`, data);
        return response.data;
    },

    /**
     * AI 识别文件 (OCR)
     */
    async analyzeFile(file: File): Promise<any> {
        return freeAIService.analyzeContractFile(file);
    }
};
