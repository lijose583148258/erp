jest.mock('./file-storage.service', () => ({ fileStorage: { save: jest.fn() } }));
import { createHash } from 'node:crypto';
import { recordShipmentReceiptSubmission, recordShipmentReceiptRejection, readShipmentReceiptSubmission, shipmentReceiptFacts, shipmentReceiptSubmissionKey } from './shipment-receipt-submission.service';

const key = 'receipt-request-original';
const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const file = { fileName: 'signed.png', mimeType: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
const input = { quantity: 10, acceptedQuantity: 8, rejectedQuantity: 2, discrepancyReason: 'Two damaged drums', note: 'First batch', ...file };

function fixture() {
  let row: any = { id: 31, receiptNo: 'SPR-31', shipmentId: 9, quantity: 10, acceptedQuantity: 8, rejectedQuantity: 2,
    unit: 'kg', signedReceiptUrl: '/pod/signed.png', discrepancyReason: input.discrepancyReason, note: input.note, receivedBy: 8,
    receivedAt: new Date('2026-10-16T01:00:00.000Z'), createdAt: new Date('2026-10-16T01:00:01.000Z') };
  const audits: any[] = [];
  const db = { shipmentReceipt: { findUnique: jest.fn(async () => row), findUniqueOrThrow: jest.fn(async () => {
    if (!row) throw new Error('receipt missing'); return row;
  }) }, auditLog: { findMany: jest.fn(async (_query: any) => audits), create: jest.fn(async ({ data }) => {
    const audit = { id: 101 + audits.length, ...data }; audits.push(audit); return audit;
  }) } };
  const facts = shipmentReceiptFacts(input);
  return { db, facts, row: () => row, removeRow: () => { row = null; }, audits,
    record: () => recordShipmentReceiptSubmission(db as never, 9, 31, 8, key, facts, { ipAddress: '127.0.0.1', userAgent: 'warehouse' }),
    read: () => readShipmentReceiptSubmission(db as never, 9, key, 8, facts) };
}

test('legacy requests have no invented identity; keyed requests retain their exact valid identity', () => {
  expect(shipmentReceiptSubmissionKey(undefined)).toBeNull();
  for (const valid of [key, 'a'.repeat(8), 'z'.repeat(120), 'A123._:-']) expect(shipmentReceiptSubmissionKey(valid)).toBe(valid);
});

test.each([null, '', 'short', 'a'.repeat(121), 'bad space key', '.abcdefg', ['receipt-key'], 12345678])('rejects malformed request identity %p', bad => {
  expect(() => shipmentReceiptSubmissionKey(bad)).toThrow('SHIPMENT_RECEIPT_KEY_INVALID');
});

test('facts canonicalize optional values and hash decoded real bytes, not a data URL or file name', () => {
  const facts = shipmentReceiptFacts({ ...input, discrepancyReason: `  ${input.discrepancyReason}  `, note: ` ${input.note} ` });
  expect(facts).toEqual({ quantity: 10, acceptedQuantity: 8, rejectedQuantity: 2, discrepancyType: 'customer_short_signed',
    discrepancyReason: input.discrepancyReason, note: input.note,
    file: { name: 'signed.png', mimeType: 'image/png', sha256: createHash('sha256').update(bytes).digest('hex') } });
  expect(shipmentReceiptFacts({ quantity: 0.000001, note: '  ' })).toEqual({ quantity: 0.000001, acceptedQuantity: 0.000001,
    rejectedQuantity: 0, discrepancyType: 'customer_short_signed', discrepancyReason: null, note: null, file: null });
  const other = Buffer.concat([bytes, Buffer.from([2])]);
  expect(shipmentReceiptFacts({ ...input, dataUrl: `data:image/png;base64,${other.toString('base64')}` }).file?.sha256).not.toBe(facts.file?.sha256);
});

test.each(['not-a-data-url', 'data:image/jpeg;base64,/9j/', 'data:image/png;base64,Ym9ndXM=', 'data:image/png;base64,***'])('rejects invalid receipt data %s rather than freezing a fabricated hash', dataUrl => {
  expect(() => shipmentReceiptFacts({ ...input, dataUrl })).toThrow();
});

test('same actor/key/facts reads the immutable original ACK from one exact audit and receipt', async () => {
  const f = fixture(), ack = await f.record();
  expect(ack).toMatchObject({ schema: 'shipment-receipt-submission/v1', key, actorId: 8, shipmentId: 9, auditId: 101,
    receipt: { id: 31, quantity: 10, receivedAt: '2026-10-16T01:00:00.000Z', createdAt: '2026-10-16T01:00:01.000Z' } });
  expect(await f.read()).toEqual(ack); expect(await readShipmentReceiptSubmission(f.db as never, 9, key, 8)).toEqual(ack);
  expect(f.db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { resource: 'shipment', resourceId: 9, action: { in: ['CREATE_RECEIPT_EVENT', 'REJECT_RECEIPT_EVENT'] } } }));
  expect(f.db.auditLog.findMany.mock.calls[0][0]).not.toHaveProperty('take');
  expect(f.db.shipmentReceipt.findUnique).toHaveBeenCalledWith({ where: { id: 31 } });
  expect(f.db.auditLog.create).toHaveBeenCalledTimes(1);
});

test.each(['quantity', 'acceptedQuantity', 'rejectedQuantity', 'discrepancyReason', 'note', 'discrepancyType', 'file'])('same identity cannot change %s', async field => {
  const f = fixture(); await f.record();
  const altered: any = structuredClone(f.facts);
  altered[field] = typeof altered[field] === 'number' ? altered[field] + 1 : field === 'file' ? { ...altered.file, sha256: 'a'.repeat(64) } : 'changed';
  await expect(readShipmentReceiptSubmission(f.db as never, 9, key, 8, altered)).rejects.toThrow('SHIPMENT_RECEIPT_IDEMPOTENCY_CONFLICT');
  expect(f.db.auditLog.create).toHaveBeenCalledTimes(1);
});

test('a different actor cannot replay the request, including lookup without facts', async () => {
  const f = fixture(); await f.record();
  await expect(readShipmentReceiptSubmission(f.db as never, 9, key, 7, f.facts)).rejects.toThrow('SHIPMENT_RECEIPT_IDEMPOTENCY_CONFLICT');
  await expect(readShipmentReceiptSubmission(f.db as never, 9, key, 7)).rejects.toThrow('SHIPMENT_RECEIPT_IDEMPOTENCY_CONFLICT');
});

test('no matching audit means unknown, never fabricated success', async () => {
  const f = fixture(); expect(await f.read()).toBeNull();
  expect(f.db.shipmentReceipt.findUnique).not.toHaveBeenCalled(); expect(f.db.auditLog.create).not.toHaveBeenCalled();
});

test.each(['malformed-json', 'schema', 'shipment', 'actor', 'fingerprint', 'duplicate', 'missing-row', 'foreign-row', 'quantity',
  'accepted', 'rejected', 'unit', 'reason', 'note', 'file-presence', 'received-by', 'received-at', 'created-at'])('damaged %s evidence never becomes a successful replay', async kind => {
  const f = fixture(); await f.record(); const event = JSON.parse(f.audits[0].details);
  if (kind === 'malformed-json') f.audits[0].details = f.audits[0].details.slice(0, -1);
  else if (kind === 'duplicate') f.audits.push({ ...f.audits[0], id: 102 });
  else if (kind === 'missing-row') f.removeRow();
  else if (kind === 'actor') f.audits[0].userId = 7;
  else if (kind === 'schema') { event.schema = 'unrecognized'; f.audits[0].details = JSON.stringify(event); }
  else if (kind === 'shipment') { event.shipmentId = 10; f.audits[0].details = JSON.stringify(event); }
  else if (kind === 'fingerprint') { event.fingerprint = '0'.repeat(64); f.audits[0].details = JSON.stringify(event); }
  else {
    const row = f.row();
    const changes: Record<string, [string, unknown]> = { 'foreign-row': ['shipmentId', 10], quantity: ['quantity', 11], accepted: ['acceptedQuantity', 9],
      rejected: ['rejectedQuantity', 3], unit: ['unit', 'drum'], reason: ['discrepancyReason', 'other reason'], note: ['note', 'changed'],
      'file-presence': ['signedReceiptUrl', null], 'received-by': ['receivedBy', 7], 'received-at': ['receivedAt', new Date('2026-10-16T02:00:00.000Z')],
      'created-at': ['createdAt', new Date('2026-10-16T03:00:00.000Z')] };
    const [name, value] = changes[kind]; row[name] = value;
  }
  await expect(f.read()).rejects.toThrow('SHIPMENT_RECEIPT_EVIDENCE_INVALID');
});

test.each(['shipmentId', 'quantity', 'acceptedQuantity', 'rejectedQuantity', 'discrepancyReason', 'note', 'signedReceiptUrl', 'receivedBy'])('even matching forged ACK cannot hide incompatible receipt %s', async field => {
  const f = fixture(); await f.record(); const row = f.row();
  row[field] = typeof row[field] === 'number' ? row[field] + 1 : field === 'signedReceiptUrl' ? null : 'changed';
  const event = JSON.parse(f.audits[0].details); event.receipt[field] = row[field]; f.audits[0].details = JSON.stringify(event);
  await expect(f.read()).rejects.toThrow('SHIPMENT_RECEIPT_EVIDENCE_INVALID');
});

test('legacy creation retains its prose audit and exposes no invented request receipt', async () => {
  const f = fixture();
  expect(await recordShipmentReceiptSubmission(f.db as never, 9, 31, 8, null, f.facts, { userAgent: 'legacy' })).toBeNull();
  expect(f.audits).toEqual([{ id: 101, userId: 8, action: 'CREATE_RECEIPT_EVENT', resource: 'shipment', resourceId: 9,
    details: '新增签收批次 SPR-31', userAgent: 'legacy' }]);
});

test('audit or database unavailability is not disguised as successful or absent evidence', async () => {
  const f = fixture(); f.db.auditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));
  await expect(f.record()).rejects.toThrow('audit unavailable'); expect(f.audits).toHaveLength(0);
  f.db.auditLog.findMany.mockRejectedValueOnce(new Error('connection closed'));
  await expect(f.read()).rejects.toThrow('connection closed');
});

test('v1 ACK is a stable projection: unrelated future ORM fields do not break old receipts', async () => {
  const f = fixture(), ack = await f.record();
  f.row().futureDeliveryMetadata = { timezone: 'Asia/Ho_Chi_Minh' };
  expect(await f.read()).toEqual(ack); expect(ack?.receipt).not.toHaveProperty('futureDeliveryMetadata');
});

test.each(['quantity', 'acceptedQuantity', 'receivedBy', 'receivedAt', 'createdAt'])('invalid persisted %s is an evidence conflict, never a successful receipt', async field => {
  const f = fixture(); await f.record();
  f.row()[field] = field.endsWith('At') ? null : -1;
  await expect(f.read()).rejects.toMatchObject({ message: 'SHIPMENT_RECEIPT_EVIDENCE_INVALID', statusCode: 409 });
});

test.each(['shipmentId', 'quantity', 'acceptedQuantity', 'rejectedQuantity', 'discrepancyReason', 'note', 'signedReceiptUrl', 'receivedBy'])('recording incompatible persisted %s cannot commit a false audit receipt', async field => {
  const f = fixture(), row = f.row();
  row[field] = typeof row[field] === 'number' ? row[field] + 1 : field === 'signedReceiptUrl' ? null : 'changed';
  await expect(f.record()).rejects.toThrow('SHIPMENT_RECEIPT_EVIDENCE_INVALID'); expect(f.db.auditLog.create).not.toHaveBeenCalled();
});

test('a genuine no-file receipt replays only while the frozen file-presence facts still match', async () => {
  const f = fixture(), facts = shipmentReceiptFacts({ ...input, fileName: undefined, mimeType: undefined, dataUrl: undefined });
  f.row().signedReceiptUrl = null;
  const ack = await recordShipmentReceiptSubmission(f.db as never, 9, 31, 8, key, facts, {});
  expect(await readShipmentReceiptSubmission(f.db as never, 9, key, 8, facts)).toEqual(ack);
  f.row().signedReceiptUrl = '/pod/added-later.png';
  await expect(readShipmentReceiptSubmission(f.db as never, 9, key, 8, facts)).rejects.toThrow('SHIPMENT_RECEIPT_EVIDENCE_INVALID');
});

test.each([['receipt_a', 'receiptXa'], ['Receipt-original', 'receipt-original'], ['receipt.a', 'receipt:a']])('legal distinct identities %s and %s never collide through SQL wildcards or casing', async (firstKey, secondKey) => {
  const f = fixture();
  const first = await recordShipmentReceiptSubmission(f.db as never, 9, 31, 8, firstKey, f.facts, {});
  expect(await readShipmentReceiptSubmission(f.db as never, 9, secondKey, 8, f.facts)).toBeNull();
  const second = await recordShipmentReceiptSubmission(f.db as never, 9, 31, 8, secondKey, f.facts, {});
  expect(await readShipmentReceiptSubmission(f.db as never, 9, firstKey, 8, f.facts)).toEqual(first);
  expect(await readShipmentReceiptSubmission(f.db as never, 9, secondKey, 8, f.facts)).toEqual(second);
  expect(f.db.auditLog.findMany.mock.calls.every(([query]) => !query.where.details && !('take' in query))).toBe(true);
});

test('unkeyed prose and unrelated valid keyed audits on the same shipment do not mask its exact request', async () => {
  const f = fixture(); await recordShipmentReceiptSubmission(f.db as never, 9, 31, 8, null, f.facts, {});
  for (let i = 0; i < 3; i += 1) await recordShipmentReceiptSubmission(f.db as never, 9, 31, 8, `unrelated-request-${i}`, f.facts, {});
  const original = await f.record(); expect(await f.read()).toEqual(original);
  expect(await readShipmentReceiptSubmission(f.db as never, 9, 'brand-new-key', 8, f.facts)).toBeNull();
});

test('duplicate exact-key audits are rejected even when separated by unrelated shipment audits', async () => {
  const f = fixture(); await f.record();
  await recordShipmentReceiptSubmission(f.db as never, 9, 31, 8, 'unrelated-request-key', f.facts, {});
  await f.record();
  await expect(f.read()).rejects.toThrow('SHIPMENT_RECEIPT_EVIDENCE_INVALID');
});

test('a rejection freezes the same actor/shipment/facts hash and reads back the original public proof without needing a receipt row', async () => {
  const f = fixture();
  const proof = await recordShipmentReceiptRejection(f.db as never, 9, 8, key, f.facts, 'SHIPMENT_RECEIPT_EXCEEDS_REMAINING', { userAgent: 'warehouse' });
  expect(proof).toEqual({ schema: 'shipment-receipt-rejection/v1', key, actorId: 8, shipmentId: 9, auditId: 101,
    fingerprint: createHash('sha256').update(JSON.stringify({ shipmentId: 9, actorId: 8, facts: f.facts })).digest('hex'), code: 'SHIPMENT_RECEIPT_EXCEEDS_REMAINING' });
  expect(proof).not.toHaveProperty('facts'); expect(proof).not.toHaveProperty('receipt');
  for (let attempt = 0; attempt < 2; attempt += 1) await expect(f.read()).rejects.toMatchObject({ statusCode: 409,
    message: 'SHIPMENT_RECEIPT_EXCEEDS_REMAINING', details: { rejectedSubmission: proof } });
  await expect(readShipmentReceiptSubmission(f.db as never, 9, key, 8)).rejects.toMatchObject({ details: { rejectedSubmission: proof } });
  expect(f.db.shipmentReceipt.findUnique).not.toHaveBeenCalled(); expect(f.db.shipmentReceipt.findUniqueOrThrow).not.toHaveBeenCalled();
  expect(f.db.auditLog.create).toHaveBeenCalledTimes(1); expect(f.audits[0].action).toBe('REJECT_RECEIPT_EVENT');
});

test.each(['actor', 'quantity', 'file'])('rejection proof cannot be discovered or recycled with changed %s', async change => {
  const f = fixture(); await recordShipmentReceiptRejection(f.db as never, 9, 8, key, f.facts, 'SHIPMENT_RECEIPT_EXCEEDS_REMAINING', {});
  const facts = structuredClone(f.facts); if (change === 'quantity') facts.quantity = 9;
  if (change === 'file') facts.file!.name = 'different-file.png';
  try { await readShipmentReceiptSubmission(f.db as never, 9, key, change === 'actor' ? 7 : 8, facts); throw new Error('Expected conflict'); }
  catch (error) { expect(error).toMatchObject({ message: 'SHIPMENT_RECEIPT_IDEMPOTENCY_CONFLICT', statusCode: 409 });
    expect((error as { details?: unknown }).details).toBeUndefined(); }
});

test.each(['fingerprint', 'actor', 'shipment', 'code', 'action', 'duplicate', 'json'])('damaged rejection %s evidence cannot mint a safe-to-replace proof', async damage => {
  const f = fixture(); await recordShipmentReceiptRejection(f.db as never, 9, 8, key, f.facts, 'SHIPMENT_ALREADY_DELIVERED', {});
  const event = JSON.parse(f.audits[0].details);
  if (damage === 'actor') f.audits[0].userId = 7;
  if (damage === 'shipment') { event.shipmentId = 10; f.audits[0].details = JSON.stringify(event); }
  if (damage === 'code') { event.code = 'CONNECTION_CLOSED'; f.audits[0].details = JSON.stringify(event); }
  if (damage === 'fingerprint') { event.fingerprint = '0'.repeat(64); f.audits[0].details = JSON.stringify(event); }
  if (damage === 'action') f.audits[0].action = 'CREATE_RECEIPT_EVENT';
  if (damage === 'duplicate') f.audits.push({ ...f.audits[0], id: 102 });
  if (damage === 'json') f.audits[0].details = f.audits[0].details.slice(0, -1);
  try { await f.read(); throw new Error('Expected conflict'); }
  catch (error) { expect(error).toMatchObject({ message: 'SHIPMENT_RECEIPT_EVIDENCE_INVALID', statusCode: 409 });
    expect((error as { details?: unknown }).details).toBeUndefined(); }
});

test('an impossible success/rejection pair for one identity conflicts instead of choosing a favorable outcome', async () => {
  const f = fixture(); await f.record(); await recordShipmentReceiptRejection(f.db as never, 9, 8, key, f.facts, 'SHIPMENT_ALREADY_DELIVERED', {});
  await expect(f.read()).rejects.toMatchObject({ message: 'SHIPMENT_RECEIPT_EVIDENCE_INVALID', details: undefined });
});

test('another exact key rejection does not mask the accepted original ACK', async () => {
  const f = fixture(), ack = await f.record();
  await recordShipmentReceiptRejection(f.db as never, 9, 8, 'some-other-request-key', f.facts, 'SHIPMENT_ALREADY_DELIVERED', {});
  expect(await f.read()).toEqual(ack);
});

test('unknown failures cannot be recorded as durable business rejections, and an audit outage yields no proof', async () => {
  const f = fixture();
  await expect(recordShipmentReceiptRejection(f.db as never, 9, 8, key, f.facts, 'CONNECTION_CLOSED' as never, {})).rejects.toThrow();
  expect(f.db.auditLog.create).not.toHaveBeenCalled(); f.db.auditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));
  await expect(recordShipmentReceiptRejection(f.db as never, 9, 8, key, f.facts, 'SHIPMENT_ALREADY_DELIVERED', {})).rejects.toThrow('audit unavailable');
  expect(f.audits).toHaveLength(0);
});
