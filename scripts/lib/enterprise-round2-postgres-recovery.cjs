const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { escapeLiteral } = require('../../backend/node_modules/pg');
const { ensureUiAuditUser } = require('./ui-audit-user.cjs');
const { createOwnedPostgresControl } = require('./enterprise-round2-postgres-control.cjs');
const { readPostgresLedgerSnapshot, compareLedgerSnapshots } = require('./enterprise-round2-postgres-ledger.cjs');

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const activitySql = `SELECT pid,backend_start::text,xact_start::text,backend_xid::text,application_name,
  state,wait_event_type,wait_event,query,pg_blocking_pids(pid) AS blockers
  FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`;
const sameTransaction = (a, b) => ['pid', 'backend_start', 'xact_start', 'backend_xid'].every(key => a[key] === b[key]);
const databaseSql = `SELECT current_setting('server_version_num')::int AS version,pg_is_in_recovery() AS recovery,
  current_setting('fsync') AS fsync,current_setting('data_directory') AS "dataDirectory",
  (pg_control_system()).system_identifier::text AS "systemIdentifier",pg_postmaster_start_time()::text AS "postmasterStartedAt"`;
async function settings(client) {
  const effective = (await client.query(`SELECT name,setting,source,sourcefile,pending_restart FROM pg_settings WHERE name='synchronous_standby_names'`)).rows;
  assert.equal(effective.length, 1);
  const entries = (await client.query(`SELECT sourcefile,name,setting,applied,error FROM pg_file_settings
    WHERE name='synchronous_standby_names' ORDER BY sourcefile,sourceline`)).rows;
  const autoEntries = entries.filter(row => row.sourcefile.endsWith('/postgresql.auto.conf'));
  const errors = (await client.query('SELECT sourcefile,name,error FROM pg_file_settings WHERE error IS NOT NULL')).rows;
  assert.equal(errors.length, 0); assert(autoEntries.length <= 1, 'Ambiguous original auto.conf setting');
  return { effective: effective[0], autoEntries, errors };
}

async function until(read, accepts, timeoutMs, signal, label) {
  const deadline = performance.now() + timeoutMs; let last;
  while (performance.now() < deadline) {
    signal.throwIfAborted(); last = await read();
    signal.throwIfAborted();
    if (performance.now() > deadline) break;
    if (accepts(last)) return last;
    await delay(15, undefined, { signal });
  }
  throw new Error(`PostgreSQL recovery coverage missing: ${label}`);
}

async function restoreSettings(control, original, signal) {
  const client = await control.connect('r2_recovery_restore', { signal });
  try {
    if (original.autoEntries.length) await client.query(`ALTER SYSTEM SET synchronous_standby_names = ${escapeLiteral(original.autoEntries[0].setting)}`);
    else await client.query('ALTER SYSTEM RESET synchronous_standby_names');
    assert.equal((await client.query('SELECT pg_reload_conf() AS reloaded')).rows[0].reloaded, true);
    return await until(() => settings(client), value => digest(value) === digest(original), 3000, signal, 'restore exact original synchronous setting');
  } finally { await client.end(); }
}

// One native order/receipt chain in the existing runner. Never a product fault
// endpoint, replacement transaction protocol, generic retry layer or schema.
async function postgresRecoveryProbe(ctx, parentSignal) {
  const { request, dataOf, actors, prisma, runId, urls, reportPath, stockFixture, priorChecks } = ctx;
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(210000)]);
  const e = { version: 'postgres-recovery-chain/v1', provider: 'postgresql', runId, status: 'running',
    scope: 'Actual PG16.9 process/volume recovery across two native receipt commit windows and all prior business ledger rows; not full20 workforce or production release',
    priorChecks: priorChecks.map(check => ({ id: check.id, status: check.status, evidenceSha256: digest(check.evidence ?? null) })),
    actions: [], branches: [], cleanup: { status: 'running', errors: [] } };
  const folder = path.join(path.dirname(reportPath), `${runId}-postgres-recovery`); fs.mkdirSync(folder, { recursive: true });
  let control, browser, original, failure;
  const people = {}, inFlight = new Set();
  const call = async (actor, endpoint, options = {}) => {
    const startedAt = new Date().toISOString();
    const result = await request(endpoint, { ...options, actor, signal });
    const action = { actorId: actor.id, role: actor.role, instance: options.instance || 0,
      method: options.method || 'GET', path: endpoint, key: options.headers?.['Idempotency-Key'] || null,
      sent: options.data ?? null, status: result.status, json: result.json, startedAt, finishedAt: new Date().toISOString() };
    e.actions.push(action); return action;
  };
  const snapshot = async () => {
    const client = await control.connect('r2_recovery_snapshot');
    try { return await readPostgresLedgerSnapshot(client, { runId }); }
    finally { await client.end(); }
  };
  const stableSnapshot = async () => {
    // Let real outbox delivery and response-finish request audits settle. Never
    // switch them off or omit their rows from the recovery comparison.
    const client = await control.connect('r2_recovery_quiescence');
    try {
      await until(async () => (await client.query(`SELECT id FROM business_event_deliveries WHERE status<>'delivered' LIMIT 1`)).rows,
        rows => rows.length === 0, 12000, signal, 'all prior durable deliveries terminal');
    } finally { await client.end(); }
    let previous = await snapshot();
    return until(async () => {
      await delay(100, undefined, { signal }); const next = await snapshot();
      const equal = compareLedgerSnapshots(previous, next).equal; previous = next;
      return { equal, snapshot: next };
    }, row => row.equal, 12000, signal, 'complete ledger stable before checkpoint').then(row => row.snapshot);
  };
  const salesRead = async accepted => browser.salesRead({ orderId: e.manifest.orderId, lineId: e.manifest.orderItemId,
    orderNo: e.manifest.orderNo, expected: { orderedQuantity: 20, dispatchedQuantity: 20, reservedQuantity: 0,
      acceptedQuantity: accepted, outstandingQuantity: 20 - accepted } });
  try {
    assert.equal(process.env.ROUND2_POSTGRES_RECOVERY, 'true');
    assert.equal(process.env.AUDIT_PRISMA_PROVIDER, 'postgresql');
    // Only this recovery chain selects these four duties. Never replace the
    // runner's legacy pressure/control actors or widen the cohort's grants.
    const selected = ctx.workforce ? {
      warehouse: ctx.workforce.byJob?.warehouse?.[2], sales: ctx.workforce.byJob?.sales?.[2],
      approver: ctx.workforce.byJob?.sales_lead?.[0], receivables: ctx.workforce.byJob?.receivables?.[0],
    } : { warehouse: actors?.stock0, sales: actors?.sales, approver: actors?.buyer1, receivables: actors?.finance1 };
    if (ctx.workforce) {
      for (const [job, actor] of Object.entries(selected)) {
        assert(actor && Number.isSafeInteger(actor.id) && actor.id > 0, `Missing existing recovery workforce duty: ${job}`);
        assert(ctx.workforce.actors.includes(actor), `${job}: recovery actor must belong to the same cohort`);
        assert(actor.account, `${job}: existing workforce account is required`);
      }
      assert.equal(new Set(Object.values(selected).map(actor => actor.id)).size, 4, 'Recovery duties require distinct real identities');
    }
    control = await createOwnedPostgresControl({ urls, signal });
    e.controlBefore = control.before;
    const initial = await control.connect('r2_recovery_initial');
    original = await settings(initial); e.settingsBefore = original; await initial.end();
    // Existing cohort credentials stay unchanged. Refresh only private session
    // state on that same actor: the native browser reasserts the same password
    // on first open and updates its token, all before the full-ledger baseline.
    // Legacy seeded actors without an account retain their old reset path.
    const password = crypto.randomBytes(24).toString('base64url') + '!Aa1';
    const sessionActors = ctx.workforce ? Object.entries(selected) : [['warehouse', selected.warehouse], ['sales', selected.sales]];
    for (const [job, actor] of sessionActors) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
      const existing = actor.account;
      const account = existing || { username: user.username, password, role: user.role, segment: user.segment };
      if (existing) {
        assert.equal(account.username, user.username, `${job}: existing account username differs from the actual actor`);
        assert.equal(account.role, user.role, `${job}: existing account role differs from the actual actor`);
        assert.equal(account.segment || 'mixed', user.segment, `${job}: existing account segment differs from the actual actor`);
        assert(typeof account.password === 'string' && account.password.length > 0, `${job}: existing password is required`);
      } else await ensureUiAuditUser(account);
      const login = dataOf(await request('/auth/login', { actor: null, method: 'POST', signal,
        data: { username: account.username, password: account.password } }));
      assert(typeof login.token === 'string' && login.token.length > 0, `${job}: recovery login has no session`);
      const current = existing ? actor : { ...actor, account };
      current.token = login.token;
      const profile = dataOf(await request('/auth/me', { actor: current, signal }));
      if (existing) {
        assert.equal(Number(profile.id), actor.id, `${job}: refreshed recovery session changed identity`);
        assert.equal(profile.username, account.username, `${job}: refreshed recovery username changed`);
        assert.equal(profile.role, account.role, `${job}: refreshed recovery role changed`);
      }
      current.profile = profile;
      if (job === 'warehouse' || job === 'sales') people[job] = current;
    }
    const fixture = await stockFixture('pg-recovery', signal);
    const buyer = dataOf(await call(people.sales, '/customers', { method: 'POST', data: {
      name: `${runId}-pg-recovery-customer`, creditLimit: 100000, termsDays: 30,
      segment: 'direct', poolState: 'private', salespersonId: people.sales.id,
      contactName: 'Synthetic recovery', contactPhone: '0900000000',
    } }));
    const order = dataOf(await call(people.sales, '/orders', { method: 'POST', data: { customerId: Number(buyer.id),
      items: [{ materialId: fixture.material.id, productName: fixture.material.nameZh, quantity: 20, unit: 'kg', unitPrice: 10 }], paymentTerms: 30 } }));
    const orderId = Number(order.id);
    dataOf(await call(selected.approver, `/orders/${orderId}/status`, { method: 'PATCH', data: { status: 'confirmed' } }));
    dataOf(await call(people.sales, `/orders/${orderId}/payment`, { method: 'POST', data: { idempotencyKey: `${runId}-pg-ar`,
      amount: 200, method: 'bank_transfer', payerName: 'Declared isolated recovery payment200' } }));
    const detail = dataOf(await call(selected.receivables, `/orders/${orderId}`));
    const paymentId = Number(detail.paymentRecords.find(row => row.status === 'pending').id);
    dataOf(await call(selected.receivables, `/orders/${orderId}/payment/${paymentId}/verify`, { method: 'POST', instance: 1 }));
    e.manifest = { orderId, orderItemId: Number(detail.items[0].id), orderNo: order.orderNo, materialId: Number(fixture.material.id),
      batchNo: fixture.batchNo, paymentId, orderedQuantity: 20, amount: 200, shipmentIds: [] };
    browser = await require('./enterprise-round2-sales-browser.cjs').createSharedSalesBrowser({ urls, actors: people, runId, folder, signal });
    for (let index = 0; index < 2; index++) {
      const draft = await browser.draft({ orderId, lineId: e.manifest.orderItemId, quantity: 10, batchNo: fixture.batchNo });
      const shipmentId = Number(draft.shipment.id); e.manifest.shipmentIds.push(shipmentId);
      await browser.reserve({ shipmentId }); await browser.dispatch({ shipmentId });
    }
    await salesRead(0);
    if (ctx.workforce) {
      const participants = {};
      // The first native opens above can refresh user.updatedAt and tokens.
      // Capture authoritative sessions only after both opens, never after the
      // ledger baseline. These raw profiles contain no token or password.
      for (const [duty, actor] of Object.entries(selected)) {
        const authProfiles = [], profilesByInstance = {};
        for (const instance of [0, 1]) {
          const action = await call(actor, '/auth/me', { instance }), profile = dataOf(action);
          assert.equal(Number(profile.id), actor.id, `${duty}: actual session belongs to another actor`);
          assert.equal(profile.role, actor.role, `${duty}: actual session role drifted`);
          assert.equal(profile.username, actor.account.username, `${duty}: actual session username drifted`);
          authProfiles.push(action);
          profilesByInstance[instance] = { ...profile };
        }
        actor.profilesByInstance = profilesByInstance;
        actor.profile = profilesByInstance[0];
        participants[duty] = { id: actor.id, role: actor.role, job: actor.job, index: actor.index, authProfiles };
      }
      e.workforceActors = { version: 'postgres-recovery-workforce-actors/v1', actors: participants };
    }
    e.profiles = Object.fromEntries(Object.entries(people).map(([job, actor]) => [job, { id: actor.id, role: actor.role,
      permissions: [...actor.profile.permissions].sort(), dataScopes: [...actor.profile.dataScopes].sort() }]));
    e.replicaStopped = await control.stopReplica();
    e.baseline = await stableSnapshot();
    for (const [index, shipmentId] of e.manifest.shipmentIds.entries()) {
      const committed = index === 1;
      const b = { name: committed ? 'commit-unknown' : 'before-commit', shipmentId, key: `${runId}-pg-receipt-${index}` };
      e.branches.push(b);
      b.beforeLedger = await stableSnapshot();
      const observer = await control.connect(`r2_recovery_observer${index}`), lock = await control.connect(`r2_recovery_lock${index}`);
      b.beforeDatabase = (await observer.query(databaseSql)).rows[0];
      if (committed) {
        const name = `r2_gate_${crypto.randomBytes(8).toString('hex')}`, value = `FIRST 1 (${name})`;
        const standbyCount = (await observer.query('SELECT * FROM pg_stat_replication')).rows.length;
        assert.equal(standbyCount, 0, 'Owned replica must be stopped before the SyncRep gate');
        await observer.query(`ALTER SYSTEM SET synchronous_standby_names = ${escapeLiteral(value)}`);
        await observer.query('SELECT pg_reload_conf()');
        await until(async () => (await observer.query("SELECT setting FROM pg_settings WHERE name='synchronous_standby_names'")).rows[0].setting,
          setting => setting === value, 3000, signal, 'SyncRep gate reload');
        b.gate = { value, standbyCount };
      }
      await lock.query('BEGIN');
      await lock.query('SELECT id FROM shipments WHERE id=$1 FOR UPDATE', [shipmentId]);
      const state = { headersReceived: false, settled: false };
      const sent = { quantity: 10, acceptedQuantity: 10, rejectedQuantity: 0, note: `${runId} actual isolated ${b.name} receipt` };
      const action = b.request = { method: 'POST', path: `/shipping/${shipmentId}/receipt-events`, actorId: people.warehouse.id,
        role: people.warehouse.role, instance: 0, sent, key: b.key, headersReceivedAt: null, startedAt: new Date().toISOString() };
      e.actions.push(action);
      const windowStart = performance.now();
      const pending = fetch(`${urls[0]}/api${action.path}`, { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${people.warehouse.token}`, 'Idempotency-Key': b.key }, body: JSON.stringify(sent) })
        .then(async response => {
          state.headersReceived = true; action.headersReceivedAt = new Date().toISOString(); action.status = response.status;
          const raw = await response.text(); try { action.json = JSON.parse(raw); } catch { action.json = { message: raw.slice(0, 200) }; }
        }).catch(error => {
          action.status = 0; action.json = null; action.transportError = { name: error.name,
            code: String(error.cause?.code || error.code || ''), message: String(error.message).slice(0, 200) };
        }).finally(() => { state.settled = true; action.finishedAt = new Date().toISOString(); });
      inFlight.add(pending); void pending.finally(() => inFlight.delete(pending));
      const waiting = await until(async () => (await observer.query(activitySql)).rows,
        rows => rows.filter(row => row.blockers.includes(lock.processID)).length === 1, 1000, signal, 'exact target row lock');
      b.bound = waiting.find(row => row.blockers.includes(lock.processID));
      assert(b.bound.backend_xid && b.bound.wait_event_type === 'Lock');
      assert.equal(b.bound.query, 'UPDATE "shipments" SET "id" = "id" WHERE "id" = $1');
      if (committed) {
        await lock.query('ROLLBACK');
        const sync = await until(async () => (await observer.query(activitySql)).rows,
          rows => rows.some(row => sameTransaction(row, b.bound) && row.query === 'COMMIT'
            && row.state === 'active' && row.wait_event_type === 'IPC' && row.wait_event === 'SyncRep'),
          1000, signal, 'same real ERP transaction COMMIT IPC/SyncRep');
        b.syncRep = sync.find(row => sameTransaction(row, b.bound));
        b.waitLSN = { value: null, localFlushed: null,
          boundary: 'Exact-backend COMMIT IPC/SyncRep plus fixed PG16.9 xact.c local WAL flush order; target process title capability checked separately, never inferred from global LSN' };
        try {
          const encoded = (await observer.query("SELECT encode(pg_read_binary_file($1,0,8192,true),'base64') AS cmd", [`/proc/${b.bound.pid}/cmdline`])).rows[0].cmd;
          const title = encoded ? Buffer.from(encoded, 'base64').toString('utf8').replaceAll('\0', ' ') : '';
          const match = /waiting for ([A-Fa-f0-9]+\/[A-Fa-f0-9]+)/.exec(title);
          if (match) { b.waitLSN.value = match[1]; b.waitLSN.localFlushed = (await observer.query('SELECT pg_current_wal_flush_lsn()>=$1::pg_lsn AS flushed', [match[1]])).rows[0].flushed; }
        } catch (error) { b.waitLSN.capabilityErrorCode = String(error.code || 'PROCESS_TITLE_UNAVAILABLE'); }
      }
      assert.equal(state.headersReceived, false); assert.equal(state.settled, false);
      b.ackPendingAtKill = { recordedAt: new Date().toISOString(), headersReceived: false, settled: false };
      b.kill = await control.killPrimary(); b.windowToKillMs = performance.now() - windowStart;
      assert(b.windowToKillMs < 3000, 'Exact fault window must fit the existing Prisma5s transaction budget');
      // Wait for the server's original request to terminate while PG remains
      // down. A client timeout cannot prove that an automatic retry has ended.
      await Promise.race([pending, delay(10000, undefined, { signal }).then(() => { throw new Error('Original ERP HTTP request did not terminate while database was down'); })]);
      assert([0, 500, 503].includes(action.status));
      if (action.status === 0) assert(['ECONNRESET', 'ECONNREFUSED', 'UND_ERR_SOCKET'].includes(action.transportError.code), 'Client timeout/abort is not crash coverage');
      const restartStartedAt = new Date().toISOString();
      b.restart = { ...await control.startPrimary(), startedAt: restartStartedAt, finishedAt: new Date().toISOString() };
      b.settingsAfterRestore = await restoreSettings(control, original, signal);
      b.recoveryLogs = await control.readRecoveryLogs({ since: b.kill.startedAt });
      b.afterRecoveryLedger = await stableSnapshot();
      b.recoveryLookup = [];
      for (const instance of [0, 1]) b.recoveryLookup.push(await call(people.warehouse,
        `/shipping/${shipmentId}/receipts?submissionKey=${encodeURIComponent(b.key)}`, { instance }));
      b.replays = [];
      for (const instance of [1, 0]) {
        const result = await call(people.warehouse, `/shipping/${shipmentId}/receipt-events`, { method: 'POST', instance,
          headers: { 'Idempotency-Key': b.key }, data: sent }); dataOf(result);
        b.replays.push(result);
        if (b.replays.length === 1) b.afterReplayLedger = await stableSnapshot();
        else b.afterSecondReplayLedger = await stableSnapshot();
      }
      const submission = b.replays[0].json.data.submission;
      await browser.readReceipt({ shipmentId, submission }); await salesRead((index + 1) * 10);
      b.readbacks = [];
      for (const instance of [0, 1]) {
        b.readbacks.push(await call(people.sales, `/orders/${orderId}`, { instance }));
        b.readbacks.push(await call(people.warehouse, `/shipping/${shipmentId}/receipts`, { instance }));
      }
    }
    e.browser = browser.evidence();
  } catch (error) { failure = error; }
  finally {
    const cleanupSignal = AbortSignal.timeout(60000);
    const clean = async (name, operation) => {
      try { const value = await operation(); e.cleanup[name] = value; }
      catch (error) { e.cleanup.errors.push({ name, message: String(error.message).slice(0, 300) }); }
    };
    if (control) {
      await clean('primary', () => control.startPrimary({ signal: cleanupSignal }));
      if (original) await clean('settingsRestored', () => restoreSettings(control, original, cleanupSignal));
      await clean('replica', () => control.restoreReplica({ signal: cleanupSignal }));
      await clean('controlAfter', async () => { e.controlAfter = await control.inspectAfter({ signal: cleanupSignal }); return 'captured'; });
      await clean('connectionsClosed', () => control.close({ signal: cleanupSignal }));
    }
    await clean('requestsSettled', () => Promise.race([Promise.all([...inFlight]), delay(5000, undefined, { ref: false }).then(() => { throw new Error('Recovery request cleanup deadline exceeded'); })]));
    if (browser) {
      e.browser = browser.evidence();
      await clean('browserClosed', () => Promise.race([browser.close(), delay(10000, undefined, { ref: false }).then(() => { throw new Error('Recovery browser cleanup deadline exceeded'); })]));
    }
    e.cleanup.status = e.cleanup.errors.length ? 'failed' : 'passed';
  }
  if (failure || e.cleanup.status !== 'passed') {
    e.status = 'failed'; const error = failure || new Error('Owned PostgreSQL recovery cleanup failed'); error.evidence = e; throw error;
  }
  e.status = 'passed'; e.chainDigest = digest(e);
  try { require('./enterprise-round2-postgres-recovery-proof.cjs').verifyPostgresRecoveryProof(e, { runId, priorChecks }); }
  catch (error) {
    e.status = 'failed'; e.verificationError = error.message; delete e.chainDigest; e.chainDigest = digest(e);
    error.evidence = e; throw error;
  }
  return e;
}

module.exports = { postgresRecoveryProbe };
