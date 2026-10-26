import { Response } from 'express';
import prisma from '../config/database';
import { executeRawCompat, queryRawCompat } from '../utils/raw-sql-compat';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import { compareReceiptQuantity } from '../utils/receiptQuantity';
import { ReceiptDiscrepancyService } from '../services/receipt-discrepancy.service';
import type { CreateReceiptDiscrepancyCaseInput } from '../services/receipt-discrepancy.types';
import { storeReceiptFile } from '../services/shipping-receipt-file.service';
import { shipmentReceiptSubmissionKey, shipmentReceiptFacts, readShipmentReceiptSubmission, recordShipmentReceiptSubmission,
    recordShipmentReceiptRejection, rejectedShipmentReceiptError } from '../services/shipment-receipt-submission.service';
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
        const key = shipmentReceiptSubmissionKey(req.get('Idempotency-Key'));
        const facts = shipmentReceiptFacts({ ...req.body, quantity: inputQuantity, acceptedQuantity, rejectedQuantity });

        if (compareReceiptQuantity(acceptedQuantity + rejectedQuantity, inputQuantity) !== 0) {
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

            const prior = key ? await readShipmentReceiptSubmission(tx, shipmentId, key, req.user!.userId, facts) : null;
            const bundle = async () => ({ shipment, receiptSummary: await buildShipmentReceiptSummary(tx, shipment),
                receipts: await listShipmentReceiptEvents(tx, shipment.id), discrepancyCases: (await ReceiptDiscrepancyService.listCases(tx, {
                    relatedModule: 'shipping', relatedId: shipment.id, page: 1, pageSize: 100 })).items });
            if (prior) return { ...(await bundle()), submission: prior, replayed: true, discrepancyCase: null };
            const reject = async (code: Parameters<typeof recordShipmentReceiptRejection>[5]) => {
                if (!key) throw new AppError(code, 409, ErrorCode.CONFLICT);
                return { rejectedSubmission: await recordShipmentReceiptRejection(tx, shipmentId, req.user!.userId, key, facts, code,
                    { ipAddress: req.ip, userAgent: req.get('user-agent') }) };
            };

            if (shipment.status === 'delivered') {
                return reject('SHIPMENT_ALREADY_DELIVERED');
            }

            if (shipment.status === 'pending') {
                return reject('SHIPMENT_MUST_BE_DISPATCHED_FIRST');
            }

            if (!['in_transit', 'exception'].includes(shipment.status)) {
                return reject('SHIPMENT_STATUS_NOT_RECEIVABLE');
            }

            const totals = await getShipmentReceiptTotals(tx, shipment.id);
            if (compareReceiptQuantity(totals.processedQuantity, shipment.quantity) >= 0) {
                return reject('SHIPMENT_ALREADY_FULLY_RECEIVED');
            }
            if (compareReceiptQuantity(inputQuantity + totals.processedQuantity, shipment.quantity) > 0) {
                return reject('SHIPMENT_RECEIPT_EXCEEDS_REMAINING');
            }

            const receiptNo = buildBusinessNo('SPR');
            const discrepancyInput: CreateReceiptDiscrepancyCaseInput = {
                sourceType: 'shipment_receipt',
                sourceRef: receiptNo,
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
                discrepancyType: ReceiptDiscrepancyService.normalizeDiscrepancyType(req.body.discrepancyType, 'customer_short_signed'),
                reason: req.body.discrepancyReason || '签收异常待处理',
                severity: rejectedQuantity / Math.max(inputQuantity, 1) >= 0.5 ? 'high' : 'normal',
                suggestedAction: 'after_sales_or_reship_review',
                note: req.body.note || null,
                createdBy: req.user?.userId || null,
            };
            // Only a read-only, pre-write policy rejection may commit a sealed intent.
            // The later case creation independently rechecks policy and must roll back
            // the whole receipt transaction if a rule changes in between.
            try {
                await ReceiptDiscrepancyService.assertReceiptAllowed(tx, discrepancyInput);
            } catch (error) {
                if (error instanceof AppError && error.statusCode === 409 && error.message === 'RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE') {
                    return reject('RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE');
                }
                throw error;
            }

            const hasReceiptFile = Boolean(req.body.fileName && req.body.mimeType && req.body.dataUrl);
            let signedReceiptUrl: string | null = null;
            if (hasReceiptFile) {
                try {
                    signedReceiptUrl = await storeReceiptFile(shipment.shipmentNo, req.body.fileName, req.body.mimeType, req.body.dataUrl);
                } catch (error) {
                    const storageError = error instanceof Error ? error.message : '';
                    if (storageError.startsWith('S3_')) {
                        throw new AppError('RECEIPT_STORAGE_UNAVAILABLE', 503, ErrorCode.INTERNAL_ERROR);
                    }
                    throw new AppError('INVALID_RECEIPT_FILE', 400, ErrorCode.VALIDATION_ERROR);
                }
            }

            const receivedAt = new Date();
            await executeRawCompat(tx, 
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
                facts.discrepancyReason,
                facts.note,
                req.user?.userId || null,
                receivedAt,
            );

            const receiptRows = await queryRawCompat<Array<{ id: number }>>(tx, 
                `SELECT id FROM shipment_receipts WHERE receipt_no = ? LIMIT 1`,
                receiptNo,
            );
            const discrepancyCase = await ReceiptDiscrepancyService.createCaseForRejectedReceipt(tx, {
                ...discrepancyInput,
                sourceId: receiptRows[0]?.id ? Number(receiptRows[0].id) : null,
            });

            const nextTotals = await getShipmentReceiptTotals(tx, shipment.id);
            const shipmentQuantity = Number(shipment.quantity || 0);
            const isFullyProcessed = compareReceiptQuantity(nextTotals.processedQuantity, shipmentQuantity) >= 0;
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

            const submission = await recordShipmentReceiptSubmission(tx, shipmentId, Number(receiptRows[0].id), req.user!.userId, key, facts,
                { ipAddress: req.ip, userAgent: req.get('user-agent') });

            return {
                shipment: updated,
                receiptNo,
                submission,
                replayed: false,
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

        if ('rejectedSubmission' in result) throw rejectedShipmentReceiptError(result.rejectedSubmission);
        const shipmentDetail = await getShipmentDetail(result.shipment.id);

        return res.status(201).json({
            success: true,
            data: {
                shipment: shipmentDetail ?? result.shipment,
                receiptSummary: result.receiptSummary,
                receipts: result.receipts,
                discrepancyCases: result.discrepancyCases,
                discrepancyCase: result.discrepancyCase,
                ...(result.submission ? { submission: result.submission, replayed: result.replayed } : {}),
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
            RECEIPT_STORAGE_UNAVAILABLE: '签收凭证存储暂不可用，请稍后重试',
            RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE: '签收差异超过容差规则，已阻止处理',
        };
        return res.status(statusCode).json({
            success: false,
            message: messages[message] || (statusCode === 500 ? '服务器内部错误' : message),
            ...(error instanceof AppError && error.details && 'rejectedSubmission' in error.details ? { errorCode: message } : {}),
            details,
        });
    }
}
