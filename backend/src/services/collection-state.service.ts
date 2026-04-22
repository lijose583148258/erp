import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import {
    getDunningLevel,
    getOutstandingAmount,
    getOverdueDays,
    isOverdue,
} from './collection/collection.helpers';
import { withDbRetry } from '../utils/dbRetry';

// 浮点精度修复：将金额转换为整数分进行比较，消除 0.1+0.2 !== 0.3 的问题
const toCents = (n: number) => Math.round(n * 100);
export const PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING = 'PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING';
export const PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING_MESSAGE = 'Verified payments would exceed order outstanding balance.';
export const getPaymentVerificationConflictMessage = (error: unknown) => (
    error instanceof Error && error.message === PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING
        ? PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING_MESSAGE
        : null
);

const determinePaymentStatus = (paidAmount: number, finalAmount: number): string => {
    if (toCents(paidAmount) >= toCents(finalAmount)) return 'paid';
    if (paidAmount > 0) return 'partial';
    return 'unpaid';
};

export class CollectionStateService {
    static async syncCustomerOverdueAmount(customerId: number): Promise<number> {
        const orders = await prisma.order.findMany({
            where: {
                customerId,
                status: { not: 'cancelled' },
                paymentStatus: { not: 'paid' },
            },
            select: {
                finalAmount: true,
                paidAmount: true,
                paymentTerms: true,
                createdAt: true,
            },
        });

        const now = new Date();
        const overdueAmount = orders.reduce((sum, order) => {
            if (!isOverdue(order.createdAt, order.paymentTerms, Number(order.finalAmount), Number(order.paidAmount), now)) {
                return sum;
            }

            return sum + getOutstandingAmount(Number(order.finalAmount), Number(order.paidAmount));
        }, 0);

        await prisma.customer.update({
            where: { id: customerId },
            data: { overdueAmount },
        });

        await this.refreshCustomerCollectionState(customerId);

        return overdueAmount;
    }

    static async syncAllCustomerOverdueAmounts(): Promise<number> {
        const [customers, orders, openPromises, openDisputes] = await Promise.all([
            prisma.customer.findMany({
                select: {
                    id: true,
                    overdueAmount: true,
                    dunningLevel: true,
                    collectionsStatus: true,
                    nextActionAt: true,
                    creditHold: true,
                    creditHoldReason: true,
                    creditHoldSource: true,
                    shipmentHold: true,
                    shipmentHoldReason: true,
                    shipmentHoldSource: true,
                },
            }),
            prisma.order.findMany({
                where: {
                    status: { not: 'cancelled' },
                    paymentStatus: { not: 'paid' },
                },
                select: {
                    customerId: true,
                    finalAmount: true,
                    paidAmount: true,
                    paymentTerms: true,
                    createdAt: true,
                },
            }),
            prisma.collectionPromise.findMany({
                where: { status: 'open' },
                orderBy: { promisedAt: 'asc' },
                select: {
                    customerId: true,
                    promisedAt: true,
                },
            }),
            prisma.collectionDispute.findMany({
                where: { status: { in: ['open', 'reviewing'] } },
                select: { customerId: true },
            }),
        ]);

        const now = new Date();
        const orderStateByCustomer = new Map<number, { overdueAmount: number; dunningLevel: number }>();
        for (const order of orders) {
            const current = orderStateByCustomer.get(order.customerId) || { overdueAmount: 0, dunningLevel: 0 };
            if (isOverdue(order.createdAt, order.paymentTerms, Number(order.finalAmount), Number(order.paidAmount), now)) {
                const daysOverdue = getOverdueDays(order.createdAt, order.paymentTerms, now);
                current.overdueAmount += getOutstandingAmount(Number(order.finalAmount), Number(order.paidAmount));
                current.dunningLevel = Math.max(current.dunningLevel, getDunningLevel(daysOverdue));
            }
            orderStateByCustomer.set(order.customerId, current);
        }

        const promisedAtByCustomer = new Map<number, Date>();
        for (const promise of openPromises) {
            if (!promisedAtByCustomer.has(promise.customerId)) {
                promisedAtByCustomer.set(promise.customerId, promise.promisedAt);
            }
        }

        const disputedCustomers = new Set(openDisputes.map(dispute => dispute.customerId));
        const updates = customers.map(customer => {
            const orderState = orderStateByCustomer.get(customer.id) || { overdueAmount: 0, dunningLevel: 0 };
            const hasPromise = promisedAtByCustomer.has(customer.id);
            const hasDispute = disputedCustomers.has(customer.id);
            const promisedAt = promisedAtByCustomer.get(customer.id) || null;
            const autoCreditHold = orderState.dunningLevel >= 3 || hasDispute;
            const autoShipmentHold = orderState.dunningLevel >= 4 || hasDispute;

            let collectionsStatus = 'normal';
            if (customer.creditHold || customer.shipmentHold) {
                collectionsStatus = 'hold';
            } else if (hasDispute) {
                collectionsStatus = 'disputed';
            } else if (hasPromise) {
                collectionsStatus = 'promised';
            } else if (orderState.dunningLevel >= 4) {
                collectionsStatus = 'legal';
            } else if (orderState.dunningLevel >= 3) {
                collectionsStatus = 'hold';
            } else if (orderState.dunningLevel >= 1) {
                collectionsStatus = 'watch';
            }

            const data: Record<string, any> = {
                overdueAmount: orderState.overdueAmount,
                dunningLevel: orderState.dunningLevel,
                collectionsStatus,
                nextActionAt: promisedAt,
            };

            if (customer.creditHoldSource !== 'manual') {
                if (autoCreditHold) {
                    data.creditHold = true;
                    data.creditHoldReason = hasDispute ? 'Open dispute under review' : `System hold: dunning level ${orderState.dunningLevel}`;
                    data.creditHoldSource = hasDispute ? 'dispute' : 'system';
                    data.creditHoldUpdatedAt = now;
                } else if (customer.creditHold) {
                    data.creditHold = false;
                    data.creditHoldReason = null;
                    data.creditHoldSource = null;
                    data.creditHoldUpdatedAt = now;
                }
            }

            if (customer.shipmentHoldSource !== 'manual') {
                if (autoShipmentHold) {
                    data.shipmentHold = true;
                    data.shipmentHoldReason = hasDispute ? 'Open dispute blocks shipment' : `System hold: dunning level ${orderState.dunningLevel}`;
                    data.shipmentHoldSource = hasDispute ? 'dispute' : 'system';
                    data.shipmentHoldUpdatedAt = now;
                } else if (customer.shipmentHold) {
                    data.shipmentHold = false;
                    data.shipmentHoldReason = null;
                    data.shipmentHoldSource = null;
                    data.shipmentHoldUpdatedAt = now;
                }
            }

            return prisma.customer.update({
                where: { id: customer.id },
                data,
            });
        });

        const chunkSize = 80;
        for (let index = 0; index < updates.length; index += chunkSize) {
            await prisma.$transaction(updates.slice(index, index + chunkSize));
        }

        return customers.length;
    }

    static async recalculateOrderPaymentState(orderId: number) {
        const payments = await prisma.paymentRecord.findMany({
            where: {
                orderId,
                status: 'verified',
            },
            select: {
                amount: true,
            },
        });

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                customerId: true,
                finalAmount: true,
            },
        });

        if (!order) {
            throw new Error(`Order not found: ${orderId}`);
        }

        const paidAmount = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
        const paymentStatus = determinePaymentStatus(paidAmount, Number(order.finalAmount));

        await prisma.order.update({
            where: { id: orderId },
            data: {
                paidAmount,
                paymentStatus,
            },
        });

        await this.syncCustomerOverdueAmount(order.customerId);
        await this.refreshCustomerCollectionState(order.customerId);

        return {
            paidAmount,
            paymentStatus,
        };
    }

    static async verifyPaymentRecord(paymentId: number, verifiedBy: number) {
        const payment = await prisma.paymentRecord.findUnique({
            where: { id: paymentId },
            select: {
                id: true,
                orderId: true,
                status: true,
                milestoneId: true,
            },
        });

        if (!payment) {
            throw new Error('Payment record not found');
        }

        if (payment.status === 'verified') {
            return {
                paymentId: payment.id,
                orderId: payment.orderId,
                alreadyVerified: true,
            };
        }

        const verified = await withDbRetry(() => prisma.$transaction(async (tx) => {
            const claim = await tx.paymentRecord.updateMany({
                where: { id: payment.id, status: 'pending' },
                data: {
                    status: 'verified',
                    verifiedBy,
                },
            });

            if (claim.count !== 1) {
                return false;
            }

            // Serialize same-order verification before aggregating paid totals.
            // This prevents two different pending payments from both passing
            // against the same old paidAmount and creating an overpaid order.
            const order = await tx.order.update({
                where: { id: payment.orderId },
                data: { updatedAt: new Date() },
                select: {
                    id: true,
                    finalAmount: true,
                    customerId: true,
                },
            });

            const allVerifiedPayments = await tx.paymentRecord.findMany({
                where: {
                    orderId: payment.orderId,
                    status: 'verified',
                },
                select: { amount: true },
            });
            const paidAmount = allVerifiedPayments.reduce((sum, record) => sum + Number(record.amount), 0);
            if (toCents(paidAmount) > toCents(Number(order.finalAmount))) {
                throw new Error(PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING);
            }

            const paymentStatus = determinePaymentStatus(paidAmount, Number(order.finalAmount));

            await tx.order.update({
                where: { id: order.id },
                data: {
                    paidAmount,
                    paymentStatus,
                },
            });

            if (payment.milestoneId) {
                const milestone = await tx.contractMilestone.findUnique({
                    where: { id: payment.milestoneId },
                    select: {
                        id: true,
                        amount: true,
                        percentage: true,
                        status: true,
                        contract: {
                            select: {
                                totalAmount: true,
                            },
                        },
                    },
                });

                if (milestone) {
                    const milestoneTarget = milestone.amount !== null
                        ? Number(milestone.amount)
                        : Number(milestone.contract.totalAmount) * Number(milestone.percentage) / 100;
                    const milestonePaid = await tx.paymentRecord.aggregate({
                        where: {
                            milestoneId: milestone.id,
                            status: 'verified',
                        },
                        _sum: { amount: true },
                    });
                    const milestonePaidAmount = Number(milestonePaid._sum.amount || 0);

                    if (milestonePaidAmount >= milestoneTarget) {
                        await tx.contractMilestone.update({
                            where: { id: milestone.id },
                            data: { status: 'paid' },
                        });
                    }
                }
            }
            return true;
        }), { label: 'verifyPaymentRecord' });

        const order = await prisma.order.findUnique({
            where: { id: payment.orderId },
            select: { customerId: true },
        });

        if (order) {
            await this.syncCustomerOverdueAmount(order.customerId);
            await this.refreshCustomerCollectionState(order.customerId);
        }

        return {
            paymentId: payment.id,
            orderId: payment.orderId,
            alreadyVerified: !verified,
        };
    }

    static async refreshCustomerCollectionState(customerId: number) {
        const [customer, overdueOrders, openPromises, openDisputes] = await Promise.all([
            prisma.customer.findUnique({
                where: { id: customerId },
                select: {
                    id: true,
                    creditHold: true,
                    creditHoldReason: true,
                    creditHoldSource: true,
                    shipmentHold: true,
                    shipmentHoldReason: true,
                    shipmentHoldSource: true,
                },
            }),
            prisma.order.findMany({
                where: {
                    customerId,
                    status: { not: 'cancelled' },
                    paymentStatus: { not: 'paid' },
                },
                select: {
                    createdAt: true,
                    paymentTerms: true,
                    finalAmount: true,
                    paidAmount: true,
                },
            }),
            prisma.collectionPromise.findMany({
                where: {
                    customerId,
                    status: 'open',
                },
                orderBy: { promisedAt: 'asc' },
                select: {
                    promisedAt: true,
                },
            }),
            prisma.collectionDispute.findMany({
                where: {
                    customerId,
                    status: { in: ['open', 'reviewing'] },
                },
                select: {
                    id: true,
                },
            }),
        ]);

        if (!customer) {
            throw new Error(`Customer not found: ${customerId}`);
        }

        const now = new Date();
        const dunningLevel = overdueOrders.reduce<number>((max, order) => {
            if (!isOverdue(order.createdAt, order.paymentTerms, Number(order.finalAmount), Number(order.paidAmount), now)) {
                return max;
            }

            const daysOverdue = getOverdueDays(order.createdAt, order.paymentTerms, now);
            return Math.max(max, getDunningLevel(daysOverdue));
        }, 0);

        const hasPromise = openPromises.length > 0;
        const hasDispute = openDisputes.length > 0;
        const promisedAt = hasPromise ? openPromises[0].promisedAt : null;
        const autoCreditHold = dunningLevel >= 3 || hasDispute;
        const autoShipmentHold = dunningLevel >= 4 || hasDispute;

        let collectionsStatus = 'normal';
        if (customer.creditHold || customer.shipmentHold) {
            collectionsStatus = 'hold';
        } else if (hasDispute) {
            collectionsStatus = 'disputed';
        } else if (hasPromise) {
            collectionsStatus = 'promised';
        } else if (dunningLevel >= 4) {
            collectionsStatus = 'legal';
        } else if (dunningLevel >= 3) {
            collectionsStatus = 'hold';
        } else if (dunningLevel >= 1) {
            collectionsStatus = 'watch';
        }

        const updates: Record<string, any> = {
            dunningLevel,
            collectionsStatus,
            nextActionAt: promisedAt,
        };

        if (customer.creditHoldSource !== 'manual') {
            if (autoCreditHold) {
                updates.creditHold = true;
                updates.creditHoldReason = hasDispute
                    ? 'Open dispute under review'
                    : `System hold: dunning level ${dunningLevel}`;
                updates.creditHoldSource = hasDispute ? 'dispute' : 'system';
                updates.creditHoldUpdatedAt = now;
            } else if (customer.creditHold) {
                updates.creditHold = false;
                updates.creditHoldReason = null;
                updates.creditHoldSource = null;
                updates.creditHoldUpdatedAt = now;
            }
        }

        if (customer.shipmentHoldSource !== 'manual') {
            if (autoShipmentHold) {
                updates.shipmentHold = true;
                updates.shipmentHoldReason = hasDispute
                    ? 'Open dispute blocks shipment'
                    : `System hold: dunning level ${dunningLevel}`;
                updates.shipmentHoldSource = hasDispute ? 'dispute' : 'system';
                updates.shipmentHoldUpdatedAt = now;
            } else if (customer.shipmentHold) {
                updates.shipmentHold = false;
                updates.shipmentHoldReason = null;
                updates.shipmentHoldSource = null;
                updates.shipmentHoldUpdatedAt = now;
            }
        }

        await prisma.customer.update({
            where: { id: customerId },
            data: updates,
        });

        return {
            dunningLevel,
            collectionsStatus,
            nextActionAt: promisedAt,
            creditHold: Boolean(updates.creditHold ?? customer.creditHold),
            shipmentHold: Boolean(updates.shipmentHold ?? customer.shipmentHold),
        };
    }
}
