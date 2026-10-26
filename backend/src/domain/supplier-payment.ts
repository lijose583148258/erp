import { createHash } from 'crypto';
import { z } from 'zod';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { payableMoney } from './purchase-payable';
import { purchaseReceiptKeySchema } from './purchase-receipt-submission';
import { registerSupplierPaymentSchema } from '../validators/supplier-payment';

const id = z.number().int().positive().refine(Number.isSafeInteger);
const money = z.string().regex(/^\d+\.\d{2}$/).refine(value => { try { payableMoney(value); return true; } catch { return false; } });
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const supplierPaymentHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const supplierPaymentKeyHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const supplierPaymentStateInvalid = () => new AppError('SUPPLIER_PAYMENT_HISTORY_UNRECONCILED', 409, ErrorCode.CONFLICT);
export function requireSupplierPaymentKey(value: unknown) {
  const parsed = purchaseReceiptKeySchema.safeParse(value);
  if (!parsed.success) throw new AppError('SUPPLIER_PAYMENT_KEY_REQUIRED', 400, ErrorCode.VALIDATION_ERROR);
  return parsed.data;
}
export function supplierPaymentFacts(receiptId: number, actorId: number, raw: unknown) {
  const input = registerSupplierPaymentSchema.parse(raw);
  if (!id.safeParse(receiptId).success || !id.safeParse(actorId).success) throw supplierPaymentStateInvalid();
  return { purchaseReceiptId: receiptId, submittedByUserId: actorId, amountNative: payableMoney(input.amountNative).toFixed(2), currency: input.currency,
    method: input.method, date: `${input.date}T00:00:00.000Z`, paymentAccountRef: input.paymentAccountRef,
    externalTransactionRef: input.externalTransactionRef, evidenceRef: input.evidenceRef, note: input.note || null };
}
export const supplierPaymentFingerprint = (facts: ReturnType<typeof supplierPaymentFacts>) => supplierPaymentHash({ schema: 'supplier-payment-facts/v1', ...facts });
const paymentSchema = z.object({ id, paymentNo: z.string().min(1), purchaseReceiptId: id, amountNative: money, currency: z.string().regex(/^[A-Z]{3}$/),
  baseAmount: money, method: registerSupplierPaymentSchema.shape.method, date: z.string().datetime(), paymentAccountRef: z.string().min(1), externalTransactionRef: z.string().min(1),
  evidenceRef: z.string().min(3), note: z.string().nullable(), submittedByUserId: id, createdAt: z.string().datetime() }).strict();
export const supplierPaymentSubmissionSchema = z.object({ schema: z.literal('supplier-payment-submission/v1'), key: purchaseReceiptKeySchema,
  fingerprint: digest, auditId: id, status: z.literal('draft'), payment: paymentSchema,
  allocationBasis: z.object({ payableSnapshotJson: z.string().min(1), receiptSubmissionHash: digest,
    paidAmountNativeBefore: money, paidAmountBaseBefore: money }).strict() }).strict();
export type SupplierPaymentSubmission = z.infer<typeof supplierPaymentSubmissionSchema>;
export const supplierPaymentVerificationSchema = z.object({ schema: z.literal('supplier-payment-verification/v1'), paymentId: id, purchaseReceiptId: id,
  amountNative: money, baseAmount: money, currency: z.string().regex(/^[A-Z]{3}$/), submittedByUserId: id,
  verifiedByUserId: id, verifiedAt: z.string().datetime(), auditId: id, draftAuditId: id,
  qualityCheckId: id, qualityRevision: id, qualityReviewerUserId: id,
  paidAmountNativeBefore: money, paidAmountBaseBefore: money, paidAmountNativeAfter: money, paidAmountBaseAfter: money,
}).strict();
export type SupplierPaymentVerification = z.infer<typeof supplierPaymentVerificationSchema>;
export const supplierPaymentCancellationSchema = z.object({ schema: z.literal('supplier-payment-cancellation/v1'), paymentId: id, purchaseReceiptId: id,
  cancelledByUserId: id, cancelledAt: z.string().datetime(), reason: z.string().min(3).max(1000), draftAuditId: id, auditId: id }).strict();
export type SupplierPaymentCancellation = z.infer<typeof supplierPaymentCancellationSchema>;
type Audit = { id: number; userId: number; action: string; resource: string; resourceId: number | null; details: string | null };
export interface StoredSupplierPayment extends Record<string, unknown> {
  id: number; paymentNo: string; purchaseReceiptId: number; amountNative: unknown; currency: string; baseAmount: unknown;
  status: string; requestKey: string; fingerprint: string; submissionJson: string; method: string; date: Date;
  paymentAccountRef: string; externalTransactionRef: string; evidenceRef: string; note: string | null; submittedByUserId: number; createdAt: Date;
  verifiedByUserId: number | null; verifiedAt: Date | null; verificationJson: string | null;
}
const iso = (value: unknown) => { const d = value instanceof Date ? value : new Date(String(value)); if (!Number.isFinite(d.getTime())) throw supplierPaymentStateInvalid(); return d.toISOString(); };
export function supplierPaymentImmutable(row: StoredSupplierPayment) {
  const parsed = paymentSchema.safeParse({ id: row.id, paymentNo: row.paymentNo, purchaseReceiptId: row.purchaseReceiptId,
    amountNative: payableMoney(row.amountNative).toFixed(2), currency: row.currency, baseAmount: payableMoney(row.baseAmount).toFixed(2),
    method: row.method, date: iso(row.date), paymentAccountRef: row.paymentAccountRef, externalTransactionRef: row.externalTransactionRef,
    evidenceRef: row.evidenceRef, note: row.note, submittedByUserId: row.submittedByUserId, createdAt: iso(row.createdAt) });
  if (!parsed.success || payableMoney(parsed.data.amountNative).isZero()) throw supplierPaymentStateInvalid();
  return parsed.data;
}
export function parseSupplierPaymentSubmission(row: StoredSupplierPayment): SupplierPaymentSubmission {
  let parsed: unknown; try { parsed = JSON.parse(row.submissionJson); } catch { throw supplierPaymentStateInvalid(); }
  const result = supplierPaymentSubmissionSchema.safeParse(parsed);
  if (!result.success) throw supplierPaymentStateInvalid(); return result.data;
}
export function supplierPaymentSubmissionAudit(ack: Pick<SupplierPaymentSubmission, 'key' | 'fingerprint' | 'payment' | 'allocationBasis'>) {
  return { schema: 'supplier-payment-submit-audit/v1', paymentId: ack.payment.id, purchaseReceiptId: ack.payment.purchaseReceiptId,
    submissionKeyHash: supplierPaymentKeyHash(ack.key), fingerprint: ack.fingerprint,
    paymentHash: supplierPaymentHash(ack.payment), allocationHash: supplierPaymentHash(ack.allocationBasis) };
}
export function readSupplierPaymentSubmission(row: StoredSupplierPayment, audit: Audit | null) {
  const ack = parseSupplierPaymentSubmission(row), immutable = supplierPaymentImmutable(row);
  const facts = { purchaseReceiptId: immutable.purchaseReceiptId, submittedByUserId: immutable.submittedByUserId,
    amountNative: immutable.amountNative, currency: immutable.currency, method: immutable.method, date: immutable.date,
    paymentAccountRef: immutable.paymentAccountRef, externalTransactionRef: immutable.externalTransactionRef, evidenceRef: immutable.evidenceRef, note: immutable.note };
  if (!['draft', 'verified', 'cancelled'].includes(row.status) || ack.key !== row.requestKey || ack.fingerprint !== row.fingerprint
    || ack.fingerprint !== supplierPaymentFingerprint(facts) || JSON.stringify(ack.payment) !== JSON.stringify(immutable)
    || !audit || audit.id !== ack.auditId || audit.userId !== row.submittedByUserId || audit.action !== 'SUPPLIER_PAYMENT_DRAFTED'
    || audit.resource !== 'supplier_payment' || audit.resourceId !== row.id || audit.details !== JSON.stringify(supplierPaymentSubmissionAudit(ack))) throw supplierPaymentStateInvalid();
  return ack;
}
export function supplierPaymentDecisionAudit(ack: (Omit<SupplierPaymentVerification, 'auditId'> | Omit<SupplierPaymentCancellation, 'auditId'>) & { auditId?: number }) {
  const { auditId: _auditId, ...decision } = ack;
  return { schema: 'supplier-payment-decision-audit/v1', paymentId: ack.paymentId, purchaseReceiptId: ack.purchaseReceiptId, decisionHash: supplierPaymentHash(decision) };
}
export function readSupplierPaymentDecision(row: StoredSupplierPayment, submission: SupplierPaymentSubmission, audit: Audit | null) {
  let raw: unknown; try { raw = JSON.parse(row.verificationJson || ''); } catch { throw supplierPaymentStateInvalid(); }
  const verified = row.status === 'verified', result = verified ? supplierPaymentVerificationSchema.safeParse(raw) : supplierPaymentCancellationSchema.safeParse(raw);
  if (!result.success || !['verified', 'cancelled'].includes(row.status)) throw supplierPaymentStateInvalid();
  const ack = result.data, actor = 'verifiedByUserId' in ack ? ack.verifiedByUserId : ack.cancelledByUserId;
  if (ack.paymentId !== row.id || ack.purchaseReceiptId !== row.purchaseReceiptId || ack.draftAuditId !== submission.auditId
    || !audit || audit.id !== ack.auditId || audit.userId !== actor || audit.resource !== 'supplier_payment' || audit.resourceId !== row.id
    || audit.action !== (verified ? 'SUPPLIER_PAYMENT_VERIFIED' : 'SUPPLIER_PAYMENT_CANCELLED')
    || audit.details !== JSON.stringify(supplierPaymentDecisionAudit(ack))) throw supplierPaymentStateInvalid();
  if ('verifiedByUserId' in ack) {
    if (ack.verifiedByUserId === row.submittedByUserId || ack.verifiedByUserId !== row.verifiedByUserId || ack.verifiedAt !== iso(row.verifiedAt)
      || ack.amountNative !== submission.payment.amountNative || ack.baseAmount !== submission.payment.baseAmount || ack.currency !== row.currency
      || ack.submittedByUserId !== row.submittedByUserId
      || !payableMoney(ack.paidAmountNativeBefore).plus(ack.amountNative).equals(ack.paidAmountNativeAfter)
      || !payableMoney(ack.paidAmountBaseBefore).plus(ack.baseAmount).equals(ack.paidAmountBaseAfter)) throw supplierPaymentStateInvalid();
  } else if (ack.cancelledByUserId !== row.submittedByUserId || row.verifiedByUserId !== null || row.verifiedAt !== null) throw supplierPaymentStateInvalid();
  return ack;
}
