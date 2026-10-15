import type { Prisma } from '@prisma/client';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { canTransitionPurchaseStatus, mapPurchaseOrder, normalizePurchaseStatus } from './procurement-domain.service';
import { purchaseRevisionConflict } from './procurement-revision.service';
import type { TransactionClient } from './stock-movement.types';
import { assertMaterialReleaseReadiness } from './material-release-readiness.service';
import { executeRawCompat } from '../utils/raw-sql-compat';
import { purchaseOrderBinding, resolveApprovedPurchaseSources, resolvePurchaseSourceWriter } from './procurement-source-confirmation.service';
import { requireIncomingQualityPlan, requireSupplierPayableBasis } from '../domain/purchase-governance';

type PurchaseOrderWithRelations = Prisma.PurchaseOrderGetPayload<{ include: { supplier: true; salesOrder: true } }>;
export interface ChangePurchaseOrderStatusInput {
  purchaseOrderId: number; nextStatus: string; createdBy?: number | null;
  // Existing integration callers may not bypass independent procurement review.
  enforceTransition?: boolean; expectedRevision?: number;
}

export async function changePurchaseOrderStatus(tx: TransactionClient, input: ChangePurchaseOrderStatusInput): Promise<PurchaseOrderWithRelations> {
  const id = Number(input.purchaseOrderId), actor = Number(input.createdBy);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('PURCHASE_ORDER_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
  await executeRawCompat(tx, 'UPDATE purchase_orders SET id=id WHERE id=?', id);
  const existing = await tx.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, salesOrder: true } });
  if (!existing) throw new AppError('PURCHASE_ORDER_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
  const requestedStatus = normalizePurchaseStatus(input.nextStatus), currentStatus = normalizePurchaseStatus(existing.status);
  if ((existing.revision > 0 || input.expectedRevision !== undefined || ['approved', 'in_transit'].includes(requestedStatus))
    && input.expectedRevision !== existing.revision) throw purchaseRevisionConflict(mapPurchaseOrder(existing));
  if (!Number.isSafeInteger(actor) || actor <= 0) throw new AppError('PURCHASE_STATUS_ACTOR_REQUIRED', 403, ErrorCode.FORBIDDEN);

  // A legacy received row is read-only; an unchanged status must not invent AP.
  if (currentStatus === requestedStatus) {
    if (['approved', 'in_transit'].includes(currentStatus)) await resolveApprovedPurchaseSources(tx, existing);
    return existing;
  }
  if (requestedStatus === 'received') throw new AppError('ACTUAL_RECEIPT_REQUIRED', 409, ErrorCode.CONFLICT);

  let nextStatus = requestedStatus;
  let source: Awaited<ReturnType<typeof resolvePurchaseSourceWriter>> | null = null;
  const isSourceApproval = currentStatus === 'pending' && requestedStatus === 'approved';
  if (isSourceApproval) {
    const binding = purchaseOrderBinding(existing);
    requireSupplierPayableBasis(binding, existing.supplierPayableBasisJson);
    requireIncomingQualityPlan(binding, existing.incomingQualityPlanJson);
    source = await resolvePurchaseSourceWriter(tx, existing);
    if (source.sourceOrderStatus !== 'pending' || actor === source.sourceUserId) {
      throw new AppError('PURCHASE_INDEPENDENT_APPROVAL_REQUIRED', 409, ErrorCode.CONFLICT);
    }
    nextStatus = source.restoreOperationalStatus || 'approved';
  } else if (requestedStatus === 'in_transit') {
    source = await resolveApprovedPurchaseSources(tx, existing);
  } else if (currentStatus === 'in_transit' && requestedStatus === 'approved') {
    // Lost ACK after approving legacy in-transit source confirmation.
    const approval = await resolveApprovedPurchaseSources(tx, existing);
    if (approval.restoreOperationalStatus === 'in_transit') return existing;
  }
  if (!canTransitionPurchaseStatus(currentStatus, requestedStatus)) {
    throw new AppError('PURCHASE_STATUS_TRANSITION_NOT_ALLOWED', 409, ErrorCode.CONFLICT, { from: currentStatus, to: requestedStatus });
  }
  if (['approved', 'in_transit'].includes(nextStatus)) await assertMaterialReleaseReadiness(tx, {
    entityType: 'purchase_order', entityId: id, action: 'approve',
    lines: [{ lineKey: id, rowNumber: 1, materialId: existing.materialId, displayName: existing.item, unit: existing.unit }],
  });
  const claim = await tx.purchaseOrder.updateMany({ where: { id, status: existing.status, revision: existing.revision }, data: { status: nextStatus } });
  if (claim.count !== 1) {
    const latest = await tx.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, salesOrder: true } });
    throw purchaseRevisionConflict(latest ? mapPurchaseOrder(latest) : undefined);
  }
  await tx.auditLog.create({ data: { userId: actor, action: 'STATUS_CHANGE', resource: 'purchase_order', resourceId: id,
    details: JSON.stringify({ schema: 'purchase-status/v2', revision: existing.revision, from: currentStatus, to: nextStatus, isSourceApproval,
      ...(source ? { sourceAuditId: source.sourceAuditId, supplierPayableHash: source.supplierPayableHash, incomingQualityHash: source.incomingQualityHash } : {}) }) } });
  const updated = await tx.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, salesOrder: true } });
  if (!updated) throw new AppError('PURCHASE_ORDER_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
  return updated;
}
