import { Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { withDbRetry } from '../utils/dbRetry';
import { ReceiptDiscrepancyService } from '../services/receipt-discrepancy.service';
import { postShippingIssueIfMissing } from '../services/shipping-stock-issue.service';
import { StockMovementConflictError } from '../services/stock-movement.errors';
import { createShipmentDraft, findShipmentSubmission, shipmentSubmissionKey, ShipmentSubmissionError } from '../services/shipment-submission.service';
import { changeShipmentReservation, getShipmentReservation, releasePendingShipmentReservation, readShipmentReservationViews } from '../services/shipment-stock-reservation.service';
import { readShipmentReceiptSubmission, shipmentReceiptSubmissionKey } from '../services/shipment-receipt-submission.service';
import { readShipmentSupplement, supplementShipment } from '../services/shipment-supplement.service';
import { claimShipmentDispatchOrder } from '../services/shipment-order-guard.service';
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
async function changeReservation(req: AuthRequest, res: Response, action: 'reserve' | 'release') {
    try {
        if (!canManageShipping(req)) return res.status(403).json({ success: false, message: '无权预留或释放实物库存' });
        const result = await changeShipmentReservation(Number(req.params.id), action, req.body, req.user!.userId);
        return res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
    } catch (error) {
        logger.error('实物预留操作失败:', error);
        if (error instanceof AppError) return res.status(error.statusCode).json({ success: false, errorCode: error.message, message: error.message, details: error.details });
        const message = error instanceof Error ? error.message : 'SHIPMENT_RESERVATION_FAILED';
        return res.status(error instanceof StockMovementConflictError ? 409 : 500).json({ success: false, errorCode: message, message });
    }
}

export class ShippingController {
    async readSupplement(req: AuthRequest, res: Response) {
        try {
            const shipment = await prisma.shipment.findUnique({ where: { id: Number(req.params.id) }, include: {
                customer: { select: { salespersonId: true, poolState: true, segment: true } }, order: { select: { createdBy: true } },
            } });
            if (!shipment || !canReadShipment(req, shipment, { includeWarehouseAll: true })) return res.status(404).json({ success: false, message: '发货单不存在' });
            const result = await readShipmentSupplement(shipment.id);
            return res.json({ success: true, data: { ...result, shipment: mapShipmentRecord(result.shipment) } });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'SHIPMENT_SUPPLEMENT_FAILED';
            return res.status(error instanceof StockMovementConflictError ? 409 : 500).json({ success: false, message, errorCode: message });
        }
    }
    async supplement(req: AuthRequest, res: Response) {
        try {
            if (!canManageShipping(req)) return res.status(403).json({ success: false, message: '无权补录发货资料' });
            const result = await supplementShipment(Number(req.params.id), req.body, req.user!.userId);
            return res.json({ success: true, data: { ...result, shipment: mapShipmentRecord(result.shipment) } });
        } catch (error) {
            logger.error('补录发货资料失败:', error);
            const message = error instanceof Error ? error.message : 'SHIPMENT_SUPPLEMENT_FAILED';
            return res.status(error instanceof StockMovementConflictError ? (message.endsWith('_NOT_FOUND') ? 404 : 409) : 500)
                .json({ success: false, message, errorCode: message });
        }
    }
    async reserveStock(req: AuthRequest, res: Response) { return changeReservation(req, res, 'reserve'); }
    async releaseStock(req: AuthRequest, res: Response) { return changeReservation(req, res, 'release'); }
    async readReservation(req: AuthRequest, res: Response) {
        try {
            const shipment = await prisma.shipment.findUnique({ where: { id: Number(req.params.id) }, include: {
                customer: { select: { salespersonId: true, poolState: true, segment: true } }, order: { select: { createdBy: true } },
            } });
            if (!shipment || !canReadShipment(req, shipment, { includeWarehouseAll: true })) return res.status(404).json({ success: false, message: '发货单不存在' });
            return res.json({ success: true, data: await getShipmentReservation(shipment.id) });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'SHIPMENT_RESERVATION_FAILED';
            return res.status(error instanceof StockMovementConflictError ? 409 : 500).json({ success: false, errorCode: message, message });
        }
    }
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

            const views = await readShipmentReservationViews(prisma, shipments);
            res.json({
                success: true,
                data: shipments.map(shipment => mapShipmentRecord({ ...shipment, stockReservation: views.get(shipment.id) })),
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

            const key = shipmentSubmissionKey(req.get('Idempotency-Key'), req.body.idempotencyKey);
            const result = await createShipmentDraft(req.body, { userId: req.user!.userId, ipAddress: req.ip, userAgent: req.get('user-agent') }, key);
            const data = result.submission ? result.shipment : await getShipmentDetail(result.shipment.id) ?? result.shipment;
            res.status(result.replayed ? 200 : 201).json({ success: true, data, submission: result.submission, replayed: result.replayed, message: '发货单创建成功' });
        } catch (error) {
            logger.error('创建发货单错误:', error);
            if (error instanceof ShipmentSubmissionError) return res.status(error.status).json({ success: false, message: error.code, errorCode: error.code, details: error.details });
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

    async getSubmission(req: AuthRequest, res: Response) {
        try {
            if (!canManageShipping(req)) return res.status(403).json({ success: false, message: '无权确认发货请求' });
            const key = shipmentSubmissionKey(req.params.key)!;
            const result = await findShipmentSubmission(key, req.user!.userId);
            if (!result) return res.status(404).json({ success: false, errorCode: 'SHIPMENT_SUBMISSION_NOT_FOUND' });
            return res.json({ success: true, data: result.shipment, submission: result.submission, replayed: true });
        } catch (error) {
            logger.error('确认发货请求错误:', error);
            if (error instanceof ShipmentSubmissionError) return res.status(error.status).json({ success: false, message: error.code, errorCode: error.code });
            return res.status(500).json({ success: false, message: '无法确认原发货请求' });
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
            const statusCode = error instanceof StockMovementConflictError || message.startsWith('No available stock') ? 409 : resolveShipmentStatusCode(message);
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

            const receiptKey = shipmentReceiptSubmissionKey(req.query.submissionKey);
            const submission = receiptKey ? await readShipmentReceiptSubmission(prisma, shipmentId, receiptKey, req.user!.userId) : null;
            if (receiptKey && !submission) return res.status(404).json({ success: false, message: '原签收请求尚未找到', errorCode: 'SHIPMENT_RECEIPT_SUBMISSION_NOT_FOUND' });
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
                    ...(submission ? { submission } : {}),
                },
            });
        } catch (error) {
            logger.error('查询签收批次错误:', error);
            return res.status(error instanceof AppError ? error.statusCode : 500).json({ success: false, message: error instanceof AppError ? error.message : '查询签收批次失败',
                ...(error instanceof AppError && error.details && 'rejectedSubmission' in error.details ? { errorCode: error.message, details: error.details } : {}) });
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
                if (status === 'in_transit' && existingShipment.orderId) {
                    await claimShipmentDispatchOrder(tx, existingShipment.orderId);
                }
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

                // Use the locked row: a colleague may have supplied the batch
                // while this request waited. Unbound native drafts cannot issue stock.
                const currentShipment = (await tx.shipment.findUnique({ where: { id: Number(id) } }))!;
                if (status === 'in_transit' && currentShipment.submissionKey && !currentShipment.batchNo) {
                    throw new StockMovementConflictError('SHIPMENT_BATCH_REQUIRED_BEFORE_DISPATCH');
                }

                if (existingShipment.status === 'pending' && status === 'exception') {
                    await releasePendingShipmentReservation(tx, Number(id), req.user!.userId);
                }

                const issueResult = status === 'in_transit'
                    ? await postShippingIssueIfMissing(tx, {
                        shipmentNo: currentShipment.shipmentNo,
                        productName: currentShipment.productName,
                        quantity: Number(currentShipment.quantity || 0),
                        unit: currentShipment.unit || 'kg',
                        batchNo: currentShipment.batchNo,
                        materialId: currentShipment.materialId,
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

                await tx.auditLog.create({ data: { userId: req.user!.userId, action: 'STATUS_CHANGE', resource: 'shipment', resourceId: Number(id),
                    details: `物流状态变更 ${existingShipment.shipmentNo} -> ${status}`, ipAddress: req.ip, userAgent: req.get('user-agent') } });

                return tx.shipment.findUnique({ where: { id: Number(id) } });
            }, { isolationLevel: 'Serializable' }), { label: 'updateShipmentStatus' });

            if (!shipment) {
                const shipmentDetail = await getShipmentDetail(existingShipment.id);
                return res.status(409).json({ success: false, data: shipmentDetail, message: '物流状态已被其他操作更新，请刷新后重试' });
            }

            const shipmentDetail = await getShipmentDetail(shipment.id);

            res.json({ success: true, data: shipmentDetail ?? shipment, message: '物流状态更新成功' });
        } catch (error) {
            logger.error('更新物流状态错误:', error);
            const message = error instanceof Error ? error.message : '服务器内部错误';
            const statusCode = error instanceof StockMovementConflictError || message.startsWith('No available stock') ? 409 : resolveShipmentStatusCode(message);
            res.status(statusCode).json({ success: false, message });
        }
    }

}

