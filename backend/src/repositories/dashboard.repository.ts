import type { Prisma } from '@prisma/client';
import prisma from '../config/database';

export interface DashboardAccessScope {
  role?: string;
  userId?: number;
}

export interface DashboardRecentOrderRow {
  id: number;
  orderNo: string;
  finalAmount: number;
  status: string;
  createdAt: Date;
  customer: { name: string };
}

export interface DashboardInventoryAlertRow {
  batchNo: string;
  productName: string;
  quantity: number;
  unit: string;
}

export interface DashboardOrderTrendRow {
  createdAt: Date;
  finalAmount: number;
}

const isSalesScope = (scope: DashboardAccessScope) => scope.role === 'sales';

const buildScopedDashboardWhere = (scope: DashboardAccessScope) => {
  const isSales = isSalesScope(scope);
  const salesUserId = scope.userId;
  const orderWhere: Prisma.OrderWhereInput = {};
  const customerWhere: Prisma.CustomerWhereInput | undefined = isSales && salesUserId ? { salespersonId: salesUserId } : undefined;
  const shipmentWhere: Prisma.ShipmentWhereInput = { status: 'pending' };
  const rmaWhere: Prisma.RmaWhereInput = { status: 'pending' };
  const riskCustomerWhere: Prisma.CustomerWhereInput = {
    riskLevel: { in: ['high', 'critical'] },
    status: 'active',
  };
  const commissionWhere: Prisma.OrderWhereInput = { commissionStatus: 'pending', commissionAmount: { gt: 0 } };

  if (isSales && salesUserId) {
    orderWhere.createdBy = salesUserId;
    shipmentWhere.createdBy = salesUserId;
    rmaWhere.createdBy = salesUserId;
    riskCustomerWhere.salespersonId = salesUserId;
    commissionWhere.createdBy = salesUserId;
  }

  return {
    isSales,
    orderWhere,
    customerWhere,
    shipmentWhere,
    rmaWhere,
    riskCustomerWhere,
    commissionWhere,
  };
};

export const dashboardRepository = {
  async getOverviewSnapshot(scope: DashboardAccessScope, now = new Date()) {
    const scoped = buildScopedDashboardWhere(scope);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());

    const [
      customerStats,
      orderStats,
      monthlyOrders,
      weeklyOrders,
      recentOrders,
      pendingShipments,
      pendingRmas,
      riskCustomers,
      pendingCommissions,
      overdueStats,
      inventoryAlerts,
    ] = await Promise.all([
      prisma.customer.groupBy({
        by: ['status'],
        where: scoped.customerWhere,
        _count: true,
      }),
      prisma.order.groupBy({
        by: ['status'],
        where: scoped.orderWhere,
        _count: true,
        _sum: { finalAmount: true },
      }),
      prisma.order.aggregate({
        where: { ...scoped.orderWhere, createdAt: { gte: startOfMonth } },
        _count: true,
        _sum: { finalAmount: true },
      }),
      prisma.order.aggregate({
        where: { ...scoped.orderWhere, createdAt: { gte: startOfWeek } },
        _count: true,
        _sum: { finalAmount: true },
      }),
      prisma.order.findMany({
        where: scoped.orderWhere,
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          orderNo: true,
          finalAmount: true,
          status: true,
          createdAt: true,
          customer: { select: { name: true } },
        },
      }),
      prisma.shipment.count({
        where: scoped.shipmentWhere,
      }),
      prisma.rma.count({
        where: scoped.rmaWhere,
      }),
      prisma.customer.count({
        where: scoped.riskCustomerWhere,
      }),
      prisma.order.count({
        where: scoped.commissionWhere,
      }),
      prisma.customer.aggregate({
        where: scoped.customerWhere,
        _sum: { overdueAmount: true },
      }),
      scoped.isSales ? Promise.resolve([]) : prisma.stockBalance.findMany({
        where: {
          quantity: { lt: 500 },
        },
        orderBy: { quantity: 'asc' },
        take: 5,
        select: {
          batchNo: true,
          productName: true,
          quantity: true,
          unit: true,
        },
      }),
    ]);

    return {
      customerStats,
      orderStats,
      monthlyOrders,
      weeklyOrders,
      recentOrders: recentOrders as DashboardRecentOrderRow[],
      pendingShipments,
      pendingRmas,
      riskCustomers,
      pendingCommissions,
      overdueStats,
      inventoryAlerts: inventoryAlerts as DashboardInventoryAlertRow[],
    };
  },

  async getTrendOrders(scope: DashboardAccessScope, since: Date): Promise<DashboardOrderTrendRow[]> {
    return prisma.order.findMany({
      where: {
        createdAt: { gte: since },
        ...(isSalesScope(scope) ? { createdBy: scope.userId } : {}),
      },
      select: {
        createdAt: true,
        finalAmount: true,
      },
    });
  },
};
