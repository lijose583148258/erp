import type { Shipment } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';
import { withDbRetry } from '../utils/dbRetry';
import type { TransactionClient } from './stock-movement.types';
import { StockMovementConflictError } from './stock-movement.errors';

const id = z.number().int().positive();
const optionalText = z.string().trim().min(1).max(120).nullable();
// Store the supplied offset AND named zone. Never interpret a foreign wall clock
// in the server's zone, and never substitute entry time for unknown event time.
export const shipmentOccurrenceSchema = z.object({
  occurredAt: z.string().datetime({ offset: true }), timeZone: z.string().trim().min(1).max(80),
}).strict().superRefine((value, ctx) => {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: value.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value.occurredAt));
    const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
    if (`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}` !== value.occurredAt.slice(0, 19)) throw new Error('Zone mismatch');
  } catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: '实际时间的日期、UTC 偏移与地区时区不一致', path: ['occurredAt'] }); }
});
const patchSchema = z.object({ batchNo: z.string().trim().min(1).max(120).optional(), carrier: optionalText.optional(),
  trackingNo: optionalText.optional(), dispatchOccurrence: shipmentOccurrenceSchema.nullable().optional() }).strict()
  .refine(value => Object.keys(value).length > 0, '至少补充一项资料');
export const shipmentSupplementSchema = z.object({ expectedAuditId: id.nullable(), expectedUpdatedAt: z.string().datetime(),
  patch: patchSchema, reason: z.string().trim().min(3).max(500).optional() }).strict();
const snapshotSchema = z.object({ batchNo: z.string().nullable(), productBatchId: id.nullable(), carrier: z.string().nullable(),
  trackingNo: z.string().nullable(), dispatchOccurrence: shipmentOccurrenceSchema.nullable() }).strict();
const identitySchema = z.object({ shipmentNo: z.string(), customerId: id, orderId: id.nullable(), orderItemId: id.nullable(),
  materialId: id.nullable(), quantity: z.number().positive().finite(), unit: z.string().min(1) });
const eventSchema = z.object({ schema: z.literal('shipment-supplement/v1'), shipmentId: id, actorId: id,
  identity: identitySchema, input: shipmentSupplementSchema, before: snapshotSchema, after: snapshotSchema }).strict();
type Input = z.infer<typeof shipmentSupplementSchema>;
type Snapshot = z.infer<typeof snapshotSchema>;
function conflict(code: string): never { throw new StockMovementConflictError(code); }
const identity = (row: Shipment) => identitySchema.parse(row);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const snapshot = (row: Shipment, dispatchOccurrence: Snapshot['dispatchOccurrence']): Snapshot => ({
  batchNo: row.batchNo, productBatchId: row.productBatchId, carrier: row.carrier, trackingNo: row.trackingNo, dispatchOccurrence,
});

async function readEvents(tx: TransactionClient, row: Shipment) {
  const audits = await tx.auditLog.findMany({ where: { resource: 'shipment', resourceId: row.id, action: 'SUPPLEMENT_SHIPMENT' }, orderBy: { id: 'asc' } });
  let previousId: number | null = null;
  return audits.map(audit => {
    let json: unknown; try { json = JSON.parse(audit.details || ''); } catch { conflict('SHIPMENT_SUPPLEMENT_EVIDENCE_INVALID'); }
    const parsed = eventSchema.safeParse(json);
    if (!parsed.success) conflict('SHIPMENT_SUPPLEMENT_EVIDENCE_INVALID');
    const event = parsed.data!;
    if (event.shipmentId !== row.id || event.actorId !== audit.userId || !same(event.identity, identity(row))
      || event.input.expectedAuditId !== previousId) conflict('SHIPMENT_SUPPLEMENT_EVIDENCE_INVALID');
    for (const field of ['carrier', 'trackingNo', 'dispatchOccurrence'] as const) {
      const expected = field in event.input.patch ? event.input.patch[field] : event.before[field];
      if (!same(event.after[field], expected)) conflict('SHIPMENT_SUPPLEMENT_EVIDENCE_INVALID');
    }
    if (event.input.patch.batchNo !== undefined) {
      if (event.before.batchNo !== null || event.before.productBatchId !== null || event.after.batchNo !== event.input.patch.batchNo
        || !event.after.productBatchId) conflict('SHIPMENT_SUPPLEMENT_EVIDENCE_INVALID');
    } else if (event.before.batchNo !== event.after.batchNo || event.before.productBatchId !== event.after.productBatchId) conflict('SHIPMENT_SUPPLEMENT_EVIDENCE_INVALID');
    previousId = audit.id;
    return { auditId: audit.id, enteredAt: audit.createdAt.toISOString(), ...event };
  });
}

// Original creation ACKs stay immutable. A NULL -> real batch transition needs
// its own exact, actor-bound audit, rather than weakening original ACK checks.
export async function assertSupplementedBatchMatches(tx: TransactionClient, row: Shipment,
  original: { batchNo: string | null; productBatchId: number | null }) {
  if (row.batchNo === original.batchNo && row.productBatchId === original.productBatchId) return;
  if (original.batchNo !== null || original.productBatchId !== null) conflict('SHIPMENT_SUBMISSION_EVIDENCE_INVALID');
  const events = (await readEvents(tx, row)).filter(event => event.input.patch.batchNo !== undefined);
  if (events.length !== 1 || events[0].after.batchNo !== row.batchNo || events[0].after.productBatchId !== row.productBatchId) conflict('SHIPMENT_SUBMISSION_EVIDENCE_INVALID');
}
async function readView(tx: TransactionClient, row: Shipment) {
  const events = await readEvents(tx, row), last = events.at(-1);
  return { shipment: row, versionId: last?.auditId ?? null, dispatchOccurrence: last?.after.dispatchOccurrence ?? null,
    history: events.map(({ auditId, actorId, enteredAt, input, before, after }) => ({ auditId, actorId, enteredAt, reason: input.reason ?? null,
      changedFields: Object.keys(input.patch), before, after })) };
}
export async function readShipmentSupplement(id: number) {
  return prisma.$transaction(async tx => {
    const row = await tx.shipment.findUnique({ where: { id } });
    if (!row) conflict('SHIPMENT_SUPPLEMENT_NOT_FOUND');
    return readView(tx, row!);
  }, { isolationLevel: 'Serializable' });
}
export async function supplementShipment(id: number, raw: Input, actorId: number) {
  const input = shipmentSupplementSchema.parse(raw);
  if (!Number.isSafeInteger(actorId) || actorId <= 0) conflict('SHIPMENT_SUPPLEMENT_ACTOR_REQUIRED');
  return withDbRetry(() => prisma.$transaction(async tx => {
    if (await tx.$executeRaw`UPDATE "shipments" SET "status" = "status" WHERE "id" = ${id}` !== 1) conflict('SHIPMENT_SUPPLEMENT_NOT_FOUND');
    const row = (await tx.shipment.findUnique({ where: { id } }))!;
    const events = await readEvents(tx, row), last = events.at(-1);
    if (last?.actorId === actorId && same(last.input, input)) return { ...await readView(tx, row), replayed: true };
    if (input.expectedAuditId !== (last?.auditId ?? null) || input.expectedUpdatedAt !== row.updatedAt.toISOString()) conflict('SHIPMENT_SUPPLEMENT_STALE');
    const before = snapshot(row, last?.after.dispatchOccurrence ?? null), after = { ...before };
    for (const field of ['carrier', 'trackingNo', 'dispatchOccurrence'] as const) {
      if (field in input.patch) Object.assign(after, { [field]: input.patch[field] });
      if (before[field] !== null && !same(before[field], after[field]) && !input.reason) conflict('SHIPMENT_SUPPLEMENT_CORRECTION_REASON_REQUIRED');
    }
    if (input.patch.dispatchOccurrence) {
      if (!row.shippedAt || row.status === 'pending') conflict('SHIPMENT_SUPPLEMENT_DISPATCH_NOT_POSTED');
      if (Date.parse(input.patch.dispatchOccurrence.occurredAt) > Date.now() + 300_000) conflict('SHIPMENT_SUPPLEMENT_FUTURE_OCCURRENCE');
    }
    if (input.patch.batchNo !== undefined) {
      if (row.status !== 'pending' || row.batchNo !== null || row.productBatchId !== null || row.reservationAuditId !== null
        || ![null, 'unreserved'].includes(row.reservationState) || row.reservationBalanceId !== null || row.reservationQuantity !== null) conflict('SHIPMENT_SUPPLEMENT_BATCH_FROZEN');
      if (!row.materialId || await tx.stockEntry.findFirst({ where: { sourceType: 'shipping_issue', sourceRef: row.shipmentNo }, select: { id: true } })) conflict('SHIPMENT_SUPPLEMENT_BATCH_FROZEN');
      const batch = await tx.productBatch.findUnique({ where: { batchNo: input.patch.batchNo } });
      if (!batch || batch.materialId !== row.materialId || batch.unit !== row.unit) conflict('SHIPMENT_SUPPLEMENT_BATCH_IDENTITY_REQUIRED');
      after.batchNo = batch.batchNo; after.productBatchId = batch.id;
    }
    if (same(before, after)) return { ...await readView(tx, row), replayed: true };
    const event = eventSchema.parse({ schema: 'shipment-supplement/v1', shipmentId: id, actorId, identity: identity(row), input, before, after });
    await tx.shipment.update({ where: { id }, data: { carrier: after.carrier, trackingNo: after.trackingNo,
      batchNo: after.batchNo, productBatchId: after.productBatchId, updatedAt: new Date() } });
    await tx.auditLog.create({ data: { userId: actorId, action: 'SUPPLEMENT_SHIPMENT', resource: 'shipment', resourceId: id, details: JSON.stringify(event) } });
    return { ...await readView(tx, (await tx.shipment.findUnique({ where: { id } }))!), replayed: false };
  }, { isolationLevel: 'Serializable' }), { label: 'shipmentSupplement' });
}
