const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');

const reportPath = path.join(process.cwd(), 'output/audit/cloud-postgres-promotion-audit-v1.json');
const instances = ['http://127.0.0.1:5006', 'http://127.0.0.1:5008'];
const runId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const account = { username: 'cloud_postgres_failover', password: 'CloudPostgresFailover12345!', role: 'admin' };
const customerName = `PG-FAILOVER-${runId}`;
const report = { name: 'Cloud PostgreSQL Streaming Promotion Audit', version: '1.0', status: 'failed', startedAt: new Date().toISOString(), checks: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, passed, details = {}) => {
  report.checks.push({ name, status: passed ? 'passed' : 'failed', ...details });
  if (!passed) throw new Error(`Check failed: ${name}`);
};
const compose = (...args) => execFileSync('docker', ['compose', ...args], { encoding: 'utf8' }).trim();
const waitFor = async (probe, timeoutMs = 45_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await probe()) return true; } catch {}
    await sleep(500);
  }
  return false;
};
const sql = (service, query) => compose('exec', '-T', service, 'psql', '-U', 'ailaoda', '-d', 'ailaoda', '-tAc', query);
const appsReady = async () => {
  const results = await Promise.all(instances.map(async instance => {
    const response = await fetch(`${instance}/api/v1/ready`, { signal: AbortSignal.timeout(3000) });
    const body = await response.json();
    return response.ok && body.status === 'ready' && body.database === 'ok';
  }));
  return results.every(Boolean);
};
const tokenAccepted = async token => {
  const results = await Promise.all(instances.map(async instance => {
    const response = await fetch(`${instance}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    return response.status === 200;
  }));
  return results.every(Boolean);
};

async function main() {
  await ensureUiAuditUser(account);
  const login = await fetch(`${instances[0]}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(account),
    signal: AbortSignal.timeout(5000),
  });
  const loginBody = await login.json();
  const token = loginBody?.data?.token;
  check('baseline-login', login.ok && Boolean(token));
  check('baseline-app-readiness', await appsReady());
  check('replica-streaming', sql('postgres-replica', 'select pg_is_in_recovery()') === 't');
  const primaryLsn = sql('postgres', 'select pg_current_wal_lsn()');
  const replayLsn = sql('postgres-replica', 'select pg_last_wal_replay_lsn()');
  check('replication-lsn-visible', Boolean(primaryLsn) && Boolean(replayLsn), { primaryLsn, replayLsn });

  compose('stop', 'postgres');
  compose('exec', '-T', '--user', 'postgres', 'postgres-replica', 'pg_ctl', '-D', '/var/lib/postgresql/data', 'promote');
  check('replica-promoted', await waitFor(() => sql('postgres-replica', 'select pg_is_in_recovery()') === 'f', 30_000));
  check('apps-reconnected-through-router', await waitFor(appsReady, 45_000));
  check('shared-session-survives-db-promotion', await tokenAccepted(token));

  const create = await fetch(`${instances[0]}/api/v1/customers`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      nameZh: customerName,
      nameEn: `${customerName} Customer`,
      nameVi: `${customerName} Customer`,
      licenseNumber: `LIC-${runId}`,
      creditLimit: 10000,
      riskLevel: 'low',
      segment: 'direct',
      contactName: 'Postgres failover audit',
      contactPhone: '0900000000',
      contactEmail: `pg-${runId}@example.com`,
      address: 'Cloud PostgreSQL failover audit',
      status: 'active',
    }),
    signal: AbortSignal.timeout(8000),
  });
  const createdBody = await create.json();
  const customerId = createdBody?.data?.id;
  check('write-succeeds-after-promotion', create.status === 201 && Boolean(customerId), { status: create.status, customerId });

  const read = await fetch(`${instances[1]}/api/v1/customers/${customerId}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  const readBody = await read.json();
  const readCustomer = readBody?.data;
  check('cross-instance-read-after-promotion', read.ok && String(readCustomer?.id) === String(customerId), {
    status: read.status,
    customerId: readCustomer?.id || null,
  });

  compose(
    'run', '--rm', '--no-deps', '--entrypoint', '/bin/bash', 'postgres', '-ec',
    'find /var/lib/postgresql/data -mindepth 1 -delete; chown -R postgres:postgres /var/lib/postgresql/data; gosu postgres env PGPASSWORD="$POSTGRES_REPLICATION_PASSWORD" pg_basebackup -h postgres-replica -U ailaoda_replica -D /var/lib/postgresql/data -Fp -Xs -P -R; chmod 700 /var/lib/postgresql/data',
  );
  const standbyPrepared = compose(
    'run', '--rm', '--no-deps', '--entrypoint', '/bin/bash', 'postgres', '-ec',
    'test -f /var/lib/postgresql/data/standby.signal && grep -q "host=postgres-replica" /var/lib/postgresql/data/postgresql.auto.conf && echo ready',
  );
  check('old-primary-rebuilt-as-stopped-standby', standbyPrepared === 'ready');
  report.originalPrimaryState = 'rebuilt-as-stopped-standby';
  report.status = 'passed';
}

main().catch(error => {
  report.error = String(error?.message || error);
  console.error(`Cloud PostgreSQL promotion failure: ${report.error}`);
  process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  report.originalPrimaryState ||= 'left-stopped-to-prevent-split-brain';
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Cloud PostgreSQL Streaming Promotion Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
