import prisma from '../config/database';
import { CollectionStateService } from './collection-state.service';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';

const ACTIVE_DISPUTE_STATUSES = ['open', 'reviewing'] as const;

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

async function syncOrderDisputeShipmentHold(orderId: number) {
    const [activeDisputes, order] = await Promise.all([
        prisma.collectionDispute.count({
            where: {
                orderId,
                status: { in: [...ACTIVE_DISPUTE_STATUSES] },
            },
        }),
        prisma.order.findUnique({
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
        await prisma.order.update({
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
        await prisma.order.update({
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
        const promise = await prisma.collectionPromise.create({
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

        await CollectionStateService.refreshCustomerCollectionState(input.customerId);
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

            return { changed: true, customerId: record.customerId, record };
        }), { label: 'updatePromiseStatus' });

        if (result.changed) {
            await CollectionStateService.refreshCustomerCollectionState(result.customerId);
        }

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
        const dispute = await prisma.collectionDispute.create({
            data: {
                disputeNo: buildBusinessNo('DSP'),
                customerId: input.customerId,
                orderId: input.orderId,
                disputedAmount: input.disputedAmount ?? null,
                reasonCategory: input.reasonCategory,
                reason: input.reason,
                evidenceJson: input.evidenceJson || null,
                note: input.note || null,
                createdBy: input.createdBy,
                status: 'open',
            },
        });

        await syncOrderDisputeShipmentHold(input.orderId);

        await CollectionStateService.refreshCustomerCollectionState(input.customerId);
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

            return { changed: true, customerId: record.customerId, orderId: record.orderId, record };
        }), { label: 'updateDisputeStatus' });

        if (result.changed) {
            await syncOrderDisputeShipmentHold(result.orderId);
            await CollectionStateService.refreshCustomerCollectionState(result.customerId);
        }

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

        const customer = await prisma.customer.update({
            where: { id: customerId },
            data,
            select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true },
        });

        await CollectionStateService.refreshCustomerCollectionState(customerId);
        return customer;
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

        const customer = await prisma.customer.update({
            where: { id: customerId },
            data,
            select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true },
        });

        await CollectionStateService.refreshCustomerCollectionState(customerId);
        return customer;
    }

    static async setOrderShipmentHold(orderId: number, reason: string, source = 'manual') {
        const now = new Date();
        const order = await prisma.order.update({
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

        await CollectionStateService.refreshCustomerCollectionState(order.customerId);
        return order;
    }

    static async releaseOrderShipmentHold(orderId: number) {
        const activeDisputes = await prisma.collectionDispute.count({
            where: {
                orderId,
                status: { in: [...ACTIVE_DISPUTE_STATUSES] },
            },
        });

        if (activeDisputes > 0) {
            throw new Error('Order still has active disputes and cannot release shipment hold');
        }

        const now = new Date();
        const order = await prisma.order.update({
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

        await CollectionStateService.refreshCustomerCollectionState(order.customerId);
        return order;
    }
}

