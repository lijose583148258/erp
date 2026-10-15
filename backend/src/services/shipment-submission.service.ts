import { createHash } from 'node:crypto';
import { z } from 'zod';
import prisma from '../config/database';
import type { TransactionClient } from './stock-movement.service';
import { resolveShipmentIdentity } from './shipment-material-identity';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import { assertSupplementedBatchMatches } from './shipment-supplement.service';
import { StockMovementConflictError } from './stock-movement.errors';

export class ShipmentSubmissionError extends Error {
  constructor(public readonly code: string, public readonly status = 409, public readonly details?: Record<string, unknown>) { super(code); }
}
const id = z.number().int().positive();
const text = z.string().trim();
const factsSchema = z.object({
  customerId: id, orderId: id.nullable(), orderItemId: id.nullable(), materialId: id.nullable(),
  productName: text.min(1), quantity: z.number().positive().finite(), unit: text.min(1),
  batchNo: text.nullable(), packageType: text.nullable(), carrier: text.nullable(), trackingNo: text.nullable(),
});
export type ShipmentSubmissionFacts = z.infer<typeof factsSchema>;
const snapshotSchema = factsSchema.extend({ id, shipmentNo: z.string().min(1), productBatchId: id.nullable(),
  createdBy: id, createdAt: z.string().datetime(), status: z.literal('pending') }).strict();
const submissionSchema = z.object({ schema: z.literal('shipment-submission/v1'), key: z.string(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), actorId: id, auditId: id, facts: factsSchema,
  shipment: snapshotSchema }).strict();
type Submission = z.infer<typeof submissionSchema>;
type Meta = { userId: number; ipAddress?: string; userAgent?: string };
const fail = (code = 'SHIPMENT_SUBMISSION_EVIDENCE_INVALID', status = 409): never => { throw new ShipmentSubmissionError(code, status); };
export function shipmentSubmissionKey(header: unknown, body?: unknown): string | null {
  if (header === undefined && body === undefined) return null; // Existing integrations remain readable/writable.
  if (header !== undefined && body !== undefined && header !== body) fail('SHIPMENT_SUBMISSION_KEY_MISMATCH', 400);
  const key = header ?? body;
  if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(key)) fail('SHIPMENT_SUBMISSION_KEY_INVALID', 400);
  return key as string;
}
export function shipmentSubmissionFacts(input: Record<string, unknown>): ShipmentSubmissionFacts {
  const supported = ['customerId', 'orderId', 'orderItemId', 'materialId', 'productName', 'quantity', 'unit',
    'batchNo', 'packageType', 'carrier', 'trackingNo', 'idempotencyKey'];
  // These fields were ignored by the old create route. A governed ACK must not claim to save them.
  if (Object.keys(input).some(key => !supported.includes(key))) fail('SHIPMENT_SUBMISSION_UNSUPPORTED_FIELD', 400);
  const optionalId = (v: unknown) => v === undefined || v === null || v === '' ? null : Number(v);
  const optionalText = (v: unknown) => v === undefined || v === null || v === '' ? null : v;
  const parsed = factsSchema.safeParse({ customerId: Number(input.customerId), orderId: optionalId(input.orderId),
    orderItemId: optionalId(input.orderItemId), materialId: optionalId(input.materialId), productName: input.productName,
    quantity: Number(input.quantity), unit: input.unit ?? '件', batchNo: optionalText(input.batchNo),
    packageType: optionalText(input.packageType), carrier: optionalText(input.carrier), trackingNo: optionalText(input.trackingNo) });
  if (!parsed.success) fail('SHIPMENT_SUBMISSION_FACTS_INVALID', 400);
  return parsed.data!;
}
const fingerprint = (actorId: number, facts: ShipmentSubmissionFacts) => createHash('sha256').update(JSON.stringify({ actorId, facts })).digest('hex');
const auditDetails = (s: Omit<Submission, 'auditId' | 'schema'>) => JSON.stringify({ schema: 'shipment-create/v1',
  key: s.key, fingerprint: s.fingerprint, actorId: s.actorId, facts: s.facts, shipment: s.shipment });
async function readReplay(tx: TransactionClient, key: string, actorId: number, expected?: ShipmentSubmissionFacts) {
  const row = await tx.shipment.findUnique({ where: { submissionKey: key } });
  if (!row || row.createdBy !== actorId) {
    if (row && expected) fail('SHIPMENT_SUBMISSION_CONFLICT');
    return null; // Lookup must not disclose a different actor's shipment.
  }
  let raw: unknown; try { raw = JSON.parse(row.submissionJson || ''); } catch { fail(); }
  const parsed = submissionSchema.safeParse(raw); if (!parsed.success) fail();
  const s = parsed.data!;
  if (s.key !== key || s.actorId !== actorId || s.fingerprint !== row.submissionFingerprint
    || s.fingerprint !== fingerprint(s.actorId, s.facts)) fail();
  if (expected && s.fingerprint !== fingerprint(actorId, expected)) fail('SHIPMENT_SUBMISSION_CONFLICT');
  for (const field of ['id', 'shipmentNo', 'customerId', 'orderId', 'orderItemId', 'materialId',
    'productName', 'quantity', 'unit', 'createdBy'] as const) if (row[field] !== s.shipment[field]) fail();
  try { await assertSupplementedBatchMatches(tx, row, s.shipment); }
  catch (error) { if (error instanceof StockMovementConflictError) fail(); throw error; }
  if (row.createdAt.toISOString() !== s.shipment.createdAt) fail();
  const audit = await tx.auditLog.findUnique({ where: { id: s.auditId } });
  if (!audit || audit.userId !== actorId || audit.resource !== 'shipment' || audit.resourceId !== row.id
    || audit.action !== 'CREATE' || audit.details !== auditDetails(s)) fail();
  return { shipment: s.shipment, submission: s, replayed: true };
}
export async function findShipmentSubmission(key: string, actorId: number) {
  return prisma.$transaction(tx => readReplay(tx, key, actorId), { isolationLevel: 'Serializable' });
}

export async function createShipmentDraft(input: Record<string, unknown>, meta: Meta, key: string | null) {
  const facts = key ? shipmentSubmissionFacts(input) : null;
  const create = () => prisma.$transaction(async tx => {
    if (key && facts) { const replay = await readReplay(tx, key, meta.userId, facts); if (replay) return replay; }
    const source = facts ?? input;
    const identity = await resolveShipmentIdentity(tx, { customerId: Number(source.customerId),
      orderId: source.orderId ? Number(source.orderId) : null, orderItemId: source.orderItemId ? Number(source.orderItemId) : null,
      materialId: source.materialId ? Number(source.materialId) : null, productName: String(source.productName),
      quantity: Number(source.quantity), unit: String(source.unit ?? '件'), batchNo: source.batchNo ? String(source.batchNo) : null });
    const row = await tx.shipment.create({ data: { shipmentNo: buildBusinessNo('SHP'), customerId: Number(source.customerId),
      ...identity, quantity: Number(source.quantity), packageType: source.packageType as string | undefined,
      carrier: source.carrier as string | undefined, trackingNo: source.trackingNo as string | undefined,
      status: 'pending', reservationState: 'unreserved', createdBy: meta.userId, submissionKey: key, submissionFingerprint: facts ? fingerprint(meta.userId, facts) : null } });
    const snapshot = key ? snapshotSchema.parse({ ...Object.fromEntries(Object.keys(factsSchema.shape).map(field => [field, row[field as keyof typeof row]])),
      id: row.id, shipmentNo: row.shipmentNo, productBatchId: row.productBatchId, createdBy: row.createdBy, status: 'pending', createdAt: row.createdAt.toISOString() }) : null;
    const draft = key && facts && snapshot ? { key, fingerprint: fingerprint(meta.userId, facts), actorId: meta.userId, facts, shipment: snapshot } : null;
    const audit = await tx.auditLog.create({ data: { userId: meta.userId, action: 'CREATE', resource: 'shipment', resourceId: row.id,
      details: draft ? auditDetails(draft) : `创建发货单 ${row.shipmentNo}${row.orderId ? `，关联订单 #${row.orderId}` : ''}`,
      ipAddress: meta.ipAddress, userAgent: meta.userAgent } });
    if (!draft) return { shipment: row, submission: null, replayed: false };
    const submission = submissionSchema.parse({ schema: 'shipment-submission/v1', ...draft, auditId: audit.id });
    await tx.shipment.update({ where: { id: row.id }, data: { submissionJson: JSON.stringify(submission) } });
    return { shipment: draft.shipment, submission, replayed: false };
  }, { isolationLevel: 'Serializable' });
  try { return await withDbRetry(create, { label: 'createShipment' }); }
  catch (error) {
    // A cross-node unique-key race aborts the entire losing transaction first.
    if (key && facts && (error as { code?: string })?.code === 'P2002') {
      const replay = await prisma.$transaction(tx => readReplay(tx, key, meta.userId, facts), { isolationLevel: 'Serializable' });
      if (replay) return replay;
    }
    const code = error instanceof Error ? error.message : '';
    // Only known business validation errors prove this transaction rolled back.
    // Connection loss, timeouts, duplicate-key conflicts and bad stored evidence are never rejection receipts.
    const rejected = ['SHIPMENT_ORDER_ITEM_NOT_FOUND', 'SHIPMENT_ORDER_NOT_FOUND', 'SHIPMENT_PRODUCT_BATCH_NOT_FOUND',
      'SHIPMENT_ORDER_ITEM_ORDER_MISMATCH', 'SHIPMENT_ORDER_ITEM_CUSTOMER_MISMATCH', 'SHIPMENT_ORDER_ITEM_MATERIAL_MISMATCH',
      'SHIPMENT_ORDER_CUSTOMER_MISMATCH', 'SHIPMENT_ORDER_STATUS_INVALID', 'SHIPMENT_ORDER_ON_HOLD',
      'SHIPMENT_ORDER_ITEM_QUANTITY_EXCEEDED', 'STOCK_MATERIAL_UNIT_MISMATCH'].includes(code)
      || code.startsWith('SHIPMENT_PRODUCT_BATCH_NOT_RELEASED:');
    if (key && facts && rejected && !(error instanceof ShipmentSubmissionError)) {
      throw new ShipmentSubmissionError(code, code.endsWith('_NOT_FOUND') ? 404 : 409, {
        rejectedSubmission: { schema: 'shipment-rejection/v1', key, actorId: meta.userId, fingerprint: fingerprint(meta.userId, facts), code },
      });
    }
    throw error;
  }
}
