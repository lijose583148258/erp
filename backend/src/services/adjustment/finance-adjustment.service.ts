import type { AdjustmentRecord } from '@prisma/client';
import type { TransactionClient } from '../stock-movement.service';
import {
    determineReceivablePaymentStatus,
    getOutstandingAmount,
} from '../collection/collection.helpers';

export const FINANCE_ADJUSTMENT_EXCEEDS_ORDER_AMOUNT = 'FINANCE_ADJUSTMENT_EXCEEDS_ORDER_AMOUNT';
export const FINANCE_ADJUSTMENT_BELOW_ZERO_PAID_AMOUNT = 'FINANCE_ADJUSTMENT_BELOW_ZERO_PAID_AMOUNT';
export const FINANCE_ADJUSTMENT_ORDER_STATE_CHANGED = 'FINANCE_ADJUSTMENT_ORDER_STATE_CHANGED';
export const FINANCE_ADJUSTMENT_REQUIRES_RECEIVABLE_MODULE = 'FINANCE_ADJUSTMENT_REQUIRES_RECEIVABLE_MODULE';

export const RECEIVABLE_ONLY_FINANCE_REASON_CATEGORIES = [
    'credit_memo',
    'discount_allowance',
    'bad_debt_writeoff',
    'ar_writeoff',
    'short_payment_writeoff',
] as const;

const RECEIVABLE_ONLY_FINANCE_REASON_CATEGORY_SET = new Set<string>(
    RECEIVABLE_ONLY_FINANCE_REASON_CATEGORIES,
);

const normalizeReasonCategory = (value: string | null | undefined) => String(value || '').trim().toLowerCase();

export const assertFinanceAdjustmentCategoryCanUsePaidAmount = (
    domain: string,
    reasonCategory: string | null | undefined,
) => {
    if (domain !== 'finance') {
        return;
    }

    if (RECEIVABLE_ONLY_FINANCE_REASON_CATEGORY_SET.has(normalizeReasonCategory(reasonCategory))) {
        throw new Error(FINANCE_ADJUSTMENT_REQUIRES_RECEIVABLE_MODULE);
    }
};

export const getAdjustmentConflictMessage = (error: unknown) => {
    if (!(error instanceof Error)) {
        return null;
    }

    if (error.message === FINANCE_ADJUSTMENT_EXCEEDS_ORDER_AMOUNT) {
        return '财务调账不能使订单已收金额超过订单金额';
    }

    if (error.message === FINANCE_ADJUSTMENT_BELOW_ZERO_PAID_AMOUNT) {
        return '财务调账不能使订单已收金额小于 0';
    }

    if (error.message === FINANCE_ADJUSTMENT_ORDER_STATE_CHANGED) {
        return '订单已收金额已变化，请刷新后重试';
    }

    if (error.message === FINANCE_ADJUSTMENT_REQUIRES_RECEIVABLE_MODULE) {
        return '应收减免、折让、贷项、坏账核销不能通过“已收金额调账”处理，请走应收调整专用流程';
    }

    return null;
};

type AdjustmentTx = TransactionClient;
type PersistedAdjustment = AdjustmentRecord;

const now = () => new Date();
const toCents = (value: number) => Math.round(Number(value || 0) * 100);
const fromCents = (value: number) => Number((value / 100).toFixed(2));

const recalculateCustomerOverdueAmountTx = async (tx: AdjustmentTx, customerId: number) => {
    const orders = await tx.order.findMany({
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

    const current = now();
    const DAY_MS = 24 * 60 * 60 * 1000;

    const overdueAmount = orders.reduce((sum, order) => {
        const dueDate = new Date(order.createdAt.getTime() + Number(order.paymentTerms || 0) * DAY_MS);
        const outstanding = getOutstandingAmount(
            Number(order.finalAmount),
            Number(order.paidAmount),
            Number(order.receivableAdjustmentAmount),
        );

        if (outstanding <= 0) {
            return sum;
        }

        if (dueDate.getTime() < current.getTime()) {
            return sum + outstanding;
        }

        return sum;
    }, 0);

    await tx.customer.update({
        where: { id: customerId },
        data: { overdueAmount },
    });

    return overdueAmount;
};

export const applyFinanceAdjustmentTx = async (tx: AdjustmentTx, adjustment: PersistedAdjustment) => {
    const orderId = adjustment.orderId || adjustment.targetId;
    if (!orderId) {
        return null;
    }

    const order = await tx.order.findUnique({
        where: { id: Number(orderId) },
        select: {
            id: true,
            customerId: true,
            finalAmount: true,
            paidAmount: true,
            receivableAdjustmentAmount: true,
            paymentStatus: true,
        },
    });

    if (!order) {
        throw new Error(`Order not found: ${orderId}`);
    }

    const customerBefore = await tx.customer.findUnique({
        where: { id: order.customerId },
        select: {
            id: true,
            overdueAmount: true,
        },
    });

    const deltaCents = toCents(Number(adjustment.amountDelta || 0));
    const effectiveReceivableAmount = Math.max(0, Number(order.finalAmount) - Number(order.receivableAdjustmentAmount || 0));
    const finalAmountCents = toCents(effectiveReceivableAmount);
    const currentPaidAmountCents = toCents(Number(order.paidAmount));
    const nextPaidAmountCents = currentPaidAmountCents + deltaCents;

    if (nextPaidAmountCents < 0) {
        throw new Error(FINANCE_ADJUSTMENT_BELOW_ZERO_PAID_AMOUNT);
    }

    if (nextPaidAmountCents > finalAmountCents) {
        throw new Error(FINANCE_ADJUSTMENT_EXCEEDS_ORDER_AMOUNT);
    }

    const nextPaidAmount = fromCents(nextPaidAmountCents);
    const paymentStatus = determineReceivablePaymentStatus(
        nextPaidAmount,
        Number(order.finalAmount),
        Number(order.receivableAdjustmentAmount),
    );
    const updatedOrder = await tx.order.updateMany({
        where: {
            id: order.id,
            paidAmount: Number(order.paidAmount),
        },
        data: {
            paidAmount: nextPaidAmount,
            paymentStatus,
        },
    });

    if (updatedOrder.count !== 1) {
        throw new Error(FINANCE_ADJUSTMENT_ORDER_STATE_CHANGED);
    }

    const overdueAmount = await recalculateCustomerOverdueAmountTx(tx, order.customerId);

    return {
        before: {
            order,
            customer: customerBefore,
        },
        after: {
            orderId: order.id,
            customerId: order.customerId,
            paidAmount: nextPaidAmount,
            paymentStatus,
            overdueAmount,
        },
        effects: {
            orderId: order.id,
            customerId: order.customerId,
            paidAmount: nextPaidAmount,
            paymentStatus,
            overdueAmount,
        },
    };
};
