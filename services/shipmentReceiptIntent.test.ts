import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { clearReceiptIntent, confirmReceiptSubmission, isConfirmedReceiptRejection, prepareReceiptIntent, readReceiptIntent, receiptIntentFacts, receiptIntentPayload, sameReceiptQuantity,
  type ReceiptFacts, type ReceiptSubmissionResult } from './shipmentReceiptIntent';
const { compareReceiptQuantity } = createRequire(import.meta.url)('../backend/src/utils/receiptQuantity.ts') as typeof import('../backend/src/utils/receiptQuantity');

const storage = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null,
  setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); }, map }; };
const input = { quantity: 10, acceptedQuantity: 8, rejectedQuantity: 2, discrepancyReason: '  damaged bag  ', note: '  cross-border receipt  ' };
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const pdf = new TextEncoder().encode('%PDF-original-proof');
async function fixture(file: File | null = null) {
  const db = storage(), facts = await receiptIntentFacts({ ...input, file }), intent = prepareReceiptIntent(db, '8', '9', facts, () => 'original-receipt-request');
  const receipt = { id: 12, receiptNo: 'SPR-12', shipmentId: 9, quantity: 10, acceptedQuantity: 8, rejectedQuantity: 2, unit: 'kg',
    signedReceiptUrl: file ? '/api/files/receipt.png' : null, discrepancyReason: facts.discrepancyReason, note: facts.note, receivedBy: 8,
    receivedAt: '2026-10-15T00:00:00.000Z', createdAt: '2026-10-15T00:00:00.000Z' };
  const result: ReceiptSubmissionResult = { shipment: { id: '9', quantity: 30, unit: 'kg', status: 'in_transit' } as ReceiptSubmissionResult['shipment'],
    receiptSummary: { shipmentQuantity: 30, processedQuantity: 10, acceptedQuantity: 8, rejectedQuantity: 2, remainingQuantity: 20, receiptCount: 1 },
    receipts: [{ ...receipt, id: '12', shipmentId: '9' }], discrepancyCases: [],
    submission: { schema: 'shipment-receipt-submission/v1', key: intent.key, actorId: 8, shipmentId: 9, auditId: 13, facts, receipt,
      fingerprint: createHash('sha256').update(JSON.stringify({ shipmentId: 9, actorId: 8, facts })).digest('hex') } };
  return { db, intent, result };
}
test('canonical facts allow receipt without file and persist actor/shipment-bound identity before send', async () => {
  const f = await fixture();
  assert.equal(f.intent.facts.file, null); assert.equal(f.intent.facts.note, 'cross-border receipt');
  assert.equal(f.intent.facts.discrepancyType, 'customer_short_signed');
  assert.deepEqual(readReceiptIntent(f.db, '8', '9'), f.intent);
  assert.equal(readReceiptIntent(f.db, '7', '9'), null); assert.equal(readReceiptIntent(f.db, '8', '10'), null);
  assert.deepEqual(prepareReceiptIntent(f.db, '8', '9', f.intent.facts, () => 'must-not-use'), f.intent);
  assert.throws(() => prepareReceiptIntent(f.db, '8', '9', { ...f.intent.facts, note: 'changed' }), /不能更换/);
  assert.deepEqual(await receiptIntentPayload(f.intent, null), { ...input, discrepancyType: 'customer_short_signed', discrepancyReason: 'damaged bag', note: 'cross-border receipt', file: null });
});
test('reload file intent stores only real-byte SHA256; exact file re-selection is mandatory before retry', async () => {
  const file = new File([pdf], ' original.pdf ', { type: 'application/pdf' }), f = await fixture(file);
  assert.deepEqual(f.intent.facts.file, { name: 'original.pdf', mimeType: 'application/pdf', sha256: createHash('sha256').update(pdf).digest('hex') });
  const saved = [...f.db.map.values()][0]; assert.equal(saved.includes('data:'), false); assert.equal(saved.includes('AQID'), false);
  assert.deepEqual(readReceiptIntent(f.db, '8', '9'), f.intent);
  await assert.rejects(receiptIntentPayload(f.intent, null), /一致.*文件/);
  await assert.rejects(receiptIntentPayload(f.intent, new File(['%PDF-changed'], ' original.pdf ', { type: 'application/pdf' })), /一致.*文件/);
  await assert.rejects(receiptIntentPayload(f.intent, new File([pdf], 'other.pdf', { type: 'application/pdf' })), /一致.*文件/);
  assert.equal((await receiptIntentPayload(f.intent, file)).file, file);
});
test('missing or corrupt durable storage never silently replaces the original key', async () => {
  const f = await fixture(), key = [...f.db.map.keys()][0];
  assert.throws(() => prepareReceiptIntent({ ...storage(), setItem: () => {} }, '8', '9', f.intent.facts), /未可靠保存/);
  assert.throws(() => prepareReceiptIntent({ ...storage(), getItem: () => { throw Error('storage denied'); } }, '8', '9', f.intent.facts), /storage denied/);
  for (const raw of ['{', '{}', JSON.stringify({ ...f.intent, actorId: '7' }), JSON.stringify({ ...f.intent, shipmentId: '10' }),
    JSON.stringify({ ...f.intent, facts: { ...f.intent.facts, quantity: 11 } }), JSON.stringify({ ...f.intent, facts: { ...f.intent.facts, injected: true } })]) {
    f.db.map.set(key, raw); assert.throws(() => readReceiptIntent(f.db, '8', '9')); assert.throws(() => prepareReceiptIntent(f.db, '8', '9', f.intent.facts));
  }
});
test('only a fully verified original ACK and bundle allow cleanup and a deliberate next receipt', async () => {
  for (const file of [null, new File([png], 'proof.png', { type: 'image/png' })]) {
    const f = await fixture(file); await confirmReceiptSubmission(f.intent, f.result); clearReceiptIntent(f.db, f.intent);
    assert.equal(readReceiptIntent(f.db, '8', '9'), null);
    const next = prepareReceiptIntent(f.db, '8', '9', f.intent.facts, () => 'deliberately-next-receipt');
    assert.notEqual(next.key, f.intent.key); assert.throws(() => clearReceiptIntent(f.db, f.intent), /不能清除/);
  }
});
for (const [field, value] of Object.entries({ schema: 'wrong', key: 'another-receipt-request', actorId: 7, shipmentId: 10, auditId: 0, fingerprint: 'a'.repeat(64) })) {
  test(`altered ACK ${field} cannot confirm or clear another actor/shipment's original`, async () => {
    const f = await fixture(); Object.assign(f.result.submission!, { [field]: value });
    await assert.rejects(confirmReceiptSubmission(f.intent, f.result)); assert.deepEqual(readReceiptIntent(f.db, '8', '9'), f.intent);
  });
}
for (const [field, value] of Object.entries({ id: 99, receiptNo: 'WRONG', shipmentId: 10, quantity: 11, acceptedQuantity: 7, rejectedQuantity: 3,
  unit: 'L', receivedBy: 7, signedReceiptUrl: '/other.png', discrepancyReason: 'other', note: 'changed', receivedAt: 'invalid', createdAt: 'invalid' })) {
  test(`altered immutable receipt ${field} rejects the ACK`, async () => {
    const f = await fixture(); Object.assign(f.result.submission!.receipt, { [field]: value }); await assert.rejects(confirmReceiptSubmission(f.intent, f.result));
  });
}
for (const [field, value] of Object.entries({ shipmentQuantity: 40, processedQuantity: 20, acceptedQuantity: 18, rejectedQuantity: 3, remainingQuantity: 10, receiptCount: 2 })) {
  test(`altered receipt summary ${field} cannot disguise duplicate or incorrect rows`, async () => {
    const f = await fixture(); Object.assign(f.result.receiptSummary, { [field]: value }); await assert.rejects(confirmReceiptSubmission(f.intent, f.result));
  });
}
test('missing ACK, another shipment, wrong file metadata and duplicate receipt rows remain unconfirmed', async () => {
  const f = await fixture(); delete f.result.submission; await assert.rejects(confirmReceiptSubmission(f.intent, f.result));
  const a = await fixture(); a.result.shipment.id = '10'; await assert.rejects(confirmReceiptSubmission(a.intent, a.result));
  const b = await fixture(); b.result.receipts.push(b.result.receipts[0]); await assert.rejects(confirmReceiptSubmission(b.intent, b.result));
  const c = await fixture(new File([png], 'proof.png', { type: 'image/png' })); c.result.submission!.facts.file!.sha256 = 'a'.repeat(64);
  await assert.rejects(confirmReceiptSubmission(c.intent, c.result));
});
test('receipt conservation matches backend micros and never swallows a real micro-unit', async () => {
  const values = [[0, 0], [0.1 + 0.2, 0.3], [1e-6, 0], [1e-6, 2e-6], [1e9, 1e9 + 1e-6], [1e-8, 1.1e-8], [1e-8 + 2e-8, 3e-8],
    [0.3333333333333333 + 0.6666666666666666, 1], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1]];
  for (const [left, right] of values) assert.equal(sameReceiptQuantity(left, right), compareReceiptQuantity(left, right) === 0, `${left} vs ${right}`);
  assert.equal(sameReceiptQuantity(1e-6, 0), false); assert.equal(sameReceiptQuantity(1e9, 1e9 + 1e-6), false);
  await assert.rejects(receiptIntentFacts({ quantity: 1e-6, acceptedQuantity: 0, rejectedQuantity: 0 }));
  assert.equal((await receiptIntentFacts({ quantity: 1e-6, acceptedQuantity: 1e-6, rejectedQuantity: 0 })).quantity, 1e-6);
  assert.equal((await receiptIntentFacts({ quantity: 0.3, acceptedQuantity: 0.1, rejectedQuantity: 0.2 })).quantity, 0.3);
});
test('invalid or oversized files fail before allocating any durable identity; exact 5MiB is allowed', async () => {
  const db = storage(), over = new Uint8Array(5 * 1024 * 1024 + 1); over.set(png);
  const files = [new File([over], 'too-big.png', { type: 'image/png' }), new File(['not-png'], 'false.png', { type: 'image/png' }),
    new File([png], 'false.pdf', { type: 'application/pdf' }), new File([png], 'wrong.gif', { type: 'image/gif' }),
    new File([], 'empty.png', { type: 'image/png' }), new File([new Uint8Array([0xff, 0xd8, 0xff])], 'too-short.jpg', { type: 'image/jpeg' }),
    new File([png], `${'x'.repeat(161)}.png`, { type: 'image/png' })];
  for (const file of files) {
    await assert.rejects(async () => prepareReceiptIntent(db, '8', '9', await receiptIntentFacts({ ...input, file })));
    assert.equal(db.map.size, 0);
  }
  const exact = new Uint8Array(5 * 1024 * 1024); exact.set(png);
  assert.ok((await receiptIntentFacts({ ...input, file: new File([exact], 'limit.png', { type: 'image/png' }) })).file?.sha256);
  for (const [mimeType, bytes] of [['image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5])], ['image/webp', new TextEncoder().encode('RIFF1234WEBP')], ['application/pdf', pdf]] as const) {
    assert.ok((await receiptIntentFacts({ ...input, file: new File([bytes], 'valid-file', { type: mimeType }) })).file?.sha256);
  }
});
test('durably refused 30-unit intent may be cleared and corrected to latest remaining 10, never retried automatically', async () => {
  const db = storage(), facts = await receiptIntentFacts({ quantity: 30, acceptedQuantity: 30, rejectedQuantity: 0 });
  const intent = prepareReceiptIntent(db, '8', '9', facts, () => 'original-thirty-receipt');
  const error = { status: 409, errorCode: 'SHIPMENT_RECEIPT_EXCEEDS_REMAINING', details: { rejectedSubmission: {
    schema: 'shipment-receipt-rejection/v1', key: intent.key, actorId: 8, shipmentId: 9, auditId: 99, code: 'SHIPMENT_RECEIPT_EXCEEDS_REMAINING',
    fingerprint: createHash('sha256').update(JSON.stringify({ shipmentId: 9, actorId: 8, facts })).digest('hex') } } };
  assert.equal(await isConfirmedReceiptRejection(intent, error), true);
  assert.equal(readReceiptIntent(db, '8', '9')?.key, intent.key);
  clearReceiptIntent(db, intent);
  const corrected = prepareReceiptIntent(db, '8', '9', await receiptIntentFacts({ quantity: 10, acceptedQuantity: 10, rejectedQuantity: 0 }), () => 'deliberately-corrected-receipt');
  assert.notEqual(corrected.key, intent.key); assert.equal(corrected.facts.quantity, 10);
});
test('generic errors, missing durable audit and altered refusal proof cannot clear or replace an unresolved identity', async () => {
  const f = await fixture(), error = { status: 409, errorCode: 'SHIPMENT_RECEIPT_EXCEEDS_REMAINING', details: { rejectedSubmission: {
    schema: 'shipment-receipt-rejection/v1', key: f.intent.key, actorId: 8, shipmentId: 9, auditId: 99, code: 'SHIPMENT_RECEIPT_EXCEEDS_REMAINING',
    fingerprint: f.result.submission!.fingerprint } } };
  assert.equal(await isConfirmedReceiptRejection(f.intent, error), true);
  for (const failure of [{ status: 409 }, { status: 404 }, { status: 500 }, { ...error, status: 500 }, { ...error, status: 404 },
    { ...error, errorCode: 'DIFFERENT' }, { ...error, details: {} }]) assert.equal(await isConfirmedReceiptRejection(f.intent, failure), false);
  for (const [field, value] of Object.entries({ schema: 'wrong', key: 'different-key', actorId: 7, shipmentId: 10, auditId: 0, fingerprint: 'a'.repeat(64), code: 'DIFFERENT' })) {
    const changed = structuredClone(error); Object.assign(changed.details.rejectedSubmission, { [field]: value });
    assert.equal(await isConfirmedReceiptRejection(f.intent, changed), false);
    assert.deepEqual(readReceiptIntent(f.db, '8', '9'), f.intent);
  }
});
test('tolerance refusal unlocks only with the exact durable proof; altered proof stays fail-closed', async () => {
  const f = await fixture(), error = { status: 409, errorCode: 'RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE', details: { rejectedSubmission: {
    schema: 'shipment-receipt-rejection/v1', key: f.intent.key, actorId: 8, shipmentId: 9, auditId: 99,
    code: 'RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE', fingerprint: f.result.submission!.fingerprint } } };
  assert.equal(await isConfirmedReceiptRejection(f.intent, error), true);
  const bad = structuredClone(error); bad.details.rejectedSubmission.fingerprint = 'a'.repeat(64);
  assert.equal(await isConfirmedReceiptRejection(f.intent, bad), false);
  assert.equal(await isConfirmedReceiptRejection(f.intent, { status: 409, errorCode: error.errorCode }), false);
  assert.deepEqual(readReceiptIntent(f.db, '8', '9'), f.intent);
  if (await isConfirmedReceiptRejection(f.intent, error)) clearReceiptIntent(f.db, f.intent);
  assert.equal(readReceiptIntent(f.db, '8', '9'), null);
});
test('negative, non-finite, unequal and non-canonical facts are rejected before identity allocation', async () => {
  const f = await fixture();
  for (const change of [{ quantity: 0 }, { quantity: Number.NaN }, { acceptedQuantity: -1 }, { rejectedQuantity: -2 }, { quantity: 11 },
    { note: ' untrimmed ' }, { discrepancyType: 'unknown' }, { file: { name: 'proof', mimeType: 'text/plain', sha256: 'a'.repeat(64) } }]) {
    assert.throws(() => prepareReceiptIntent(storage(), '8', '9', { ...f.intent.facts, ...change } as ReceiptFacts));
  }
});
