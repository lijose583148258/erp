import { Prisma } from '@prisma/client';
import { z, ZodError } from 'zod';
import type { Response } from 'express';
import prisma from '../config/database';
import type { AuthRequest } from '../middleware/auth';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { canUseOperationalDataScope } from '../utils/recordAccess';
import { logger } from '../utils/logger';
import { withDbRetry } from '../utils/dbRetry';
import { registerDraft, verifySupplierPayment, cancelSupplierPayment, getSupplierPaymentBundle } from '../services/supplier-payment.service';
import { requireReceiptPayableSource } from '../domain/purchase-payable';
import { registerSupplierPaymentSchema, cancelSupplierPaymentSchema } from '../validators/supplier-payment';

const pageSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).strict();
const options = { maxWait: 10000, timeout: 20000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable };
const reconciliations = new Set(['INCOMING_QUALITY_EVIDENCE_INVALID', 'PURCHASE_SOURCE_HISTORY_UNRECONCILED', 'PURCHASE_PAYABLE_RECONCILIATION_REQUIRED',
  'PURCHASE_RECEIPT_SUBMISSION_INVALID', 'SUPPLIER_PAYMENT_HISTORY_UNRECONCILED', 'PURCHASE_INDEPENDENT_APPROVAL_REQUIRED',
  'PURCHASE_GOVERNANCE_SOURCE_REQUIRED', 'PURCHASE_GOVERNANCE_SOURCE_INVALID', 'PURCHASE_GOVERNANCE_SOURCE_CHANGED', 'PURCHASE_SOURCE_CONFIRMATION_REQUIRED']);
const messages: Record<string, string> = {
  SUPPLIER_PAYMENT_SCOPE_DENIED: '供应商应付与付款须同时获得财务、采购数据范围',
  SUPPLIER_PAYMENT_INPUT_INVALID: '付款输入格式不正确，请核对实际凭据',
  SUPPLIER_PAYMENT_KEY_REQUIRED: '缺少稳定付款请求身份，请恢复原提案后确认',
  SUPPLIER_PAYMENT_KEY_CONFLICT: '原请求已用于不同操作人或事实，不能覆盖原付款提案',
  SUPPLIER_PAYMENT_BANK_TRANSACTION_DUPLICATE: '该账户及外部流水已有活动付款记录，请核对原记录',
  SUPPLIER_PAYMENT_IDENTITY_CONFLICT: '付款身份发生冲突，请保留原请求并核对记录',
  SUPPLIER_PAYMENT_DRAFT_PENDING: '该收货已有待核验提案，请先核验或由本人取消原提案',
  SUPPLIER_PAYMENT_EXCEEDS_PAYABLE: '付款金额超过该收货原币未付余额',
  SUPPLIER_PAYMENT_CURRENCY_MISMATCH: '付款币种必须与原收货应付币种一致',
  SUPPLIER_PAYMENT_SELF_VERIFY_FORBIDDEN: '付款登记人与核验人必须不同',
  SUPPLIER_PAYMENT_CANCEL_SCOPE_DENIED: '只能取消本人未核验付款提案',
  SUPPLIER_PAYMENT_VERIFIED_CANNOT_CANCEL: '已核验付款是历史事实，不能按提案取消或冒充退款',
  SUPPLIER_PAYMENT_CANCELLED: '该提案已取消，不能再核验',
  SUPPLIER_PAYMENT_CANCEL_CONFLICT: '原取消回执与本次原因不一致，请核对原决定',
  SUPPLIER_PAYMENT_HISTORY_UNRECONCILED: '付款原始回执、审计或两币余额未核对，不能补零或覆盖旧账',
  PURCHASE_SOURCE_HISTORY_UNRECONCILED: '收货历史来源未核对，应付金额未知，不能自动套用采购金额',
  PURCHASE_PAYABLE_RECONCILIATION_REQUIRED: '收货应付来源未核对，不能自动估算或补零',
  INCOMING_QA_RELEASE_REQUIRED: '最新来料检验尚未独立 QA 放行，付款核验冻结',
};
function scope(req: AuthRequest) {
  if (!req.user || !canUseOperationalDataScope(req, 'finance_visible') || !canUseOperationalDataScope(req, 'procurement_visible')) {
    throw new AppError('SUPPLIER_PAYMENT_SCOPE_DENIED', 403, ErrorCode.FORBIDDEN);
  }
}
function identity(value: unknown) { const id = Number(value); if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('SUPPLIER_PAYMENT_INPUT_INVALID', 400, ErrorCode.VALIDATION_ERROR); return id; }
function failure(res: Response, error: unknown) {
  if (error instanceof ZodError) return res.status(400).json({ success: false, errorCode: 'SUPPLIER_PAYMENT_INPUT_INVALID', message: messages.SUPPLIER_PAYMENT_INPUT_INVALID });
  if (error instanceof AppError) return res.status(error.statusCode).json({ success: false, errorCode: error.message,
    message: messages[error.message] || '供应商应付操作未通过业务校验，请核对原收货及审计', details: error.details });
  logger.error('Supplier receipt payable/payment operation failed', error);
  return res.status(500).json({ success: false, errorCode: 'SUPPLIER_PAYMENT_INTERNAL_ERROR', message: '供应商应付操作暂未确认，请保留原请求身份后重试核对' });
}
// Retry a uniqueness loser only AFTER its entire transaction has rolled back.
// The same command/key either reads its owner or rejects another bank intent.
async function command<T>(label: string, action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const run = () => withDbRetry(() => prisma.$transaction(action, options), { label });
  try { return await run(); }
  catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    try { return await run(); }
    catch (again) {
      if ((again as { code?: string }).code === 'P2002') throw new AppError('SUPPLIER_PAYMENT_IDENTITY_CONFLICT', 409, ErrorCode.CONFLICT);
      throw again;
    }
  }
}
export class SupplierPaymentController {
  getPayables = async (req: AuthRequest, res: Response) => {
    try {
      scope(req); const { page, pageSize } = pageSchema.parse(req.query);
      const data = await command('readSupplierPayableCandidates', async tx => {
        const [rows, total] = await Promise.all([tx.purchaseReceipt.findMany({ skip: (page - 1) * pageSize, take: pageSize,
          orderBy: { id: 'desc' }, include: { purchaseOrder: { include: { supplier: true } } } }), tx.purchaseReceipt.count()]);
        const items = [];
        for (const row of rows) {
          const common = { purchaseReceiptId: row.id, receiptNo: row.receiptNo, purchaseOrderId: row.purchaseOrderId,
            supplierId: row.purchaseOrder.supplierId, supplierName: row.purchaseOrder.supplier.name,
            supplierBatchNo: row.supplierBatchNo, batchNo: row.batchNo, receivedQuantity: row.acceptedQuantity, unit: row.unit,
            receivedAt: row.receivedAt.toISOString() };
          try {
            const bundle = await getSupplierPaymentBundle(tx, row.id), payable = requireReceiptPayableSource(row);
            const supplier = payable.binding.supplierId === row.purchaseOrder.supplierId ? row.purchaseOrder.supplier
              : await tx.supplier.findUnique({ where: { id: payable.binding.supplierId } });
            items.push({ ...common, supplierId: payable.binding.supplierId, supplierName: supplier?.name || `供应商 #${payable.binding.supplierId}`,
              state: 'reconciled' as const, reason: null, ...bundle });
          } catch (error) {
            if (!(error instanceof AppError) || error.statusCode !== 409 || !reconciliations.has(error.message)) throw error;
            items.push({ ...common, state: 'history_unreconciled' as const, reason: error.message, currency: null,
              payableAmountNative: null, payableAmountBase: null, paidAmountNative: null, paidAmountBase: null,
              outstandingAmountNative: null, outstandingAmountBase: null, payments: null,
              paymentEligibility: { eligible: false, reason: error.message } });
          }
        }
        return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize), scope: 'supplier_receipt_ap_and_verified_external_payment_registration' };
      });
      return res.json({ success: true, data });
    } catch (error) { return failure(res, error); }
  };
  getPayments = async (req: AuthRequest, res: Response) => {
    try { scope(req); const id = identity(req.params.id); const data = await command('readSupplierPayments', tx => getSupplierPaymentBundle(tx, id));
      return res.json({ success: true, data }); } catch (error) { return failure(res, error); }
  };
  register = async (req: AuthRequest, res: Response) => {
    try { scope(req); const id = identity(req.params.id), input = registerSupplierPaymentSchema.parse(req.body), key = req.get('Idempotency-Key');
      const data = await command('registerSupplierPayment', tx => registerDraft(tx, id, input, req.user!.userId, key));
      return res.status(201).json({ success: true, data }); } catch (error) { return failure(res, error); }
  };
  verify = async (req: AuthRequest, res: Response) => {
    try { scope(req); const id = identity(req.params.id); z.object({}).strict().parse(req.body || {});
      const data = await command('verifySupplierPayment', tx => verifySupplierPayment(tx, id, req.user!.userId));
      return res.json({ success: true, data }); } catch (error) { return failure(res, error); }
  };
  cancel = async (req: AuthRequest, res: Response) => {
    try { scope(req); const id = identity(req.params.id), input = cancelSupplierPaymentSchema.parse(req.body);
      const data = await command('cancelSupplierPayment', tx => cancelSupplierPayment(tx, id, req.user!.userId, input.reason));
      return res.json({ success: true, data }); } catch (error) { return failure(res, error); }
  };
}
