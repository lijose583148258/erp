const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { createPaymentEventReceiver } = require('./fixtures/payment-event-receiver.cjs');
const { verifyPaymentEventProof } = require('./lib/payment-event-proof.cjs');
const { paymentEventProofFixture } = require('./fixtures/payment-event-proof-fixture.cjs');

test('complete event evidence has separate SQLite and shared PostgreSQL bus boundaries', () => {
  for (const provider of ['sqlite', 'postgresql']) assert.equal(verifyPaymentEventProof(paymentEventProofFixture(provider), provider).downstreamEffects, 1);
});
for (const [name, mutate] of [
  ['missing finance browser', e => { e.browser = []; }],
  ['admin impersonates finance', e => { e.browser[0].role = 'admin'; }],
  ['one account impersonates two', e => { e.browser[1].actorId = e.browser[0].actorId; }],
  ['fake process restart', e => { e.restart.killed = 0; }],
  ['receipt actually acknowledged before kill', e => { e.claimAfterKill.status = 'delivered'; }],
  ['lease bypass', e => { e.claimBeforeCrash.leaseExpiresAt = '2026-10-02T00:01:00.000Z'; }],
  ['changed history', e => { e.finalSnapshot.audits[0].details = '{}'; }],
  ['duplicate audit', e => { e.finalSnapshot.audits.push(e.finalSnapshot.audits[0]); e.beforeSnapshot = structuredClone(e.finalSnapshot); }],
  ['double money', e => { e.finalSnapshot.order.paidAmount = 600; e.beforeSnapshot = structuredClone(e.finalSnapshot); }],
  ['undelivered channel', e => { e.deliveryReceipts[0].status = 'pending'; }],
  ['new ID on retry', e => { e.receiver.attempts[2].eventId = 'different-id'; }],
  ['changed retry payload', e => { e.receiver.attempts[2].digest = 'different-digest'; }],
  ['downstream double booking', e => { e.receiver.accepted[0].effects = 2; }],
  ['screenshot covered', e => { e.screenshots[0].unobscured = false; }],
  ['DOM-only status off-screen', e => { e.screenshots[0].statusVisible = false; }],
  ['DOM-only amount off-screen', e => { e.screenshots[0].amountVisible = false; }],
  ['missing Chinese glyphs', e => { e.screenshots[0].font.glyphs = []; }],
  ['cross-node notification missing', e => { e.frames[1] = []; }],
]) test(`event acceptance rejects ${name}`, () => {
  const evidence = paymentEventProofFixture(); mutate(evidence); assert.throws(() => verifyPaymentEventProof(evidence, 'postgresql'));
});

test('receiver preserves one fsynced effect across delivery replay and receiver restart', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-event-consumer-'));
  const secret = crypto.randomBytes(32).toString('hex');
  const event = { id: crypto.randomUUID(), type: 'payment.verified', data: { paymentId: 7, orderId: 9, amount: 300 } };
  let receiver;
  const send = async payload => {
    const body = JSON.stringify(payload), timestamp = new Date().toISOString();
    return fetch(`http://127.0.0.1:${receiver.port}/events`, { method: 'POST', body,
      headers: { 'x-ailaoda-event-id': event.id, 'x-ailaoda-timestamp': timestamp,
        'x-ailaoda-signature': `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}` }, signal: AbortSignal.timeout(5000) });
  };
  try {
    receiver = await createPaymentEventReceiver({ secret, folder });
    assert.equal((await send(event)).status, 202); assert.equal((await send(event)).status, 202);
    await receiver.close(); receiver = await createPaymentEventReceiver({ secret, folder });
    assert.equal((await send(event)).status, 202);
    assert.equal((await send({ ...event, data: { ...event.data, amount: 600 } })).status, 409);
    const lines = fs.readFileSync(path.join(folder, 'receipts.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1); assert.equal(JSON.parse(lines[0]).effects, 1); assert.equal(JSON.parse(lines[0]).amount, 300);
  } finally { if (receiver) await receiver.close(); }
});

test('receiver rejects unsigned writes and unauthorized fault control', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-event-auth-'));
  const receiver = await createPaymentEventReceiver({ secret: crypto.randomBytes(32).toString('hex'), folder });
  try {
    const url = `http://127.0.0.1:${receiver.port}`;
    assert.equal((await fetch(url+'/arm', { method: 'POST', body: '{"paymentId":7}', signal: AbortSignal.timeout(5000) })).status, 401);
    assert.equal((await fetch(url+'/events', { method: 'POST', body: '{}', signal: AbortSignal.timeout(5000) })).status, 401);
    assert(!fs.existsSync(path.join(folder, 'receipts.jsonl')));
  } finally { await receiver.close(); }
});

test('503 and lost acknowledgement are real HTTP faults, not duplicate bookkeeping', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-event-fault-'));
  const secret = crypto.randomBytes(32).toString('hex');
  const receiver = await createPaymentEventReceiver({ secret, folder }); let held;
  const control = async (endpoint, data) => {
    const res = await fetch(`http://127.0.0.1:${receiver.port}${endpoint}`, { method: data ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${secret}` }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(5000) });
    assert.equal(res.status, 200); return res.json();
  };
  const body = JSON.stringify({ id: 'stable-fixture-id', type: 'payment.verified', data: { paymentId: 7, orderId: 9, amount: 300 } });
  const timestamp = new Date().toISOString();
  const headers = { 'x-ailaoda-event-id': 'stable-fixture-id', 'x-ailaoda-timestamp': timestamp,
    'x-ailaoda-signature': `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}` };
  try {
    await control('/arm', { paymentId: 7 });
    assert.equal((await fetch(`http://127.0.0.1:${receiver.port}/events`, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000) })).status, 503);
    assert(!fs.existsSync(path.join(folder, 'receipts.jsonl')));
    held = http.request({ hostname: '127.0.0.1', port: receiver.port, path: '/events', method: 'POST', headers });
    held.on('error', () => {}); held.end(body);
    let state; const deadline = Date.now() + 5000;
    do { state = await control('/state'); if (state.target.phase === 'accepted-awaiting-ack') break;
      await new Promise(resolve => setTimeout(resolve, 25)); } while(Date.now() < deadline);
    assert.equal(state.target.phase, 'accepted-awaiting-ack'); assert.equal(state.accepted.length, 1);
    held.destroy(); await control('/release', {});
    assert.equal((await fetch(`http://127.0.0.1:${receiver.port}/events`, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000) })).status, 202);
    const final = await control('/state'); assert.equal(final.attempts.length, 3); assert.equal(final.accepted[0].effects, 1);
    assert.equal(final.accepted.length, 1); assert.equal(final.target.phase, 'acknowledged');
  } finally { if (held) held.destroy(); await receiver.close(); }
});

test('complete payment event check is wired and cannot pass without browser/recovery', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const runner = read('scripts/enterprise-round2-audit-v1.cjs');
  assert(runner.includes("runner.run('payment-event-audit-once'"));
  const probe = read('scripts/lib/enterprise-round2-payment-event.cjs');
  for (const required of ['restartIsolatedApps', "role, 'finance'", 'claimAfterKill', 'finalSnapshot', 'apiReadbacks', 'screenshots', 'frames']) assert(probe.includes(required));
  assert(!/prisma\.\w+\.(?:create|update|delete|upsert)/.test(probe), 'Business test must not repair facts through DB writes');
  const restart = read('scripts/lib/enterprise-round2-app-restart.cjs');
  for (const required of ['GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'Config.Image', 'com.docker.compose.service', 'com.docker.compose.project.working_dir', 'SIGKILL']) assert(restart.includes(required));
  const workflow = read('.github/workflows/enterprise-cloud-sandbox.yml');
  const app = workflow.slice(workflow.indexOf('  cloud-application-audit:'));
  assert(app.includes('emit_secret AILAODA_WEBHOOK_SECRET')); assert(app.includes('scripts/fixtures/payment-event-receiver.cjs'));
  assert(read('ops/cloud-sandbox/docker-compose.yml').includes('host.docker.internal:host-gateway'));
});
