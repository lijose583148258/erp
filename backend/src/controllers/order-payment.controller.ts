import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import {
    CollectionStateService,
    getPaymentVerificationConflictMessage,
} from '../services/collection-state.service';
import { OrderWorkspaceService } from '../services/order-workspace.service';
import { ApiResponse } from '../types/api.types';
import { withDbRetry } from '../utils/dbRetry';
import { logger } from '../utils/logger';
import { canUseOrderForBusinessWrite } from '../utils/recordAccess';

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
                message: 'Payment amount must be greater than zero.',
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
                createdBy: true,
                customer: { select: { salespersonId: true, poolState: true, segment: true } },
            },
        });

        if (!orderMeta) {
            return res.status(404).json({
                success: false,
                message: 'Order not found.',
            } as ApiResponse);
        }

        if (orderMeta.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                message: 'Cancelled orders cannot accept payments.',
            } as ApiResponse);
        }
        if (!canUseOrderForBusinessWrite(req, orderMeta)) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to record payments for this order.',
            } as ApiResponse);
        }

        if (Number(orderMeta.paidAmount) >= Number(orderMeta.finalAmount) || orderMeta.paymentStatus === 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Order is already fully paid.',
            } as ApiResponse);
        }

        const outstanding = Math.max(0, Number(orderMeta.finalAmount) - Number(orderMeta.paidAmount));
        if (paymentAmount - outstanding > 0.01) {
            return res.status(400).json({
                success: false,
                message: 'Payment amount exceeds outstanding balance.',
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
                },
            });

            if (Number(liveOrder.paidAmount) >= Number(liveOrder.finalAmount) || liveOrder.paymentStatus === 'paid') {
                return { duplicatePaymentId: null, alreadyPaid: true };
            }

            const liveOutstanding = Math.max(0, Number(liveOrder.finalAmount) - Number(liveOrder.paidAmount));
            if (paymentAmount - liveOutstanding > 0.01) {
                return { duplicatePaymentId: null, exceedsOutstanding: true };
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
                message: 'Order is already fully paid.',
            } as ApiResponse);
        }

        if (transactionResult.exceedsOutstanding) {
            return res.status(400).json({
                success: false,
                message: 'Payment amount exceeds outstanding balance.',
            } as ApiResponse);
        }

        if (transactionResult.duplicatePaymentId) {
            const order = await OrderWorkspaceService.getOrderById(Number(id), req);
            return res.status(409).json({
                success: false,
                message: 'Duplicate payment submission detected. Please refresh payment records before submitting again.',
                data: order,
            } as ApiResponse);
        }

        const order = await OrderWorkspaceService.getOrderById(Number(id), req);
        logger.info(`Payment submitted: orderId=${id}, amount=${amount}`);

        return res.json({
            success: true,
            message: 'Payment recorded successfully.',
            data: order,
        } as ApiResponse);
    } catch (error) {
        logger.error('Record payment error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error.',
        } as ApiResponse);
    }
}

export async function verifyOrderPayment(req: AuthRequest, res: Response) {
    try {
        const { id, paymentId } = req.params;
        const payment = await prisma.paymentRecord.findUnique({
            where: { id: Number(paymentId) },
            select: { id: true, orderId: true },
        });

        if (!payment || payment.orderId !== Number(id)) {
            return res.status(404).json({
                success: false,
                message: 'Payment record not found.',
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
                message: 'You do not have permission to verify payments for this order.',
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
            message: conflictMessage || 'Internal server error.',
        } as ApiResponse);
    }
}
