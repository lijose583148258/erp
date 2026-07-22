import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import type { AuthRequest } from '../middleware/auth';
import { buildOrderItemsAndTotals } from './order-item-normalization';
import { canUseOrderForBusinessWrite } from '../utils/recordAccess';
import { CreditEngine } from '../utils/CreditEngine';
import { withDbRetry } from '../utils/dbRetry';

export class OrderUpdateRejectedError extends Error {
    constructor(
        readonly statusCode: number,
        message: string,
        readonly data?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'OrderUpdateRejectedError';
    }
}

type OrderUpdateClaimClient = Pick<Prisma.TransactionClient, 'order'>;

export async function claimPendingOrderForUpdate(db: OrderUpdateClaimClient, orderId: number) {
    const claimed = await db.order.updateMany({
        where: { id: orderId, status: 'pending' },
        data: { updatedAt: new Date() },
    });
    if (claimed.count === 1) return 'claimed' as const;

    const existingState = await db.order.findUnique({
        where: { id: orderId },
        select: { id: true },
    });
    return existingState ? 'not_pending' as const : 'missing' as const;
}
export const OrderUpdateService = {
    async updateOrder(orderId: number, updateData: any, req: AuthRequest) {
        const itemReplacement = Array.isArray(updateData.items)
            ? buildOrderItemsAndTotals(updateData.items)
            : null;

        return withDbRetry(() => prisma.$transaction(async (tx) => {
            // Claim the pending row before reading financial state. This prevents an
            // approval/status transition from racing with a line-item replacement.
            const claim = await claimPendingOrderForUpdate(tx, orderId);
            if (claim === 'missing') {
                throw new OrderUpdateRejectedError(404, '订单不存在，请刷新后重试。');
            }
            if (claim === 'not_pending') {
                throw new OrderUpdateRejectedError(400, '只有待处理订单可以编辑。');
            }

            const existing = await tx.order.findUnique({
                where: { id: orderId },
                select: {
                    id: true,
                    orderNo: true,
                    status: true,
                    createdBy: true,
                    customerId: true,
                    discountAmount: true,
                    paidAmount: true,
                    customer: { select: { salespersonId: true, poolState: true, segment: true } },
                },
            });
            if (!existing) throw new OrderUpdateRejectedError(404, '订单不存在，请刷新后重试。');
            if (!canUseOrderForBusinessWrite(req, existing)) {
                throw new OrderUpdateRejectedError(403, '无权编辑该订单。');
            }

            const replacementFinalAmount = itemReplacement
                ? itemReplacement.totalAmount - Number(existing.discountAmount)
                : null;
            if (replacementFinalAmount !== null && replacementFinalAmount < 0) {
                throw new OrderUpdateRejectedError(400, '折扣金额不能超过订单总额。');
            }
            if (replacementFinalAmount !== null && replacementFinalAmount < Number(existing.paidAmount)) {
                throw new OrderUpdateRejectedError(400, '订单金额不能低于已核销金额。');
            }

            if (itemReplacement && replacementFinalAmount !== null) {
                await tx.customer.update({
                    where: { id: existing.customerId },
                    data: { updatedAt: new Date() },
                    select: { id: true },
                });
                const replacementOutstanding = Math.max(0, replacementFinalAmount - Number(existing.paidAmount));
                const creditCheck = await CreditEngine.checkOrder(
                    existing.customerId,
                    replacementOutstanding,
                    tx,
                    existing.id,
                );
                if (!creditCheck.allow) {
                    throw new OrderUpdateRejectedError(
                        403,
                        creditCheck.reason || '客户授信校验未通过。',
                        { exposure: creditCheck.exposure },
                    );
                }
            }

            return tx.order.update({
                where: { id: orderId },
                data: {
                    notes: updateData.notes,
                    paymentTerms: updateData.paymentTerms,
                    contractId: updateData.contractId === null
                        ? null
                        : updateData.contractId
                            ? Number(updateData.contractId)
                            : undefined,
                    ...(itemReplacement && replacementFinalAmount !== null ? {
                        totalAmount: itemReplacement.totalAmount,
                        finalAmount: replacementFinalAmount,
                        items: {
                            deleteMany: {},
                            create: itemReplacement.orderItems,
                        },
                    } : {}),
                },
            });
        }), { label: 'updateOrder' });
    },
};
