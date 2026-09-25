const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const sandbox = path.join(root, 'output', 'round2', `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
fs.mkdirSync(sandbox, { recursive: true });
const db = path.join(sandbox, 'runtime.db');
const reportPath = path.join(sandbox, 'enterprise-round2-v1.json');
const children = new Set();
const env = { ...process.env,
  NODE_ENV: 'production', AILAODA_DEPLOYMENT_MODE: 'local', DATABASE_URL: `file:${db.replace(/\\/g, '/')}`,
  AILAODA_RUNTIME_DB_PATH: db, JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  LOG_DIR: path.join(sandbox, 'logs'), BACKUP_DIR: path.join(sandbox, 'backups'), UPLOAD_DIR: path.join(sandbox, 'uploads'),
  SERVE_FRONTEND: 'false', CACHE_DRIVER: 'memory', SEARCH_DRIVER: 'prisma',
  SEARCH_ENDPOINT: '', SEARCH_ENDPOINTS: '', MEILISEARCH_URL: '', REDIS_URL: '',
  AUDIT_PRISMA_PROVIDER: 'sqlite', ROUND2_ALLOW_MUTATIONS: 'true', ROUND2_REPORT_PATH: reportPath,
};
try {
  env.ROUND2_COMMIT = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim();
  env.ROUND2_DIRTY = String(Boolean(execFileSync('git', ['status', '--porcelain', '--', 'backend/src', 'scripts', 'package.json'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim()));
} catch { env.ROUND2_COMMIT = 'unknown'; env.ROUND2_DIRTY = 'unknown'; }
function fingerprint(folder, hash) {
  for (const item of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(folder, item.name);
    if (item.isDirectory()) fingerprint(file, hash);
    else if (item.isFile()) hash.update(path.relative(root, file).replace(/\\/g, '/')).update('\0').update(fs.readFileSync(file));
  }
}
const sourceHash = crypto.createHash('sha256');
fingerprint(path.join(root, 'backend', 'src'), sourceHash);
fingerprint(path.join(root, 'scripts'), sourceHash);
env.ROUND2_SOURCE_HASH = sourceHash.digest('hex');

function start(label, args, cwd = root, extraEnv = {}) {
  const log = fs.openSync(path.join(sandbox, `${label}.log`), 'wx');
  let child;
  try { child = spawn(process.execPath, args, { cwd, env: { ...env, ...extraEnv }, windowsHide: true, stdio: ['ignore', log, log] }); }
  finally { fs.closeSync(log); }
  children.add(child);
  child.completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => { children.delete(child); resolve({ code, signal }); });
  });
  // Observe startup errors immediately, including for long-lived servers.
  child.completion.catch(() => {});
  return child;
}
async function command(label, args, cwd, timeoutMs = 120_000) {
  const child = start(label, args, cwd);
  const timer = setTimeout(() => child.kill(), timeoutMs);
  try {
    const result = await child.completion;
    if (result.code !== 0) throw new Error(`${label} failed (${result.code ?? result.signal}); see ${path.join(sandbox, `${label}.log`)}`);
  } finally { clearTimeout(timer); }
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function ready(child, url) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) throw new Error(`Server exited before readiness: ${url}`);
    try { const response = await fetch(`${url}/ready`, { signal: AbortSignal.timeout(2000) }); if (response.ok) return; } catch {}
    await delay(300);
  }
  throw new Error(`Readiness timeout: ${url}`);
}
async function stop() {
  const owned = [...children];
  for (const child of owned) child.kill();
  await Promise.race([Promise.allSettled(owned.map(child => child.completion)), delay(5000)]);
}
async function main() {
  console.log(`Isolated Round2 evidence: ${sandbox}`);
  await command('build', [path.join(root, 'backend/node_modules/typescript/bin/tsc')], path.join(root, 'backend'));
  env.ROUND2_BUILT_AT = new Date().toISOString();
  await command('prepare', [path.join(root, 'backend/dist/database/manage-db.cli.js'), 'prepare'], root);
  const ports = [await freePort()];
  do { ports[1] = await freePort(); } while (ports[1] === ports[0]);
  const urls = ports.map(port => `http://127.0.0.1:${port}`);
  const servers = ports.map((port, index) => start(`app-${index + 1}`, [path.join(root, 'backend/dist/server.js')], root, { PORT: String(port) }));
  await Promise.all(servers.map((child, index) => ready(child, urls[index])));
  const audit = start('audit', [path.join(root, 'scripts/enterprise-round2-audit-v1.cjs')], root,
    { APP_URL: urls[0], SECONDARY_APP_URL: urls[1] });
  const timer = setTimeout(() => audit.kill(), 5 * 60_000);
  try {
    const result = await audit.completion;
    process.exitCode = result.code ?? 1;
    if (!fs.existsSync(reportPath)) throw new Error('Audit terminated without a report');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    console.log(JSON.stringify({ status: report.status, passed: report.summary.passedChecks, failed: report.summary.failedChecks, remaining: report.summary.remainingChecks, reportPath }));
    // A terminated child or unfinished report never becomes green.
    if (!report.finishedAt || report.status !== 'passed') process.exitCode ||= 2;
  } finally { clearTimeout(timer); }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop().finally(() => process.exit(1)); });
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(stop);
