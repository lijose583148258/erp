const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');

const root = process.cwd();
const runtimeRoot = path.resolve(process.env.AILAODA_HA_RUNTIME_ROOT || 'C:\\AilaoDaPostgresRehearsal');
const reportPath = path.resolve(process.env.SEARCH_FAILOVER_AUDIT_REPORT_PATH || path.join(root, 'output/audit/meilisearch-failover-audit-v1.json'));
const pidPath = path.join(runtimeRoot, 'run/meilisearch.pid');
const exe = path.join(runtimeRoot, 'external/meilisearch.exe');
const masterKey = fs.readFileSync(path.join(runtimeRoot, '.meilisearch-master-key.txt'), 'utf8').trim();
const appUrl = String(process.env.APP_URL || 'http://127.0.0.1:5006').replace(/\/$/, '');
const readPassword = () => {
  const passwordFile = String(process.env.MEILI_FAILOVER_AUDIT_PASSWORD_FILE || '').trim();
  if (passwordFile) return fs.readFileSync(path.resolve(passwordFile), 'utf8').trim();
  return String(process.env.MEILI_FAILOVER_AUDIT_PASSWORD || process.env.PILOT_AUDIT_ADMIN_PASSWORD || '').trim();
};
const account = {
  username: String(process.env.MEILI_FAILOVER_AUDIT_USERNAME || process.env.PILOT_AUDIT_ADMIN_USERNAME || '').trim(),
  password: readPassword(),
  role: 'admin',
};
const report = {
  name: 'Meilisearch Application Failover Audit',
  version: '2.0',
  status: 'failed',
  scope: 'controlled-single-host-sandbox',
  environment: String(process.env.ENTERPRISE_EVIDENCE_ENVIRONMENT || '').trim(),
  evidenceId: String(process.env.ENTERPRISE_EVIDENCE_ID || '').trim(),
  commitSha: String(process.env.ENTERPRISE_EVIDENCE_COMMIT_SHA || process.env.GITHUB_SHA || '').trim(),
  imageDigest: String(process.env.ENTERPRISE_EVIDENCE_IMAGE_DIGEST || '').trim(),
  failureDomains: String(process.env.SEARCH_FAILURE_DOMAINS || '').split(',').map(value => value.trim()).filter(Boolean),
  startedAt: new Date().toISOString(),
  checks: [],
};
let primaryStopped = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, passed, details = {}) => { report.checks.push({ name, status: passed ? 'passed' : 'failed', ...details }); if (!passed) throw new Error(`Check failed: ${name}`); };
async function waitFor(url, timeoutMs = 20_000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { try { const response = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (response.ok) return true; } catch {} await sleep(300); } return false; }
function stopPrimary() { const pid = Number(fs.readFileSync(pidPath, 'utf8').trim()); if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid Meilisearch primary PID file.'); process.kill(pid, 'SIGTERM'); primaryStopped = true; return pid; }
function startPrimary() {
  if (!primaryStopped) return;
  const out = fs.openSync(path.join(runtimeRoot, 'meilisearch-sandbox.stdout.log'), 'a');
  const err = fs.openSync(path.join(runtimeRoot, 'meilisearch-sandbox.stderr.log'), 'a');
  const child = spawn(exe, [], { cwd: runtimeRoot, env: { ...process.env, MEILI_HTTP_ADDR: '127.0.0.1:7700', MEILI_DB_PATH: path.join(runtimeRoot, 'meilisearch-data'), MEILI_MASTER_KEY: masterKey, MEILI_ENV: 'production', MEILI_NO_ANALYTICS: 'true' }, detached: true, windowsHide: true, stdio: ['ignore', out, err] });
  child.unref();
  fs.writeFileSync(pidPath, String(child.pid), 'ascii');
  primaryStopped = false;
}
async function search(token) {
  const response = await fetch(`${appUrl}/api/v1/orders?page=1&pageSize=25&search=SO`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
  const body = await response.json();
  const rows = Array.isArray(body?.data) ? body.data : body?.data?.items || [];
  return { response, rows };
}
async function main() {
  if (!account.username || !account.password) throw new Error('Meilisearch failover audit credentials are required through environment or password file.');
  await ensureUiAuditUser(account);
  const login = await fetch(`${appUrl}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: account.username, password: account.password }), signal: AbortSignal.timeout(5000) });
  const loginBody = await login.json();
  const token = loginBody?.data?.token;
  check('audit-login', login.ok && Boolean(token));
  const baseline = await search(token);
  check('known-order-primary-hit', baseline.response.ok && baseline.rows.length > 0, { rows: baseline.rows.length });
  const firstId = String(baseline.rows[0].id);
  const stoppedPid = stopPrimary();
  check('primary-stopped', !(await waitFor('http://127.0.0.1:7700/health', 2500)), { pid: stoppedPid });
  const started = Date.now();
  const failover = await search(token);
  report.failoverMs = Date.now() - started;
  check('known-order-secondary-hit', failover.response.ok && failover.rows.length > 0 && String(failover.rows[0].id) === firstId, { rows: failover.rows.length, sameId: String(failover.rows[0]?.id) === firstId, durationMs: report.failoverMs });
  report.status = 'passed';
}
main().catch(error => { report.error = String(error.message || error); process.exitCode = 1; }).finally(async () => {
  startPrimary();
  const restored = await waitFor('http://127.0.0.1:7700/health');
  report.checks.push({ name: 'primary-restored', status: restored ? 'passed' : 'failed' });
  if (!restored) { report.status = 'failed'; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Meilisearch Application Failover Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
