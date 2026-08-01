import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import type { Prisma } from '@prisma/client';
import {
    calculateMilestoneAmounts,
    determineReceivablePaymentStatus,
    getEffectiveReceivableAmount,
    getDunningLevel,
    getOutstandingAmount,
    getOverdueDays,
    isOverdue,
} from './collection/collection.helpers';
import { withDbRetry } from '../utils/dbRetry';
import { addMoney, compareMoney, type DecimalInput } from '../utils/money';

type CollectionDb = typeof prisma | Prisma.TransactionClient;
export const PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING = 'PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING';
export const PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING_MESSAGE = 'Verified payments would exceed order outstanding balance.';
export const getPaymentVerificationConflictMessage = (error: unknown) => (
    error instanceof Error && error.message === PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING
        ? PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING_MESSAGE
        : null
);

export const calculateVerifiedPaymentState = (input: {
    verifiedPayments: Array<{ amount: DecimalInput }>;
    finalAmount: DecimalInput;
    receivableAdjustmentAmount?: DecimalInput;
}) => {
    const paidAmount = addMoney(...input.verifiedPayments.map(payment => payment.amount));
    const effectiveReceivableAmount = getEffectiveReceivableAmount(
        input.finalAmount,
        input.receivableAdjustmentAmount,
    );
    return {
        paidAmount,
        effectiveReceivableAmount,
        exceedsOutstanding: compareMoney(paidAmount, effectiveReceivableAmount) > 0,
        paymentStatus: determineReceivablePaymentStatus(
            paidAmount,
            input.finalAmount,
            input.receivableAdjustmentAmount,
        ),
    };
};

export class CollectionStateService {
    private static syncAllCustomerOverdueAmountsInFlight: Promise<number> | null = null;

    static async syncCustomerOverdueAmount(customerId: number): Promise<number> {
        return withDbRetry(
            () => prisma.$transaction(tx => this.syncCustomerOverdueAmountTx(tx, customerId)),
            { label: 'syncCustomerOverdueAmount' },
        );
    }

    static async syncCustomerOverdueAmountTx(tx: Prisma.TransactionClient, customerId: number): Promise<number> {
        return this.syncCustomerOverdueAmountWithClient(tx, customerId);
    }

    private static async syncCustomerOverdueAmountWithClient(db: CollectionDb, customerId: number): Promise<number> {
        const orders = await db.order.findMany({
            where: {
                customerId,
                status: { not: 'cancelled' },
                paymentStatus: { not: 'paid' },
            },
            select: {
                finalAmount: true,
                paidAmount: true,
                receivableAdjustmentAmount: true,
                paymentTerms: true,
                createdAt: true,
            },
        });

        const now = new Date();
        const overdueAmount = orders.reduce((sum, order) => {
            if (!isOverdue(
                order.createdAt,
                order.paymentTerms,
                order.finalAmount,
                order.paidAmount,
                order.receivableAdjustmentAmount,
                now,
            )) {
                return sum;
            }

            return addMoney(sum, getOutstandingAmount(
                order.finalAmount,
                order.paidAmount,
                order.receivableAdjustmentAmount,
            ));
        }, 0);

        await db.customer.update({
            where: { id: customerId },
            data: { overdueAmount },
        });

        await this.refreshCustomerCollectionStateWithClient(db, customerId);

        return overdueAmount;
    }

    static async syncAllCustomerOverdueAmounts(): Promise<number> {
        if (this.syncAllCustomerOverdueAmountsInFlight) {
            return this.syncAllCustomerOverdueAmountsInFlight;
        }

        this.syncAllCustomerOverdueAmountsInFlight = this.runSyncAllCustomerOverdueAmounts()
            .finally(() => {
                this.syncAllCustomerOverdueAmountsInFlight = null;
            });

        return this.syncAllCustomerOverdueAmountsInFlight;
    }

    private static async runSyncAllCustomerOverdueAmounts(): Promise<number> {
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
                    receivableAdjustmentAmount: true,
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
            if (isOverdue(
                order.createdAt,
                order.paymentTerms,
                order.finalAmount,
                order.paidAmount,
                order.receivableAdjustmentAmount,
                now,
            )) {
                const daysOverdue = getOverdueDays(order.createdAt, order.paymentTerms, now);
                current.overdueAmount = addMoney(current.overdueAmount, getOutstandingAmount(
                    order.finalAmount,
                    order.paidAmount,
                    order.receivableAdjustmentAmount,
                ));
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

            return { customerId: customer.id, data };
        });

        const chunkSize = 80;
        for (let index = 0; index < updates.length; index += chunkSize) {
            const chunk = updates.slice(index, index + chunkSize);
            await withDbRetry(
                () => prisma.$transaction(chunk.map(update => prisma.customer.update({
                    where: { id: update.customerId },
                    data: update.data,
                }))),
                {
                    label: 'syncAllCustomerOverdueAmounts',
                    attempts: 5,
                    baseDelayMs: 120,
                },
            );
        }

        return customers.length;
    }

    static async recalculateOrderPaymentState(orderId: number) {
        return withDbRetry(
            () => prisma.$transaction(tx => this.recalculateOrderPaymentStateTx(tx, orderId)),
            { label: 'recalculateOrderPaymentState' },
        );
    }

    static async recalculateOrderPaymentStateTx(tx: Prisma.TransactionClient, orderId: number) {
        const payments = await tx.paymentRecord.findMany({
            where: {
                orderId,
                status: 'verified',
            },
            select: {
                amount: true,
            },
        });

        const order = await tx.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                customerId: true,
                finalAmount: true,
                receivableAdjustmentAmount: true,
            },
        });

        if (!order) {
            throw new Error(`Order not found: ${orderId}`);
        }

        const { paidAmount, paymentStatus } = calculateVerifiedPaymentState({
            verifiedPayments: payments,
            finalAmount: order.finalAmount,
            receivableAdjustmentAmount: order.receivableAdjustmentAmount,
        });

        await tx.order.update({
            where: { id: orderId },
            data: {
                paidAmount,
                paymentStatus,
            },
        });

        await this.syncCustomerOverdueAmountTx(tx, order.customerId);

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
                    receivableAdjustmentAmount: true,
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
            const paymentState = calculateVerifiedPaymentState({
                verifiedPayments: allVerifiedPayments,
                finalAmount: order.finalAmount,
                receivableAdjustmentAmount: order.receivableAdjustmentAmount,
            });
            if (paymentState.exceedsOutstanding) {
                throw new Error(PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING);
            }

            await tx.order.update({
                where: { id: order.id },
                data: {
                    paidAmount: paymentState.paidAmount,
                    paymentStatus: paymentState.paymentStatus,
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
                    const milestonePaid = await tx.paymentRecord.aggregate({
                        where: {
                            milestoneId: milestone.id,
                            status: 'verified',
                        },
                        _sum: { amount: true },
                    });
                    const milestoneAmounts = calculateMilestoneAmounts({
                        explicitAmount: milestone.amount,
                        contractTotalAmount: milestone.contract.totalAmount,
                        percentage: milestone.percentage,
                        verifiedPayments: [{ amount: milestonePaid._sum.amount }],
                    });

                    if (compareMoney(milestoneAmounts.paidAmount, milestoneAmounts.targetAmount) >= 0) {
                        await tx.contractMilestone.update({
                            where: { id: milestone.id },
                            data: { status: 'paid' },
                        });
                    }
                }
            }
            await this.syncCustomerOverdueAmountTx(tx, order.customerId);
            return true;
        }), { label: 'verifyPaymentRecord' });

        return {
            paymentId: payment.id,
            orderId: payment.orderId,
            alreadyVerified: !verified,
        };
    }

    static async refreshCustomerCollectionState(customerId: number) {
        return withDbRetry(
            () => prisma.$transaction(tx => this.refreshCustomerCollectionStateTx(tx, customerId)),
            { label: 'refreshCustomerCollectionState' },
        );
    }

    static async refreshCustomerCollectionStateTx(tx: Prisma.TransactionClient, customerId: number) {
        return this.refreshCustomerCollectionStateWithClient(tx, customerId);
    }

    private static async refreshCustomerCollectionStateWithClient(db: CollectionDb, customerId: number) {
        const [customer, overdueOrders, openPromises, openDisputes] = await Promise.all([
            db.customer.findUnique({
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
            db.order.findMany({
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
                    receivableAdjustmentAmount: true,
                },
            }),
            db.collectionPromise.findMany({
                where: {
                    customerId,
                    status: 'open',
                },
                orderBy: { promisedAt: 'asc' },
                select: {
                    promisedAt: true,
                },
            }),
            db.collectionDispute.findMany({
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
            if (!isOverdue(
                order.createdAt,
                order.paymentTerms,
                order.finalAmount,
                order.paidAmount,
                order.receivableAdjustmentAmount,
                now,
            )) {
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

        await db.customer.update({
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
