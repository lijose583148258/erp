import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Prisma, SalesFulfillmentPlan } from '@prisma/client';
import prisma from '../config/database';
import type { AuthRequest } from '../middleware/auth';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import { buildOrderDataScopeWhere, canUseOrderForBusinessWrite, mergeWhereAnd } from '../utils/recordAccess';
import { readOrderFulfillment } from './order-fulfillment.service';
import { createSalesFulfillmentPlanSchema, approveSalesFulfillmentPlanSchema, closeSalesFulfillmentPlanSchema } from '../validators/sales-fulfillment';

type Tx = Prisma.TransactionClient;
type CreateInput = z.infer<typeof createSalesFulfillmentPlanSchema>;
export class SalesFulfillmentPlanError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); }
}
const fail = (code: string, message: string, status = 409): never => { throw new SalesFulfillmentPlanError(status, code, message); };
const unitKey = (unit: string) => unit.trim().toLowerCase();
const exceeds = (a: number, b: number) => a - b > Math.min(0.000001, Math.abs(b) * Number.EPSILON * 16);
const sum = (rows: { plannedQuantity: number }[]) => rows.reduce((n, row) => n + Number(row.plannedQuantity), 0);
const activePlan = { status: { in: ['approved', 'closed'] } };
const actorId = (req: AuthRequest) => req.user?.userId || fail('FULFILLMENT_ACTOR_REQUIRED', '缺少操作人', 403);

async function orderAccess(tx: Tx, orderId: number, req: AuthRequest, write: boolean) {
  const order = await tx.order.findFirst({ where: mergeWhereAnd({ id: orderId }, buildOrderDataScopeWhere(req, { includeFinanceAll: !write })),
    include: { customer: { select: { salespersonId: true, poolState: true, segment: true } }, items: { orderBy: { id: 'asc' } } } });
  if (!order || (write && !canUseOrderForBusinessWrite(req, order))) return fail('FULFILLMENT_ORDER_NOT_FOUND', '订单不存在或无权操作', 404);
  return order;
}
async function claimOrder(tx: Tx, orderId: number, req: AuthRequest) {
  await orderAccess(tx, orderId, req, true);
  // Shares the same row lock as line replacement, status changes and shipping.
  // A no-op update avoids falsifying the historical order modification time.
  await tx.$executeRaw`UPDATE "orders" SET "status" = "status" WHERE "id" = ${orderId}`;
  return orderAccess(tx, orderId, req, true);
}
function assertLiveOrder(status: string) {
  if (!['pending', 'confirmed', 'shipped', 'delivered'].includes(status)) fail('FULFILLMENT_ORDER_CLOSED', '已取消或结案的订单不能新增或审批供给计划');
}
async function readLine(tx: Tx, orderId: number, orderItemId: number) {
  const fulfillment = await readOrderFulfillment(tx, orderId);
  const line = fulfillment.lines.find(item => item.orderItemId === orderItemId);
  if (fulfillment.needsReview || !line) return fail('FULFILLMENT_LINE_REVIEW_REQUIRED', '订单行缺失或履约证据待核对');
  return { line, fulfillment };
}
function parseSnapshot(value: string | null) {
  try { return value ? JSON.parse(value) : null; } catch { return fail('FULFILLMENT_SNAPSHOT_INVALID', '计划快照损坏，不能继续审批或结案'); }
}
async function source(tx: Tx, orderId: number, item: { materialId: number | null; unit: string }, purchaseId: number) {
  await tx.$executeRaw`UPDATE "purchase_orders" SET "status" = "status" WHERE "id" = ${purchaseId}`;
  const po = await tx.purchaseOrder.findUnique({ where: { id: purchaseId }, include: { receipts: { orderBy: { id: 'asc' } } } });
  if (!po || po.salesOrderId !== orderId || !item.materialId || po.materialId !== item.materialId || unitKey(po.unit) !== unitKey(item.unit)) {
    return fail('FULFILLMENT_SOURCE_MISMATCH', '采购单必须属于本销售订单，并与订单行物料和单位一致');
  }
  if (!['approved', 'in_transit', 'received'].includes(po.status)) return fail('FULFILLMENT_SOURCE_NOT_APPROVED', '采购来源必须已审批，变更后须重新审批');
  return po;
}
const sourceFacts = (po: { id: number; revision: number; materialId: number | null; quantity: number; unit: string; salesOrderId: number | null; eta: Date }) => ({
  kind: 'linked_purchase', id: po.id, revision: po.revision, materialId: po.materialId,
  quantity: Number(po.quantity), unit: unitKey(po.unit), salesOrderId: po.salesOrderId, eta: po.eta.toISOString(),
});
async function audit(tx: Tx, req: AuthRequest, action: string, planId: number, details: unknown) {
  await tx.auditLog.create({ data: { userId: actorId(req), action, resource: 'sales_fulfillment_plan', resourceId: planId, details: JSON.stringify(details) } });
}
function view(plan: SalesFulfillmentPlan) {
  const { requestFingerprint: _fingerprint, ...rest } = plan;
  return { ...rest, sourceSnapshot: parseSnapshot(plan.sourceSnapshot), closeoutSnapshot: parseSnapshot(plan.closeoutSnapshot), physicalStockReserved: false };
}
const run = <T>(label: string, action: (tx: Tx) => Promise<T>) => withDbRetry(() => prisma.$transaction(action), { label });

export const SalesFulfillmentPlanService = {
  async list(orderId: number, req: AuthRequest) {
    return prisma.$transaction(async tx => {
      await orderAccess(tx, orderId, req, false);
      const plans = await tx.salesFulfillmentPlan.findMany({ where: { orderId }, orderBy: { id: 'asc' } });
      return { plans: plans.map(view), fulfillment: await readOrderFulfillment(tx, orderId),
        scope: 'linked_purchase_only', physicalStockReserved: false, confirmationGateEnforced: false };
    });
  },

  async create(orderId: number, raw: CreateInput, req: AuthRequest) {
    const input = createSalesFulfillmentPlanSchema.parse(raw);
    const normalized = { orderId, createdBy: actorId(req), orderItemId: input.orderItemId, fulfillmentOption: input.fulfillmentOption,
      sourceDocumentId: input.sourceDocumentId, plannedQuantity: input.plannedQuantity,
      expectedFulfillmentAt: new Date(input.expectedFulfillmentAt).toISOString(), note: input.note };
    const fingerprint = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    return run('createSalesFulfillmentPlan', async tx => {
      const order = await claimOrder(tx, orderId, req);
      const prior = await tx.salesFulfillmentPlan.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (prior) {
        if (prior.orderId !== orderId || prior.createdBy !== actorId(req) || prior.requestFingerprint !== fingerprint) return fail('FULFILLMENT_IDEMPOTENCY_CONFLICT', '请求键已被不同计划使用，请先核对原计划');
        return view(prior);
      }
      assertLiveOrder(order.status);
      const item = order.items.find(row => row.id === input.orderItemId);
      if (!item) return fail('FULFILLMENT_LINE_MISMATCH', '订单行不属于本订单');
      const { line } = await readLine(tx, orderId, item.id);
      if (exceeds(input.plannedQuantity, line.outstandingQuantity)) return fail('FULFILLMENT_QUANTITY_EXCEEDED', '计划数量超过订单行待交量');
      if (new Date(input.expectedFulfillmentAt).getTime() <= Date.now()) return fail('FULFILLMENT_DATE_EXPIRED', '预计交付时间必须晚于当前时间');
      const po = await source(tx, orderId, item, input.sourceDocumentId);
      if (exceeds(input.plannedQuantity, po.quantity)) return fail('FULFILLMENT_SOURCE_CAPACITY_EXCEEDED', '计划数量超过采购来源数量');
      if (po.eta.getTime() > new Date(input.expectedFulfillmentAt).getTime()) return fail('FULFILLMENT_DATE_BEFORE_SUPPLY', '预计交付不得早于采购到货时间');
      const plan = await tx.salesFulfillmentPlan.create({ data: { ...normalized, expectedFulfillmentAt: new Date(input.expectedFulfillmentAt),
        planNo: buildBusinessNo('SFP'), idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint,
        unit: unitKey(item.unit), sourceDocumentNo: `PO-${po.id}`, sourceSnapshot: JSON.stringify(sourceFacts(po)), status: 'draft' } });
      await audit(tx, req, 'CREATE_SALES_FULFILLMENT_PLAN', plan.id, { planNo: plan.planNo, ...normalized, sourceSnapshot: sourceFacts(po), stockChanged: false });
      return view(plan);
    });
  },

  async approve(orderId: number, planId: number, raw: z.infer<typeof approveSalesFulfillmentPlanSchema>, req: AuthRequest) {
    const input = approveSalesFulfillmentPlanSchema.parse(raw);
    return run('approveSalesFulfillmentPlan', async tx => {
      const order = await claimOrder(tx, orderId, req);
      const plan = await tx.salesFulfillmentPlan.findFirst({ where: { id: planId, orderId } });
      if (!plan) return fail('FULFILLMENT_PLAN_NOT_FOUND', '供给计划不存在', 404);
      if (plan.createdBy === actorId(req)) return fail('FULFILLMENT_SELF_APPROVAL', '计划创建人不能审批自己的计划', 403);
      assertLiveOrder(order.status);
      if (plan.status !== 'draft' || plan.updatedAt.getTime() !== Date.parse(input.expectedUpdatedAt)) return fail('FULFILLMENT_REVISION_CONFLICT', '计划已变更，请刷新后对照，不得覆盖');
      if (plan.expectedFulfillmentAt.getTime() <= Date.now()) return fail('FULFILLMENT_DATE_EXPIRED', '计划已超期，请重新建立供给承诺');
      const item = order.items.find(row => row.id === plan.orderItemId);
      if (!item || !plan.sourceDocumentId || plan.fulfillmentOption !== 'linked_purchase') return fail('FULFILLMENT_LINE_MISMATCH', '计划物料或来源无效');
      const po = await source(tx, orderId, item, plan.sourceDocumentId);
      if (JSON.stringify(sourceFacts(po)) !== JSON.stringify(parseSnapshot(plan.sourceSnapshot))) return fail('FULFILLMENT_SOURCE_CHANGED', '采购版本已改变；旧计划保留历史，须依据新版本重新建计划');
      const { line } = await readLine(tx, orderId, item.id);
      const existing = await tx.salesFulfillmentPlan.findMany({ where: { orderId, orderItemId: item.id, ...activePlan } });
      if (exceeds(plan.plannedQuantity, line.outstandingQuantity) || exceeds(sum(existing) + plan.plannedQuantity, line.orderedQuantity)) return fail('FULFILLMENT_QUANTITY_EXCEEDED', '已批准承诺与本次数量超过订单需求');
      const sourcePlans = await tx.salesFulfillmentPlan.findMany({ where: { fulfillmentOption: 'linked_purchase', sourceDocumentId: po.id, ...activePlan } });
      if (exceeds(sum(sourcePlans) + plan.plannedQuantity, po.quantity)) return fail('FULFILLMENT_SOURCE_CAPACITY_EXCEEDED', '采购来源已被其他已批准计划占用');
      const approved = await tx.salesFulfillmentPlan.update({ where: { id: plan.id }, data: { status: 'approved', approvedBy: actorId(req), approvedAt: new Date(), acceptedQuantityAtApproval: line.acceptedQuantity } });
      await audit(tx, req, 'APPROVE_SALES_FULFILLMENT_PLAN', plan.id, { planNo: plan.planNo, reason: input.reason, sourceSnapshot: sourceFacts(po), line, stockChanged: false });
      return view(approved);
    });
  },

  async close(orderId: number, planId: number, raw: z.infer<typeof closeSalesFulfillmentPlanSchema>, req: AuthRequest) {
    const input = closeSalesFulfillmentPlanSchema.parse(raw);
    return run('closeSalesFulfillmentPlan', async tx => {
      const order = await claimOrder(tx, orderId, req);
      const plan = await tx.salesFulfillmentPlan.findFirst({ where: { id: planId, orderId } });
      if (!plan) return fail('FULFILLMENT_PLAN_NOT_FOUND', '供给计划不存在', 404);
      if (plan.status === 'closed') {
        const previous = parseSnapshot(plan.closeoutSnapshot);
        if (plan.closeoutIdempotencyKey !== input.idempotencyKey || plan.closedBy !== actorId(req) || previous?.reason !== input.reason) return fail('FULFILLMENT_IDEMPOTENCY_CONFLICT', '结案请求与原记录不一致');
        return view(plan);
      }
      if (plan.status !== 'approved' || order.status === 'cancelled') return fail('FULFILLMENT_PLAN_NOT_APPROVED', '只能结案已批准、未取消订单的计划');
      const item = order.items.find(row => row.id === plan.orderItemId);
      if (!item || !plan.sourceDocumentId || plan.fulfillmentOption !== 'linked_purchase') return fail('FULFILLMENT_LINE_MISMATCH', '来源或订单行无效');
      const po = await source(tx, orderId, item, plan.sourceDocumentId);
      if (JSON.stringify(sourceFacts(po)) !== JSON.stringify(parseSnapshot(plan.sourceSnapshot))) return fail('FULFILLMENT_SOURCE_CHANGED', '采购版本与审批快照不一致，不能自动结案');
      const { line, fulfillment } = await readLine(tx, orderId, item.id);
      if (!fulfillment.fullyDelivered || line.outstandingQuantity !== 0) return fail('FULFILLMENT_DELIVERY_INCOMPLETE', '订单尚有待交或异常签收，不能关闭补货计划');
      const plans = await tx.salesFulfillmentPlan.findMany({ where: { fulfillmentOption: 'linked_purchase', sourceDocumentId: po.id, orderItemId: item.id, ...activePlan } });
      const committedQuantity = sum(plans);
      const receiptBatches = [...new Set(po.receipts.filter(row => row.batchNo && row.acceptedQuantity > 0 && unitKey(row.unit) === unitKey(plan.unit)).map(row => row.batchNo!))];
      const shipments = await tx.shipment.findMany({ where: { orderId, orderItemId: item.id, materialId: item.materialId, status: 'delivered', batchNo: { in: receiptBatches } }, include: { receipts: true } });
      const deliveredFromSource = shipments.reduce((total, shipment) => total + shipment.receipts.filter(row => unitKey(row.unit) === unitKey(plan.unit)).reduce((n, row) => n + Number(row.acceptedQuantity), 0), 0);
      const received = po.receipts.filter(row => unitKey(row.unit) === unitKey(plan.unit)).reduce((n, row) => n + Number(row.acceptedQuantity), 0);
      if (exceeds(committedQuantity, received) || exceeds(committedQuantity, deliveredFromSource)) return fail('FULFILLMENT_SOURCE_DELIVERY_UNPROVEN', '采购实收批次与订单签收数量不能覆盖已批准计划');
      const snapshot = { reason: input.reason, sourceSnapshot: sourceFacts(po), line, committedQuantity, receivedQuantity: received, deliveredFromSource,
        purchaseReceiptIds: po.receipts.map(row => row.id), shipmentIds: shipments.map(row => row.id), shipmentReceiptIds: shipments.flatMap(row => row.receipts.map(receipt => receipt.id)), stockChanged: false, moneyChanged: false };
      const closed = await tx.salesFulfillmentPlan.update({ where: { id: plan.id }, data: { status: 'closed', closeoutIdempotencyKey: input.idempotencyKey, closeoutSnapshot: JSON.stringify(snapshot), closedBy: actorId(req), closedAt: new Date() } });
      await audit(tx, req, 'CLOSE_SALES_FULFILLMENT_PLAN', plan.id, snapshot);
      return view(closed);
    });
  },
};
