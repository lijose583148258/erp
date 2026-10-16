import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import type { TransactionClient } from './stock-movement.types';
import { decodeReceiptDataUrl } from './shipping-receipt-file.service';

const id = z.number().int().positive();
const nullableText = z.string().nullable();
const factsSchema = z.object({ quantity: z.number().finite().positive(), acceptedQuantity: z.number().finite().nonnegative(),
  rejectedQuantity: z.number().finite().nonnegative(), discrepancyType: z.string().min(1), discrepancyReason: nullableText, note: nullableText,
  file: z.object({ name: z.string().min(1), mimeType: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().nullable(),
}).strict();
const receiptSchema = z.object({ id, receiptNo: z.string().min(1), shipmentId: id, quantity: z.number().finite().positive(),
  acceptedQuantity: z.number().finite().nonnegative(), rejectedQuantity: z.number().finite().nonnegative(), unit: z.string().min(1),
  signedReceiptUrl: nullableText, discrepancyReason: nullableText, note: nullableText, receivedBy: id,
  receivedAt: z.string().datetime(), createdAt: z.string().datetime() }).strict();
const keySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/);
const eventSchema = z.object({ schema: z.literal('shipment-receipt-submission/v1'), key: keySchema, actorId: id,
  shipmentId: id, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), facts: factsSchema, receipt: receiptSchema }).strict();
const rejectionCode = z.enum(['SHIPMENT_ALREADY_DELIVERED', 'SHIPMENT_MUST_BE_DISPATCHED_FIRST', 'SHIPMENT_STATUS_NOT_RECEIVABLE',
  'SHIPMENT_ALREADY_FULLY_RECEIVED', 'SHIPMENT_RECEIPT_EXCEEDS_REMAINING', 'RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE']);
const rejectionSchema = z.object({ schema: z.literal('shipment-receipt-rejection/v1'), key: keySchema, actorId: id,
  shipmentId: id, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), facts: factsSchema, code: rejectionCode }).strict();
type Facts = z.infer<typeof factsSchema>;
type Receipt = z.infer<typeof receiptSchema>;
type Db = Pick<TransactionClient, 'auditLog' | 'shipmentReceipt'>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const conflict = (code: string): never => { throw new AppError(code, 409, ErrorCode.CONFLICT); };
const fingerprint = (shipmentId: number, actorId: number, facts: Facts) => hash(JSON.stringify({ shipmentId, actorId, facts }));
const publicRejection = (event: z.infer<typeof rejectionSchema>, auditId: number) => ({ schema: event.schema, key: event.key,
  actorId: event.actorId, shipmentId: event.shipmentId, fingerprint: event.fingerprint, auditId, code: event.code });
export function rejectedShipmentReceiptError(rejection: ReturnType<typeof publicRejection>) {
  return new AppError(rejection.code, 409, ErrorCode.CONFLICT, { rejectedSubmission: rejection });
}

export function shipmentReceiptSubmissionKey(value: unknown): string | null {
  if (value === undefined) return null;
  const result = keySchema.safeParse(value);
  if (!result.success) throw new AppError('SHIPMENT_RECEIPT_KEY_INVALID', 400, ErrorCode.VALIDATION_ERROR);
  return result.data;
}

export function shipmentReceiptFacts(input: { quantity: number; acceptedQuantity?: number; rejectedQuantity?: number;
  discrepancyType?: string; discrepancyReason?: string; note?: string; fileName?: string; mimeType?: string; dataUrl?: string }): Facts {
  let file: Facts['file'] = null;
  if (input.fileName && input.mimeType && input.dataUrl) {
    try { file = { name: input.fileName.trim(), mimeType: input.mimeType, sha256: hash(decodeReceiptDataUrl(input.dataUrl, input.mimeType)) }; }
    catch { throw new AppError('INVALID_RECEIPT_FILE', 400, ErrorCode.VALIDATION_ERROR); }
  }
  return factsSchema.parse({ quantity: input.quantity, acceptedQuantity: input.acceptedQuantity ?? input.quantity,
    rejectedQuantity: input.rejectedQuantity ?? 0, discrepancyType: input.discrepancyType || 'customer_short_signed',
    discrepancyReason: input.discrepancyReason?.trim() || null, note: input.note?.trim() || null,
    file });
}

const snapshot = (row: { id: number; receiptNo: string; shipmentId: number; quantity: number; acceptedQuantity: number;
  rejectedQuantity: number; unit: string; signedReceiptUrl: string | null; discrepancyReason: string | null; note: string | null;
  receivedBy: number | null; receivedAt: Date; createdAt: Date }): Receipt => {
  // Freeze the v1 projection, not the ORM row shape: future unrelated columns
  // must not invalidate old requests or silently enter the signed protocol.
  const iso = (date: Date) => date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
  const parsed = receiptSchema.safeParse({ id: row.id, receiptNo: row.receiptNo, shipmentId: row.shipmentId,
    quantity: row.quantity, acceptedQuantity: row.acceptedQuantity, rejectedQuantity: row.rejectedQuantity, unit: row.unit,
    signedReceiptUrl: row.signedReceiptUrl, discrepancyReason: row.discrepancyReason, note: row.note, receivedBy: row.receivedBy,
    receivedAt: iso(row.receivedAt), createdAt: iso(row.createdAt) });
  if (!parsed.success) conflict('SHIPMENT_RECEIPT_EVIDENCE_INVALID');
  return parsed.data!;
};
function assertReceiptFacts(row: Receipt, shipmentId: number, actorId: number, facts: Facts) {
  if (row.shipmentId !== shipmentId || row.receivedBy !== actorId || row.quantity !== facts.quantity
    || row.acceptedQuantity !== facts.acceptedQuantity || row.rejectedQuantity !== facts.rejectedQuantity
    || row.discrepancyReason !== facts.discrepancyReason || row.note !== facts.note
    || Boolean(row.signedReceiptUrl) !== Boolean(facts.file)) conflict('SHIPMENT_RECEIPT_EVIDENCE_INVALID');
}

// The existing shipment row lock serializes owner lookup + receipt + audit.
// AuditLog is the durable immutable receipt, not a second business ledger/table.
// Legacy prose audits have no request identity and are never backfilled.
export async function readShipmentReceiptSubmission(db: Db, shipmentId: number, key: string, actorId: number, facts?: Facts) {
  // Prisma contains uses LIKE in SQLite (_ wildcard and case folding). Inspect
  // this shipment's receipt audits, then compare actual keys literally in JS.
  const rows = await db.auditLog.findMany({ where: { resource: 'shipment', resourceId: shipmentId,
    action: { in: ['CREATE_RECEIPT_EVENT', 'REJECT_RECEIPT_EVENT'] } }, orderBy: { id: 'asc' } });
  const audits = rows.filter(audit => {
    try { const value = JSON.parse(audit.details || ''); return value?.key === key; }
    catch { return Boolean(audit.details?.includes(`"key":"${key}"`)); }
  });
  if (!audits.length) return null;
  if (audits.length !== 1) conflict('SHIPMENT_RECEIPT_EVIDENCE_INVALID');
  const audit = audits[0];
  let json: unknown;
  try { json = JSON.parse(audit.details || ''); } catch { conflict('SHIPMENT_RECEIPT_EVIDENCE_INVALID'); }
  const rejected = rejectionSchema.safeParse(json);
  if (rejected.success) {
    const event = rejected.data;
    if (audit.action !== 'REJECT_RECEIPT_EVENT' || event.key !== key || event.shipmentId !== shipmentId || event.actorId !== audit.userId
      || event.fingerprint !== fingerprint(shipmentId, event.actorId, event.facts)) conflict('SHIPMENT_RECEIPT_EVIDENCE_INVALID');
    if (event.actorId !== actorId || (facts && !same(event.facts, facts))) conflict('SHIPMENT_RECEIPT_IDEMPOTENCY_CONFLICT');
    throw rejectedShipmentReceiptError(publicRejection(event, audit.id));
  }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) conflict('SHIPMENT_RECEIPT_EVIDENCE_INVALID');
  const event = parsed.data!;
  if (audit.action !== 'CREATE_RECEIPT_EVENT' || event.key !== key || event.shipmentId !== shipmentId || audit.userId !== event.actorId
    || event.fingerprint !== fingerprint(shipmentId, event.actorId, event.facts)) conflict('SHIPMENT_RECEIPT_EVIDENCE_INVALID');
  if (event.actorId !== actorId || (facts && !same(event.facts, facts))) conflict('SHIPMENT_RECEIPT_IDEMPOTENCY_CONFLICT');
  const row = await db.shipmentReceipt.findUnique({ where: { id: event.receipt.id } });
  if (!row || !same(snapshot(row), event.receipt)) conflict('SHIPMENT_RECEIPT_EVIDENCE_INVALID');
  assertReceiptFacts(event.receipt, shipmentId, actorId, event.facts);
  return { ...event, auditId: audit.id };
}

// Only pre-write business rejections enter this branch. Commit the rejection
// under the same row lock, so a delayed old request can never succeed after the
// browser is allowed to correct its input. Unknown faults never mint this proof.
export async function recordShipmentReceiptRejection(tx: Db, shipmentId: number, actorId: number, key: string, facts: Facts,
  code: z.infer<typeof rejectionCode>, metadata: { ipAddress?: string; userAgent?: string }) {
  const event = rejectionSchema.parse({ schema: 'shipment-receipt-rejection/v1', key, actorId, shipmentId,
    fingerprint: fingerprint(shipmentId, actorId, facts), facts, code });
  const audit = await tx.auditLog.create({ data: { userId: actorId, action: 'REJECT_RECEIPT_EVENT', resource: 'shipment', resourceId: shipmentId,
    details: JSON.stringify(event), ...metadata } });
  return publicRejection(event, audit.id);
}

export async function recordShipmentReceiptSubmission(tx: Db, shipmentId: number, receiptId: number, actorId: number,
  key: string | null, facts: Facts, metadata: { ipAddress?: string; userAgent?: string }) {
  const row = await tx.shipmentReceipt.findUniqueOrThrow({ where: { id: receiptId } });
  const receipt = snapshot(row);
  assertReceiptFacts(receipt, shipmentId, actorId, facts);
  const event = key ? eventSchema.parse({ schema: 'shipment-receipt-submission/v1', key, actorId, shipmentId,
    fingerprint: fingerprint(shipmentId, actorId, facts), facts, receipt }) : null;
  const audit = await tx.auditLog.create({ data: { userId: actorId, action: 'CREATE_RECEIPT_EVENT', resource: 'shipment', resourceId: shipmentId,
    details: event ? JSON.stringify(event) : `新增签收批次 ${row.receiptNo}`, ...metadata } });
  return event ? { ...event, auditId: audit.id } : null;
}
