import api, { ApiRequestOptions } from '../utils/api';

export interface DashboardOverview {
    overview: {
        totalCustomers: number;
        activeCustomers: number;
        totalOrders: number;
        totalRevenue: number;
        pendingOrders: number;
        deliveredOrders: number;
        pendingShipments: number;
        pendingRmas: number;
        riskCustomers: number;
        pendingCommissions: number;
        overdueAmount: number;
    };
    monthly: {
        orderCount: number;
        revenue: number;
    };
    weekly: {
        orderCount: number;
        revenue: number;
    };
    ordersByStatus: Record<string, { count: number; amount: number }>;
    recentOrders: Array<{
        id: number;
        orderNo: string;
        customerName: string;
        amount: number;
        status: string;
        createdAt: string;
    }>;
    inventoryAlerts?: Array<{
        sku: string;
        name: string;
        stock: number;
        reorderPoint: number;
        pendingOrders: number;
        daysOfStock: number;
        priority: 'high' | 'medium' | 'low';
        suggestion: string;
    }>;
    systemStatus?: {
        load: string;
        sessions: number;
    };
}

export interface DashboardTrend {
    date: string;
    count: number;
    amount: number;
}

const requestOptions = (options: ApiRequestOptions) =>
    options.signal ? { signal: options.signal } : {};

export const dashboardService = {
    /**
     * 获取仪表盘统计概览
     */
    async getStats(options: ApiRequestOptions = {}): Promise<DashboardOverview> {
        const response = await api.get<any, any>('/dashboard', requestOptions(options));
        const data = response?.data ?? response;
        if (data?.overview) {
            return data as DashboardOverview;
        }
        return {
            overview: { totalCustomers: 0, activeCustomers: 0, totalOrders: 0, totalRevenue: 0, pendingOrders: 0, deliveredOrders: 0, pendingShipments: 0, pendingRmas: 0, riskCustomers: 0, pendingCommissions: 0, overdueAmount: 0 },
            monthly: { orderCount: 0, revenue: 0 },
            weekly: { orderCount: 0, revenue: 0 },
            ordersByStatus: {},
            recentOrders: []
        };
    },

    /**
     * 获取销售趋势数据
     */
    async getTrends(options: ApiRequestOptions = {}): Promise<DashboardTrend[]> {
        const response = await api.get<any, any>('/dashboard/trends', requestOptions(options));
        const data = response?.data ?? response;
        return Array.isArray(data) ? data : [];
    }
};
