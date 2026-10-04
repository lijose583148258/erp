import { randomUUID } from 'crypto';
import { Prisma, type PaymentReversalRequest } from '@prisma/client';
import prisma from '../config/database';
import { withDbRetry } from '../utils/dbRetry';
import { compareMoney, subtractMoney } from '../utils/money';
import { CollectionStateService, calculateVerifiedPaymentState } from './collection-state.service';
import { determineReceivablePaymentStatus } from './collection/collection.helpers';
import { getAppliedFinanceAdjustmentAmountTx } from './payment-ledger-contribution';
import { assertReversibleCash, originalPaymentFacts, reversalError,
    type ReversalRequestFacts, type ReversalReviewFacts } from './payment-reversal-facts';
import { requestReversalFingerprint as requestFingerprint, reviewReversalFingerprint as reviewFingerprint,
    readReversalRequestReceipt, readReversalReviewReceipt, validateReversalEffect } from './payment-reversal-receipts';
import { recordPaymentReversedEventTx } from './payment-reversal-event.service';

const orderSelect = { id: true, customerId: true, createdBy: true, currency: true, finalAmount: true, paidAmount: true,
    receivableAdjustmentAmount: true, paymentStatus: true, customer: { select: { salespersonId: true, poolState: true, segment: true } } } as const;
type OrderScope = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;
type Db = Prisma.TransactionClient | typeof prisma;
type Actor = { userId: number; authorize: (order: OrderScope) => boolean; ip?: string; userAgent?: string };
const requireOrder = async (db: Db, orderId: number, actor: Actor) => {
    const order = await db.order.findUnique({ where: { id: orderId }, select: orderSelect });
    if (!order || !actor.authorize(order)) reversalError('PAYMENT_REVERSAL_SCOPE_DENIED', '无权处理该订单的回款冲销。', 403);
    return order!;
};
export const formatPaymentReversalRequest = (r: PaymentReversalRequest) => ({ id: r.id, paymentId: r.paymentId, status: r.status,
    requestedBy: r.requestedBy, reasonCategory: r.reasonCategory, reason: r.reason, createdAt: r.createdAt,
    reviewedBy: r.reviewedBy, reviewNote: r.reviewNote, reviewedAt: r.reviewedAt,
    originalPayment: JSON.parse(r.originalPaymentJson), requestReceipt: readReversalRequestReceipt(r),
    reviewReceipt: r.status === 'pending' ? null : readReversalReviewReceipt(r) });

async function requestReplay(r: PaymentReversalRequest, input: Actor & { paymentId: number; key: string; facts: ReversalRequestFacts }, db: Db = prisma) {
    if (r.paymentId !== input.paymentId || r.requestedBy !== input.userId || r.requestKey !== input.key
        || r.fingerprint !== requestFingerprint(input.paymentId, input.userId, input.facts, r.originalPaymentJson))
        reversalError('PAYMENT_REVERSAL_KEY_CONFLICT', '该请求身份已关联不同主体、原回款或冲销事实。');
    const receipt = readReversalRequestReceipt(r);
    const payment = await db.paymentRecord.findUniqueOrThrow({ where: { id: input.paymentId }, select: { orderId: true } });
    if (payment.orderId !== receipt.orderId) reversalError('PAYMENT_REVERSAL_RECEIPT_INVALID', '原回款订单关联与冲销回执不一致。');
    const currentOrder = await requireOrder(db, payment.orderId, input);
    return { replayed: true, request: formatPaymentReversalRequest(r), receipt, currentOrder };
}

export async function requestPaymentReversal(input: Actor & { paymentId: number; key: string; facts: ReversalRequestFacts }) {
    try {
        return await withDbRetry(async () => {
            const existing = await prisma.paymentReversalRequest.findUnique({ where: { requestKey: input.key } });
            if (existing) return requestReplay(existing, input);
            return prisma.$transaction(async tx => {
                const target = await tx.paymentRecord.findUnique({ where: { id: input.paymentId }, select: { orderId: true } });
                if (!target) reversalError('PAYMENT_REVERSAL_NOT_FOUND', '原回款不存在。', 404);
                await tx.$executeRaw`UPDATE "orders" SET "id"="id" WHERE "id"=${target!.orderId}`;
                const order = await requireOrder(tx, target!.orderId, input);
                const raced = await tx.paymentReversalRequest.findUnique({ where: { requestKey: input.key } });
                if (raced) return requestReplay(raced, input, tx);
                const payment = await tx.paymentRecord.findUniqueOrThrow({ where: { id: input.paymentId }, include: { barterSettlement: true, barterOffsetPostings: true } });
                assertReversibleCash(payment, order.currency);
                if (await tx.paymentReversalRequest.findUnique({ where: { activePaymentId: payment.id } }))
                    reversalError('PAYMENT_REVERSAL_ALREADY_PENDING', '此原回款已有待审批冲销申请，请核对原申请而非重复创建。');
                const originalAudits = await tx.auditLog.findMany({ where: { action: 'PAYMENT_VERIFIED', resource: 'payment', resourceId: payment.id }, select: { id: true } });
                if (originalAudits.length > 1) reversalError('PAYMENT_REVERSAL_HISTORY_REQUIRES_RECONCILIATION', '原回款存在重复核销审计，须先核对历史凭证。');
                const id = randomUUID(), at = new Date(), original = JSON.stringify(originalPaymentFacts(payment));
                const fingerprint = requestFingerprint(payment.id, input.userId, input.facts, original);
                const audit = await tx.auditLog.create({ data: { userId: input.userId, action: 'PAYMENT_REVERSAL_REQUESTED', resource: 'payment', resourceId: payment.id,
                    details: JSON.stringify({ requestId: id, orderId: order.id, amount: payment.amount, currency: payment.currency,
                        ...input.facts, fingerprint, originalAuditId: originalAudits[0]?.id ?? null }), ipAddress: input.ip, userAgent: input.userAgent } });
                const receipt = { version: 'payment-reversal-request/v1', requestId: id, requestKey: input.key, paymentId: payment.id, orderId: order.id,
                    requestedBy: input.userId, amount: payment.amount, currency: payment.currency, status: 'pending', auditId: audit.id, requestedAt: at.toISOString(), ...input.facts };
                const request = await tx.paymentReversalRequest.create({ data: { id, requestKey: input.key, paymentId: payment.id, activePaymentId: payment.id,
                    requestedBy: input.userId, ...input.facts, fingerprint, originalPaymentJson: original, requestReceiptJson: JSON.stringify(receipt),
                    requestAuditId: audit.id, originalAuditId: originalAudits[0]?.id ?? null, createdAt: at } });
                return { replayed: false, request: formatPaymentReversalRequest(request), receipt, currentOrder: order };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 15000 });
        }, { label: 'requestPaymentReversal' });
    } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
            const winner = await prisma.paymentReversalRequest.findUnique({ where: { requestKey: input.key } });
            if (winner) return requestReplay(winner, input);
            reversalError('PAYMENT_REVERSAL_ALREADY_PENDING', '此原回款已有并发提交的冲销申请，请核对原申请。');
        }
        throw error;
    }
}

async function reviewReplay(r: PaymentReversalRequest, input: Actor & { requestId: string; key: string; facts: ReversalReviewFacts }, db: Db = prisma) {
    if (r.requestedBy === input.userId) reversalError('PAYMENT_REVERSAL_SEPARATION_REQUIRED', '申请人不能审批自己的冲销申请。', 403);
    if (r.id !== input.requestId || r.reviewKey !== input.key || r.reviewedBy !== input.userId
        || r.reviewFingerprint !== reviewFingerprint(input.requestId, input.userId, input.facts))
        reversalError('PAYMENT_REVERSAL_REVIEW_CONFLICT', '原申请已处理，或审批请求身份关联不同事实；不能重复入账。');
    const receipt = validateReversalEffect(r, await db.paymentReversal.findUnique({ where: { requestId: r.id } }));
    const payment = await db.paymentRecord.findUniqueOrThrow({ where: { id: r.paymentId }, select: { orderId: true } });
    if (payment.orderId !== receipt.orderId) reversalError('PAYMENT_REVERSAL_RECEIPT_INVALID', '原回款订单关联与冲销回执不一致。');
    const currentOrder = await requireOrder(db, payment.orderId, input);
    return { replayed: true, request: formatPaymentReversalRequest(r), receipt, currentOrder };
}

export async function reviewPaymentReversal(input: Actor & { requestId: string; key: string; facts: ReversalReviewFacts }) {
    try {
        return await withDbRetry(async () => {
            const initial = await prisma.paymentReversalRequest.findUnique({ where: { id: input.requestId } });
            if (!initial) reversalError('PAYMENT_REVERSAL_NOT_FOUND', '冲销申请不存在。', 404);
            if (initial!.requestedBy === input.userId) reversalError('PAYMENT_REVERSAL_SEPARATION_REQUIRED', '申请人不能审批自己的冲销申请。', 403);
            if (initial!.status !== 'pending') return reviewReplay(initial!, input);
            const keyOwner = await prisma.paymentReversalRequest.findUnique({ where: { reviewKey: input.key } });
            if (keyOwner && keyOwner.id !== input.requestId) reversalError('PAYMENT_REVERSAL_REVIEW_CONFLICT', '审批请求身份已用于另一份申请。');
            return prisma.$transaction(async tx => {
                const target = await tx.paymentRecord.findUniqueOrThrow({ where: { id: initial!.paymentId }, select: { orderId: true } });
                await tx.$executeRaw`UPDATE "orders" SET "id"="id" WHERE "id"=${target.orderId}`;
                const order = await requireOrder(tx, target.orderId, input);
                const r = await tx.paymentReversalRequest.findUniqueOrThrow({ where: { id: input.requestId } });
                if (r.status !== 'pending') return reviewReplay(r, input, tx);
                readReversalRequestReceipt(r);
                if (r.requestedBy === input.userId) reversalError('PAYMENT_REVERSAL_SEPARATION_REQUIRED', '申请人与审批人必须是不同主体。', 403);
                const payment = await tx.paymentRecord.findUniqueOrThrow({ where: { id: r.paymentId }, include: { barterSettlement: true, barterOffsetPostings: true } });
                const approved = input.facts.decision === 'approve', status = approved ? 'posted' : 'rejected', at = new Date();
                let afterPaid = Number(order.paidAmount), reversalId: string | null = null;
                if (approved) {
                    assertReversibleCash(payment, order.currency);
                    if (JSON.stringify(originalPaymentFacts(payment)) !== r.originalPaymentJson)
                        reversalError('PAYMENT_REVERSAL_ORIGINAL_CHANGED', '原回款事实已改变，须核对凭证后重新申请。');
                    const verified = await tx.paymentRecord.findMany({ where: { orderId: order.id, status: 'verified' }, select: { amount: true } });
                    const canonical = calculateVerifiedPaymentState({ verifiedPayments: verified, finalAmount: order.finalAmount,
                        receivableAdjustmentAmount: order.receivableAdjustmentAmount, appliedFinanceAdjustmentAmount: await getAppliedFinanceAdjustmentAmountTx(tx, order.id) });
                    if (compareMoney(canonical.paidAmount, order.paidAmount) !== 0 || canonical.exceedsOutstanding)
                        reversalError('PAYMENT_REVERSAL_LEDGER_DRIFT', '订单已收与已核销及调整净额不一致，须先对账，不能通过冲销掩盖差异。');
                    afterPaid = subtractMoney(order.paidAmount, payment.amount);
                    if (compareMoney(afterPaid, 0) < 0) reversalError('PAYMENT_REVERSAL_NEGATIVE_LEDGER', '冲销将导致已收净额为负，请先处理关联调整。');
                    reversalId = randomUUID();
                }
                const audit = await tx.auditLog.create({ data: { userId: input.userId, action: approved ? 'PAYMENT_REVERSED' : 'PAYMENT_REVERSAL_REJECTED', resource: 'payment', resourceId: payment.id,
                    details: JSON.stringify({ requestId: r.id, reversalId, requestedBy: r.requestedBy, reviewedBy: input.userId, decision: input.facts.decision,
                        note: input.facts.note, orderId: order.id, amount: approved ? -payment.amount : 0, currency: payment.currency,
                        beforePaidAmount: order.paidAmount, afterPaidAmount: afterPaid }), ipAddress: input.ip, userAgent: input.userAgent } });
                const receipt = { version: 'payment-reversal-review/v1', requestId: r.id, reviewKey: input.key, paymentId: payment.id, orderId: order.id,
                    reversalId, status, requestedBy: r.requestedBy, reviewedBy: input.userId, amount: approved ? -payment.amount : 0,
                    currency: payment.currency, auditId: audit.id, reviewedAt: at.toISOString(), beforePaidAmount: order.paidAmount, afterPaidAmount: afterPaid };
                if (approved) await tx.paymentReversal.create({ data: { id: reversalId!, paymentId: payment.id, requestId: r.id, postedBy: input.userId, auditId: audit.id,
                    amount: -payment.amount, currency: payment.currency, beforeStateJson: JSON.stringify({ orderId: order.id, paidAmount: order.paidAmount, paymentStatus: order.paymentStatus }),
                    afterStateJson: JSON.stringify({ orderId: order.id, paidAmount: afterPaid, paymentStatus: determineReceivablePaymentStatus(afterPaid, order.finalAmount, order.receivableAdjustmentAmount) }),
                    receiptJson: JSON.stringify(receipt), createdAt: at } });
                const updated = await tx.paymentReversalRequest.update({ where: { id: r.id }, data: { status, activePaymentId: null, reviewKey: input.key,
                    reviewFingerprint: reviewFingerprint(r.id, input.userId, input.facts), reviewedBy: input.userId, reviewNote: input.facts.note,
                    reviewAuditId: audit.id, reviewReceiptJson: JSON.stringify(receipt), reviewedAt: at } });
                if (approved) {
                    const claim = await tx.paymentRecord.updateMany({ where: { id: payment.id, status: 'verified' }, data: { status: 'reversed' } });
                    if (claim.count !== 1) reversalError('PAYMENT_REVERSAL_INVALID_STATE', '原回款状态已变化，冲销整体回滚。');
                    const rebuilt = await CollectionStateService.recalculateOrderPaymentStateTx(tx, order.id);
                    if (compareMoney(rebuilt.paidAmount, afterPaid) !== 0) reversalError('PAYMENT_REVERSAL_LEDGER_DRIFT', '冲销后重算与抵消分录不一致，整体回滚。');
                    if (payment.milestoneId) {
                        await CollectionStateService.recalculateContractMilestonePaymentStateTx(tx, payment.milestoneId);
                    }
                    await recordPaymentReversedEventTx(tx, reversalId!);
                }
                const currentOrder = await requireOrder(tx, order.id, input);
                return { replayed: false, request: formatPaymentReversalRequest(updated), receipt, currentOrder };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 15000 });
        }, { label: 'reviewPaymentReversal' });
    } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
            const current = await prisma.paymentReversalRequest.findUnique({ where: { id: input.requestId } });
            if (current && current.status !== 'pending') return reviewReplay(current, input);
            reversalError('PAYMENT_REVERSAL_REVIEW_CONFLICT', '审批请求身份或原回款已被另一笔操作占用，当前交易已回滚。');
        }
        throw error;
    }
}
