import SpreadsheetWorkbook from '../infrastructure/spreadsheet-workbook';
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import {
    BATCH_EXPORT_LIMIT,
    OrderQuery,
} from '../types/api.types';
import { logger } from '../utils/logger';
import { decorateCommercialOrderState } from '../utils/orderCommercialState';
import { AuthRequest } from '../middleware/auth';
import { buildOrderDataScopeWhere, mergeWhereAnd } from '../utils/recordAccess';
import { buildOrderSearchWhereAsync } from './search.service';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_EXPORT_SIZE = BATCH_EXPORT_LIMIT;
const ORDER_SORT_KEY_MAP: Record<string, keyof Prisma.OrderOrderByWithRelationInput> = {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    orderNo: 'orderNo',
    finalAmount: 'finalAmount',
    paidAmount: 'paidAmount',
    status: 'status',
    paymentStatus: 'paymentStatus',
};

const ORDER_DETAIL_INCLUDE = {
    customer: {
        select: {
            id: true,
            name: true,
            nameZh: true,
            nameEn: true,
            nameVi: true,
            contactName: true,
            contactPhone: true,
            riskLevel: true,
            creditLimit: true,
        },
    },
    creator: {
        select: {
            id: true,
            username: true,
        },
    },
    items: true,
    shipments: {
        select: {
            id: true,
            shipmentNo: true,
            status: true,
            trackingNo: true,
            shippedAt: true,
            deliveredAt: true,
        },
    },
    paymentRecords: {
        orderBy: { createdAt: 'asc' as const },
        select: {
            id: true,
            amount: true,
            method: true,
            date: true,
            payerName: true,
            isProxy: true,
            note: true,
            status: true,
            verifiedBy: true,
            milestoneId: true,
            createdAt: true,
            milestone: {
                select: {
                    id: true,
                    title: true,
                    percentage: true,
                },
            },
        },
    },
    collectionPromises: {
        orderBy: { createdAt: 'desc' as const },
        select: {
            id: true,
            promiseNo: true,
            promisedAmount: true,
            promisedAt: true,
            channel: true,
            contactName: true,
            contactPhone: true,
            note: true,
            status: true,
            createdAt: true,
        },
    },
    receivableAdjustments: {
        orderBy: { createdAt: 'desc' as const },
        select: {
            id: true,
            adjustmentNo: true,
            adjustmentType: true,
            amount: true,
            status: true,
            reason: true,
            postedAt: true,
            reversedAt: true,
            createdAt: true,
        },
    },
    contract: {
        select: {
            id: true,
            contractNo: true,
            title: true,
        },
    },
} as const satisfies Prisma.OrderInclude;

type OrderDetail = Prisma.OrderGetPayload<{ include: typeof ORDER_DETAIL_INCLUDE }>;
const formatOrderDetail = (order: OrderDetail) => {
    const customer = order.customer;
    const normalized = {
        ...order,
        // 展平客户名（与 getOrders 对齐，修复前端 customerName 丢失）
        customerName: customer?.nameZh || customer?.nameEn || customer?.nameVi || customer?.name || null,
        customerNameZh: customer?.nameZh || null,
        customerNameEn: customer?.nameEn || null,
        customerNameVi: customer?.nameVi || null,
        customerDisplayName: customer?.nameZh || customer?.nameEn || customer?.nameVi || customer?.name || null,
        creatorName: order.creator?.username || null,
        totalAmount: Number(order.totalAmount),
        discountAmount: Number(order.discountAmount),
        finalAmount: Number(order.finalAmount),
        paidAmount: Number(order.paidAmount),
        receivableAdjustmentAmount: Number(order.receivableAdjustmentAmount),
        effectiveReceivableAmount: Math.max(0, Number(order.finalAmount) - Number(order.receivableAdjustmentAmount || 0)),
        outstandingAmount: Math.max(0, Number(order.finalAmount) - Number(order.receivableAdjustmentAmount || 0) - Number(order.paidAmount)),
        commissionRate: order.commissionRate ? Number(order.commissionRate) : null,
        commissionAmount: order.commissionAmount ? Number(order.commissionAmount) : null,
        items: (order.items || []).map((item) => ({
            ...item,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            totalPrice: Number(item.totalPrice),
        })),
        paymentRecords: (order.paymentRecords || []).map((record) => ({
            ...record,
            amount: Number(record.amount),
        })),
        collectionPromises: (order.collectionPromises || []).map((record) => ({
            ...record,
            promisedAmount: Number(record.promisedAmount),
        })),
        receivableAdjustments: (order.receivableAdjustments || []).map((record) => ({
            ...record,
            amount: Number(record.amount),
        })),
    };

    return decorateCommercialOrderState(normalized);
};

const getOrderDetailById = async (orderId: number, req?: AuthRequest) => {
    const order = await prisma.order.findFirst({
        where: mergeWhereAnd(
            { id: orderId },
            req ? buildOrderDataScopeWhere(req, { includeFinanceAll: true }) : {},
        ),
        include: ORDER_DETAIL_INCLUDE,
    });
    return order ? formatOrderDetail(order) : null;
};

export const OrderWorkspaceService = {
    async getOrders(query: OrderQuery, req?: AuthRequest) {
        const {
            page = 1,
            pageSize = DEFAULT_PAGE_SIZE,
            search,
            status,
            customerId,
            startDate,
            endDate,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = query;

        const resolvedPage = Math.max(1, Number(page) || 1);
        const limit = Math.min(Number(pageSize) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        const offset = (resolvedPage - 1) * limit;
        const filters: Prisma.OrderWhereInput = {};
        const resolvedSortBy = ORDER_SORT_KEY_MAP[String(sortBy)] || 'createdAt';
        const resolvedSortOrder = String(sortOrder) === 'asc' ? 'asc' : 'desc';

        Object.assign(filters, await buildOrderSearchWhereAsync(search));
        if (status) filters.status = status;
        if (customerId) filters.customerId = Number(customerId);
        if (startDate || endDate) {
            const createdAt: Prisma.DateTimeFilter = {};
            if (startDate) createdAt.gte = new Date(startDate);
            if (endDate) createdAt.lte = new Date(endDate);
            filters.createdAt = createdAt;
        }

        const where = mergeWhereAnd(
            filters,
            req ? buildOrderDataScopeWhere(req, { includeFinanceAll: true }) : {},
        );

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                select: {
                    id: true,
                    orderNo: true,
                    totalAmount: true,
                    discountAmount: true,
                    finalAmount: true,
                    currency: true,
                    paymentTerms: true,
                    paidAmount: true,
                    receivableAdjustmentAmount: true,
                    paymentStatus: true,
                    status: true,
                    commissionRate: true,
                    commissionAmount: true,
                    notes: true,
                    createdAt: true,
                    updatedAt: true,
                    shipments: {
                        select: {
                            status: true,
                            shippedAt: true,
                            deliveredAt: true,
                        },
                    },
                    paymentRecords: {
                        select: {
                            status: true,
                        },
                    },
                    contract: { select: { id: true, contractNo: true } },
                    customer: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true, riskLevel: true } },
                    creator: { select: { id: true, username: true } },
                    _count: { select: { items: true, shipments: true } },
                },
                orderBy: { [resolvedSortBy]: resolvedSortOrder } as Prisma.OrderOrderByWithRelationInput,
                skip: offset,
                take: limit,
            }),
            prisma.order.count({ where }),
        ]);

        const formattedOrders = orders.map((o) => decorateCommercialOrderState({
            ...o,
            paidAmount: Number(o.paidAmount),
            receivableAdjustmentAmount: Number(o.receivableAdjustmentAmount),
            effectiveReceivableAmount: Math.max(0, Number(o.finalAmount) - Number(o.receivableAdjustmentAmount || 0)),
            outstandingAmount: Math.max(0, Number(o.finalAmount) - Number(o.receivableAdjustmentAmount || 0) - Number(o.paidAmount)),
            paymentStatus: o.paymentStatus,
            contractNo: o.contract?.contractNo || null,
            commissionRate: o.commissionRate ? Number(o.commissionRate) : null,
            commissionAmount: o.commissionAmount ? Number(o.commissionAmount) : null,
            customerName: o.customer.nameZh || o.customer.nameEn || o.customer.nameVi || o.customer.name,
            customerNameZh: o.customer.nameZh || null,
            customerNameEn: o.customer.nameEn || null,
            customerNameVi: o.customer.nameVi || null,
            customerRiskLevel: o.customer.riskLevel,
            creatorName: o.creator.username,
            itemCount: o._count.items,
            shipmentCount: o._count.shipments,
        }));

        return {
            data: formattedOrders,
            meta: {
                page: resolvedPage,
                pageSize: limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    },

    async getOrderStats(req?: AuthRequest) {
        const where = req ? buildOrderDataScopeWhere(req, { includeFinanceAll: true }) : {};

        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        const [total, byStatus, monthlyAmount] = await Promise.all([
            prisma.order.count({ where }),
            prisma.order.groupBy({
                by: ['status'],
                where,
                _count: true,
                _sum: { finalAmount: true },
            }),
            prisma.order.aggregate({
                where: {
                    ...where,
                    createdAt: { gte: startOfMonth },
                },
                _sum: { finalAmount: true },
                _count: true,
            }),
        ]);

        return {
            total,
            byStatus: byStatus.reduce((acc, item) => {
                acc[item.status] = {
                    count: item._count,
                    amount: Number(item._sum.finalAmount || 0),
                };
                return acc;
            }, {} as Record<string, { count: number; amount: number }>),
            monthly: {
                count: monthlyAmount._count,
                amount: Number(monthlyAmount._sum.finalAmount || 0),
            },
        };
    },

    async getOrderById(orderId: number, req?: AuthRequest) {
        return getOrderDetailById(orderId, req);
    },

    async exportOrders(filters: { status?: string; startDate?: string; endDate?: string; lang?: string }, req?: AuthRequest) {
        const { status, startDate, endDate, lang = 'zh' } = filters;
        const filterWhere: Prisma.OrderWhereInput = {};

        if (status) filterWhere.status = status;
        if (startDate || endDate) {
            const createdAt: Prisma.DateTimeFilter = {};
            if (startDate) createdAt.gte = new Date(startDate);
            if (endDate) createdAt.lte = new Date(endDate);
            filterWhere.createdAt = createdAt;
        }

        const where = mergeWhereAnd(
            filterWhere,
            req ? buildOrderDataScopeWhere(req, { includeFinanceAll: true }) : {},
        );

        const orders = await prisma.order.findMany({
            where,
            take: MAX_EXPORT_SIZE,
            include: {
                customer: { select: { name: true, nameZh: true, nameEn: true, nameVi: true } },
                creator: { select: { username: true } },
                contract: { select: { contractNo: true } },
                _count: { select: { items: true } },
                shipments: {
                    select: {
                        status: true,
                        shippedAt: true,
                        deliveredAt: true,
                    },
                },
                paymentRecords: {
                    select: {
                        status: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        const workbook = new SpreadsheetWorkbook();
        const worksheet = workbook.addWorksheet('Orders');

        worksheet.columns = [
            { header: 'Order No', key: 'orderNo', width: 20 },
            { header: 'Customer', key: 'customerName', width: 25 },
            { header: 'Order Amount', key: 'totalAmount', width: 15 },
            { header: 'Discount', key: 'discountAmount', width: 12 },
            { header: 'Net Amount', key: 'finalAmount', width: 15 },
            { header: 'Paid Amount', key: 'paidAmount', width: 15 },
            { header: 'Payment Status', key: 'paymentStatus', width: 12 },
            { header: 'Financial Axis', key: 'financialStatus', width: 16 },
            { header: 'Fulfillment Axis', key: 'fulfillmentStatus', width: 16 },
            { header: 'Contract No', key: 'contractNo', width: 20 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Due Date', key: 'dueDate', width: 16 },
            { header: 'Terms (Days)', key: 'paymentTerms', width: 10 },
            { header: 'Items', key: 'itemCount', width: 8 },
            { header: 'Creator', key: 'creator', width: 12 },
            { header: 'Created At', key: 'createdAt', width: 20 },
        ];

        const statusMap: Record<string, Record<string, string>> = {
            zh: {
                pending: '待处理',
                confirmed: '已确认',
                shipped: '已发货',
                delivered: '已送达',
                cancelled: '已取消',
                unpaid: '未支付',
                partial: '部分支付',
                paid: '已结清',
            },
            en: {
                pending: 'Pending',
                confirmed: 'Confirmed',
                shipped: 'Shipped',
                delivered: 'Delivered',
                cancelled: 'Cancelled',
                unpaid: 'Unpaid',
                partial: 'Partial',
                paid: 'Settled',
            },
            vi: {
                pending: 'Cho xu ly',
                confirmed: 'Da xac nhan',
                shipped: 'Da giao hang',
                delivered: 'Da giao den',
                cancelled: 'Da huy',
                unpaid: 'Chua thanh toan',
                partial: 'Thanh toan mot phan',
                paid: 'Da tat toan',
            },
        };

        const currentMap = statusMap[lang] || statusMap.zh;

        orders.forEach((rawOrder) => {
            const o = decorateCommercialOrderState({
                ...rawOrder,
                paidAmount: Number(rawOrder.paidAmount),
                finalAmount: Number(rawOrder.finalAmount),
            });
            worksheet.addRow({
                orderNo: o.orderNo,
                customerName: o.customer.nameZh || o.customer.nameEn || o.customer.nameVi || o.customer.name,
                totalAmount: Number(o.totalAmount),
                discountAmount: Number(o.discountAmount),
                finalAmount: Number(o.finalAmount),
                paidAmount: Number(o.paidAmount),
                paymentStatus: currentMap[o.paymentStatus] || o.paymentStatus || 'unpaid',
                financialStatus: currentMap[o.financialStatus] || o.financialStatus,
                fulfillmentStatus: currentMap[o.fulfillmentStatus] || o.fulfillmentStatus,
                contractNo: o.contract?.contractNo || '-',
                status: currentMap[o.status] || o.status,
                dueDate: o.dueDate ? String(o.dueDate).replace('T', ' ').substring(0, 10) : '-',
                paymentTerms: o.paymentTerms,
                itemCount: o._count.items,
                creator: o.creator.username,
                createdAt: o.createdAt.toISOString().replace('T', ' ').substring(0, 19),
            });
        });

        logger.info(`Exported ${orders.length} orders`);

        return { workbook, orders };
    },
};

