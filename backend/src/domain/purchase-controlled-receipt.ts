import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { requireIncomingQualityPlan } from './purchase-governance';
import { payableMoney, requireReceiptPayableSource } from './purchase-payable';
import { invalidPurchaseReceiptSubmission, purchaseReceiptKeySchema, purchaseReceiptSubmissionSchema } from './purchase-receipt-submission';

const id = z.number().int().positive().refine(Number.isSafeInteger), text = z.string().min(1).nullable();
const quantity = z.number().finite().nonnegative().refine(value => {
  const d = new Prisma.Decimal(value); return d.decimalPlaces() <= 6 && Number.isSafeInteger(d.times(1000000).toNumber());
});
const digest = z.string().regex(/^[a-f0-9]{64}$/), hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const controlledPurchaseReceiptFactsSchema = z.object({
  purchaseOrderId: id, receivedBy: id, quantity: quantity.refine(value => value > 0), acceptedQuantity: quantity, rejectedQuantity: quantity,
  batchNo: z.string().min(1).max(200), receivedAt: z.string().datetime().nullable(), discrepancyReason: text, discrepancyType: z.string().min(1), note: text,
  expectedRevision: z.number().int().nonnegative().refine(Number.isSafeInteger),
}).strict().refine(facts => new Prisma.Decimal(facts.acceptedQuantity).plus(facts.rejectedQuantity).equals(facts.quantity), 'Physical quantities must reconcile exactly');
export type ControlledPurchaseReceiptFacts = z.infer<typeof controlledPurchaseReceiptFactsSchema>;
export const controlledPurchaseReceiptFingerprint = (raw: ControlledPurchaseReceiptFacts) =>
  hash({ schema: 'purchase-receipt-facts/v2', ...controlledPurchaseReceiptFactsSchema.parse(raw) });

// V1 and its audit hash remain untouched. Only new, fully sourced receipts use
// V2; old NULL AP is never interpreted as a zero liability or a QA exemption.
export const controlledPurchaseReceiptRowSchema = purchaseReceiptSubmissionSchema.shape.receipt.safeExtend({
  supplierBatchNo: z.string().min(1).max(200), batchId: id.nullable(), payableAmountNative: z.string().regex(/^\d+\.\d{2}$/),
  payableAmountBase: z.string().regex(/^\d+\.\d{2}$/), payableSnapshotJson: z.string().min(1), incomingQualityPlanJson: z.string().min(1),
}).strict().superRefine((r, context) => {
  const expectedRef = `PO-${r.purchaseOrderId}-RCV-${r.receiptNo}`;
  if (!new Prisma.Decimal(r.acceptedQuantity).plus(r.rejectedQuantity).equals(r.quantity) || r.batchNo !== expectedRef
    || (r.acceptedQuantity > 0 ? r.stockEntryRef !== expectedRef || r.batchId === null : r.stockEntryRef !== null || r.batchId !== null)) {
    context.addIssue({ code: 'custom', message: 'Controlled receipt, physical batch and stock reference do not reconcile' });
  }
});
export type ControlledPurchaseReceipt = z.infer<typeof controlledPurchaseReceiptRowSchema>;
export const controlledPurchaseReceiptSubmissionSchema = z.object({
  schema: z.literal('purchase-receipt-submission/v2'), key: purchaseReceiptKeySchema, fingerprint: digest, auditId: id,
  facts: controlledPurchaseReceiptFactsSchema, receipt: controlledPurchaseReceiptRowSchema,
}).strict();
export type ControlledPurchaseReceiptSubmission = z.infer<typeof controlledPurchaseReceiptSubmissionSchema>;
export const controlledPurchaseReceiptAuditDetails = (key: string, fingerprint: string, receipt: ControlledPurchaseReceipt) => ({
  schema: 'purchase-receipt-audit/v2', receiptId: receipt.id, receiptNo: receipt.receiptNo,
  submissionKeyHash: createHash('sha256').update(key).digest('hex'), fingerprint, receiptHash: hash(receipt),
});
type ReceiptAudit = { id: number; userId: number; action: string; resource: string; resourceId: number | null; details: string | null };
export type StoredControlledReceipt = { submissionKey: string | null; submissionFingerprint: string | null; submissionJson: string | null };
export function readControlledPurchaseReceiptSubmission(stored: StoredControlledReceipt, receipt: ControlledPurchaseReceipt,
  audit: ReceiptAudit | null, requested?: { key: string; facts: ControlledPurchaseReceiptFacts }) {
  let raw: unknown;
  try { raw = JSON.parse(stored.submissionJson || ''); } catch { throw invalidPurchaseReceiptSubmission(); }
  const parsed = controlledPurchaseReceiptSubmissionSchema.safeParse(raw);
  if (!parsed.success) throw invalidPurchaseReceiptSubmission();
  const ack = parsed.data, fingerprint = controlledPurchaseReceiptFingerprint(ack.facts), f = ack.facts;
  if (requested && (requested.key !== ack.key || controlledPurchaseReceiptFingerprint(requested.facts) !== fingerprint)) {
    throw new AppError('PURCHASE_RECEIPT_KEY_CONFLICT', 409, ErrorCode.CONFLICT);
  }
  if (stored.submissionKey !== ack.key || stored.submissionFingerprint !== fingerprint || ack.fingerprint !== fingerprint
    || JSON.stringify(ack.receipt) !== JSON.stringify(receipt) || receipt.purchaseOrderId !== f.purchaseOrderId || receipt.receivedBy !== f.receivedBy
    || receipt.quantity !== f.quantity || receipt.acceptedQuantity !== f.acceptedQuantity || receipt.rejectedQuantity !== f.rejectedQuantity
    || receipt.supplierBatchNo !== f.batchNo || receipt.note !== f.note || receipt.discrepancyReason !== f.discrepancyReason
    || (f.receivedAt !== null && receipt.receivedAt !== f.receivedAt)) throw invalidPurchaseReceiptSubmission();
  const payable = requireReceiptPayableSource(receipt);
  requireIncomingQualityPlan(payable.binding, receipt.incomingQualityPlanJson);
  if (payable.binding.revision !== f.expectedRevision || !audit || audit.id !== ack.auditId || audit.userId !== f.receivedBy
    || audit.action !== 'CREATE_RECEIPT' || audit.resource !== 'purchase_order' || audit.resourceId !== f.purchaseOrderId
    || audit.details !== JSON.stringify(controlledPurchaseReceiptAuditDetails(ack.key, fingerprint, receipt))) throw invalidPurchaseReceiptSubmission();
  return ack;
}

// Canonical property order is part of the immutable hash. Parse typed persisted
// facts, not a caller's defaults, so QC and finance can verify without guessing.
export function normalizeControlledPurchaseReceipt(row: Record<string, unknown>): ControlledPurchaseReceipt {
  const iso = (value: unknown) => {
    const date = value instanceof Date ? value : new Date(String(value));
    if (!Number.isFinite(date.getTime())) throw invalidPurchaseReceiptSubmission();
    return date.toISOString();
  };
  const result = controlledPurchaseReceiptRowSchema.safeParse({ id: row.id, receiptNo: row.receiptNo, purchaseOrderId: row.purchaseOrderId,
    quantity: row.quantity, acceptedQuantity: row.acceptedQuantity, rejectedQuantity: row.rejectedQuantity, unit: row.unit,
    batchNo: row.batchNo, stockEntryRef: row.stockEntryRef, discrepancyReason: row.discrepancyReason, note: row.note, receivedBy: row.receivedBy,
    receivedAt: iso(row.receivedAt), createdAt: iso(row.createdAt), supplierBatchNo: row.supplierBatchNo, batchId: row.batchId,
    payableAmountNative: payableMoney(row.payableAmountNative, 'payableAmountNative').toFixed(2),
    payableAmountBase: payableMoney(row.payableAmountBase, 'payableAmountBase').toFixed(2),
    payableSnapshotJson: row.payableSnapshotJson, incomingQualityPlanJson: row.incomingQualityPlanJson });
  if (!result.success) throw invalidPurchaseReceiptSubmission();
  return result.data;
}
