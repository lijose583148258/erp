const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');

const root = process.cwd();
const runtimeRoot = path.resolve(process.env.AILAODA_HA_RUNTIME_ROOT || 'C:\\AilaoDaPostgresRehearsal');
const reportPath = path.join(root, 'output/audit/object-storage-failover-audit-v1.json');
const pidPath = path.join(runtimeRoot, 'run/minio-primary.pid');
const exe = path.join(runtimeRoot, 'external/minio.exe');
const secret = fs.readFileSync(path.join(runtimeRoot, '.minio-secret.txt'), 'utf8').trim();
const appUrl = 'http://127.0.0.1:5006';
const account = { username: 'minio_failover_audit', password: 'MinioFailoverAudit12345!', role: 'admin' };
const report = { name: 'Object Storage Application Failover Audit', version: '1.1', status: 'failed', startedAt: new Date().toISOString(), checks: [] };
let primaryStopped = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const check = (name, passed, details = {}) => {
  report.checks.push({ name, status: passed ? 'passed' : 'failed', ...details });
  if (!passed) throw new Error(`Check failed: ${name}`);
};
async function waitFor(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (response.ok) return true; } catch {}
    await sleep(300);
  }
  return false;
}
function stopPrimary() {
  const pid = Number(fs.readFileSync(pidPath, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid MinIO primary PID file.');
  process.kill(pid, 'SIGTERM');
  primaryStopped = true;
  return pid;
}
function startPrimary() {
  if (!primaryStopped) return;
  const out = fs.openSync(path.join(runtimeRoot, 'minio-sandbox.stdout.log'), 'a');
  const err = fs.openSync(path.join(runtimeRoot, 'minio-sandbox.stderr.log'), 'a');
  const child = spawn(exe, ['server', path.join(runtimeRoot, 'minio-data'), '--address', '127.0.0.1:9000', '--console-address', '127.0.0.1:9001'], {
    cwd: runtimeRoot,
    env: { ...process.env, MINIO_ROOT_USER: 'ailaoda', MINIO_ROOT_PASSWORD: secret },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, err],
  });
  child.unref();
  fs.writeFileSync(pidPath, String(child.pid), 'ascii');
  primaryStopped = false;
}
async function api(pathname, options = {}, token = '') {
  const response = await fetch(`${appUrl}${pathname}`, { ...options, headers: { ...(options.headers || {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(5000) });
  return response;
}

async function main() {
  await ensureUiAuditUser(account);
  const login = await api('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: account.username, password: account.password }) });
  const loginBody = await login.json();
  const token = loginBody?.data?.token;
  check('audit-login', login.ok && Boolean(token));
  const marker = crypto.randomBytes(96);
  const runId = Date.now();
  const customerResponse = await api('/api/v1/customers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `MINIO-FAILOVER-${runId}`, nameZh: `MINIO-FAILOVER-${runId}`, licenseNumber: `MINIO-${runId}`, status: 'active', poolState: 'public', segment: 'direct' }) }, token);
  const customer = await customerResponse.json();
  check('audit-customer-created', customerResponse.ok && Boolean(customer?.data?.id));
  const contractResponse = await api('/api/v1/contracts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customerId: customer.data.id, title: `MinIO failover ${runId}`, totalAmount: 0, currency: 'CNY', fileUrl: `data:image/png;base64,${marker.toString('base64')}` }) }, token);
  const contract = await contractResponse.json();
  const fileUrl = contract?.data?.fileUrl;
  check('dual-write-contract-created', contractResponse.status === 201 && /^\/uploads\/contracts\//.test(String(fileUrl)));
  const baselineResponse = await api(fileUrl, {}, token);
  const baseline = Buffer.from(await baselineResponse.arrayBuffer());
  check('protected-primary-download', baselineResponse.ok && baseline.equals(marker));

  const stoppedPid = stopPrimary();
  check('primary-stopped', !(await waitFor('http://127.0.0.1:9000/minio/health/live', 2500)), { pid: stoppedPid });
  const started = Date.now();
  const failoverResponse = await api(fileUrl, {}, token);
  const failover = Buffer.from(await failoverResponse.arrayBuffer());
  report.failoverMs = Date.now() - started;
  check('protected-secondary-failover-download', failoverResponse.ok, { durationMs: report.failoverMs });
  check('sha256-byte-integrity', failover.equals(baseline), { sha256: crypto.createHash('sha256').update(failover).digest('hex') });
  report.sha256 = crypto.createHash('sha256').update(failover).digest('hex');
  report.status = 'passed';
}

main().catch(error => { report.error = String(error.message || error); process.exitCode = 1; }).finally(async () => {
  startPrimary();
  const restored = await waitFor('http://127.0.0.1:9000/minio/health/live');
  report.checks.push({ name: 'primary-restored', status: restored ? 'passed' : 'failed' });
  if (!restored) { report.status = 'failed'; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Object Storage Application Failover Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
