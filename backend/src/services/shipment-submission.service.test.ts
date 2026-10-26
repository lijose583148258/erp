jest.mock('../config/database', () => ({ __esModule: true, default: { $transaction: jest.fn() } }));
jest.mock('../utils/dbRetry', () => ({ withDbRetry: jest.fn(action => action()) }));
jest.mock('./shipment-material-identity', () => ({ resolveShipmentIdentity: jest.fn() }));
jest.mock('../utils/businessNo', () => ({ buildBusinessNo: () => 'SHP-9' }));
import prisma from '../config/database';
import { resolveShipmentIdentity } from './shipment-material-identity';
import { createShipmentDraft, findShipmentSubmission, shipmentSubmissionFacts, shipmentSubmissionKey } from './shipment-submission.service';

const input = { customerId: 1, orderId: 2, orderItemId: 3, materialId: 4, productName: 'Resin', quantity: 40, unit: 'kg', batchNo: 'LOT-1' };
const meta = { userId: 8 }, key = 'shipment-original-identity';
function fixture() {
  jest.clearAllMocks(); let row: any = null, audit: any = null;
  const tx = { shipment: {
    findUnique: jest.fn(async () => row),
    create: jest.fn(async ({ data }) => { row = { id: 9, orderId: null, orderItemId: null, materialId: null, productBatchId: null,
      packageType: null, carrier: null, trackingNo: null, ...data, createdAt: new Date('2026-10-15T00:00:00.000Z') }; return row; }),
    update: jest.fn(async ({ data }) => { Object.assign(row, data); return row; }),
  }, auditLog: { create: jest.fn(async ({ data }) => { audit = { id: 10, ...data }; return audit; }), findUnique: jest.fn(async () => audit) } };
  (prisma.$transaction as jest.Mock).mockImplementation(action => action(tx));
  (resolveShipmentIdentity as jest.Mock).mockResolvedValue({ orderId: 2, orderItemId: 3, materialId: 4, productBatchId: 5, productName: 'Resin', unit: 'kg', batchNo: 'LOT-1' });
  return { tx, row: () => row, audit: () => audit };
}
test('normalizes request facts and validates stable identities without breaking unkeyed clients', () => {
  expect(shipmentSubmissionKey(undefined)).toBeNull(); expect(shipmentSubmissionKey(key, key)).toBe(key);
  for (const bad of ['', 'short', 'bad space key']) expect(() => shipmentSubmissionKey(bad)).toThrow('SHIPMENT_SUBMISSION_KEY_INVALID');
  expect(() => shipmentSubmissionKey(key, key + '-changed')).toThrow('SHIPMENT_SUBMISSION_KEY_MISMATCH');
  expect(shipmentSubmissionFacts(input)).toEqual({ ...input, packageType: null, carrier: null, trackingNo: null });
  expect(() => shipmentSubmissionFacts({ ...input, notes: 'Previously ignored' })).toThrow('SHIPMENT_SUBMISSION_UNSUPPORTED_FIELD');
});
test('freeze original actor/facts, original ACK and exact audit in the creation transaction', async () => {
  const f = fixture(), first = await createShipmentDraft(input, meta, key);
  expect(first.submission).toMatchObject({ schema: 'shipment-submission/v1', key, actorId: 8, auditId: 10, shipment: { id: 9, status: 'pending' } });
  expect(f.row().submissionJson).toBe(JSON.stringify(first.submission));
  f.row().status = 'in_transit'; f.row().trackingNo = 'new carrier tracking';
  expect(await createShipmentDraft(input, meta, key)).toEqual({ ...first, replayed: true });
  expect(await findShipmentSubmission(key, 8)).toEqual({ ...first, replayed: true });
  expect(f.tx.shipment.create).toHaveBeenCalledTimes(1); expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1);
  expect(resolveShipmentIdentity).toHaveBeenCalledTimes(1);
});
test.each(['quantity', 'materialId', 'customerId', 'orderId', 'orderItemId', 'batchNo', 'unit', 'carrier', 'trackingNo'])('same identity cannot change %s', async field => {
  fixture(); await createShipmentDraft(input, meta, key);
  const old = (input as Record<string, unknown>)[field], changed = typeof old === 'number' ? old + 1 : `${old || ''}changed`;
  await expect(createShipmentDraft({ ...input, [field]: changed }, meta, key)).rejects.toThrow('SHIPMENT_SUBMISSION_CONFLICT');
});
test('other actors cannot replay or discover the original submission', async () => {
  const f = fixture(); await createShipmentDraft(input, meta, key);
  await expect(createShipmentDraft(input, { userId: 7 }, key)).rejects.toThrow('SHIPMENT_SUBMISSION_CONFLICT');
  expect(await findShipmentSubmission(key, 7)).toBeNull(); expect(f.tx.shipment.create).toHaveBeenCalledTimes(1);
});
test.each(['audit', 'row', 'json', 'fingerprint'])('corrupted %s never becomes a successful replay', async kind => {
  const f = fixture(); await createShipmentDraft(input, meta, key);
  if (kind === 'audit') f.audit().details += 'modified';
  if (kind === 'row') f.row().quantity = 39;
  if (kind === 'json') f.row().submissionJson = '{}';
  if (kind === 'fingerprint') f.row().submissionFingerprint = 'a'.repeat(64);
  await expect(findShipmentSubmission(key, 8)).rejects.toThrow('SHIPMENT_SUBMISSION_EVIDENCE_INVALID');
  expect(f.tx.shipment.create).toHaveBeenCalledTimes(1);
});
test('legacy creation still writes its audit inside the transaction, without fabricated identities', async () => {
  const f = fixture(), result = await createShipmentDraft(input, meta, null);
  expect(result.submission).toBeNull(); expect(f.row().submissionKey).toBeNull();
  expect(f.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ resourceId: 9, action: 'CREATE' }) });
});
test('audit failure rejects the entire keyed transaction', async () => {
  const f = fixture(); f.tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
  await expect(createShipmentDraft(input, meta, key)).rejects.toThrow('audit unavailable');
  expect(f.tx.shipment.update).not.toHaveBeenCalled();
});
test('known validation rollback returns an actor/key/facts-bound rejection, without reserving a false shipment', async () => {
  const f = fixture(); (resolveShipmentIdentity as jest.Mock).mockRejectedValue(new Error('SHIPMENT_PRODUCT_BATCH_NOT_FOUND'));
  await expect(createShipmentDraft(input, meta, key)).rejects.toMatchObject({ status: 404, code: 'SHIPMENT_PRODUCT_BATCH_NOT_FOUND',
    details: { rejectedSubmission: { schema: 'shipment-rejection/v1', key, actorId: 8, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), code: 'SHIPMENT_PRODUCT_BATCH_NOT_FOUND' } } });
  expect(f.tx.shipment.create).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled();
});
test.each(['connection closed', 'request timeout'])('ambiguous transport/database failure %s never receives a rejection receipt', async message => {
  const f = fixture(); f.tx.auditLog.create.mockRejectedValue(new Error(message));
  try { await createShipmentDraft(input, meta, key); throw Error('Expected failure'); }
  catch (error) { expect((error as { details?: unknown }).details).toBeUndefined(); expect((error as Error).message).toBe(message); }
});
