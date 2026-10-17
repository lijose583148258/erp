import { createHash } from 'crypto';
import { z } from 'zod';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { purchaseGovernanceSnapshots,
  requireSupplierPayableBasis, requireIncomingQualityPlan, type PurchaseGovernanceBinding } from '../domain/purchase-governance';
import type { TransactionClient } from './stock-movement.types';
import { executeRawCompat } from '../utils/raw-sql-compat';
import { mapPurchaseOrder } from './procurement-domain.service';
import { requireReceiptPayableSource, type ReceiptPayableSource } from '../domain/purchase-payable';
import { confirmPurchaseSourcesSchema } from '../validators/procurement';

export type SourceOrder = PurchaseGovernanceBinding & { id: number; status: string; updatedAt: Date;
  supplierPayableBasisJson: string | null; incomingQualityPlanJson: string | null };
const fail = (code: string): never => { throw new AppError(code, 409, ErrorCode.CONFLICT); };
const hash = (value: string | null) => value === null ? null : createHash('sha256').update(value).digest('hex');
export const purchaseOrderBinding = (order: PurchaseGovernanceBinding): PurchaseGovernanceBinding => ({ revision: order.revision,
  supplierId: order.supplierId, materialId: order.materialId, unit: order.unit, quantity: Number(order.quantity), price: Number(order.price),
  currency: order.currency, exchangeRate: Number(order.exchangeRate) });
export const purchaseSourceMetadata = (order: SourceOrder, restoreOperationalStatus: 'in_transit' | null = null) => ({
  revision: order.revision, supplierPayableHash: hash(order.supplierPayableBasisJson),
  incomingQualityHash: hash(order.incomingQualityPlanJson), restoreOperationalStatus,
});
const sourceMetaSchema = z.object({ revision: z.number().int().nonnegative(), supplierPayableHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  incomingQualityHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), restoreOperationalStatus: z.enum(['in_transit']).nullable() }).strict();
const readDetails = (details: string | null) => { try { return JSON.parse(details || ''); } catch { return null; } };
type SourceAudit = { id: number; userId: number; action: string; resource: string; resourceId: number | null; details: string | null };
const sourceSchemas: Record<string, string> = { CREATE: 'purchase-create/v1', REVISE: 'purchase-revision/v1', CONFIRM_SOURCES: 'purchase-source-confirmation/v1' };
function readSourceEvidence(row: SourceAudit | null, order: Pick<SourceOrder, 'id' | 'supplierPayableBasisJson' | 'incomingQualityPlanJson'>,
  binding: PurchaseGovernanceBinding) {
  const details = row ? readDetails(row.details) : null;
  const parsed = sourceMetaSchema.safeParse(details?.source);
  if (!row || !Number.isSafeInteger(row.userId) || row.userId <= 0 || !Number.isSafeInteger(row.id) || row.id <= 0
    || row.resource !== 'purchase_order' || row.resourceId !== order.id || details?.schema !== sourceSchemas[row.action] || !sourceSchemas[row.action]
    || !parsed.success || Number(details?.after?.id) !== order.id || details.after.revision !== binding.revision
    || parsed.data.revision !== binding.revision || parsed.data.supplierPayableHash !== hash(order.supplierPayableBasisJson)
    || parsed.data.incomingQualityHash !== hash(order.incomingQualityPlanJson)
    || details.after.supplierPayableBasisJson !== order.supplierPayableBasisJson || details.after.incomingQualityPlanJson !== order.incomingQualityPlanJson
    || JSON.stringify(purchaseOrderBinding({ ...details.after, supplierId: Number(details.after.supplierId) })) !== JSON.stringify(binding)) {
    return fail('PURCHASE_SOURCE_CONFIRMATION_REQUIRED');
  }
  return { sourceAuditId: row.id, sourceUserId: row.userId, sourceOrderStatus: details.after.status, ...parsed.data };
}
function isApproval(row: SourceAudit, orderId: number, source: ReturnType<typeof readSourceEvidence>) {
  const d = readDetails(row.details);
  return row.resource === 'purchase_order' && row.resourceId === orderId && row.action === 'STATUS_CHANGE'
    && Number.isSafeInteger(row.userId) && row.userId > 0 && row.userId !== source.sourceUserId && row.id > source.sourceAuditId
    && source.sourceOrderStatus === 'pending' && d?.schema === 'purchase-status/v2' && d.isSourceApproval === true && d.from === 'pending'
    && d.revision === source.revision && d.to === (source.restoreOperationalStatus || 'approved')
    && d.sourceAuditId === source.sourceAuditId && d.supplierPayableHash === source.supplierPayableHash && d.incomingQualityHash === source.incomingQualityHash;
}

export async function resolvePurchaseSourceWriter(tx: TransactionClient, order: SourceOrder) {
  const rows = await tx.auditLog.findMany({ where: { resource: 'purchase_order', resourceId: order.id,
    action: { in: ['CREATE', 'REVISE', 'CONFIRM_SOURCES'] } }, orderBy: { id: 'desc' }, take: 1 });
  return readSourceEvidence(rows[0] || null, order, purchaseOrderBinding(order));
}

export async function resolveApprovedPurchaseSources(tx: TransactionClient, order: SourceOrder) {
  const binding = purchaseOrderBinding(order), basis = requireSupplierPayableBasis(binding, order.supplierPayableBasisJson);
  const qualityPlan = requireIncomingQualityPlan(binding, order.incomingQualityPlanJson);
  const source = await resolvePurchaseSourceWriter(tx, order);
  const rows = await tx.auditLog.findMany({ where: { resource: 'purchase_order', resourceId: order.id, action: 'STATUS_CHANGE' }, orderBy: { id: 'desc' } });
  const approval = rows.find(row => isApproval(row, order.id, source));
  if (!approval) return fail('PURCHASE_INDEPENDENT_APPROVAL_REQUIRED');
  return { binding, basis, qualityPlan, ...source, approvalAuditId: approval.id, approverUserId: approval.userId };
}

// Receipt liability/QA must retain their original approval even after a later
// live PO change or cancellation. Read the two frozen audit IDs, never "latest".
export async function assertFrozenPurchaseSourceEvidence(tx: TransactionClient, input: {
  purchaseOrderId: number; binding: PurchaseGovernanceBinding; supplierPayableBasisJson: string;
  incomingQualityPlanJson: string; sourceAuditId: number; approvalAuditId: number;
}) {
  const binding = purchaseOrderBinding(input.binding);
  const basis = requireSupplierPayableBasis(binding, input.supplierPayableBasisJson);
  const qualityPlan = requireIncomingQualityPlan(binding, input.incomingQualityPlanJson);
  const [writer, approval] = await Promise.all([tx.auditLog.findUnique({ where: { id: input.sourceAuditId } }),
    tx.auditLog.findUnique({ where: { id: input.approvalAuditId } })]);
  const source = readSourceEvidence(writer, { id: input.purchaseOrderId, supplierPayableBasisJson: input.supplierPayableBasisJson,
    incomingQualityPlanJson: input.incomingQualityPlanJson }, binding);
  if (readDetails(writer?.details || null)?.after?.status !== 'pending' || !approval || !isApproval(approval, input.purchaseOrderId, source)) {
    return fail('PURCHASE_INDEPENDENT_APPROVAL_REQUIRED');
  }
  return { binding, basis, qualityPlan, ...source, approvalAuditId: approval.id, approverUserId: approval.userId };
}

export async function resolveReceiptApprovedSources(tx: TransactionClient, receipt: ReceiptPayableSource & { incomingQualityPlanJson: string | null }) {
  const snapshot = requireReceiptPayableSource(receipt);
  if (!receipt.incomingQualityPlanJson) return fail('PURCHASE_SOURCE_HISTORY_UNRECONCILED');
  return assertFrozenPurchaseSourceEvidence(tx, { purchaseOrderId: receipt.purchaseOrderId, binding: snapshot.binding,
    supplierPayableBasisJson: snapshot.source.supplierPayableBasisJson, incomingQualityPlanJson: receipt.incomingQualityPlanJson,
    sourceAuditId: snapshot.source.sourceAuditId, approvalAuditId: snapshot.source.approvalAuditId });
}

export async function confirmPurchaseSources(tx: TransactionClient, id: number, raw: z.infer<typeof confirmPurchaseSourcesSchema>, actorId: number) {
  const input = confirmPurchaseSourcesSchema.parse(raw);
  if (!Number.isSafeInteger(actorId) || actorId <= 0) throw new AppError('PURCHASE_SOURCE_ACTOR_REQUIRED', 403, ErrorCode.FORBIDDEN);
  await executeRawCompat(tx, 'UPDATE purchase_orders SET id=id WHERE id=?', id);
  const before = await tx.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, salesOrder: true } });
  if (!before) throw new AppError('PURCHASE_ORDER_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
  if (before.revision !== input.expectedRevision || before.updatedAt.getTime() !== Date.parse(input.expectedUpdatedAt)) {
    throw new AppError('PURCHASE_SOURCE_VERSION_CONFLICT', 409, ErrorCode.CONFLICT, { latest: mapPurchaseOrder(before) });
  }
  if (!['pending', 'approved', 'in_transit'].includes(before.status)) return fail('PURCHASE_SOURCE_HISTORY_UNRECONCILED');
  const [receiptCount, posted] = await Promise.all([tx.purchaseReceipt.count({ where: { purchaseOrderId: id } }),
    tx.stockEntry.findFirst({ where: { sourceType: 'procurement_receipt', status: 'posted', OR: [{ sourceRef: `PO-${id}` }, { sourceRef: { startsWith: `PO-${id}-RCV-` } }] } })]);
  if (receiptCount || posted) return fail('PURCHASE_SOURCE_HISTORY_UNRECONCILED');
  let restoreOperationalStatus: 'in_transit' | null = before.status === 'in_transit' ? 'in_transit' : null;
  try { restoreOperationalStatus = (await resolvePurchaseSourceWriter(tx, before)).restoreOperationalStatus || restoreOperationalStatus; }
  catch (error) { if (!(error instanceof AppError) || error.message !== 'PURCHASE_SOURCE_CONFIRMATION_REQUIRED') throw error; }
  const unchanged = purchaseGovernanceSnapshots(purchaseOrderBinding(before), input.supplierPayableTerms, input.incomingQualityPlan);
  if (unchanged.supplierPayableBasisJson === before.supplierPayableBasisJson && unchanged.incomingQualityPlanJson === before.incomingQualityPlanJson) {
    let alreadyConfirmed = false;
    try {
      if (before.status === 'pending') await resolvePurchaseSourceWriter(tx, before);
      else await resolveApprovedPurchaseSources(tx, before);
      alreadyConfirmed = true;
    } catch (error) { if (!(error instanceof AppError)) throw error; }
    if (alreadyConfirmed) throw new AppError('PURCHASE_SOURCES_UNCHANGED', 400, ErrorCode.VALIDATION_ERROR);
  }
  const governance = purchaseGovernanceSnapshots({ ...purchaseOrderBinding(before), revision: before.revision + 1 }, input.supplierPayableTerms, input.incomingQualityPlan);
  const after = await tx.purchaseOrder.update({ where: { id }, data: { ...governance, status: 'pending', revision: { increment: 1 },
    updatedAt: new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1)) }, include: { supplier: true, salesOrder: true } });
  await tx.auditLog.create({ data: { userId: actorId, action: 'CONFIRM_SOURCES', resource: 'purchase_order', resourceId: id,
    details: JSON.stringify({ schema: 'purchase-source-confirmation/v1', reason: input.reason, before: mapPurchaseOrder(before), after: mapPurchaseOrder(after),
      requiresApproval: true, source: purchaseSourceMetadata(after, restoreOperationalStatus) }) } });
  return after;
}

export async function getPurchaseSourceState(tx: TransactionClient, order: SourceOrder) {
  try {
    const source = await resolvePurchaseSourceWriter(tx, order);
    const binding = purchaseOrderBinding(order);
    requireSupplierPayableBasis(binding, order.supplierPayableBasisJson);
    requireIncomingQualityPlan(binding, order.incomingQualityPlanJson);
    if (order.status === 'pending') return { state: 'pending_approval', restoreOperationalStatus: source.restoreOperationalStatus };
    await resolveApprovedPurchaseSources(tx, order); return { state: 'approved', restoreOperationalStatus: source.restoreOperationalStatus };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const [history, posted] = await Promise.all([tx.purchaseReceipt.count({ where: { purchaseOrderId: order.id } }),
      tx.stockEntry.findFirst({ where: { sourceType: 'procurement_receipt', status: 'posted', OR: [{ sourceRef: `PO-${order.id}` }, { sourceRef: { startsWith: `PO-${order.id}-RCV-` } }] } })]);
    return { state: history || posted ? 'history_unreconciled' : 'confirmation_required', restoreOperationalStatus: order.status === 'in_transit' ? 'in_transit' : null };
  }
}
