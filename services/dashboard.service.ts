import api, { ApiRequestOptions } from '../utils/api';
import type { DashboardOverview, DashboardTrend } from '../shared/contracts/dashboard';

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
