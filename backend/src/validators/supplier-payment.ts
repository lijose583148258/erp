import { Prisma } from '@prisma/client';
import { z } from 'zod';

// Bank references are opaque evidence, not names whose case we can guess.
const reference = z.string().trim().min(1).max(200);
export const registerSupplierPaymentSchema = z.object({
  amountNative: z.number().finite().positive().refine(value => {
    const amount = new Prisma.Decimal(value);
    return amount.decimalPlaces() <= 2 && Number.isSafeInteger(amount.times(100).toNumber());
  }, '付款金额必须为安全的两位小数'),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform(value => value.toUpperCase()),
  method: z.enum(['bank_transfer', 'cash', 'alipay', 'wechat', 'check', 'wire_transfer']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, '付款日期必须为真实 YYYY-MM-DD 日期'),
  paymentAccountRef: reference,
  externalTransactionRef: reference,
  evidenceRef: z.string().trim().min(3).max(500),
  note: z.string().trim().max(2000).optional(),
}).strict();
export type RegisterSupplierPaymentInput = z.infer<typeof registerSupplierPaymentSchema>;
export const cancelSupplierPaymentSchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();
