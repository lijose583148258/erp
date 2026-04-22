import type { AdjustmentRecord, Prisma } from '@prisma/client';
import prisma from '../config/database';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import type { TransactionClient } from './stock-movement.service';
import { applyFinanceAdjustmentTx } from './adjustment/finance-adjustment.service';

export type AdjustmentDomain = 'finance' | 'production' | 'inventory';
export type AdjustmentTargetType = 'order' | 'productBatch' | 'manual';
export type AdjustmentStatus = 'pending' | 'posted' | 'reversed' | 'rejected';

export interface AdjustmentInput {
    domain: AdjustmentDomain;
    targetType: AdjustmentTargetType;
    targetId?: number | null;
    orderId?: number | null;
    batchId?: number | null;
    customerId?: number | null;
    targetRef?: string | null;
    quantityDelta?: number | null;
    amountDelta?: number | null;
    reason: string;
    reasonCategory?: string | null;
    lossType?: string | null;
    note?: string | null;
    status?: AdjustmentStatus;
}

type AdjustmentTx = TransactionClient;

type PersistedAdjustment = AdjustmentRecord;

const now = () => new Date();
const serializeSnapshot = (value: unknown) => {
    if (value === undefined || value === null) {
        return null;
    }

    try {
        return JSON.stringify(value);
    } catch {
        return null;
    }
};

export class AdjustmentService {
    private static buildAdjustmentNo() {
        return buildBusinessNo('ADJ');
    }

    private static normalizeStatus(status?: AdjustmentStatus): AdjustmentStatus {
        if (!status) {
            return 'posted';
        }

        if (!['pending', 'posted', 'reversed', 'rejected'].includes(status)) {
            return 'posted';
        }

        return status;
    }

    private static async applyToProductionTx(tx: AdjustmentTx, adjustment: PersistedAdjustment) {
        const batchId = adjustment.batchId || adjustment.targetId;
        if (!batchId) {
            return null;
        }

        const batch = await tx.productBatch.findUnique({
            where: { id: Number(batchId) },
            select: {
                id: true,
                batchNo: true,
                productName: true,
                stockQuantity: true,
                unit: true,
            },
        });

        if (!batch) {
            throw new Error(`Product batch not found: ${batchId}`);
        }

        const delta = Number(adjustment.quantityDelta || 0);
        const nextQuantity = Number(batch.stockQuantity) + delta;

        if (nextQuantity < 0) {
            throw new Error('Adjustment would make stock quantity negative');
        }

        await tx.productBatch.update({
            where: { id: batch.id },
            data: {
                stockQuantity: nextQuantity,
            },
        });

        return {
            before: batch,
            after: {
                batchId: batch.id,
                batchNo: batch.batchNo,
                productName: batch.productName,
                unit: batch.unit,
                stockQuantity: nextQuantity,
            },
            effects: {
                batchId: batch.id,
                batchNo: batch.batchNo,
                productName: batch.productName,
                unit: batch.unit,
                stockQuantity: nextQuantity,
            },
        };
    }

    private static async applyAdjustmentTx(tx: AdjustmentTx, adjustment: PersistedAdjustment) {
        const effects: Record<string, unknown> = {};
        let beforeSnapshot: Record<string, unknown> = {};
        let afterSnapshot: Record<string, unknown> = {};

        if (adjustment.domain === 'finance') {
            const result = await applyFinanceAdjustmentTx(tx, adjustment);
            effects.finance = result?.effects || null;
            beforeSnapshot = {
                ...beforeSnapshot,
                finance: result?.before || null,
            };
            afterSnapshot = {
                ...afterSnapshot,
                finance: result?.after || null,
            };
        }

        if (adjustment.domain === 'production' || adjustment.domain === 'inventory') {
            const result = await this.applyToProductionTx(tx, adjustment);
            effects.production = result?.effects || null;
            beforeSnapshot = {
                ...beforeSnapshot,
                production: result?.before || null,
            };
            afterSnapshot = {
                ...afterSnapshot,
                production: result?.after || null,
            };
        }

        return {
            effects,
            beforeSnapshot,
            afterSnapshot,
        };
    }

    static async createAdjustment(input: AdjustmentInput, createdBy: number) {
        const status = this.normalizeStatus(input.status);
        if (!['pending', 'posted'].includes(status)) {
            throw new Error('New adjustment can only be created as pending or posted');
        }

        const adjustmentNo = this.buildAdjustmentNo();

        return withDbRetry(() => prisma.$transaction(async tx => {
            const adjustment = await tx.adjustmentRecord.create({
                data: {
                    adjustmentNo,
                    domain: input.domain,
                    targetType: input.targetType,
                    targetId: input.targetId ?? null,
                    targetRef: input.targetRef ?? null,
                    orderId: input.orderId ?? null,
                    batchId: input.batchId ?? null,
                    customerId: input.customerId ?? null,
                    quantityDelta: input.quantityDelta ?? null,
                    amountDelta: input.amountDelta ?? null,
                    reason: input.reason,
                    reasonCategory: input.reasonCategory ?? null,
                    lossType: input.lossType ?? null,
                    beforeSnapshot: null,
                    afterSnapshot: null,
                    note: input.note ?? null,
                    status,
                    createdBy,
                    approvedBy: status === 'posted' ? createdBy : null,
                    approvedAt: status === 'posted' ? now() : null,
                    appliedAt: status === 'posted' ? now() : null,
                },
            });

            let effects = null;
            if (status === 'posted') {
                const applied = await this.applyAdjustmentTx(tx, adjustment);
                effects = applied.effects;

                const updated = await tx.adjustmentRecord.update({
                    where: { id: adjustment.id },
                    data: {
                        beforeSnapshot: serializeSnapshot(applied.beforeSnapshot),
                        afterSnapshot: serializeSnapshot(applied.afterSnapshot),
                    },
                });

                return {
                    adjustment: updated,
                    effects,
                };
            }

            return {
                adjustment,
                effects,
            };
        }), { label: 'createAdjustment' });
    }

    static async listAdjustments(filters: {
        domain?: string;
        targetType?: string;
        status?: string;
        orderId?: number;
        batchId?: number;
        customerId?: number;
        page: number;
        pageSize: number;
        where?: Prisma.AdjustmentRecordWhereInput;
    }) {
        const where: Prisma.AdjustmentRecordWhereInput = {};

        if (filters.domain) where.domain = filters.domain;
        if (filters.targetType) where.targetType = filters.targetType;
        if (filters.status) where.status = filters.status;
        if (filters.orderId) where.orderId = filters.orderId;
        if (filters.batchId) where.batchId = filters.batchId;
        if (filters.customerId) where.customerId = filters.customerId;
        if (filters.where) {
            Object.assign(where, filters.where);
        }

        const skip = (filters.page - 1) * filters.pageSize;

        const [items, total] = await Promise.all([
            prisma.adjustmentRecord.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: filters.pageSize,
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
                        },
                    },
                },
            }),
            prisma.adjustmentRecord.count({ where }),
        ]);

        return { items, total };
    }

    static async getSummary(where: Prisma.AdjustmentRecordWhereInput = {}) {
        const adjustments = await prisma.adjustmentRecord.findMany({
            where,
            select: {
                domain: true,
                status: true,
                amountDelta: true,
                quantityDelta: true,
                reasonCategory: true,
            },
        });

        const summary = adjustments.reduce(
            (acc, item) => {
                acc.total += 1;
                acc.byDomain[item.domain] = (acc.byDomain[item.domain] || 0) + 1;
                acc.byStatus[item.status] = (acc.byStatus[item.status] || 0) + 1;
                if (item.reasonCategory) {
                    acc.byReasonCategory[item.reasonCategory] = (acc.byReasonCategory[item.reasonCategory] || 0) + 1;
                }
                acc.amountDelta += Number(item.amountDelta || 0);
                acc.quantityDelta += Number(item.quantityDelta || 0);
                return acc;
            },
            {
                total: 0,
                byDomain: {} as Record<string, number>,
                byStatus: {} as Record<string, number>,
                byReasonCategory: {} as Record<string, number>,
                amountDelta: 0,
                quantityDelta: 0,
            },
        );

        return summary;
    }

    static async applyAdjustment(adjustmentId: number, approverId: number) {
        return withDbRetry(() => prisma.$transaction(async tx => {
            const adjustment = await tx.adjustmentRecord.findUnique({
                where: { id: adjustmentId },
            });

            if (!adjustment) {
                throw new Error(`Adjustment not found: ${adjustmentId}`);
            }

            if (adjustment.status === 'posted') {
                return {
                    adjustment,
                    effects: null,
                };
            }

            if (adjustment.status === 'reversed' || adjustment.status === 'rejected') {
                throw new Error('Adjustment cannot be applied in its current status');
            }

            const claim = await tx.adjustmentRecord.updateMany({
                where: { id: adjustmentId, status: 'pending' },
                data: {
                    status: 'posting',
                    approvedBy: approverId,
                    approvedAt: now(),
                },
            });

            if (claim.count !== 1) {
                const current = await tx.adjustmentRecord.findUnique({ where: { id: adjustmentId } });
                return {
                    adjustment: current ?? adjustment,
                    effects: null,
                };
            }

            const effects = await this.applyAdjustmentTx(tx, adjustment);
            const updated = await tx.adjustmentRecord.update({
                where: { id: adjustmentId },
                data: {
                    status: 'posted',
                    approvedBy: approverId,
                    approvedAt: now(),
                    appliedAt: now(),
                    beforeSnapshot: serializeSnapshot(effects.beforeSnapshot),
                    afterSnapshot: serializeSnapshot(effects.afterSnapshot),
                    note: adjustment.note,
                },
            });

            return {
                adjustment: updated,
                effects: effects.effects,
            };
        }), { label: 'applyAdjustment' });
    }

    static async reverseAdjustment(adjustmentId: number, operatorId: number, note?: string) {
        return withDbRetry(() => prisma.$transaction(async tx => {
            const original = await tx.adjustmentRecord.findUnique({
                where: { id: adjustmentId },
            });

            if (!original) {
                throw new Error(`Adjustment not found: ${adjustmentId}`);
            }

            if (original.status === 'reversed') {
                throw new Error('Adjustment already reversed');
            }

            if (original.status === 'pending') {
                const claim = await tx.adjustmentRecord.updateMany({
                    where: { id: original.id, status: 'pending' },
                    data: {
                        status: 'reversed',
                        note: note || original.note,
                        approvedBy: operatorId,
                        approvedAt: now(),
                    },
                });

                const updated = await tx.adjustmentRecord.findUnique({ where: { id: original.id } });
                return {
                    original: updated ?? original,
                    reverse: null,
                    effects: null,
                };
            }

            const claim = await tx.adjustmentRecord.updateMany({
                where: { id: original.id, status: 'posted' },
                data: {
                    status: 'reversing',
                },
            });

            if (claim.count !== 1) {
                const current = await tx.adjustmentRecord.findUnique({ where: { id: original.id } });
                return {
                    original: current ?? original,
                    reverse: null,
                    effects: null,
                };
            }

            const reverse = await tx.adjustmentRecord.create({
                data: {
                    adjustmentNo: this.buildAdjustmentNo(),
                    domain: original.domain,
                    targetType: original.targetType,
                    targetId: original.targetId,
                    targetRef: original.targetRef,
                    orderId: original.orderId,
                    batchId: original.batchId,
                    customerId: original.customerId,
                    quantityDelta: original.quantityDelta !== null ? Number(original.quantityDelta) * -1 : null,
                    amountDelta: original.amountDelta !== null ? Number(original.amountDelta) * -1 : null,
                    reason: `Reverse of ${original.adjustmentNo}`,
                    reasonCategory: original.reasonCategory,
                    lossType: original.lossType,
                    beforeSnapshot: null,
                    afterSnapshot: null,
                    note: note || `Reversal for ${original.adjustmentNo}`,
                    status: 'posted',
                    createdBy: operatorId,
                    approvedBy: operatorId,
                    approvedAt: now(),
                    appliedAt: now(),
                },
            });

            const applied = await this.applyAdjustmentTx(tx, reverse);
            await tx.adjustmentRecord.update({
                where: { id: reverse.id },
                data: {
                    beforeSnapshot: serializeSnapshot(applied.beforeSnapshot),
                    afterSnapshot: serializeSnapshot(applied.afterSnapshot),
                },
            });

            const updatedOriginal = await tx.adjustmentRecord.update({
                where: { id: original.id },
                data: {
                    status: 'reversed',
                    note: original.note,
                },
            });

            return {
                original: updatedOriginal,
                reverse,
            };
        }), { label: 'reverseAdjustment' });
    }
}
