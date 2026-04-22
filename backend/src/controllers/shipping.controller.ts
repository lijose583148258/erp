import { Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import { ReceiptDiscrepancyService } from '../services/receipt-discrepancy.service';
import { RECEIPT_MIME_EXT, storeReceiptFile } from '../services/shipping-receipt-file.service';
import { postShippingIssueIfMissing } from '../services/shipping-stock-issue.service';
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

            const shipment = await withDbRetry(() => prisma.$transaction(async (tx) => {
                const claimed = await claimShipmentReceiptWrite(tx, shipmentId);
                if (!claimed) {
                    throw new AppError('SHIPMENT_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
                }

                const lockedShipment = await tx.shipment.findUnique({
                    where: { id: shipmentId },
                    select: {
                        id: true,
                        shipmentNo: true,
                        status: true,
                        shippedAt: true,
                        orderId: true,
                        productName: true,
                        quantity: true,
                        unit: true,
                        batchNo: true,
                        signedReceiptUrl: true,
                    },
                });
                if (!lockedShipment) {
                    throw new AppError('SHIPMENT_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
                }
                if (lockedShipment.status === 'delivered' || lockedShipment.signedReceiptUrl) {
                    return null;
                }

                const receiptTotals = await getShipmentReceiptTotals(tx, lockedShipment.id);
                if (receiptTotals.receiptCount > 0) {
                    throw new AppError('SHIPMENT_PARTIAL_RECEIPTS_EXIST', 409, ErrorCode.CONFLICT);
                }

                let signedReceiptUrl = '';
                try {
                    signedReceiptUrl = storeReceiptFile(lockedShipment.shipmentNo, fileName, mimeType, dataUrl);
                } catch {
                    throw new AppError('INVALID_RECEIPT_FILE', 400, ErrorCode.VALIDATION_ERROR);
                }

                const issueResult = await postShippingIssueIfMissing(tx, {
                    shipmentNo: lockedShipment.shipmentNo,
                    productName: lockedShipment.productName,
                    quantity: Number(lockedShipment.quantity || 0),
                    unit: lockedShipment.unit || 'kg',
                    batchNo: lockedShipment.batchNo,
                }, req.user?.userId || null);

                const updateData = {
                    status: 'delivered',
                    // 仅当尚未发货时填充 shippedAt（兼容直接签收的极端情况）
                    ...(lockedShipment.shippedAt ? {} : { shippedAt: new Date() }),
                    deliveredAt: new Date(),
                    signedReceiptUrl,
                    ...(issueResult.issueStock && !lockedShipment.batchNo ? { batchNo: issueResult.issueStock.batchNo } : {}),
                };
                await tx.shipment.update({
                    where: { id: shipmentId },
                    data: updateData,
                });

                if (lockedShipment.orderId) {
                    await syncOrderShipmentState(tx, lockedShipment.orderId);
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

