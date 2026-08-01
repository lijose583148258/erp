import { Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import { ReceiptDiscrepancyService } from '../services/receipt-discrepancy.service';
import { postShippingIssueIfMissing } from '../services/shipping-stock-issue.service';
import { resolveShipmentIdentity } from '../services/shipment-material-identity';
import { isMaterialReleaseReadinessError } from '../services/material-release-readiness.service';
import { createShippingReceiptEvent } from './shipping-receipt-event.controller';
import {
    SHIPMENT_STATUS_TRANSITIONS,
    buildShipmentDataScopeWhere,
    buildShipmentReceiptSummary,
    canManageShipping,
    canReadShipment,
    claimShipmentReceiptWrite,
    getShipmentDetail,
    getShipmentReceiptTotals,
    listShipmentReceiptEvents,
    mapShipmentRecord,
    syncOrderShipmentState,
} from './shipping-controller.helpers';
import {
    mergeWhereAnd,
} from '../utils/recordAccess';

const resolveShipmentStatusCode = (message: string) => {
    if (message.endsWith('_NOT_FOUND')) return 404;
    if (message.startsWith('SHIPMENT_') || message.startsWith('STOCK_MATERIAL_')) return 409;
    return 500;
};

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

            const { customerId, orderId, orderItemId, materialId, productName, quantity, unit = '件', packageType, carrier, trackingNo, batchNo } = req.body;
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

            const shipment = await withDbRetry(() => prisma.$transaction(async (tx) => {
                const identity = await resolveShipmentIdentity(tx, {
                    customerId: Number(customerId),
                    orderId: normalizedOrderId,
                    orderItemId: orderItemId ? Number(orderItemId) : null,
                    materialId: materialId ? Number(materialId) : null,
                    productName,
                    quantity: Number(quantity),
                    unit,
                    batchNo: batchNo || null,
                });
                return tx.shipment.create({ data: {
                    shipmentNo,
                    customerId: Number(customerId),
                    orderId: identity.orderId,
                    orderItemId: identity.orderItemId,
                    materialId: identity.materialId,
                    productBatchId: identity.productBatchId,
                    productName: identity.productName,
                    quantity,
                    unit: identity.unit,
                    packageType,
                    carrier,
                    trackingNo,
                    batchNo: identity.batchNo,
                    status: 'pending',
                    createdBy: req.user!.userId,
                }});
            }, { isolationLevel: 'Serializable' }), { label: 'createShipment' });

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
            if (isMaterialReleaseReadinessError(error)) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: '发货会形成库存与客户履约事实，请先把该行关联到已发布的统一物料。',
                    errorCode: error.message,
                    details: error.details,
                });
            }
            const message = error instanceof Error ? error.message : 'Failed to create shipment';
            const status = resolveShipmentStatusCode(message);
            res.status(status).json({ success: false, message: status === 500 ? 'Failed to create shipment' : message });
        }
    }

    async uploadReceipt(req: AuthRequest, res: Response) {
        try {
            const shipmentId = Number(req.params.id);
            const existingShipment = await prisma.shipment.findUnique({
                where: { id: shipmentId },
                select: {
                    id: true,
                    shipmentNo: true,
                    status: true,
                    quantity: true,
                    unit: true,
                },
            });

            if (!existingShipment) {
                return res.status(404).json({ success: false, message: '发货单不存在' });
            }
            req.body = {
                ...req.body,
                quantity: Number(existingShipment.quantity || 0),
                acceptedQuantity: Number(existingShipment.quantity || 0),
                rejectedQuantity: 0,
                note: `Legacy full receipt upload routed to receipt event for ${existingShipment.shipmentNo}`,
            };
            return createShippingReceiptEvent(req, res);
        } catch (error) {
            logger.error('上传签收凭证错误:', error);
            const message = error instanceof Error ? error.message : '服务器内部错误';
            if (error instanceof AppError) {
                const messages: Record<string, string> = {
                    SHIPMENT_NOT_FOUND: '发货单不存在',
                    SHIPMENT_PARTIAL_RECEIPTS_EXIST: '该发货单已存在部分签收记录，请继续使用部分签收接口处理剩余数量',
                    INVALID_RECEIPT_FILE: '签收文件格式不支持或文件过大',
                };
                return res.status(error.statusCode).json({
                    success: false,
                    message: messages[message] || message,
                    details: error.details,
                });
            }
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
        return createShippingReceiptEvent(req, res);
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
                    materialId: true,
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
                        materialId: existingShipment.materialId,
                    }, req.user?.userId || null)
                    : { posted: false, issueStock: null };

                if (issueResult.issueStock) {
                    const productBatch = await tx.productBatch.findFirst({
                        where: issueResult.issueStock.materialId
                            ? { materialId: issueResult.issueStock.materialId, batchNo: issueResult.issueStock.batchNo }
                            : { productName: issueResult.issueStock.productName, batchNo: issueResult.issueStock.batchNo },
                        select: { id: true },
                    });
                    await tx.shipment.update({
                        where: { id: Number(id) },
                        data: {
                            batchNo: issueResult.issueStock.batchNo,
                            materialId: issueResult.issueStock.materialId,
                            productBatchId: productBatch?.id ?? null,
                        },
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

