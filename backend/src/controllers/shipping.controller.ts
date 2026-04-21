import { Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import { StockMovementService, type TransactionClient } from '../services/stock-movement.service';
import { ReceiptDiscrepancyService } from '../services/receipt-discrepancy.service';
import { RECEIPT_MIME_EXT, storeReceiptFile } from '../services/shipping-receipt-file.service';
import {
    buildCustomerDataScopeWhere,
    buildOrderDataScopeWhere,
    canUseCustomerForBusinessWrite,
    canUseOperationalDataScope,
    hasDataScope,
    mergeWhereAnd,
} from '../utils/recordAccess';

const getCustomerDisplayName = (customer: {
    name?: string | null;
    nameZh?: string | null;
    nameEn?: string | null;
    nameVi?: string | null;
}) => customer.nameZh || customer.nameEn || customer.nameVi || customer.name || '';

const ACTIVE_SHIPMENT_STATUSES = new Set(['in_transit', 'delivered']);

const SHIPMENT_STATUS_TRANSITIONS: Record<string, string[]> = {
    pending: ['in_transit', 'exception'],
    in_transit: ['exception'],
    exception: ['in_transit'],
    delivered: [],
};

const mapShipmentRecord = (shipment: any) => ({
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

function normalizeShipmentReceiptRow(row: ShipmentReceiptRow) {
    return {
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
    };
}

async function listShipmentReceiptEvents(tx: TransactionClient, shipmentId: number) {
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

async function getShipmentReceiptTotals(tx: TransactionClient, shipmentId: number) {
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

async function buildShipmentReceiptSummary(tx: TransactionClient, shipment: { id: number; quantity: number }) {
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

function buildShipmentDataScopeWhere(req: AuthRequest, options: { includeFinanceAll?: boolean; includeWarehouseAll?: boolean } = {}) {
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

function canReadShipment(req: AuthRequest, shipment: any, options: { includeFinanceAll?: boolean; includeWarehouseAll?: boolean } = {}) {
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

function canManageShipping(req: AuthRequest) {
    return canUseOperationalDataScope(req, 'warehouse_visible');
}

async function getShipmentDetail(shipmentId: number) {
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

async function syncOrderShipmentState(tx: TransactionClient, orderId: number) {
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

async function hasShippingIssuePosted(tx: TransactionClient, shipmentNo: string) {
    const rows = await tx.$queryRawUnsafe<Array<{ id: number }>>(
        `SELECT id FROM stock_entries WHERE source_type = 'shipping_issue' AND source_ref = ? LIMIT 1`,
        shipmentNo,
    );
    return rows.length > 0;
}

async function resolveShippingIssueStock(tx: TransactionClient, shipment: {
    shipmentNo: string;
    productName: string;
    quantity: number;
    unit: string;
    batchNo?: string | null;
}) {
    const quantity = Number(shipment.quantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Shipment quantity must be greater than 0 before dispatch');
    }

    const finishedGoodsLocation = await tx.location.findFirst({
        where: { code: 'LOC-FG', status: 'active' },
        select: { id: true },
    });
    if (!finishedGoodsLocation) {
        throw new Error('Finished goods location LOC-FG is not configured');
    }

    const where: Prisma.StockBalanceWhereInput = {
        locationId: finishedGoodsLocation.id,
        productName: shipment.productName,
        quantity: { gte: quantity },
    };
    if (shipment.batchNo) where.batchNo = shipment.batchNo;

    const stock = await tx.stockBalance.findFirst({
        where,
        orderBy: { createdAt: 'asc' },
        include: { location: true },
    });
    if (!stock) {
        throw new Error(`No available stock for shipment ${shipment.shipmentNo}: ${shipment.productName}${shipment.batchNo ? ` / ${shipment.batchNo}` : ''}`);
    }

    return stock;
}

async function postShippingIssueIfMissing(tx: TransactionClient, shipment: {
    shipmentNo: string;
    productName: string;
    quantity: number;
    unit: string;
    batchNo?: string | null;
}, createdBy?: number | null) {
    if (await hasShippingIssuePosted(tx, shipment.shipmentNo)) {
        return { posted: false, issueStock: null };
    }

    const issueStock = await resolveShippingIssueStock(tx, shipment);
    await StockMovementService.postStockEntry({
        sourceType: 'shipping_issue',
        sourceRef: shipment.shipmentNo,
        reason: 'shipment_dispatched',
        note: `Shipment dispatched: ${shipment.shipmentNo}`,
        createdBy: createdBy || null,
        lines: [{
            locationId: issueStock.locationId,
            productName: issueStock.productName,
            batchNo: issueStock.batchNo,
            quantityDelta: -Number(shipment.quantity || 0),
            unit: shipment.unit || issueStock.unit || 'kg',
        }],
    }, tx);

    return { posted: true, issueStock };
}

export class ShippingController {
    async getShipments(req: AuthRequest, res: Response) {
        try {
            const { page = 1, pageSize = 20, status, customerId, orderId } = req.query;

            const limit = Math.min(Number(pageSize), 100);
            const offset = (Number(page) - 1) * limit;

            const where: Prisma.ShipmentWhereInput = {};
            if (status) where.status = String(status);
            if (customerId) where.customerId = Number(customerId);
            if (orderId) where.orderId = Number(orderId);
            const scopedWhere = mergeWhereAnd(where, buildShipmentDataScopeWhere(req, { includeWarehouseAll: true }));

            const [shipments, total] = await Promise.all([
                prisma.shipment.findMany({
                    where: scopedWhere,
                    include: {
                        customer: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } },
                        order: { select: { id: true, orderNo: true } },
                        creator: { select: { id: true, username: true } },
                    },
                    orderBy: { createdAt: 'desc' },
                    skip: offset,
                    take: limit,
                }),
                prisma.shipment.count({ where: scopedWhere }),
            ]);

            res.json({
                success: true,
                data: shipments.map(mapShipmentRecord),
                meta: {
                    page: Number(page),
                    pageSize: limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                },
            });
        } catch (error) {
            logger.error('获取物流列表错误:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }

    async createShipment(req: AuthRequest, res: Response) {
        try {
            if (!canManageShipping(req)) {
                return res.status(403).json({ success: false, message: '无权创建或推进出货物流' });
            }

            const { customerId, orderId, productName, quantity, unit = '件', packageType, carrier, trackingNo, batchNo } = req.body;
            const normalizedOrderId = orderId ? Number(orderId) : null;

            if (normalizedOrderId) {
                const linkedOrder = await prisma.order.findUnique({
                    where: { id: normalizedOrderId },
                    select: {
                        id: true,
                        status: true,
                        customerId: true,
                        shipmentHold: true,
                    },
                });

                if (!linkedOrder) {
                    return res.status(404).json({ success: false, message: '关联订单不存在' });
                }

                if (linkedOrder.status === 'cancelled') {
                    return res.status(409).json({ success: false, message: '已取消订单不能创建发货单' });
                }

                if (!['confirmed', 'shipped'].includes(linkedOrder.status)) {
                    return res.status(409).json({ success: false, message: '订单尚未确认，不能创建发货单' });
                }

                if (linkedOrder.customerId !== Number(customerId)) {
                    return res.status(409).json({ success: false, message: '发货客户必须与关联订单客户一致' });
                }

                if (linkedOrder.shipmentHold) {
                    return res.status(409).json({ success: false, message: '订单处于发货拦截状态，不能创建发货单' });
                }
            }

            const shipmentNo = buildBusinessNo('SHP');

            const shipment = await withDbRetry(() => prisma.$transaction(async (tx) => tx.shipment.create({
                data: {
                    shipmentNo,
                    customerId: Number(customerId),
                    orderId: normalizedOrderId,
                    productName,
                    quantity,
                    unit,
                    packageType,
                    carrier,
                    trackingNo,
                    batchNo: batchNo || null,
                    status: 'pending',
                    createdBy: req.user!.userId,
                },
            })), { label: 'createShipment' });

            const shipmentDetail = await getShipmentDetail(shipment.id);

            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    action: 'CREATE',
                    resource: 'shipment',
                    resourceId: shipment.id,
                    details: `创建发货单 ${shipmentNo}${normalizedOrderId ? `，关联订单 #${normalizedOrderId}` : ''}`,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                },
            });

            res.status(201).json({ success: true, data: shipmentDetail ?? shipment, message: '发货单创建成功' });
        } catch (error) {
            logger.error('创建发货单错误:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }

    async uploadReceipt(req: AuthRequest, res: Response) {
        try {
            if (!canManageShipping(req)) {
                return res.status(403).json({ success: false, message: '无权上传签收凭证' });
            }

            const shipmentId = Number(req.params.id);
            const { fileName, mimeType, dataUrl } = req.body;

            if (!fileName || !mimeType || !dataUrl) {
                return res.status(400).json({ success: false, message: '请上传真实签收凭证文件' });
            }

            if (!RECEIPT_MIME_EXT[mimeType]) {
                return res.status(400).json({ success: false, message: '签收文件格式不支持' });
            }

            const existingShipment = await prisma.shipment.findUnique({
                where: { id: shipmentId },
                select: {
                    id: true,
                    shipmentNo: true,
                    status: true,
                    shippedAt: true,
                    signedReceiptUrl: true,
                    orderId: true,
                    productName: true,
                    quantity: true,
                    unit: true,
                    batchNo: true,
                    order: {
                        select: {
                            shipmentHold: true,
                        },
                    },
                },
            });

            if (!existingShipment) {
                return res.status(404).json({ success: false, message: '发货单不存在' });
            }

            if (existingShipment.order?.shipmentHold && existingShipment.status === 'pending') {
                return res.status(409).json({ success: false, message: '订单处于发货拦截状态，不能上传签收并推进状态' });
            }

            if (existingShipment.status === 'delivered') {
                const shipmentDetail = await getShipmentDetail(existingShipment.id);
                return res.status(409).json({ success: false, data: shipmentDetail, message: '发货单已签收，不能重复上传凭证' });
            }

            const receiptTotals = await getShipmentReceiptTotals(prisma, existingShipment.id);
            if (receiptTotals.receiptCount > 0) {
                return res.status(409).json({ success: false, message: '该发货单已存在部分签收记录，请继续使用部分签收接口处理剩余数量' });
            }

            let signedReceiptUrl = '';
            try {
                signedReceiptUrl = storeReceiptFile(existingShipment.shipmentNo, fileName, mimeType, dataUrl);
            } catch {
                return res.status(400).json({ success: false, message: '签收文件格式不支持或文件过大' });
            }

            const shipment = await withDbRetry(() => prisma.$transaction(async (tx) => {
                const claim = await tx.shipment.updateMany({
                    where: {
                        id: shipmentId,
                        status: { not: 'delivered' },
                        signedReceiptUrl: null,
                    },
                    data: {
                        status: 'delivered',
                        // 仅当尚未发货时填充 shippedAt（兼容直接签收的极端情况）
                        ...(existingShipment.shippedAt ? {} : { shippedAt: new Date() }),
                        deliveredAt: new Date(),
                        signedReceiptUrl,
                    },
                });

                if (claim.count !== 1) {
                    return null;
                }

                const issueResult = await postShippingIssueIfMissing(tx, {
                    shipmentNo: existingShipment.shipmentNo,
                    productName: existingShipment.productName,
                    quantity: Number(existingShipment.quantity || 0),
                    unit: existingShipment.unit || 'kg',
                    batchNo: existingShipment.batchNo,
                }, req.user?.userId || null);

                if (issueResult.issueStock && !existingShipment.batchNo) {
                    await tx.shipment.update({
                        where: { id: shipmentId },
                        data: { batchNo: issueResult.issueStock.batchNo },
                    });
                }

                if (existingShipment.orderId) {
                    await syncOrderShipmentState(tx, existingShipment.orderId);
                }

                return tx.shipment.findUnique({ where: { id: shipmentId } });
            }), { label: 'uploadShipmentReceipt' });

            if (!shipment) {
                const shipmentDetail = await getShipmentDetail(existingShipment.id);
                return res.status(409).json({ success: false, data: shipmentDetail, message: '发货单已被其他操作推进，请刷新后重试' });
            }

            const shipmentDetail = await getShipmentDetail(shipment.id);

            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    action: 'UPLOAD_RECEIPT',
                    resource: 'shipment',
                    resourceId: shipment.id,
                    details: `上传签收凭证 ${existingShipment.shipmentNo}`,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                },
            });

            return res.json({ success: true, data: shipmentDetail ?? shipment, message: '签收凭证已上传' });
        } catch (error) {
            logger.error('上传签收凭证错误:', error);
            const message = error instanceof Error ? error.message : '服务器内部错误';
            const statusCode = message.startsWith('No available stock') ? 409 : 500;
            return res.status(statusCode).json({ success: false, message: statusCode === 409 ? message : '服务器内部错误' });
        }
    }

    async getReceiptEvents(req: AuthRequest, res: Response) {
        try {
            const shipmentId = Number(req.params.id);
            const shipment = await prisma.shipment.findUnique({
                where: { id: shipmentId },
                include: {
                    customer: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true, salespersonId: true, poolState: true, segment: true } },
                    order: { select: { id: true, orderNo: true, createdBy: true } },
                    creator: { select: { id: true, username: true } },
                },
            });

            if (!shipment || !canReadShipment(req, shipment, { includeFinanceAll: true, includeWarehouseAll: true })) {
                return res.status(404).json({ success: false, message: '发货单不存在' });
            }

            const [receipts, receiptSummary, discrepancyCases] = await Promise.all([
                listShipmentReceiptEvents(prisma, shipmentId),
                buildShipmentReceiptSummary(prisma, { id: shipment.id, quantity: Number(shipment.quantity || 0) }),
                ReceiptDiscrepancyService.listCases(prisma, {
                    relatedModule: 'shipping',
                    relatedId: shipmentId,
                    page: 1,
                    pageSize: 100,
                }),
            ]);

            return res.json({
                success: true,
                data: {
                    shipment: mapShipmentRecord(shipment),
                    receiptSummary,
                    receipts,
                    discrepancyCases: discrepancyCases.items,
                },
            });
        } catch (error) {
            logger.error('查询签收批次错误:', error);
            return res.status(500).json({ success: false, message: '查询签收批次失败' });
        }
    }

    async createReceiptEvent(req: AuthRequest, res: Response) {
        try {
            if (!canManageShipping(req)) {
                return res.status(403).json({ success: false, message: '无权登记签收批次' });
            }

            const shipmentId = Number(req.params.id);
            const inputQuantity = Number(req.body.quantity || 0);
            const acceptedQuantity = Number(req.body.acceptedQuantity ?? inputQuantity);
            const rejectedQuantity = Number(req.body.rejectedQuantity ?? 0);

            if (Math.abs((acceptedQuantity + rejectedQuantity) - inputQuantity) > 0.000001) {
                return res.status(400).json({ success: false, message: '签收数量必须等于正常签收与异常数量之和' });
            }

            const result = await withDbRetry(() => prisma.$transaction(async (tx) => {
                const shipment = await tx.shipment.findUnique({
                    where: { id: shipmentId },
                    select: {
                        id: true,
                        shipmentNo: true,
                        status: true,
                        orderId: true,
                        productName: true,
                        quantity: true,
                        unit: true,
                        customerId: true,
                        signedReceiptUrl: true,
                        customer: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } },
                        order: { select: { id: true, orderNo: true } },
                    },
                });

                if (!shipment) {
                    throw new AppError('SHIPMENT_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
                }

                if (shipment.status === 'delivered') {
                    throw new AppError('SHIPMENT_ALREADY_DELIVERED', 409, ErrorCode.CONFLICT);
                }

                if (shipment.status === 'pending') {
                    throw new AppError('SHIPMENT_MUST_BE_DISPATCHED_FIRST', 409, ErrorCode.CONFLICT);
                }

                if (!['in_transit', 'exception'].includes(shipment.status)) {
                    throw new AppError('SHIPMENT_STATUS_NOT_RECEIVABLE', 409, ErrorCode.CONFLICT);
                }

                const totals = await getShipmentReceiptTotals(tx, shipment.id);
                const remainingQuantity = Number(shipment.quantity || 0) - totals.processedQuantity;
                if (remainingQuantity <= 0.000001) {
                    throw new AppError('SHIPMENT_ALREADY_FULLY_RECEIVED', 409, ErrorCode.CONFLICT);
                }
                if (inputQuantity - remainingQuantity > 0.000001) {
                    throw new AppError(
                        'SHIPMENT_RECEIPT_EXCEEDS_REMAINING',
                        409,
                        ErrorCode.CONFLICT,
                        { remainingQuantity, inputQuantity },
                    );
                }

                const hasReceiptFile = Boolean(req.body.fileName && req.body.mimeType && req.body.dataUrl);
                let signedReceiptUrl: string | null = null;
                if (hasReceiptFile) {
                    try {
                        signedReceiptUrl = storeReceiptFile(shipment.shipmentNo, req.body.fileName, req.body.mimeType, req.body.dataUrl);
                    } catch {
                        throw new AppError('INVALID_RECEIPT_FILE', 400, ErrorCode.VALIDATION_ERROR);
                    }
                }

                const receiptNo = buildBusinessNo('SPR');
                const receivedAt = new Date();
                await tx.$executeRawUnsafe(
                    `INSERT INTO shipment_receipts
                      (receipt_no, shipment_id, quantity, accepted_quantity, rejected_quantity, unit, signed_receipt_url, discrepancy_reason, note, received_by, received_at, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                    receiptNo,
                    shipment.id,
                    inputQuantity,
                    acceptedQuantity,
                    rejectedQuantity,
                    shipment.unit || 'kg',
                    signedReceiptUrl,
                    req.body.discrepancyReason || null,
                    req.body.note || null,
                    req.user?.userId || null,
                    receivedAt,
                );

                const receiptRows = await tx.$queryRawUnsafe<Array<{ id: number }>>(
                    `SELECT id FROM shipment_receipts WHERE receipt_no = ? LIMIT 1`,
                    receiptNo,
                );
                const discrepancyType = ReceiptDiscrepancyService.normalizeDiscrepancyType(
                    req.body.discrepancyType,
                    'customer_short_signed',
                );
                const discrepancyCase = await ReceiptDiscrepancyService.createCaseForRejectedReceipt(tx, {
                    sourceType: 'shipment_receipt',
                    sourceRef: receiptNo,
                    sourceId: receiptRows[0]?.id ? Number(receiptRows[0].id) : null,
                    relatedModule: 'shipping',
                    relatedId: shipment.id,
                    businessRef: shipment.shipmentNo,
                    counterpartyType: 'customer',
                    counterpartyId: shipment.customerId,
                    counterpartyName: shipment.customer ? getCustomerDisplayName(shipment.customer) : null,
                    productName: shipment.productName,
                    quantity: rejectedQuantity,
                    unit: shipment.unit || 'kg',
                    referenceQuantity: Number(shipment.quantity || 0),
                    discrepancyType,
                    reason: req.body.discrepancyReason || '签收异常待处理',
                    severity: rejectedQuantity / Math.max(inputQuantity, 1) >= 0.5 ? 'high' : 'normal',
                    suggestedAction: 'after_sales_or_reship_review',
                    note: req.body.note || null,
                    createdBy: req.user?.userId || null,
                });

                const nextTotals = await getShipmentReceiptTotals(tx, shipment.id);
                const shipmentQuantity = Number(shipment.quantity || 0);
                const isFullyProcessed = nextTotals.processedQuantity + 0.000001 >= shipmentQuantity;
                const nextStatus = rejectedQuantity > 0
                    ? 'exception'
                    : (isFullyProcessed ? 'delivered' : 'in_transit');

                const updated = await tx.shipment.update({
                    where: { id: shipment.id },
                    data: {
                        status: nextStatus,
                        ...(isFullyProcessed && nextStatus === 'delivered' ? { deliveredAt: receivedAt } : {}),
                        ...(signedReceiptUrl ? { signedReceiptUrl } : {}),
                    },
                });

                if (shipment.orderId) {
                    await syncOrderShipmentState(tx, shipment.orderId);
                }

                return {
                    shipment: updated,
                    receiptNo,
                    receiptSummary: await buildShipmentReceiptSummary(tx, shipment),
                    receipts: await listShipmentReceiptEvents(tx, shipment.id),
                    discrepancyCases: (await ReceiptDiscrepancyService.listCases(tx, {
                        relatedModule: 'shipping',
                        relatedId: shipment.id,
                        page: 1,
                        pageSize: 100,
                    })).items,
                    discrepancyCase,
                };
            }), { label: 'createShipmentReceiptEvent' });

            const shipmentDetail = await getShipmentDetail(result.shipment.id);

            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    action: 'CREATE_RECEIPT_EVENT',
                    resource: 'shipment',
                    resourceId: result.shipment.id,
                    details: `新增签收批次 ${result.receiptNo}`,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                },
            });

            return res.status(201).json({
                success: true,
                data: {
                    shipment: shipmentDetail ?? result.shipment,
                    receiptSummary: result.receiptSummary,
                    receipts: result.receipts,
                    discrepancyCases: result.discrepancyCases,
                    discrepancyCase: result.discrepancyCase,
                },
                message: '签收批次已记录',
            });
        } catch (error) {
            logger.error('新增签收批次错误:', error);
            const message = error instanceof Error ? error.message : '服务器内部错误';
            const statusCode = error instanceof AppError ? error.statusCode : 500;
            const details = error instanceof AppError ? error.details : undefined;
            const messages: Record<string, string> = {
                SHIPMENT_NOT_FOUND: '发货单不存在',
                SHIPMENT_ALREADY_DELIVERED: '发货单已签收，不能重复记录签收批次',
                SHIPMENT_MUST_BE_DISPATCHED_FIRST: '分批签收必须先完成发货出库',
                SHIPMENT_STATUS_NOT_RECEIVABLE: '当前物流状态不能记录签收批次',
                SHIPMENT_ALREADY_FULLY_RECEIVED: '发货单已完成全部签收',
                SHIPMENT_RECEIPT_EXCEEDS_REMAINING: '签收数量超过剩余未签收数量',
                INVALID_RECEIPT_FILE: '签收文件格式不支持或文件过大',
                RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE: '签收差异超过容差规则，已阻止处理',
            };
            return res.status(statusCode).json({
                success: false,
                message: messages[message] || (statusCode === 500 ? '服务器内部错误' : message),
                details,
            });
        }
    }

    async updateStatus(req: AuthRequest, res: Response) {
        try {
            if (!canManageShipping(req)) {
                return res.status(403).json({ success: false, message: '无权更新物流状态' });
            }

            const { id } = req.params;
            const { status, trackingNo } = req.body;

            const existingShipment = await prisma.shipment.findUnique({
                where: { id: Number(id) },
                select: {
                    id: true,
                    shipmentNo: true,
                    status: true,
                    orderId: true,
                    productName: true,
                    quantity: true,
                    unit: true,
                    batchNo: true,
                    signedReceiptUrl: true,
                    order: {
                        select: {
                            id: true,
                            shipmentHold: true,
                        },
                    },
                },
            });

            if (!existingShipment) {
                return res.status(404).json({ success: false, message: '发货单不存在' });
            }

            if ((status === 'in_transit' || status === 'delivered') && existingShipment.order?.shipmentHold && existingShipment.status === 'pending') {
                return res.status(409).json({ success: false, message: '订单处于发货拦截状态，不能推进物流状态' });
            }

            if (status === existingShipment.status) {
                const shipmentDetail = await getShipmentDetail(existingShipment.id);
                return res.json({ success: true, data: shipmentDetail ?? existingShipment, message: '物流状态未变化' });
            }

            const allowedTransitions = SHIPMENT_STATUS_TRANSITIONS[existingShipment.status] || [];
            if (!allowedTransitions.includes(status)) {
                return res.status(400).json({ success: false, message: `非法物流状态流转: ${existingShipment.status} -> ${status}` });
            }

            if (status === 'delivered') {
                return res.status(400).json({ success: false, message: '签收必须通过上传真实凭证完成' });
            }

            const updateData: any = { status };
            if (status === 'in_transit') {
                updateData.shippedAt = new Date();
                if (trackingNo) updateData.trackingNo = trackingNo;
            }

            const shipment = await withDbRetry(() => prisma.$transaction(async (tx) => {
                const claim = await tx.shipment.updateMany({
                    where: {
                        id: Number(id),
                        status: existingShipment.status,
                    },
                    data: updateData,
                });

                if (claim.count !== 1) {
                    return null;
                }

                const issueResult = status === 'in_transit'
                    ? await postShippingIssueIfMissing(tx, {
                        shipmentNo: existingShipment.shipmentNo,
                        productName: existingShipment.productName,
                        quantity: Number(existingShipment.quantity || 0),
                        unit: existingShipment.unit || 'kg',
                        batchNo: existingShipment.batchNo,
                    }, req.user?.userId || null)
                    : { posted: false, issueStock: null };

                if (issueResult.issueStock && !existingShipment.batchNo) {
                    await tx.shipment.update({
                        where: { id: Number(id) },
                        data: { batchNo: issueResult.issueStock.batchNo },
                    });
                }

                if (existingShipment.orderId) {
                    await syncOrderShipmentState(tx, existingShipment.orderId);
                }

                return tx.shipment.findUnique({ where: { id: Number(id) } });
            }), { label: 'updateShipmentStatus' });

            if (!shipment) {
                const shipmentDetail = await getShipmentDetail(existingShipment.id);
                return res.status(409).json({ success: false, data: shipmentDetail, message: '物流状态已被其他操作更新，请刷新后重试' });
            }

            const shipmentDetail = await getShipmentDetail(shipment.id);

            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    action: 'STATUS_CHANGE',
                    resource: 'shipment',
                    resourceId: shipment.id,
                    details: `物流状态变更 ${shipment.shipmentNo} -> ${status}`,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                },
            });

            res.json({ success: true, data: shipmentDetail ?? shipment, message: '物流状态更新成功' });
        } catch (error) {
            logger.error('更新物流状态错误:', error);
            const message = error instanceof Error ? error.message : '服务器内部错误';
            const statusCode = message.startsWith('No available stock') ? 409 : 500;
            res.status(statusCode).json({ success: false, message });
        }
    }

}

