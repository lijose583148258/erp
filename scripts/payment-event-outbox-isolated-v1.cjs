// Real SQLite transactions + two Prisma workers + loopback HTTP receiver.
// No stable runtime, external receiver or production database is used.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const backend = path.join(root, 'backend');

async function childVerify() {
  const prisma = require('../backend/dist/config/database').default;
  try {
    await require('../backend/dist/services/collection-state.service').CollectionStateService.verifyPaymentRecord(Number(process.argv[3]), Number(process.argv[4]));
  } finally { await prisma.$disconnect(); }
}

async function main() {
  const folder = path.join(root, 'output', 'payment-event', `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(folder, { recursive: true });
  const dbFile = path.join(folder, 'runtime.db');
  const env = { ...process.env, NODE_ENV: 'test', AILAODA_DEPLOYMENT_MODE: 'local',
    DATABASE_URL: `file:${dbFile.replace(/\\/g, '/')}`, AILAODA_RUNTIME_DB_PATH: dbFile,
    JWT_SECRET: crypto.randomBytes(48).toString('hex'), LOG_DIR: path.join(folder, 'logs'), BACKUP_DIR: path.join(folder, 'backups'), UPLOAD_DIR: path.join(folder, 'uploads'),
    REDIS_URL: '', REDIS_SENTINELS: '', REALTIME_BUS_DRIVER: 'memory', CACHE_DRIVER: 'memory', SEARCH_DRIVER: 'prisma',
    AILAODA_WEBHOOK_ENDPOINTS: '', AILAODA_WEBHOOK_SECRET: 'isolated-test-signing-key',
  };
  const report = { status: 'running', scope: 'isolated-payment-event-foundation-not-full-R2', startedAt: new Date().toISOString(), folder, checks: [] };
  const save = () => fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  save(); console.log(`Payment event evidence: ${folder}`);
  const command = (label, args, cwd = root) => {
    const log = fs.openSync(path.join(folder, `${label}.log`), 'wx');
    try { execFileSync(process.execPath, args, { cwd, env, windowsHide: true, timeout: 120_000, stdio: ['ignore', log, log] }); }
    finally { fs.closeSync(log); }
  };
  let prisma, secondary, receiver;
  const check = (name, proof) => { report.checks.push({ name, status: 'passed', proof }); save(); };
  try {
    report.sourceHash = require('./lib/enterprise-regression.cjs').sourceFingerprint(root);
    command('build', [path.join(backend, 'node_modules/typescript/bin/tsc')], backend);
    command('prepare', [path.join(backend, 'dist/database/manage-db.cli.js'), 'prepare']);
    Object.assign(process.env, env);
    prisma = require('../backend/dist/config/database').default;
    const { PrismaClient } = require('../backend/node_modules/@prisma/client');
    secondary = new PrismaClient();
    const { CollectionStateService: service } = require('../backend/dist/services/collection-state.service');
    const { drainPaymentEventOutbox: drain, PAYMENT_EVENT_LEASE_MS } = require('../backend/dist/services/payment-event-outbox.service');
    const { buildWebhookSignature } = require('../backend/dist/services/webhook.service');
    const received = [];
    let rejectNext = true;
    receiver = http.createServer((req, res) => {
      let body = ''; req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const expected = `sha256=${buildWebhookSignature(env.AILAODA_WEBHOOK_SECRET, req.headers['x-ailaoda-timestamp'], body)}`;
        received.push({ body, eventId: req.headers['x-ailaoda-event-id'], signatureValid: req.headers['x-ailaoda-signature'] === expected, httpStatus: rejectNext ? 503 : 202 });
        res.writeHead(rejectNext ? 503 : 202); res.end(); rejectNext = false;
      });
    });
    await new Promise(resolve => receiver.listen(0, '127.0.0.1', resolve));
    env.AILAODA_WEBHOOK_ENDPOINTS = process.env.AILAODA_WEBHOOK_ENDPOINTS = JSON.stringify([{ url: `http://127.0.0.1:${receiver.address().port}/events`, events: ['payment.verified'] }]);
    const finance = await prisma.user.create({ data: { username: `event-finance-${Date.now()}`, passwordHash: 'non-login-fixture', role: 'finance' } });
    const sales = await prisma.user.create({ data: { username: `event-sales-${Date.now()}`, passwordHash: 'non-login-fixture', role: 'sales' } });
    const customer = await prisma.customer.create({ data: { name: 'Isolated payment event fixture', salespersonId: sales.id } });
    const order = await prisma.order.create({ data: { orderNo: `EVENT-${Date.now()}`, customerId: customer.id, totalAmount: 1000, finalAmount: 1000, createdBy: sales.id } });
    const payment = await prisma.paymentRecord.create({ data: { orderId: order.id, amount: 300, method: 'bank_transfer' } });
    const snapshot = async () => ({
      order: await prisma.order.findUnique({ where: { id: order.id } }),
      payment: await prisma.paymentRecord.findUnique({ where: { id: payment.id } }),
      customer: await prisma.customer.findUnique({ where: { id: customer.id } }),
      audits: await prisma.auditLog.findMany({ where: { action: 'PAYMENT_VERIFIED', resourceId: payment.id } }),
      events: await prisma.businessEvent.findMany({ where: { eventKey: `payment.verified:${payment.id}` }, include: { deliveries: true } }),
    });
    const before = await snapshot();
    // Fault injected only into this script's new SQLite database.
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fixture_reject_payment_event BEFORE INSERT ON business_events BEGIN SELECT RAISE(ABORT, 'fixture event failure'); END`);
    await assert.rejects(service.verifyPaymentRecord(payment.id, finance.id));
    assert.deepEqual(await snapshot(), before);
    await prisma.$executeRawUnsafe('DROP TRIGGER fixture_reject_payment_event');
    check('event-insert-failure-rolls-back-payment-order-customer-audit', { unchanged: true });

    // Separate process exits after transaction commit, before any dispatcher starts.
    command('verify-then-exit', [__filename, '--verify-child', String(payment.id), String(finance.id)]);
    const committed = await snapshot();
    assert.equal(committed.order.paidAmount, 300); assert.equal(committed.payment.status, 'verified');
    assert.equal(committed.audits.length, 1); assert.equal(committed.events.length, 1);
    assert.equal(committed.events[0].deliveries.length, 2);
    assert(committed.events[0].deliveries.every(row => row.status === 'pending' && row.attempts === 0));
    assert.equal(received.length, 0);
    const payload = JSON.parse(committed.events[0].payloadJson);
    assert.equal(JSON.parse(committed.audits[0].details).eventId, payload.id);
    check('commit-survives-process-exit-with-two-pending-destinations', committed);

    const replays = await Promise.all(Array.from({ length: 8 }, () => service.verifyPaymentRecord(payment.id, finance.id)));
    assert(replays.every(row => row.alreadyVerified)); assert.deepEqual(await snapshot(), committed);
    check('eight-replays-do-not-create-events-or-ledger-effects', { count: replays.length });

    const workers = await Promise.all([drain({ db: prisma }), drain({ db: secondary })]);
    assert.equal(received.length, 1); assert.equal(received[0].httpStatus, 503);
    const afterFailure = await snapshot();
    const failed = afterFailure.events[0].deliveries.find(row => row.channel === 'webhook');
    assert.equal(failed.status, 'pending'); assert.equal(failed.attempts, 1); assert.equal(failed.lastErrorCode, 'HTTP_503');
    check('two-workers-claim-once-and-persist-real-http-failure', { workers, deliveries: afterFailure.events[0].deliveries });
    await drain({ db: secondary, now: () => new Date(failed.nextAttemptAt.getTime() + 1) });
    assert.equal(received.length, 2); assert.equal(received[0].body, received[1].body);
    assert(received.every(row => row.signatureValid && row.eventId === payload.id));
    assert((await snapshot()).events[0].deliveries.every(row => row.status === 'delivered'));
    await drain({ db: prisma }); assert.equal(received.length, 2);
    check('real-http-retry-preserves-event-id-body-signature-and-stops-after-ack', received);

    const second = await prisma.paymentRecord.create({ data: { orderId: order.id, amount: 100, method: 'bank_transfer' } });
    await service.verifyPaymentRecord(second.id, finance.id);
    // Inject DB acknowledgment loss AFTER a real HTTP acceptance, not a fake HTTP success.
    const proxyDb = { businessEventDelivery: {
      findMany: prisma.businessEventDelivery.findMany.bind(prisma.businessEventDelivery),
      updateMany: args => args.where.leaseToken && args.data.status === 'delivered'
        ? Promise.reject(new Error('fixture acknowledgment unavailable'))
        : prisma.businessEventDelivery.updateMany(args),
    } };
    // First drain may hit realtime before webhook; both channels are deliberately unacked.
    await assert.rejects(drain({ db: proxyDb }), /fixture acknowledgment unavailable/);
    await assert.rejects(drain({ db: proxyDb }), /fixture acknowledgment unavailable/);
    const secondEvent = await prisma.businessEvent.findUnique({ where: { eventKey: `payment.verified:${second.id}` }, include: { deliveries: true } });
    assert(secondEvent.deliveries.every(row => row.status === 'sending'));
    const beforeRecovery = received.length;
    const nextTime = new Date(Math.max(...secondEvent.deliveries.map(row => row.leaseExpiresAt.getTime())) + 1);
    await drain({ db: secondary, now: () => nextTime });
    assert.equal(received.length, beforeRecovery + 1);
    assert.equal(received.at(-1).body, received.at(-2).body);
    const recovered = await prisma.businessEventDelivery.findMany({ where: { eventId: secondEvent.id } });
    assert(recovered.every(row => row.status === 'delivered' && row.attempts === 2));
    check('lost-db-ack-recovers-expired-leases-with-same-event', { leaseMs: PAYMENT_EVENT_LEASE_MS, deliveries: recovered, duplicateTransportId: received.at(-1).eventId });

    const cancelled = await prisma.paymentRecord.create({ data: { orderId: order.id, amount: 10, method: 'bank_transfer', status: 'cancelled' } });
    await assert.rejects(service.verifyPaymentRecord(cancelled.id, finance.id), /PAYMENT_VERIFICATION_INVALID_STATE/);
    const excessive = await prisma.paymentRecord.create({ data: { orderId: order.id, amount: 900, method: 'bank_transfer' } });
    await assert.rejects(service.verifyPaymentRecord(excessive.id, finance.id), /PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING/);
    assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).paidAmount, 400);
    assert.equal(await prisma.businessEvent.count(), 2);
    check('cancelled-and-overpayment-rejected-without-events', { totalEvents: 2, paidAmount: 400 });
    report.integrity = await prisma.$queryRawUnsafe('PRAGMA integrity_check');
    report.foreignKeys = await prisma.$queryRawUnsafe('PRAGMA foreign_key_check');
    assert.deepEqual(report.integrity, [{ integrity_check: 'ok' }]); assert.deepEqual(report.foreignKeys, []);
    report.finalState = await snapshot();
    assert.equal(require('./lib/enterprise-regression.cjs').sourceFingerprint(root), report.sourceHash, 'source changed during audit');
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = error.stack; process.exitCode = 1; }
  finally {
    await Promise.allSettled([prisma?.$disconnect(), secondary?.$disconnect()]);
    if (receiver) await new Promise(resolve => receiver.close(resolve));
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, report: path.join(folder, 'report.json'), error: report.error }));
  }
}

(process.argv[2] === '--verify-child' ? childVerify() : main()).catch(error => { console.error(error); process.exitCode = 1; });
