import type { Prisma } from '@prisma/client';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { canTransitionPurchaseStatus, normalizePurchaseStatus } from './procurement-domain.service';
import {
  createPartialReceiptError,
  getPurchaseReceiptTotals,
  postProcurementReceiptIfMissing,
} from './procurement-receipt.service';
import type { TransactionClient } from './stock-movement.service';

type PurchaseOrderWithRelations = Prisma.PurchaseOrderGetPayload<{
  include: { supplier: true; salesOrder: true };
}>;

export interface ChangePurchaseOrderStatusInput {
  purchaseOrderId: number;
  nextStatus: string;
  createdBy?: number | null;
  enforceTransition?: boolean;
}

export async function changePurchaseOrderStatus(
  tx: TransactionClient,
  input: ChangePurchaseOrderStatusInput,
): Promise<PurchaseOrderWithRelations> {
  const purchaseOrderId = Number(input.purchaseOrderId);
  if (!Number.isInteger(purchaseOrderId) || purchaseOrderId <= 0) {
    throw new AppError('PURCHASE_ORDER_NOT_FOUND', 404, ErrorCode.NOT_FOUND, { purchaseOrderId: input.purchaseOrderId });
  }

  const existing = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { supplier: true, salesOrder: true },
  });
  if (!existing) {
    throw new AppError('PURCHASE_ORDER_NOT_FOUND', 404, ErrorCode.NOT_FOUND, { purchaseOrderId });
  }

  const nextStatus = normalizePurchaseStatus(input.nextStatus);
  const currentStatus = normalizePurchaseStatus(existing.status);
  if (input.enforceTransition !== false && !canTransitionPurchaseStatus(currentStatus, nextStatus)) {
    throw new AppError('PURCHASE_STATUS_TRANSITION_NOT_ALLOWED', 409, ErrorCode.CONFLICT, {
      from: currentStatus,
      to: nextStatus,
    });
  }

  const shouldPostReceipt = currentStatus !== 'received' && nextStatus === 'received';
  if (shouldPostReceipt) {
    const totals = await getPurchaseReceiptTotals(tx, existing.id);
    if (totals.processedQuantity > 0 && totals.processedQuantity + 0.000001 < Number(existing.quantity || 0)) {
      throw createPartialReceiptError();
    }
  }

  const updated = await tx.purchaseOrder.update({
    where: { id: existing.id },
    data: { status: nextStatus },
    include: { supplier: true, salesOrder: true },
  });

  if (shouldPostReceipt) {
    const totals = await getPurchaseReceiptTotals(tx, updated.id);
    if (totals.processedQuantity <= 0.000001) {
      await postProcurementReceiptIfMissing(tx, updated, input.createdBy || null);
    }
  }

  return updated;
}
