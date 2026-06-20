import prisma from '../../config/database';
import {
    AdjustmentDomain,
} from '../../services/adjustment.service';
import { ProductionCostLedgerService } from '../../services/production-cost-ledger.service';

const getLedgerSourceType = (domain: AdjustmentDomain, reversed = false) => {
    if (domain === 'inventory') {
        return reversed ? 'inventory_reversal' : 'inventory_adjustment';
    }

    return reversed ? 'production_reversal' : 'production_adjustment';
};

export const recordLedgerFromAdjustment = async (params: {
    adjustment: any;
    createdBy: number;
    reversed?: boolean;
}) => {
    const { adjustment, createdBy, reversed = false } = params;
    if (!adjustment || !['production', 'inventory'].includes(String(adjustment.domain))) {
        return null;
    }

    if (!adjustment.batchId) {
        return null;
    }

    const batch = await prisma.productBatch.findUnique({
        where: { id: Number(adjustment.batchId) },
        select: { stockQuantity: true },
    });

    if (!batch) {
        return null;
    }

    const quantityDelta = Number(adjustment.quantityDelta || 0);
    const quantityAfter = Number(batch.stockQuantity || 0);
    const quantityBefore = Number((quantityAfter - quantityDelta).toFixed(6));

    return ProductionCostLedgerService.recordAdjustmentLedger({
        batchId: Number(adjustment.batchId),
        adjustmentId: Number(adjustment.id),
        adjustmentNo: String(adjustment.adjustmentNo),
        sourceType: getLedgerSourceType(adjustment.domain as AdjustmentDomain, reversed),
        quantityBefore,
        quantityDelta,
        quantityAfter,
        amountDelta: adjustment.amountDelta !== null && adjustment.amountDelta !== undefined
            ? Number(adjustment.amountDelta)
            : null,
        note: adjustment.note ? String(adjustment.note) : null,
        createdBy,
    });
};
