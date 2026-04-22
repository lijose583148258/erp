import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import {
    COLLECTION_DUE_SOON_DAYS,
    buildDisputeWhere,
    buildOrderWhere,
    buildPaymentWhere,
    buildPromiseWhere,
    getAgingBucket,
    getDueDate,
    getCollectionActionPlan,
    getOutstandingAmount,
    getOverdueDays,
    isOverdue,
} from './collection/collection.helpers';
import { CollectionStateService } from './collection-state.service';
import { CollectionMutationService } from './collection-mutation.service';
import { buildCustomerDataScopeWhere, mergeWhereAnd } from '../utils/recordAccess';
import {
    getCustomerDisplayName,
    type AgingBucketSummary,
    type CollectionHoldRecord,
    type ReceivablesBaseSnapshot,
    type ReceivablesSnapshot,
} from './collection/collection.types';

export type {
    AgingBucketSummary,
    CollectionDisputeRecord,
    CollectionHoldRecord,
    CollectionPromiseRecord,
    PaymentStateInput,
    ReceivablesSnapshot,
} from './collection/collection.types';

export class CollectionService {
    static async getReceivablesSnapshot(req: AuthRequest): Promise<ReceivablesSnapshot> {
        const orders = await prisma.order.findMany({
            where: buildOrderWhere(req),
            select: {
                id: true,
                orderNo: true,
                finalAmount: true,
                paidAmount: true,
                receivableAdjustmentAmount: true,
                paymentTerms: true,
                paymentStatus: true,
                status: true,
                createdAt: true,
                customer: {
                    select: {
                        id: true,
                        name: true,
                        nameZh: true,
                        nameEn: true,
                        nameVi: true,
                        riskLevel: true,
                    },
                },
            },
        });

        const now = new Date();
        const dueSoonLimit = new Date(now.getTime() + COLLECTION_DUE_SOON_DAYS * 24 * 60 * 60 * 1000);
        const baseBuckets: AgingBucketSummary = {
            current: 0,
            '1_7': 0,
            '8_15': 0,
            '16_30': 0,
            '31_60': 0,
            '60_plus': 0,
        };

        const summary = orders.reduce<ReceivablesBaseSnapshot>(
            (acc, order) => {
                const outstanding = getOutstandingAmount(
                    Number(order.finalAmount),
                    Number(order.paidAmount),
                    Number(order.receivableAdjustmentAmount),
                );
                const daysOverdue = getOverdueDays(order.createdAt, order.paymentTerms, now);
                const bucket = getAgingBucket(daysOverdue);
                acc.agingBuckets[bucket] += outstanding;

                acc.totalReceivable += outstanding;
                acc.totalPaid += Number(order.paidAmount);

                if (order.paymentStatus === 'paid') {
                    acc.paidCount += 1;
                } else if (order.paymentStatus === 'partial') {
                    acc.partialCount += 1;
                } else {
                    acc.unpaidCount += 1;
                }

                if (outstanding > 0 && daysOverdue > 0) {
                    acc.overdueAmount += outstanding;
                    acc.overdueCount += 1;
                    const plan = getCollectionActionPlan(daysOverdue);
                    acc.priorityActions.push({
                        orderId: order.id,
                        orderNo: order.orderNo,
                        customerName: getCustomerDisplayName(order.customer),
                        customerNameZh: order.customer.nameZh || null,
                        customerNameEn: order.customer.nameEn || null,
                        customerNameVi: order.customer.nameVi || null,
                        customerDisplayName: getCustomerDisplayName(order.customer),
                        outstanding,
                        daysOverdue,
                        level: plan.level,
                        label: plan.label,
                        nextAction: plan.nextAction,
                        channel: plan.channel,
                        holdRecommended: plan.holdRecommended,
                    });
                } else if (outstanding > 0 && order.paymentStatus !== 'paid' && getDueDate(order.createdAt, order.paymentTerms).getTime() <= dueSoonLimit.getTime()) {
                    acc.dueSoonAmount += outstanding;
                    acc.dueSoonCount += 1;
                }

                return acc;
            },
            {
                totalOrders: orders.length,
                totalReceivable: 0,
                totalPaid: 0,
                overdueAmount: 0,
                dueSoonAmount: 0,
                overdueCount: 0,
                dueSoonCount: 0,
                paidCount: 0,
                partialCount: 0,
                unpaidCount: 0,
                pendingVerificationCount: 0,
                openPromiseCount: 0,
                openPromiseAmount: 0,
                openDisputeCount: 0,
                creditHoldCustomerCount: 0,
                shipmentHoldOrderCount: 0,
                agingBuckets: baseBuckets,
                priorityActions: [],
            },
        );

        summary.priorityActions.sort((a, b) => {
            if (b.level !== a.level) return b.level - a.level;
            if (b.daysOverdue !== a.daysOverdue) return b.daysOverdue - a.daysOverdue;
            return b.outstanding - a.outstanding;
        });

        const [
            recentPayments,
            pendingVerificationCount,
            openPromiseCount,
            openPromiseAmount,
            openDisputeCount,
            creditHoldCustomerCount,
            shipmentHoldOrderCount,
        ] = await Promise.all([
            prisma.paymentRecord.findMany({
                where: buildPaymentWhere(req),
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: {
                    id: true,
                    amount: true,
                    method: true,
                    status: true,
                    createdAt: true,
                    verifiedBy: true,
                    order: {
                        select: {
                            id: true,
                            orderNo: true,
                            customer: {
                                select: {
                                    id: true,
                                    name: true,
                                    nameZh: true,
                                    nameEn: true,
                                    nameVi: true,
                                },
                            },
                        },
                    },
                    milestone: {
                        select: {
                            id: true,
                            title: true,
                        },
                    },
                },
            }),
            prisma.paymentRecord.count({ where: buildPaymentWhere(req, { status: 'pending' }) }),
            prisma.collectionPromise.count({ where: buildPromiseWhere(req, { status: 'open' }) }),
            prisma.collectionPromise.aggregate({ where: buildPromiseWhere(req, { status: 'open' }), _sum: { promisedAmount: true } }),
            prisma.collectionDispute.count({ where: buildDisputeWhere(req, { status: { in: ['open', 'reviewing'] } }) }),
            prisma.customer.count({
                where: mergeWhereAnd(
                    { creditHold: true },
                    buildCustomerDataScopeWhere(req, { includeFinanceAll: true }),
                ),
            }),
            prisma.order.count({ where: buildOrderWhere(req, { shipmentHold: true }) }),
        ]);

        return {
            ...summary,
            pendingVerificationCount,
            openPromiseCount,
            openPromiseAmount: Number(openPromiseAmount._sum.promisedAmount || 0),
            openDisputeCount,
            creditHoldCustomerCount,
            shipmentHoldOrderCount,
            recentPayments: recentPayments.map(record => ({
                id: record.id,
                amount: Number(record.amount),
                method: record.method,
                status: record.status,
                createdAt: record.createdAt.toISOString(),
                orderNo: record.order.orderNo,
                customerName: getCustomerDisplayName(record.order.customer),
                customerNameZh: record.order.customer.nameZh || null,
                customerNameEn: record.order.customer.nameEn || null,
                customerNameVi: record.order.customer.nameVi || null,
                customerDisplayName: getCustomerDisplayName(record.order.customer),
                milestoneTitle: record.milestone?.title || null,
            })),
        };
    }

    static async createPromiseToPay(input: {
        customerId: number;
        orderId: number;
        promisedAmount: number;
        promisedAt: Date;
        channel: string;
        contactName?: string | null;
        contactPhone?: string | null;
        note?: string | null;
        createdBy: number;
    }) {
        return CollectionMutationService.createPromiseToPay(input);
    }

    static async updatePromiseStatus(promiseId: number, status: 'kept' | 'missed' | 'cancelled') {
        return CollectionMutationService.updatePromiseStatus(promiseId, status);
    }

    static async createDispute(input: {
        customerId: number;
        orderId: number;
        disputedAmount?: number | null;
        reasonCategory: string;
        reason: string;
        evidenceJson?: string | null;
        note?: string | null;
        createdBy: number;
    }) {
        return CollectionMutationService.createDispute(input);
    }

    static async updateDisputeStatus(disputeId: number, status: 'reviewing' | 'resolved' | 'rejected' | 'withdrawn') {
        return CollectionMutationService.updateDisputeStatus(disputeId, status);
    }

    static async setCustomerHold(customerId: number, type: 'credit' | 'shipment', reason: string, source = 'manual') {
        return CollectionMutationService.setCustomerHold(customerId, type, reason, source);
    }

    static async releaseCustomerHold(customerId: number, type: 'credit' | 'shipment') {
        return CollectionMutationService.releaseCustomerHold(customerId, type);
    }

    static async setOrderShipmentHold(orderId: number, reason: string, source = 'manual') {
        return CollectionMutationService.setOrderShipmentHold(orderId, reason, source);
    }

    static async releaseOrderShipmentHold(orderId: number) {
        return CollectionMutationService.releaseOrderShipmentHold(orderId);
    }

    static async createReminderBatch(orderIds: number[], userId: number) {
        const uniqueOrderIds = Array.from(new Set(orderIds.filter(id => Number.isInteger(id) && id > 0)));
        let createdCount = 0;
        let skippedCount = 0;

        for (const orderId of uniqueOrderIds) {
            const order = await prisma.order.findUnique({
                where: { id: orderId },
                select: {
                    id: true,
                    orderNo: true,
                    finalAmount: true,
                    paidAmount: true,
                    receivableAdjustmentAmount: true,
                    paymentTerms: true,
                    createdAt: true,
                    customer: {
                        select: {
                            id: true,
                            name: true,
                            nameZh: true,
                            nameEn: true,
                            nameVi: true,
                        },
                    },
                },
            });

            if (!order) {
                skippedCount += 1;
                continue;
            }

            const dueDate = getDueDate(order.createdAt, order.paymentTerms);
            const outstanding = getOutstandingAmount(
                Number(order.finalAmount),
                Number(order.paidAmount),
                Number(order.receivableAdjustmentAmount),
            );

            await prisma.auditLog.create({
                data: {
                    userId,
                    action: 'COLLECTION_REMINDER',
                    resource: 'order',
                    resourceId: order.id,
                    details: JSON.stringify({
                        orderNo: order.orderNo,
                        customerId: order.customer.id,
                        customerName: getCustomerDisplayName(order.customer),
                        customerNameZh: order.customer.nameZh || null,
                        customerNameEn: order.customer.nameEn || null,
                        customerNameVi: order.customer.nameVi || null,
                        customerDisplayName: getCustomerDisplayName(order.customer),
                        dueDate,
                        outstanding,
                        batchReminder: true,
                    }),
                },
            });

            createdCount += 1;
        }

        return {
            totalCount: uniqueOrderIds.length,
            createdCount,
            skippedCount,
        };
    }

    static async getPromises(req: AuthRequest) {
        const records = await prisma.collectionPromise.findMany({
            where: buildPromiseWhere(req),
            orderBy: { promisedAt: 'asc' },
            select: {
                id: true,
                promiseNo: true,
                promisedAmount: true,
                promisedAt: true,
                channel: true,
                contactName: true,
                contactPhone: true,
                status: true,
                note: true,
                createdAt: true,
                customer: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } },
                order: { select: { id: true, orderNo: true } },
            },
        });

        return records.map(record => ({
            id: record.id,
            promiseNo: record.promiseNo,
            customerId: record.customer.id,
            customerName: getCustomerDisplayName(record.customer),
            customerNameZh: record.customer.nameZh || null,
            customerNameEn: record.customer.nameEn || null,
            customerNameVi: record.customer.nameVi || null,
            customerDisplayName: getCustomerDisplayName(record.customer),
            orderId: record.order.id,
            orderNo: record.order.orderNo,
            promisedAmount: Number(record.promisedAmount),
            promisedAt: record.promisedAt.toISOString(),
            channel: record.channel,
            contactName: record.contactName,
            contactPhone: record.contactPhone,
            status: record.status,
            note: record.note,
            createdAt: record.createdAt.toISOString(),
        }));
    }

    static async getDisputes(req: AuthRequest) {
        const records = await prisma.collectionDispute.findMany({
            where: buildDisputeWhere(req),
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                disputeNo: true,
                disputedAmount: true,
                reasonCategory: true,
                reason: true,
                evidenceJson: true,
                status: true,
                note: true,
                createdAt: true,
                resolvedAt: true,
                customer: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } },
                order: { select: { id: true, orderNo: true } },
            },
        });

        return records.map(record => ({
            id: record.id,
            disputeNo: record.disputeNo,
            customerId: record.customer.id,
            customerName: getCustomerDisplayName(record.customer),
            customerNameZh: record.customer.nameZh || null,
            customerNameEn: record.customer.nameEn || null,
            customerNameVi: record.customer.nameVi || null,
            customerDisplayName: getCustomerDisplayName(record.customer),
            orderId: record.order.id,
            orderNo: record.order.orderNo,
            disputedAmount: record.disputedAmount === null ? null : Number(record.disputedAmount),
            reasonCategory: record.reasonCategory,
            reason: record.reason,
            evidenceJson: record.evidenceJson,
            status: record.status,
            note: record.note,
            createdAt: record.createdAt.toISOString(),
            resolvedAt: record.resolvedAt ? record.resolvedAt.toISOString() : null,
        }));
    }

    static async getHolds(req: AuthRequest) {
        const [customers, orders] = await Promise.all([
            prisma.customer.findMany({
                where: mergeWhereAnd(
                    { OR: [{ creditHold: true }, { shipmentHold: true }] },
                    buildCustomerDataScopeWhere(req, { includeFinanceAll: true }),
                ),
                select: {
                    id: true,
                    name: true,
                    nameZh: true,
                    nameEn: true,
                    nameVi: true,
                    creditHold: true,
                    creditHoldReason: true,
                    creditHoldSource: true,
                    creditHoldUpdatedAt: true,
                    shipmentHold: true,
                    shipmentHoldReason: true,
                    shipmentHoldSource: true,
                    shipmentHoldUpdatedAt: true,
                },
            }),
            prisma.order.findMany({
                where: buildOrderWhere(req, { shipmentHold: true }),
                select: {
                    id: true,
                    orderNo: true,
                    shipmentHold: true,
                    shipmentHoldReason: true,
                    shipmentHoldSource: true,
                    shipmentHoldUpdatedAt: true,
                    customer: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } },
                },
            }),
        ]);

        return [
            ...customers.flatMap(customer => {
                const holds: CollectionHoldRecord[] = [];
                if (customer.creditHold) {
                    holds.push({
                        scope: 'customer-credit',
                        id: customer.id,
                        customerId: customer.id,
                        customerName: getCustomerDisplayName(customer),
                        customerNameZh: customer.nameZh || null,
                        customerNameEn: customer.nameEn || null,
                        customerNameVi: customer.nameVi || null,
                        customerDisplayName: getCustomerDisplayName(customer),
                        orderId: null,
                        orderNo: null,
                        reason: customer.creditHoldReason || null,
                        source: customer.creditHoldSource || null,
                        status: customer.creditHold,
                        updatedAt: customer.creditHoldUpdatedAt ? customer.creditHoldUpdatedAt.toISOString() : null,
                    });
                }
                if (customer.shipmentHold) {
                    holds.push({
                        scope: 'customer-shipment',
                        id: customer.id,
                        customerId: customer.id,
                        customerName: getCustomerDisplayName(customer),
                        customerNameZh: customer.nameZh || null,
                        customerNameEn: customer.nameEn || null,
                        customerNameVi: customer.nameVi || null,
                        customerDisplayName: getCustomerDisplayName(customer),
                        orderId: null,
                        orderNo: null,
                        reason: customer.shipmentHoldReason || null,
                        source: customer.shipmentHoldSource || null,
                        status: customer.shipmentHold,
                        updatedAt: customer.shipmentHoldUpdatedAt ? customer.shipmentHoldUpdatedAt.toISOString() : null,
                    });
                }
                return holds;
            }),
            ...orders.map(order => ({
                scope: 'order-shipment' as const,
                id: order.id,
                customerId: order.customer.id,
                customerName: getCustomerDisplayName(order.customer),
                customerNameZh: order.customer.nameZh || null,
                customerNameEn: order.customer.nameEn || null,
                customerNameVi: order.customer.nameVi || null,
                customerDisplayName: getCustomerDisplayName(order.customer),
                orderId: order.id,
                orderNo: order.orderNo,
                reason: order.shipmentHoldReason || null,
                source: order.shipmentHoldSource || null,
                status: order.shipmentHold,
                updatedAt: order.shipmentHoldUpdatedAt ? order.shipmentHoldUpdatedAt.toISOString() : null,
            })),
        ];
    }
}
