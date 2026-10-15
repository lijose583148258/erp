import type { Shipment, StockBalance, AuditLog, Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';
import { withDbRetry } from '../utils/dbRetry';
import type { TransactionClient, StockMovementLineInput } from './stock-movement.types';
import { StockMovementConflictError } from './stock-movement.errors';
import { assertStockQualityForIssue } from './stock-quality-issue.service';
import { assertMaterialReleaseReadiness } from './material-release-readiness.service';

const positiveId = z.number().int().positive();
export const reserveShipmentSchema = z.object({ expectedAuditId: positiveId.nullable() }).strict();
export const releaseShipmentSchema = reserveShipmentSchema.extend({ reason: z.string().trim().min(3).max(500) });
const eventSchema = z.object({ schema: z.literal('shipment-reservation/v1'), action: z.enum(['reserve', 'release', 'consume']),
  shipmentId: positiveId, previousAuditId: positiveId.nullable(), actorId: positiveId, stockBalanceId: positiveId,
  locationId: positiveId, materialId: positiveId, batchNo: z.string().min(1), quantity: z.number().positive(),
  unit: z.string().min(1), reason: z.string().nullable() }).strict();
type ReservationEvent = z.infer<typeof eventSchema>;
type ReservationRow = Pick<Shipment, 'id' | 'shipmentNo' | 'quantity' | 'unit' | 'materialId' | 'batchNo' | 'orderId' | 'status'
  | 'reservationState' | 'reservationBalanceId' | 'reservationQuantity' | 'reservationAuditId'>;
export type ReservationReadRow = Partial<ReservationRow> & { orderItemId?: number | null };
export type ShipmentReservationView = { state: 'legacy_unknown' | 'needs_review' | 'unreserved' | 'reserved' | 'released' | 'consumed';
  activeQuantity: number | null; auditId: number | null };
export const SHIPMENT_RESERVATION_READ_SELECT = { id: true, shipmentNo: true, orderId: true, orderItemId: true,
  quantity: true, unit: true, materialId: true, batchNo: true, status: true,
  reservationState: true, reservationBalanceId: true, reservationQuantity: true, reservationAuditId: true,
} as const satisfies Prisma.ShipmentSelect;
const conflict = (message: string): never => { throw new StockMovementConflictError(message); };
const actions = { reserve: 'RESERVE_STOCK', release: 'RELEASE_STOCK', consume: 'CONSUME_RESERVATION' } as const;
const states = { reserve: 'reserved', release: 'released', consume: 'consumed' } as const;

// All quantities here are canonical material base units at the existing six-place stock precision.
export function reservationMicros(value: number, allowBalanceNoise = false): bigint {
  const n = Math.round(value * 1_000_000);
  if (!Number.isFinite(value) || !Number.isSafeInteger(n)
    || (!allowBalanceNoise && value !== n / 1_000_000)
    || Math.abs(value - n / 1_000_000) > Number.EPSILON * Math.max(1, Math.abs(value)) * 16) conflict('SHIPMENT_RESERVATION_PRECISION_INVALID');
  return BigInt(n);
}
function validateProof(row: ReservationRow, audit: AuditLog | null, balance?: StockBalance) {
  if ((!row.reservationState || row.reservationState === 'unreserved') && row.reservationBalanceId === null
    && row.reservationQuantity === null && row.reservationAuditId === null) return null;
  if (!row.reservationAuditId || !row.reservationBalanceId || !row.reservationQuantity) conflict('SHIPMENT_RESERVATION_EVIDENCE_INVALID');
  let json: unknown; try { json = JSON.parse(audit?.details || ''); } catch { conflict('SHIPMENT_RESERVATION_EVIDENCE_INVALID'); }
  const parsed = eventSchema.safeParse(json); if (!parsed.success) conflict('SHIPMENT_RESERVATION_EVIDENCE_INVALID');
  const event = parsed.data!;
  if (!audit || audit.resource !== 'shipment' || audit.resourceId !== row.id || audit.userId !== event.actorId
    || audit.action !== actions[event.action] || row.reservationState !== states[event.action]
    || event.shipmentId !== row.id || event.stockBalanceId !== row.reservationBalanceId || event.materialId !== row.materialId
    || event.batchNo !== row.batchNo || event.quantity !== row.reservationQuantity || event.quantity !== row.quantity
    || event.unit !== row.unit || reservationMicros(event.quantity) <= 0n
    || (balance && (balance.id !== event.stockBalanceId || balance.locationId !== event.locationId || balance.materialId !== event.materialId
      || balance.batchNo !== event.batchNo || balance.unit !== event.unit))) conflict('SHIPMENT_RESERVATION_EVIDENCE_INVALID');
  return { ...event, auditId: audit!.id };
}
async function readProof(tx: TransactionClient, row: ReservationRow, balance?: StockBalance) {
  const audit = row.reservationAuditId ? await tx.auditLog.findUnique({ where: { id: row.reservationAuditId } }) : null;
  return validateProof(row, audit, balance);
}

// Batch only the exact proof IDs already selected on visible shipments. Order
// and warehouse readbacks reuse the write guard's validator, not a second truth.
export async function readShipmentReservationViews(db: Pick<TransactionClient, 'auditLog'>, rows: readonly ReservationReadRow[]) {
  const ids = [...new Set(rows.map(row => row.reservationAuditId).filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0))];
  const audits = new Map((ids.length ? await db.auditLog.findMany({ where: { id: { in: ids } } }) : []).map(a => [a.id, a]));
  const views = new Map<number, ShipmentReservationView>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.id) || row.id! <= 0) continue;
    const unknown: ShipmentReservationView = { state: 'legacy_unknown', activeQuantity: null, auditId: null };
    const invalid: ShipmentReservationView = { state: 'needs_review', activeQuantity: null, auditId: null };
    if (views.has(row.id!)) { views.set(row.id!, invalid); continue; }
    if ([row.reservationState, row.reservationBalanceId, row.reservationQuantity, row.reservationAuditId].every(value => value === undefined)) { views.set(row.id!, unknown); continue; }
    try {
      const proof = validateProof(row as ReservationRow, audits.get(row.reservationAuditId!) ?? null);
      if (row.reservationState == null && !proof) { views.set(row.id!, unknown); continue; }
      if (!['unreserved', 'reserved', 'released', 'consumed'].includes(row.reservationState!) || !Number.isFinite(row.quantity)
        || row.quantity! <= 0 || (row.reservationState === 'reserved' && row.status !== 'pending')) conflict('SHIPMENT_RESERVATION_EVIDENCE_INVALID');
      views.set(row.id!, { state: row.reservationState as ShipmentReservationView['state'], activeQuantity: row.reservationState === 'reserved' ? proof!.quantity : 0, auditId: proof?.auditId ?? null });
    } catch (error) {
      if (!(error instanceof StockMovementConflictError)) throw error;
      views.set(row.id!, invalid);
    }
  }
  return views;
}
async function lockBalance(tx: TransactionClient, id: number) {
  const changed = await tx.$executeRaw`UPDATE "stock_balances" SET "quantity" = "quantity" WHERE "id" = ${id}`;
  if (changed !== 1) conflict('SHIPMENT_RESERVATION_STOCK_NOT_FOUND');
  const balance = await tx.stockBalance.findUnique({ where: { id } });
  if (!balance) conflict('SHIPMENT_RESERVATION_STOCK_NOT_FOUND');
  return balance!;
}
async function heldQuantity(tx: TransactionClient, balance: StockBalance) {
  const rows = await tx.shipment.findMany({ where: { reservationBalanceId: balance.id,
    OR: [{ reservationState: 'reserved' }, { reservationState: null }, { reservationState: { notIn: ['unreserved', 'reserved', 'released', 'consumed'] } }] } });
  let held = 0n;
  for (const row of rows) { await readProof(tx, row, balance); if (row.reservationState !== 'reserved') conflict('SHIPMENT_RESERVATION_EVIDENCE_INVALID'); held += reservationMicros(row.reservationQuantity!); }
  return held;
}

// Called AFTER the shared balance write, before any batch/cost posting. It has
// no sourceType/sourceRef exemption: a forged shipping source cannot steal a hold.
export async function assertPhysicalReservationsAfterMovement(tx: TransactionClient, balance: StockBalance, line: StockMovementLineInput) {
  if (line.quantityDelta >= 0) return;
  const held = await heldQuantity(tx, balance);
  if (held > 0n && reservationMicros(balance.quantity, true) < held) conflict('STOCK_RESERVED_FOR_SHIPMENT');
}
async function writeEvent(tx: TransactionClient, row: ReservationRow, event: ReservationEvent) {
  const data = eventSchema.parse(event);
  const audit = await tx.auditLog.create({ data: { userId: data.actorId, resource: 'shipment', resourceId: row.id,
    action: actions[data.action], details: JSON.stringify(data) } });
  await tx.shipment.update({ where: { id: row.id }, data: { reservationState: states[data.action], reservationQuantity: data.quantity,
    reservationBalanceId: data.stockBalanceId, reservationAuditId: audit.id } });
  return { ...data, auditId: audit.id };
}

export async function changeShipmentReservation(id: number, action: 'reserve' | 'release', input: { expectedAuditId: number | null; reason?: string }, actorId: number) {
  if (!Number.isSafeInteger(actorId) || actorId <= 0) conflict('SHIPMENT_RESERVATION_ACTOR_REQUIRED');
  (action === 'reserve' ? reserveShipmentSchema : releaseShipmentSchema).parse(input);
  return withDbRetry(() => prisma.$transaction(async tx => {
    const initial = await tx.shipment.findUnique({ where: { id } });
    if (!initial) conflict('SHIPMENT_RESERVATION_NOT_FOUND');
    // Keep the established order -> shipment -> stock -> batch lock order,
    // without pretending that lock-only replays changed a business document.
    if (action === 'reserve' && initial!.orderId) await tx.$executeRaw`UPDATE "orders" SET "status" = "status" WHERE "id" = ${initial!.orderId}`;
    const claim = await tx.$executeRaw`UPDATE "shipments" SET "status" = "status" WHERE "id" = ${id}`;
    if (claim !== 1) conflict('SHIPMENT_RESERVATION_NOT_FOUND');
    const row = (await tx.shipment.findUnique({ where: { id } }))!;
    const prior = await readProof(tx, row);
    // Generation-bound replays cannot recreate a released hold or release a newer one.
    if (prior?.action === action && prior.previousAuditId === input.expectedAuditId && prior.actorId === actorId
      && prior.reason === (input.reason ?? null)) return { reservation: prior, replayed: true };
    if (row.reservationAuditId !== input.expectedAuditId) conflict('SHIPMENT_RESERVATION_STALE');
    if (row.status !== 'pending' && !(action === 'release' && row.status === 'exception')) conflict('SHIPMENT_RESERVATION_STATE_INVALID');
    if (await tx.stockEntry.findFirst({ where: { sourceType: 'shipping_issue', sourceRef: row.shipmentNo }, select: { id: true } })) conflict('SHIPMENT_RESERVATION_ALREADY_DISPATCHED');
    if (action === 'release') {
      if (!prior || row.reservationState !== 'reserved') conflict('SHIPMENT_RESERVATION_NOT_HELD');
      const balance = await lockBalance(tx, prior!.stockBalanceId); await readProof(tx, row, balance);
      const { auditId: _auditId, ...event } = prior!;
      return { reservation: await writeEvent(tx, row, { ...event, schema: 'shipment-reservation/v1', action, actorId,
        previousAuditId: row.reservationAuditId, reason: input.reason! }), replayed: false };
    }
    if (row.reservationState === 'reserved') conflict('SHIPMENT_RESERVATION_ALREADY_HELD');
    if (row.orderId) {
      const order = await tx.order.findUnique({ where: { id: row.orderId }, select: { status: true, shipmentHold: true } });
      if (!order || !['confirmed', 'shipped', 'delivered'].includes(order.status) || order.shipmentHold) conflict('SHIPMENT_RESERVATION_ORDER_BLOCKED');
    }
    if (!row.materialId || !row.batchNo || reservationMicros(row.quantity) <= 0n) conflict('SHIPMENT_RESERVATION_IDENTITY_REQUIRED');
    await assertMaterialReleaseReadiness(tx, { entityType: 'shipment', entityId: id, action: 'reserve',
      lines: [{ lineKey: row.id, materialId: row.materialId, displayName: row.productName, unit: row.unit }] });
    const location = await tx.location.findFirst({ where: { code: 'LOC-FG', status: 'active' }, select: { id: true } });
    if (!location) conflict('SHIPMENT_RESERVATION_LOCATION_REQUIRED');
    const candidate = await tx.stockBalance.findUnique({ where: { locationId_materialId_batchNo: { locationId: location!.id, materialId: row.materialId!, batchNo: row.batchNo! } } });
    if (!candidate) conflict('SHIPMENT_RESERVATION_STOCK_NOT_FOUND');
    const balance = await lockBalance(tx, candidate!.id);
    if (balance.unit !== row.unit || balance.materialId !== row.materialId || balance.batchNo !== row.batchNo) conflict('SHIPMENT_RESERVATION_IDENTITY_REQUIRED');
    const line = { locationId: balance.locationId, materialId: balance.materialId, productName: balance.productName, batchNo: balance.batchNo, quantityDelta: -row.quantity, unit: balance.unit };
    await assertStockQualityForIssue(tx, 'shipping_issue', line);
    const held = await heldQuantity(tx, balance);
    if (reservationMicros(balance.quantity, true) - held < reservationMicros(row.quantity)) conflict('SHIPMENT_RESERVATION_INSUFFICIENT');
    const reservation = await writeEvent(tx, row, { schema: 'shipment-reservation/v1', action, shipmentId: id, actorId,
      previousAuditId: row.reservationAuditId, stockBalanceId: balance.id, locationId: balance.locationId,
      materialId: row.materialId!, batchNo: row.batchNo!, quantity: row.quantity, unit: row.unit, reason: null });
    return { reservation, replayed: false };
  }, { isolationLevel: 'Serializable' }), { label: 'shipmentReservation' });
}

// The caller already holds the shipment row. Stage consumption, post the real
// issue, then audit; any error rolls the entire caller-owned transaction back.
export async function withShipmentReservationConsumption<T>(tx: TransactionClient, shipmentNo: string, balance: StockBalance, actorId: number | null, post: () => Promise<T>) {
  const row = await tx.shipment.findUnique({ where: { shipmentNo } });
  if (!row) conflict('SHIPMENT_RESERVATION_NOT_FOUND');
  const prior = await readProof(tx, row!);
  if (!prior || row!.reservationState !== 'reserved') return post();
  if (!actorId || !Number.isSafeInteger(actorId) || actorId <= 0) conflict('SHIPMENT_RESERVATION_ACTOR_REQUIRED');
  await readProof(tx, row!, balance);
  const claim = await tx.shipment.updateMany({ where: { id: row!.id, reservationState: 'reserved', reservationAuditId: prior!.auditId }, data: { reservationState: 'consumed' } });
  if (claim.count !== 1) conflict('SHIPMENT_RESERVATION_STALE');
  const result = await post();
  const { auditId: _id, ...event } = prior!;
  await writeEvent(tx, row!, { ...event, action: 'consume', actorId: actorId!, previousAuditId: prior!.auditId, reason: 'Actual shipment stock issue posted' });
  return result;
}

export async function getShipmentReservation(id: number) {
  return prisma.$transaction(async tx => {
    const row = await tx.shipment.findUnique({ where: { id } });
    if (!row) conflict('SHIPMENT_RESERVATION_NOT_FOUND');
    const reservation = await readProof(tx, row!);
    return { reservation, state: row!.reservationState ?? 'legacy_unknown', activeQuantity: row!.reservationState === 'reserved' ? row!.reservationQuantity : 0,
      shipment: { id: row!.id, shipmentNo: row!.shipmentNo, status: row!.status, quantity: row!.quantity, unit: row!.unit,
        materialId: row!.materialId, batchNo: row!.batchNo } };
  }, { isolationLevel: 'Serializable' });
}

export async function releasePendingShipmentReservation(tx: TransactionClient, shipmentId: number, actorId: number) {
  const row = await tx.shipment.findUnique({ where: { id: shipmentId } });
  if (!row || row.reservationState !== 'reserved') return;
  const prior = await readProof(tx, row);
  const balance = await lockBalance(tx, prior!.stockBalanceId); await readProof(tx, row, balance);
  const { auditId: _id, ...event } = prior!;
  await writeEvent(tx, row, { ...event, action: 'release', actorId, previousAuditId: prior!.auditId, reason: 'Pending shipment moved to exception' });
}
