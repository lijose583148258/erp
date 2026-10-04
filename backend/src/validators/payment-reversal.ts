import { z } from 'zod';
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/);
const text = z.string().trim().min(5).max(2000);
export const createPaymentReversalSchema = z.object({ requestKey: key,
    reasonCategory: z.enum(['registration_error','bank_return']), reason: text }).strict();
export const reviewPaymentReversalSchema = z.object({ reviewKey: key,
    decision: z.enum(['approve','reject']), note: text }).strict();
