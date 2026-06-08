import { Response } from 'express';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types/api.types';
import {
    AdjustmentService,
    AdjustmentDomain,
    AdjustmentTargetType,
    AdjustmentStatus,
} from '../services/adjustment.service';
import { getAdjustmentConflictMessage } from '../services/adjustment/finance-adjustment.service';
import {
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    buildAdjustmentWhere,
    canOperateAdjustmentDomain,
    createAuditLog,
    defaultReasonCategory,
    formatAdjustment,
    toNumber,
} from './adjustment/adjustment-controller.helpers';

export class AdjustmentController {
    async getSummary(req: AuthRequest, res: Response) {
        try {
            const scopeWhere = buildAdjustmentWhere(req);
            const [summary, recentAdjustments] = await Promise.all([
                AdjustmentService.getSummary(scopeWhere),
                prisma.adjustmentRecord.findMany({
                    where: scopeWhere,
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                    include: {
                        creator: { select: { id: true, username: true, role: true } },
                        approver: { select: { id: true, username: true, role: true } },
                        order: {
                            select: {
                                id: true,
                                orderNo: true,
                                customer: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } },
                            },
                        },
                        productBatch: {
                            select: {
                                id: true,
                                batchNo: true,
                                productName: true,
                                stockQuantity: true,
                            },
                        },
                    },
                }),
            ]);

            res.json({
                success: true,
                data: {
                    ...summary,
                    recentAdjustments: recentAdjustments.map(formatAdjustment),
                },
            } as ApiResponse);
        } catch (error) {
            logger.error('Failed to load adjustment summary', error);
            res.status(500).json({ success: false, message: 'Failed to load adjustment summary' } as ApiResponse);
        }
    }

    async getAdjustments(req: AuthRequest, res: Response) {
        try {
            const { page = 1, pageSize = DEFAULT_PAGE_SIZE, domain, targetType, status, orderId, batchId, customerId } = req.query;
            const limit = Math.min(Number(pageSize) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
            const currentPage = Math.max(1, Number(page) || 1);

            const filters = {
                domain: domain ? String(domain) : undefined,
                targetType: targetType ? String(targetType) : undefined,
                status: status ? String(status) : undefined,
                orderId: toNumber(orderId) ?? undefined,
                batchId: toNumber(batchId) ?? undefined,
                customerId: toNumber(customerId) ?? undefined,
                page: currentPage,
                pageSize: limit,
            };

            const { items, total } = await AdjustmentService.listAdjustments({
                ...filters,
                where: buildAdjustmentWhere(req),
            });

            res.json({
                success: true,
                data: items.map(formatAdjustment),
                meta: {
                    page: currentPage,
                    pageSize: limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                },
            } as ApiResponse);
        } catch (error) {
            logger.error('Failed to load adjustments', error);
            res.status(500).json({ success: false, message: 'Failed to load adjustments' } as ApiResponse);
        }
    }

    async getAdjustmentById(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const adjustment = await prisma.adjustmentRecord.findUnique({
                where: { id: Number(id) },
                include: {
                    creator: { select: { id: true, username: true, role: true } },
                    approver: { select: { id: true, username: true, role: true } },
                    order: {
                        select: {
                            id: true,
                            orderNo: true,
                            finalAmount: true,
                            paidAmount: true,
                            paymentStatus: true,
                                customer: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } },
                        },
                    },
                    productBatch: {
                        select: {
                            id: true,
                            batchNo: true,
                            productName: true,
                            stockQuantity: true,
                            unit: true,
                        },
                    },
                },
            });

            if (!adjustment) {
                return res.status(404).json({ success: false, message: 'Adjustment not found' } as ApiResponse);
            }
            if (!canOperateAdjustmentDomain(req, adjustment.domain)) {
                return res.status(404).json({ success: false, message: 'Adjustment not found' } as ApiResponse);
            }

            res.json({
                success: true,
                data: formatAdjustment(adjustment),
            } as ApiResponse);
        } catch (error) {
            logger.error('Failed to load adjustment detail', error);
            res.status(500).json({ success: false, message: 'Failed to load adjustment detail' } as ApiResponse);
        }
    }

    async createAdjustment(req: AuthRequest, res: Response) {
        try {
            const {
                domain,
                targetType,
                targetId,
                orderId,
                batchId,
                customerId,
                targetRef,
                quantityDelta,
                amountDelta,
                reason,
                reasonCategory,
                lossType,
                note,
                status,
            } = req.body;

            if (!domain || !targetType || !reason) {
                return res.status(400).json({ success: false, message: 'Missing required fields' } as ApiResponse);
            }

            const normalizedDomain = String(domain) as AdjustmentDomain;
            const normalizedTargetType = String(targetType) as AdjustmentTargetType;
            const normalizedStatus = status ? String(status) as AdjustmentStatus : 'posted';
            if (!canOperateAdjustmentDomain(req, normalizedDomain)) {
                return res.status(403).json({ success: false, message: '当前角色无权处理该调账领域' } as ApiResponse);
            }

            const resolvedReasonCategory = reasonCategory
                ? String(reasonCategory)
                : defaultReasonCategory(normalizedDomain);
            const resolvedLossType = lossType
                ? String(lossType)
                : (normalizedDomain === 'production' ? 'loss' : normalizedDomain === 'inventory' ? 'count_difference' : null);

            const numericTargetId = toNumber(targetId);
            const resolvedOrderId = normalizedDomain === 'finance'
                ? toNumber(orderId) ?? numericTargetId
                : null;
            const resolvedBatchId = normalizedDomain === 'production' || normalizedDomain === 'inventory'
                ? toNumber(batchId) ?? numericTargetId
                : null;
            const resolvedCustomerId = toNumber(customerId);
            const resolvedAmountDelta = toNumber(amountDelta);
            const resolvedQuantityDelta = toNumber(quantityDelta);

            if (normalizedDomain === 'finance' && !resolvedOrderId) {
                return res.status(400).json({ success: false, message: 'Finance adjustment requires an orderId' } as ApiResponse);
            }

            if ((normalizedDomain === 'production' || normalizedDomain === 'inventory') && !resolvedBatchId) {
                return res.status(400).json({ success: false, message: 'Production or inventory adjustment requires a batchId' } as ApiResponse);
            }

            if (normalizedDomain === 'finance' && (resolvedAmountDelta === null || resolvedAmountDelta === 0)) {
                return res.status(400).json({ success: false, message: 'Finance adjustment requires a non-zero amountDelta' } as ApiResponse);
            }

            if ((normalizedDomain === 'production' || normalizedDomain === 'inventory') && (resolvedQuantityDelta === null || resolvedQuantityDelta === 0)) {
                return res.status(400).json({ success: false, message: 'Production or inventory adjustment requires a non-zero quantityDelta' } as ApiResponse);
            }

            let resolvedTargetRef = targetRef ? String(targetRef) : null;
            let derivedCustomerId = resolvedCustomerId;

            if (!resolvedTargetRef && resolvedOrderId) {
                const order = await prisma.order.findUnique({
                    where: { id: resolvedOrderId },
                    select: {
                        orderNo: true,
                        customerId: true,
                    },
                });

                if (order) {
                    resolvedTargetRef = order.orderNo;
                    derivedCustomerId = derivedCustomerId ?? order.customerId;
                }
            }

            if (!resolvedTargetRef && resolvedBatchId) {
                const batch = await prisma.productBatch.findUnique({
                    where: { id: resolvedBatchId },
                    select: {
                        batchNo: true,
                    },
                });

                if (batch) {
                    resolvedTargetRef = batch.batchNo;
                }
            }

            const created = await AdjustmentService.createAdjustment({
                domain: normalizedDomain,
                targetType: normalizedTargetType,
                targetId: toNumber(targetId),
                orderId: resolvedOrderId,
                batchId: resolvedBatchId,
                customerId: derivedCustomerId,
                targetRef: resolvedTargetRef,
                quantityDelta: resolvedQuantityDelta,
                amountDelta: resolvedAmountDelta,
                reason: String(reason),
                reasonCategory: resolvedReasonCategory,
                lossType: resolvedLossType,
                note: note ? String(note) : null,
                status: normalizedStatus,
            }, req.user!.userId);

            await createAuditLog(req, 'CREATE_ADJUSTMENT', {
                adjustmentNo: created.adjustment.adjustmentNo,
                domain: normalizedDomain,
                targetType: normalizedTargetType,
                status: normalizedStatus,
            }, created.adjustment.id);

            res.status(201).json({
                success: true,
                data: {
                    adjustment: formatAdjustment(created.adjustment),
                    effects: created.effects,
                },
            } as ApiResponse);
        } catch (error) {
            logger.error('Failed to create adjustment', error);
            const conflictMessage = getAdjustmentConflictMessage(error);
            if (conflictMessage) {
                return res.status(409).json({ success: false, message: conflictMessage } as ApiResponse);
            }
            const message = error instanceof Error ? error.message : 'Failed to create adjustment';
            res.status(500).json({ success: false, message } as ApiResponse);
        }
    }

    async applyAdjustment(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const existing = await prisma.adjustmentRecord.findUnique({
                where: { id: Number(id) },
                select: { id: true, domain: true },
            });
            if (!existing) {
                return res.status(404).json({ success: false, message: 'Adjustment not found' } as ApiResponse);
            }
            if (!canOperateAdjustmentDomain(req, existing.domain)) {
                return res.status(403).json({ success: false, message: '当前角色无权处理该调账领域' } as ApiResponse);
            }

            const result = await AdjustmentService.applyAdjustment(Number(id), req.user!.userId);

            await createAuditLog(req, 'APPLY_ADJUSTMENT', {
                adjustmentId: Number(id),
                status: result.adjustment.status,
            }, Number(id));

            res.json({
                success: true,
                message: 'Adjustment applied',
                data: {
                    adjustment: formatAdjustment(result.adjustment),
                    effects: result.effects,
                },
            } as ApiResponse);
        } catch (error) {
            logger.error('Failed to apply adjustment', error);
            const conflictMessage = getAdjustmentConflictMessage(error);
            if (conflictMessage) {
                return res.status(409).json({ success: false, message: conflictMessage } as ApiResponse);
            }
            const message = error instanceof Error ? error.message : 'Failed to apply adjustment';
            res.status(500).json({ success: false, message } as ApiResponse);
        }
    }

    async reverseAdjustment(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const { note } = req.body;
            const existing = await prisma.adjustmentRecord.findUnique({
                where: { id: Number(id) },
                select: { id: true, domain: true },
            });
            if (!existing) {
                return res.status(404).json({ success: false, message: 'Adjustment not found' } as ApiResponse);
            }
            if (!canOperateAdjustmentDomain(req, existing.domain)) {
                return res.status(403).json({ success: false, message: '当前角色无权处理该调账领域' } as ApiResponse);
            }

            const result = await AdjustmentService.reverseAdjustment(Number(id), req.user!.userId, note ? String(note) : undefined);

            await createAuditLog(req, 'REVERSE_ADJUSTMENT', {
                adjustmentId: Number(id),
                note: note ? String(note) : null,
            }, Number(id));

            res.json({
                success: true,
                message: 'Adjustment reversed',
                data: result.reverse
                    ? {
                        original: formatAdjustment(result.original),
                        reverse: formatAdjustment(result.reverse),
                    }
                    : {
                        original: formatAdjustment(result.original),
                        reverse: null,
                    },
            } as ApiResponse);
        } catch (error) {
            logger.error('Failed to reverse adjustment', error);
            const conflictMessage = getAdjustmentConflictMessage(error);
            if (conflictMessage) {
                return res.status(409).json({ success: false, message: conflictMessage } as ApiResponse);
            }
            const message = error instanceof Error ? error.message : 'Failed to reverse adjustment';
            res.status(500).json({ success: false, message } as ApiResponse);
        }
    }
}
