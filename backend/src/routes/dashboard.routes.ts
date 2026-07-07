import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import type { DashboardOverview, DashboardTrend } from '../types/generated/dashboard.contract';
import { authenticate, authorizePermission, authRoute } from '../middleware/auth';
import prisma from '../config/database';
import { logger } from '../utils/logger';

const router = Router();

const toDashboardOverview = (overview: DashboardOverview): DashboardOverview => overview;

router.use(authenticate, authorizePermission('dashboard.read'));

/**
 * @route GET /api/dashboard
 * @desc 获取仪表盘统计数据
 */
router.get('/', authRoute(async (req, res) => {
    try {
        const isSales = req.user?.role === 'sales';
        const salesUserId = req.user?.userId;
        const orderWhere: Prisma.OrderWhereInput = {};
        const customerWhere: Prisma.CustomerWhereInput | undefined = isSales && salesUserId ? { salespersonId: salesUserId } : undefined;
        const shipmentWhere: Prisma.ShipmentWhereInput = { status: 'pending' };
        const rmaWhere: Prisma.RmaWhereInput = { status: 'pending' };
        const riskCustomerWhere: Prisma.CustomerWhereInput = {
            riskLevel: { in: ['high', 'critical'] },
            status: 'active',
        };
        const commissionWhere: Prisma.OrderWhereInput = { commissionStatus: 'pending', commissionAmount: { gt: 0 } };

        // 销售看板必须按本人业务闭环收口，避免库存、风险、佣金等全局数据泄露。
        if (isSales && salesUserId) {
            orderWhere.createdBy = salesUserId;
            shipmentWhere.createdBy = salesUserId;
            rmaWhere.createdBy = salesUserId;
            riskCustomerWhere.salespersonId = salesUserId;
            commissionWhere.createdBy = salesUserId;
        }

        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());

        // 并行查询所有统计数据 - 优化24人并发性能
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
            // 客户统计
            prisma.customer.groupBy({
                by: ['status'],
                where: customerWhere,
                _count: true,
            }),

            // 订单统计
            prisma.order.groupBy({
                by: ['status'],
                where: orderWhere,
                _count: true,
                _sum: { finalAmount: true },
            }),

            // 本月订单
            prisma.order.aggregate({
                where: { ...orderWhere, createdAt: { gte: startOfMonth } },
                _count: true,
                _sum: { finalAmount: true },
            }),

            // 本周订单
            prisma.order.aggregate({
                where: { ...orderWhere, createdAt: { gte: startOfWeek } },
                _count: true,
                _sum: { finalAmount: true },
            }),

            // 最近订单
            prisma.order.findMany({
                where: orderWhere,
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

            // 待发货
            prisma.shipment.count({
                where: shipmentWhere,
            }),

            // 待处理售后
            prisma.rma.count({
                where: rmaWhere,
            }),

            // 高风险客户
            prisma.customer.count({
                where: riskCustomerWhere,
            }),

            // 待审核佣金
            prisma.order.count({
                where: commissionWhere,
            }),

            // 逾期总额
            prisma.customer.aggregate({
                where: customerWhere,
                _sum: { overdueAmount: true },
            }),

            // 库存预警以仓储余额为准，避免 product_batches 的批次登记量与真实库存余额分裂。
            isSales ? Promise.resolve([]) : prisma.stockBalance.findMany({
                where: {
                    quantity: { lt: 500 } // 实战逻辑：少于500为预警
                },
                orderBy: { quantity: 'asc' },
                take: 5,
                select: {
                    batchNo: true,
                    productName: true,
                    quantity: true,
                    unit: true,
                }
            })
        ]);

        // 格式化统计数据
        const customerTotal = customerStats.reduce((sum, s) => sum + s._count, 0);
        const activeCustomers = customerStats.find((s) => s.status === 'active')?._count || 0;

        const orderTotal = orderStats.reduce((sum, s) => sum + s._count, 0);
        const totalRevenue = orderStats.reduce((sum, s) => sum + Number(s._sum.finalAmount || 0), 0);
        const pendingOrders = orderStats.find((s) => s.status === 'pending')?._count || 0;
        const deliveredOrders = orderStats.find((s) => s.status === 'delivered')?._count || 0;

        res.json({
            success: true,
            data: toDashboardOverview({
                // 概览卡片
                overview: {
                    totalCustomers: customerTotal,
                    activeCustomers,
                    totalOrders: orderTotal,
                    totalRevenue,
                    pendingOrders,
                    deliveredOrders,
                    pendingShipments,
                    pendingRmas,
                    riskCustomers,
                    pendingCommissions,
                    overdueAmount: Number(overdueStats._sum.overdueAmount || 0),
                },
                // 本月数据
                monthly: {
                    orderCount: monthlyOrders._count,
                    revenue: Number(monthlyOrders._sum.finalAmount || 0),
                },
                // 本周数据
                weekly: {
                    orderCount: weeklyOrders._count,
                    revenue: Number(weeklyOrders._sum.finalAmount || 0),
                },
                // 订单状态分布
                ordersByStatus: orderStats.reduce((acc, s) => {
                    acc[s.status] = {
                        count: s._count,
                        amount: Number(s._sum.finalAmount || 0),
                    };
                    return acc;
                }, {} as Record<string, { count: number; amount: number }>),
                // 最近订单
                recentOrders: recentOrders.map(o => ({
                    id: o.id,
                    orderNo: o.orderNo,
                    customerName: o.customer.name,
                    amount: Number(o.finalAmount),
                    status: o.status,
                    createdAt: o.createdAt.toISOString(),
                })),
                // 真实库存预警转换为前端格式
                inventoryAlerts: inventoryAlerts.map(inv => ({
                    sku: inv.batchNo,
                    name: inv.productName,
                    stock: inv.quantity,
                    reorderPoint: 500,
                    pendingOrders: 0,
                    daysOfStock: inv.quantity > 0 ? Math.max(1, Math.floor(inv.quantity / 50)) : 0,
                    priority: inv.quantity < 100 ? 'high' as const : inv.quantity < 300 ? 'medium' as const : 'low' as const,
                    suggestion: inv.quantity < 100 ? '库存极低，建议立即采购补货。' : '库存偏低，请关注后续订单需求。'
                })),
                // 系统状态快照
                systemStatus: {
                    load: (process.uptime() / 60).toFixed(1) + 'min',
                    sessions: 0
                }
            }),
        });
    } catch (error) {
        logger.error('获取仪表盘数据错误:', error);
        res.status(500).json({ success: false, message: '服务器内部错误' });
    }
}));

/**
 * @route GET /api/dashboard/trends
 * @desc 获取趋势数据 (最近30天)
 */
router.get('/trends', authRoute(async (req, res) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const orders = await prisma.order.findMany({
            where: {
                createdAt: { gte: thirtyDaysAgo },
                ...(req.user?.role === 'sales' ? { createdBy: req.user.userId } : {}),
            },
            select: {
                createdAt: true,
                finalAmount: true,
            },
        });

        // 按日期分组
        const dailyData: Record<string, { count: number; amount: number; riskAmount: number }> = {};

        orders.forEach(o => {
            const date = o.createdAt.toISOString().split('T')[0];
            if (!dailyData[date]) {
                dailyData[date] = { count: 0, amount: 0, riskAmount: 0 };
            }
            dailyData[date].count++;
            dailyData[date].amount += Number(o.finalAmount);
            // 风险金额应基于客户实际逾期状态，此处暂置零
        });

        // 转换为数组
        const trends: DashboardTrend[] = Object.entries(dailyData)
            .map(([date, data]) => ({
                date,
                count: data.count,
                amount: data.amount,
                risk: data.riskAmount
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        res.json({
            success: true,
            data: trends,
        });
    } catch (error) {
        logger.error('获取趋势数据错误:', error);
        res.status(500).json({ success: false, message: '服务器内部错误' });
    }
}));

export default router;
