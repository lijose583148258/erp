const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const cumulative = process.argv.includes('--cumulative');
if (cumulative || process.argv.includes('--sales-plan') || process.argv.includes('--payment-event')) process.env.ROUND2_BROWSER = 'true';
const sandbox = path.join(root, 'output', 'round2', `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
fs.mkdirSync(sandbox, { recursive: true });
const db = path.join(sandbox, 'runtime.db');
const reportPath = path.join(sandbox, 'enterprise-round2-v1.json');
const children = new Set();
let paymentReceiver, appControl;
const appProcesses = [];
const env = { ...process.env,
  NODE_ENV: 'production', AILAODA_DEPLOYMENT_MODE: 'local', DATABASE_URL: `file:${db.replace(/\\/g, '/')}`,
  AILAODA_RUNTIME_DB_PATH: db, JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  LOG_DIR: path.join(sandbox, 'logs'), BACKUP_DIR: path.join(sandbox, 'backups'), UPLOAD_DIR: path.join(sandbox, 'uploads'),
  SERVE_FRONTEND: process.env.ROUND2_BROWSER === 'true' ? 'true' : 'false', CACHE_DRIVER: 'memory', SEARCH_DRIVER: 'prisma',
  FRONTEND_DIST_DIR: path.join(sandbox, 'frontend'),
  SEARCH_ENDPOINT: '', SEARCH_ENDPOINTS: '', MEILISEARCH_URL: '', REDIS_URL: '',
  AUDIT_PRISMA_PROVIDER: 'sqlite', ROUND2_ALLOW_MUTATIONS: 'true', ROUND2_REPORT_PATH: reportPath,
  ROUND2_ONLY_CHECK: !cumulative && process.argv.includes('--payment-event') ? 'payment-event-audit-once' : '',
};
try {
  env.ROUND2_COMMIT = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim();
  env.ROUND2_DIRTY = String(Boolean(execFileSync('git', ['status', '--porcelain', '--', 'backend/src', 'backend/prisma', 'scripts', 'pages', 'services', 'src', 'utils', 'i18n', 'types.ts', 'app', 'components', 'package.json'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim()));
} catch { env.ROUND2_COMMIT = 'unknown'; env.ROUND2_DIRTY = 'unknown'; }
function fingerprint(folder, hash) {
  for (const item of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(folder, item.name);
    if (item.isDirectory()) fingerprint(file, hash);
    else if (item.isFile()) hash.update(path.relative(root, file).replace(/\\/g, '/')).update('\0').update(fs.readFileSync(file));
  }
}
const sourceHash = crypto.createHash('sha256');
for (const folder of ['backend/src', 'backend/prisma/models', 'scripts', 'pages', 'services', 'src', 'utils', 'i18n', 'app', 'components']) fingerprint(path.join(root, folder), sourceHash);
sourceHash.update('types.ts\0').update(fs.readFileSync(path.join(root, 'types.ts')));
env.ROUND2_SOURCE_HASH = sourceHash.digest('hex');
if (cumulative) {
  const { beginRegression } = require('./lib/enterprise-regression.cjs');
  env.REGRESSION_CONTEXT_PATH = path.join(sandbox, 'regression-context.json');
  fs.writeFileSync(env.REGRESSION_CONTEXT_PATH, JSON.stringify(beginRegression(root, 'local'), null, 2));
  env.REGRESSION_LEGACY_PATH = path.join(sandbox, 'legacy-upgrade.json');
}

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
  if (appControl) { appControl.closeAllConnections(); await new Promise(resolve => appControl.close(resolve)); appControl = undefined; }
  const owned = [...children];
  for (const child of owned) child.kill();
  await Promise.race([Promise.allSettled(owned.map(child => child.completion)), delay(5000)]);
  if (paymentReceiver) { await paymentReceiver.close(); paymentReceiver = undefined; }
}
async function main() {
  console.log(`Isolated Round2 evidence: ${sandbox}`);
  await command('build', [path.join(root, 'backend/node_modules/typescript/bin/tsc')], path.join(root, 'backend'));
  if (env.ROUND2_BROWSER === 'true') await command('build-frontend', [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--configLoader', 'native', '--outDir', env.FRONTEND_DIST_DIR], root, 180000);
  env.ROUND2_BUILT_AT = new Date().toISOString();
  await command('prepare', [path.join(root, 'backend/dist/database/manage-db.cli.js'), 'prepare'], root);
  const ports = [await freePort()];
  do { ports[1] = await freePort(); } while (ports[1] === ports[0]);
  const urls = ports.map(port => `http://127.0.0.1:${port}`);
  if (env.ROUND2_BROWSER === 'true') {
    const secret = crypto.randomBytes(32).toString('hex');
    paymentReceiver = await require('./fixtures/payment-event-receiver.cjs').createPaymentEventReceiver({ secret, folder: path.join(sandbox, 'payment-event-receiver') });
    env.AILAODA_WEBHOOK_SECRET = secret;
    env.AILAODA_WEBHOOK_ENDPOINTS = JSON.stringify([{ url: `http://127.0.0.1:${paymentReceiver.port}/events`, events: ['payment.verified'] }]);
    env.ROUND2_PAYMENT_RECEIVER_URL = `http://127.0.0.1:${paymentReceiver.port}`;
    env.ROUND2_PAYMENT_RECEIVER_TOKEN = secret;
    const controlToken = crypto.randomBytes(32).toString('hex'); let busy = false;
    appControl = http.createServer(async (req, res) => {
      if (req.headers.authorization !== `Bearer ${controlToken}` || req.method !== 'POST' || !['/kill', '/start'].includes(req.url)) { res.writeHead(403); res.end(); return; }
      if (busy) { res.writeHead(409); res.end(); return; }
      busy = true;
      try {
        let result;
        if (req.url === '/kill') {
          if (appProcesses.length !== 2 || appProcesses.some(child => child.exitCode !== null || child.signalCode)) throw new Error('Owned applications are not both running');
          const old = [...appProcesses]; for (const child of old) child.kill('SIGKILL');
          await Promise.race([Promise.all(old.map(child => child.completion)), delay(10000).then(() => { throw new Error('Hard-kill timeout'); })]);
          result = { killed: 2, signal: 'SIGKILL', exit: await Promise.all(old.map(child => child.completion)) };
        } else {
          if (appProcesses.some(child => child.exitCode === null && !child.signalCode)) throw new Error('Owned process still running');
          for (const [index, port] of ports.entries()) {
            appProcesses[index] = start(`app-recovery-${index + 1}`, [path.join(root, 'backend/dist/server.js')], root, { PORT: String(port) });
            await ready(appProcesses[index], urls[index]);
          }
          result = { restarted: 2 };
        }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
      } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }
      finally { busy = false; }
    });
    await new Promise(resolve => appControl.listen(0, '127.0.0.1', resolve));
    env.ROUND2_APP_CONTROL_URL = `http://127.0.0.1:${appControl.address().port}`;
    env.ROUND2_APP_CONTROL_TOKEN = controlToken;
  }
  // This harness tests business contention, not simultaneous SQLite WAL initialization.
  // Only the explicit payment-event probe kills/restarts these owned processes.
  // Database restart ambiguity remains a separate unmet obligation.
  for (const [index, port] of ports.entries()) {
    const server = start(`app-${index + 1}`, [path.join(root, 'backend/dist/server.js')], root, { PORT: String(port) });
    appProcesses[index] = server;
    await ready(server, urls[index]);
  }
  if (cumulative) {
    const salesPath = path.join(sandbox, 'sales-partial', 'report.json');
    const salesPlanPath = path.join(sandbox, 'sales-plan', 'report.json');
    const executions = [];
    for (const [label, script, target, args, allowed] of [
      ['round2', 'scripts/enterprise-round2-audit-v1.cjs', reportPath, [], [0, 2]],
      ['sales-partial', 'scripts/sales-partial-fulfillment-audit-v1.cjs', salesPath, [], [0]],
      ['sales-plan', 'scripts/sales-fulfillment-plan-audit-v1.cjs', salesPlanPath, [], [0]],
      ['legacy-cash', 'scripts/barter-cash-legacy-upgrade-audit.cjs', env.REGRESSION_LEGACY_PATH, ['--fixture'], [0]],
    ]) {
      // A failing prior package must not truncate independent later packages.
      const child = start(label, [path.join(root, script), ...args], root,
        { APP_URL: urls[0], SECONDARY_APP_URL: urls[1], ROUND2_REPORT_PATH: target });
      const timer = setTimeout(() => child.kill(), label === 'legacy-cash' ? 120000 : 300000);
      try { const result = await child.completion; executions.push({ label, ...result, acceptable: allowed.includes(result.code) }); }
      catch (error) { executions.push({ label, acceptable: false, error: error.message }); }
      finally { clearTimeout(timer); }
    }
    const { evaluateRegression, headCommit, sourceFingerprint } = require('./lib/enterprise-regression.cjs');
    const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
    const result = evaluateRegression({ baseline: require('./config/enterprise-regression-baseline-v1.json'),
      context: read(env.REGRESSION_CONTEXT_PATH), currentCommit: headCommit(root), currentSourceHash: sourceFingerprint(root),
      reports: { round2: read(reportPath), sales: read(salesPath), salesPlan: read(salesPlanPath), legacy: read(env.REGRESSION_LEGACY_PATH) },
      executionErrors: executions.filter(e => !e.acceptable) });
    result.executions = executions;
    const file = path.join(sandbox, 'cumulative-regression.json'); fs.writeFileSync(file, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ status: result.status, summary: result.summary, fullAcceptanceStatus: result.fullAcceptanceStatus, reportPath: file }));
    process.exitCode = result.status !== 'passed' ? 1 : result.fullAcceptanceStatus !== 'passed' ? 2 : 0;
    return;
  }
  const auditScript = process.argv.includes('--sales-plan') ? 'scripts/sales-fulfillment-plan-audit-v1.cjs' : process.argv.includes('--sales-partial') ? 'scripts/sales-partial-fulfillment-audit-v1.cjs' : 'scripts/enterprise-round2-audit-v1.cjs';
  const audit = start('audit', [path.join(root, auditScript)], root,
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
