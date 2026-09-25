import { z } from 'zod';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { revisePurchaseOrderSchema } from '../validators/procurement';
import { calculatePurchaseValuation, mapPurchaseOrder, normalizePurchaseStatus } from './procurement-domain.service';
import type { TransactionClient } from './stock-movement.types';

export type PurchaseRevisionInput = z.infer<typeof revisePurchaseOrderSchema>;

export const purchaseRevisionConflict = (latest?: unknown) => new AppError(
  '采购单已被修改，请对比最新版本后重新提交；未覆盖你的输入。', 409, ErrorCode.CONFLICT,
  { reason: 'PURCHASE_REVISION_CONFLICT', latest },
);

export async function revisePurchaseOrder(tx: TransactionClient, id: number, raw: PurchaseRevisionInput, actorId: number) {
  const input = revisePurchaseOrderSchema.parse(raw);
  if (!Number.isInteger(actorId) || actorId <= 0) throw new AppError('采购变更必须有操作人', 403, ErrorCode.FORBIDDEN);
  const before = await tx.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, salesOrder: true } });
  if (!before) throw new AppError('采购单不存在', 404, ErrorCode.NOT_FOUND);
  if (before.revision !== input.expectedRevision || before.updatedAt.getTime() !== Date.parse(input.expectedUpdatedAt)) {
    throw purchaseRevisionConflict(mapPurchaseOrder(before));
  }
  if (!['pending', 'approved'].includes(normalizePurchaseStatus(before.status))) {
    throw new AppError('已发运、收货或取消的采购单不能原地修改，请走调整流程', 409, ErrorCode.CONFLICT);
  }
  const valuation = calculatePurchaseValuation({ ...before, quantity: input.quantity, price: input.price, taxAmount: input.taxAmount });
  if (Object.values(valuation).some(value => typeof value === 'number' && !Number.isFinite(value))) {
    throw new AppError('采购金额超出有效范围', 400, ErrorCode.VALIDATION_ERROR);
  }
  if (Number(before.quantity) === input.quantity && Number(before.price) === input.price
    && Number(before.taxAmount) === input.taxAmount && before.eta.toISOString().slice(0, 10) === input.eta) {
    throw new AppError('采购条款没有变化，无需生成新版本', 400, ErrorCode.VALIDATION_ERROR);
  }
  // CAS also claims the PO row against status/receipt writers before checking receipts.
  const claim = await tx.purchaseOrder.updateMany({
    where: { id, revision: input.expectedRevision, updatedAt: before.updatedAt, status: before.status },
    data: { quantity: input.quantity, price: input.price, eta: new Date(input.eta), ...valuation,
      revision: { increment: 1 }, status: 'pending', updatedAt: new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1)) },
  });
  if (claim.count !== 1) {
    const latest = await tx.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, salesOrder: true } });
    throw purchaseRevisionConflict(latest ? mapPurchaseOrder(latest) : undefined);
  }
  if (await tx.purchaseReceipt.count({ where: { purchaseOrderId: id } })) {
    throw new AppError('已有收货记录，采购单不能原地修改，请走调整流程', 409, ErrorCode.CONFLICT);
  }
  const after = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { supplier: true, salesOrder: true } });
  await tx.auditLog.create({ data: { userId: actorId, action: 'REVISE', resource: 'purchase_order', resourceId: id,
    details: JSON.stringify({ schema: 'purchase-revision/v1', reason: input.reason,
      before: mapPurchaseOrder(before), after: mapPurchaseOrder(after), requiresApproval: true }) } });
  return after;
}
