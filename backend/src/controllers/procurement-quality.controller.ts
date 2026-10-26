import type { Response } from 'express';
import prisma from '../config/database';
import type { AuthRequest } from '../middleware/auth';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { canUseOperationalDataScope, buildOperationalDataScopeWhere } from '../utils/recordAccess';
import { withDbRetry } from '../utils/dbRetry';
import { logger } from '../utils/logger';
import { getIncomingQualityBundle, submitIncomingQualityCheck, reviewIncomingQualityCheck } from '../services/incoming-quality.service';

const assertScope = (req: AuthRequest) => {
  if (!canUseOperationalDataScope(req, 'procurement_visible')) throw new AppError('INCOMING_QUALITY_SCOPE_REQUIRED', 403, ErrorCode.FORBIDDEN);
};
const messages: Record<string, string> = {
  INCOMING_QUALITY_SCOPE_REQUIRED: '当前角色未获得来料检验数据范围',
  INCOMING_HISTORY_UNRECONCILED: '历史收货来源未核对，不能猜检验依据或绕过 QA 放行',
  PURCHASE_SOURCE_HISTORY_UNRECONCILED: '历史实收应付与检验来源未核对，不能补造凭证',
  INCOMING_QA_INDEPENDENT_REVIEWER_REQUIRED: 'QA 审核必须由检验提交人以外的另一位授权人员完成',
  INCOMING_QA_STALE_REVISION: '已有更新的复检，须审核最新版本，不能沿用旧结论',
  INCOMING_QA_FAILED_INSPECTION: '实测结果不合格，不能放行；可隔离或重新检验',
  INCOMING_QC_KEY_CONFLICT: '原检验请求身份已用于不同测量事实或操作人，不能另造同一回执',
  INCOMING_QUALITY_EVIDENCE_INVALID: '检验记录或审计不一致，须核对原记录，不能放行',
};
function replyError(error: unknown, res: Response) {
  logger.error('来料检验业务请求失败:', error);
  return res.status(error instanceof AppError ? error.statusCode : 500).json({ success: false,
    message: error instanceof AppError ? messages[error.message] || error.message : '来料检验请求失败',
    errorCode: error instanceof AppError ? error.message : 'INCOMING_QUALITY_INTERNAL_ERROR', details: error instanceof AppError ? error.details : undefined });
}
export class ProcurementQualityController {
  async list(req: AuthRequest, res: Response) {
    try {
      assertScope(req);
      const page = Math.max(1, Math.floor(Number(req.query.page) || 1)), pageSize = 50;
      const where = { acceptedQuantity: { gt: 0 }, purchaseOrder: buildOperationalDataScopeWhere(req, 'procurement_visible') };
      const [rows, total] = await Promise.all([prisma.purchaseReceipt.findMany({ where, skip: (page - 1) * pageSize, take: pageSize,
        orderBy: { id: 'desc' }, select: { id: true, receiptNo: true, purchaseOrderId: true, acceptedQuantity: true, unit: true, receivedAt: true,
          supplierBatchNo: true, batchNo: true, batchId: true, purchaseOrder: { select: { item: true } } } }), prisma.purchaseReceipt.count({ where })]);
      // This is a selection index, not a QA pass assertion. The detail command
      // verifies receipt/source/inspection/review audits before showing results.
      return res.json({ success: true, data: rows.map(row => ({ id: row.id, receiptNo: row.receiptNo, purchaseOrderId: row.purchaseOrderId,
        productName: row.purchaseOrder.item, acceptedQuantity: row.acceptedQuantity, unit: row.unit, receivedAt: row.receivedAt,
        supplierBatchNo: row.supplierBatchNo, batchNo: row.batchNo, historyUnreconciled: !row.batchId || !row.supplierBatchNo })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
    } catch (error) { return replyError(error, res); }
  }
  async get(req: AuthRequest, res: Response) {
    try {
      assertScope(req);
      const data = await withDbRetry(() => prisma.$transaction(tx => getIncomingQualityBundle(tx, Number(req.params.id))), { label: 'readIncomingQuality' });
      return res.json({ success: true, data });
    } catch (error) { return replyError(error, res); }
  }
  async submit(req: AuthRequest, res: Response) {
    try {
      assertScope(req);
      const command = () => withDbRetry(() => prisma.$transaction(tx => submitIncomingQualityCheck(tx, Number(req.params.id), req.body,
        req.user!.userId, req.get('Idempotency-Key'))), { label: 'submitIncomingQuality' });
      let result;
      try { result = await command(); }
      catch (error) {
        // A uniqueness race ends its PostgreSQL transaction first. Retry the
        // SAME identity once; the winner's immutable ACK is read by the service.
        if ((error as { code?: string }).code !== 'P2002') throw error;
        result = await command();
      }
      return res.status(201).json({ success: true, data: { submission: result.submission, replayed: result.replayed } });
    } catch (error) { return replyError(error, res); }
  }
  async review(req: AuthRequest, res: Response) {
    try {
      assertScope(req);
      const result = await withDbRetry(() => prisma.$transaction(tx => reviewIncomingQualityCheck(tx, Number(req.params.id), req.body,
        req.user!.userId)), { label: 'reviewIncomingQuality' });
      return res.json({ success: true, data: { review: result.review, replayed: result.replayed } });
    } catch (error) { return replyError(error, res); }
  }
}
