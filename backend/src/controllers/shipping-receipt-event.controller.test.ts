jest.mock('../config/database', () => ({ __esModule: true, default: { $transaction: jest.fn(), auditLog: { create: jest.fn(), findMany: jest.fn() },
  shipment: { findUnique: jest.fn() }, shipmentReceipt: { findUnique: jest.fn() } } }));
jest.mock('../utils/dbRetry', () => ({ withDbRetry: jest.fn(action => action()) }));
jest.mock('../utils/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('../utils/businessNo', () => ({ buildBusinessNo: jest.fn() }));
jest.mock('../utils/raw-sql-compat', () => ({ executeRawCompat: (tx: any, sql: string, ...args: unknown[]) => tx.$executeRawUnsafe(sql, ...args),
  queryRawCompat: (tx: any, sql: string, ...args: unknown[]) => tx.$queryRawUnsafe(sql, ...args) }));
jest.mock('../services/file-storage.service', () => ({ fileStorage: { save: jest.fn() } }));
jest.mock('../services/shipping-receipt-file.service', () => ({ ...jest.requireActual('../services/shipping-receipt-file.service'), storeReceiptFile: jest.fn() }));
jest.mock('../services/receipt-discrepancy.service', () => ({ ReceiptDiscrepancyService: { normalizeDiscrepancyType: jest.fn(value => value || 'customer_short_signed'),
  assertReceiptAllowed: jest.fn(), createCaseForRejectedReceipt: jest.fn(), listCases: jest.fn() } }));
jest.mock('./shipping-controller.helpers', () => ({ canManageShipping: jest.fn(), canReadShipment: jest.fn(), mapShipmentRecord: jest.fn(row => row),
  claimShipmentReceiptWrite: jest.fn(), getCustomerDisplayName: jest.fn(),
  getShipmentDetail: jest.fn(), buildShipmentReceiptSummary: jest.fn(), getShipmentReceiptTotals: jest.fn(), listShipmentReceiptEvents: jest.fn(),
  syncOrderShipmentState: jest.fn() }));
import prisma from '../config/database';
import { buildBusinessNo } from '../utils/businessNo';
import { storeReceiptFile } from '../services/shipping-receipt-file.service';
import { ReceiptDiscrepancyService } from '../services/receipt-discrepancy.service';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { canManageShipping, canReadShipment, claimShipmentReceiptWrite, getShipmentDetail, buildShipmentReceiptSummary, getShipmentReceiptTotals,
  listShipmentReceiptEvents, syncOrderShipmentState } from './shipping-controller.helpers';
import { createShippingReceiptEvent } from './shipping-receipt-event.controller';
import { ShippingController } from './shipping.controller';

const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const file = { fileName: 'signed.png', mimeType: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };

// Only model the rows touched by this controller. The service and audit encoder are real.
// Rollback here proves transaction error propagation; actual provider locking is an integration gate.
function fixture(quantity = 30) {
  jest.clearAllMocks();
  let shipment: any = { id: 9, shipmentNo: 'SHP-9', status: 'in_transit', orderId: 2, productName: 'Resin', quantity, unit: 'kg',
    customerId: 1, signedReceiptUrl: null, customer: { id: 1, name: 'Buyer' }, order: { id: 2, orderNo: 'SO-2' } };
  let receipts: any[] = [], audits: any[] = [];
  const trace: string[] = [];
  const tx = { shipment: { findUnique: jest.fn(async () => shipment), update: jest.fn(async ({ data }) => { Object.assign(shipment, data); return shipment; }) },
    shipmentReceipt: { findUnique: jest.fn(async ({ where }) => receipts.find(row => row.id === where.id) || null),
      findUniqueOrThrow: jest.fn(async ({ where }) => { const row = receipts.find(row => row.id === where.id); if (!row) throw new Error('receipt missing'); return row; }) },
    auditLog: { findMany: jest.fn(async ({ where }) => audits.filter(audit => audit.resource === where.resource && audit.resourceId === where.resourceId
      && (typeof where.action === 'string' ? audit.action === where.action : where.action.in.includes(audit.action)))), create: jest.fn(async ({ data }) => {
      trace.push('audit'); const audit = { id: audits.length + 101, ...data }; audits.push(audit); return audit;
    }) },
    $executeRawUnsafe: jest.fn(async (_sql, ...args) => {
      trace.push('insert'); const [receiptNo, shipmentId, amount, acceptedQuantity, rejectedQuantity, unit, signedReceiptUrl,
        discrepancyReason, note, receivedBy, receivedAt] = args;
      receipts.push({ id: receipts.length + 31, receiptNo, shipmentId, quantity: amount, acceptedQuantity, rejectedQuantity, unit,
        signedReceiptUrl, discrepancyReason, note, receivedBy, receivedAt, createdAt: new Date('2026-10-16T01:00:00.000Z') }); return 1;
    }), $queryRawUnsafe: jest.fn(async (_sql, receiptNo) => receipts.filter(row => row.receiptNo === receiptNo).map(({ id }) => ({ id }))) };
  (prisma.$transaction as jest.Mock).mockImplementation(async action => {
    const before = structuredClone({ shipment, receipts, audits }); trace.push('begin');
    try { const value = await action(tx); trace.push('commit'); return value; }
    catch (error) { ({ shipment, receipts, audits } = before); trace.push('rollback'); throw error; }
  });
  (prisma.shipment.findUnique as jest.Mock).mockImplementation(() => tx.shipment.findUnique());
  (prisma.auditLog.findMany as jest.Mock).mockImplementation(query => tx.auditLog.findMany(query));
  (prisma.shipmentReceipt.findUnique as jest.Mock).mockImplementation(query => tx.shipmentReceipt.findUnique(query));
  (claimShipmentReceiptWrite as jest.Mock).mockImplementation(async passedTx => { expect(passedTx).toBe(tx); trace.push('lock'); return true; });
  (canManageShipping as jest.Mock).mockReturnValue(true);
  (canReadShipment as jest.Mock).mockReturnValue(true);
  (getShipmentDetail as jest.Mock).mockImplementation(async () => shipment);
  (getShipmentReceiptTotals as jest.Mock).mockImplementation(async passedTx => {
    expect(passedTx).toBe(tx); return { processedQuantity: receipts.reduce((sum, row) => sum + row.quantity, 0) };
  });
  (buildShipmentReceiptSummary as jest.Mock).mockResolvedValue({});
  (listShipmentReceiptEvents as jest.Mock).mockImplementation(async () => receipts);
  (ReceiptDiscrepancyService.listCases as jest.Mock).mockResolvedValue({ items: [] });
  ((ReceiptDiscrepancyService as any).assertReceiptAllowed as jest.Mock).mockResolvedValue(null);
  (ReceiptDiscrepancyService.createCaseForRejectedReceipt as jest.Mock).mockResolvedValue(null);
  (buildBusinessNo as jest.Mock).mockImplementation(() => `SPR-${receipts.length + 31}`);
  (storeReceiptFile as jest.Mock).mockResolvedValue('/pod/signed.png');
  const req: any = { params: { id: '9' }, user: { userId: 8 }, key: 'receipt-original-key',
    body: { quantity: 10, acceptedQuantity: 10, rejectedQuantity: 0, ...file }, ip: '127.0.0.1' };
  req.get = jest.fn(name => name.toLowerCase() === 'idempotency-key' ? req.key : name.toLowerCase() === 'user-agent' ? 'warehouse-browser' : undefined);
  const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
  const call = async () => { const res = response(); await createShippingReceiptEvent(req, res as any); return { res, body: res.json.mock.calls[0]?.[0] }; };
  const read = async () => { req.query = { submissionKey: req.key }; const res = response();
    await new ShippingController().getReceiptEvents(req, res as any); return { res, body: res.json.mock.calls[0]?.[0] }; };
  return { tx, req, call, read, trace, shipment: () => shipment, receipts: () => receipts, audits: () => audits };
}

test('lost first ACK then retry preserves one receipt, one file and one audit in the locked transaction', async () => {
  const f = fixture(); const first = await f.call();
  expect(first.res.status).toHaveBeenCalledWith(201); expect(first.body.data.replayed).toBe(false);
  const ack = structuredClone(first.body.data.submission);
  const replay = await f.call();
  expect(replay.res.status).toHaveBeenCalledWith(201); expect(replay.body.data).toMatchObject({ submission: ack, replayed: true });
  expect(f.receipts()).toHaveLength(1); expect(f.receipts()[0].quantity).toBe(10); expect(f.audits()).toHaveLength(1);
  expect(storeReceiptFile).toHaveBeenCalledTimes(1); expect(f.tx.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1); expect(prisma.auditLog.create).not.toHaveBeenCalled();
  expect(f.trace).toEqual(['begin', 'lock', 'insert', 'audit', 'commit', 'begin', 'lock', 'commit']);
  expect(syncOrderShipmentState).toHaveBeenCalledWith(f.tx, 2); expect(syncOrderShipmentState).toHaveBeenCalledTimes(1);
});

test('full delivered shipment still replays its own original ACK before status rejection', async () => {
  const f = fixture(10), first = await f.call(); expect(f.shipment().status).toBe('delivered');
  const second = await f.call(); expect(second.res.status).toHaveBeenCalledWith(201);
  expect(second.body.data).toMatchObject({ replayed: true, submission: first.body.data.submission });
  expect(f.receipts()).toHaveLength(1); expect(f.audits()).toHaveLength(1);
});

test('later distinct batches do not replace an earlier request ACK or get duplicated by its replay', async () => {
  const f = fixture(), first = await f.call(), original = structuredClone(first.body.data.submission);
  f.req.key = 'receipt-distinct-next-key'; await f.call();
  f.req.key = 'receipt-original-key'; const replay = await f.call();
  expect(replay.res.status).toHaveBeenCalledWith(201); expect(replay.body.data).toMatchObject({ replayed: true, submission: original });
  expect(f.receipts()).toHaveLength(2); expect(f.audits()).toHaveLength(2);
  expect(f.receipts().reduce((sum, row) => sum + row.quantity, 0)).toBe(20);
  expect(storeReceiptFile).toHaveBeenCalledTimes(2); expect(f.tx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
});

test.each(['pending', 'delivered'])('a new request cannot bypass the %s status gate', async status => {
  const f = fixture(); f.shipment().status = status;
  const result = await f.call(); expect(result.res.status).toHaveBeenCalledWith(409);
  expect(f.receipts()).toHaveLength(0); expect(f.audits()).toHaveLength(1); expect(storeReceiptFile).not.toHaveBeenCalled();
  expect(f.audits()[0].action).toBe('REJECT_RECEIPT_EVENT');
  expect(result.body.details.rejectedSubmission).toMatchObject({ schema: 'shipment-receipt-rejection/v1', key: f.req.key, actorId: 8, shipmentId: 9 });
  expect(f.trace).toEqual(['begin', 'lock', 'audit', 'commit']);
});

test.each(['quantity', 'file', 'actor'])('same request identity with changed %s is rejected without another side effect', async change => {
  const f = fixture(); await f.call();
  if (change === 'quantity') { f.req.body.quantity = 11; f.req.body.acceptedQuantity = 11; }
  if (change === 'file') f.req.body.dataUrl = `data:image/png;base64,${Buffer.concat([bytes, Buffer.from([2])]).toString('base64')}`;
  if (change === 'actor') f.req.user.userId = 7;
  const result = await f.call(); expect(result.res.status).toHaveBeenCalledWith(409);
  expect(f.receipts()).toHaveLength(1); expect(f.audits()).toHaveLength(1);
  expect(storeReceiptFile).toHaveBeenCalledTimes(1); expect(f.tx.$executeRawUnsafe).toHaveBeenCalledTimes(1);
});

test('first receipt with trimmed note/reason can be replayed, not stranded by mismatched persisted facts', async () => {
  const f = fixture(); Object.assign(f.req.body, { discrepancyReason: '  Damaged packaging  ', note: '  First receipt  ' });
  const first = await f.call(); expect(first.res.status).toHaveBeenCalledWith(201);
  const second = await f.call(); expect(second.res.status).toHaveBeenCalledWith(201);
  expect(second.body.data).toMatchObject({ replayed: true, submission: first.body.data.submission });
  expect(f.receipts()).toHaveLength(1); expect(f.audits()).toHaveLength(1);
});

test('audit failure rejects the transaction and rolls receipt/status back, not success after an unaudited commit', async () => {
  const f = fixture(10); f.tx.auditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));
  const result = await f.call(); expect(result.res.status).toHaveBeenCalledWith(500);
  expect(result.body.success).toBe(false); expect(result.body.details?.rejectedSubmission).toBeUndefined();
  expect(f.receipts()).toHaveLength(0); expect(f.audits()).toHaveLength(0);
  expect(f.shipment().status).toBe('in_transit'); expect(f.shipment().signedReceiptUrl).toBeNull();
  expect(f.trace).toEqual(['begin', 'lock', 'insert', 'rollback']);
  expect(prisma.auditLog.create).not.toHaveBeenCalled(); expect(getShipmentDetail).not.toHaveBeenCalled();
});

test('legacy unkeyed request writes only its existing prose audit, without a fabricated receipt identity', async () => {
  const f = fixture(); f.req.key = undefined;
  const result = await f.call(); expect(result.res.status).toHaveBeenCalledWith(201);
  expect(result.body.data).not.toHaveProperty('submission'); expect(result.body.data).not.toHaveProperty('replayed');
  expect(f.audits()).toEqual([expect.objectContaining({ details: '新增签收批次 SPR-31', resourceId: 9, userId: 8 })]);
  expect(prisma.auditLog.create).not.toHaveBeenCalled(); expect(f.trace.indexOf('audit')).toBeLessThan(f.trace.indexOf('commit'));
});

test('authorized actors and valid identity are required before a transaction or file write', async () => {
  const f = fixture(); (canManageShipping as jest.Mock).mockReturnValueOnce(false);
  expect((await f.call()).res.status).toHaveBeenCalledWith(403);
  f.req.key = 'bad'; expect((await f.call()).res.status).toHaveBeenCalledWith(400);
  expect(prisma.$transaction).not.toHaveBeenCalled(); expect(storeReceiptFile).not.toHaveBeenCalled();
});

test('corrupt durable receipt evidence blocks retry instead of silently creating another batch', async () => {
  const f = fixture(); await f.call(); f.audits()[0].details = f.audits()[0].details.replace('shipment-receipt-submission/v1', 'unknown/v1');
  const result = await f.call(); expect(result.res.status).toHaveBeenCalledWith(409);
  expect(result.body.details?.rejectedSubmission).toBeUndefined();
  expect(f.receipts()).toHaveLength(1); expect(f.audits()).toHaveLength(1); expect(storeReceiptFile).toHaveBeenCalledTimes(1);
});

test('a real 1e-6 kg shipment remains receivable and its original ACK is replayable', async () => {
  const f = fixture(0.000001); f.req.body.quantity = f.req.body.acceptedQuantity = 0.000001;
  const first = await f.call(); expect(first.res.status).toHaveBeenCalledWith(201);
  expect(f.receipts()).toHaveLength(1); expect(f.receipts()[0].quantity).toBe(0.000001);
  const replay = await f.call(); expect(replay.res.status).toHaveBeenCalledWith(201);
  expect(replay.body.data).toMatchObject({ submission: first.body.data.submission, replayed: true }); expect(f.receipts()).toHaveLength(1);
});

test('one remaining micro-unit is not prematurely marked fully delivered', async () => {
  const f = fixture(0.000002); f.req.body.quantity = f.req.body.acceptedQuantity = 0.000001;
  const first = await f.call(); expect(first.res.status).toHaveBeenCalledWith(201); expect(f.shipment().status).toBe('in_transit');
  f.req.key = 'receipt-second-key';
  const second = await f.call(); expect(second.res.status).toHaveBeenCalledWith(201); expect(f.shipment().status).toBe('delivered');
  expect(f.receipts()).toHaveLength(2); expect(f.receipts().reduce((sum, row) => sum + row.quantity, 0)).toBe(0.000002);
});

test.each([['receipt_a', 'receiptXa'], ['Receipt-original', 'receipt-original']])('different legal request keys %s / %s create distinct batches and replay exactly', async (firstKey, secondKey) => {
  const f = fixture(); f.req.key = firstKey; const first = await f.call(); expect(first.res.status).toHaveBeenCalledWith(201);
  f.req.key = secondKey; const second = await f.call(); expect(second.res.status).toHaveBeenCalledWith(201);
  expect(second.body.data.replayed).toBe(false); expect(f.receipts()).toHaveLength(2);
  f.req.key = firstKey; const replay = await f.call(); expect(replay.res.status).toHaveBeenCalledWith(201);
  expect(replay.body.data).toMatchObject({ replayed: true, submission: first.body.data.submission });
  expect(f.receipts()).toHaveLength(2); expect(f.audits()).toHaveLength(2); expect(storeReceiptFile).toHaveBeenCalledTimes(2);
});

test.each([0.000001, -0.000001])('a real %s kg mismatch between total and accepted/rejected is rejected before writes', async mismatch => {
  const f = fixture(); f.req.body.quantity = 1; f.req.body.acceptedQuantity = 1 + mismatch;
  const result = await f.call(); expect(result.res.status).toHaveBeenCalledWith(400);
  expect(prisma.$transaction).not.toHaveBeenCalled(); expect(storeReceiptFile).not.toHaveBeenCalled(); expect(f.receipts()).toHaveLength(0);
});

test('ordinary binary floating point noise does not reject a valid 0.1 + 0.2 kg receipt', async () => {
  const f = fixture(0.3); Object.assign(f.req.body, { quantity: 0.3, acceptedQuantity: 0.1, rejectedQuantity: 0.2 });
  const result = await f.call(); expect(result.res.status).toHaveBeenCalledWith(201);
  const replay = await f.call(); expect(replay.res.status).toHaveBeenCalledWith(201);
  expect(replay.body.data).toMatchObject({ submission: result.body.data.submission, replayed: true }); expect(f.receipts()).toHaveLength(1);
});

test('a concurrent 20kg receipt seals stale 30kg intent as rejection, then a new 10kg request can succeed', async () => {
  const f = fixture(30); f.req.key = 'other-warehouse-receipt'; f.req.body.quantity = f.req.body.acceptedQuantity = 20;
  const other = await f.call(); expect(other.res.status).toHaveBeenCalledWith(201);
  const before = structuredClone({ shipment: f.shipment(), receipts: f.receipts() });
  f.req.key = 'stale-original-30kg'; f.req.body.quantity = f.req.body.acceptedQuantity = 30;
  const rejected = await f.call(); expect(rejected.res.status).toHaveBeenCalledWith(409);
  expect(rejected.body).toMatchObject({ success: false, errorCode: 'SHIPMENT_RECEIPT_EXCEEDS_REMAINING', details: { rejectedSubmission: {
    schema: 'shipment-receipt-rejection/v1', key: 'stale-original-30kg', actorId: 8, shipmentId: 9, code: 'SHIPMENT_RECEIPT_EXCEEDS_REMAINING',
    fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), auditId: expect.any(Number) } } });
  const proof = structuredClone(rejected.body.details.rejectedSubmission);
  expect({ shipment: f.shipment(), receipts: f.receipts() }).toEqual(before);
  expect(f.audits()).toHaveLength(2); expect(f.audits()[1].action).toBe('REJECT_RECEIPT_EVENT');
  expect(f.trace.slice(-4)).toEqual(['begin', 'lock', 'audit', 'commit']); expect(prisma.auditLog.create).not.toHaveBeenCalled();
  const retry = await f.call(); expect(retry.res.status).toHaveBeenCalledWith(409);
  expect(retry.body.details.rejectedSubmission).toEqual(proof); expect(f.audits()).toHaveLength(2);
  f.req.key = 'corrected-new-10kg'; f.req.body.quantity = f.req.body.acceptedQuantity = 10;
  const corrected = await f.call(); expect(corrected.res.status).toHaveBeenCalledWith(201); expect(f.shipment().status).toBe('delivered');
  f.req.key = 'stale-original-30kg'; f.req.body.quantity = f.req.body.acceptedQuantity = 30;
  const late = await f.call(); expect(late.res.status).toHaveBeenCalledWith(409); expect(late.body.details.rejectedSubmission).toEqual(proof);
  expect(f.receipts()).toHaveLength(2); expect(f.receipts().reduce((sum, row) => sum + row.quantity, 0)).toBe(30);
  expect(f.audits()).toHaveLength(3); expect(storeReceiptFile).toHaveBeenCalledTimes(2); expect(f.tx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
});

test('a sealed rejection never becomes successful when a later availability read would permit it', async () => {
  const f = fixture(30); f.req.body.quantity = f.req.body.acceptedQuantity = 40;
  const first = await f.call(); expect(first.res.status).toHaveBeenCalledWith(409);
  const proof = first.body.details.rejectedSubmission;
  f.shipment().quantity = 50; // Inject a later permissive read, not a new business amendment API.
  const calls = (getShipmentReceiptTotals as jest.Mock).mock.calls.length;
  const retry = await f.call(); expect(retry.res.status).toHaveBeenCalledWith(409); expect(retry.body.details.rejectedSubmission).toEqual(proof);
  expect((getShipmentReceiptTotals as jest.Mock).mock.calls.length).toBe(calls);
  expect(f.receipts()).toHaveLength(0); expect(f.audits()).toHaveLength(1); expect(storeReceiptFile).not.toHaveBeenCalled();
});

test.each(['actor', 'quantity', 'file'])('changing %s cannot impersonate or reuse a durable rejection proof', async change => {
  const f = fixture(30); f.req.body.quantity = f.req.body.acceptedQuantity = 40;
  expect((await f.call()).res.status).toHaveBeenCalledWith(409);
  if (change === 'actor') f.req.user.userId = 7;
  if (change === 'quantity') f.req.body.quantity = f.req.body.acceptedQuantity = 10;
  if (change === 'file') f.req.body.fileName = 'another-receipt.png';
  const conflict = await f.call(); expect(conflict.res.status).toHaveBeenCalledWith(409);
  expect(conflict.body.details?.rejectedSubmission).toBeUndefined(); expect(f.receipts()).toHaveLength(0); expect(f.audits()).toHaveLength(1);
  expect(storeReceiptFile).not.toHaveBeenCalled();
});

test('failed rejection audit rolls back and never returns a proof that was not durably committed', async () => {
  const f = fixture(30); f.req.body.quantity = f.req.body.acceptedQuantity = 40;
  f.tx.auditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));
  const result = await f.call(); expect(result.res.status).toHaveBeenCalledWith(500);
  expect(result.body.details?.rejectedSubmission).toBeUndefined(); expect(f.audits()).toHaveLength(0); expect(f.receipts()).toHaveLength(0);
  expect(f.trace).toEqual(['begin', 'lock', 'rollback']); expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled(); expect(storeReceiptFile).not.toHaveBeenCalled();
});

test.each(['pending', 'delivered', 'in_transit'])('unkeyed %s business rejection keeps legacy rollback behavior without invented proof', async status => {
  const f = fixture(30); f.req.key = undefined; f.shipment().status = status; f.req.body.quantity = f.req.body.acceptedQuantity = 40;
  const result = await f.call(); expect(result.res.status).toHaveBeenCalledWith(409);
  expect(result.body.details?.rejectedSubmission).toBeUndefined(); expect(f.receipts()).toHaveLength(0); expect(f.audits()).toHaveLength(0);
  expect(f.trace).toEqual(['begin', 'lock', 'rollback']);
});

test('unclassified transaction failure never fabricates a rejection proof', async () => {
  const f = fixture(); f.tx.shipment.findUnique.mockRejectedValueOnce(new Error('connection closed'));
  const result = await f.call(); expect(result.res.status).toHaveBeenCalledWith(500);
  expect(result.body.details?.rejectedSubmission).toBeUndefined(); expect(f.audits()).toHaveLength(0); expect(f.receipts()).toHaveLength(0);
});

test('GET of a committed rejected key returns the same durable proof without writes or leaking it to another actor', async () => {
  const f = fixture(); f.shipment().status = 'pending'; const rejected = await f.call();
  expect(rejected.res.status).toHaveBeenCalledWith(409); const proof = rejected.body.details.rejectedSubmission;
  const read = await f.read(); expect(read.res.status).toHaveBeenCalledWith(409);
  expect(read.body).toMatchObject({ errorCode: 'SHIPMENT_MUST_BE_DISPATCHED_FIRST', details: { rejectedSubmission: proof } });
  f.req.user.userId = 7; const denied = await f.read(); expect(denied.res.status).toHaveBeenCalledWith(409);
  expect(denied.body.details?.rejectedSubmission).toBeUndefined(); expect(f.audits()).toHaveLength(1);
  expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1); expect(f.receipts()).toHaveLength(0); expect(storeReceiptFile).not.toHaveBeenCalled();
});

test('a missing keyed GET is unknown, not proof of safe rejection or a permission to submit a new intent', async () => {
  const f = fixture(); const unknown = await f.read(); expect(unknown.res.status).toHaveBeenCalledWith(404);
  expect(unknown.body.errorCode).toBe('SHIPMENT_RECEIPT_SUBMISSION_NOT_FOUND');
  expect(unknown.body.details?.rejectedSubmission).toBeUndefined(); expect(f.audits()).toHaveLength(0); expect(f.receipts()).toHaveLength(0);
});

test.each(['json', 'fingerprint', 'duplicate'])('damaged %s rejection evidence never authorizes replacing its request', async damage => {
  const f = fixture(); f.req.body.quantity = f.req.body.acceptedQuantity = 40;
  const first = await f.call(); expect(first.res.status).toHaveBeenCalledWith(409); expect(f.audits()).toHaveLength(1);
  if (damage === 'json') f.audits()[0].details = f.audits()[0].details.slice(0, -1);
  if (damage === 'fingerprint') { const event = JSON.parse(f.audits()[0].details); event.fingerprint = '0'.repeat(64); f.audits()[0].details = JSON.stringify(event); }
  if (damage === 'duplicate') f.audits().push({ ...f.audits()[0], id: 102 });
  const retry = await f.call(); expect(retry.res.status).toHaveBeenCalledWith(409);
  expect(retry.body.details?.rejectedSubmission).toBeUndefined(); expect(f.receipts()).toHaveLength(0); expect(storeReceiptFile).not.toHaveBeenCalled();
  const read = await f.read(); expect(read.res.status).toHaveBeenCalledWith(409); expect(read.body.details?.rejectedSubmission).toBeUndefined();
});

test.each([['cancelled', 0, 'SHIPMENT_STATUS_NOT_RECEIVABLE'], ['in_transit', 30, 'SHIPMENT_ALREADY_FULLY_RECEIVED']])(
  'pre-write rejection %s / processed %s is sealed without changing business rows', async (status, processedQuantity, code) => {
    const f = fixture(30); f.shipment().status = status;
    (getShipmentReceiptTotals as jest.Mock).mockResolvedValue({ processedQuantity });
    const before = structuredClone(f.shipment()); const rejected = await f.call();
    expect(rejected.res.status).toHaveBeenCalledWith(409); expect(rejected.body).toMatchObject({ errorCode: code,
      details: { rejectedSubmission: { schema: 'shipment-receipt-rejection/v1', key: f.req.key, code } } });
    expect(f.shipment()).toEqual(before); expect(f.receipts()).toHaveLength(0); expect(f.audits()).toHaveLength(1);
    expect(f.audits()[0].action).toBe('REJECT_RECEIPT_EVENT'); expect(f.trace).toEqual(['begin', 'lock', 'audit', 'commit']);
    expect(storeReceiptFile).not.toHaveBeenCalled(); expect(f.tx.shipment.update).not.toHaveBeenCalled();
  });

test('tolerance rejection is checked before file/receipt writes and seals only the rejected intent so a corrected new key can proceed', async () => {
  const f = fixture(); Object.assign(f.req.body, { quantity: 10, acceptedQuantity: 8, rejectedQuantity: 2 });
  const policy = (ReceiptDiscrepancyService as any).assertReceiptAllowed as jest.Mock;
  policy.mockRejectedValueOnce(new AppError('RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE', 409, ErrorCode.CONFLICT));
  const rejected = await f.call(); expect(rejected.res.status).toHaveBeenCalledWith(409);
  expect(rejected.body).toMatchObject({ errorCode: 'RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE', details: { rejectedSubmission: {
    schema: 'shipment-receipt-rejection/v1', code: 'RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE', key: f.req.key } } });
  expect(policy).toHaveBeenCalledWith(f.tx, expect.objectContaining({ quantity: 2, referenceQuantity: 30,
    discrepancyType: 'customer_short_signed', sourceType: 'shipment_receipt', relatedId: 9 }));
  const proof = structuredClone(rejected.body.details.rejectedSubmission), originalKey = f.req.key;
  expect(storeReceiptFile).not.toHaveBeenCalled(); expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled();
  expect(ReceiptDiscrepancyService.createCaseForRejectedReceipt).not.toHaveBeenCalled();
  expect(f.receipts()).toHaveLength(0); expect(f.audits()).toHaveLength(1); expect(f.trace).toEqual(['begin', 'lock', 'audit', 'commit']);
  const retry = await f.call(); expect(retry.res.status).toHaveBeenCalledWith(409); expect(retry.body.details.rejectedSubmission).toEqual(proof);
  expect(policy).toHaveBeenCalledTimes(1);
  f.req.key = 'corrected-tolerance-key'; Object.assign(f.req.body, { acceptedQuantity: 10, rejectedQuantity: 0 });
  const corrected = await f.call(); expect(corrected.res.status).toHaveBeenCalledWith(201);
  expect(f.receipts()).toHaveLength(1); expect(f.audits()).toHaveLength(2); expect(storeReceiptFile).toHaveBeenCalledTimes(1);
  f.req.key = originalKey; Object.assign(f.req.body, { acceptedQuantity: 8, rejectedQuantity: 2 });
  const late = await f.call(); expect(late.res.status).toHaveBeenCalledWith(409); expect(late.body.details.rejectedSubmission).toEqual(proof);
  expect(policy).toHaveBeenCalledTimes(2); expect(f.receipts()).toHaveLength(1);
});

test.each(['read unavailable', 'unknown-policy-conflict', 'same-code-server-failure', 'untyped-same-code'])('unknown tolerance precheck fault %s never writes a receipt or mints rejection proof', async fault => {
  const f = fixture(); Object.assign(f.req.body, { quantity: 10, acceptedQuantity: 8, rejectedQuantity: 2 });
  const error = fault === 'read unavailable' ? new Error(fault)
    : fault === 'unknown-policy-conflict' ? new AppError('SOME_OTHER_CONFLICT', 409, ErrorCode.CONFLICT)
    : fault === 'untyped-same-code' ? new Error('RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE')
    : new AppError('RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE', 500, ErrorCode.INTERNAL_ERROR);
  ((ReceiptDiscrepancyService as any).assertReceiptAllowed as jest.Mock).mockRejectedValueOnce(error);
  const failed = await f.call(); expect(failed.res.status).toHaveBeenCalledWith(fault === 'unknown-policy-conflict' ? 409 : 500);
  expect(failed.body.details?.rejectedSubmission).toBeUndefined(); expect(f.receipts()).toHaveLength(0); expect(f.audits()).toHaveLength(0);
  expect(storeReceiptFile).not.toHaveBeenCalled(); expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled();
  expect(f.trace).toEqual(['begin', 'lock', 'rollback']);
});

test('legacy unkeyed tolerance block remains a rollback without a fabricated rejection identity', async () => {
  const f = fixture(); f.req.key = undefined; Object.assign(f.req.body, { acceptedQuantity: 8, rejectedQuantity: 2 });
  ((ReceiptDiscrepancyService as any).assertReceiptAllowed as jest.Mock).mockRejectedValueOnce(
    new AppError('RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE', 409, ErrorCode.CONFLICT));
  const failed = await f.call(); expect(failed.res.status).toHaveBeenCalledWith(409); expect(failed.body.details?.rejectedSubmission).toBeUndefined();
  expect(f.receipts()).toHaveLength(0); expect(f.audits()).toHaveLength(0); expect(storeReceiptFile).not.toHaveBeenCalled();
  expect(f.trace).toEqual(['begin', 'lock', 'rollback']);
});

test('a later independent case check still rolls back all business writes rather than committing a rejection after a receipt insert', async () => {
  const f = fixture(); Object.assign(f.req.body, { quantity: 10, acceptedQuantity: 8, rejectedQuantity: 2 });
  (ReceiptDiscrepancyService.createCaseForRejectedReceipt as jest.Mock).mockRejectedValueOnce(
    new AppError('RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE', 409, ErrorCode.CONFLICT));
  const failed = await f.call(); expect(failed.res.status).toHaveBeenCalledWith(409); expect(failed.body.details?.rejectedSubmission).toBeUndefined();
  expect(f.receipts()).toHaveLength(0); expect(f.audits()).toHaveLength(0); expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  expect(f.trace).toEqual(['begin', 'lock', 'insert', 'rollback']); expect(f.shipment().status).toBe('in_transit');
});
