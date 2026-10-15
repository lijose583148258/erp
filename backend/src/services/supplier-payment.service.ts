import { Prisma } from '@prisma/client';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { payableMoney, requireReceiptPayableSource, type PurchaseReceiptPayableSnapshot } from '../domain/purchase-payable';
import { supplierPaymentFacts, supplierPaymentFingerprint, supplierPaymentHash, supplierPaymentStateInvalid,
  supplierPaymentImmutable, parseSupplierPaymentSubmission, readSupplierPaymentSubmission, readSupplierPaymentDecision,
  supplierPaymentSubmissionAudit, supplierPaymentDecisionAudit, requireSupplierPaymentKey,
  supplierPaymentSubmissionSchema, supplierPaymentVerificationSchema, supplierPaymentCancellationSchema,
  type SupplierPaymentSubmission, type SupplierPaymentVerification, type SupplierPaymentCancellation, type StoredSupplierPayment } from '../domain/supplier-payment';
import { cancelSupplierPaymentSchema } from '../validators/supplier-payment';
import { executeRawCompat } from '../utils/raw-sql-compat';
import { buildBusinessNo } from '../utils/businessNo';
import { requireCommittedPurchaseReceipt } from './purchase-receipt-evidence.service';
import { resolveReceiptApprovedSources } from './procurement-source-confirmation.service';
import { assertLatestIncomingQualityRelease, assertHistoricalIncomingQualityRelease } from './incoming-quality.service';
import type { TransactionClient } from './stock-movement.types';

const fail = (code: string, status = 409): never => { throw new AppError(code, status, status === 404 ? ErrorCode.NOT_FOUND : status === 403 ? ErrorCode.FORBIDDEN : ErrorCode.CONFLICT); };
const actor = (value: number) => { if (!Number.isSafeInteger(value) || value <= 0) fail('SUPPLIER_PAYMENT_ACTOR_REQUIRED', 403); };
const stored = (row: unknown) => row as StoredSupplierPayment;
type Receipt = Prisma.PurchaseReceiptGetPayload<Record<string, never>>;
async function readReceipt(tx: TransactionClient, receiptId: number) {
  if (!Number.isSafeInteger(receiptId) || receiptId <= 0) fail('PURCHASE_RECEIPT_NOT_FOUND', 404);
  const receipt = await tx.purchaseReceipt.findUnique({ where: { id: receiptId } });
  if (!receipt) return fail('PURCHASE_RECEIPT_NOT_FOUND', 404);
  await requireCommittedPurchaseReceipt(tx, receipt as unknown as Parameters<typeof requireCommittedPurchaseReceipt>[1]);
  await resolveReceiptApprovedSources(tx, receipt);
  return { receipt, payable: requireReceiptPayableSource(receipt) };
}
async function lockReceiptOrder(tx: TransactionClient, receipt: Receipt) {
  if (await executeRawCompat(tx, 'UPDATE purchase_orders SET id=id WHERE id=?', receipt.purchaseOrderId) !== 1) fail('PURCHASE_ORDER_NOT_FOUND', 404);
}
function dto(row: StoredSupplierPayment, submission: SupplierPaymentSubmission, decision?: SupplierPaymentVerification | SupplierPaymentCancellation) {
  return { ...submission.payment, status: row.status, verifiedByUserId: row.verifiedByUserId,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null, submission,
    verification: decision?.schema === 'supplier-payment-verification/v1' ? decision : null,
    cancellation: decision?.schema === 'supplier-payment-cancellation/v1' ? decision : null };
}
async function readPayment(tx: TransactionClient, row: StoredSupplierPayment, receipt: Receipt) {
  const initial = parseSupplierPaymentSubmission(row), audit = await tx.auditLog.findUnique({ where: { id: initial.auditId } });
  const submission = readSupplierPaymentSubmission(row, audit);
  if (submission.allocationBasis.payableSnapshotJson !== receipt.payableSnapshotJson
    || submission.allocationBasis.receiptSubmissionHash !== supplierPaymentHash(receipt.submissionJson)
    || row.purchaseReceiptId !== receipt.id) throw supplierPaymentStateInvalid();
  const payable = requireReceiptPayableSource(receipt);
  if (row.currency !== payable.currency || !baseAllocation(payable, payableMoney(row.amountNative),
    payableMoney(submission.allocationBasis.paidAmountNativeBefore), payableMoney(submission.allocationBasis.paidAmountBaseBefore)).equals(payableMoney(row.baseAmount))) throw supplierPaymentStateInvalid();
  let decision: SupplierPaymentVerification | SupplierPaymentCancellation | undefined;
  if (row.status !== 'draft') {
    let auditId: unknown;
    try { auditId = JSON.parse(row.verificationJson || '').auditId; } catch { throw supplierPaymentStateInvalid(); }
    if (!Number.isSafeInteger(auditId) || Number(auditId) <= 0) throw supplierPaymentStateInvalid();
    decision = readSupplierPaymentDecision(row, submission, await tx.auditLog.findUnique({ where: { id: Number(auditId) } }));
    if (decision.schema === 'supplier-payment-verification/v1') {
      const release = await assertHistoricalIncomingQualityRelease(tx, decision.qualityCheckId, receipt.id);
      if (release.inspection.revision !== decision.qualityRevision || release.inspection.reviewedByUserId !== decision.qualityReviewerUserId) {
        throw supplierPaymentStateInvalid();
      }
    }
  } else if (row.verifiedByUserId !== null || row.verifiedAt !== null || row.verificationJson !== null) throw supplierPaymentStateInvalid();
  return { submission, decision, payment: dto(row, submission, decision) };
}
function baseAllocation(payable: PurchaseReceiptPayableSnapshot, amount: Prisma.Decimal, nativeBefore: Prisma.Decimal, baseBefore: Prisma.Decimal) {
  const nativeTotal = payableMoney(payable.allocation.amountNative), baseTotal = payableMoney(payable.allocation.amountBase);
  const nativeAfter = nativeBefore.plus(amount);
  if (nativeTotal.isZero() || nativeAfter.greaterThan(nativeTotal)) fail('SUPPLIER_PAYMENT_EXCEEDS_PAYABLE');
  const base = baseTotal.times(nativeAfter).dividedBy(nativeTotal).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).minus(baseBefore);
  if (base.isNegative() || baseBefore.plus(base).greaterThan(baseTotal)) throw supplierPaymentStateInvalid();
  return base;
}
async function history(tx: TransactionClient, receipt: Receipt, payable: PurchaseReceiptPayableSnapshot) {
  const rows = await tx.supplierPayment.findMany({ where: { purchaseReceiptId: receipt.id }, orderBy: { id: 'asc' } });
  let native = new Prisma.Decimal(0), base = new Prisma.Decimal(0), drafts = 0;
  const payments = [];
  for (const raw of rows) {
    const row = stored(raw), read = await readPayment(tx, row, receipt);
    if (row.currency !== payable.currency) throw supplierPaymentStateInvalid();
    if (row.status === 'draft') drafts++;
    if (read.decision?.schema === 'supplier-payment-verification/v1') {
      const decision = read.decision;
      if (!native.equals(decision.paidAmountNativeBefore) || !base.equals(decision.paidAmountBaseBefore)
        || !native.equals(read.submission.allocationBasis.paidAmountNativeBefore) || !base.equals(read.submission.allocationBasis.paidAmountBaseBefore)
        || !baseAllocation(payable, payableMoney(row.amountNative), native, base).equals(payableMoney(row.baseAmount))) throw supplierPaymentStateInvalid();
      native = native.plus(payableMoney(row.amountNative)); base = base.plus(payableMoney(row.baseAmount));
    }
    payments.push(read.payment);
  }
  if (drafts > 1 || native.greaterThan(payable.allocation.amountNative) || base.greaterThan(payable.allocation.amountBase)) throw supplierPaymentStateInvalid();
  return { native, base, drafts, payments };
}
export async function getSupplierPaymentBundle(tx: TransactionClient, receiptId: number) {
  const { receipt, payable } = await readReceipt(tx, receiptId), h = await history(tx, receipt, payable);
  let paymentEligibility: { eligible: boolean; reason: string | null } = { eligible: true, reason: null };
  const frozenReasons = new Set(['INCOMING_HISTORY_UNRECONCILED', 'INCOMING_RECEIPT_BATCH_IDENTITY_REQUIRED', 'INCOMING_QUALITY_EVIDENCE_INVALID',
    'INCOMING_QA_RELEASE_REQUIRED', 'PURCHASE_SOURCE_HISTORY_UNRECONCILED', 'PURCHASE_INDEPENDENT_APPROVAL_REQUIRED',
    'PURCHASE_GOVERNANCE_SOURCE_REQUIRED', 'PURCHASE_GOVERNANCE_SOURCE_INVALID', 'PURCHASE_GOVERNANCE_SOURCE_CHANGED',
    'PURCHASE_RECEIPT_SUBMISSION_INVALID', 'PURCHASE_PAYABLE_RECONCILIATION_REQUIRED']);
  if (!receipt.batchId) paymentEligibility = { eligible: false, reason: 'INCOMING_HISTORY_UNRECONCILED' };
  else try {
    const released = await assertLatestIncomingQualityRelease(tx, receipt.batchId);
    if (released.receipt.id !== receipt.id) throw supplierPaymentStateInvalid();
  } catch (error) {
    if (!(error instanceof AppError) || error.statusCode !== 409 || !frozenReasons.has(error.message)) throw error;
    paymentEligibility = { eligible: false, reason: error.message };
  }
  return { purchaseReceiptId: receipt.id, currency: payable.currency, payableAmountNative: payable.allocation.amountNative,
    payableAmountBase: payable.allocation.amountBase, paidAmountNative: h.native.toFixed(2), paidAmountBase: h.base.toFixed(2),
    outstandingAmountNative: payableMoney(payable.allocation.amountNative).minus(h.native).toFixed(2),
    outstandingAmountBase: payableMoney(payable.allocation.amountBase).minus(h.base).toFixed(2), paymentEligibility, payments: h.payments };
}
export async function registerDraft(tx: TransactionClient, receiptId: number, input: unknown, userId: number, rawKey: unknown) {
  actor(userId); const key = requireSupplierPaymentKey(rawKey), facts = supplierPaymentFacts(receiptId, userId, input), fingerprint = supplierPaymentFingerprint(facts);
  const replay = async (row: StoredSupplierPayment, receipt: Receipt) => {
    if (row.submittedByUserId !== userId || row.fingerprint !== fingerprint) fail('SUPPLIER_PAYMENT_KEY_CONFLICT');
    return { ...await readPayment(tx, row, receipt), replayed: true };
  };
  const existing = await tx.supplierPayment.findFirst({ where: { purchaseReceiptId: receiptId, requestKey: key } });
  let context = await readReceipt(tx, receiptId);
  if (existing) return replay(stored(existing), context.receipt);
  await lockReceiptOrder(tx, context.receipt);
  context = await readReceipt(tx, receiptId);
  const raced = await tx.supplierPayment.findFirst({ where: { purchaseReceiptId: receiptId, requestKey: key } });
  if (raced) return replay(stored(raced), context.receipt);
  const { receipt, payable } = context;
  if (facts.currency !== payable.currency) fail('SUPPLIER_PAYMENT_CURRENCY_MISMATCH');
  const duplicate = await tx.supplierPayment.findFirst({ where: { paymentAccountRef: facts.paymentAccountRef,
    externalTransactionRef: facts.externalTransactionRef, status: { not: 'cancelled' } } });
  if (duplicate) fail('SUPPLIER_PAYMENT_BANK_TRANSACTION_DUPLICATE');
  const h = await history(tx, receipt, payable);
  if (h.drafts) fail('SUPPLIER_PAYMENT_DRAFT_PENDING');
  const baseAmount = baseAllocation(payable, payableMoney(facts.amountNative), h.native, h.base);
  const raw = await tx.supplierPayment.create({ data: { paymentNo: buildBusinessNo('SP'), purchaseReceiptId: receiptId,
    amountNative: facts.amountNative, currency: facts.currency, baseAmount, status: 'draft', requestKey: key, fingerprint, submissionJson: '',
    method: facts.method, date: new Date(facts.date), paymentAccountRef: facts.paymentAccountRef, externalTransactionRef: facts.externalTransactionRef,
    evidenceRef: facts.evidenceRef, note: facts.note, submittedByUserId: userId } });
  const payment = supplierPaymentImmutable(stored(raw)), allocationBasis = { payableSnapshotJson: receipt.payableSnapshotJson!,
    receiptSubmissionHash: supplierPaymentHash(receipt.submissionJson), paidAmountNativeBefore: h.native.toFixed(2), paidAmountBaseBefore: h.base.toFixed(2) };
  const partial = { key, fingerprint, payment, allocationBasis };
  const audit = await tx.auditLog.create({ data: { userId, action: 'SUPPLIER_PAYMENT_DRAFTED', resource: 'supplier_payment', resourceId: raw.id,
    details: JSON.stringify(supplierPaymentSubmissionAudit(partial)) } });
  const submission = supplierPaymentSubmissionSchema.parse({ schema: 'supplier-payment-submission/v1', ...partial, auditId: audit.id, status: 'draft' });
  const saved = await tx.supplierPayment.update({ where: { id: raw.id }, data: { submissionJson: JSON.stringify(submission) } });
  return { payment: dto(stored(saved), submission), submission, replayed: false };
}
export async function verifySupplierPayment(tx: TransactionClient, paymentId: number, actorId: number) {
  actor(actorId); let row = await tx.supplierPayment.findUnique({ where: { id: paymentId } });
  if (!row) return fail('SUPPLIER_PAYMENT_NOT_FOUND', 404);
  if (row.submittedByUserId === actorId) fail('SUPPLIER_PAYMENT_SELF_VERIFY_FORBIDDEN', 403);
  let context = await readReceipt(tx, row.purchaseReceiptId);
  if (row.status === 'verified') {
    const read = await readPayment(tx, stored(row), context.receipt);
    return { ...read, verification: read.decision as SupplierPaymentVerification, replayed: true };
  }
  if (row.status !== 'draft') fail('SUPPLIER_PAYMENT_CANCELLED');
  await lockReceiptOrder(tx, context.receipt);
  row = await tx.supplierPayment.findUnique({ where: { id: paymentId } });
  if (!row) return fail('SUPPLIER_PAYMENT_NOT_FOUND', 404);
  context = await readReceipt(tx, row.purchaseReceiptId);
  const read = await readPayment(tx, stored(row), context.receipt);
  if (row.status === 'verified') return { ...read, verification: read.decision as SupplierPaymentVerification, replayed: true };
  if (row.status !== 'draft') fail('SUPPLIER_PAYMENT_CANCELLED');
  const { receipt, payable } = context;
  const batchId = receipt.batchId;
  if (!batchId) fail('SUPPLIER_PAYMENT_QA_RELEASE_REQUIRED');
  if (await executeRawCompat(tx, 'UPDATE product_batches SET id=id WHERE id=?', batchId) !== 1) fail('SUPPLIER_PAYMENT_QA_RELEASE_REQUIRED');
  const release = await assertLatestIncomingQualityRelease(tx, batchId!);
  if (release.receipt.id !== receipt.id) throw supplierPaymentStateInvalid();
  const h = await history(tx, receipt, payable), amount = payableMoney(row.amountNative), base = baseAllocation(payable, amount, h.native, h.base);
  if (h.drafts !== 1 || !h.native.equals(read.submission.allocationBasis.paidAmountNativeBefore)
    || !h.base.equals(read.submission.allocationBasis.paidAmountBaseBefore) || !base.equals(payableMoney(row.baseAmount))) throw supplierPaymentStateInvalid();
  const verifiedAt = new Date(Math.max(Date.now(), row.createdAt.getTime() + 1));
  const partial = { schema: 'supplier-payment-verification/v1' as const, paymentId: row.id, purchaseReceiptId: receipt.id,
    amountNative: amount.toFixed(2), baseAmount: base.toFixed(2), currency: row.currency, submittedByUserId: row.submittedByUserId,
    verifiedByUserId: actorId, verifiedAt: verifiedAt.toISOString(), draftAuditId: read.submission.auditId,
    qualityCheckId: release.inspection.id, qualityRevision: release.inspection.revision, qualityReviewerUserId: release.inspection.reviewedByUserId!,
    paidAmountNativeBefore: h.native.toFixed(2), paidAmountBaseBefore: h.base.toFixed(2),
    paidAmountNativeAfter: h.native.plus(amount).toFixed(2), paidAmountBaseAfter: h.base.plus(base).toFixed(2) };
  supplierPaymentVerificationSchema.omit({ auditId: true }).parse(partial);
  const audit = await tx.auditLog.create({ data: { userId: actorId, action: 'SUPPLIER_PAYMENT_VERIFIED', resource: 'supplier_payment', resourceId: row.id,
    details: JSON.stringify(supplierPaymentDecisionAudit(partial)) } });
  const verification = supplierPaymentVerificationSchema.parse({ ...partial, auditId: audit.id });
  const claimed = await tx.supplierPayment.updateMany({ where: { id: row.id, status: 'draft' }, data: { status: 'verified',
    verifiedByUserId: actorId, verifiedAt, verificationJson: JSON.stringify(verification) } });
  if (claimed.count !== 1) fail('SUPPLIER_PAYMENT_STATE_CHANGED');
  return { payment: dto(stored({ ...row, status: 'verified', verifiedByUserId: actorId, verifiedAt }), read.submission, verification), verification, replayed: false };
}
export const verify = verifySupplierPayment;
export async function cancelSupplierPayment(tx: TransactionClient, paymentId: number, actorId: number, rawReason: string) {
  actor(actorId); const { reason } = cancelSupplierPaymentSchema.parse({ reason: rawReason });
  let row = await tx.supplierPayment.findUnique({ where: { id: paymentId } });
  if (!row) return fail('SUPPLIER_PAYMENT_NOT_FOUND', 404);
  if (row.submittedByUserId !== actorId) fail('SUPPLIER_PAYMENT_CANCEL_SCOPE_DENIED', 403);
  let context = await readReceipt(tx, row.purchaseReceiptId);
  const replay = async () => {
    const read = await readPayment(tx, stored(row), context.receipt);
    if (read.decision?.schema !== 'supplier-payment-cancellation/v1' || read.decision.reason !== reason) fail('SUPPLIER_PAYMENT_CANCEL_CONFLICT');
    return { ...read, cancellation: read.decision, replayed: true };
  };
  if (row.status === 'cancelled') return replay();
  if (row.status !== 'draft') fail('SUPPLIER_PAYMENT_VERIFIED_CANNOT_CANCEL');
  await lockReceiptOrder(tx, context.receipt);
  row = await tx.supplierPayment.findUnique({ where: { id: paymentId } });
  if (!row) return fail('SUPPLIER_PAYMENT_NOT_FOUND', 404);
  context = await readReceipt(tx, row.purchaseReceiptId);
  if (row.status === 'cancelled') return replay();
  if (row.status !== 'draft') fail('SUPPLIER_PAYMENT_VERIFIED_CANNOT_CANCEL');
  const read = await readPayment(tx, stored(row), context.receipt), cancelledAt = new Date(Math.max(Date.now(), row.createdAt.getTime() + 1));
  const partial = { schema: 'supplier-payment-cancellation/v1' as const, paymentId: row.id, purchaseReceiptId: row.purchaseReceiptId,
    cancelledByUserId: actorId, cancelledAt: cancelledAt.toISOString(), reason, draftAuditId: read.submission.auditId };
  supplierPaymentCancellationSchema.omit({ auditId: true }).parse(partial);
  const audit = await tx.auditLog.create({ data: { userId: actorId, action: 'SUPPLIER_PAYMENT_CANCELLED', resource: 'supplier_payment', resourceId: row.id,
    details: JSON.stringify(supplierPaymentDecisionAudit(partial)) } });
  const cancellation = supplierPaymentCancellationSchema.parse({ ...partial, auditId: audit.id });
  const claimed = await tx.supplierPayment.updateMany({ where: { id: row.id, status: 'draft' }, data: { status: 'cancelled', verificationJson: JSON.stringify(cancellation) } });
  if (claimed.count !== 1) fail('SUPPLIER_PAYMENT_STATE_CHANGED');
  return { payment: dto(stored({ ...row, status: 'cancelled' }), read.submission, cancellation), cancellation, replayed: false };
}
