import api, { ApiRequestOptions } from '../utils/api';

export interface AuditLog {
    id: number;
    userId: number;
    action: string;
    resource: string;
    resourceId?: number;
    details?: string;
    ipAddress?: string;
    userAgent?: string;
    createdAt: string;
    user?: {
        username: string;
        role: string;
    };
}

export interface AuditLogResponse {
    success: boolean;
    data: AuditLog[];
    meta: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    };
}

export const auditService = {
    /**
     * 获取审计日志列表
     */
    async getLogs(params: {
        page?: number;
        pageSize?: number;
        userId?: number;
        action?: string;
        resource?: string;
        startDate?: string;
        endDate?: string;
    }, options: ApiRequestOptions = {}): Promise<AuditLogResponse> {
        const response = await api.get('/audit', { params, signal: options.signal });
        // 直接返回 response，因为它包含了 { success, data, meta }
        return response as any;
    },
};
