import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import type { AuthRequest } from '../../middleware/auth';
import { canUseOrderForCollectionWrite } from '../../utils/recordAccess';
import { logger } from '../../utils/logger';
import { collectionOrderScopeSelect, requireCollectionOrderAccess, requireFinanceCollectionScope } from './collection-controller.helpers';
import { requestPaymentReversal, reviewPaymentReversal, formatPaymentReversalRequest } from '../../services/payment-reversal.service';
import { assertReversibleCash, originalPaymentFacts, normalizeReversalRequest, normalizeReversalReview, PaymentReversalError, reversalKey } from '../../services/payment-reversal-facts';
import { validateReversalEffect } from '../../services/payment-reversal-receipts';

export class PaymentReversalController {
    private fail(res: Response, error: unknown) {
        if (error instanceof PaymentReversalError) return res.status(error.status).json({ success: false, errorCode: error.code, message: error.message });
        logger.error('Payment reversal failed', error);
        return res.status(500).json({ success: false, message: '冲销未确认成功，请保留原请求身份并核对原记录。' });
    }
    async request(req: AuthRequest, res: Response) {
        try {
            if (!(await requireFinanceCollectionScope(req, res))) return;
            const paymentId = Number(req.params.paymentId), payment = await prisma.paymentRecord.findUnique({ where: { id: paymentId }, select: { orderId: true } });
            if (!payment) return res.status(404).json({ success: false, message: '原回款不存在。' });
            if (!(await requireCollectionOrderAccess(req, res, payment.orderId))) return;
            const result = await requestPaymentReversal({ paymentId, key: reversalKey(req.body.requestKey), facts: normalizeReversalRequest(req.body),
                userId: req.user!.userId, ip: req.ip, userAgent: req.get('user-agent'), authorize: order => canUseOrderForCollectionWrite(req, order) });
            return res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
        } catch (error) { return this.fail(res, error); }
    }
    async review(req: AuthRequest, res: Response) {
        try {
            if (!(await requireFinanceCollectionScope(req, res))) return;
            const requestId = String(req.params.requestId), request = await prisma.paymentReversalRequest.findUnique({ where: { id: requestId }, select: { payment: { select: { orderId: true } } } });
            if (!request) return res.status(404).json({ success: false, message: '冲销申请不存在。' });
            if (!(await requireCollectionOrderAccess(req, res, request.payment.orderId))) return;
            const result = await reviewPaymentReversal({ requestId, key: reversalKey(req.body.reviewKey), facts: normalizeReversalReview(req.body),
                userId: req.user!.userId, ip: req.ip, userAgent: req.get('user-agent'), authorize: order => canUseOrderForCollectionWrite(req, order) });
            return res.json({ success: true, data: result });
        } catch (error) { return this.fail(res, error); }
    }
    async history(req: AuthRequest, res: Response) {
        try {
            const paymentId = Number(req.params.paymentId);
            const data = await prisma.$transaction(async tx => {
                const payment = await tx.paymentRecord.findUnique({ where: { id: paymentId }, include: {
                    order: { select: { ...collectionOrderScopeSelect, currency: true, paidAmount: true, finalAmount: true,
                        receivableAdjustmentAmount: true, paymentStatus: true } }, barterSettlement: { select: { id: true } }, barterOffsetPostings: { select: { id: true } },
                } });
                if (!payment || !canUseOrderForCollectionWrite(req, payment.order)) return null;
                const [requests, reversal] = await Promise.all([
                    tx.paymentReversalRequest.findMany({ where: { paymentId }, orderBy: { createdAt: 'asc' } }),
                    tx.paymentReversal.findUnique({ where: { paymentId } }),
                ]);
                for (const request of requests) if (request.status !== 'pending')
                    validateReversalEffect(request, reversal?.requestId === request.id ? reversal : null);
                let eligibility: { allowed: boolean; errorCode?: string; message?: string } = { allowed: true };
                try { assertReversibleCash(payment, payment.order.currency); }
                catch (error) {
                    if (!(error instanceof PaymentReversalError)) throw error;
                    eligibility = { allowed: false, errorCode: error.code, message: error.message };
                }
                if (eligibility.allowed && requests.some(r => r.status === 'pending'))
                    eligibility = { allowed: false, errorCode: 'PAYMENT_REVERSAL_ALREADY_PENDING', message: '原回款已有待审批冲销申请。' };
                return { paymentId, paymentStatus: payment.status, originalPayment: originalPaymentFacts(payment), eligibility,
                    currentOrder: { id: payment.order.id, currency: payment.order.currency, paidAmount: payment.order.paidAmount,
                        finalAmount: payment.order.finalAmount, receivableAdjustmentAmount: payment.order.receivableAdjustmentAmount, paymentStatus: payment.order.paymentStatus },
                    requests: requests.map(formatPaymentReversalRequest), reversal: reversal ? { id: reversal.id, requestId: reversal.requestId,
                        amount: reversal.amount, currency: reversal.currency, postedBy: reversal.postedBy, auditId: reversal.auditId,
                        postedAt: reversal.createdAt, receipt: JSON.parse(reversal.receiptJson) } : null };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 10000 });
            if (!data) return res.status(404).json({ success: false, message: '原回款不存在或无权查看。' });
            return res.json({ success: true, data });
        } catch (error) { return this.fail(res, error); }
    }
}
