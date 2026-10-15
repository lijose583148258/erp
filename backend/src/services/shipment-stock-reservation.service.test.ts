jest.mock('../config/database', () => ({ __esModule: true, default: { $transaction: jest.fn() } }));
jest.mock('../utils/dbRetry', () => ({ withDbRetry: jest.fn(action => action()) }));
jest.mock('./stock-quality-issue.service', () => ({ assertStockQualityForIssue: jest.fn() }));
jest.mock('./material-release-readiness.service', () => ({ assertMaterialReleaseReadiness: jest.fn() }));
import prisma from '../config/database';
import { assertStockQualityForIssue } from './stock-quality-issue.service';
import { assertPhysicalReservationsAfterMovement, changeShipmentReservation, getShipmentReservation, reservationMicros,
  withShipmentReservationConsumption, releasePendingShipmentReservation } from './shipment-stock-reservation.service';

function fixture() {
  jest.clearAllMocks();
  let row: any = { id: 9, shipmentNo: 'SHP-HOLD', orderId: 2, materialId: 4, productName: 'Resin', quantity: 30, unit: 'kg', batchNo: 'LOT',
    status: 'pending', reservationState: 'unreserved', reservationBalanceId: null, reservationQuantity: null, reservationAuditId: null };
  let audits: any[] = [];
  const balance: any = { id: 5, locationId: 6, materialId: 4, productName: 'Resin', batchNo: 'LOT', quantity: 40, unit: 'kg' };
  const tx = { $executeRaw: jest.fn(async () => 1), shipment: { findUnique: jest.fn(async () => row),
    findMany: jest.fn(async () => row.reservationState === 'reserved' && row.reservationBalanceId === balance.id ? [row] : []),
    update: jest.fn(async ({ data }) => { Object.assign(row, data); return row; }),
    updateMany: jest.fn(async ({ data }) => { Object.assign(row, data); return { count: 1 }; }) },
    order: { findUnique: jest.fn(async () => ({ status: 'confirmed', shipmentHold: false })) }, stockEntry: { findFirst: jest.fn(async () => null) },
    location: { findFirst: jest.fn(async () => ({ id: 6 })) }, stockBalance: { findUnique: jest.fn(async () => balance) },
    auditLog: { findUnique: jest.fn(async ({ where }) => audits.find(a => a.id === where.id) ?? null), create: jest.fn(async ({ data }) => {
      const audit = { id: audits.length + 100, ...data }; audits.push(audit); return audit;
    }) } };
  (prisma.$transaction as jest.Mock).mockImplementation(async action => {
    const before = structuredClone({ row, audits });
    try { return await action(tx); } catch (error) { row = before.row; audits = before.audits; throw error; }
  });
  return { tx, balance, row: () => row, audits: () => audits, reserve: () => changeShipmentReservation(9, 'reserve', { expectedAuditId: row.reservationAuditId }, 8) };
}
test.each([0, 1, 0.000001, 0.1, 30, 1234.56789])('uses exact six-place stock precision for %s', value => {
  expect(reservationMicros(value)).toBe(BigInt(Math.round(value * 1e6)));
});
test.each([NaN, Infinity, 0.0000001, 1.0000001, Number.MAX_SAFE_INTEGER])('rejects nonrepresentable reservation quantity %s', value => {
  expect(() => reservationMicros(value)).toThrow('SHIPMENT_RESERVATION_PRECISION_INVALID');
});
test('rounding noise is accepted only for internal stock reads, not new business input', () => {
  expect(reservationMicros(0.1 + 0.2, true)).toBe(300000n);
  expect(() => reservationMicros(0.1 + 0.2)).toThrow('SHIPMENT_RESERVATION_PRECISION_INVALID');
});
test('reserve/release/re-reserve uses audit generations; old retries cannot release or recreate a new hold', async () => {
  const f = fixture(), first = await f.reserve(); expect(first).toMatchObject({ replayed: false, reservation: { auditId: 100, action: 'reserve', quantity: 30 } });
  expect(await changeShipmentReservation(9, 'reserve', { expectedAuditId: null }, 8)).toMatchObject({ replayed: true });
  expect(f.audits()).toHaveLength(1);
  const release = { expectedAuditId: 100, reason: 'Customer postponed this shipment' };
  expect(await changeShipmentReservation(9, 'release', release, 8)).toMatchObject({ reservation: { auditId: 101, action: 'release' } });
  expect(await changeShipmentReservation(9, 'release', release, 8)).toMatchObject({ replayed: true });
  expect(await f.reserve()).toMatchObject({ reservation: { auditId: 102, previousAuditId: 101 } });
  await expect(changeShipmentReservation(9, 'release', release, 8)).rejects.toThrow('SHIPMENT_RESERVATION_STALE');
  await expect(changeShipmentReservation(9, 'reserve', { expectedAuditId: null }, 8)).rejects.toThrow('SHIPMENT_RESERVATION_STALE');
  expect(f.audits()).toHaveLength(3); expect(f.balance.quantity).toBe(40);
});
test('one shared negative movement guard protects active holds independent of source labels', async () => {
  const f = fixture(); await f.reserve();
  const line = { locationId: 6, materialId: 4, productName: 'Resin', batchNo: 'LOT', quantityDelta: -11, unit: 'kg' };
  await expect(assertPhysicalReservationsAfterMovement(f.tx as never, { ...f.balance, quantity: 29 }, line)).rejects.toThrow('STOCK_RESERVED_FOR_SHIPMENT');
  await expect(assertPhysicalReservationsAfterMovement(f.tx as never, { ...f.balance, quantity: 30 }, { ...line, quantityDelta: -10 })).resolves.toBeUndefined();
  expect(f.row().reservationState).toBe('reserved');
});
test.each(['quantity', 'actor', 'audit', 'balance'])('damaged %s proof blocks a reserve/stock read instead of freeing inventory', async kind => {
  const f = fixture(); await f.reserve();
  if (kind === 'quantity') f.row().reservationQuantity = 29;
  if (kind === 'actor') f.audits()[0].userId = 7;
  if (kind === 'audit') f.audits()[0].details = '{}';
  if (kind === 'balance') f.balance.batchNo = 'OTHER';
  await expect(assertPhysicalReservationsAfterMovement(f.tx as never, f.balance,
    { locationId: 6, productName: 'Resin', batchNo: 'LOT', quantityDelta: -1, unit: 'kg' })).rejects.toThrow('SHIPMENT_RESERVATION_EVIDENCE_INVALID');
});
test('QC rejection and capacity shortage create no reservation audit', async () => {
  const f = fixture(); (assertStockQualityForIssue as jest.Mock).mockRejectedValueOnce(new Error('QC_HOLD'));
  await expect(f.reserve()).rejects.toThrow('QC_HOLD'); expect(f.row().reservationState).toBe('unreserved'); expect(f.audits()).toHaveLength(0);
  f.balance.quantity = 29; await expect(f.reserve()).rejects.toThrow('SHIPMENT_RESERVATION_INSUFFICIENT'); expect(f.audits()).toHaveLength(0);
});
test('own real dispatch consumes the hold in caller transaction and appends its consumption proof', async () => {
  const f = fixture(); await f.reserve(); const post = jest.fn(async () => ({ posted: true }));
  expect(await withShipmentReservationConsumption(f.tx as never, 'SHP-HOLD', f.balance, 8, post)).toEqual({ posted: true });
  expect(post).toHaveBeenCalledTimes(1); expect(await getShipmentReservation(9)).toMatchObject({ state: 'consumed', activeQuantity: 0,
    reservation: { action: 'consume', previousAuditId: 100, auditId: 101 } });
});
test('a different stock identity cannot consume this shipment hold', async () => {
  const f = fixture(); await f.reserve(); const post = jest.fn();
  await expect(withShipmentReservationConsumption(f.tx as never, 'SHP-HOLD', { ...f.balance, id: 7 }, 8, post)).rejects.toThrow('SHIPMENT_RESERVATION_EVIDENCE_INVALID');
  expect(post).not.toHaveBeenCalled(); expect(f.audits()).toHaveLength(1);
});
test('pending exception releases its hold with an audit, but no physical stock or cost movement', async () => {
  const f = fixture(); await f.reserve(); await releasePendingShipmentReservation(f.tx as never, 9, 8);
  expect(await getShipmentReservation(9)).toMatchObject({ state: 'released', activeQuantity: 0 }); expect(f.balance.quantity).toBe(40);
});
test('legacy NULL is unknown, not a fabricated reservation', async () => {
  const f = fixture(); f.row().reservationState = null;
  expect(await getShipmentReservation(9)).toMatchObject({ state: 'legacy_unknown', reservation: null, activeQuantity: 0 }); expect(f.audits()).toHaveLength(0);
});
