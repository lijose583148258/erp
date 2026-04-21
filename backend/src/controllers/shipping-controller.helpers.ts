import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import type { AuthRequest } from '../middleware/auth';
import type { TransactionClient } from '../services/stock-movement.service';
import {
    buildCustomerDataScopeWhere,
    buildOrderDataScopeWhere,
    canUseCustomerForBusinessWrite,
    canUseOperationalDataScope,
    hasDataScope,
} from '../utils/recordAccess';

export const getCustomerDisplayName = (customer: {
    name?: string | null;
    nameZh?: string | null;
    nameEn?: string | null;
    nameVi?: string | null;
}) => customer.nameZh || customer.nameEn || customer.nameVi || customer.name || '';

const ACTIVE_SHIPMENT_STATUSES = new Set(['in_transit', 'delivered']);

export const SHIPMENT_STATUS_TRANSITIONS: Record<string, string[]> = {
    pending: ['in_transit', 'exception'],
    in_transit: ['exception'],
    exception: ['in_transit'],
    delivered: [],
};

export const mapShipmentRecord = (shipment: any) => ({
    ...shipment,
    quantity: Number(shipment.quantity),
    customerName: shipment.customer ? getCustomerDisplayName(shipment.customer) : '',
    customerNameZh: shipment.customer?.nameZh || null,
    customerNameEn: shipment.customer?.nameEn || null,
    customerNameVi: shipment.customer?.nameVi || null,
    customerDisplayName: shipment.customer ? getCustomerDisplayName(shipment.customer) : '',
    orderNo: shipment.order?.orderNo,
    creatorName: shipment.creator?.username || '',
});

type ShipmentReceiptRow = {
    id?: unknown;
    receiptNo?: unknown;
    shipmentId?: unknown;
    quantity?: unknown;
    acceptedQuantity?: unknown;
    rejectedQuantity?: unknown;
    unit?: unknown;
    signedReceiptUrl?: unknown;
    discrepancyReason?: unknown;
    note?: unknown;
    receivedBy?: unknown;
    receivedAt?: unknown;
    createdAt?: unknown;
};

type ShipmentReceiptTotalsRow = {
    processedQuantity?: unknown;
    acceptedQuantity?: unknown;
    rejectedQuantity?: unknown;
    receiptCount?: unknown;
};

const normalizeShipmentReceiptRow = (row: ShipmentReceiptRow) => ({
    id: Number(row.id),
    receiptNo: String(row.receiptNo || ''),
    shipmentId: Number(row.shipmentId),
    quantity: Number(row.quantity || 0),
    acceptedQuantity: Number(row.acceptedQuantity || 0),
    rejectedQuantity: Number(row.rejectedQuantity || 0),
    unit: String(row.unit || 'kg'),
    signedReceiptUrl: row.signedReceiptUrl ? String(row.signedReceiptUrl) : null,
    discrepancyReason: row.discrepancyReason ? String(row.discrepancyReason) : null,
    note: row.note ? String(row.note) : null,
    receivedBy: row.receivedBy == null ? null : Number(row.receivedBy),
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
});

export async function listShipmentReceiptEvents(tx: TransactionClient, shipmentId: number) {
    const rows = await tx.$queryRawUnsafe<ShipmentReceiptRow[]>(
        `SELECT
           id,
           receipt_no AS receiptNo,
           shipment_id AS shipmentId,
           quantity,
           accepted_quantity AS acceptedQuantity,
           rejected_quantity AS rejectedQuantity,
           unit,
           signed_receipt_url AS signedReceiptUrl,
           discrepancy_reason AS discrepancyReason,
           note,
           received_by AS receivedBy,
           received_at AS receivedAt,
           created_at AS createdAt
         FROM shipment_receipts
         WHERE shipment_id = ?
         ORDER BY id ASC`,
        shipmentId,
    );
    return rows.map(normalizeShipmentReceiptRow);
}

export async function getShipmentReceiptTotals(tx: TransactionClient, shipmentId: number) {
    const rows = await tx.$queryRawUnsafe<ShipmentReceiptTotalsRow[]>(
        `SELECT
           COALESCE(SUM(quantity), 0) AS processedQuantity,
           COALESCE(SUM(accepted_quantity), 0) AS acceptedQuantity,
           COALESCE(SUM(rejected_quantity), 0) AS rejectedQuantity,
           COUNT(*) AS receiptCount
         FROM shipment_receipts
         WHERE shipment_id = ?`,
        shipmentId,
    );
    const row = rows[0] || {};
    return {
        processedQuantity: Number(row.processedQuantity || 0),
        acceptedQuantity: Number(row.acceptedQuantity || 0),
        rejectedQuantity: Number(row.rejectedQuantity || 0),
        receiptCount: Number(row.receiptCount || 0),
    };
}

export async function buildShipmentReceiptSummary(tx: TransactionClient, shipment: { id: number; quantity: number }) {
    const totals = await getShipmentReceiptTotals(tx, Number(shipment.id));
    const shipmentQuantity = Number(shipment.quantity || 0);
    return {
        shipmentQuantity,
        processedQuantity: totals.processedQuantity,
        acceptedQuantity: totals.acceptedQuantity,
        rejectedQuantity: totals.rejectedQuantity,
        remainingQuantity: Math.max(0, shipmentQuantity - totals.processedQuantity),
        receiptCount: totals.receiptCount,
    };
}

export function buildShipmentDataScopeWhere(
    req: AuthRequest,
    options: { includeFinanceAll?: boolean; includeWarehouseAll?: boolean } = {},
): Prisma.ShipmentWhereInput {
    if (!req.user) return { id: -1 };
    if (
        req.user.role === 'admin'
        || hasDataScope(req, 'all')
        || (options.includeWarehouseAll && hasDataScope(req, 'warehouse_visible'))
        || (options.includeFinanceAll && hasDataScope(req, 'finance_visible'))
    ) {
        return {};
    }

    const customerScope = buildCustomerDataScopeWhere(req);
    const orderScope = buildOrderDataScopeWhere(req);
    if (req.user.role === 'sales' || hasDataScope(req, 'own_customers')) {
        return {
            OR: [
                { createdBy: req.user.userId },
                { order: orderScope },
                { customer: customerScope },
            ],
        };
    }

    if (req.user.role === 'manager' || hasDataScope(req, 'team_customers')) {
        return {
            OR: [
                { order: orderScope },
                { customer: customerScope },
            ],
        };
    }

    return { id: -1 };
}

export function canReadShipment(
    req: AuthRequest,
    shipment: any,
    options: { includeFinanceAll?: boolean; includeWarehouseAll?: boolean } = {},
) {
    if (!req.user) return false;
    if (
        req.user.role === 'admin'
        || hasDataScope(req, 'all')
        || (options.includeWarehouseAll && hasDataScope(req, 'warehouse_visible'))
        || (options.includeFinanceAll && hasDataScope(req, 'finance_visible'))
    ) {
        return true;
    }

    if (shipment.createdBy === req.user.userId || shipment.order?.createdBy === req.user.userId) return true;
    return shipment.customer ? canUseCustomerForBusinessWrite(req, shipment.customer) : false;
}

export function canManageShipping(req: AuthRequest) {
    return canUseOperationalDataScope(req, 'warehouse_visible');
}

export async function getShipmentDetail(shipmentId: number) {
    const shipment = await prisma.shipment.findUnique({
        where: { id: shipmentId },
        include: {
            customer: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } },
            order: { select: { id: true, orderNo: true } },
            creator: { select: { id: true, username: true } },
        },
    });

    return shipment ? mapShipmentRecord(shipment) : null;
}

export async function syncOrderShipmentState(tx: TransactionClient, orderId: number) {
    const [order, shipments] = await Promise.all([
        tx.order.findUnique({
            where: { id: orderId },
            select: { id: true, status: true },
        }),
        tx.shipment.findMany({
            where: { orderId },
            select: { status: true },
        }),
    ]);

    if (!order || order.status === 'cancelled') {
        return;
    }

    let nextStatus = order.status;
    if (shipments.length > 0 && shipments.every((shipment: { status: string }) => shipment.status === 'delivered')) {
        nextStatus = 'delivered';
    } else if (shipments.some((shipment: { status: string }) => ACTIVE_SHIPMENT_STATUSES.has(shipment.status))) {
        nextStatus = 'shipped';
    }

    if (nextStatus !== order.status) {
        await tx.order.update({
            where: { id: orderId },
            data: { status: nextStatus },
        });
    }
}
