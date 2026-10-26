const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const filename = path.join(__dirname, 'lib/enterprise-round2-postgres-control.cjs');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const urls = ['http://127.0.0.1:5006', 'http://127.0.0.1:5008'];
const identity = () => ({ version: 160009, recovery: false, fsync: 'on', started_at: '2026-10-17T00:00:00Z',
  system_identifier: '1234567891234567890', database: 'ailaoda', username: 'ailaoda', data_directory: '/var/lib/postgresql/data' });

function harness(change = () => {}) {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123456', AILAODA_IMAGE_TAG: '123456', ROUND2_ALLOW_MUTATIONS: 'true',
    AUDIT_PRISMA_PROVIDER: 'postgresql', COMPOSE_FILE: 'ops/cloud-sandbox/docker-compose.yml', POSTGRES_HOST_PORT: '55439',
    AUDIT_DATABASE_URL: 'postgresql://ailaoda:private-fixture-password@127.0.0.1:55439/ailaoda?schema=public' };
  const calls = [], connections = [], queryCalls = [];
  let db = identity();
  const rows = ['postgres', 'postgres-replica', 'app-primary', 'app-secondary'].map((service, index) => ({
    Id: String(index + 1).repeat(64), Image: `sha256:${String(index + 1).repeat(64)}`, Config: { Image: service.startsWith('app-') ? 'ailaoda-enterprise-cloud:123456' : 'postgres:16.9-alpine',
      Labels: { 'com.docker.compose.service': service, 'com.docker.compose.project': 'cloud-sandbox',
        'com.docker.compose.project.working_dir': path.join(root, 'ops/cloud-sandbox'),
        'com.docker.compose.project.config_files': path.join(root, 'ops/cloud-sandbox/docker-compose.yml'), 'com.docker.compose.oneoff': 'False' },
      Env: ['SECRET=do-not-include', 'DATABASE_URL=postgresql://ailaoda:private-fixture-password@postgres-router:5432/ailaoda?schema=public'] },
    State: { Running: true, ExitCode: 0, StartedAt: `2026-10-17T00:00:0${index}Z` },
    HostConfig: { PortBindings: { '5432/tcp': [{ HostIp: '', HostPort: '55439' }] } },
    NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '55439' }] } },
    Mounts: service.startsWith('app-') ? [] : [{ Type: 'volume', Name: `cloud-sandbox_postgres-${index === 0 ? 'primary' : 'replica'}-data`,
      Source: `/var/lib/docker/volumes/owned${index}/_data`, Destination: '/var/lib/postgresql/data', RW: true }],
  }));
  const h = { env, rows, calls, connections, queryCalls, db, urlValues: [...urls], replica: { recovery: true, streaming: true, replayLsn: '0/200' },
    setDatabase(value) { db = value; } };
  change(h);
  class Client extends EventEmitter {
    constructor(config) { super(); this.config = config; this.ended = false; connections.push(this); }
    async connect() {}
    async query(text, values) {
      queryCalls.push({ text, values, name: this.config.application_name });
      if (text.includes('server_version_num')) return { rows: [clone(db)] };
      if (text.includes('pg_current_wal_flush_lsn')) return { rows: [{ lsn: '0/100' }] };
      if (text.includes('caught_up')) return { rows: [{ caught_up: true }] };
      return { rows: [] };
    }
    async end() { this.ended = true; }
  }
  function fakeExec(command, args, options, callback) {
    calls.push({ command, args: [...args], options });
    try {
      let output, stderr = '';
      if (args[0] === 'compose') output = rows.map(row => row.Id).join('\n');
      else if (args[0] === 'inspect') output = JSON.stringify(rows.filter(row => args.slice(1).includes(row.Id)));
      else if (args[0] === 'exec') output = JSON.stringify(h.replica);
      else if (args[0] === 'logs') { output = h.logStdout || ''; stderr = h.logStderr || ''; }
      else {
        const row = rows.find(item => item.Id === args.at(-1)); assert(row);
        if (args[0] === 'kill') { row.State.Running = false; row.State.ExitCode = 137; row.NetworkSettings.Ports = {}; }
        else if (args[0] === 'stop') { row.State.Running = false; row.State.ExitCode = 0; }
        else if (args[0] === 'start') { row.State.Running = true; row.State.ExitCode = 0; row.State.StartedAt = '2026-10-17T00:01:00Z';
          if (row === rows[0]) db.started_at = '2026-10-17T00:01:00Z'; }
        else throw new Error('Unexpected docker command');
        output = row.Id;
      }
      queueMicrotask(() => callback(null, { stdout: output, stderr }));
    } catch (error) { queueMicrotask(() => callback(error)); }
  }
  // Match promisify(execFile)'s object return, without spawning any process.
  fakeExec[require('node:util').promisify.custom] = async (...args) => new Promise((resolve, reject) =>
    fakeExec(...args, (error, result) => error ? reject(error) : resolve(result)));
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, __dirname: path.dirname(filename), process: { env },
    require: name => name === 'node:child_process' ? { execFile: fakeExec } : name === '../../backend/node_modules/pg' ? { Client } : require(name),
    URL, AbortSignal, Date, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  h.create = () => { context.urlValuesJSON = JSON.stringify(h.urlValues); context.businessSignal = h.signal;
    return vm.runInContext('module.exports.createOwnedPostgresControl({ urls: JSON.parse(urlValuesJSON), signal: businessSignal })', context); };
  return h;
}

test('owned controller preserves exact container/volume and restores streaming without restarting apps', async () => {
  const h = harness(), control = await h.create();
  assert.equal(control.before.database.version, 160009);
  assert.equal(control.before.database.dataDirectory, '/var/lib/postgresql/data');
  assert.equal(control.before.containers[0].imageId, h.rows[0].Image);
  const serialized = JSON.stringify(control.before);
  assert(!serialized.includes('private-fixture-password') && !serialized.includes('SECRET=') && !serialized.includes('DATABASE_URL'));
  await control.stopReplica(); const killed = await control.killPrimary();
  assert.equal(killed.exitCode, 137); assert.equal(killed.id, h.rows[0].Id);
  assert.equal(killed.processStartedAt, control.before.containers[0].startedAt);
  assert(Date.parse(killed.finishedAt) >= Date.parse(killed.startedAt));
  const killIndex = h.calls.findIndex(c => c.args[0] === 'kill');
  assert.deepEqual(h.calls.slice(killIndex - 1, killIndex + 2).map(c => c.args[0]), ['inspect', 'kill', 'inspect']);
  const restarted = await control.startPrimary(); assert.equal(restarted.restarted, true);
  const restored = await control.restoreReplica(); assert.equal(restored.streaming, true); assert.equal(restored.recovery, true);
  const after = await control.inspectAfter(); assert.equal(after.database.systemIdentifier, control.before.database.systemIdentifier);
  assert.equal(after.containers[2].startedAt, control.before.containers[2].startedAt);
  assert.deepEqual(h.calls.filter(c => c.args[0] === 'kill').map(c => c.args.slice(0, 3)), [['kill', '--signal', 'KILL']]);
  assert(h.calls.every(c => c.command === 'docker' && c.options.windowsHide && c.options.timeout === 15000));
  assert(!h.calls.some(c => c.args.some(a => ['promote', 'rm', 'down', 'run', 'up', '--force-recreate'].includes(a))));
  await control.close(); assert(h.connections.every(c => c.ended));
});

test('direct clients strip Prisma schema, set bounded statement timeout and local sync commit by default', async () => {
  const h = harness(), control = await h.create();
  const a = await control.connect('own_control'), b = await control.connect('own_business', { local: false });
  assert(!a.config.connectionString.includes('schema=')); assert.equal(a.config.connectionTimeoutMillis, 2000); assert.equal(a.config.query_timeout, 3500);
  assert(h.queryCalls.some(q => q.name === 'own_control' && q.text === "SET synchronous_commit = 'local'"));
  assert(!h.queryCalls.some(q => q.name === 'own_business' && q.text.includes('synchronous_commit')));
  a.emit('error', Object.assign(new Error('secret connection detail'), { code: '57P01' }));
  const after = await control.inspectAfter(); assert.equal(after.connectionErrors[0].code, '57P01');
  assert(!JSON.stringify(after).includes('secret connection detail'));
  assert.equal(b.ended, false); await control.close(); assert(b.ended);
  await assert.rejects(control.connect('closed'), /closed/);
});

for (const [name, mutate] of [
  ['outside GitHub', h => { h.env.GITHUB_ACTIONS = 'false'; }],
  ['without mutation opt-in', h => { h.env.ROUND2_ALLOW_MUTATIONS = 'false'; }],
  ['SQLite environment', h => { h.env.AUDIT_PRISMA_PROVIDER = 'sqlite'; }],
  ['foreign run tag', h => { h.env.AILAODA_IMAGE_TAG = 'different'; }],
  ['arbitrary compose path', h => { h.env.COMPOSE_FILE = 'another.yml'; }],
  ['external URL', h => { h.urlValues[0] = 'http://example.com:5006'; }],
  ['wrong app port', h => { h.urlValues[1] = 'http://127.0.0.1:5007'; }],
  ['external database', h => { h.env.AUDIT_DATABASE_URL = h.env.AUDIT_DATABASE_URL.replace('127.0.0.1', 'example.com'); }],
  ['unbound database port', h => { h.env.POSTGRES_HOST_PORT = '55440'; }],
  ['foreign database options', h => { h.env.AUDIT_DATABASE_URL += '&options=-csearch_path=foreign'; }],
  ['foreign schema', h => { h.env.AUDIT_DATABASE_URL = h.env.AUDIT_DATABASE_URL.replace('public', 'foreign'); }],
  ['foreign project label', h => { h.rows[0].Config.Labels['com.docker.compose.project'] = 'foreign'; }],
  ['multiple compose files', h => { h.rows[0].Config.Labels['com.docker.compose.project.config_files'] += ',foreign.yml'; }],
  ['foreign working directory', h => { h.rows[0].Config.Labels['com.docker.compose.project.working_dir'] = '/foreign'; }],
  ['one-off container', h => { h.rows[0].Config.Labels['com.docker.compose.oneoff'] = 'True'; }],
  ['changed image tag', h => { h.rows[0].Config.Image = 'postgres:17.7'; }],
  ['missing immutable image ID', h => { h.rows[0].Image = ''; }],
  ['unowned volume name', h => { h.rows[0].Mounts[0].Name = 'foreign'; }],
  ['read-only volume', h => { h.rows[0].Mounts[0].RW = false; }],
  ['bind mount instead of owned volume', h => { h.rows[0].Mounts[0].Type = 'bind'; }],
  ['app database mismatch', h => { h.rows[2].Config.Env[1] = h.rows[2].Config.Env[1].replace('private-fixture-password', 'foreign-fixture-password'); }],
  ['app on wrong database host', h => { h.rows[2].Config.Env[1] = h.rows[2].Config.Env[1].replace('postgres-router', 'postgres'); }],
  ['direct port not published', h => { h.rows[0].HostConfig.PortBindings = {}; }],
  ['stopped application', h => { h.rows[2].State.Running = false; }],
  ['actual wrong server version', h => { h.db.version = 170007; }],
  ['actual read-only primary', h => { h.db.recovery = true; }],
  ['fsync disabled', h => { h.db.fsync = 'off'; }],
  ['replica promoted', h => { h.replica.recovery = false; }],
  ['replica not streaming', h => { h.replica.streaming = false; }],
]) test(`refuses ${name} before destructive command`, async () => {
  const h = harness(mutate); let rejection;
  await assert.rejects(h.create(), error => { rejection = error; return true; });
  assert(!h.calls.some(c => ['kill', 'stop', 'start'].includes(c.args[0])));
  assert(h.connections.every(c => c.ended));
  if (name === 'app database mismatch') {
    for (const text of [rejection.message, rejection.stack, JSON.stringify(rejection)]) {
      assert.equal(typeof text, 'string');
      assert(!text.includes('private-fixture-password'), 'Mismatch failure leaked direct audit password');
      assert(!text.includes('foreign-fixture-password'), 'Mismatch failure leaked app password');
    }
    assert.equal(rejection.message, 'App and direct audit database differ');
  }
});

test('cannot kill with a live replica or after app generation changes', async () => {
  const h = harness(), control = await h.create();
  await assert.rejects(control.killPrimary(), /replica/);
  await control.stopReplica(); h.rows[2].State.StartedAt = '2026-10-17T00:10:00Z';
  await assert.rejects(control.killPrimary(), /App was restarted/);
  assert(!h.calls.some(c => c.args[0] === 'kill')); await control.close();
});

for (const [name, mutate] of [
  ['replacement primary ID', h => { h.rows[0].Id = 'f'.repeat(64); }],
  ['changed PGDATA source', h => { h.rows[0].Mounts[0].Source = '/foreign'; }],
  ['primary process generation changed', h => { h.rows[0].State.StartedAt = '2026-10-17T00:00:01Z'; }],
  ['app immutable image changed', h => { h.rows[2].Image = `sha256:${'f'.repeat(64)}`; }],
]) test(`refuses ${name} immediately before killing`, async () => {
  const h = harness(), control = await h.create(); await control.stopReplica(); mutate(h);
  await assert.rejects(control.killPrimary()); assert(!h.calls.some(c => c.args[0] === 'kill')); await control.close();
});

test('initially stopped replica stays stopped and is never started by cleanup', async () => {
  const h = harness(h => { h.rows[1].State.Running = false; }), control = await h.create();
  assert.equal((await control.stopReplica()).stopped, false);
  await control.killPrimary(); await control.startPrimary(); assert.equal((await control.restoreReplica()).restored, false);
  await control.inspectAfter(); assert(!h.calls.some(c => c.args[0] === 'start' && c.args.at(-1) === h.rows[1].Id)); await control.close();
});

test('cleanup can use an independent signal after the business signal aborts', async () => {
  const controller = new AbortController(), h = harness(h => { h.signal = controller.signal; }), control = await h.create();
  await control.stopReplica(); await control.killPrimary(); controller.abort();
  await assert.rejects(control.startPrimary(), /abort/i);
  const cleanupSignal = AbortSignal.timeout(60000);
  await control.startPrimary({ signal: cleanupSignal }); await control.restoreReplica({ signal: cleanupSignal });
  await control.inspectAfter({ signal: cleanupSignal }); await control.close();
});

test('refuses changed database cluster after restart', async () => {
  const h = harness(), control = await h.create(); await control.stopReplica(); await control.killPrimary();
  h.db.system_identifier = '9999999999'; await assert.rejects(control.startPrimary(), /cluster replaced/); await control.close();
});

test('close has an independent bounded signal even if client.end never settles', async () => {
  const h = harness(), control = await h.create(), client = await control.connect('stuck_client');
  client.end = () => new Promise(() => {});
  const timer = setTimeout(() => {}, 1000);
  try { await assert.rejects(control.close({ signal: AbortSignal.timeout(10) }), /cleanup did not complete/); }
  finally { clearTimeout(timer); }
});

test('mutating public before evidence cannot replace private database cluster identity', async () => {
  const h = harness(), control = await h.create(); await control.stopReplica(); await control.killPrimary();
  h.db.system_identifier = '9999999999'; control.before.database.systemIdentifier = '9999999999';
  await assert.rejects(control.startPrimary(), /cluster replaced/); await control.close();
});

test('recovery logs bind the exact primary and retain PostgreSQL stderr with a raw digest', async () => {
  const h = harness(h => { h.logStdout = 'container startup\n'; h.logStderr = 'database system was not properly shut down; automatic recovery in progress\n'; });
  const control = await h.create(), since = '2026-10-17T00:00:00.000Z';
  const result = await control.readRecoveryLogs({ since });
  assert.equal(result.containerId, h.rows[0].Id); assert.equal(result.since, since);
  assert(result.text.includes('automatic recovery in progress'));
  assert.equal(result.sha256, require('node:crypto').createHash('sha256').update(result.text).digest('hex'));
  assert.deepEqual(h.calls.find(c => c.args[0] === 'logs').args, ['logs', '--since', since, h.rows[0].Id]);
  await assert.rejects(control.readRecoveryLogs({ since: 'not-a-timestamp' }));
  await control.close();
});

test('recovery log capture refuses a changed owned volume before docker logs is dispatched', async () => {
  const h = harness(), control = await h.create(); h.rows[0].Mounts[0].Source = '/foreign';
  await assert.rejects(control.readRecoveryLogs({ since: '2026-10-17T00:00:00.000Z' }));
  assert(!h.calls.some(c => c.args[0] === 'logs')); await control.close();
});
