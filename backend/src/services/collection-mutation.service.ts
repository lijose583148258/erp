import prisma from '../config/database';
import type { Prisma } from '@prisma/client';
import { CollectionStateService } from './collection-state.service';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import { getOutstandingAmount } from './collection/collection.helpers';

const ACTIVE_DISPUTE_STATUSES = ['open', 'reviewing'] as const;
type CollectionMutationDb = typeof prisma | Prisma.TransactionClient;
export const PROMISE_AMOUNT_EXCEEDS_OUTSTANDING = 'PROMISE_AMOUNT_EXCEEDS_OUTSTANDING';
export const DISPUTE_AMOUNT_EXCEEDS_OUTSTANDING = 'DISPUTE_AMOUNT_EXCEEDS_OUTSTANDING';
export const getCollectionMutationConflictMessage = (error: unknown) => {
    if (!(error instanceof Error)) return null;
    if (error.message === PROMISE_AMOUNT_EXCEEDS_OUTSTANDING) {
        return 'Open promise amounts would exceed the order outstanding balance.';
    }
    if (error.message === DISPUTE_AMOUNT_EXCEEDS_OUTSTANDING) {
        return 'Active dispute amounts would exceed the order outstanding balance.';
    }
    return null;
};

const toCents = (value: number) => Math.round(Number(value || 0) * 100);
const getOutstandingAfterReservedAmount = (
    finalAmount: number,
    paidAmount: number,
    reservedAmount: number,
    receivableAdjustmentAmount = 0,
) => Math.max(0, getOutstandingAmount(finalAmount, paidAmount, receivableAdjustmentAmount) - Number(reservedAmount || 0));

function assertPromiseTransition(currentStatus: string, nextStatus: 'kept' | 'missed' | 'cancelled') {
    if (currentStatus === nextStatus) {
        return;
    }

    if (currentStatus !== 'open') {
        throw new Error(`Promise status cannot transition from ${currentStatus} to ${nextStatus}`);
    }
}

function assertDisputeTransition(currentStatus: string, nextStatus: 'reviewing' | 'resolved' | 'rejected' | 'withdrawn') {
    if (currentStatus === nextStatus) {
        return;
    }

    const allowed: Record<string, string[]> = {
        open: ['reviewing', 'resolved', 'rejected', 'withdrawn'],
        reviewing: ['resolved', 'rejected', 'withdrawn'],
        resolved: [],
        rejected: [],
        withdrawn: [],
    };

    if (!(allowed[currentStatus] || []).includes(nextStatus)) {
        throw new Error(`Dispute status cannot transition from ${currentStatus} to ${nextStatus}`);
    }
}

async function syncOrderDisputeShipmentHold(db: CollectionMutationDb, orderId: number) {
    const [activeDisputes, order] = await Promise.all([
        db.collectionDispute.count({
            where: {
                orderId,
                status: { in: [...ACTIVE_DISPUTE_STATUSES] },
            },
        }),
        db.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                shipmentHold: true,
                shipmentHoldSource: true,
            },
        }),
    ]);

    if (!order) {
        return;
    }

    if (activeDisputes > 0) {
        await db.order.update({
            where: { id: orderId },
            data: {
                shipmentHold: true,
                shipmentHoldReason: 'Order under collection dispute',
                shipmentHoldSource: 'dispute',
                shipmentHoldUpdatedAt: new Date(),
            },
        });
        return;
    }

    if (order.shipmentHoldSource === 'dispute') {
        await db.order.update({
            where: { id: orderId },
            data: {
                shipmentHold: false,
                shipmentHoldReason: null,
                shipmentHoldSource: null,
                shipmentHoldUpdatedAt: new Date(),
            },
        });
    }
}

export class CollectionMutationService {
    static async createPromiseToPay(input: {
        customerId: number;
        orderId: number;
        promisedAmount: number;
        promisedAt: Date;
        channel: string;
        contactName?: string | null;
        contactPhone?: string | null;
        note?: string | null;
        createdBy: number;
    }) {
        const promise = await withDbRetry(() => prisma.$transaction(async (tx) => {
            const order = await tx.order.update({
                where: { id: input.orderId },
                data: { updatedAt: new Date() },
                select: {
                    id: true,
                    customerId: true,
                    finalAmount: true,
                    paidAmount: true,
                    receivableAdjustmentAmount: true,
                    status: true,
                    paymentStatus: true,
                },
            });

            if (order.customerId !== input.customerId) {
                throw new Error('Promise customer must match the order customer.');
            }
            if (order.status === 'cancelled' || order.paymentStatus === 'paid') {
                throw new Error(PROMISE_AMOUNT_EXCEEDS_OUTSTANDING);
            }

            const openPromises = await tx.collectionPromise.aggregate({
                where: {
                    orderId: input.orderId,
                    status: 'open',
                },
                _sum: { promisedAmount: true },
            });
            const reservedAmount = Number(openPromises._sum.promisedAmount || 0);
            const availableAmount = getOutstandingAfterReservedAmount(
                Number(order.finalAmount),
                Number(order.paidAmount),
                reservedAmount,
                Number(order.receivableAdjustmentAmount),
            );

            if (toCents(input.promisedAmount) > toCents(availableAmount)) {
                throw new Error(PROMISE_AMOUNT_EXCEEDS_OUTSTANDING);
            }

            const record = await tx.collectionPromise.create({
                data: {
                    promiseNo: buildBusinessNo('PRM'),
                    customerId: input.customerId,
                    orderId: input.orderId,
                    promisedAmount: input.promisedAmount,
                    promisedAt: input.promisedAt,
                    channel: input.channel,
                    contactName: input.contactName || null,
                    contactPhone: input.contactPhone || null,
                    note: input.note || null,
                    createdBy: input.createdBy,
                    status: 'open',
                },
            });
            await CollectionStateService.refreshCustomerCollectionStateTx(tx, input.customerId);
            return record;
        }), { label: 'createPromiseToPay' });

        return promise;
    }

    static async updatePromiseStatus(promiseId: number, status: 'kept' | 'missed' | 'cancelled') {
        const result = await withDbRetry(() => prisma.$transaction(async (tx) => {
            const promise = await tx.collectionPromise.findUnique({
                where: { id: promiseId },
                select: { id: true, customerId: true, status: true },
            });

            if (!promise) {
                throw new Error('Promise record not found');
            }

            if (promise.status === status) {
                const record = await tx.collectionPromise.findUnique({ where: { id: promiseId } });
                if (!record) {
                    throw new Error('Promise record not found');
                }
                return { changed: false, customerId: promise.customerId, record };
            }

            assertPromiseTransition(promise.status, status);

            const claim = await tx.collectionPromise.updateMany({
                where: { id: promiseId, status: promise.status },
                data: { status },
            });

            if (claim.count !== 1) {
                const latest = await tx.collectionPromise.findUnique({
                    where: { id: promiseId },
                    select: { id: true, customerId: true, status: true },
                });

                if (!latest) {
                    throw new Error('Promise record not found');
                }

                if (latest.status === status) {
                    const record = await tx.collectionPromise.findUnique({ where: { id: promiseId } });
                    if (!record) {
                        throw new Error('Promise record not found');
                    }
                    return { changed: false, customerId: latest.customerId, record };
                }

                assertPromiseTransition(latest.status, status);
                throw new Error(`Promise status cannot transition from ${latest.status} to ${status}`);
            }

            const record = await tx.collectionPromise.findUnique({ where: { id: promiseId } });
            if (!record) {
                throw new Error('Promise record not found');
            }

            await CollectionStateService.refreshCustomerCollectionStateTx(tx, record.customerId);
            return { changed: true, customerId: record.customerId, record };
        }), { label: 'updatePromiseStatus' });

        return result.record;
    }

    static async createDispute(input: {
        customerId: number;
        orderId: number;
        disputedAmount?: number | null;
        reasonCategory: string;
        reason: string;
        evidenceJson?: string | null;
        note?: string | null;
        createdBy: number;
    }) {
        const dispute = await withDbRetry(() => prisma.$transaction(async (tx) => {
            const order = await tx.order.update({
                where: { id: input.orderId },
                data: { updatedAt: new Date() },
                select: {
                    id: true,
                    customerId: true,
                    finalAmount: true,
                    paidAmount: true,
                    receivableAdjustmentAmount: true,
                    status: true,
                    paymentStatus: true,
                },
            });

            if (order.customerId !== input.customerId) {
                throw new Error('Dispute customer must match the order customer.');
            }
            if (order.status === 'cancelled' || order.paymentStatus === 'paid') {
                throw new Error(DISPUTE_AMOUNT_EXCEEDS_OUTSTANDING);
            }

            const disputedAmount = input.disputedAmount ?? null;
            if (disputedAmount !== null && toCents(disputedAmount) > 0) {
                const activeDisputes = await tx.collectionDispute.aggregate({
                    where: {
                        orderId: input.orderId,
                        status: { in: [...ACTIVE_DISPUTE_STATUSES] },
                    },
                    _sum: { disputedAmount: true },
                });
                const reservedAmount = Number(activeDisputes._sum.disputedAmount || 0);
                const availableAmount = getOutstandingAfterReservedAmount(
                    Number(order.finalAmount),
                    Number(order.paidAmount),
                    reservedAmount,
                    Number(order.receivableAdjustmentAmount),
                );

                if (toCents(disputedAmount) > toCents(availableAmount)) {
                    throw new Error(DISPUTE_AMOUNT_EXCEEDS_OUTSTANDING);
                }
            }

            const record = await tx.collectionDispute.create({
                data: {
                    disputeNo: buildBusinessNo('DSP'),
                    customerId: input.customerId,
                    orderId: input.orderId,
                    disputedAmount,
                    reasonCategory: input.reasonCategory,
                    reason: input.reason,
                    evidenceJson: input.evidenceJson || null,
                    note: input.note || null,
                    createdBy: input.createdBy,
                    status: 'open',
                },
            });
            await syncOrderDisputeShipmentHold(tx, input.orderId);
            await CollectionStateService.refreshCustomerCollectionStateTx(tx, input.customerId);
            return record;
        }), { label: 'createDispute' });

        return dispute;
    }

    static async updateDisputeStatus(disputeId: number, status: 'reviewing' | 'resolved' | 'rejected' | 'withdrawn') {
        const result = await withDbRetry(() => prisma.$transaction(async (tx) => {
            const dispute = await tx.collectionDispute.findUnique({
                where: { id: disputeId },
                select: { id: true, customerId: true, orderId: true, status: true },
            });

            if (!dispute) {
                throw new Error('Dispute record not found');
            }

            if (dispute.status === status) {
                const record = await tx.collectionDispute.findUnique({ where: { id: disputeId } });
                if (!record) {
                    throw new Error('Dispute record not found');
                }
                return { changed: false, customerId: dispute.customerId, orderId: dispute.orderId, record };
            }

            assertDisputeTransition(dispute.status, status);

            const claim = await tx.collectionDispute.updateMany({
                where: { id: disputeId, status: dispute.status },
                data: {
                    status,
                    resolvedAt: status === 'resolved' ? new Date() : null,
                },
            });

            if (claim.count !== 1) {
                const latest = await tx.collectionDispute.findUnique({
                    where: { id: disputeId },
                    select: { id: true, customerId: true, orderId: true, status: true },
                });

                if (!latest) {
                    throw new Error('Dispute record not found');
                }

                if (latest.status === status) {
                    const record = await tx.collectionDispute.findUnique({ where: { id: disputeId } });
                    if (!record) {
                        throw new Error('Dispute record not found');
                    }
                    return { changed: false, customerId: latest.customerId, orderId: latest.orderId, record };
                }

                assertDisputeTransition(latest.status, status);
                throw new Error(`Dispute status cannot transition from ${latest.status} to ${status}`);
            }

            const record = await tx.collectionDispute.findUnique({ where: { id: disputeId } });
            if (!record) {
                throw new Error('Dispute record not found');
            }

            await syncOrderDisputeShipmentHold(tx, record.orderId);
            await CollectionStateService.refreshCustomerCollectionStateTx(tx, record.customerId);
            return { changed: true, customerId: record.customerId, orderId: record.orderId, record };
        }), { label: 'updateDisputeStatus' });

        return result.record;
    }

    static async setCustomerHold(customerId: number, type: 'credit' | 'shipment', reason: string, source = 'manual') {
        const now = new Date();
        const data: Record<string, any> = {};

        if (type === 'credit') {
            data.creditHold = true;
            data.creditHoldReason = reason;
            data.creditHoldSource = source;
            data.creditHoldUpdatedAt = now;
        } else {
            data.shipmentHold = true;
            data.shipmentHoldReason = reason;
            data.shipmentHoldSource = source;
            data.shipmentHoldUpdatedAt = now;
        }

        return withDbRetry(() => prisma.$transaction(async tx => {
            const customer = await tx.customer.update({
                where: { id: customerId },
                data,
                select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true },
            });
            await CollectionStateService.refreshCustomerCollectionStateTx(tx, customerId);
            return customer;
        }), { label: 'setCustomerHold' });
    }

    static async releaseCustomerHold(customerId: number, type: 'credit' | 'shipment') {
        const now = new Date();
        const data: Record<string, any> = {};

        if (type === 'credit') {
            data.creditHold = false;
            data.creditHoldReason = null;
            data.creditHoldSource = null;
            data.creditHoldUpdatedAt = now;
        } else {
            data.shipmentHold = false;
            data.shipmentHoldReason = null;
            data.shipmentHoldSource = null;
            data.shipmentHoldUpdatedAt = now;
        }

        return withDbRetry(() => prisma.$transaction(async tx => {
            const customer = await tx.customer.update({
                where: { id: customerId },
                data,
                select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true },
            });
            await CollectionStateService.refreshCustomerCollectionStateTx(tx, customerId);
            return customer;
        }), { label: 'releaseCustomerHold' });
    }

    static async setOrderShipmentHold(orderId: number, reason: string, source = 'manual') {
        const now = new Date();
        return withDbRetry(() => prisma.$transaction(async tx => {
            const order = await tx.order.update({
                where: { id: orderId },
                data: {
                    shipmentHold: true,
                    shipmentHoldReason: reason,
                    shipmentHoldSource: source,
                    shipmentHoldUpdatedAt: now,
                },
                select: {
                    id: true,
                    orderNo: true,
                    customerId: true,
                },
            });
            await CollectionStateService.refreshCustomerCollectionStateTx(tx, order.customerId);
            return order;
        }), { label: 'setOrderShipmentHold' });
    }

    static async releaseOrderShipmentHold(orderId: number) {
        return withDbRetry(() => prisma.$transaction(async tx => {
            const activeDisputes = await tx.collectionDispute.count({
                where: {
                    orderId,
                    status: { in: [...ACTIVE_DISPUTE_STATUSES] },
                },
            });

            if (activeDisputes > 0) {
                throw new Error('Order still has active disputes and cannot release shipment hold');
            }

            const now = new Date();
            const order = await tx.order.update({
                where: { id: orderId },
                data: {
                    shipmentHold: false,
                    shipmentHoldReason: null,
                    shipmentHoldSource: null,
                    shipmentHoldUpdatedAt: now,
                },
                select: {
                    id: true,
                    orderNo: true,
                    customerId: true,
                },
            });
            await CollectionStateService.refreshCustomerCollectionStateTx(tx, order.customerId);
            return order;
        }), { label: 'releaseOrderShipmentHold' });
    }
}

