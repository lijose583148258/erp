const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const crypto = require('node:crypto');

const exec = promisify(execFile);
const services = ['postgres', 'postgres-replica', 'app-primary', 'app-secondary'];
const dataDirectory = '/var/lib/postgresql/data';
const root = path.resolve(__dirname, '../..');
const composeFile = path.join(root, 'ops/cloud-sandbox/docker-compose.yml');
const databaseIdentitySql = `SELECT current_setting('server_version_num')::int AS version,
  pg_is_in_recovery() AS recovery, current_setting('fsync') AS fsync,
  pg_postmaster_start_time()::text AS started_at,
  (pg_control_system()).system_identifier::text AS system_identifier,
  current_database() AS database, current_user AS username, current_setting('data_directory') AS data_directory`;

// Only the already-running, owned GitHub sandbox. This is not a general
// database controller, restart endpoint, failover implementation or retry loop.
async function createOwnedPostgresControl({ urls, signal }) {
  const env = process.env;
  assert.equal(env.ROUND2_ALLOW_MUTATIONS, 'true');
  assert.equal(env.GITHUB_ACTIONS, 'true');
  assert.equal(env.AUDIT_PRISMA_PROVIDER, 'postgresql');
  assert.match(env.GITHUB_RUN_ID || '', /^\d+$/);
  assert.equal(env.AILAODA_IMAGE_TAG, env.GITHUB_RUN_ID);
  assert.equal(path.resolve(root, env.COMPOSE_FILE || ''), composeFile);
  assert.deepEqual(urls.map(value => { const u = new URL(value); assert.equal(u.protocol, 'http:');
    assert.equal(u.hostname, '127.0.0.1'); assert(!u.username && !u.password && !u.search && !u.hash);
    assert(['', '/'].includes(u.pathname)); return u.port; }), ['5006', '5008']);
  const project = env.COMPOSE_PROJECT_NAME || 'cloud-sandbox';
  assert.match(project, /^[a-z0-9][a-z0-9_-]*$/);
  const database = new URL(env.AUDIT_DATABASE_URL || '');
  assert.equal(database.protocol, 'postgresql:'); assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.pathname, '/ailaoda'); assert.equal(decodeURIComponent(database.username), 'ailaoda');
  assert(database.password, 'Explicit isolated database credentials are required');
  assert.match(env.POSTGRES_HOST_PORT || '', /^\d+$/);
  assert.equal(database.port, env.POSTGRES_HOST_PORT);
  assert([...database.searchParams.keys()].every(key => key === 'schema'), 'Unexpected database URL options');
  assert.equal(database.searchParams.get('schema') || 'public', 'public');
  database.searchParams.delete('schema');
  const connectionString = database.toString();
  const { Client } = require('../../backend/node_modules/pg');
  const clients = new Set(); let closed = false, stoppedByUs = false;
  const connectionErrors = [];
  const effectiveSignal = options => options?.signal || signal;
  const safeError = error => String(error?.code || 'POSTGRES_CONTROL_ERROR').slice(0, 100);
  const docker = async (args, options = {}) => {
    const active = effectiveSignal(options); active?.throwIfAborted();
    try {
      const result = await exec('docker', args, { cwd: root, encoding: 'utf8', timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024, windowsHide: true, signal: active });
      return options.includeStderr ? `${result.stdout}${result.stderr}`.trim() : result.stdout.trim();
    }
    catch (error) { throw new Error(`Owned sandbox docker operation failed (${safeError(error)})`); }
  };
  const inspect = async (ids, options) => {
    const rows = JSON.parse(await docker(['inspect', ...ids], options));
    assert(Array.isArray(rows) && rows.length === ids.length, 'Incomplete container identity');
    return rows;
  };
  const ids = (await docker(['compose', 'ps', '-a', '-q', ...services])).split(/\s+/);
  assert.equal(ids.length, services.length); assert.equal(new Set(ids).size, services.length);
  assert(ids.every(id => /^[a-f0-9]{12,64}$/.test(id)), 'Invalid owned container ID');
  const original = {};
  const pgMount = item => {
    const mounts = item.Mounts.filter(mount => mount.Destination === dataDirectory);
    assert.equal(mounts.length, 1, 'PGDATA must have exactly one existing volume');
    const mount = mounts[0]; assert.equal(mount.Type, 'volume'); assert(mount.RW);
    const suffix = item.Config.Labels['com.docker.compose.service'] === 'postgres' ? 'postgres-primary-data' : 'postgres-replica-data';
    assert.equal(mount.Name, `${project}_${suffix}`, 'Foreign PostgreSQL volume');
    assert(typeof mount.Source === 'string' && mount.Source.startsWith('/'), 'Missing PGDATA volume source');
    return { name: mount.Name, source: mount.Source, destination: mount.Destination, writable: mount.RW };
  };
  const validateContainer = item => {
    assert(item && /^[a-f0-9]{64}$/.test(item.Id), 'Missing full container ID');
    assert.match(item.Image || '', /^sha256:[a-f0-9]{64}$/, 'Missing immutable image ID');
    const labels = item.Config?.Labels || {}, service = labels['com.docker.compose.service'];
    assert(services.includes(service), 'Foreign compose service'); assert.equal(labels['com.docker.compose.project'], project);
    assert([root, path.dirname(composeFile)].includes(path.resolve(labels['com.docker.compose.project.working_dir'] || '')));
    assert.equal(labels['com.docker.compose.project.config_files'], composeFile, 'Foreign/multiple compose configuration');
    assert.equal(labels['com.docker.compose.oneoff'], 'False');
    assert.equal(item.Config.Image, service.startsWith('app-') ? `ailaoda-enterprise-cloud:${env.GITHUB_RUN_ID}` : 'postgres:16.9-alpine');
    if (!service.startsWith('app-')) pgMount(item);
    else {
      const entries = (item.Config.Env || []).filter(value => value.startsWith('DATABASE_URL='));
      assert.equal(entries.length, 1, 'Missing app database binding');
      const appDatabase = new URL(entries[0].slice('DATABASE_URL='.length));
      assert.equal(appDatabase.hostname, 'postgres-router'); assert.equal(appDatabase.port, '5432');
      assert.equal(appDatabase.pathname, database.pathname); assert.equal(appDatabase.username, database.username);
      assert(appDatabase.password === database.password, 'App and direct audit database differ');
    }
    if (service === 'postgres') {
      // Runtime Ports can disappear while stopped; configured PortBindings
      // persist and must still identify the same owned direct audit socket.
      const bindings = item.HostConfig?.PortBindings?.['5432/tcp'] || [];
      assert(bindings.some(binding => ['', '127.0.0.1', '0.0.0.0', '::'].includes(binding.HostIp)
        && binding.HostPort === database.port), 'Direct audit port does not target owned primary');
    }
    return service;
  };
  for (const item of await inspect(ids)) { const service = validateContainer(item);
    assert(!original[service], 'Duplicate owned compose service'); original[service] = item; }
  assert.deepEqual(Object.keys(original).sort(), [...services].sort());
  assert(services.filter(service => service !== 'postgres-replica').every(service => original[service].State.Running), 'Primary and apps must already be running');
  assert(services.every(service => typeof original[service].State.StartedAt === 'string' && original[service].State.StartedAt), 'Missing process generation');
  const sameContainers = async (options, discover = true) => {
    if (discover) {
      const currentIds = (await docker(['compose', 'ps', '-a', '-q', ...services], options)).split(/\s+/);
      assert.deepEqual([...currentIds].sort(), [...ids].sort(), 'Owned sandbox container set changed');
    }
    const rows = await inspect(ids, options), mapped = {};
    for (const item of rows) { const service = validateContainer(item), prior = original[service];
      assert.equal(item.Id, prior.Id, 'Container replaced');
      assert.equal(item.Image, prior.Image, 'Container image changed');
      if (service === 'postgres') assert.deepEqual(item.HostConfig.PortBindings, prior.HostConfig.PortBindings, 'Primary port mapping changed');
      if (!service.startsWith('app-')) assert.deepEqual(pgMount(item), pgMount(prior), 'PGDATA volume changed');
      else { assert.equal(item.State.StartedAt, prior.State.StartedAt, 'App was restarted instead of the database');
        assert(item.State.Running, 'Application process stopped'); }
      mapped[service] = item;
    }
    return mapped;
  };
  const waitFor = async (probe, options = {}, timeoutMs = 30_000) => {
    const active = effectiveSignal(options), deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      active?.throwIfAborted();
      if (await probe()) return;
      await delay(150, undefined, { signal: active });
    }
    throw new Error('Owned PostgreSQL readiness deadline exceeded');
  };
  const connect = async (name, options = {}) => {
    assert(!closed, 'PostgreSQL control is closed'); assert.match(name, /^[A-Za-z0-9_:-]{1,63}$/);
    const active = effectiveSignal(options); active?.throwIfAborted();
    const client = new Client({ connectionString, application_name: name, connectionTimeoutMillis: 2000, query_timeout: 3500 });
    client.on('error', error => connectionErrors.push({ connection: name, code: safeError(error) }));
    try {
      await client.connect();
      await client.query('SET statement_timeout = 3000');
      if (options.local !== false) await client.query("SET synchronous_commit = 'local'");
      active?.throwIfAborted(); clients.add(client); return client;
    } catch (error) { try { await client.end(); } catch {} throw new Error(`Owned PostgreSQL connection failed (${safeError(error)})`); }
  };
  const readIdentity = async options => {
    const client = await connect('r2_control_identity', options);
    try { const rows = (await client.query(databaseIdentitySql)).rows; assert.equal(rows.length, 1); const identity = rows[0];
      assert.equal(identity.version, 160009, 'This acceptance requires actual PostgreSQL 16.9');
      assert.equal(identity.recovery, false, 'Audit port is not the writable primary'); assert.equal(identity.fsync, 'on');
      assert.equal(identity.database, 'ailaoda'); assert.equal(identity.username, 'ailaoda'); assert.equal(identity.data_directory, dataDirectory);
      assert.match(identity.system_identifier, /^\d+$/); assert(Number.isFinite(Date.parse(identity.started_at)));
      return { version: identity.version, recovery: identity.recovery, fsync: identity.fsync, dataDirectory: identity.data_directory,
        systemIdentifier: identity.system_identifier, postmasterStartedAt: identity.started_at };
    } finally { clients.delete(client); await client.end(); }
  };
  const replicaState = async options => {
    const text = await docker(['exec', original['postgres-replica'].Id, 'psql', '-X', '-U', 'ailaoda', '-d', 'ailaoda', '-v', 'ON_ERROR_STOP=1', '-tAc',
      "SELECT json_build_object('recovery',pg_is_in_recovery(),'replayLsn',pg_last_wal_replay_lsn()::text,'streaming',EXISTS(SELECT 1 FROM pg_stat_wal_receiver WHERE status='streaming'))"], options);
    const row = JSON.parse(text); assert.equal(row.recovery, true, 'Replica was promoted');
    assert.equal(row.streaming, true, 'Replica is not streaming'); assert.match(row.replayLsn || '', /^[A-Fa-f0-9]+\/[A-Fa-f0-9]+$/); return row;
  };
  let initialIdentity;
  try { initialIdentity = await readIdentity(); if (original['postgres-replica'].State.Running) await replicaState(); }
  catch (error) { await Promise.allSettled([...clients].map(client => client.end())); throw error; }
  let expectedPrimaryStartedAt = original.postgres.State.StartedAt;
  const expectedSystemIdentifier = initialIdentity.systemIdentifier;
  const publicContainer = item => ({ id: item.Id, image: item.Config.Image, imageId: item.Image,
    service: item.Config.Labels['com.docker.compose.service'], project, running: item.State.Running, startedAt: item.State.StartedAt,
    ...(item.Config.Image === 'postgres:16.9-alpine' ? { volume: pgMount(item) } : {}) });
  const before = { version: 'owned-postgres-control/v1', githubRunId: env.GITHUB_RUN_ID, project,
    containers: services.map(service => publicContainer(original[service])), database: { ...initialIdentity }, credentialsIncluded: false };
  return {
    before, connect,
    async stopReplica(options = {}) {
      const current = await sameContainers(options);
      if (!original['postgres-replica'].State.Running) { assert(!current['postgres-replica'].State.Running); return { stopped: false, originallyRunning: false }; }
      assert(current['postgres-replica'].State.Running, 'Replica unexpectedly stopped');
      // Set before dispatch: even if command observation fails, finally knows
      // which originally-running replica it is responsible for restoring.
      stoppedByUs = true;
      await docker(['stop', '--time', '5', original['postgres-replica'].Id], options);
      const after = await sameContainers(options); assert.equal(after['postgres-replica'].State.Running, false);
      return { stopped: true, id: original['postgres-replica'].Id, originallyRunning: true };
    },
    async killPrimary(options = {}) {
      // During the <5s Prisma commit window use the cached exact owned IDs:
      // fresh inspect, precise kill, fresh inspect; no compose discovery.
      const current = await sameContainers(options, false); assert(current.postgres.State.Running, 'Primary is not running');
      assert.equal(current.postgres.State.StartedAt, expectedPrimaryStartedAt, 'Primary generation changed before fault injection');
      assert(!current['postgres-replica'].State.Running, 'Stop the owned replica before killing the primary');
      const startedAt = new Date().toISOString();
      await docker(['kill', '--signal', 'KILL', original.postgres.Id], options);
      const after = await sameContainers(options, false); assert.equal(after.postgres.State.Running, false); assert.equal(after.postgres.State.ExitCode, 137);
      return { id: original.postgres.Id, signal: 'SIGKILL', running: false, exitCode: 137,
        processStartedAt: current.postgres.State.StartedAt, volume: pgMount(after.postgres), startedAt, finishedAt: new Date().toISOString() };
    },
    async startPrimary(options = {}) {
      const current = await sameContainers(options);
      if (current.postgres.State.Running) assert.equal(current.postgres.State.StartedAt, expectedPrimaryStartedAt, 'Unexpected primary restart');
      if (!current.postgres.State.Running) await docker(['start', original.postgres.Id], options);
      let identity;
      await waitFor(async () => { try { identity = await readIdentity(options); return true; } catch { return false; } }, options);
      assert.equal(identity.systemIdentifier, expectedSystemIdentifier, 'Database cluster replaced');
      const after = await sameContainers(options); assert(after.postgres.State.Running);
      expectedPrimaryStartedAt = after.postgres.State.StartedAt;
      return { id: original.postgres.Id, volume: pgMount(after.postgres), database: identity,
        restarted: identity.postmasterStartedAt !== initialIdentity.postmasterStartedAt };
    },
    async readRecoveryLogs({ since, ...options } = {}) {
      assert(Number.isFinite(Date.parse(since)), 'A concrete pre-kill timestamp is required');
      await sameContainers(options);
      const text = await docker(['logs', '--since', since, original.postgres.Id], { ...options, includeStderr: true });
      return { containerId: original.postgres.Id, since, text,
        sha256: crypto.createHash('sha256').update(text).digest('hex') };
    },
    async restoreReplica(options = {}) {
      const current = await sameContainers(options);
      if (!stoppedByUs) { assert.equal(current['postgres-replica'].State.Running, original['postgres-replica'].State.Running);
        return { restored: false, originallyRunning: original['postgres-replica'].State.Running }; }
      assert(current.postgres.State.Running, 'Restore original primary before replica');
      if (!current['postgres-replica'].State.Running) await docker(['start', original['postgres-replica'].Id], options);
      const client = await connect('r2_control_catchup', options); let targetLsn, state;
      try {
        targetLsn = (await client.query('SELECT pg_current_wal_flush_lsn()::text AS lsn')).rows[0]?.lsn;
        assert.match(targetLsn || '', /^[A-Fa-f0-9]+\/[A-Fa-f0-9]+$/);
        await waitFor(async () => { try { state = await replicaState(options); const result = await client.query('SELECT $1::pg_lsn >= $2::pg_lsn AS caught_up', [state.replayLsn, targetLsn]); return result.rows[0]?.caught_up === true; } catch { return false; } }, options);
      } finally { clients.delete(client); await client.end(); }
      await sameContainers(options); stoppedByUs = false;
      return { restored: true, id: original['postgres-replica'].Id, recovery: true, streaming: true, targetLsn, replayLsn: state.replayLsn };
    },
    async inspectAfter(options = {}) {
      const current = await sameContainers(options), identity = await readIdentity(options);
      assert.equal(identity.systemIdentifier, expectedSystemIdentifier, 'Database cluster replaced');
      assert.equal(current.postgres.State.StartedAt, expectedPrimaryStartedAt, 'Unobserved primary restart');
      assert.equal(current['postgres-replica'].State.Running, original['postgres-replica'].State.Running, 'Replica state was not restored');
      return { containers: services.map(service => publicContainer(current[service])), database: identity,
        ...(current['postgres-replica'].State.Running ? { replica: await replicaState(options) } : {}), connectionErrors: [...connectionErrors], credentialsIncluded: false };
    },
    async close(options = {}) {
      closed = true; const pending = [...clients]; clients.clear();
      // Do not inherit the aborted business signal: cleanup gets its own
      // bounded 5s budget and may additionally accept the caller's cleanup one.
      const active = AbortSignal.any([AbortSignal.timeout(5000), ...(options.signal ? [options.signal] : [])]);
      const outcomes = await Promise.allSettled(pending.map(async client => {
        let onAbort;
        try { await Promise.race([Promise.resolve().then(() => client.end()), new Promise((_, reject) => {
          onAbort = () => reject(new Error('Owned PostgreSQL connection close deadline exceeded'));
          if (active.aborted) onAbort(); else active.addEventListener('abort', onAbort, { once: true });
        })]); } finally { if (onAbort) active.removeEventListener('abort', onAbort); }
      }));
      assert(outcomes.every(outcome => outcome.status === 'fulfilled'), 'Owned PostgreSQL connection cleanup did not complete');
    },
  };
}

module.exports = { createOwnedPostgresControl };
