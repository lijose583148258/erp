import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../utils/api';
import type { DashboardOverview, DashboardTrend } from '../shared/contracts/dashboard';
import { dashboardService } from './dashboard.service';

vi.mock('../utils/api', () => ({
  default: {
    get: vi.fn(),
  },
}));

const apiGet = vi.mocked(api.get);

const dashboardOverview: DashboardOverview = {
  overview: {
    totalCustomers: 12,
    activeCustomers: 9,
    totalOrders: 30,
    totalRevenue: 120000,
    pendingOrders: 3,
    deliveredOrders: 20,
    pendingShipments: 4,
    pendingRmas: 1,
    riskCustomers: 2,
    pendingCommissions: 5,
    overdueAmount: 18000,
  },
  monthly: {
    orderCount: 8,
    revenue: 45000,
  },
  weekly: {
    orderCount: 2,
    revenue: 9000,
  },
  ordersByStatus: {
    pending: {
      count: 3,
      amount: 18000,
    },
  },
  recentOrders: [
    {
      id: 101,
      orderNo: 'SO-101',
      customerName: 'Ailao Test Customer',
      amount: 5000,
      status: 'pending',
      createdAt: '2026-07-08T00:00:00.000Z',
    },
  ],
  inventoryAlerts: [
    {
      sku: 'BATCH-001',
      name: 'Resin',
      stock: 80,
      reorderPoint: 500,
      pendingOrders: 0,
      daysOfStock: 1,
      priority: 'high',
      suggestion: '库存极低，建议立即采购补货。',
    },
  ],
  systemStatus: {
    load: '1.2min',
    sessions: 0,
  },
};

describe('dashboardService', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('loads dashboard overview through the shared contract shape', async () => {
    const controller = new AbortController();
    apiGet.mockResolvedValueOnce({ data: dashboardOverview });

    await expect(dashboardService.getStats({ signal: controller.signal })).resolves.toEqual(dashboardOverview);
    expect(apiGet).toHaveBeenCalledWith('/dashboard', { signal: controller.signal });
  });

  it('falls back to the zero-value dashboard contract when payload is missing', async () => {
    apiGet.mockResolvedValueOnce({ data: null });

    const result = await dashboardService.getStats();

    expect(result.overview.totalCustomers).toBe(0);
    expect(result.monthly.revenue).toBe(0);
    expect(result.weekly.orderCount).toBe(0);
    expect(result.ordersByStatus).toEqual({});
    expect(result.recentOrders).toEqual([]);
  });

  it('loads trend arrays and rejects malformed trend payloads', async () => {
    const trends: DashboardTrend[] = [
      { date: '2026-07-08', count: 2, amount: 9000, risk: 0 },
    ];
    apiGet.mockResolvedValueOnce({ data: trends });
    apiGet.mockResolvedValueOnce({ data: { unexpected: true } });

    await expect(dashboardService.getTrends()).resolves.toEqual(trends);
    await expect(dashboardService.getTrends()).resolves.toEqual([]);
    expect(apiGet).toHaveBeenNthCalledWith(1, '/dashboard/trends', {});
  });
});
