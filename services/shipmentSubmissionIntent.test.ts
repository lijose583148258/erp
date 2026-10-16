import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareShipmentIntent, readShipmentIntent, clearShipmentIntent, confirmShipmentSubmission, shipmentIntentPayload, hasShipmentIntent, listOrderShipmentIntents, isConfirmedShipmentRejection,
  type ShipmentSubmissionResult } from './shipmentSubmissionIntent';

const input = { customerId: '1', orderId: '2', orderItemId: '3', materialId: '4', productName: 'Resin', quantity: 40, unit: 'kg', batchNo: 'LOT-1' };
const storage = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null,
  setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); },
  get length() { return map.size; }, key: (index: number) => [...map.keys()][index] ?? null, map }; };
function fixture() {
  const db = storage(), intent = prepareShipmentIntent(db, '8', 'order:2', input, () => 'original-shipment-request');
  const snapshot = { ...intent.facts, id: 9, shipmentNo: 'SHP-9', productBatchId: 5, createdBy: 8, status: 'pending' as const, createdAt: '2026-10-15T00:00:00.000Z' };
  const result: ShipmentSubmissionResult = { shipment: { ...snapshot, id: '9', customerId: '1', orderId: '2', orderItemId: '3', materialId: '4', productBatchId: '5' } as unknown as ShipmentSubmissionResult['shipment'],
    submission: { schema: 'shipment-submission/v1', key: intent.key, auditId: 10, actorId: 8, facts: intent.facts, shipment: snapshot,
      fingerprint: createHash('sha256').update(JSON.stringify({ actorId: 8, facts: intent.facts })).digest('hex') } };
  return { db, intent, result };
}
test('reload and repeated preparation preserve one actor-bound original identity and facts', () => {
  const f = fixture();
  assert.deepEqual(readShipmentIntent(f.db, '8', 'order:2'), f.intent);
  assert.deepEqual(prepareShipmentIntent(f.db, '8', 'order:2', input, () => 'must-not-use'), f.intent);
  assert.equal(readShipmentIntent(f.db, '7', 'order:2'), null);
  assert.equal(readShipmentIntent(f.db, '8', 'ocr'), null);
  assert.equal(hasShipmentIntent('8', 'order:2', () => f.db), true);
  assert.equal(hasShipmentIntent('7', 'order:2', () => f.db), false);
  assert.deepEqual(shipmentIntentPayload(f.intent), { ...input, packageType: undefined, carrier: undefined, trackingNo: undefined });
  assert.throws(() => prepareShipmentIntent(f.db, '8', 'order:2', { ...input, quantity: 39 }), /不能修改内容/);
});
test('only a proved original ACK permits explicit cleanup and a deliberately new submission', async () => {
  const f = fixture(); await confirmShipmentSubmission(f.intent, f.result); clearShipmentIntent(f.db, f.intent);
  assert.equal(readShipmentIntent(f.db, '8', 'order:2'), null);
  assert.equal(hasShipmentIntent('8', 'order:2', () => f.db), false);
  const next = prepareShipmentIntent(f.db, '8', 'order:2', input, () => 'deliberately-next-shipment');
  assert.notEqual(next.key, f.intent.key);
  assert.throws(() => clearShipmentIntent(f.db, f.intent), /不能清除/);
});
test('unreliable or corrupt browser storage prevents sending, never silently invents a new key', () => {
  assert.throws(() => prepareShipmentIntent({ ...storage(), setItem: () => {} }, '8', 'order:2', input), /未可靠保存/);
  const f = fixture(), slot = [...f.db.map.keys()][0]; f.db.map.set(slot, '{}');
  assert.throws(() => readShipmentIntent(f.db, '8', 'order:2'), /损坏/);
  assert.throws(() => prepareShipmentIntent(f.db, '8', 'order:2', input), /损坏/);
});

test('order enumeration isolates actors, ignores OCR slots and discovers pending without any candidate list', () => {
  const f = fixture();
  prepareShipmentIntent(f.db, '7', 'order:2', input, () => 'other-actor-request');
  prepareShipmentIntent(f.db, '8', 'ocr', input, () => 'original-ocr-request');
  const later = prepareShipmentIntent(f.db, '8', 'order:12', { ...input, orderId: '12' }, () => 'later-order-request');
  assert.deepEqual(listOrderShipmentIntents(f.db, '8'), [f.intent, later]);
  assert.deepEqual(listOrderShipmentIntents(f.db, '9'), []);
});

test('enumeration refuses corrupt actor-owned content but does not read another actor corruption', () => {
  const f = fixture(); f.db.setItem('ailaoda.shipment-intent/v1.7.order%3A99', '{}');
  assert.deepEqual(listOrderShipmentIntents(f.db, '8'), [f.intent]);
  f.db.setItem([...f.db.map.keys()][0], '{}');
  assert.throws(() => listOrderShipmentIntents(f.db, '8'), /损坏/);
});

test('enumeration rejects noncanonical scope, scope-fact mismatch and duplicate identities', () => {
  for (const name of ['order%3A02', 'order%3A0', 'order%3A%ZZ']) {
    const f = fixture(); f.db.setItem(`ailaoda.shipment-intent/v1.8.${name}`, JSON.stringify(f.intent));
    assert.throws(() => listOrderShipmentIntents(f.db, '8'), /损坏/);
  }
  const mismatch = fixture(); prepareShipmentIntent(mismatch.db, '8', 'order:12', input, () => 'mismatched-order-request');
  assert.throws(() => listOrderShipmentIntents(mismatch.db, '8'), /不一致/);
  const duplicate = fixture(); prepareShipmentIntent(duplicate.db, '8', 'order:12', { ...input, orderId: '12' }, () => duplicate.intent.key);
  assert.throws(() => listOrderShipmentIntents(duplicate.db, '8'), /不一致/);
});

test('enumeration fails closed when storage enumeration is unstable or unavailable', () => {
  const f = fixture();
  assert.throws(() => listOrderShipmentIntents({ ...f.db, length: -1 }, '8'), /可靠读取/);
  assert.throws(() => listOrderShipmentIntents({ ...f.db, key: () => null }, '8'), /已变化/);
  assert.throws(() => listOrderShipmentIntents({ ...f.db, key: () => { throw Error('storage unavailable'); } }, '8'), /unavailable/);
  let reads = 0;
  assert.throws(() => listOrderShipmentIntents({ ...f.db, get length() { return ++reads === 1 ? 1 : 2; } }, '8'), /已变化/);
});
for (const [field, value] of Object.entries({ key: 'other-shipment-request', actorId: 7, auditId: 0, fingerprint: 'a'.repeat(64), schema: 'wrong' })) {
  test(`ACK rejects altered ${field} and retains original storage`, async () => {
    const f = fixture(); Object.assign(f.result.submission!, { [field]: value });
    await assert.rejects(confirmShipmentSubmission(f.intent, f.result));
    assert.deepEqual(readShipmentIntent(f.db, '8', 'order:2'), f.intent);
  });
}
for (const [field, value] of Object.entries({ id: 10, customerId: 2, quantity: 39, unit: 'L', batchNo: 'OTHER', status: 'delivered',
  orderId: 3, orderItemId: 4, materialId: 5, productBatchId: 6, createdBy: 7, createdAt: 'invalid' })) {
  test(`ACK rejects altered shipment ${field}`, async () => {
    const f = fixture(); Object.assign(f.result.submission!.shipment, { [field]: value });
    await assert.rejects(confirmShipmentSubmission(f.intent, f.result));
  });
}
test('different data and frozen ACK cannot clear the original identity', async () => {
  const f = fixture(); f.result.shipment.batchNo = 'WRONG';
  await assert.rejects(confirmShipmentSubmission(f.intent, f.result));
  delete f.result.submission; await assert.rejects(confirmShipmentSubmission(f.intent, f.result));
});
test('only an exact first-attempt rejection permits corrected input, not a generic negative status', async () => {
  const f = fixture(), error = { status: 404, errorCode: 'SHIPMENT_PRODUCT_BATCH_NOT_FOUND', details: { rejectedSubmission: {
    schema: 'shipment-rejection/v1', key: f.intent.key, actorId: 8, fingerprint: f.result.submission!.fingerprint, code: 'SHIPMENT_PRODUCT_BATCH_NOT_FOUND' } } };
  assert.equal(await isConfirmedShipmentRejection(f.intent, error), true);
  assert.equal(await isConfirmedShipmentRejection(f.intent, { status: 404 }), false);
  for (const status of [0, 408, 500]) assert.equal(await isConfirmedShipmentRejection(f.intent, { ...error, status }), false);
  for (const [field, value] of Object.entries({ key: 'different-request', actorId: 7, fingerprint: 'a'.repeat(64), code: 'different', schema: 'wrong' })) {
    const mutated = structuredClone(error); Object.assign(mutated.details.rejectedSubmission, { [field]: value });
    assert.equal(await isConfirmedShipmentRejection(f.intent, mutated), false);
  }
  clearShipmentIntent(f.db, f.intent);
  assert.equal(prepareShipmentIntent(f.db, '8', 'order:2', { ...input, batchNo: 'CORRECTED' }, () => 'new-corrected-request').facts.batchNo, 'CORRECTED');
});
