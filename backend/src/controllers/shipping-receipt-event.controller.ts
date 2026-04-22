import { Response } from 'express';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import { ReceiptDiscrepancyService } from '../services/receipt-discrepancy.service';
import { storeReceiptFile } from '../services/shipping-receipt-file.service';
import {
    buildShipmentReceiptSummary,
    canManageShipping,
    claimShipmentReceiptWrite,
    getCustomerDisplayName,
    getShipmentDetail,
    getShipmentReceiptTotals,
    listShipmentReceiptEvents,
    syncOrderShipmentState,
} from './shipping-controller.helpers';

export async function createShippingReceiptEvent(req: AuthRequest, res: Response) {
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
            const claimed = await claimShipmentReceiptWrite(tx, shipmentId);
            if (!claimed) {
                throw new AppError('SHIPMENT_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
            }

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
