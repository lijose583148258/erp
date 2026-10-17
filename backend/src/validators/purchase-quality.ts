import { z } from 'zod';

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();
export const incomingQualityMeasurementSchema = z.object({
  code: z.string().trim().min(1).max(40).transform(value => value.toUpperCase()),
  unit: nullableText(30),
  measuredNumeric: nullableText(200),
  measuredText: nullableText(200),
  instrumentNo: z.string().trim().min(1).max(120),
}).strict().superRefine((value, context) => {
  if ((value.measuredNumeric === null) === (value.measuredText === null)) {
    context.addIssue({ code: 'custom', message: '每个项目必须且只能填写一种测量值' });
  }
});

export const submitIncomingQualityCheckSchema = z.object({
  sampleNo: z.string().trim().min(1).max(120),
  measurements: z.array(incomingQualityMeasurementSchema).min(1).max(100),
  note: z.string().trim().max(2000).nullable().optional().transform(value => value || null),
}).strict().superRefine((value, context) => {
  if (new Set(value.measurements.map(item => item.code)).size !== value.measurements.length) {
    context.addIssue({ code: 'custom', path: ['measurements'], message: '同一检验项目不能重复提交' });
  }
});

export const reviewIncomingQualityCheckSchema = z.object({
  expectedRevision: z.number().int().positive(),
  decision: z.enum(['released', 'rejected']),
  reason: z.string().trim().min(3).max(2000),
}).strict();

export type IncomingQualityInput = z.infer<typeof submitIncomingQualityCheckSchema>;
export type IncomingQualityReviewInput = z.infer<typeof reviewIncomingQualityCheckSchema>;
