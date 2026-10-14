import { createHash } from 'crypto';
import { z } from 'zod';
import { AppError, ErrorCode } from '../middleware/errorHandler';

export const purchaseReceiptKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/);
const conflict = () => new AppError('PURCHASE_RECEIPT_KEY_CONFLICT', 409, ErrorCode.CONFLICT);
export const invalidPurchaseReceiptSubmission = () => new AppError('PURCHASE_RECEIPT_SUBMISSION_INVALID', 409, ErrorCode.CONFLICT);
export function requirePurchaseReceiptKey(value: unknown): string {
  const result = purchaseReceiptKeySchema.safeParse(value);
  if (!result.success) throw new AppError('PURCHASE_RECEIPT_KEY_REQUIRED', 400, ErrorCode.VALIDATION_ERROR);
  return result.data;
}

// Caller defaults stay NULL in the identity. Server time/receipt numbers are
// resolved only by the owner; generating them again would break lost-ACK replay.
export interface PurchaseReceiptFacts {
  purchaseOrderId: number; receivedBy: number; quantity: number; acceptedQuantity: number; rejectedQuantity: number;
  batchNo: string | null; receivedAt: string | null; discrepancyReason: string | null; discrepancyType: string; note: string | null;
}
export const purchaseReceiptFingerprint = (facts: PurchaseReceiptFacts) => createHash('sha256')
  .update(JSON.stringify({ schema: 'purchase-receipt-facts/v1', ...facts })).digest('hex');
const text = z.string().nullable();
const positiveId = z.number().int().positive();
export const purchaseReceiptSubmissionSchema = z.object({
  schema: z.literal('purchase-receipt-submission/v1'), key: purchaseReceiptKeySchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), auditId: positiveId,
  receipt: z.object({
    id: positiveId, receiptNo: z.string().min(1), purchaseOrderId: positiveId,
    quantity: z.number().finite().positive(), acceptedQuantity: z.number().finite().nonnegative(),
    rejectedQuantity: z.number().finite().nonnegative(), unit: z.string().min(1), batchNo: z.string().min(1),
    stockEntryRef: text, discrepancyReason: text, note: text, receivedBy: positiveId,
    receivedAt: z.string().datetime(), createdAt: z.string().datetime(),
  }).strict().superRefine((r, ctx) => {
    if (Math.abs(r.quantity - r.acceptedQuantity - r.rejectedQuantity) > 0.000001
      || (r.acceptedQuantity > 0 ? !r.stockEntryRef : r.stockEntryRef !== null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Receipt quantities or stock link do not reconcile' });
    }
  }),
}).strict();
export type PurchaseReceiptSubmission = z.infer<typeof purchaseReceiptSubmissionSchema>;
export const purchaseReceiptAuditDetails = (key: string, fingerprint: string, receipt: PurchaseReceiptSubmission['receipt']) => ({
  schema: 'purchase-receipt-audit/v1', receiptId: receipt.id, receiptNo: receipt.receiptNo,
  submissionKeyHash: createHash('sha256').update(key).digest('hex'), fingerprint,
  receiptHash: createHash('sha256').update(JSON.stringify(receipt)).digest('hex'),
});

export function readPurchaseReceiptSubmission(stored: {
  submissionKey: string | null; submissionFingerprint: string | null; submissionJson: string | null;
}, receipt: PurchaseReceiptSubmission['receipt'], facts: PurchaseReceiptFacts, key: string,
audit: { id: number; userId: number; action: string; resource: string; resourceId: number | null; details: string | null } | null) {
  if (!stored.submissionKey || !stored.submissionFingerprint || !stored.submissionJson) throw invalidPurchaseReceiptSubmission();
  const fingerprint = purchaseReceiptFingerprint(facts);
  if (stored.submissionKey !== key || stored.submissionFingerprint !== fingerprint || receipt.receivedBy !== facts.receivedBy) throw conflict();
  let parsed: unknown;
  try { parsed = JSON.parse(stored.submissionJson); } catch { throw invalidPurchaseReceiptSubmission(); }
  const result = purchaseReceiptSubmissionSchema.safeParse(parsed);
  if (!result.success) throw invalidPurchaseReceiptSubmission();
  const submission = result.data;
  if (submission.key !== key || submission.fingerprint !== fingerprint || receipt.purchaseOrderId !== facts.purchaseOrderId
    || JSON.stringify(submission.receipt) !== JSON.stringify(receipt)
    || receipt.quantity !== facts.quantity || receipt.acceptedQuantity !== facts.acceptedQuantity || receipt.rejectedQuantity !== facts.rejectedQuantity
    || receipt.note !== facts.note || receipt.discrepancyReason !== facts.discrepancyReason
    || (facts.batchNo !== null && receipt.batchNo !== facts.batchNo)
    || (facts.receivedAt !== null && receipt.receivedAt !== facts.receivedAt)) throw invalidPurchaseReceiptSubmission();
  let details: unknown;
  try { details = JSON.parse(audit?.details || ''); } catch { throw invalidPurchaseReceiptSubmission(); }
  if (!audit || audit.id !== submission.auditId || audit.userId !== facts.receivedBy || audit.action !== 'CREATE_RECEIPT' || audit.resource !== 'purchase_order'
    || audit.resourceId !== facts.purchaseOrderId
    || JSON.stringify(details) !== JSON.stringify(purchaseReceiptAuditDetails(key, fingerprint, receipt))) throw invalidPurchaseReceiptSubmission();
  return submission;
}
