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
import { ProductionCostLedgerService } from '../services/production-cost-ledger.service';
import { hasDataScope } from '../utils/recordAccess';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const toNumber = (value: unknown): number | null => {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const defaultReasonCategory = (domain: string) => {
    if (domain === 'finance') {
        return 'manual_reconciliation';
    }

    if (domain === 'production') {
        return 'production_loss';
    }

    return 'inventory_discrepancy';
};

const getAccessibleAdjustmentDomains = (req: AuthRequest): AdjustmentDomain[] | null => {
    if (!req.user) return [];
    if (req.user.role === 'admin' || hasDataScope(req, 'all')) return null;

    const domains = new Set<AdjustmentDomain>();
    if (hasDataScope(req, 'finance_visible')) {
        domains.add('finance');
    }
    if (hasDataScope(req, 'warehouse_visible')) {
        domains.add('production');
        domains.add('inventory');
    }
    return Array.from(domains);
};

const buildAdjustmentWhere = (req: AuthRequest, extra: Record<string, any> = {}) => {
    const where: Record<string, any> = {
        ...extra,
    };

    const domains = getAccessibleAdjustmentDomains(req);
    if (domains !== null) {
        if (domains.length === 0) {
            where.id = -1;
            return where;
        }

        const requestedDomain = typeof where.domain === 'string' ? where.domain : null;
        if (requestedDomain && !domains.includes(requestedDomain as AdjustmentDomain)) {
            where.id = -1;
            return where;
        }
        where.domain = requestedDomain || { in: domains };
    }

    return where;
};

const canOperateAdjustmentDomain = (req: AuthRequest, domain: string) => {
    const domains = getAccessibleAdjustmentDomains(req);
    return domains === null || domains.includes(domain as AdjustmentDomain);
};

const getCustomerDisplayName = (customer?: {
    name?: string | null;
    nameZh?: string | null;
    nameEn?: string | null;
    nameVi?: string | null;
}) => customer?.nameZh || customer?.nameEn || customer?.nameVi || customer?.name || null;

const formatAdjustment = (record: any) => ({
    id: record.id,
    adjustmentNo: record.adjustmentNo,
    domain: record.domain,
    targetType: record.targetType,
    targetId: record.targetId,
    targetRef: record.targetRef,
    orderId: record.orderId,
    orderNo: record.order?.orderNo || null,
    batchId: record.batchId,
    batchNo: record.productBatch?.batchNo || null,
    productName: record.productBatch?.productName || record.order?.productName || null,
    customerId: record.customerId || record.order?.customer?.id || null,
    customerName: getCustomerDisplayName(record.order?.customer),
    customerNameZh: record.order?.customer?.nameZh || null,
    customerNameEn: record.order?.customer?.nameEn || null,
    customerNameVi: record.order?.customer?.nameVi || null,
    customerDisplayName: getCustomerDisplayName(record.order?.customer),
    quantityDelta: record.quantityDelta !== null ? Number(record.quantityDelta) : null,
    amountDelta: record.amountDelta !== null ? Number(record.amountDelta) : null,
    reason: record.reason,
    reasonCategory: record.reasonCategory || null,
    lossType: record.lossType || null,
    note: record.note,
    status: record.status,
    createdBy: record.createdBy,
    creator: record.creator ? {
        id: record.creator.id,
        username: record.creator.username,
        role: record.creator.role,
    } : null,
    approvedBy: record.approvedBy,
    approver: record.approver ? {
        id: record.approver.id,
        username: record.approver.username,
        role: record.approver.role,
    } : null,
    approvedAt: record.approvedAt,
    appliedAt: record.appliedAt,
    beforeSnapshot: parseSnapshot(record.beforeSnapshot),
    afterSnapshot: parseSnapshot(record.afterSnapshot),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
});

function parseSnapshot(snapshot: string | null | undefined) {
    if (!snapshot) {
        return null;
    }

    try {
        return JSON.parse(snapshot);
    } catch {
        return snapshot;
    }
}

const createAuditLog = async (
    req: AuthRequest,
    action: string,
    details: Record<string, unknown>,
    resourceId?: number | null,
) => {
    await prisma.auditLog.create({
        data: {
            userId: req.user!.userId,
            action,
            resource: 'adjustment',
            resourceId: resourceId ?? null,
            details: JSON.stringify(details),
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        },
    });
};

const getLedgerSourceType = (domain: AdjustmentDomain, reversed = false) => {
    if (domain === 'inventory') {
        return reversed ? 'inventory_reversal' : 'inventory_adjustment';
    }

    return reversed ? 'production_reversal' : 'production_adjustment';
};

const recordLedgerFromAdjustment = async (params: {
    adjustment: any;
    createdBy: number;
    reversed?: boolean;
}) => {
    const { adjustment, createdBy, reversed = false } = params;
    if (!adjustment || !['production', 'inventory'].includes(String(adjustment.domain))) {
      return null;
    }

    if (!adjustment.batchId) {
      return null;
    }

    const batch = await prisma.productBatch.findUnique({
      where: { id: Number(adjustment.batchId) },
      select: { stockQuantity: true },
    });

    if (!batch) {
      return null;
    }

    const quantityDelta = Number(adjustment.quantityDelta || 0);
    const quantityAfter = Number(batch.stockQuantity || 0);
    const quantityBefore = Number((quantityAfter - quantityDelta).toFixed(6));

    return ProductionCostLedgerService.recordAdjustmentLedger({
      batchId: Number(adjustment.batchId),
      adjustmentId: Number(adjustment.id),
      adjustmentNo: String(adjustment.adjustmentNo),
      sourceType: getLedgerSourceType(adjustment.domain as AdjustmentDomain, reversed),
      quantityBefore,
      quantityDelta,
      quantityAfter,
      amountDelta: adjustment.amountDelta !== null && adjustment.amountDelta !== undefined
        ? Number(adjustment.amountDelta)
        : null,
      note: adjustment.note ? String(adjustment.note) : null,
      createdBy,
    });
};

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

            const resolvedOrderId = toNumber(orderId) ?? toNumber(targetId);
            const resolvedBatchId = toNumber(batchId) ?? toNumber(targetId);
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

            try {
                if (created.adjustment.status === 'posted') {
                    await recordLedgerFromAdjustment({
                        adjustment: created.adjustment,
                        createdBy: req.user!.userId,
                    });
                }
            } catch (ledgerError) {
                logger.warn('Failed to record adjustment cost ledger', ledgerError);
            }

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

            try {
                if (result.adjustment.status === 'posted') {
                    await recordLedgerFromAdjustment({
                        adjustment: result.adjustment,
                        createdBy: req.user!.userId,
                    });
                }
            } catch (ledgerError) {
                logger.warn('Failed to record adjustment cost ledger', ledgerError);
            }

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

            try {
                if (result.reverse && result.original.status === 'reversed') {
                    await recordLedgerFromAdjustment({
                        adjustment: result.reverse,
                        createdBy: req.user!.userId,
                        reversed: true,
                    });
                }
            } catch (ledgerError) {
                logger.warn('Failed to record adjustment reversal cost ledger', ledgerError);
            }

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
