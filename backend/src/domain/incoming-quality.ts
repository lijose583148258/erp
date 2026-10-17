import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { incomingQualityPlanSchema } from './purchase-governance';
import { purchaseReceiptKeySchema } from './purchase-receipt-submission';
import { submitIncomingQualityCheckSchema, type IncomingQualityInput } from '../validators/purchase-quality';

export const incomingQualityConflict = (message: string) => new AppError(message, 409, ErrorCode.CONFLICT);
const invalid = () => incomingQualityConflict('INCOMING_QUALITY_EVIDENCE_INVALID');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const measuredDecimal = (raw: string) => {
  if (!decimalPattern.test(raw) || !Number.isFinite(Number(raw))) throw incomingQualityConflict('INCOMING_QC_NUMERIC_VALUE_INVALID');
  try {
    const value = new Prisma.Decimal(raw);
    if (!value.isFinite()) throw incomingQualityConflict('INCOMING_QC_NUMERIC_VALUE_INVALID');
    return value;
  } catch { throw incomingQualityConflict('INCOMING_QC_NUMERIC_VALUE_INVALID'); }
};

export function normalizeIncomingQualityInput(raw: unknown): IncomingQualityInput {
  const input = submitIncomingQualityCheckSchema.parse(raw);
  return { ...input, measurements: input.measurements.map(item => ({ ...item,
    measuredNumeric: item.measuredNumeric === null ? null : measuredDecimal(item.measuredNumeric).toString(),
  })).sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0) };
}
export const incomingQualityFingerprint = (receiptId: number, inspectorId: number, input: IncomingQualityInput) =>
  hash({ schema: 'incoming-quality-facts/v1', purchaseReceiptId: receiptId, inspectorUserId: inspectorId,
    sampleNo: input.sampleNo, measurements: input.measurements, note: input.note });

export function evaluateIncomingQualityMeasurements(plan: z.infer<typeof incomingQualityPlanSchema>, input: IncomingQualityInput) {
  const specification = incomingQualityPlanSchema.parse(plan);
  const submitted = new Map(input.measurements.map(item => [item.code, item]));
  if (input.measurements.some(item => !specification.characteristics.some(character => character.code.toUpperCase() === item.code))) {
    throw incomingQualityConflict('INCOMING_QC_CHARACTERISTIC_UNKNOWN');
  }
  const missing = specification.characteristics.filter(item => item.required && !submitted.has(item.code.toUpperCase()));
  if (missing.length) throw incomingQualityConflict('INCOMING_QC_REQUIRED_MEASUREMENT_MISSING');
  const measurements = specification.characteristics.filter(item => submitted.has(item.code.toUpperCase())).map(item => {
    const value = submitted.get(item.code.toUpperCase())!;
    if (value.unit !== (item.unit || null)) throw incomingQualityConflict('INCOMING_QC_MEASUREMENT_UNIT_MISMATCH');
    let passed = false;
    if (item.valueType === 'numeric') {
      if (value.measuredNumeric === null || value.measuredText !== null) throw incomingQualityConflict('INCOMING_QC_MEASUREMENT_TYPE_MISMATCH');
      const measured = measuredDecimal(value.measuredNumeric);
      const lower = item.lowerLimit == null ? null : new Prisma.Decimal(item.lowerLimit);
      const upper = item.upperLimit == null ? null : new Prisma.Decimal(item.upperLimit);
      passed = Boolean(lower || upper) && (!lower || lower.isFinite()) && (!upper || upper.isFinite())
        && (!lower || !upper || lower.lessThanOrEqualTo(upper))
        && (!lower || measured.greaterThanOrEqualTo(lower)) && (!upper || measured.lessThanOrEqualTo(upper));
    } else {
      if (value.measuredText === null || value.measuredNumeric !== null) throw incomingQualityConflict('INCOMING_QC_MEASUREMENT_TYPE_MISMATCH');
      const targets = (item.targetText || '').split('|').map(target => target.trim().toLowerCase()).filter(Boolean);
      passed = targets.length > 0 && targets.includes(value.measuredText.trim().toLowerCase());
    }
    return { code: item.code.toUpperCase(), name: item.name, valueType: item.valueType, unit: item.unit || null,
      lowerLimit: item.lowerLimit == null ? null : new Prisma.Decimal(item.lowerLimit).toString(),
      upperLimit: item.upperLimit == null ? null : new Prisma.Decimal(item.upperLimit).toString(),
      targetText: item.targetText || null, testMethod: item.testMethod!, required: item.required,
      measuredNumeric: value.measuredNumeric, measuredText: value.measuredText, instrumentNo: value.instrumentNo,
      result: passed ? 'pass' as const : 'fail' as const };
  });
  return { measurements, result: measurements.some(item => item.result === 'fail') ? 'fail' as const : 'pass' as const };
}

const text = z.string().nullable(), id = z.number().int().positive(), digest = z.string().regex(/^[a-f0-9]{64}$/);
export const incomingQualityRecordedMeasurementSchema = z.object({
  code: z.string().min(1), name: z.string().min(1), valueType: z.enum(['numeric', 'text']), unit: text,
  lowerLimit: text, upperLimit: text, targetText: text, testMethod: z.string().min(1), required: z.boolean(),
  measuredNumeric: text, measuredText: text, instrumentNo: z.string().min(1), result: z.enum(['pass', 'fail']),
}).strict();
export const incomingQualityInspectionSchema = z.object({
  id, checkNo: z.string().min(1), purchaseReceiptId: id, revision: id, sampleNo: z.string().min(1),
  measurements: z.array(incomingQualityRecordedMeasurementSchema).min(1), note: text,
  inspectorUserId: id, checkedAt: z.string().datetime(), result: z.enum(['pass', 'fail']), planHash: digest,
}).strict();
export type IncomingQualityInspection = z.infer<typeof incomingQualityInspectionSchema>;
export const incomingQualitySubmissionSchema = z.object({
  schema: z.literal('incoming-quality-submission/v1'), key: purchaseReceiptKeySchema, fingerprint: digest,
  auditId: id, inspection: incomingQualityInspectionSchema,
}).strict();
export const incomingQualityReviewSchema = z.object({
  schema: z.literal('incoming-quality-review/v1'), auditId: id, checkId: id, purchaseReceiptId: id, revision: id,
  decision: z.enum(['released', 'rejected']), reviewedByUserId: id, reviewedAt: z.string().datetime(), reason: z.string().min(3), inspectionHash: digest,
}).strict();
export type IncomingQualityReview = z.infer<typeof incomingQualityReviewSchema>;
export const incomingQualityPlanHash = (planJson: string) => createHash('sha256').update(planJson).digest('hex');
export const incomingQualityInspectionHash = (inspection: IncomingQualityInspection) => hash(inspection);
export const incomingQualitySubmissionAudit = (key: string, fingerprint: string, inspection: IncomingQualityInspection) => ({
  schema: 'incoming-quality-submit-audit/v1', requestKeyHash: createHash('sha256').update(key).digest('hex'),
  fingerprint, inspectionHash: hash(inspection), purchaseReceiptId: inspection.purchaseReceiptId,
});
export const incomingQualityReviewAudit = (review: Omit<IncomingQualityReview, 'auditId'>) => ({
  schema: 'incoming-quality-review-audit/v1', reviewHash: hash(review), checkId: review.checkId, purchaseReceiptId: review.purchaseReceiptId,
});
export type IncomingQualityAudit = { id: number; userId: number; action: string; resource: string; resourceId: number | null; details: string | null };

export function readIncomingQualitySubmission(stored: { requestKey: string; fingerprint: string; submissionJson: string | null },
  inspection: IncomingQualityInspection, key: string, fingerprint: string, audit: IncomingQualityAudit | null) {
  if (stored.requestKey !== key || stored.fingerprint !== fingerprint) throw incomingQualityConflict('INCOMING_QC_KEY_CONFLICT');
  let parsed: unknown;
  try { parsed = JSON.parse(stored.submissionJson || ''); } catch { throw invalid(); }
  const result = incomingQualitySubmissionSchema.safeParse(parsed);
  if (!result.success) throw invalid();
  const ack = result.data;
  if (ack.key !== key || ack.fingerprint !== fingerprint || JSON.stringify(ack.inspection) !== JSON.stringify(inspection)
    || !audit || audit.id !== ack.auditId || audit.userId !== inspection.inspectorUserId || audit.action !== 'CREATE_INCOMING_QC'
    || audit.resource !== 'incoming_quality' || audit.resourceId !== inspection.id
    || audit.details !== JSON.stringify(incomingQualitySubmissionAudit(key, fingerprint, inspection))) throw invalid();
  return ack;
}
export function readIncomingQualityReview(stored: string | null, expected: Omit<IncomingQualityReview, 'auditId'>, audit: IncomingQualityAudit | null) {
  let parsed: unknown;
  try { parsed = JSON.parse(stored || ''); } catch { throw invalid(); }
  const result = incomingQualityReviewSchema.safeParse(parsed);
  if (!result.success) throw invalid();
  const { auditId, ...facts } = result.data;
  if (JSON.stringify(facts) !== JSON.stringify(expected) || !audit || audit.id !== auditId || audit.userId !== expected.reviewedByUserId
    || audit.action !== 'REVIEW_INCOMING_QC' || audit.resource !== 'incoming_quality' || audit.resourceId !== expected.checkId
    || audit.details !== JSON.stringify(incomingQualityReviewAudit(expected))) throw invalid();
  return result.data;
}
