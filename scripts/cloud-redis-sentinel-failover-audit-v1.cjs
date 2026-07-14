const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');

const reportPath = path.join(process.cwd(), 'output/audit/cloud-redis-sentinel-failover-audit-v1.json');
const instances = ['http://127.0.0.1:5006', 'http://127.0.0.1:5008'];
const account = { username: 'cloud_redis_failover', password: 'CloudRedisFailover12345!', role: 'admin' };
const report = { name: 'Cloud Redis Sentinel Failover Audit', version: '1.0', status: 'failed', startedAt: new Date().toISOString(), checks: [] };
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
const sentinelMaster = () => {
  const output = compose('exec', '-T', 'sentinel-1', 'redis-cli', '-p', '26379', '--raw', 'SENTINEL', 'get-master-addr-by-name', 'ailaoda-primary');
  const [host, port] = output.split(/\r?\n/).filter(Boolean);
  return { host, port: Number(port) };
};
const redisRole = service => {
  const info = compose('exec', '-T', service, 'redis-cli', 'INFO', 'replication');
  return /role:master/.test(info) ? 'master' : (/role:(slave|replica)/.test(info) ? 'replica' : 'unknown');
};
const sentinelDiagnostics = () => Object.fromEntries(['sentinel-1', 'sentinel-2', 'sentinel-3'].map(service => {
  const master = compose('exec', '-T', service, 'redis-cli', '-p', '26379', '--raw', 'SENTINEL', 'master', 'ailaoda-primary');
  const peers = compose('exec', '-T', service, 'redis-cli', '-p', '26379', '--raw', 'SENTINEL', 'sentinels', 'ailaoda-primary');
  const replicas = compose('exec', '-T', service, 'redis-cli', '-p', '26379', '--raw', 'SENTINEL', 'replicas', 'ailaoda-primary');
  return [service, { master, peers, replicas }];
}));
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
const appsReady = async () => {
  const results = await Promise.all(instances.map(async instance => {
    const response = await fetch(`${instance}/api/v1/ready`, { signal: AbortSignal.timeout(3000) });
    const body = await response.json();
    return response.ok && body.status === 'ready' && body.redis?.ready === true;
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
  check('baseline-shared-token', await tokenAccepted(token));
  check('baseline-master', redisRole('redis-primary') === 'master' && redisRole('redis-replica') === 'replica', {
    sentinel: sentinelMaster(),
    primaryRole: redisRole('redis-primary'),
    replicaRole: redisRole('redis-replica'),
  });

  compose('stop', 'redis-primary');
  const promoted = await waitFor(() => redisRole('redis-replica') === 'master');
  check('replica-promoted', promoted, { sentinel: sentinelMaster(), replicaRole: redisRole('redis-replica') });
  check('apps-ready-after-promotion', await waitFor(appsReady, 30_000));
  check('shared-token-survives-promotion', await tokenAccepted(token));

  compose('start', 'redis-primary');
  const oldPrimaryRejoined = await waitFor(() => {
    const info = compose('exec', '-T', 'redis-primary', 'redis-cli', 'INFO', 'replication');
    return /role:(slave|replica)/.test(info) && /master_link_status:up/.test(info);
  });
  check('old-primary-rejoined-as-replica', oldPrimaryRejoined);
  check('apps-ready-after-rejoin', await waitFor(appsReady, 30_000));
  check('shared-token-survives-recovery', await tokenAccepted(token));
  report.status = 'passed';
}

main().catch(error => {
  report.error = String(error?.message || error);
  let diagnostics = {};
  try { diagnostics = { sentinel: sentinelMaster(), replicaRole: redisRole('redis-replica'), sentinels: sentinelDiagnostics() }; } catch {}
  report.diagnostics = diagnostics;
  console.error(`Cloud Redis failover failure: ${report.error} ${JSON.stringify(diagnostics)}`);
  process.exitCode = 1;
}).finally(async () => {
  try { compose('start', 'redis-primary'); } catch {}
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Cloud Redis Sentinel Failover Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
