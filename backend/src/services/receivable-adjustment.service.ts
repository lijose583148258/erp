import type { ReceivableAdjustment } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { AuthRequest } from '../middleware/auth';
import { buildOrderDataScopeWhere, canUseOrderForBusinessWrite, mergeWhereAnd } from '../utils/recordAccess';
import { createOrderQuantityCancellationSchema } from '../validators/receivable-adjustment';
import { quoteOrderQuantityCancellation } from '../utils/orderCancellation';
import { ORDER_QUANTITY_CANCELLATION } from '../utils/orderFulfillment';
import { readOrderFulfillment } from './order-fulfillment.service';
import prisma from '../config/database';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import { addMoney, compareMoney, maxMoney, multiplyMoney, roundMoney, subtractMoney } from '../utils/money';
import {
  determineReceivablePaymentStatus,
  getEffectiveReceivableAmount,
  getOutstandingAmount,
} from './collection/collection.helpers';
import { CollectionStateService } from './collection-state.service';

export const RECEIVABLE_ADJUSTMENT_EXCEEDS_AVAILABLE = 'RECEIVABLE_ADJUSTMENT_EXCEEDS_AVAILABLE';
export const RECEIVABLE_ADJUSTMENT_ORDER_STATE_CHANGED = 'RECEIVABLE_ADJUSTMENT_ORDER_STATE_CHANGED';
export const RECEIVABLE_ADJUSTMENT_INVALID_STATUS = 'RECEIVABLE_ADJUSTMENT_INVALID_STATUS';

export const RECEIVABLE_ADJUSTMENT_TYPES = [
  'credit_memo',
  'discount_allowance',
  'bad_debt_writeoff',
  'short_payment_writeoff',
  'fx_difference',
] as const;

export type ReceivableAdjustmentType = typeof RECEIVABLE_ADJUSTMENT_TYPES[number];

export interface CreateReceivableAdjustmentInput {
  orderId: number;
  customerId?: number | null;
  adjustmentType: string;
  amount: number;
  currency?: string | null;
  exchangeRate?: number | null;
  baseAmount?: number | null;
  reason: string;
  evidenceJson?: string | null;
  note?: string | null;
}

export interface ListReceivableAdjustmentFilters {
  status?: string;
  orderId?: number;
  customerId?: number;
  adjustmentType?: string;
  page: number;
  pageSize: number;
}

const now = () => new Date();

const RECEIVABLE_ADJUSTMENT_TYPE_SET = new Set<string>(RECEIVABLE_ADJUSTMENT_TYPES);

export const getReceivableAdjustmentConflictMessage = (error: unknown) => {
  if (!(error instanceof Error)) return null;
  const cancellationMessages: Record<string, string> = {
    ORDER_CANCELLATION_NOT_FOUND: '订单不存在或无权申请取消。',
    ORDER_CANCELLATION_STATE_CHANGED: '订单已变化或当前状态不允许取消，请刷新核对。',
    ORDER_CANCELLATION_IDEMPOTENCY_CONFLICT: '请求身份与原取消申请不同，请先回读原申请。',
    ORDER_CANCELLATION_FULFILLMENT_REVIEW_REQUIRED: '订单行或履约证据待核对，不能取消。',
    ORDER_CANCELLATION_QUANTITY_EXCEEDED: '取消数量超过未分配待交量；已出库、已签收或已安排发货的数量不能直接取消。',
    ORDER_CANCELLATION_PRICING_REVIEW_REQUIRED: '原订单计价或取消金额已变化，不能按旧申请冲减应收。',
    ORDER_CANCELLATION_REFUND_REQUIRED: '取消后将产生应退或结转金额；须先完成相应财务处理，不能修改已收款来抹平。',
    ORDER_CANCELLATION_INDEPENDENT_REVIEW_REQUIRED: '取消申请必须由另一名财务审核。',
    ORDER_CANCELLATION_CLOSED: '已结案或取消的订单不能直接冲销数量取消凭证。',
    ORDER_CANCELLATION_REVERSAL_ORDER_REQUIRED: '冲回会破坏原订单的分摊尾差，请先冲回该订单行后续的数量取消凭证。',
    ORDER_CANCELLATION_REVERSAL_REASON_REQUIRED: '请填写数量取消凭证的冲回依据（至少 3 个字符）。',
  };
  if (cancellationMessages[error.message]) return cancellationMessages[error.message];
  if (error.message === RECEIVABLE_ADJUSTMENT_EXCEEDS_AVAILABLE) {
    return '应收调整金额不能超过订单剩余可调整应收。';
  }
  if (error.message === RECEIVABLE_ADJUSTMENT_ORDER_STATE_CHANGED) {
    return '订单应收状态已变化，请刷新后重试。';
  }
  if (error.message === RECEIVABLE_ADJUSTMENT_INVALID_STATUS) {
    return '应收调整单状态不允许执行该操作。';
  }
  return null;
};

const normalizeReceivableAdjustmentType = (adjustmentType: string): ReceivableAdjustmentType => {
  if (!RECEIVABLE_ADJUSTMENT_TYPE_SET.has(adjustmentType)) {
    throw new Error(`Unsupported receivable adjustment type: ${adjustmentType}`);
  }
  return adjustmentType as ReceivableAdjustmentType;
};

const serializeSnapshot = (value: unknown) => {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

const normalizeBaseAmount = (amount: number, exchangeRate?: number | null, baseAmount?: number | null) => {
  if (baseAmount !== undefined && baseAmount !== null && Number.isFinite(Number(baseAmount))) {
    return roundMoney(Number(baseAmount));
  }
  const rate = Number(exchangeRate || 1);
  return multiplyMoney(amount, Number.isFinite(rate) && rate > 0 ? rate : 1);
};

const formatAdjustment = (record: ReceivableAdjustment & {
  orderItem?: { productName: string; unit: string } | null;
  order?: { orderNo: string; finalAmount: number; paidAmount: number; receivableAdjustmentAmount: number; paymentStatus: string } | null;
  customer?: { id: number; name: string; nameZh: string | null; nameEn: string | null; nameVi: string | null } | null;
  creator?: { id: number; username: string; role: string } | null;
  poster?: { id: number; username: string; role: string } | null;
  reverser?: { id: number; username: string; role: string } | null;
}) => ({
  id: record.id,
  adjustmentNo: record.adjustmentNo,
  adjustmentType: record.adjustmentType,
  orderItemId: record.orderItemId,
  cancelledQuantity: record.cancelledQuantity,
  unit: record.orderItem?.unit || null,
  productName: record.orderItem?.productName || null,
  customerId: record.customerId,
  customerName: record.customer?.nameZh || record.customer?.nameEn || record.customer?.nameVi || record.customer?.name || null,
  customerNameZh: record.customer?.nameZh || null,
  customerNameEn: record.customer?.nameEn || null,
  customerNameVi: record.customer?.nameVi || null,
  orderId: record.orderId,
  orderNo: record.order?.orderNo || null,
  amount: Number(record.amount),
  currency: record.currency,
  exchangeRate: Number(record.exchangeRate),
  baseAmount: Number(record.baseAmount),
  reason: record.reason,
  evidenceJson: record.evidenceJson,
  note: record.note,
  status: record.status,
  beforeSnapshot: record.beforeSnapshot ? JSON.parse(record.beforeSnapshot) : null,
  afterSnapshot: record.afterSnapshot ? JSON.parse(record.afterSnapshot) : null,
  createdBy: record.createdBy,
  creator: record.creator || null,
  postedBy: record.postedBy,
  poster: record.poster || null,
  reversedBy: record.reversedBy,
  reverser: record.reverser || null,
  postedAt: record.postedAt,
  reversedAt: record.reversedAt,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  orderSnapshot: record.order
    ? {
      finalAmount: Number(record.order.finalAmount),
      paidAmount: Number(record.order.paidAmount),
      receivableAdjustmentAmount: Number(record.order.receivableAdjustmentAmount),
      effectiveReceivableAmount: getEffectiveReceivableAmount(
        Number(record.order.finalAmount),
        Number(record.order.receivableAdjustmentAmount),
      ),
      outstandingAmount: getOutstandingAmount(
        Number(record.order.finalAmount),
        Number(record.order.paidAmount),
        Number(record.order.receivableAdjustmentAmount),
      ),
      paymentStatus: record.order.paymentStatus,
    }
    : null,
});

export class ReceivableAdjustmentService {
  private static buildAdjustmentNo() {
    return buildBusinessNo('RAR');
  }

  static async createOrderQuantityCancellation(orderId: number, raw: z.infer<typeof createOrderQuantityCancellationSchema>, req: AuthRequest) {
    const input = createOrderQuantityCancellationSchema.parse(raw), actorId = req.user!.userId;
    const fingerprint = createHash('sha256').update(JSON.stringify({ orderId, actorId, ...input })).digest('hex');
    return withDbRetry(() => prisma.$transaction(async tx => {
      const where = mergeWhereAnd({ id: orderId }, buildOrderDataScopeWhere(req, { includeFinanceAll: false }));
      const visible = await tx.order.findFirst({ where, include: { customer: { select: { salespersonId: true, poolState: true, segment: true } } } });
      if (!visible || !canUseOrderForBusinessWrite(req, visible)) throw new Error('ORDER_CANCELLATION_NOT_FOUND');
      await tx.$executeRaw`UPDATE "orders" SET "status" = "status" WHERE "id" = ${orderId}`;
      const order = await tx.order.findFirst({ where, include: { items: true, shipments: { include: { receipts: true } }, receivableAdjustments: true,
        customer: { select: { salespersonId: true, poolState: true, segment: true } } } });
      if (!order || !canUseOrderForBusinessWrite(req, order)) throw new Error('ORDER_CANCELLATION_NOT_FOUND');
      const replay = await tx.receivableAdjustment.findUnique({ where: { requestKey: input.idempotencyKey } });
      if (replay) {
        if (replay.orderId !== orderId || replay.createdBy !== actorId || replay.requestFingerprint !== fingerprint) throw new Error('ORDER_CANCELLATION_IDEMPOTENCY_CONFLICT');
        return formatAdjustment(replay);
      }
      if (!['confirmed', 'shipped', 'delivered'].includes(order.status) || order.updatedAt.toISOString() !== new Date(input.expectedUpdatedAt).toISOString()) throw new Error('ORDER_CANCELLATION_STATE_CHANGED');
      const quote = quoteOrderQuantityCancellation(order, input.orderItemId, input.quantity);
      const exchangeRate = quote.exchangeRate;
      const evidence = { kind: 'order_quantity_cancellation/v1', request: input, quote, currency: order.currency, exchangeRate,
        original: { totalAmount: order.totalAmount, discountAmount: order.discountAmount, finalAmount: order.finalAmount, items: order.items } };
      const record = await tx.receivableAdjustment.create({ data: {
        adjustmentNo: this.buildAdjustmentNo(), adjustmentType: ORDER_QUANTITY_CANCELLATION, orderId, customerId: order.customerId,
        orderItemId: input.orderItemId, cancelledQuantity: quote.quantity, amount: quote.amount,
        currency: order.currency, exchangeRate, baseAmount: quote.baseAmount,
        reason: input.reason, evidenceJson: JSON.stringify(evidence), requestKey: input.idempotencyKey, requestFingerprint: fingerprint,
        status: 'pending', createdBy: actorId,
      } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'REQUEST_ORDER_QUANTITY_CANCELLATION', resource: 'receivable_adjustment', resourceId: record.id, details: JSON.stringify(evidence) } });
      return formatAdjustment(record);
    }), { label: 'createOrderQuantityCancellation' });
  }

  static async createAdjustment(input: CreateReceivableAdjustmentInput, createdBy: number) {
    const adjustmentType = normalizeReceivableAdjustmentType(input.adjustmentType);
    const rawAmount = Number(input.amount);
    if (!Number.isFinite(rawAmount)) {
      throw new Error('应收调整金额必须大于 0。');
    }
    const amount = roundMoney(rawAmount);
    if (compareMoney(amount, 0) <= 0) {
      throw new Error('应收调整金额必须大于 0。');
    }

    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        customerId: true,
        status: true,
        finalAmount: true,
        paidAmount: true,
        receivableAdjustmentAmount: true,
        orderNo: true,
      },
    });
    if (!order) throw new Error(`Order not found: ${input.orderId}`);
    if (order.status === 'cancelled') throw new Error('Cancelled orders cannot receive receivable adjustments.');
    if (input.customerId && input.customerId !== order.customerId) {
      throw new Error('Receivable adjustment customer must match the order customer.');
    }

    const available = getOutstandingAmount(
      Number(order.finalAmount),
      Number(order.paidAmount),
      Number(order.receivableAdjustmentAmount),
    );
    if (compareMoney(amount, available) > 0) {
      throw new Error(RECEIVABLE_ADJUSTMENT_EXCEEDS_AVAILABLE);
    }

    const exchangeRate = input.exchangeRate ?? 1;
    const record = await prisma.receivableAdjustment.create({
      data: {
        adjustmentNo: this.buildAdjustmentNo(),
        adjustmentType,
        customerId: order.customerId,
        orderId: order.id,
        amount,
        currency: input.currency || 'CNY',
        exchangeRate,
        baseAmount: normalizeBaseAmount(amount, exchangeRate, input.baseAmount),
        reason: input.reason,
        evidenceJson: input.evidenceJson || null,
        note: input.note || null,
        status: 'pending',
        createdBy,
      },
      include: this.includeView(),
    });

    return formatAdjustment(record);
  }

  static async listAdjustments(filters: ListReceivableAdjustmentFilters) {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.orderId) where.orderId = filters.orderId;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.adjustmentType) where.adjustmentType = filters.adjustmentType;

    const skip = (filters.page - 1) * filters.pageSize;
    const [items, total] = await Promise.all([
      prisma.receivableAdjustment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: filters.pageSize,
        include: this.includeView(),
      }),
      prisma.receivableAdjustment.count({ where }),
    ]);

    return { items: items.map(formatAdjustment), total };
  }

  static async postAdjustment(adjustmentId: number, postedBy: number) {
    const result = await withDbRetry(() => prisma.$transaction(async (tx) => {
      const adjustment = await tx.receivableAdjustment.findUnique({ where: { id: adjustmentId } });
      if (!adjustment) throw new Error(`Receivable adjustment not found: ${adjustmentId}`);
      const quantityCancellation = adjustment.adjustmentType === ORDER_QUANTITY_CANCELLATION;
      if (quantityCancellation && adjustment.createdBy === postedBy) throw new Error('ORDER_CANCELLATION_INDEPENDENT_REVIEW_REQUIRED');
      if (adjustment.status === 'posted') return { changed: false, adjustment, customerId: adjustment.customerId };
      if (adjustment.status !== 'pending') throw new Error(RECEIVABLE_ADJUSTMENT_INVALID_STATUS);

      const claim = await tx.receivableAdjustment.updateMany({
        where: { id: adjustment.id, status: 'pending' },
        data: { status: 'posting' },
      });
      if (claim.count !== 1) {
        // Another node may have committed after our pending read. Replay only
        // the durable posted cancellation; an uncommitted/conflicting state is not success.
        if (quantityCancellation) {
          const committed = await tx.receivableAdjustment.findUnique({ where: { id: adjustment.id } });
          if (committed?.status === 'posted') return { changed: false, adjustment: committed, customerId: committed.customerId };
        }
        throw new Error(RECEIVABLE_ADJUSTMENT_ORDER_STATE_CHANGED);
      }

      const order = await tx.order.update({
        where: { id: adjustment.orderId },
        data: { updatedAt: now() },
        select: {
          id: true,
          customerId: true,
          status: true,
          finalAmount: true,
          paidAmount: true,
          receivableAdjustmentAmount: true,
          paymentStatus: true,
        },
      });
      if (order.status === 'cancelled' && !quantityCancellation) throw new Error('Cancelled orders cannot receive receivable adjustments.');

      if (quantityCancellation) {
        if (!['confirmed', 'shipped', 'delivered'].includes(order.status)) throw new Error('ORDER_CANCELLATION_STATE_CHANGED');
        const snapshot = await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, shipments: { include: { receipts: true } },
          receivableAdjustments: { where: { id: { not: adjustment.id } } } } });
        const quote = quoteOrderQuantityCancellation(snapshot, adjustment.orderItemId!, adjustment.cancelledQuantity!);
        if (compareMoney(quote.amount, adjustment.amount) !== 0 || compareMoney(quote.baseAmount, adjustment.baseAmount) !== 0
          || quote.exchangeRate !== adjustment.exchangeRate || snapshot.currency !== adjustment.currency) throw new Error('ORDER_CANCELLATION_PRICING_REVIEW_REQUIRED');
      }

      const currentAdjustment = Number(order.receivableAdjustmentAmount || 0);
      const nextAdjustment = addMoney(currentAdjustment, adjustment.amount);
      if (compareMoney(nextAdjustment, subtractMoney(order.finalAmount, order.paidAmount)) > 0) {
        throw new Error(RECEIVABLE_ADJUSTMENT_EXCEEDS_AVAILABLE);
      }

      const paymentStatus = determineReceivablePaymentStatus(
        Number(order.paidAmount),
        Number(order.finalAmount),
        nextAdjustment,
      );
      const beforeSnapshot = {
        orderId: order.id,
        paidAmount: Number(order.paidAmount),
        finalAmount: Number(order.finalAmount),
        receivableAdjustmentAmount: currentAdjustment,
        paymentStatus: order.paymentStatus,
      };
      const updateOrderResult = await tx.order.updateMany({
        where: {
          id: order.id,
          receivableAdjustmentAmount: currentAdjustment,
        },
        data: {
          receivableAdjustmentAmount: nextAdjustment,
          paymentStatus,
        },
      });
      if (updateOrderResult.count !== 1) {
        throw new Error(RECEIVABLE_ADJUSTMENT_ORDER_STATE_CHANGED);
      }

      const afterSnapshot = {
        orderId: order.id,
        paidAmount: Number(order.paidAmount),
        finalAmount: Number(order.finalAmount),
        receivableAdjustmentAmount: nextAdjustment,
        effectiveReceivableAmount: getEffectiveReceivableAmount(Number(order.finalAmount), nextAdjustment),
        outstandingAmount: getOutstandingAmount(Number(order.finalAmount), Number(order.paidAmount), nextAdjustment),
        paymentStatus,
      };

      const posted = await tx.receivableAdjustment.update({
        where: { id: adjustment.id },
        data: {
          status: 'posted',
          postedBy,
          postedAt: now(),
          beforeSnapshot: serializeSnapshot(beforeSnapshot),
          afterSnapshot: serializeSnapshot(afterSnapshot),
        },
      });

      await CollectionStateService.syncCustomerOverdueAmountTx(tx, order.customerId);

      if (quantityCancellation) await tx.auditLog.create({ data: { userId: postedBy, action: 'POST_ORDER_QUANTITY_CANCELLATION', resource: 'receivable_adjustment', resourceId: posted.id,
        details: JSON.stringify({ orderId: order.id, orderItemId: adjustment.orderItemId, cancelledQuantity: adjustment.cancelledQuantity,
          before: beforeSnapshot, after: afterSnapshot, fulfillment: await readOrderFulfillment(tx, order.id) }) } });

      return {
        changed: true,
        adjustment: posted,
        customerId: order.customerId,
        effects: { before: beforeSnapshot, after: afterSnapshot },
      };
    }), { label: 'postReceivableAdjustment' });

    const current = await prisma.receivableAdjustment.findUnique({
      where: { id: adjustmentId },
      include: this.includeView(),
    });
    if (!current) throw new Error(`Receivable adjustment not found: ${adjustmentId}`);
    return { adjustment: formatAdjustment(current), changed: result.changed, effects: result.effects || null };
  }

  static async reverseAdjustment(adjustmentId: number, reversedBy: number, note?: string | null) {
    const result = await withDbRetry(() => prisma.$transaction(async (tx) => {
      const adjustment = await tx.receivableAdjustment.findUnique({ where: { id: adjustmentId } });
      if (!adjustment) throw new Error(`Receivable adjustment not found: ${adjustmentId}`);
      if (adjustment.status === 'reversed') return { changed: false, adjustment, customerId: adjustment.customerId };
      if (adjustment.status !== 'posted') throw new Error(RECEIVABLE_ADJUSTMENT_INVALID_STATUS);
      if (adjustment.adjustmentType === ORDER_QUANTITY_CANCELLATION && String(note || '').trim().length < 3) throw new Error('ORDER_CANCELLATION_REVERSAL_REASON_REQUIRED');

      const claim = await tx.receivableAdjustment.updateMany({
        where: { id: adjustment.id, status: 'posted' },
        data: { status: 'reversing' },
      });
      if (claim.count !== 1) throw new Error(RECEIVABLE_ADJUSTMENT_ORDER_STATE_CHANGED);

      const order = await tx.order.update({
        where: { id: adjustment.orderId },
        data: { updatedAt: now() },
        select: {
          id: true,
          customerId: true,
          status: true,
          finalAmount: true,
          paidAmount: true,
          receivableAdjustmentAmount: true,
          paymentStatus: true,
        },
      });

      if (adjustment.adjustmentType === ORDER_QUANTITY_CANCELLATION && ['completed', 'cancelled'].includes(order.status)) throw new Error('ORDER_CANCELLATION_CLOSED');

      if (adjustment.adjustmentType === ORDER_QUANTITY_CANCELLATION) {
        const snapshot = await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true,
          shipments: { include: { receipts: true } }, receivableAdjustments: { where: { id: { not: adjustment.id } } } } });
        // Remaining immutable credits must still conserve the line's cumulative
        // cents. Never rewrite another voucher to hide a rounding discrepancy.
        try {
          const restored = { ...snapshot, receivableAdjustmentAmount: subtractMoney(order.receivableAdjustmentAmount, adjustment.amount) };
          const quote = quoteOrderQuantityCancellation(restored, adjustment.orderItemId!, adjustment.cancelledQuantity!);
          if (compareMoney(quote.amount, adjustment.amount) !== 0 || compareMoney(quote.baseAmount, adjustment.baseAmount) !== 0) throw new Error('ORDER_CANCELLATION_PRICING_REVIEW_REQUIRED');
        } catch (error) {
          if (error instanceof Error && error.message === 'ORDER_CANCELLATION_PRICING_REVIEW_REQUIRED') throw new Error('ORDER_CANCELLATION_REVERSAL_ORDER_REQUIRED');
          throw error;
        }
      }

      const currentAdjustment = Number(order.receivableAdjustmentAmount || 0);
      const nextAdjustment = maxMoney(0, subtractMoney(currentAdjustment, adjustment.amount));
      const paymentStatus = determineReceivablePaymentStatus(
        Number(order.paidAmount),
        Number(order.finalAmount),
        nextAdjustment,
      );
      const beforeSnapshot = {
        orderId: order.id,
        paidAmount: Number(order.paidAmount),
        finalAmount: Number(order.finalAmount),
        receivableAdjustmentAmount: currentAdjustment,
        paymentStatus: order.paymentStatus,
      };
      const updateOrderResult = await tx.order.updateMany({
        where: {
          id: order.id,
          receivableAdjustmentAmount: currentAdjustment,
        },
        data: {
          receivableAdjustmentAmount: nextAdjustment,
          paymentStatus,
        },
      });
      if (updateOrderResult.count !== 1) throw new Error(RECEIVABLE_ADJUSTMENT_ORDER_STATE_CHANGED);

      const afterSnapshot = {
        orderId: order.id,
        paidAmount: Number(order.paidAmount),
        finalAmount: Number(order.finalAmount),
        receivableAdjustmentAmount: nextAdjustment,
        effectiveReceivableAmount: getEffectiveReceivableAmount(Number(order.finalAmount), nextAdjustment),
        outstandingAmount: getOutstandingAmount(Number(order.finalAmount), Number(order.paidAmount), nextAdjustment),
        paymentStatus,
      };
      const reversed = await tx.receivableAdjustment.update({
        where: { id: adjustment.id },
        data: {
          status: 'reversed',
          reversedBy,
          reversedAt: now(),
          note: note || adjustment.note,
          afterSnapshot: serializeSnapshot({
            originalAfter: adjustment.afterSnapshot ? JSON.parse(adjustment.afterSnapshot) : null,
            reversalBefore: beforeSnapshot,
            reversalAfter: afterSnapshot,
          }),
        },
      });

      await CollectionStateService.syncCustomerOverdueAmountTx(tx, order.customerId);

      if (adjustment.adjustmentType === ORDER_QUANTITY_CANCELLATION) await tx.auditLog.create({ data: { userId: reversedBy, action: 'REVERSE_ORDER_QUANTITY_CANCELLATION', resource: 'receivable_adjustment', resourceId: adjustment.id,
        details: JSON.stringify({ orderId: order.id, orderItemId: adjustment.orderItemId, cancelledQuantity: adjustment.cancelledQuantity,
          before: beforeSnapshot, after: afterSnapshot, fulfillment: await readOrderFulfillment(tx, order.id), note: note || null }) } });

      return {
        changed: true,
        adjustment: reversed,
        customerId: order.customerId,
        effects: { before: beforeSnapshot, after: afterSnapshot },
      };
    }), { label: 'reverseReceivableAdjustment' });

    const current = await prisma.receivableAdjustment.findUnique({
      where: { id: adjustmentId },
      include: this.includeView(),
    });
    if (!current) throw new Error(`Receivable adjustment not found: ${adjustmentId}`);
    return { adjustment: formatAdjustment(current), changed: result.changed, effects: result.effects || null };
  }

  private static includeView() {
    return {
      orderItem: { select: { productName: true, unit: true } },
      order: {
        select: {
          orderNo: true,
          finalAmount: true,
          paidAmount: true,
          receivableAdjustmentAmount: true,
          paymentStatus: true,
        },
      },
      customer: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } },
      creator: { select: { id: true, username: true, role: true } },
      poster: { select: { id: true, username: true, role: true } },
      reverser: { select: { id: true, username: true, role: true } },
    } as const;
  }
}
