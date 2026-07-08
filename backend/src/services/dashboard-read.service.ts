import type { DashboardOverview, DashboardTrend } from '../types/generated/dashboard.contract';
import { dashboardRepository, type DashboardAccessScope } from '../repositories/dashboard.repository';

const toDashboardOverview = (overview: DashboardOverview): DashboardOverview => overview;

export const getDashboardOverview = async (scope: DashboardAccessScope): Promise<DashboardOverview> => {
  const snapshot = await dashboardRepository.getOverviewSnapshot(scope);

  const customerTotal = snapshot.customerStats.reduce((sum, item) => sum + item._count, 0);
  const activeCustomers = snapshot.customerStats.find((item) => item.status === 'active')?._count || 0;
  const orderTotal = snapshot.orderStats.reduce((sum, item) => sum + item._count, 0);
  const totalRevenue = snapshot.orderStats.reduce((sum, item) => sum + Number(item._sum.finalAmount || 0), 0);
  const pendingOrders = snapshot.orderStats.find((item) => item.status === 'pending')?._count || 0;
  const deliveredOrders = snapshot.orderStats.find((item) => item.status === 'delivered')?._count || 0;

  return toDashboardOverview({
    overview: {
      totalCustomers: customerTotal,
      activeCustomers,
      totalOrders: orderTotal,
      totalRevenue,
      pendingOrders,
      deliveredOrders,
      pendingShipments: snapshot.pendingShipments,
      pendingRmas: snapshot.pendingRmas,
      riskCustomers: snapshot.riskCustomers,
      pendingCommissions: snapshot.pendingCommissions,
      overdueAmount: Number(snapshot.overdueStats._sum.overdueAmount || 0),
    },
    monthly: {
      orderCount: snapshot.monthlyOrders._count,
      revenue: Number(snapshot.monthlyOrders._sum.finalAmount || 0),
    },
    weekly: {
      orderCount: snapshot.weeklyOrders._count,
      revenue: Number(snapshot.weeklyOrders._sum.finalAmount || 0),
    },
    ordersByStatus: snapshot.orderStats.reduce((acc, item) => {
      acc[item.status] = {
        count: item._count,
        amount: Number(item._sum.finalAmount || 0),
      };
      return acc;
    }, {} as DashboardOverview['ordersByStatus']),
    recentOrders: snapshot.recentOrders.map((item) => ({
      id: item.id,
      orderNo: item.orderNo,
      customerName: item.customer.name,
      amount: Number(item.finalAmount),
      status: item.status,
      createdAt: item.createdAt.toISOString(),
    })),
    inventoryAlerts: snapshot.inventoryAlerts.map((item) => ({
      sku: item.batchNo,
      name: item.productName,
      stock: item.quantity,
      reorderPoint: 500,
      pendingOrders: 0,
      daysOfStock: item.quantity > 0 ? Math.max(1, Math.floor(item.quantity / 50)) : 0,
      priority: item.quantity < 100 ? 'high' : item.quantity < 300 ? 'medium' : 'low',
      suggestion: item.quantity < 100 ? '库存极低，建议立即采购补货。' : '库存偏低，请关注后续订单需求。',
    })),
    systemStatus: {
      load: `${(process.uptime() / 60).toFixed(1)}min`,
      sessions: 0,
    },
  });
};

export const getDashboardTrends = async (scope: DashboardAccessScope): Promise<DashboardTrend[]> => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const orders = await dashboardRepository.getTrendOrders(scope, thirtyDaysAgo);
  const dailyData: Record<string, { count: number; amount: number; riskAmount: number }> = {};

  orders.forEach((item) => {
    const date = item.createdAt.toISOString().split('T')[0];
    if (!dailyData[date]) {
      dailyData[date] = { count: 0, amount: 0, riskAmount: 0 };
    }
    dailyData[date].count++;
    dailyData[date].amount += Number(item.finalAmount);
  });

  return Object.entries(dailyData)
    .map(([date, data]) => ({
      date,
      count: data.count,
      amount: data.amount,
      risk: data.riskAmount,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
};
