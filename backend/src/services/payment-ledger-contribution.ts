import type { Prisma } from '@prisma/client';
import { addMoney } from '../utils/money';

// A posted adjustment and its posted inverse are both applied facts. Reversal
// changes the original's status but does not erase its contribution. A cancelled
// pending adjustment is also called "reversed", yet has no appliedAt/effect.
export const appliedFinanceAdjustmentWhere = (orderId: number): Prisma.AdjustmentRecordWhereInput => ({
    domain: 'finance',
    OR: [{ orderId }, { orderId: null, targetId: orderId }],
    status: { in: ['posted', 'reversed'] },
    appliedAt: { not: null },
});

export const getAppliedFinanceAdjustmentAmountTx = async (
    tx: Prisma.TransactionClient,
    orderId: number,
): Promise<number> => {
    const adjustments = await tx.adjustmentRecord.findMany({
        where: appliedFinanceAdjustmentWhere(orderId),
        select: { amountDelta: true },
    });
    // Sum using decimal money arithmetic, not a floating-point SQL aggregate.
    return addMoney(...adjustments.map(adjustment => adjustment.amountDelta));
};
