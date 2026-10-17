import { z } from 'zod';
import type { ApiRequestOptions } from '../utils/api';
import type { ApiDataResponse } from '../utils/apiMapping';

const id = z.number().int().positive().refine(Number.isSafeInteger), text = z.string().nullable();
const date = z.string().datetime().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value), digest = z.string().regex(/^[a-f0-9]{64}$/);
const result = z.enum(['pass', 'fail']), decision = z.enum(['released', 'rejected']);
export const incomingQualityKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/);
export const incomingQualityMeasurementInputSchema = z.object({
  code: z.string().trim().min(1).max(40).transform(value => value.toUpperCase()),
  unit: z.string().trim().min(1).max(30).nullable(),
  measuredNumeric: z.string().trim().min(1).max(200).nullable(),
  measuredText: z.string().trim().min(1).max(200).nullable(),
  instrumentNo: z.string().trim().min(1).max(120),
}).strict().refine(value => (value.measuredNumeric === null) !== (value.measuredText === null), '请填写一种实测值');
export const incomingQualityInputSchema = z.object({
  sampleNo: z.string().trim().min(1).max(120),
  measurements: z.array(incomingQualityMeasurementInputSchema).min(1).max(100),
  note: z.string().trim().max(2000).nullable().optional().transform(value => value || null),
}).strict().refine(value => new Set(value.measurements.map(item => item.code)).size === value.measurements.length, '项目编码不能重复');
export const incomingQualityReviewInputSchema = z.object({
  expectedRevision: id, decision, reason: z.string().trim().min(3).max(2000),
}).strict();
const characteristic = z.object({
  code: z.string().min(1), name: z.string().min(1), valueType: z.enum(['numeric', 'text']),
  unit: text, lowerLimit: text, upperLimit: text, targetText: text,
  testMethod: z.string().min(1), required: z.boolean(), sortOrder: z.number().int(),
}).strict();
export const incomingQualityRecordedMeasurementSchema = characteristic.omit({ sortOrder: true }).extend({
  measuredNumeric: text, measuredText: text, instrumentNo: z.string().min(1), result,
}).strict().refine(value => value.valueType === 'numeric'
  ? value.measuredNumeric !== null && value.measuredText === null
  : value.measuredNumeric === null && value.measuredText !== null, '实测类型与冻结项目不一致');
export const incomingQualityCheckSchema = z.object({
  id, checkNo: z.string().min(1), purchaseReceiptId: id, revision: id,
  status: z.enum(['submitted', 'released', 'rejected']), result, sampleNo: z.string().min(1), note: text,
  measurements: z.array(incomingQualityRecordedMeasurementSchema).min(1).max(100), inspectorUserId: id, checkedAt: date,
  reviewedByUserId: id.nullable(), reviewedAt: date.nullable(), reviewNote: text, decision: decision.nullable(),
}).strict().superRefine((check, context) => {
  if (new Set(check.measurements.map(item => item.code)).size !== check.measurements.length
    || check.result !== (check.measurements.some(item => item.result === 'fail') ? 'fail' : 'pass')
    || (check.status === 'submitted' ? check.reviewedByUserId !== null || check.reviewedAt !== null
      || check.reviewNote !== null || check.decision !== null
      : check.decision !== check.status || check.reviewedByUserId === null || check.reviewedByUserId === check.inspectorUserId
        || check.reviewedAt === null || !check.reviewNote || check.reviewNote.trim().length < 3)
    || (check.status === 'released' && check.result !== 'pass')) {
    context.addIssue({ code: 'custom', message: '检验状态、实测结果与独立审核记录不一致' });
  }
});
export const incomingQualityBundleSchema = z.object({
  receipt: z.object({
    id, receiptNo: z.string().min(1), purchaseOrderId: id,
    quantity: z.number().finite().positive(), acceptedQuantity: z.number().finite().positive(),
    rejectedQuantity: z.number().finite().nonnegative(), unit: z.string().min(1),
    supplierBatchNo: text, batchNo: text, batchId: id.nullable(), productName: z.string().min(1),
    receivedBy: id.nullable(), receivedAt: date, qualityStatus: z.string().min(1),
  }).strict(),
  plan: z.object({ specificationRef: z.string().min(1), specificationRevision: z.string().min(1),
    characteristics: z.array(characteristic).min(1).max(100) }).strict(),
  qualityChecks: z.array(incomingQualityCheckSchema),
}).strict().superRefine((bundle, context) => {
  const checks = bundle.qualityChecks;
  if (checks.some((check, index) => check.purchaseReceiptId !== bundle.receipt.id
    || (index > 0 && checks[index - 1].revision <= check.revision))
    || new Set(checks.map(check => check.id)).size !== checks.length
    || new Set(bundle.plan.characteristics.map(item => item.code.toUpperCase())).size !== bundle.plan.characteristics.length) {
    context.addIssue({ code: 'custom', message: '检验记录身份或版本顺序不一致' });
  }
});
export const incomingQualitySubmissionSchema = z.object({
  schema: z.literal('incoming-quality-submission/v1'), key: incomingQualityKeySchema, fingerprint: digest, auditId: id,
  inspection: z.object({ id, checkNo: z.string().min(1), purchaseReceiptId: id, revision: id, sampleNo: z.string().min(1),
    measurements: z.array(incomingQualityRecordedMeasurementSchema).min(1), note: text,
    inspectorUserId: id, checkedAt: date, result, planHash: digest }).strict(),
}).strict();
export const incomingQualityReviewSchema = z.object({
  schema: z.literal('incoming-quality-review/v1'), auditId: id, checkId: id, purchaseReceiptId: id,
  revision: id, decision, reviewedByUserId: id, reviewedAt: date, reason: z.string().min(3), inspectionHash: digest,
}).strict();
export const incomingQualityListRowSchema = z.object({
  id, receiptNo: z.string().min(1), purchaseOrderId: id, productName: z.string(),
  acceptedQuantity: z.number().finite().positive(), unit: z.string().min(1), receivedAt: date,
  supplierBatchNo: text, batchNo: text, historyUnreconciled: z.boolean(),
}).strict();
const metaSchema = z.object({ page: id, pageSize: z.literal(50), total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative() }).strict();
export type IncomingQualityInput = z.infer<typeof incomingQualityInputSchema>;
export type IncomingQualityReviewInput = z.infer<typeof incomingQualityReviewInputSchema>;
export type IncomingQualityBundle = z.infer<typeof incomingQualityBundleSchema>;
export type IncomingQualityCheck = z.infer<typeof incomingQualityCheckSchema>;
export type IncomingQualitySubmission = z.infer<typeof incomingQualitySubmissionSchema>;
export type IncomingQualityReview = z.infer<typeof incomingQualityReviewSchema>;
export type IncomingQualityListRow = z.infer<typeof incomingQualityListRowSchema>;
export type IncomingQualityList = { rows: IncomingQualityListRow[]; meta: z.infer<typeof metaSchema> };

// Lazy API loading keeps pure DTO/intent tests independent of Vite's environment.
const client = async () => (await import('../utils/api')).default;
const identity = (value: number) => id.parse(value);
export const incomingQualityService = {
  async list(page = 1, options?: ApiRequestOptions): Promise<IncomingQualityList> {
    const response = await (await client()).get<unknown, ApiDataResponse<unknown>>('/procurement/incoming-quality', { params: { page: identity(page) }, ...options });
    const rows = z.array(incomingQualityListRowSchema).max(50).parse(response.data), meta = metaSchema.parse(response.meta);
    if (meta.page !== page || meta.totalPages !== Math.ceil(meta.total / meta.pageSize)) throw Error('来料列表分页回执不一致');
    return { rows, meta };
  },
  async get(receiptId: number, options?: ApiRequestOptions): Promise<IncomingQualityBundle> {
    const response = await (await client()).get<unknown, ApiDataResponse<unknown>>(`/procurement/receipts/${identity(receiptId)}/quality`, options);
    const bundle = incomingQualityBundleSchema.parse(response.data);
    if (bundle.receipt.id !== receiptId) throw Error('来料明细回执身份不一致');
    return bundle;
  },
  async submit(receiptId: number, input: IncomingQualityInput, key: string) {
    const response = await (await client()).post<unknown, ApiDataResponse<unknown>>(`/procurement/receipts/${identity(receiptId)}/quality-checks`,
      incomingQualityInputSchema.parse(input), { headers: { 'Idempotency-Key': incomingQualityKeySchema.parse(key) } });
    return z.object({ submission: incomingQualitySubmissionSchema, replayed: z.boolean() }).strict().parse(response.data);
  },
  async review(checkId: number, input: IncomingQualityReviewInput) {
    const response = await (await client()).post<unknown, ApiDataResponse<unknown>>(`/procurement/quality-checks/${identity(checkId)}/review`,
      incomingQualityReviewInputSchema.parse(input));
    return z.object({ review: incomingQualityReviewSchema, replayed: z.boolean() }).strict().parse(response.data);
  },
};
