jest.mock('../config/database', () => ({ __esModule: true, default: { $transaction: jest.fn() } }));
jest.mock('../utils/dbRetry', () => ({ withDbRetry: jest.fn(action => action()) }));
import prisma from '../config/database';
import { assertSupplementedBatchMatches, readShipmentSupplement, shipmentOccurrenceSchema, shipmentSupplementSchema, supplementShipment } from './shipment-supplement.service';

function fixture() {
  jest.clearAllMocks();
  let row: any = { id: 9, shipmentNo: 'SHP-LATE', customerId: 1, orderId: 2, orderItemId: 3, materialId: 4,
    productName: 'Resin', quantity: 30, unit: 'kg', batchNo: null, productBatchId: null, carrier: null, trackingNo: null,
    reservationState: 'unreserved', reservationBalanceId: null, reservationQuantity: null, reservationAuditId: null,
    status: 'pending', shippedAt: null, createdAt: new Date('2026-10-15T00:00:00Z'), updatedAt: new Date('2026-10-15T00:00:00Z') };
  let audits: any[] = [];
  const tx = { $executeRaw: jest.fn(async () => 1), shipment: {
    findUnique: jest.fn(async () => row), update: jest.fn(async ({ data }) => { Object.assign(row, data); return row; }),
  }, auditLog: { findMany: jest.fn(async () => audits), create: jest.fn(async ({ data }) => {
    const audit = { id: audits.length + 100, ...data, createdAt: new Date() }; audits.push(audit); return audit;
  }) }, productBatch: { findUnique: jest.fn(async () => ({ id: 5, materialId: 4, batchNo: 'LOT-REAL', unit: 'kg', qualityStatus: 'hold' })) },
  stockEntry: { findFirst: jest.fn(async () => null) } };
  (prisma.$transaction as jest.Mock).mockImplementation(async action => {
    const before = structuredClone({ row, audits });
    try { return await action(tx); } catch (error) { row = before.row; audits = before.audits; throw error; }
  });
  const input = (patch: Record<string, unknown>, reason?: string) => shipmentSupplementSchema.parse({ expectedAuditId: audits.at(-1)?.id ?? null,
    expectedUpdatedAt: row.updatedAt.toISOString(), patch, ...(reason ? { reason } : {}) });
  return { tx, row: () => row, audits: () => audits, input };
}

test.each([
  ['2026-10-14T23:30:00+07:00', 'Asia/Ho_Chi_Minh'], ['2026-10-15T00:30:00+08:00', 'Asia/Shanghai'],
  ['2026-11-01T01:30:00-04:00', 'America/New_York'], ['2026-11-01T01:30:00-05:00', 'America/New_York'],
])('keeps unambiguous foreign wall time %s in %s', (occurredAt, timeZone) => {
  expect(shipmentOccurrenceSchema.parse({ occurredAt, timeZone })).toEqual({ occurredAt, timeZone });
});
test.each([
  ['2026-10-14T23:30:00', 'Asia/Ho_Chi_Minh'], ['2026-10-14T23:30:00+08:00', 'Asia/Ho_Chi_Minh'],
  ['2026-03-08T02:30:00-05:00', 'America/New_York'], ['2026-02-30T23:30:00+07:00', 'Asia/Ho_Chi_Minh'],
  ['2026-10-14T23:30:00+07:00', 'not/a/zone'],
])('rejects missing/incorrect offset, invalid calendar or DST gap %s/%s', (occurredAt, timeZone) => {
  expect(shipmentOccurrenceSchema.safeParse({ occurredAt, timeZone }).success).toBe(false);
});
test('only whitelisted logistics information can be supplemented', () => {
  const f = fixture();
  for (const field of ['quantity', 'materialId', 'unit', 'status', 'createdAt', 'shippedAt', 'costAmount']) {
    expect(() => f.input({ [field]: 'changed' })).toThrow();
  }
  expect(() => f.input({})).toThrow(); expect(() => f.input({ carrier: '' })).toThrow();
});
test('missing information remains unknown, then batch and transport can be filled without re-creating or posting', async () => {
  const f = fixture(), createdAt = f.row().createdAt.toISOString();
  expect(await readShipmentSupplement(9)).toMatchObject({ versionId: null, dispatchOccurrence: null, history: [], shipment: { batchNo: null, carrier: null } });
  const input = f.input({ batchNo: 'LOT-REAL', carrier: 'Cross-border carrier' });
  const saved = await supplementShipment(9, input, 8);
  expect(saved).toMatchObject({ versionId: 100, replayed: false, shipment: { batchNo: 'LOT-REAL', productBatchId: 5, carrier: 'Cross-border carrier', status: 'pending' } });
  expect(saved.history[0]).toMatchObject({ actorId: 8, reason: null, changedFields: ['batchNo', 'carrier'], before: { batchNo: null }, after: { batchNo: 'LOT-REAL' } });
  expect(f.row().createdAt.toISOString()).toBe(createdAt);
  await expect(assertSupplementedBatchMatches(f.tx as never, f.row(), { batchNo: null, productBatchId: null })).resolves.toBeUndefined();
  expect((await supplementShipment(9, input, 8)).replayed).toBe(true); expect(f.audits()).toHaveLength(1);
});
test('foreign delayed event can predate entry; immutable stock posting/created timestamps stay untouched', async () => {
  const f = fixture(); f.row().status = 'in_transit'; f.row().shippedAt = new Date('2026-10-15T01:00:00Z');
  const before = { createdAt: f.row().createdAt.toISOString(), shippedAt: f.row().shippedAt.toISOString() };
  const occurrence = { occurredAt: '2026-10-14T23:30:00+07:00', timeZone: 'Asia/Ho_Chi_Minh' };
  const result = await supplementShipment(9, f.input({ dispatchOccurrence: occurrence }), 8);
  expect(result.dispatchOccurrence).toEqual(occurrence);
  expect({ createdAt: f.row().createdAt.toISOString(), shippedAt: f.row().shippedAt.toISOString() }).toEqual(before);
  expect(result.history[0].enteredAt).not.toBe(occurrence.occurredAt);
});
test('correcting or clearing known information needs a reason and keeps both versions', async () => {
  const f = fixture(); await supplementShipment(9, f.input({ trackingNo: 'OLD' }), 8);
  await expect(supplementShipment(9, f.input({ trackingNo: 'NEW' }), 8)).rejects.toThrow('SHIPMENT_SUPPLEMENT_CORRECTION_REASON_REQUIRED');
  const result = await supplementShipment(9, f.input({ trackingNo: 'NEW' }, 'Carrier corrected the reference'), 8);
  expect(result.history).toHaveLength(2); expect(result.history[1]).toMatchObject({ before: { trackingNo: 'OLD' }, after: { trackingNo: 'NEW' } });
  expect(f.row().trackingNo).toBe('NEW');
});
test('stale or other-actor resubmission cannot silently overwrite a colleague', async () => {
  const f = fixture(), stale = f.input({ carrier: 'First carrier' });
  await supplementShipment(9, stale, 8);
  await expect(supplementShipment(9, stale, 7)).rejects.toThrow('SHIPMENT_SUPPLEMENT_STALE');
  await expect(supplementShipment(9, { ...stale, patch: { trackingNo: 'Late old tab' } }, 8)).rejects.toThrow('SHIPMENT_SUPPLEMENT_STALE');
  expect(f.audits()).toHaveLength(1);
});
test.each(['existing batch', 'reserved', 'dispatched', 'posting'])('batch cannot change after %s', async kind => {
  const f = fixture();
  if (kind === 'existing batch') Object.assign(f.row(), { batchNo: 'LOT-OLD', productBatchId: 6 });
  if (kind === 'reserved') Object.assign(f.row(), { reservationState: 'reserved', reservationAuditId: 77 });
  if (kind === 'dispatched') f.row().status = 'in_transit';
  if (kind === 'posting') f.tx.stockEntry.findFirst.mockResolvedValue({ id: 1 } as never);
  await expect(supplementShipment(9, f.input({ batchNo: 'LOT-REAL' }), 8)).rejects.toThrow('SHIPMENT_SUPPLEMENT_BATCH_FROZEN');
  expect(f.tx.auditLog.create).not.toHaveBeenCalled();
});
test('audit failure is not acknowledged; old original ACK cannot accept unaudited batch drift', async () => {
  const f = fixture(); f.tx.auditLog.create.mockRejectedValue(new Error('Audit offline'));
  await expect(supplementShipment(9, f.input({ batchNo: 'LOT-REAL' }), 8)).rejects.toThrow('Audit offline');
  expect(f.row().batchNo).toBeNull(); expect(f.audits()).toHaveLength(0);
  f.row().batchNo = 'LOT-REAL'; f.row().productBatchId = 5;
  await expect(assertSupplementedBatchMatches(f.tx as never, f.row(), { batchNo: null, productBatchId: null })).rejects.toThrow('SHIPMENT_SUBMISSION_EVIDENCE_INVALID');
});
test('corrupt supplement evidence never becomes a new empty version', async () => {
  const f = fixture(); await supplementShipment(9, f.input({ trackingNo: 'REAL' }), 8);
  f.audits()[0].details = '{}';
  await expect(readShipmentSupplement(9)).rejects.toThrow('SHIPMENT_SUPPLEMENT_EVIDENCE_INVALID');
});
test('event time cannot claim dispatch before actual stock posting', async () => {
  const f = fixture();
  await expect(supplementShipment(9, f.input({ dispatchOccurrence: { occurredAt: '2026-10-14T23:30:00+07:00', timeZone: 'Asia/Ho_Chi_Minh' } }), 8))
    .rejects.toThrow('SHIPMENT_SUPPLEMENT_DISPATCH_NOT_POSTED');
});
