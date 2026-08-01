import type { Prisma } from '@prisma/client';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { canTransitionPurchaseStatus, normalizePurchaseStatus } from './procurement-domain.service';
import {
  createPartialReceiptError,
  getPurchaseReceiptTotals,
  postProcurementReceiptIfMissing,
} from './procurement-receipt.service';
import type { TransactionClient } from './stock-movement.service';
import { assertMaterialReleaseReadiness } from './material-release-readiness.service';

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

  const claim = await tx.purchaseOrder.updateMany({
    where: { id: existing.id, status: existing.status },
    data: { status: nextStatus },
  });

  if (claim.count !== 1) {
    const latest = await tx.purchaseOrder.findUnique({
      where: { id: existing.id },
      include: { supplier: true, salesOrder: true },
    });

    if (!latest) {
      throw new AppError('PURCHASE_ORDER_NOT_FOUND', 404, ErrorCode.NOT_FOUND, { purchaseOrderId });
    }

    const latestStatus = normalizePurchaseStatus(latest.status);
    if (latestStatus === nextStatus) {
      return latest;
    }

    if (input.enforceTransition !== false && !canTransitionPurchaseStatus(latestStatus, nextStatus)) {
      throw new AppError('PURCHASE_STATUS_TRANSITION_NOT_ALLOWED', 409, ErrorCode.CONFLICT, {
        from: latestStatus,
        to: nextStatus,
      });
    }

    const retryClaim = await tx.purchaseOrder.updateMany({
      where: { id: latest.id, status: latest.status },
      data: { status: nextStatus },
    });

    if (retryClaim.count !== 1) {
      throw new AppError('PURCHASE_STATUS_TRANSITION_NOT_ALLOWED', 409, ErrorCode.CONFLICT, {
        from: latestStatus,
        to: nextStatus,
      });
    }
  }

  const updated = await tx.purchaseOrder.findUnique({
    where: { id: existing.id },
    include: { supplier: true, salesOrder: true },
  });

  if (!updated) {
    throw new AppError('PURCHASE_ORDER_NOT_FOUND', 404, ErrorCode.NOT_FOUND, { purchaseOrderId });
  }

  if (!['pending', 'cancelled'].includes(nextStatus)) {
    await assertMaterialReleaseReadiness(tx, {
      entityType: 'purchase_order',
      entityId: updated.id,
      action: nextStatus === 'received' ? 'receive' : 'approve',
      lines: [{
        lineKey: updated.id,
        rowNumber: 1,
        materialId: updated.materialId,
        displayName: updated.item,
        unit: updated.unit,
      }],
    });
  }

  if (shouldPostReceipt) {
    const totals = await getPurchaseReceiptTotals(tx, updated.id);
    if (totals.processedQuantity <= 0.000001) {
      await postProcurementReceiptIfMissing(tx, updated, input.createdBy || null);
    }
  }

  return updated;
}
