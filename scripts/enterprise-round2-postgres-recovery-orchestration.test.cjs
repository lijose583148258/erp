const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const file = path.join(__dirname, 'lib/enterprise-round2-postgres-recovery.cjs');
const actualRequire = createRequire(file);
const copy = value => JSON.parse(JSON.stringify(value));
function harness(env = {}, hooks = {}) {
  const calls = { controls: 0, api: 0, escapedLiterals: [] };
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, __dirname: path.dirname(file),
    process: { env }, performance, AbortSignal, URL, Buffer, Date,
    require(name) {
      if (name === 'node:fs') return { ...fs, mkdirSync() {} };
      // The source gate has no node_modules. Test orchestration/delegation,
      // not the third-party driver's SQL escaping implementation.
      if (name === '../../backend/node_modules/pg') return { escapeLiteral(value) {
        calls.escapedLiterals.push(value); return '__SYNTHETIC_DRIVER_ESCAPED_LITERAL__';
      } };
      if (name === './ui-audit-user.cjs') return { ensureUiAuditUser: hooks.ensureUiAuditUser || (() => { throw new Error('Must not seed an unowned database'); }) };
      if (name === './enterprise-round2-postgres-control.cjs') return { createOwnedPostgresControl() {
        calls.controls++;
        if (hooks.createOwnedPostgresControl) return hooks.createOwnedPostgresControl();
        throw new Error('Owned control refused');
      } };
      return actualRequire(name);
    },
  });
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\nmodule.exports.testing = { settings, restoreSettings, until };', context, { filename: file });
  return { ...module.exports, calls, context };
}

for (const env of [{}, { ROUND2_POSTGRES_RECOVERY: 'false' },
  { ROUND2_POSTGRES_RECOVERY: 'TRUE' }, { ROUND2_POSTGRES_RECOVERY: 'true', AUDIT_PRISMA_PROVIDER: 'sqlite' }]) {
  test(`producer refuses non-PG opt-in before API/fixture/controller access: ${JSON.stringify(env)}`, async () => {
    const h = harness(env);
    await assert.rejects(h.postgresRecoveryProbe({ request() { h.calls.api++; }, priorChecks: [],
      reportPath: path.join(__dirname, '../output/never-written/report.json'), runId: 'negative-owned-guard' }, AbortSignal.timeout(1000)),
    error => error.evidence?.status === 'failed' && error.evidence.cleanup.status === 'passed');
    assert.equal(h.calls.controls, 0); assert.equal(h.calls.api, 0);
  });
}

test('producer attaches its failed raw evidence when the owned cloud controller refuses', async () => {
  const h = harness({ ROUND2_POSTGRES_RECOVERY: 'true', AUDIT_PRISMA_PROVIDER: 'postgresql' });
  await assert.rejects(h.postgresRecoveryProbe({ request() { h.calls.api++; }, priorChecks: [],
    reportPath: path.join(__dirname, '../output/never-written/report.json'), runId: 'negative-controller-guard' }, AbortSignal.timeout(1000)),
  error => error.message === 'Owned control refused' && error.evidence?.branches.length === 0 && error.evidence?.cleanup.errors.length === 0);
  assert.equal(h.calls.controls, 1); assert.equal(h.calls.api, 0);
});

function originalSettings(value, auto) {
  return { effective: { name: 'synchronous_standby_names', setting: value, source: auto ? 'configuration file' : 'default',
    sourcefile: auto ? '/var/lib/postgresql/data/postgresql.auto.conf' : null, pending_restart: false },
  autoEntries: auto ? [{ sourcefile: '/var/lib/postgresql/data/postgresql.auto.conf', name: 'synchronous_standby_names',
    setting: value, applied: true, error: null }] : [], errors: [] };
}
function restoreHarness(original, { reload = true, fileError = null } = {}) {
  const calls = [], client = { ended: false, async query(sql) {
    calls.push(sql);
    if (sql.includes('pg_reload_conf()')) return { rows: [{ reloaded: reload }] };
    if (sql.includes('FROM pg_settings')) return { rows: [copy(original.effective)] };
    if (sql.includes('WHERE error IS NOT NULL')) return { rows: fileError ? [{ error: fileError }] : [] };
    if (sql.includes('FROM pg_file_settings')) return { rows: copy(original.autoEntries) };
    return { rows: [] };
  }, async end() { this.ended = true; } };
  return { calls, client, control: { async connect(name, options) { assert.equal(name, 'r2_recovery_restore'); assert(options.signal); return client; } } };
}

test('customer creation uses the private refreshed sales session, never the stale outer customer closure', async () => {
  const original = originalSettings('', false), restore = restoreHarness(original);
  const actors = { stock0: { id: 11, role: 'warehouse', token: 'stale-stock' },
    sales: { id: 12, role: 'sales', token: 'stale-sales' } };
  let staleCalls = 0, customerCalls = 0;
  const h = harness({ ROUND2_POSTGRES_RECOVERY: 'true', AUDIT_PRISMA_PROVIDER: 'postgresql' }, {
    ensureUiAuditUser: async () => {},
    createOwnedPostgresControl: async () => ({ before: {}, connect: async () => restore.client,
      startPrimary: async () => {}, restoreReplica: async () => {}, inspectAfter: async () => ({}), close: async () => {} }),
  });
  const request = async (endpoint, options) => {
    if (endpoint === '/auth/login') return { json: { data: { token: `fresh-${options.data.username}` } } };
    if (endpoint === '/auth/me') return { json: { data: { permissions: [], dataScopes: [] } } };
    assert.equal(endpoint, '/customers'); customerCalls++;
    assert.equal(options.actor.token, 'fresh-user12');
    assert.equal(options.actor.id, actors.sales.id);
    assert.notEqual(options.actor, actors.sales);
    assert.equal(options.data.salespersonId, actors.sales.id);
    assert.equal(options.data.name, 'fresh-session-pg-recovery-customer');
    throw new Error('Stop after fresh customer request');
  };
  await assert.rejects(h.postgresRecoveryProbe({ request, dataOf: result => result.json.data, actors,
    prisma: { user: { findUniqueOrThrow: async ({ where }) => ({ username: `user${where.id}`,
      role: where.id === 11 ? 'warehouse' : 'sales', segment: 'direct' }) } },
    runId: 'fresh-session', reportPath: path.join(__dirname, '../output/never-written/report.json'), priorChecks: [],
    stockFixture: async () => ({}), customer: async () => { staleCalls++; throw new Error('Stale outer customer closure'); },
  }, AbortSignal.timeout(1000)), error => error.message === 'Stop after fresh customer request'
    && error.evidence.cleanup.status === 'passed');
  assert.equal(customerCalls, 1); assert.equal(staleCalls, 0);
  assert.equal(actors.sales.token, 'stale-sales');
  assert.equal(actors.stock0.token, 'stale-stock');
});

test('cleanup resets only a previously absent synchronous setting, never RESET ALL', async () => {
  const h = harness(), original = originalSettings('', false), restore = restoreHarness(original);
  const result = await h.testing.restoreSettings(restore.control, original, AbortSignal.timeout(1000));
  assert.deepEqual(copy(result), original);
  assert.deepEqual(restore.calls.filter(sql => sql.startsWith('ALTER SYSTEM')), ['ALTER SYSTEM RESET synchronous_standby_names']);
  assert(restore.client.ended);
});

test('cleanup delegates the unmodified original auto.conf value to the driver literal escaper', async () => {
  const h = harness(), value = 'FIRST 1 ("old\'quoted\\standby")', original = originalSettings(value, true), restore = restoreHarness(original);
  const result = await h.testing.restoreSettings(restore.control, original, AbortSignal.timeout(1000));
  assert.deepEqual(copy(result), original);
  assert.deepEqual(h.calls.escapedLiterals, [value]);
  assert.deepEqual(restore.calls.filter(sql => sql.startsWith('ALTER SYSTEM')), ['ALTER SYSTEM SET synchronous_standby_names = __SYNTHETIC_DRIVER_ESCAPED_LITERAL__']);
  assert(restore.client.ended);
});

for (const options of [{ reload: false }, { fileError: 'invalid setting' }]) {
  test(`failed configuration restore is refused and still closes its dedicated connection: ${JSON.stringify(options)}`, async () => {
    const h = harness(), original = originalSettings('', false), restore = restoreHarness(original, options);
    await assert.rejects(h.testing.restoreSettings(restore.control, original, AbortSignal.timeout(1000)));
    assert(restore.client.ended);
  });
}

test('a successful observation arriving beyond its deadline does not count as coverage', async () => {
  const h = harness(); let now = 0;
  h.context.performance = { now: () => now };
  await assert.rejects(h.testing.until(async () => { now = 100; return true; }, value => value, 10,
    AbortSignal.timeout(1000), 'late observer'), /coverage missing: late observer/);
});

test('an aborted observation never calls its read function', async () => {
  const h = harness(), controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(h.testing.until(async () => { calls++; return true; }, value => value, 100, controller.signal, 'aborted observer'));
  assert.equal(calls, 0);
});
