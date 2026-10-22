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

function workforceObserverFixture(provider = 'postgresql', publisher = 0) {
  const e = paymentEventProofFixture(provider);
  e.frames = e.frames.map(rows => rows.map(frame => ({ ...frame, type: 'payment.verified' })));
  if (provider === 'sqlite' && publisher === 1) e.frames = [[], e.frames.flat()];
  const actorId = 900;
  const profile = { id: actorId, role: 'run_owned_receivables', permissions: ['collections.read'], dataScopes: ['finance_visible'] };
  const framesByInstance = structuredClone(e.frames);
  e.workforceObserver = { actorId, job: 'receivables', role: 'run_owned_receivables', instance: 0,
    profile,
    pendingVisible: true, handshakeStatus: 101,
    sessions: [0, 1].map(instance => ({ instance, profile: structuredClone(profile), pendingVisible: true, handshakeStatus: 101 })),
    frames: framesByInstance.flat(), framesByInstance,
    apiReadbacks: [0, 1].map(instance => {
      const payment = structuredClone(e.finalSnapshot.payment); delete payment.orderId;
      return { instance, path: `/orders/${e.orderId}`, orderId: e.orderId, paidAmount: 300, payment };
    }),
    screenshots: [0, 1].map(instance => ({ ...structuredClone(e.screenshots[instance]), actorId, instance })),
  };
  return e;
}

test('actual custom AR observer proof supplements, never replaces, the two finance recovery controls', () => {
  assert.equal(verifyPaymentEventProof(workforceObserverFixture(), 'postgresql').financeBrowsers, 2);
});
for (const publisher of [0, 1]) test(`local memory AR observer follows the real outbox owner on node${publisher}`, () => {
  assert.equal(verifyPaymentEventProof(workforceObserverFixture('sqlite', publisher), 'sqlite').financeBrowsers, 2);
});
test('local AR frame on the wrong node is rejected even when its total is one', () => {
  const e = workforceObserverFixture('sqlite');
  e.workforceObserver.framesByInstance.reverse(); e.workforceObserver.frames = e.workforceObserver.framesByInstance.flat();
  assert.throws(() => verifyPaymentEventProof(e, 'sqlite'));
});
for (const [name, mutate] of [
  ['borrowed legacy identity', o => { o.actorId = 1; }],
  ['built-in role substitution', o => { o.role = o.profile.role = 'finance'; }],
  ['missing collection grant', o => { o.profile.permissions = []; }],
  ['all-data scope', o => { o.profile.dataScopes.push('all'); }],
  ['native socket never connected', o => { o.handshakeStatus = null; }],
  ['secondary native socket never connected', o => { o.sessions[1].handshakeStatus = null; }],
  ['second page borrowed another identity', o => { o.sessions[1].profile.id++; }],
  ['same native node twice', o => { o.sessions[1].instance = 0; }],
  ['one Redis node missing', o => { o.framesByInstance[1] = []; o.frames = o.framesByInstance.flat(); }],
  ['missing durable frame', o => { o.frames = []; }],
  ['duplicate durable frame', o => { o.frames.push({ ...o.frames[0] }); }],
  ['other payment frame', o => { o.frames[0].resourceId++; }],
  ['other event type', o => { o.frames[0].type = 'payment.reversed'; }],
  ['same node repeated', o => { o.apiReadbacks[1].instance = 0; }],
  ['another order endpoint', o => { o.apiReadbacks[0].path = '/orders/123456'; }],
  ['another parent order', o => { o.apiReadbacks[0].orderId++; }],
  ['wrong payment readback', o => { o.apiReadbacks[0].payment.id++; }],
  ['pending native detail', o => { o.screenshots[0].text = '待核销 300'; }],
]) test(`custom AR observer proof rejects ${name}`, () => {
  const e = workforceObserverFixture(); mutate(e.workforceObserver);
  assert.throws(() => verifyPaymentEventProof(e, 'postgresql'));
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
