import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import {
    CollectionStateService,
    getPaymentVerificationConflictMessage,
} from '../services/collection-state.service';
import { getOutstandingAmount } from '../services/collection/collection.helpers';
import { OrderWorkspaceService } from '../services/order-workspace.service';
import { ApiResponse } from '../types/api.types';
import { normalizePaymentSubmissionFacts, normalizePaymentSubmissionKey, PaymentSubmissionError, submitPaymentDurably } from '../services/payment-submission.service';
import { logger } from '../utils/logger';
import { canUseOrderForCollectionWrite } from '../utils/recordAccess';
import { requireFinanceCollectionScope } from './collection/collection-controller.helpers';
import { publishRealtimeNotification } from '../services/realtime-notification.service';
import { publishWebhookEvent } from '../services/webhook.service';

export async function recordOrderPayment(req: AuthRequest, res: Response) {
    try {
        const orderId = Number(req.params.id);
        const orderMeta = await prisma.order.findUnique({ where: { id: orderId }, select: {
            id: true, createdBy: true, customer: { select: { salespersonId: true, poolState: true, segment: true } },
        } });
        if (!orderMeta) return res.status(404).json({ success: false, message: '订单不存在，请刷新后重试。' });
        if (!canUseOrderForCollectionWrite(req, orderMeta)) return res.status(403).json({ success: false, message: '无权为该订单登记回款。' });
        const header = req.get('Idempotency-Key'), body = req.body.idempotencyKey;
        if (header && body !== undefined && header !== body) throw new PaymentSubmissionError('PAYMENT_SUBMISSION_KEY_CONFLICT', '请求头与载荷中的登记身份不一致。');
        const key = normalizePaymentSubmissionKey(header ?? body);
        const facts = normalizePaymentSubmissionFacts(req.body);
        const result = await submitPaymentDurably({ orderId, userId: req.user!.userId, key, facts,
            ip: req.ip, userAgent: req.get('user-agent'), authorize: order => canUseOrderForCollectionWrite(req, order) });
        // Replays acknowledge the original receipt but read back today's order. No new effects/notifications.
        const order = await OrderWorkspaceService.getOrderById(orderId, req);
        if (!result.replayed) {
            logger.info('Payment submitted', { orderId, paymentId: result.receipt.paymentId });
            publishRealtimeNotification({ type: 'payment.submitted', title: 'Payment submitted',
                message: '新增待核销回款', resourceType: 'payment', resourceId: result.receipt.paymentId, severity: 'warning',
                audience: { roles: ['admin', 'manager', 'finance'] } });
            publishWebhookEvent({ type: 'payment.submitted', resourceType: 'payment', resourceId: result.receipt.paymentId,
                data: { orderId, paymentId: result.receipt.paymentId, amount: facts.amount, method: facts.method } });
        }
        return res.json({ success: true, message: result.replayed ? '原回款登记已确认，未重复入账。' : '回款已登记，等待财务核销。',
            data: order, paymentSubmission: result.receipt, replayed: result.replayed });
    } catch (error) {
        if (error instanceof PaymentSubmissionError) return res.status(error.status).json({ success: false, errorCode: error.code, message: error.message });
        logger.error('Record payment error:', error);
        return res.status(500).json({ success: false, message: '服务器内部错误' } as ApiResponse);
    }
}

export async function verifyOrderPayment(req: AuthRequest, res: Response) {
    try {
        const { id, paymentId } = req.params;
        if (!(await requireFinanceCollectionScope(req, res))) return;
        const payment = await prisma.paymentRecord.findUnique({
            where: { id: Number(paymentId) },
            select: { id: true, orderId: true },
        });

        if (!payment || payment.orderId !== Number(id)) {
            return res.status(404).json({
                success: false,
                message: '回款记录不存在，请刷新后重试。',
            } as ApiResponse);
        }

        // H5修复：职责分离 - 订单创建者不能验证自己订单的付款
        const orderForSoD = await prisma.order.findUnique({
            where: { id: Number(id) },
            select: {
                createdBy: true,
                customer: { select: { salespersonId: true, poolState: true, segment: true } },
            },
        });
        if (orderForSoD && !canUseOrderForCollectionWrite(req, orderForSoD)) {
            return res.status(403).json({
                success: false,
                message: '无权核销该订单的回款。',
            } as ApiResponse);
        }
        if (orderForSoD && orderForSoD.createdBy === req.user!.userId) {
            return res.status(403).json({
                success: false,
                message: '职责分离：订单创建者不能验证自己订单的付款记录。',
            } as ApiResponse);
        }

        const result = await CollectionStateService.verifyPaymentRecord(payment.id, req.user!.userId);
        const order = await OrderWorkspaceService.getOrderById(Number(id), req);
        // Both verification routes commit the same durable event in the service.
        // HTTP replays must never generate new side effects here.

        return res.json({
            success: true,
            message: 'Payment verified successfully.',
            data: order || result,
        } as ApiResponse);
    } catch (error) {
        logger.error('Verify payment error:', error);
        const conflictMessage = getPaymentVerificationConflictMessage(error);
        return res.status(conflictMessage ? 409 : 500).json({
            success: false,
            message: conflictMessage || '服务器内部错误',
        } as ApiResponse);
    }
}
