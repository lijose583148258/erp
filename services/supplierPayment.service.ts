import { z } from 'zod';
import api, { type ApiRequestOptions } from '../utils/api';
import type { ApiDataResponse } from '../utils/apiMapping';

// Receipt AP and registered external payments only. These DTOs are not bank commands or AR cash entries.
const id = z.number().int().positive().refine(Number.isSafeInteger);
const money = z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/).refine(value => BigInt(value.replace('.', '')) <= BigInt(Number.MAX_SAFE_INTEGER));
const cents = (value: string) => BigInt(value.replace('.', ''));
const currency = z.string().regex(/^[A-Z]{3}$/);
const iso = z.string().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/);
const method = z.enum(['bank_transfer', 'cash', 'alipay', 'wechat', 'check', 'wire_transfer']);
const immutablePayment = z.object({ id, paymentNo: z.string().min(1), purchaseReceiptId: id,
  amountNative: money, currency, baseAmount: money, method, date: iso,
  paymentAccountRef: z.string().min(1).max(200), externalTransactionRef: z.string().min(1).max(200),
  evidenceRef: z.string().min(3).max(500), note: z.string().max(2000).nullable(), submittedByUserId: id, createdAt: iso }).strict();
const submission = z.object({ schema: z.literal('supplier-payment-submission/v1'), key, fingerprint: digest, auditId: id,
  status: z.literal('draft'), payment: immutablePayment,
  allocationBasis: z.object({ payableSnapshotJson: z.string().min(1), receiptSubmissionHash: digest,
    paidAmountNativeBefore: money, paidAmountBaseBefore: money }).strict() }).strict();
const verification = z.object({ schema: z.literal('supplier-payment-verification/v1'), paymentId: id, purchaseReceiptId: id,
  amountNative: money, baseAmount: money, currency, submittedByUserId: id, verifiedByUserId: id, verifiedAt: iso,
  auditId: id, draftAuditId: id, qualityCheckId: id, qualityRevision: id, qualityReviewerUserId: id,
  paidAmountNativeBefore: money, paidAmountBaseBefore: money, paidAmountNativeAfter: money, paidAmountBaseAfter: money }).strict();
const cancellation = z.object({ schema: z.literal('supplier-payment-cancellation/v1'), paymentId: id, purchaseReceiptId: id,
  cancelledByUserId: id, cancelledAt: iso, reason: z.string().min(3).max(1000), draftAuditId: id, auditId: id }).strict();
const payment = immutablePayment.extend({ status: z.enum(['draft', 'verified', 'cancelled']),
  verifiedByUserId: id.nullable(), verifiedAt: iso.nullable(), submission,
  verification: verification.nullable(), cancellation: cancellation.nullable() }).superRefine((row, ctx) => {
  if (!Object.entries(row.submission.payment).every(([name, value]) => row[name as keyof typeof row] === value)
    || (row.status === 'draft' && (row.verification !== null || row.cancellation !== null || row.verifiedByUserId !== null || row.verifiedAt !== null))
    || (row.status === 'verified' && (!row.verification || row.cancellation !== null || row.verifiedByUserId !== row.verification.verifiedByUserId || row.verifiedAt !== row.verification.verifiedAt))
    || (row.status === 'cancelled' && (!row.cancellation || row.verification !== null || row.verifiedByUserId !== null || row.verifiedAt !== null))) {
    ctx.addIssue({ code: 'custom', message: '付款记录与不可变回执不一致' });
  }
  const decision = row.verification || row.cancellation;
  if (decision && (decision.paymentId !== row.id || decision.purchaseReceiptId !== row.purchaseReceiptId
    || decision.draftAuditId !== row.submission.auditId || decision.auditId <= decision.draftAuditId
    || (row.verification && (row.verification.amountNative !== row.amountNative || row.verification.baseAmount !== row.baseAmount
      || row.verification.currency !== row.currency || row.verification.submittedByUserId !== row.submittedByUserId
      || row.verification.verifiedByUserId === row.submittedByUserId
      || cents(row.verification.paidAmountNativeBefore) + cents(row.amountNative) !== cents(row.verification.paidAmountNativeAfter)
      || cents(row.verification.paidAmountBaseBefore) + cents(row.baseAmount) !== cents(row.verification.paidAmountBaseAfter)))
    || (row.cancellation && row.cancellation.cancelledByUserId !== row.submittedByUserId))) {
    ctx.addIssue({ code: 'custom', message: '付款决定不是原凭据的独立核验或本人取消' });
  }
});
const eligibility = z.object({ eligible: z.boolean(), reason: z.string().min(1).nullable() })
  .refine(value => value.eligible ? value.reason === null : value.reason !== null);
const bundleFields = { purchaseReceiptId: id, currency,
  payableAmountNative: money, payableAmountBase: money, paidAmountNative: money, paidAmountBase: money,
  outstandingAmountNative: money, outstandingAmountBase: money, paymentEligibility: eligibility, payments: z.array(payment) };
type BundleDto = z.infer<z.ZodObject<typeof bundleFields>>;
const ledgerConsistent = (row: BundleDto) => {
  const verified = row.payments.filter(item => item.status === 'verified');
  return cents(row.paidAmountNative) + cents(row.outstandingAmountNative) === cents(row.payableAmountNative)
    && cents(row.paidAmountBase) + cents(row.outstandingAmountBase) === cents(row.payableAmountBase)
    && verified.reduce((sum, item) => sum + cents(item.amountNative), 0n) === cents(row.paidAmountNative)
    && verified.reduce((sum, item) => sum + cents(item.baseAmount), 0n) === cents(row.paidAmountBase)
    && row.payments.every(item => item.purchaseReceiptId === row.purchaseReceiptId && item.currency === row.currency)
    && new Set(row.payments.map(item => item.id)).size === row.payments.length
    && new Set(row.payments.map(item => item.submission.key)).size === row.payments.length
    && row.payments.filter(item => item.status === 'draft').length <= 1;
};
const bundle = z.object(bundleFields).refine(ledgerConsistent, '应付、两币余额与已核验原始凭据不一致');
const common = z.object({ purchaseReceiptId: id, receiptNo: z.string().min(1), purchaseOrderId: id,
  supplierId: id, supplierName: z.string().min(1), supplierBatchNo: z.string().nullable(), batchNo: z.string().nullable(),
  receivedQuantity: z.number().finite().nonnegative(), unit: z.string().min(1), receivedAt: iso });
const candidate = z.discriminatedUnion('state', [
  common.extend({ state: z.literal('reconciled'), reason: z.null(), ...bundleFields }).refine(ledgerConsistent, '实收应付与原付款凭据不一致'),
  common.extend({ state: z.literal('history_unreconciled'), reason: z.string().min(1), currency: z.null(),
    payableAmountNative: z.null(), payableAmountBase: z.null(), paidAmountNative: z.null(), paidAmountBase: z.null(),
    outstandingAmountNative: z.null(), outstandingAmountBase: z.null(), payments: z.null(),
    paymentEligibility: eligibility.refine(value => !value.eligible) }),
]);
const page = z.object({ items: z.array(candidate), page: id, pageSize: id.max(50), total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(), scope: z.literal('supplier_receipt_ap_and_verified_external_payment_registration') });
const registerResult = z.object({ payment, submission, replayed: z.boolean() });
const verifyResult = z.object({ payment, verification, replayed: z.boolean() });
const cancelResult = z.object({ payment, cancellation, replayed: z.boolean() });

export type SupplierPaymentMethod = z.infer<typeof method>;
export type SupplierPaymentSubmission = z.infer<typeof submission>;
export type SupplierPaymentVerification = z.infer<typeof verification>;
export type SupplierPaymentCancellation = z.infer<typeof cancellation>;
export type SupplierPaymentRecord = z.infer<typeof payment>;
export type SupplierPaymentBundle = z.infer<typeof bundle>;
export type SupplierPayableCandidate = z.infer<typeof candidate>;
export type SupplierPayablePage = z.infer<typeof page>;
export type RegisterSupplierPaymentInput = { amountNative: number; currency: string; method: SupplierPaymentMethod; date: string;
  paymentAccountRef: string; externalTransactionRef: string; evidenceRef: string; note?: string };
const parse = <T,>(schema: z.ZodType<T>, raw: unknown): T => {
  const result = schema.safeParse(raw);
  if (!result.success) throw Error('应付或付款回执结构不一致，请保留原请求并核对，不能另行登记。');
  return result.data;
};
const receiptPath = (receiptId: number) => `/procurement/receipts/${id.parse(receiptId)}/payments`;
const paymentPath = (paymentId: number) => `/procurement/supplier-payments/${id.parse(paymentId)}`;
export const supplierPaymentService = {
  async getPayables(currentPage = 1, options: ApiRequestOptions = {}): Promise<SupplierPayablePage> {
    const response = await api.get<unknown, ApiDataResponse<unknown>>('/procurement/payables',
      { params: { page: currentPage, pageSize: 20 }, ...options });
    return parse(page, response.data);
  },
  async getPayments(receiptId: number, options: ApiRequestOptions = {}): Promise<SupplierPaymentBundle> {
    const response = await api.get<unknown, ApiDataResponse<unknown>>(receiptPath(receiptId), options);
    const result = parse(bundle, response.data);
    if (result.purchaseReceiptId !== receiptId) throw Error('回读不是原实收应付，请保留原付款请求。');
    return result;
  },
  async register(receiptId: number, input: RegisterSupplierPaymentInput, requestKey: string) {
    const response = await api.post<unknown, ApiDataResponse<unknown>>(receiptPath(receiptId), input,
      { headers: { 'Idempotency-Key': key.parse(requestKey) } });
    return parse(registerResult, response.data);
  },
  async verify(paymentId: number) {
    const response = await api.post<unknown, ApiDataResponse<unknown>>(`${paymentPath(paymentId)}/verify`, {});
    return parse(verifyResult, response.data);
  },
  async cancel(paymentId: number, reason: string) {
    const response = await api.post<unknown, ApiDataResponse<unknown>>(`${paymentPath(paymentId)}/cancel`, { reason });
    return parse(cancelResult, response.data);
  },
};
