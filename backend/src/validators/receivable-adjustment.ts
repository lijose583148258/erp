import { z } from 'zod';

export const createReceivableAdjustmentSchema = z.object({
  orderId: z.coerce.number().int().positive(),
  customerId: z.coerce.number().int().positive().optional(),
  adjustmentType: z.enum([
    'credit_memo',
    'discount_allowance',
    'bad_debt_writeoff',
    'short_payment_writeoff',
    'fx_difference',
  ]),
  amount: z.coerce.number().positive(),
  currency: z.string().trim().min(3).max(8).optional(),
  exchangeRate: z.coerce.number().positive().optional(),
  baseAmount: z.coerce.number().nonnegative().optional(),
  reason: z.string().trim().min(1),
  evidenceJson: z.string().trim().optional(),
  note: z.string().trim().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.evidenceJson) {
    try {
      JSON.parse(value.evidenceJson);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidenceJson'],
        message: 'evidenceJson must be valid JSON.',
      });
    }
  }
});

export const reverseReceivableAdjustmentSchema = z.object({
  note: z.string().trim().optional(),
}).strict();
