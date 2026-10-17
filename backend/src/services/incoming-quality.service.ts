import type { IncomingQualityCheck } from '@prisma/client';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { purchaseReceiptKeySchema } from '../domain/purchase-receipt-submission';
import {
  evaluateIncomingQualityMeasurements, incomingQualityConflict, incomingQualityFingerprint,
  incomingQualityInspectionHash, incomingQualityInspectionSchema, incomingQualityPlanHash,
  incomingQualityRecordedMeasurementSchema, incomingQualityReviewAudit, incomingQualityReviewSchema,
  incomingQualitySubmissionAudit, incomingQualitySubmissionSchema, normalizeIncomingQualityInput,
  readIncomingQualityReview, readIncomingQualitySubmission,
  type IncomingQualityInspection, type IncomingQualityReview,
} from '../domain/incoming-quality';
import { reviewIncomingQualityCheckSchema } from '../validators/purchase-quality';
import { resolveReceiptApprovedSources } from './procurement-source-confirmation.service';
import { requireCommittedPurchaseReceipt } from './purchase-receipt-evidence.service';
import type { TransactionClient } from './stock-movement.types';

const fail = (code: string): never => { throw incomingQualityConflict(code); };
const identity = (id: number, code: string) => {
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(code, 400, ErrorCode.VALIDATION_ERROR);
};
const iso = (date: Date | null) => {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return fail('INCOMING_QUALITY_EVIDENCE_INVALID');
  return date.toISOString();
};

// Only writers take PO -> batch locks. Outbound/finance read-back below never
// locks the PO, preserving the existing stock -> batch order for stock issues.
async function lockReceipt(tx: TransactionClient, receiptId: number) {
  const receipt = await tx.purchaseReceipt.findUnique({ where: { id: receiptId }, select: { purchaseOrderId: true, batchId: true } });
  if (!receipt) throw new AppError('INCOMING_RECEIPT_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
  if (!receipt.batchId) return fail('INCOMING_HISTORY_UNRECONCILED');
  await tx.$executeRaw`UPDATE "purchase_orders" SET "id" = "id" WHERE "id" = ${receipt.purchaseOrderId}`;
  await tx.$executeRaw`UPDATE "product_batches" SET "id" = "id" WHERE "id" = ${receipt.batchId}`;
}

async function receiptProvenance(tx: TransactionClient, receiptId: number) {
  const receipt = await tx.purchaseReceipt.findUnique({ where: { id: receiptId }, include: { batch: true } });
  if (!receipt) throw new AppError('INCOMING_RECEIPT_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
  if (!receipt.batchId || !receipt.batch || !receipt.incomingQualityPlanJson || !receipt.payableSnapshotJson
    || receipt.payableAmountNative === null || receipt.payableAmountBase === null || receipt.acceptedQuantity <= 0) {
    return fail('INCOMING_HISTORY_UNRECONCILED');
  }
  await requireCommittedPurchaseReceipt(tx, { ...receipt });
  const sources = await resolveReceiptApprovedSources(tx, receipt);
  if (receipt.batch.id !== receipt.batchId || receipt.batch.batchNo !== receipt.batchNo
    || !sources.binding.materialId || receipt.batch.materialId !== sources.binding.materialId
    || receipt.batch.unit !== sources.binding.unit || receipt.unit !== sources.binding.unit) {
    return fail('INCOMING_RECEIPT_BATCH_IDENTITY_REQUIRED');
  }
  return { receipt, plan: sources.qualityPlan.plan };
}

function recordedInspection(row: IncomingQualityCheck, bound: Awaited<ReturnType<typeof receiptProvenance>>) {
  let raw: unknown;
  try { raw = JSON.parse(row.measurementsJson); } catch { return fail('INCOMING_QUALITY_EVIDENCE_INVALID'); }
  const measurements = incomingQualityRecordedMeasurementSchema.array().min(1).safeParse(raw);
  if (!measurements.success || row.purchaseReceiptId !== bound.receipt.id) return fail('INCOMING_QUALITY_EVIDENCE_INVALID');
  const input = normalizeIncomingQualityInput({ sampleNo: row.sampleNo, note: row.note,
    measurements: measurements.data.map(item => ({ code: item.code, unit: item.unit, measuredNumeric: item.measuredNumeric,
      measuredText: item.measuredText, instrumentNo: item.instrumentNo })) });
  const evaluated = evaluateIncomingQualityMeasurements(bound.plan, input);
  if (JSON.stringify(evaluated.measurements) !== JSON.stringify(measurements.data) || row.result !== evaluated.result) {
    return fail('INCOMING_QUALITY_EVIDENCE_INVALID');
  }
  const inspection = incomingQualityInspectionSchema.parse({ id: row.id, checkNo: row.checkNo, purchaseReceiptId: row.purchaseReceiptId,
    revision: row.revision, sampleNo: row.sampleNo, measurements: evaluated.measurements, note: row.note,
    inspectorUserId: row.inspectorUserId, checkedAt: iso(row.checkedAt), result: row.result,
    planHash: incomingQualityPlanHash(bound.receipt.incomingQualityPlanJson!) });
  return { inspection, fingerprint: incomingQualityFingerprint(row.purchaseReceiptId, row.inspectorUserId, input) };
}

async function proveSubmission(tx: TransactionClient, row: IncomingQualityCheck, bound: Awaited<ReturnType<typeof receiptProvenance>>,
  requested?: { key: string; fingerprint: string }) {
  const facts = recordedInspection(row, bound);
  let auditId: number;
  try { auditId = incomingQualitySubmissionSchema.parse(JSON.parse(row.submissionJson)).auditId; }
  catch { return fail('INCOMING_QUALITY_EVIDENCE_INVALID'); }
  const audit = await tx.auditLog.findUnique({ where: { id: auditId } });
  return { inspection: facts.inspection, submission: readIncomingQualitySubmission(row, facts.inspection,
    requested?.key ?? row.requestKey, requested?.fingerprint ?? facts.fingerprint, audit) };
}

async function proveReview(tx: TransactionClient, row: IncomingQualityCheck, inspection: IncomingQualityInspection) {
  if (!row.reviewedByUserId || row.reviewedByUserId === row.inspectorUserId || row.reviewNote === null
    || !['released', 'rejected'].includes(row.status) || row.decision !== row.status
    || (row.status === 'released' && row.result !== 'pass')) return fail('INCOMING_QUALITY_EVIDENCE_INVALID');
  const expected: Omit<IncomingQualityReview, 'auditId'> = { schema: 'incoming-quality-review/v1', checkId: row.id,
    purchaseReceiptId: row.purchaseReceiptId, revision: row.revision, decision: row.status as 'released' | 'rejected',
    reviewedByUserId: row.reviewedByUserId, reviewedAt: iso(row.reviewedAt), reason: row.reviewNote,
    inspectionHash: incomingQualityInspectionHash(inspection) };
  let auditId: number;
  try { auditId = incomingQualityReviewSchema.parse(JSON.parse(row.reviewJson || '')).auditId; }
  catch { return fail('INCOMING_QUALITY_EVIDENCE_INVALID'); }
  return readIncomingQualityReview(row.reviewJson, expected, await tx.auditLog.findUnique({ where: { id: auditId } }));
}

export async function submitIncomingQualityCheck(tx: TransactionClient, receiptId: number, raw: unknown, actorId: number, rawKey: unknown) {
  identity(receiptId, 'INCOMING_RECEIPT_ID_REQUIRED'); identity(actorId, 'INCOMING_QC_ACTOR_REQUIRED');
  const parsedKey = purchaseReceiptKeySchema.safeParse(rawKey);
  if (!parsedKey.success) throw new AppError('INCOMING_QC_KEY_REQUIRED', 400, ErrorCode.VALIDATION_ERROR);
  const key = parsedKey.data, input = normalizeIncomingQualityInput(raw), fingerprint = incomingQualityFingerprint(receiptId, actorId, input);
  const replay = async (row: IncomingQualityCheck) => {
    const bound = await receiptProvenance(tx, receiptId);
    const proof = await proveSubmission(tx, row, bound, { key, fingerprint });
    return { inspection: row, submission: proof.submission, replayed: true };
  };
  const existing = await tx.incomingQualityCheck.findFirst({ where: { purchaseReceiptId: receiptId, requestKey: key } });
  if (existing) return replay(existing);
  await lockReceipt(tx, receiptId);
  const raced = await tx.incomingQualityCheck.findFirst({ where: { purchaseReceiptId: receiptId, requestKey: key } });
  if (raced) return replay(raced);
  const bound = await receiptProvenance(tx, receiptId);
  const latest = await tx.incomingQualityCheck.findFirst({ where: { purchaseReceiptId: receiptId }, orderBy: { revision: 'desc' } });
  if (latest) {
    const proof = await proveSubmission(tx, latest, bound);
    if (latest.reviewJson) await proveReview(tx, latest, proof.inspection);
    else if (latest.status !== 'submitted' || latest.reviewedByUserId !== null || latest.reviewedAt !== null
      || latest.reviewNote !== null || latest.decision !== null) return fail('INCOMING_QUALITY_EVIDENCE_INVALID');
  }
  const revision = (latest?.revision ?? 0) + 1;
  if (revision > 2147483647) return fail('INCOMING_QC_REVISION_OVERFLOW');
  const evaluated = evaluateIncomingQualityMeasurements(bound.plan, input);
  const row = await tx.incomingQualityCheck.create({ data: {
    checkNo: `IQC-${bound.receipt.receiptNo}-R${revision}`, purchaseReceiptId: receiptId, revision,
    requestKey: key, fingerprint, submissionJson: '', status: 'submitted', result: evaluated.result,
    sampleNo: input.sampleNo, measurementsJson: JSON.stringify(evaluated.measurements), note: input.note,
    inspectorUserId: actorId, checkedAt: new Date(),
  } });
  await tx.productBatch.update({ where: { id: bound.receipt.batchId! }, data: { qualityStatus: 'hold' } });
  const { inspection } = recordedInspection(row, bound);
  const audit = await tx.auditLog.create({ data: { userId: actorId, action: 'CREATE_INCOMING_QC', resource: 'incoming_quality', resourceId: row.id,
    details: JSON.stringify(incomingQualitySubmissionAudit(key, fingerprint, inspection)) } });
  const submission = incomingQualitySubmissionSchema.parse({ schema: 'incoming-quality-submission/v1', key, fingerprint, auditId: audit.id, inspection });
  const saved = await tx.incomingQualityCheck.update({ where: { id: row.id }, data: { submissionJson: JSON.stringify(submission) } });
  return { inspection: saved, submission, replayed: false };
}

export async function reviewIncomingQualityCheck(tx: TransactionClient, checkId: number, raw: unknown, actorId: number) {
  identity(checkId, 'INCOMING_QC_ID_REQUIRED'); identity(actorId, 'INCOMING_QA_ACTOR_REQUIRED');
  const input = reviewIncomingQualityCheckSchema.parse(raw);
  const first = await tx.incomingQualityCheck.findUnique({ where: { id: checkId } });
  if (!first) throw new AppError('INCOMING_QC_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
  const replay = async (row: IncomingQualityCheck, bound: Awaited<ReturnType<typeof receiptProvenance>>) => {
    const proof = await proveSubmission(tx, row, bound), review = await proveReview(tx, row, proof.inspection);
    if (review.revision !== input.expectedRevision || review.decision !== input.decision || review.reason !== input.reason
      || review.reviewedByUserId !== actorId) return fail('INCOMING_QA_DECISION_CONFLICT');
    // A previously committed QA decision remains readable after a new QC hold.
    // Replaying it must never release the batch a second time.
    return { inspection: row, review, replayed: true };
  };
  if (first.reviewJson) return replay(first, await receiptProvenance(tx, first.purchaseReceiptId));
  await lockReceipt(tx, first.purchaseReceiptId);
  const row = await tx.incomingQualityCheck.findUnique({ where: { id: checkId } });
  if (!row || row.purchaseReceiptId !== first.purchaseReceiptId) return fail('INCOMING_QUALITY_EVIDENCE_INVALID');
  const bound = await receiptProvenance(tx, row.purchaseReceiptId);
  if (row.reviewJson) return replay(row, bound);
  const proof = await proveSubmission(tx, row, bound);
  const latest = await tx.incomingQualityCheck.findFirst({ where: { purchaseReceiptId: row.purchaseReceiptId }, orderBy: { revision: 'desc' } });
  if (row.revision !== input.expectedRevision || latest?.id !== row.id) return fail('INCOMING_QA_STALE_REVISION');
  if (row.status !== 'submitted' || row.reviewedByUserId !== null || row.reviewedAt !== null || row.reviewNote !== null || row.decision !== null) {
    return fail('INCOMING_QA_STATE_INVALID');
  }
  if (row.inspectorUserId === actorId) return fail('INCOMING_QA_INDEPENDENT_REVIEWER_REQUIRED');
  if (input.decision === 'released' && row.result !== 'pass') return fail('INCOMING_QA_FAILED_INSPECTION');
  const reviewedAt = new Date();
  const claimed = await tx.incomingQualityCheck.updateMany({ where: { id: row.id, status: 'submitted', revision: input.expectedRevision },
    data: { status: input.decision, decision: input.decision, reviewedByUserId: actorId, reviewedAt, reviewNote: input.reason } });
  if (claimed.count !== 1) return fail('INCOMING_QA_DECISION_CONFLICT');
  const reviewFacts: Omit<IncomingQualityReview, 'auditId'> = { schema: 'incoming-quality-review/v1', checkId: row.id,
    purchaseReceiptId: row.purchaseReceiptId, revision: row.revision, decision: input.decision,
    reviewedByUserId: actorId, reviewedAt: iso(reviewedAt), reason: input.reason, inspectionHash: incomingQualityInspectionHash(proof.inspection) };
  const audit = await tx.auditLog.create({ data: { userId: actorId, action: 'REVIEW_INCOMING_QC', resource: 'incoming_quality', resourceId: row.id,
    details: JSON.stringify(incomingQualityReviewAudit(reviewFacts)) } });
  const review = incomingQualityReviewSchema.parse({ ...reviewFacts, auditId: audit.id });
  const saved = await tx.incomingQualityCheck.update({ where: { id: row.id }, data: { reviewJson: JSON.stringify(review) } });
  await tx.productBatch.update({ where: { id: bound.receipt.batchId! }, data: { qualityStatus: input.decision === 'released' ? 'released' : 'quarantine' } });
  return { inspection: saved, review, replayed: false };
}

// Historical payment evidence binds the decision that actually permitted the
// payment. A subsequent retest may hold the batch, but must not rewrite that
// decision or make a committed payment acknowledgement unrecoverable.
export async function assertHistoricalIncomingQualityRelease(tx: TransactionClient, checkId: number, receiptId: number) {
  identity(checkId, 'INCOMING_QC_ID_REQUIRED'); identity(receiptId, 'INCOMING_RECEIPT_ID_REQUIRED');
  const inspection = await tx.incomingQualityCheck.findUnique({ where: { id: checkId } });
  if (!inspection || inspection.purchaseReceiptId !== receiptId || inspection.status !== 'released' || inspection.result !== 'pass') {
    return fail('INCOMING_QUALITY_EVIDENCE_INVALID');
  }
  const bound = await receiptProvenance(tx, receiptId);
  const proof = await proveSubmission(tx, inspection, bound), review = await proveReview(tx, inspection, proof.inspection);
  if (review.decision !== 'released') return fail('INCOMING_QUALITY_EVIDENCE_INVALID');
  return { receipt: bound.receipt, inspection, submission: proof.submission, review };
}

export async function assertLatestIncomingQualityRelease(tx: TransactionClient, batchId: number) {
  identity(batchId, 'INCOMING_BATCH_ID_REQUIRED');
  const batch = await tx.productBatch.findUnique({ where: { id: batchId } });
  if (!batch) return fail('INCOMING_RECEIPT_BATCH_IDENTITY_REQUIRED');
  const receipts = await tx.purchaseReceipt.findMany({ where: { OR: [{ batchId }, { batchNo: batch.batchNo }] }, take: 2 });
  if (receipts.length !== 1 || receipts[0].batchId !== batchId) return fail('INCOMING_HISTORY_UNRECONCILED');
  const bound = await receiptProvenance(tx, receipts[0].id);
  const inspection = await tx.incomingQualityCheck.findFirst({ where: { purchaseReceiptId: bound.receipt.id }, orderBy: { revision: 'desc' } });
  if (!inspection || batch.qualityStatus !== 'released' || inspection.status !== 'released' || inspection.result !== 'pass') {
    return fail('INCOMING_QA_RELEASE_REQUIRED');
  }
  return assertHistoricalIncomingQualityRelease(tx, inspection.id, bound.receipt.id);
}

// QC-only roles receive trace/measurement facts, never the supplier's prices,
// AP amounts, commercial binding, or the internal submission keys.
export async function getIncomingQualityBundle(tx: TransactionClient, receiptId: number) {
  identity(receiptId, 'INCOMING_RECEIPT_ID_REQUIRED');
  const bound = await receiptProvenance(tx, receiptId), r = bound.receipt;
  const rows = await tx.incomingQualityCheck.findMany({ where: { purchaseReceiptId: receiptId }, orderBy: { revision: 'desc' } });
  const qualityChecks = await Promise.all(rows.map(async row => {
    const proof = await proveSubmission(tx, row, bound);
    if (row.reviewJson) await proveReview(tx, row, proof.inspection);
    else if (row.status !== 'submitted' || row.reviewedByUserId !== null || row.reviewedAt !== null
      || row.reviewNote !== null || row.decision !== null) return fail('INCOMING_QUALITY_EVIDENCE_INVALID');
    return { id: row.id, checkNo: row.checkNo, purchaseReceiptId: row.purchaseReceiptId, revision: row.revision,
      status: row.status, result: row.result, sampleNo: row.sampleNo, measurements: proof.inspection.measurements,
      note: row.note, inspectorUserId: row.inspectorUserId, checkedAt: iso(row.checkedAt), reviewedByUserId: row.reviewedByUserId,
      reviewedAt: row.reviewedAt === null ? null : iso(row.reviewedAt), reviewNote: row.reviewNote, decision: row.decision };
  }));
  return { receipt: { id: r.id, receiptNo: r.receiptNo, purchaseOrderId: r.purchaseOrderId, quantity: r.quantity,
    acceptedQuantity: r.acceptedQuantity, rejectedQuantity: r.rejectedQuantity, unit: r.unit,
    supplierBatchNo: r.supplierBatchNo, batchNo: r.batchNo, batchId: r.batchId, productName: r.batch!.productName,
    receivedBy: r.receivedBy, receivedAt: iso(r.receivedAt), qualityStatus: r.batch!.qualityStatus },
  plan: bound.plan, qualityChecks };
}
