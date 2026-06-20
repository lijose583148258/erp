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
import { withDbRetry } from '../utils/dbRetry';
import { logger } from '../utils/logger';
import { canUseOrderForBusinessWrite } from '../utils/recordAccess';
import { requireFinanceCollectionScope } from './collection/collection-controller.helpers';

export async function recordOrderPayment(req: AuthRequest, res: Response) {
    try {
        const { id } = req.params;
        const { amount, method, payerName, note, isProxy = false } = req.body;
        const paymentAmount = Number(amount);
        const normalizedPayerName = payerName || null;
        const normalizedNote = note || null;

        if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: '回款金额必须大于 0。',
            } as ApiResponse);
        }

        const orderMeta = await prisma.order.findUnique({
            where: { id: Number(id) },
            select: {
                id: true,
                status: true,
                paymentStatus: true,
                paidAmount: true,
                finalAmount: true,
                receivableAdjustmentAmount: true,
                createdBy: true,
                customer: { select: { salespersonId: true, poolState: true, segment: true } },
            },
        });

        if (!orderMeta) {
            return res.status(404).json({
                success: false,
                message: '订单不存在，请刷新后重试。',
            } as ApiResponse);
        }

        if (orderMeta.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                message: '已取消订单不能登记回款。',
            } as ApiResponse);
        }
        if (!canUseOrderForBusinessWrite(req, orderMeta)) {
            return res.status(403).json({
                success: false,
                message: '无权为该订单登记回款。',
            } as ApiResponse);
        }

        const orderOutstanding = getOutstandingAmount(
            Number(orderMeta.finalAmount),
            Number(orderMeta.paidAmount),
            Number(orderMeta.receivableAdjustmentAmount),
        );
        if (orderOutstanding <= 0.01 || orderMeta.paymentStatus === 'paid') {
            return res.status(400).json({
                success: false,
                message: '该订单已全部回款，无需重复登记。',
            } as ApiResponse);
        }

        if (paymentAmount - orderOutstanding > 0.01) {
            return res.status(400).json({
                success: false,
                message: '回款金额不能超过订单未回款余额。',
            } as ApiResponse);
        }

        const duplicateWindowStart = new Date(Date.now() - 15_000);
        const transactionResult = await withDbRetry(() => prisma.$transaction(async (tx) => {
            // Serialize same-order payment submissions before checking duplicates.
            // Without this row touch, two fast clicks can both read "no pending duplicate"
            // and create two identical payment records.
            const liveOrder = await tx.order.update({
                where: { id: Number(id) },
                data: { updatedAt: new Date() },
                select: {
                    id: true,
                    paymentStatus: true,
                    paidAmount: true,
                    finalAmount: true,
                    receivableAdjustmentAmount: true,
                },
            });

            const liveOrderOutstanding = getOutstandingAmount(
                Number(liveOrder.finalAmount),
                Number(liveOrder.paidAmount),
                Number(liveOrder.receivableAdjustmentAmount),
            );
            if (liveOrderOutstanding <= 0.01 || liveOrder.paymentStatus === 'paid') {
                return { duplicatePaymentId: null, alreadyPaid: true };
            }

            const duplicatePendingPayment = await tx.paymentRecord.findFirst({
                where: {
                    orderId: Number(id),
                    amount: paymentAmount,
                    method,
                    payerName: normalizedPayerName,
                    note: normalizedNote,
                    isProxy: Boolean(isProxy),
                    status: 'pending',
                    createdAt: { gte: duplicateWindowStart },
                },
                select: { id: true },
            });

            if (duplicatePendingPayment) {
                return { duplicatePaymentId: duplicatePendingPayment.id };
            }

            const pendingPayments = await tx.paymentRecord.aggregate({
                where: {
                    orderId: Number(id),
                    status: 'pending',
                },
                _sum: { amount: true },
            });
            const pendingAmount = Number(pendingPayments._sum.amount || 0);
            const liveOutstanding = Math.max(0, liveOrderOutstanding - pendingAmount);
            if (paymentAmount - liveOutstanding > 0.01) {
                return { duplicatePaymentId: null, pendingExceedsOutstanding: true };
            }

            const orderWithContract = await tx.order.findUnique({
                where: { id: Number(id) },
                select: {
                    id: true,
                    contract: {
                        select: {
                            milestones: {
                                where: { status: 'pending' },
                                orderBy: { id: 'asc' },
                                take: 1,
                                select: { id: true },
                            },
                        },
                    },
                },
            });

            const milestoneId = orderWithContract?.contract?.milestones?.[0]?.id ?? null;

            await tx.paymentRecord.create({
                data: {
                    orderId: Number(id),
                    amount: paymentAmount,
                    method,
                    payerName: normalizedPayerName,
                    note: normalizedNote,
                    isProxy,
                    milestoneId,
                    status: 'pending',
                },
            });

            await tx.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    action: 'PAYMENT_SUBMITTED',
                    resource: 'order',
                    resourceId: Number(id),
                    details: JSON.stringify({ amount: paymentAmount, method, milestoneId, status: 'pending' }),
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                },
            });

            return { duplicatePaymentId: null };
        }), { label: 'recordPayment' });

        if (transactionResult.alreadyPaid) {
            return res.status(400).json({
                success: false,
                message: '该订单已全部回款，无需重复登记。',
            } as ApiResponse);
        }

        if (transactionResult.pendingExceedsOutstanding) {
            return res.status(409).json({
                success: false,
                message: '待核销回款已覆盖剩余未回款金额，请先核销或驳回待处理记录。',
            } as ApiResponse);
        }

        if (transactionResult.duplicatePaymentId) {
            const order = await OrderWorkspaceService.getOrderById(Number(id), req);
            return res.status(409).json({
                success: false,
                message: '检测到重复提交，请刷新回款记录后再操作。',
                data: order,
            } as ApiResponse);
        }

        const order = await OrderWorkspaceService.getOrderById(Number(id), req);
        logger.info(`Payment submitted: orderId=${id}, amount=${amount}`);

        return res.json({
            success: true,
            message: '回款已登记，等待财务核销。',
            data: order,
        } as ApiResponse);
    } catch (error) {
        logger.error('Record payment error:', error);
        return res.status(500).json({
            success: false,
            message: '服务器内部错误',
        } as ApiResponse);
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
        if (orderForSoD && !canUseOrderForBusinessWrite(req, orderForSoD)) {
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
