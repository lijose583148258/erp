const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { ROUND2_PARENT_RUNTIME_MS } = require('./lib/enterprise-round2-supervision.cjs');
const { killSpawnedProcessTree } = require('./lib/win32-audit-process-guard.cjs');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const cumulative = process.argv.includes('--cumulative');
const procurementBrowser = process.argv.includes('--procurement-browser');
if (procurementBrowser) process.env.ROUND2_BROWSER = 'true';
if (process.argv.includes('--customer-cancellation') || process.argv.includes('--unsaved-focus')) process.env.ROUND2_BROWSER = 'true';
if (cumulative || process.argv.includes('--inventory-browser') || process.argv.includes('--purchase-roles') || process.argv.includes('--purchase-quality') || process.argv.includes('--authorization-freshness') || process.argv.includes('--sales-plan') || process.argv.includes('--payment-event') || process.argv.includes('--payment-submit') || process.argv.includes('--payment-reversal-browser')) process.env.ROUND2_BROWSER = 'true';
const sandbox = path.join(root, 'output', 'round2', `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
fs.mkdirSync(sandbox, { recursive: true });
const db = path.join(sandbox, 'runtime.db');
const reportPath = procurementBrowser ? path.join(sandbox, 'procurement-browser', 'procurement-audit-report-v1.json') : path.join(sandbox, 'enterprise-round2-v1.json');
const children = new Set();
let paymentReceiver, appControl;
let appRestartGeneration = 0;
const appProcesses = [];
const env = { ...process.env,
  ROUND2_REVERSAL_BROWSER: String(process.argv.includes('--payment-reversal-browser')),
  NODE_ENV: 'production', AILAODA_DEPLOYMENT_MODE: 'local', DATABASE_URL: `file:${db.replace(/\\/g, '/')}`,
  AILAODA_RUNTIME_DB_PATH: db, JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  LOG_DIR: path.join(sandbox, 'logs'), BACKUP_DIR: path.join(sandbox, 'backups'), UPLOAD_DIR: path.join(sandbox, 'uploads'),
  SERVE_FRONTEND: process.env.ROUND2_BROWSER === 'true' ? 'true' : 'false', CACHE_DRIVER: 'memory', SEARCH_DRIVER: 'prisma',
  FRONTEND_DIST_DIR: path.join(sandbox, 'frontend'),
  SEARCH_ENDPOINT: '', SEARCH_ENDPOINTS: '', MEILISEARCH_URL: '', REDIS_URL: '',
  AUDIT_PRISMA_PROVIDER: 'sqlite', ROUND2_ALLOW_MUTATIONS: 'true', ROUND2_REPORT_PATH: reportPath,
  ROUND2_ONLY_CHECK: cumulative ? '' : process.argv.includes('--purchase-quality') ? 'purchase-partial-receipt-qc-payables' : process.argv.includes('--purchase-cost') ? 'po-stale-edit-conflict' : process.argv.includes('--inventory-browser') ? 'inventory-browser' : process.argv.includes('--purchase-roles') ? 'purchase-browser-readback' : process.argv.includes('--payment-submit') ? 'payment-submit-durable-replay' : process.argv.includes('--payment-event') ? 'payment-event-audit-once' : '',
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
  const timer = setTimeout(() => { void stopOwned(child); }, timeoutMs);
  try {
    const result = await child.completion;
    if (result.code !== 0) throw new Error(`${label} failed (${result.code ?? result.signal}); see ${path.join(sandbox, `${label}.log`)}`);
  } finally { clearTimeout(timer); }
}
async function stopOwned(child) {
  if (child.exitCode !== null || child.signalCode) return;
  // Windows termination does not deliver the wrapper's SIGTERM handler.
  // Reuse the existing guard for this owned PID and its audit/browser children.
  await killSpawnedProcessTree(child.pid);
  child.kill();
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
  await Promise.allSettled(owned.map(stopOwned));
  await Promise.race([Promise.allSettled(owned.map(child => child.completion)), delay(5000)]);
  if (paymentReceiver) { await paymentReceiver.close(); paymentReceiver = undefined; }
}
async function main() {
  console.log(`Isolated Round2 evidence: ${sandbox}`);
  env.PROCUREMENT_BROWSER_OUTPUT_DIR = path.join(sandbox, 'procurement-browser');
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
    env.AILAODA_WEBHOOK_ENDPOINTS = JSON.stringify([{ url: `http://127.0.0.1:${paymentReceiver.port}/events`, events: ['payment.verified','payment.reversed'] }]);
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
          appRestartGeneration++;
          for (const [index, port] of ports.entries()) {
            appProcesses[index] = start(`app-recovery-${appRestartGeneration}-${index + 1}`, [path.join(root, 'backend/dist/server.js')], root, { PORT: String(port) });
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
    // Standalone probe flags must not replace the original partial-sales chain.
    const shipmentFlags = { ROUND2_SHIPMENT_SUBMISSION: 'false', ROUND2_SHIPMENT_SUPPLEMENT: 'false', ROUND2_STOCK_RESERVATION: 'false', ROUND2_RESERVATION_UI: 'false' };
    Object.assign(env, shipmentFlags);
    const salesPath = path.join(sandbox, 'sales-partial', 'report.json');
    const salesPlanPath = path.join(sandbox, 'sales-plan', 'report.json');
    const cancellationPath = path.join(sandbox, 'customer-cancellation', 'report.json');
    env.ROUND2_SALES_PLAN_REPORT = salesPlanPath;
    env.ROUND2_CUSTOMER_CANCELLATION_REPORT = cancellationPath;
    const authorizationPath = path.join(sandbox, 'authorization-dual-node-v1.json');
    const executions = [];
    for (const [label, script, target, args, allowed, extraEnv = {}] of [
      ['sales-partial', 'scripts/sales-partial-fulfillment-audit-v1.cjs', salesPath, [], [0]],
      ['shipment-submission', 'scripts/sales-partial-fulfillment-audit-v1.cjs', path.join(sandbox, 'shipment-submission', 'report.json'), [], [0], { ROUND2_SHIPMENT_SUBMISSION: 'true' }],
      ['shipment-late-information', 'scripts/sales-partial-fulfillment-audit-v1.cjs', path.join(sandbox, 'shipment-late-information', 'report.json'), [], [0], { ROUND2_SHIPMENT_SUPPLEMENT: 'true' }],
      ['shipment-physical-reservation', 'scripts/sales-partial-fulfillment-audit-v1.cjs', path.join(sandbox, 'shipment-physical-reservation', 'report.json'), [], [0], { ROUND2_STOCK_RESERVATION: 'true' }],
      ['shipment-reservation-workspace', 'scripts/sales-partial-fulfillment-audit-v1.cjs', path.join(sandbox, 'shipment-reservation-workspace', 'report.json'), [], [0], { ROUND2_STOCK_RESERVATION: 'true', ROUND2_RESERVATION_UI: 'true' }],
      ['sales-plan', 'scripts/sales-fulfillment-plan-audit-v1.cjs', salesPlanPath, [], [0]],
      ['customer-cancellation', 'scripts/customer-quantity-cancellation-audit-v1.cjs', cancellationPath, [], [0]],
      ['unsaved-focus', 'scripts/unsaved-changes-browser-audit-v1.cjs', path.join(sandbox, 'unsaved-focus', 'report.json'), [], [0]],
      ['procurement-browser', 'scripts/procurement-browser-audit-v1.cjs', path.join(sandbox, 'procurement-browser', 'procurement-audit-report-v1.json'), [], [0]],
      ['round2', 'scripts/enterprise-round2-supervised.cjs', reportPath, [], [0, 2]],
      ['authorization', 'scripts/authorization-dual-node-audit-v1.cjs', authorizationPath, [], [0]],
      ['legacy-cash', 'scripts/barter-cash-legacy-upgrade-audit.cjs', env.REGRESSION_LEGACY_PATH, ['--fixture'], [0]],
    ]) {
      // A failing prior package must not truncate independent later packages.
      const child = start(label, [path.join(root, script), ...args], root,
        { APP_URL: urls[0], SECONDARY_APP_URL: urls[1], ROUND2_REPORT_PATH: target, ...extraEnv });
      const timer = setTimeout(() => { void stopOwned(child); }, label === 'legacy-cash' ? 120000 : label === 'round2' ? ROUND2_PARENT_RUNTIME_MS : 300000);
      try {
        const result = await child.completion;
        let shipmentEvidence;
        if (label.startsWith('shipment-') && result.code === 0) {
          const assert = require('node:assert/strict'), proof = JSON.parse(fs.readFileSync(target, 'utf8'));
          const context = JSON.parse(fs.readFileSync(env.REGRESSION_CONTEXT_PATH, 'utf8'));
          require('./lib/enterprise-regression.cjs').verifyFresh(proof, context, 'sqlite', Date.now());
          const versions = { 'shipment-submission': ['shipmentSubmission', 'shipment-submission-probe/v2'],
            'shipment-late-information': ['shipmentSupplement', 'shipment-supplement-probe/v2'],
            'shipment-physical-reservation': ['physicalReservation', 'physical-reservation-probe/v2'],
            'shipment-reservation-workspace': ['physicalReservation', 'reservation-workspace-probe/v2'] };
          const [field, version] = versions[label]; assert.equal(proof.status, 'passed'); assert.equal(proof[field]?.version, version);
          assert.deepEqual(proof.summary, { passedChecks: 1, failedChecks: 0, remainingChecks: 0 });
          shipmentEvidence = { report: target, version, sha256: crypto.createHash('sha256').update(JSON.stringify(proof)).digest('hex') };
        }
        if (label === 'unsaved-focus' && result.code === 0) {
          const assert = require('node:assert/strict');
          const proof = JSON.parse(fs.readFileSync(target, 'utf8'));
          const context = JSON.parse(fs.readFileSync(env.REGRESSION_CONTEXT_PATH, 'utf8'));
          require('./lib/enterprise-regression.cjs').verifyFresh(proof, context, 'sqlite', Date.now());
          assert.equal(proof.status, 'passed'); assert.equal(proof.dialogs.length, 16);
          assert.equal(proof.salesBeforeClose.notesPreserved, true);
          assert(proof.salesBeforeClose.dirtyState.dirtySourceIds.includes('sales-order-editor'));
          assert.equal(proof.salesFocusRace.remainingCallbacks, 0);
          assert(proof.salesFocusRace.events.some(e => e.event === 'after-real-dialog-focus' && e.active === 'sales-order-notes'));
        }
        executions.push({ label, ...result, acceptable: allowed.includes(result.code), ...(shipmentEvidence ? { evidence: shipmentEvidence } : {}) });
      }
      catch (error) { executions.push({ label, acceptable: false, error: error.message }); }
      finally { clearTimeout(timer); }
    }
    const { evaluateRegression, headCommit, sourceFingerprint } = require('./lib/enterprise-regression.cjs');
    const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
    const result = evaluateRegression({ baseline: require('./config/enterprise-regression-baseline-v1.json'),
      context: read(env.REGRESSION_CONTEXT_PATH), currentCommit: headCommit(root), currentSourceHash: sourceFingerprint(root),
      reports: { round2: read(reportPath), sales: read(salesPath), salesPlan: read(salesPlanPath), cancellation: read(cancellationPath), authorization: read(authorizationPath), legacy: read(env.REGRESSION_LEGACY_PATH) },
      executionErrors: executions.filter(e => !e.acceptable) });
    result.executions = executions;
    const file = path.join(sandbox, 'cumulative-regression.json'); fs.writeFileSync(file, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ status: result.status, summary: result.summary, fullAcceptanceStatus: result.fullAcceptanceStatus, reportPath: file }));
    process.exitCode = result.status !== 'passed' ? 1 : result.fullAcceptanceStatus !== 'passed' ? 2 : 0;
    return;
  }
  const reconciliation = process.argv.includes('--payment-reconciliation') || process.argv.includes('--payment-reversal-api') || process.argv.includes('--payment-reversal-browser');
  const authorization = process.argv.includes('--authorization-freshness');
  const unsavedFocus = process.argv.includes('--unsaved-focus');
  const auditScript = procurementBrowser ? 'scripts/procurement-browser-audit-v1.cjs' : unsavedFocus ? 'scripts/unsaved-changes-browser-audit-v1.cjs' : process.argv.includes('--customer-cancellation') ? 'scripts/customer-quantity-cancellation-audit-v1.cjs' : authorization ? 'scripts/authorization-dual-node-audit-v1.cjs' : process.argv.includes('--payment-reversal-api') || process.argv.includes('--payment-reversal-browser') ? 'scripts/payment-reversal-api-audit-v1.cjs' : reconciliation ? 'scripts/payment-adjustment-reconciliation-audit-v1.cjs' : process.argv.includes('--sales-plan') ? 'scripts/sales-fulfillment-plan-audit-v1.cjs' : process.argv.includes('--sales-partial') ? 'scripts/sales-partial-fulfillment-audit-v1.cjs' : 'scripts/enterprise-round2-supervised.cjs';
  const audit = start('audit', [path.join(root, auditScript)], root,
    { APP_URL: urls[0], SECONDARY_APP_URL: urls[1] });
  const timer = setTimeout(() => { void stopOwned(audit); }, auditScript === 'scripts/enterprise-round2-supervised.cjs' ? ROUND2_PARENT_RUNTIME_MS : 5 * 60_000);
  try {
    const result = await audit.completion;
    process.exitCode = result.code ?? 1;
    if (!fs.existsSync(reportPath)) throw new Error('Audit terminated without a report');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    console.log(JSON.stringify(reconciliation || authorization || unsavedFocus || procurementBrowser ? { status: report.status, scope: report.scope, reportPath }
      : { status: report.status, passed: report.summary.passedChecks, failed: report.summary.failedChecks, remaining: report.summary.remainingChecks, reportPath }));
    // A terminated child or unfinished report never becomes green.
    if (!report.finishedAt || report.status !== 'passed') process.exitCode ||= 2;
  } finally { clearTimeout(timer); }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop().finally(() => process.exit(1)); });
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(stop);
