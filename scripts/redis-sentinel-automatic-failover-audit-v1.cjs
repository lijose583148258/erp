const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Redis = require('../backend/node_modules/ioredis');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');

const root = process.cwd();
const runtimeRoot = path.resolve(process.env.AILAODA_HA_RUNTIME_ROOT || 'C:\\AilaoDaPostgresRehearsal');
const reportPath = path.join(root, 'output/audit/redis-sentinel-failover-audit-v1.json');
const exe = 'C:\\Program Files\\Memurai\\memurai.exe';
const password = fs.readFileSync(path.join(runtimeRoot, '.redis-password.txt'), 'utf8').trim();
const account = { username: 'redis_sentinel_audit', password: 'RedisSentinelAudit12345!', role: 'admin' };
const sentinelPorts = [26379, 26380, 26381];
const quietClient = options => { const client = new Redis(options); client.on('error', () => {}); return client; };
const sentinels = sentinelPorts.map(port => quietClient({ host: '127.0.0.1', port, lazyConnect: true, connectTimeout: 1500, commandTimeout: 1500, maxRetriesPerRequest: 1 }));
const report = { name: 'Redis Sentinel Automatic Failover Audit', version: '1.1', status: 'failed', startedAt: new Date().toISOString(), checks: [] };
let primary6380Stopped = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, passed, details = {}) => { report.checks.push({ name, status: passed ? 'passed' : 'failed', ...details }); if (!passed) throw new Error(`Check failed: ${name}`); };
const redisOptions = port => ({ host: '127.0.0.1', port, password, lazyConnect: true, connectTimeout: 1500, commandTimeout: 1500, maxRetriesPerRequest: 1 });
async function masterPort() { const value = await sentinels[0].call('SENTINEL', 'get-master-addr-by-name', 'ailaoda-primary'); return Number(Array.isArray(value) ? value[1] : 0); }
async function waitFor(predicate, timeoutMs = 45_000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { try { if (await predicate()) return true; } catch {} await sleep(300); } return false; }
async function waitPortDown(port, timeoutMs = 5000) { return waitFor(async () => { const client = quietClient(redisOptions(port)); try { await client.connect(); await client.ping(); return false; } catch { return true; } finally { client.disconnect(); } }, timeoutMs); }
function stop6380() { const pidPath = path.join(runtimeRoot, 'run/memurai-sandbox.pid'); const pid = Number(fs.readFileSync(pidPath, 'utf8').trim()); if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid Redis 6380 PID file.'); process.kill(pid, 'SIGTERM'); primary6380Stopped = true; return pid; }
function start6380AsReplica(master = 6381) {
  if (!primary6380Stopped) return;
  const out = fs.openSync(path.join(runtimeRoot, 'memurai-sandbox.stdout.log'), 'a');
  const err = fs.openSync(path.join(runtimeRoot, 'memurai-sandbox.stderr.log'), 'a');
  const args = ['--bind', '127.0.0.1', '--port', '6380', '--requirepass', password, '--masterauth', password, '--replicaof', '127.0.0.1', String(master), '--appendonly', 'yes', '--dir', path.join(runtimeRoot, 'redis-data')];
  const child = spawn(exe, args, { cwd: runtimeRoot, detached: true, windowsHide: true, stdio: ['ignore', out, err] });
  child.unref();
  fs.writeFileSync(path.join(runtimeRoot, 'run/memurai-sandbox.pid'), String(child.pid), 'ascii');
  primary6380Stopped = false;
}
async function replicationInfo(port) { const client = quietClient(redisOptions(port)); try { await client.connect(); const text = await client.info('replication'); return Object.fromEntries(text.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => { const index = line.indexOf(':'); return [line.slice(0, index), line.slice(index + 1)]; })); } finally { client.disconnect(); } }
async function appReady() { const results = await Promise.all([5006, 5008].map(async port => { const response = await fetch(`http://127.0.0.1:${port}/api/v1/ready`, { signal: AbortSignal.timeout(3000) }); const body = await response.json(); return response.ok && body.status === 'ready' && body.redis?.ready === true; })); return results.every(Boolean); }
async function tokenAccepted(token) { const results = await Promise.all([5006, 5008].map(async port => { const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/me`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) }); return response.status === 200; })); return results.every(Boolean); }
async function normalizeTo6380() {
  let currentMaster = await masterPort();
  if (primary6380Stopped) start6380AsReplica(currentMaster || 6381);
  if (currentMaster !== 6380) {
    const joined = await waitFor(async () => { const info = await replicationInfo(6380); return ['slave', 'replica'].includes(info.role) && info.master_link_status === 'up'; }, 30_000);
    if (!joined) throw new Error('Redis 6380 did not join current master before failback.');
    await sentinels[0].call('SENTINEL', 'failover', 'ailaoda-primary');
    if (!(await waitFor(async () => await masterPort() === 6380, 45_000))) throw new Error('Sentinel did not fail back to Redis 6380.');
  }
  return waitFor(async () => { const info = await replicationInfo(6381); return ['slave', 'replica'].includes(info.role) && info.master_link_status === 'up'; }, 30_000);
}

async function main() {
  await Promise.all(sentinels.map(client => client.connect()));
  const quorum = await Promise.all(sentinels.map(client => client.call('SENTINEL', 'ckquorum', 'ailaoda-primary')));
  check('sentinel-quorum', quorum.every(value => String(value).startsWith('OK')), { sentinels: quorum.length });
  check('initial-master-6380', await masterPort() === 6380);
  await ensureUiAuditUser(account);
  const login = await fetch('http://127.0.0.1:5006/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: account.username, password: account.password }), signal: AbortSignal.timeout(5000) });
  const body = await login.json();
  const token = body?.data?.token;
  check('pre-failover-token', login.ok && Boolean(token) && await tokenAccepted(token));
  const stoppedPid = stop6380();
  check('old-master-stopped', await waitPortDown(6380), { pid: stoppedPid });
  const started = Date.now();
  const promoted = await waitFor(async () => await masterPort() === 6381, 45_000);
  report.failoverMs = Date.now() - started;
  check('sentinel-automatic-promotion', promoted, { newMasterPort: await masterPort(), durationMs: report.failoverMs });
  check('applications-recovered', await waitFor(appReady, 30_000));
  check('pre-failover-jwt-survived', await tokenAccepted(token));
  start6380AsReplica(6381);
  check('old-master-rejoined-as-replica', await waitFor(async () => { const info = await replicationInfo(6380); return ['slave', 'replica'].includes(info.role) && info.master_link_status === 'up'; }, 30_000));
  check('controlled-sentinel-failback', await normalizeTo6380());
  check('applications-ready-after-failback', await waitFor(appReady, 30_000));
  report.status = 'passed';
}

main().catch(error => { report.error = String(error.message || error); process.exitCode = 1; }).finally(async () => {
  try { const normalized = await normalizeTo6380(); report.checks.push({ name: 'final-topology-normalized', status: normalized ? 'passed' : 'failed' }); if (!normalized) { report.status = 'failed'; process.exitCode = 1; } } catch (error) { report.checks.push({ name: 'final-topology-normalized', status: 'failed', error: String(error.message || error) }); report.status = 'failed'; process.exitCode = 1; }
  await Promise.allSettled(sentinels.map(client => client.quit()));
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Redis Sentinel Automatic Failover Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
  setImmediate(() => process.exit(process.exitCode || 0));
});
