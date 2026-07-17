// 通用 API 响应类型
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    message?: string;
    errorCode?: string;
    timestamp: string;
    meta?: {
        page?: number;
        pageSize?: number;
        total?: number;
        totalPages?: number;
    };
}

// 分页请求参数
export interface PaginationQuery {
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

// 用户相关类型
export interface LoginRequest {
    username: string;
    password: string;
    mfaCode?: string;
}

export interface LoginResponse {
    token: string;
    refreshToken: string;
    user: {
        id: number;
        username: string;
        email: string | null;
        role: string;
        segment?: string | null;
        avatar: string | null;
        mustChangePassword?: boolean;
        permissions?: string[];
        dataScopes?: string[];
    };
    expiresIn: number;
}

export interface RegisterRequest {
    username: string;
    password: string;
    email?: string;
    role?: string;
    segment?: 'direct' | 'channel' | 'mixed';
}

// 客户相关类型
export interface CustomerQuery extends PaginationQuery {
    search?: string;
    status?: string;
    riskLevel?: string;
    salespersonId?: number;
}

// 订单相关类型
export interface OrderQuery extends PaginationQuery {
    search?: string;
    status?: string;
    customerId?: number;
    startDate?: string;
    endDate?: string;
}

// 导入导出相关类型 - 针对500条录入、1000条导出优化
export const BATCH_IMPORT_LIMIT = 500;
export const BATCH_EXPORT_LIMIT = 1000;

export interface ImportResult {
    success: number;
    failed: number;
    errors: Array<{
        row: number;
        message: string;
    }>;
    attempted?: number;
    imported?: number;
    skipped?: number;
}

export const createImportResult = (): ImportResult => ({
    success: 0,
    failed: 0,
    errors: [],
});

export const addImportLimitError = (result: ImportResult, totalRows: number, limit = BATCH_IMPORT_LIMIT) => {
    if (totalRows <= limit) return;
    const skipped = totalRows - limit;
    result.failed += skipped;
    result.skipped = (result.skipped || 0) + skipped;
    result.errors.push({ row: limit + 1, message: `Import limit is ${limit} rows; ${skipped} extra rows were skipped.` });
};

export interface ExportOptions {
    format: 'xlsx' | 'csv';
    fields?: string[];
    filters?: Record<string, any>;
}
