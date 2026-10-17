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
import { recordPaymentVerifiedEventTx } from './payment-verification-event.service';
import { getAppliedFinanceAdjustmentAmountTx } from './payment-ledger-contribution';

type CollectionDb = typeof prisma | Prisma.TransactionClient;
export const PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING = 'PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING';
export const PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING_MESSAGE = 'Verified payments would exceed order outstanding balance.';
export const PAYMENT_VERIFICATION_INVALID_STATE = 'PAYMENT_VERIFICATION_INVALID_STATE';
export const PAYMENT_STATE_BELOW_ZERO = 'PAYMENT_STATE_BELOW_ZERO';
export const getPaymentVerificationConflictMessage = (error: unknown) => (
    error instanceof Error && error.message === PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING
        ? PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING_MESSAGE
        : error instanceof Error && error.message === PAYMENT_VERIFICATION_INVALID_STATE
            ? 'Only pending payments can be verified.'
            : error instanceof Error && error.message === PAYMENT_STATE_BELOW_ZERO
                ? 'Applied payment ledger would be below zero; reconciliation is required.'
                : null
);

export const calculateVerifiedPaymentState = (input: {
    verifiedPayments: Array<{ amount: DecimalInput }>;
    finalAmount: DecimalInput;
    receivableAdjustmentAmount?: DecimalInput;
    appliedFinanceAdjustmentAmount?: DecimalInput;
}) => {
    const paidAmount = addMoney(input.appliedFinanceAdjustmentAmount, ...input.verifiedPayments.map(payment => payment.amount));
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
        // All writers of a customer's derived balances share this row lock.
        // Read the contributing orders only AFTER the lock, never from a stale
        // pre-lock snapshot. On Serializable transactions a conflicting snapshot
        // is retried by the enclosing withDbRetry instead of overwriting totals.
        await db.$executeRaw`UPDATE "customers" SET "id" = "id" WHERE "id" = ${customerId}`;
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
        // A whole-database snapshot followed by later updates can overwrite a
        // payment that committed in between. Recompute each customer under the
        // same transaction lock used by interactive verification and reversal.
        const customers = await prisma.customer.findMany({
            select: { id: true },
            orderBy: { id: 'asc' },
        });
        for (const customer of customers) {
            await this.syncCustomerOverdueAmount(customer.id);
        }
        return customers.length;
    }

    static async recalculateContractMilestonePaymentStateTx(tx: Prisma.TransactionClient, milestoneId: number) {
        // Lock order -> customer -> milestone at every payment write path.
        // Milestones can span orders, so an order lock alone cannot protect the
        // verified-payment aggregate from another order's verification/reversal.
        await tx.$executeRaw`UPDATE "contract_milestones" SET "id" = "id" WHERE "id" = ${milestoneId}`;
        const milestone = await tx.contractMilestone.findUnique({
            where: { id: milestoneId },
            select: { id: true, amount: true, percentage: true,
                contract: { select: { totalAmount: true } } },
        });
        if (!milestone) throw new Error(`Contract milestone not found: ${milestoneId}`);
        const payments = await tx.paymentRecord.aggregate({
            where: { milestoneId, status: 'verified' },
            _sum: { amount: true },
        });
        const amounts = calculateMilestoneAmounts({
            explicitAmount: milestone.amount,
            contractTotalAmount: milestone.contract.totalAmount,
            percentage: milestone.percentage,
            verifiedPayments: [{ amount: payments._sum.amount }],
        });
        const status = compareMoney(amounts.paidAmount, amounts.targetAmount) >= 0 ? 'paid' : 'pending';
        await tx.contractMilestone.update({ where: { id: milestoneId }, data: { status } });
        return { paidAmount: amounts.paidAmount, targetAmount: amounts.targetAmount, status };
    }

    static async recalculateOrderPaymentState(orderId: number) {
        return withDbRetry(
            () => prisma.$transaction(tx => this.recalculateOrderPaymentStateTx(tx, orderId)),
            { label: 'recalculateOrderPaymentState' },
        );
    }

    static async recalculateOrderPaymentStateTx(tx: Prisma.TransactionClient, orderId: number) {
        // All order payment rebuilds use the same row lock as verification,
        // including barter post/reversal, before reading committed ledger facts.
        const order = await tx.order.update({
            where: { id: orderId },
            data: { updatedAt: new Date() },
            select: { id: true, customerId: true, finalAmount: true, receivableAdjustmentAmount: true },
        });
        const payments = await tx.paymentRecord.findMany({
            where: {
                orderId,
                status: 'verified',
            },
            select: {
                amount: true,
            },
        });

        const { paidAmount, paymentStatus, exceedsOutstanding } = calculateVerifiedPaymentState({
            verifiedPayments: payments,
            finalAmount: order.finalAmount,
            receivableAdjustmentAmount: order.receivableAdjustmentAmount,
            appliedFinanceAdjustmentAmount: await getAppliedFinanceAdjustmentAmountTx(tx, orderId),
        });
        if (compareMoney(paidAmount, 0) < 0) throw new Error(PAYMENT_STATE_BELOW_ZERO);
        if (exceedsOutstanding) throw new Error(PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING);

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

        if (payment.status !== 'pending') throw new Error(PAYMENT_VERIFICATION_INVALID_STATE);

        const verified = await withDbRetry(() => prisma.$transaction(async (tx) => {
            const claim = await tx.paymentRecord.updateMany({
                where: { id: payment.id, status: 'pending' },
                data: {
                    status: 'verified',
                    verifiedBy,
                },
            });

            if (claim.count !== 1) {
                const current = await tx.paymentRecord.findUnique({ where: { id: payment.id }, select: { status: true } });
                if (current?.status === 'verified') return false;
                throw new Error(PAYMENT_VERIFICATION_INVALID_STATE);
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
                appliedFinanceAdjustmentAmount: await getAppliedFinanceAdjustmentAmountTx(tx, order.id),
            });
            if (compareMoney(paymentState.paidAmount, 0) < 0) throw new Error(PAYMENT_STATE_BELOW_ZERO);
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

            await this.syncCustomerOverdueAmountTx(tx, order.customerId);
            if (payment.milestoneId) {
                await this.recalculateContractMilestonePaymentStateTx(tx, payment.milestoneId);
            }
            await recordPaymentVerifiedEventTx(tx, payment.id, verifiedBy);
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
        await db.$executeRaw`UPDATE "customers" SET "id" = "id" WHERE "id" = ${customerId}`;
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
