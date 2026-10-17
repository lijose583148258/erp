// Real PostgreSQL + frozen compiled business services. Only timing is injected:
// middleware pauses an actual overdueAmount=0 write; it never fakes query data.
// This is NOT browser/API/enterprise acceptance and never promotes the catalog.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('../backend/node_modules/pg');
const { readRegressionStamp, headCommit, sourceFingerprint } = require('./lib/enterprise-regression.cjs');
const root = path.resolve(__dirname, '..');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function bounded(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: timeout ${ms}ms`)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function sharedMilestoneCase({ client, admin, service, requestPaymentReversal, reviewPaymentReversal, report, save, actors }) {
  const r = { status: 'running', scope: 'Two different customers share one milestone to isolate the milestone mutex from customer locks',
    fixtureBoundary: 'Owned DB fixtures deliberately share a contract milestone across customer IDs; not an HTTP contract-assignment acceptance claim', stages: [] };
  report.sharedMilestone = r; save();
  const reached = deferred(), release = deferred();
  let armed = false, verification, reviewPromise;
  try {
    const { finance1, finance2, sales } = actors;
    const ca = await client.customer.create({ data: { name: `${report.runId}-milestone-A`, salespersonId: sales.id } });
    const cb = await client.customer.create({ data: { name: `${report.runId}-milestone-B`, salespersonId: sales.id } });
    const contract = await client.contract.create({ data: { contractNo: `${report.runId}-shared-contract`, title: 'Owned aggregate fixture',
      customerId: ca.id, totalAmount: 600, currency: 'CNY', status: 'active', createdBy: sales.id } });
    const milestone = await client.contractMilestone.create({ data: { contractId: contract.id, title: 'Shared node fixture', amount: 600, percentage: 100 } });
    const oldDate = new Date(Date.now() - 90 * 86400000);
    const createOrder = (customerId, label) => client.order.create({ data: { orderNo: `${report.runId}-milestone-${label}`, customerId,
      contractId: contract.id, createdBy: sales.id, status: 'approved', totalAmount: 300, finalAmount: 300, paidAmount: 0,
      paymentStatus: 'unpaid', paymentTerms: 30, createdAt: oldDate } });
    const a = await createOrder(ca.id, 'A'), b = await createOrder(cb.id, 'B');
    const createCash = orderId => client.paymentRecord.create({ data: { orderId, milestoneId: milestone.id, amount: 300, currency: 'CNY',
      exchangeRate: 1, baseAmount: 300, method: 'bank_transfer', status: 'pending', date: oldDate, note: 'Owned shared milestone fixture' } });
    const pa = await createCash(a.id), pb = await createCash(b.id);
    const snapshot = async label => {
      const result = { label, at: new Date().toISOString(),
        customers: (await admin.query('SELECT * FROM customers WHERE id=ANY($1::int[]) ORDER BY id', [[ca.id,cb.id]])).rows,
        orders: (await admin.query('SELECT * FROM orders WHERE id=ANY($1::int[]) ORDER BY id', [[a.id,b.id]])).rows,
        payments: (await admin.query('SELECT * FROM payment_records WHERE order_id=ANY($1::int[]) ORDER BY id', [[a.id,b.id]])).rows,
        milestone: (await admin.query('SELECT * FROM contract_milestones WHERE id=$1', [milestone.id])).rows[0],
        requests: (await admin.query('SELECT * FROM payment_reversal_requests WHERE payment_id=$1 ORDER BY created_at,id', [pa.id])).rows,
        effects: (await admin.query('SELECT * FROM payment_reversals WHERE payment_id=$1', [pa.id])).rows,
        events: (await admin.query("SELECT * FROM business_events WHERE aggregate_type='payment' AND aggregate_id=ANY($1::text[]) ORDER BY id", [[String(pa.id),String(pb.id)]])).rows };
      r.stages.push(result); save(); return result;
    };
    await service.verifyPaymentRecord(pa.id, finance1.id);
    await service.syncCustomerOverdueAmount(cb.id);
    const initial = await snapshot('initial-A-verified300-node600-pending-B-pending300');
    assert.equal(initial.milestone.status, 'pending');
    assert.deepEqual(initial.customers.map(c => c.overdue_amount), [0,300]);
    const requested = await requestPaymentReversal({ paymentId: pa.id, userId: finance1.id, key: crypto.randomUUID(),
      facts: { reasonCategory: 'bank_return', reason: 'Owned shared milestone original bank return' }, authorize: order => order.customerId === ca.id });
    r.requestReceipt = requested.receipt; save();
    client.$use(async (params, next) => {
      if (armed && params.model === 'ContractMilestone' && params.action === 'update' && params.args.where.id === milestone.id && params.args.data.status === 'paid') {
        armed = false;
        r.barrier = { at: new Date().toISOString(), args: params.args, runInTransaction: params.runInTransaction,
          explanation: 'V read verified cash sum600, paused before actual paid write; no mocked query results' };
        save(); reached.resolve(); await bounded(release.promise, 3500, 'milestone barrier release');
      }
      return next(params);
    });
    armed = true;
    verification = service.verifyPaymentRecord(pb.id, finance2.id).then(value => ({ ok: true, value }),
      error => ({ ok: false, error: { message: error.message, code: error.code, meta: error.meta } }));
    await bounded(reached.promise, 6000, 'V reads milestone sum600');
    await snapshot('B-held-before-node-paid-write');
    let reviewOutcome;
    reviewPromise = reviewPaymentReversal({ requestId: requested.request.id, userId: finance2.id, key: crypto.randomUUID(),
      facts: { decision: 'approve', note: 'Independent shared node bank return evidence checked' }, authorize: order => order.customerId === ca.id })
      .then(value => { reviewOutcome = { ok: true, value }; return reviewOutcome; },
        error => { reviewOutcome = { ok: false, error: { message: error.message, code: error.code, meta: error.meta } }; return reviewOutcome; });
    for (let attempt = 0; attempt < 40 && !reviewOutcome; attempt += 1) {
      const locks = (await admin.query("SELECT pid,application_name,state,wait_event_type,wait_event,query,pg_blocking_pids(pid) blocking_pids FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock'", [report.schema])).rows;
      if (locks.length) { r.competingReversalBlockedByDatabase = locks; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert(reviewOutcome || r.competingReversalBlockedByDatabase?.length, 'R neither committed nor reached a proven PG lock wait');
    if (reviewOutcome) assert.equal(reviewOutcome.ok, true, 'Competing shared milestone reversal must commit');
    await snapshot(reviewOutcome ? 'R-committed-before-stale-node-paid-write' : 'R-proven-blocked-on-shared-node');
    release.resolve();
    r.verification = await bounded(verification, 6000, 'milestone verification finishes');
    r.review = await bounded(reviewPromise, 6000, 'milestone reversal finishes');
    assert.equal(r.verification.ok, true); assert.equal(r.review.ok, true);
    const final = await snapshot('both-shared-node-business-transactions-completed');
    assert.deepEqual(final.orders.map(o => o.paid_amount), [0,300]);
    assert.deepEqual(final.customers.map(c => c.overdue_amount), [300,0]);
    assert.deepEqual(final.payments.map(p => p.status), ['reversed','verified']);
    assert.equal(final.effects.length, 1); assert.equal(final.effects[0].amount, -300);
    assert.equal(final.events.filter(e => e.event_type === 'payment.reversed').length, 1);
    const verifiedCash = final.payments.filter(p => p.status === 'verified').reduce((sum, p) => sum + Math.round(p.amount * 100), 0) / 100;
    const target = Number(final.milestone.amount);
    const expectedStatus = verifiedCash >= target ? 'paid' : 'pending';
    const immutablePayment = p => JSON.stringify({ ...p, status: undefined, updated_at: undefined });
    r.reconciliation = { independentVerifiedCash: verifiedCash, milestoneTarget: target, expectedStatus, storedStatus: final.milestone.status,
      originalAImmutableFinancialFacts: immutablePayment(final.payments[0]) === immutablePayment(initial.payments[0]) };
    assert.equal(verifiedCash, 300); assert.equal(target, 600); assert.equal(expectedStatus, 'pending');
    assert.equal(r.reconciliation.originalAImmutableFinancialFacts, true);
    r.status = final.milestone.status === expectedStatus ? 'passed' : 'failed';
    r.verdict = r.status === 'passed' ? 'shared-milestone-balanced-after-concurrent-verification-reversal' : 'confirmed-shared-milestone-lost-update';
  } catch (error) {
    r.status = 'failed'; r.verdict = r.verdict || 'experiment-incomplete';
    r.error = { message: error.message, code: error.code, meta: error.meta, stack: error.stack };
  } finally {
    armed = false; release.resolve();
    if (verification) { try { r.cleanupVerification = await bounded(verification, 6000, 'cleanup milestone V'); } catch (error) { r.cleanupError = error.message; } }
    if (reviewPromise) { try { r.cleanupReview = await bounded(reviewPromise, 16000, 'cleanup milestone R'); } catch (error) { r.cleanupError = error.message; } }
    save();
  }
  return r;
}
async function main() {
  assert.equal(process.env.PAYMENT_AGGREGATE_ALLOW_FIXTURES, 'true', 'Explicit fixture authorization required');
  const base = new URL(process.env.PAYMENT_AGGREGATE_DATABASE_URL || '');
  assert(['postgres:', 'postgresql:'].includes(base.protocol));
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Loopback database only');
  assert(!base.searchParams.has('schema'), 'Base URL must not select an existing schema');
  const id = crypto.randomBytes(6).toString('hex');
  const schema = `payment_aggregate_${id}`;
  assert(/^payment_aggregate_[a-f0-9]{12}$/.test(schema));
  const folder = path.join(root, 'output', 'payment-reversal-aggregate', `${Date.now()}-${id}`);
  const prismaFolder = path.join(folder, 'prisma');
  const clientFolder = path.join(folder, 'client');
  fs.mkdirSync(path.join(prismaFolder, 'models'), { recursive: true });
  const reportFile = path.join(folder, 'report.json');
  const auditFile = path.join(root, 'output', 'audit', 'payment-reversal-aggregate-v1.json');
  fs.mkdirSync(path.dirname(auditFile), { recursive: true });
  fs.copyFileSync(__filename, path.join(folder, 'audit-script.cjs'));
  const report = { version: 'payment-reversal-aggregate/v1', provider: 'postgresql', status: 'running', verdict: 'not-proven',
    regression: readRegressionStamp(), commit: headCommit(root), sourceHash: sourceFingerprint(root),
    scope: 'Real PostgreSQL service-level aggregate schedule; NOT HTTP/browser/restart/full enterprise acceptance',
    runId: id, folder, schema, startedAt: new Date().toISOString(), stages: [], migrations: [],
    injection: 'Pauses before actual Customer.update({overdueAmount:0}) in verification transaction; no fabricated database responses',
    scriptSha256: hash(__filename), reportFile, auditFile };
  const save = () => {
    const json = JSON.stringify(report, null, 2);
    fs.writeFileSync(reportFile, json);
    fs.writeFileSync(auditFile, json);
  };
  save(); console.log(`Aggregate evidence: ${reportFile}`);
  const distFiles = ['services/collection-state.service.js', 'services/payment-reversal.service.js',
    'services/payment-reversal-receipts.js', 'services/payment-reversal-event.service.js', 'utils/dbRetry.js'];
  report.compiledServices = distFiles.map(name => { const file = path.join(root, 'backend/dist', name); return { file, sha256: hash(file) }; });
  const target = new URL(base);
  target.searchParams.set('schema', schema);
  target.searchParams.set('options', `-c search_path=${schema} -c application_name=${schema}`);
  target.searchParams.set('connection_limit', '10');
  const admin = new Client({ connectionString: target.href, connectionTimeoutMillis: 5000 });
  let client, created = false, verification, reviewPromise, barrierArmed = false;
  const arrived = deferred(), release = deferred();
  const stage = async (label, customerId, orderIds) => {
    const orders = (await admin.query('SELECT * FROM orders WHERE id=ANY($1::int[]) ORDER BY id', [orderIds])).rows;
    const customer = (await admin.query('SELECT * FROM customers WHERE id=$1', [customerId])).rows[0];
    const payments = (await admin.query('SELECT * FROM payment_records WHERE order_id=ANY($1::int[]) ORDER BY id', [orderIds])).rows;
    const requests = (await admin.query('SELECT * FROM payment_reversal_requests ORDER BY created_at,id')).rows;
    const effects = (await admin.query('SELECT * FROM payment_reversals ORDER BY created_at,id')).rows;
    const audits = (await admin.query('SELECT * FROM audit_logs ORDER BY id')).rows;
    const events = (await admin.query('SELECT * FROM business_events ORDER BY id')).rows;
    const evidence = { label, at: new Date().toISOString(), customer, orders, payments, requests, effects, audits, events };
    report.stages.push(evidence); save(); return evidence;
  };
  const runPrisma = (label, args) => {
    const fd = fs.openSync(path.join(folder, `${label}.log`), 'wx');
    try { execFileSync(process.execPath, [path.join(root, 'backend/node_modules/prisma/build/index.js'), ...args],
      { cwd: root, env: { ...process.env, DATABASE_URL: target.href }, timeout: 60000, windowsHide: true, stdio: ['ignore', fd, fd] }); }
    finally { fs.closeSync(fd); }
  };
  try {
    if (report.regression) {
      assert.equal(report.regression.commit, report.commit, 'Regression stamp commit differs from actual source');
      assert.equal(report.regression.sourceHash, report.sourceHash, 'Regression stamp fingerprint differs from actual source');
      assert(Date.parse(report.startedAt) >= Date.parse(report.regression.startedAt), 'Aggregate evidence predates regression stamp');
    }
    await admin.connect(); await admin.query("SET statement_timeout = '20s'");
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    report.adminDatabaseSession = (await admin.query("SELECT current_schema() name,current_setting('application_name') application_name")).rows[0];
    assert.equal(report.adminDatabaseSession.name, schema);
    assert.equal(report.adminDatabaseSession.application_name, schema);
    for (const name of fs.readdirSync(path.join(root, 'backend/prisma/models')).filter(n => n.endsWith('.prisma')))
      fs.copyFileSync(path.join(root, 'backend/prisma/models', name), path.join(prismaFolder, 'models', name));
    const entry = fs.readFileSync(path.join(root, 'backend/prisma/schema.prisma'), 'utf8');
    assert(entry.includes('provider = "sqlite"') && entry.includes('provider        = "prisma-client-js"'));
    fs.writeFileSync(path.join(prismaFolder, 'schema.prisma'), entry
      .replace('provider = "sqlite"', 'provider = "postgresql"')
      .replace('provider        = "prisma-client-js"', 'provider        = "prisma-client-js"\n  output = "../client"')
      .replace(/binaryTargets\s*=\s*\[[^\]]*\]/, 'binaryTargets = ["native"]'));
    runPrisma('db-push', ['db', 'push', '--schema', prismaFolder, '--skip-generate']);
    runPrisma('generate', ['generate', '--schema', prismaFolder]);
    // All migration sources are read-only, applied only to this fresh schema.
    for (const name of fs.readdirSync(path.join(root, 'backend/prisma/postgres-migrations')).sort()) {
      const file = path.join(root, 'backend/prisma/postgres-migrations', name, 'migration.sql');
      if (!fs.existsSync(file)) continue;
      await admin.query('BEGIN');
      try { await admin.query(fs.readFileSync(file, 'utf8')); await admin.query('COMMIT'); }
      catch (error) { await admin.query('ROLLBACK'); throw error; }
      report.migrations.push({ name, sha256: hash(file) }); save();
    }
    const { PrismaClient } = require(clientFolder);
    client = new PrismaClient({ datasources: { db: { url: target.href } }, log: [{ level: 'query', emit: 'event' }] });
    client.$on('query', query => fs.appendFileSync(path.join(folder, 'actual-sql.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...query }) + '\n'));
    await client.$connect();
    report.businessDatabaseSession = (await client.$queryRawUnsafe("SELECT current_schema() name,current_setting('application_name') application_name"))[0];
    assert.equal(report.businessDatabaseSession.name, schema);
    assert.equal(report.businessDatabaseSession.application_name, schema);
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: target.href, AILAODA_DEPLOYMENT_MODE: 'local',
      LOG_DIR: path.join(folder, 'logs'), BACKUP_DIR: path.join(folder, 'backups'), UPLOAD_DIR: path.join(folder, 'uploads'),
      AILAODA_WEBHOOK_ENDPOINTS: '', REDIS_URL: '', REDIS_SENTINELS: '', CACHE_DRIVER: 'memory', SEARCH_DRIVER: 'prisma', REALTIME_BUS_DRIVER: 'memory' });
    // Inject the REAL independently generated PG client at the service's normal
    // database dependency. No service, ledger function or query result is mocked.
    const dbModule = path.join(root, 'backend/dist/config/database.js');
    require.cache[require.resolve(dbModule)] = { id: dbModule, filename: dbModule, loaded: true, exports: { __esModule: true, default: client } };
    const { CollectionStateService } = require('../backend/dist/services/collection-state.service');
    const { requestPaymentReversal, reviewPaymentReversal } = require('../backend/dist/services/payment-reversal.service');
    const compiledRoot = path.join(root, 'backend', 'dist') + path.sep;
    report.loadedCompiledDependencies = Object.keys(require.cache).filter(file => file.startsWith(compiledRoot) && file.endsWith('.js'))
      .sort().map(file => ({ file, sha256: hash(file) }));
    save();
    const finance1 = await client.user.create({ data: { username: `${id}-finance1`, passwordHash: 'isolated-nonlogin', role: 'finance' } });
    const finance2 = await client.user.create({ data: { username: `${id}-finance2`, passwordHash: 'isolated-nonlogin', role: 'finance' } });
    const sales = await client.user.create({ data: { username: `${id}-sales`, passwordHash: 'isolated-nonlogin', role: 'sales' } });
    const customer = await client.customer.create({ data: { name: `${id}-aggregate-fixture`, salespersonId: sales.id } });
    const oldDate = new Date(Date.now() - 90 * 86400000);
    const createOrder = label => client.order.create({ data: { orderNo: `${id}-${label}`, customerId: customer.id, createdBy: sales.id,
      status: 'approved', totalAmount: 300, finalAmount: 300, paidAmount: 0, paymentStatus: 'unpaid', paymentTerms: 30, createdAt: oldDate } });
    const a = await createOrder('A'), b = await createOrder('B');
    const createCash = orderId => client.paymentRecord.create({ data: { orderId, amount: 300, currency: 'CNY', exchangeRate: 1,
      baseAmount: 300, method: 'bank_transfer', status: 'pending', date: oldDate, note: 'Owned fresh fixture, not imported business' } });
    const pa = await createCash(a.id), pb = await createCash(b.id);
    await CollectionStateService.verifyPaymentRecord(pa.id, finance1.id);
    const initial = await stage('A-fully-paid-B-overdue-pending', customer.id, [a.id,b.id]);
    assert.equal(initial.customer.overdue_amount, 300);
    assert.deepEqual(initial.orders.map(o => o.paid_amount), [300,0]);
    const request = await requestPaymentReversal({ paymentId: pa.id, userId: finance1.id, key: crypto.randomUUID(),
      facts: { reasonCategory: 'bank_return', reason: 'Owned fixture original bank transfer returned' }, authorize: order => order.customerId === customer.id });
    report.requestReceipt = request.receipt; save();
    client.$use(async (params, next) => {
      if (barrierArmed && params.model === 'Customer' && params.action === 'update' && params.args.where.id === customer.id && params.args.data.overdueAmount === 0) {
        barrierArmed = false;
        report.barrier = { at: new Date().toISOString(), model: params.model, action: params.action, args: params.args,
          runInTransaction: params.runInTransaction, explanation: 'verify(B) has already read both payments as paid; only timing is paused before the real write' };
        save(); arrived.resolve(); await bounded(release.promise, 3500, 'barrier release');
      }
      return next(params);
    });
    barrierArmed = true;
    // Attach rejection immediately: a DB failure must remain evidence, not an
    // unhandled rejection or a fake success while the competing service runs.
    verification = CollectionStateService.verifyPaymentRecord(pb.id, finance2.id).then(value => ({ ok: true, value }),
      error => ({ ok: false, error: { name: error.name, message: error.message, code: error.code, meta: error.meta } }));
    await bounded(arrived.promise, 6000, 'verify(B) reads zero overdue');
    await stage('verification-B-held-before-customer-write', customer.id, [a.id,b.id]);
    let reviewOutcome;
    reviewPromise = reviewPaymentReversal({ requestId: request.request.id, userId: finance2.id, key: crypto.randomUUID(),
      facts: { decision: 'approve', note: 'Independent bank return evidence confirmed in owned fixture' },
      authorize: order => order.customerId === customer.id }).then(value => { reviewOutcome = { ok: true, value }; return reviewOutcome; },
        error => { reviewOutcome = { ok: false, error: { name: error.name, message: error.message, code: error.code, meta: error.meta } }; return reviewOutcome; });
    // A correct row-mutex fix can block R behind V. Do not manufacture a deadlock
    // by requiring R to commit while deliberately withholding V's write. Wait
    // until R commits OR PostgreSQL proves a genuine lock wait, then release V.
    for (let attempt = 0; attempt < 40 && !reviewOutcome; attempt += 1) {
      const locks = (await admin.query("SELECT pid,application_name,state,wait_event_type,wait_event,query,pg_blocking_pids(pid) blocking_pids FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock'", [schema])).rows;
      if (locks.length) { report.competingReversalBlockedByDatabase = locks; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert(reviewOutcome || report.competingReversalBlockedByDatabase?.length, 'Competing reversal neither completed nor reached a proven database lock wait');
    if (reviewOutcome) {
      assert.equal(reviewOutcome.ok, true, 'Reversal must succeed rather than silently abandon the competing business transaction');
      report.reviewReceipt = reviewOutcome.value.receipt; save();
      const between = await stage('A-reversal-committed-before-B-old-zero-write', customer.id, [a.id,b.id]);
      assert.equal(between.orders[0].paid_amount, 0); assert.equal(between.orders[1].paid_amount, 0);
      assert.equal(between.customer.overdue_amount, 600);
    } else await stage('A-reversal-proven-blocked-by-database-before-release', customer.id, [a.id,b.id]);
    release.resolve();
    report.verification = await bounded(verification, 6000, 'verification B completes'); save();
    assert.equal(report.verification.ok, true, 'Both actual business transactions must succeed for the lost-update claim');
    report.review = await bounded(reviewPromise, 6000, 'independent reversal A completes');
    assert.equal(report.review.ok, true, 'Independent reversal must commit after synchronization');
    report.reviewReceipt = report.review.value.receipt; save();
    const final = await stage('both-business-transactions-completed', customer.id, [a.id,b.id]);
    assert.deepEqual(final.orders.map(o => o.paid_amount), [0,300]);
    assert.deepEqual(final.payments.map(p => p.status), ['reversed','verified']);
    assert.equal(final.effects.length, 1); assert.equal(final.effects[0].amount, -300);
    assert.equal(final.requests.filter(r => r.status === 'posted').length, 1);
    assert.equal(final.events.filter(e => e.event_type === 'payment.reversed').length, 1);
    // Independent raw-row cents computation, not the implementation under test.
    const expectedCents = final.orders.filter(o => o.status !== 'cancelled' && new Date(o.created_at).getTime() + o.payment_terms * 86400000 < Date.now())
      .reduce((sum, o) => sum + Math.max(0, Math.round(o.final_amount * 100) - Math.round(o.receivable_adjustment_amount * 100) - Math.round(o.paid_amount * 100)), 0);
    report.reconciliation = { independentExpectedOverdue: expectedCents / 100, storedOverdue: final.customer.overdue_amount,
      delta: final.customer.overdue_amount - expectedCents / 100, originalAImmutableFinancialFacts: final.payments[0].amount === initial.payments[0].amount
        && final.payments[0].verified_by === initial.payments[0].verified_by && new Date(final.payments[0].date).getTime() === new Date(initial.payments[0].date).getTime() };
    assert.equal(report.reconciliation.independentExpectedOverdue, 300);
    assert.equal(report.reconciliation.originalAImmutableFinancialFacts, true);
    report.verdict = report.reconciliation.delta === 0 ? 'candidate-race-not-reproduced-balanced' : 'confirmed-customer-overdue-lost-update';
    report.status = report.reconciliation.delta === 0 ? 'passed' : 'failed';
    const shared = await sharedMilestoneCase({ client, admin, service: CollectionStateService, requestPaymentReversal, reviewPaymentReversal,
      report, save, actors: { finance1, finance2, sales } });
    if (shared.status !== 'passed') { report.status = 'failed'; report.verdict = shared.verdict; }
    else if (report.status === 'passed') report.verdict = 'customer-and-shared-milestone-concurrent-aggregates-balanced';
    report.compiledServicesUnchanged = report.compiledServices.every(f => hash(f.file) === f.sha256);
    report.loadedCompiledDependenciesUnchanged = report.loadedCompiledDependencies.every(f => hash(f.file) === f.sha256);
    assert.equal(report.compiledServicesUnchanged, true, 'Compiled service changed during schedule');
    assert.equal(report.loadedCompiledDependenciesUnchanged, true, 'Loaded compiled service dependency changed during schedule');
    if (report.status !== 'passed') process.exitCode = 1;
  } catch (error) {
    report.status = 'failed'; report.error = { name: error.name, message: error.message, code: error.code, meta: error.meta, stack: error.stack };
    if (report.verdict === 'not-proven') report.verdict = 'experiment-incomplete';
    process.exitCode = 1;
  } finally {
    barrierArmed = false; release.resolve();
    if (verification) { try { report.cleanupVerification = await bounded(verification, 6000, 'cleanup verification settles'); } catch (error) { report.cleanupError = error.message; } }
    if (reviewPromise) { try { report.cleanupReview = await bounded(reviewPromise, 16000, 'cleanup reversal settles'); } catch (error) { report.cleanupError = error.message; } }
    if (client) { try { await bounded(client.$disconnect(), 6000, 'disconnect PG client'); } catch (error) { report.cleanupError = error.message; } }
    if (created) {
      try { assert(/^payment_aggregate_[a-f0-9]{12}$/.test(schema)); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); report.fixtureSchemaRemoved = true; }
      catch (error) { report.fixtureSchemaRemoved = false; report.cleanupError = error.message; report.status = 'failed'; process.exitCode = 1; }
    }
    try { await admin.end(); } catch (error) { report.cleanupError = error.message; }
    try {
      report.commitAfter = headCommit(root);
      report.sourceHashAfter = sourceFingerprint(root);
      report.repositorySourceUnchanged = report.commitAfter === report.commit && report.sourceHashAfter === report.sourceHash;
      assert.equal(report.repositorySourceUnchanged, true, 'Repository source changed during schedule');
    } catch (error) {
      report.status = 'failed'; report.freshnessError = error.message; process.exitCode = 1;
    }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, verdict: report.verdict, reconciliation: report.reconciliation,
      schemaRemoved: report.fixtureSchemaRemoved, report: reportFile, error: report.error?.message }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
