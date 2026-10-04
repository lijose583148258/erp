import { z } from 'zod';

// Decimal text is deliberately not coerced, rounded or inferred from a free label.
const positiveDecimal = z.string().trim().max(24).regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/)
  .refine(v => Number(v) > 0 && Number(v) <= 1000000, '必须为大于0且不超过1000000的十进制数');
const reference = z.string().trim().min(1).max(240);
export const createDensityRevisionSchema = z.object({
  batchNo: z.string().trim().min(1).max(120),
  specCode: z.string().trim().min(1).max(48).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/),
  version: z.string().trim().min(1).max(32),
  densityKgPerL: positiveDecimal,
  temperatureC: z.string().trim().max(24).regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/)
    .refine(v => Number(v) > -273.15 && Number(v) <= 1000000, '请输入有效的摄氏温度'),
  pressureKpaAbs: positiveDecimal,
  compositionReference: reference,
  methodReference: reference,
  sourceReference: reference,
  measuredAt: z.iso.datetime(),
}).strict();
export const reviewDensityRevisionSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  reason: reference,
}).strict();
