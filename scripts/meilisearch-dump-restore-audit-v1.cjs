const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = process.cwd();
const runtimeRoot = path.resolve(process.env.AILAODA_HA_RUNTIME_ROOT || 'C:\\AilaoDaPostgresRehearsal');
const reportPath = path.join(root, 'output/audit/meilisearch-dump-restore-audit-v1.json');
const exe = path.join(runtimeRoot, 'external/meilisearch.exe');
const pidPath = path.join(runtimeRoot, 'run/meili-restore.pid');
const dataPath = path.join(runtimeRoot, 'meilisearch-restore-data');
const backupPath = path.join(runtimeRoot, `meilisearch-restore-data-preaudit-${Date.now()}`);
const masterKey = fs.readFileSync(path.join(runtimeRoot, '.meilisearch-master-key.txt'), 'utf8').trim();
const report = { name: 'Meilisearch Dump Restore Audit', version: '1.1', status: 'failed', startedAt: new Date().toISOString(), checks: [] };
let secondaryStopped = false;
let backupCreated = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, passed, details = {}) => { report.checks.push({ name, status: passed ? 'passed' : 'failed', ...details }); if (!passed) throw new Error(`Check failed: ${name}`); };
const headers = { authorization: `Bearer ${masterKey}`, 'content-type': 'application/json' };
const assertRuntimeChild = target => { const resolved = path.resolve(target); if (!resolved.startsWith(`${runtimeRoot}${path.sep}`)) throw new Error(`Refusing filesystem operation outside runtime root: ${resolved}`); return resolved; };
async function waitFor(url, timeoutMs = 30_000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { try { const response = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (response.ok) return true; } catch {} await sleep(300); } return false; }
async function api(base, pathname, options = {}) { const response = await fetch(`${base}${pathname}`, { ...options, headers: { ...headers, ...(options.headers || {}) }, signal: AbortSignal.timeout(5000) }); const text = await response.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch {} return { response, json, text }; }
async function waitTask(base, uid) { const deadline = Date.now() + 60_000; while (Date.now() < deadline) { const result = await api(base, `/tasks/${uid}`); if (result.json?.status === 'succeeded') return result.json; if (result.json?.status === 'failed') throw new Error(`Meilisearch task ${uid} failed: ${JSON.stringify(result.json?.error)}`); await sleep(300); } throw new Error(`Meilisearch task ${uid} timed out.`); }
function stopSecondary() { const pid = Number(fs.readFileSync(pidPath, 'utf8').trim()); if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid Meilisearch restore PID file.'); process.kill(pid, 'SIGTERM'); secondaryStopped = true; return pid; }
function startSecondary(importDump) {
  const out = fs.openSync(path.join(runtimeRoot, 'meili-restore.stdout.log'), 'a');
  const err = fs.openSync(path.join(runtimeRoot, 'meili-restore.stderr.log'), 'a');
  const child = spawn(exe, importDump ? ['--import-dump', importDump] : [], { cwd: runtimeRoot, env: { ...process.env, MEILI_HTTP_ADDR: '127.0.0.1:7710', MEILI_DB_PATH: dataPath, MEILI_MASTER_KEY: masterKey, MEILI_ENV: 'production', MEILI_NO_ANALYTICS: 'true' }, detached: true, windowsHide: true, stdio: ['ignore', out, err] });
  child.unref();
  fs.writeFileSync(pidPath, String(child.pid), 'ascii');
  secondaryStopped = false;
}
async function indexEvidence(base) {
  const customers = await api(base, '/indexes/ailaoda_customers/stats');
  const orders = await api(base, '/indexes/ailaoda_orders/stats');
  const search = await api(base, '/indexes/ailaoda_orders/search', { method: 'POST', body: JSON.stringify({ q: 'SO', limit: 5 }) });
  return { customers: Number(customers.json?.numberOfDocuments || 0), orders: Number(orders.json?.numberOfDocuments || 0), firstOrderId: String(search.json?.hits?.[0]?.id || '') };
}

async function main() {
  const primary = 'http://127.0.0.1:7700';
  const before = await indexEvidence(primary);
  check('primary-index-evidence', before.customers > 0 && before.orders > 0 && Boolean(before.firstOrderId), before);
  const dumpRequest = await api(primary, '/dumps', { method: 'POST', body: '{}' });
  const taskUid = dumpRequest.json?.taskUid;
  check('dump-task-created', dumpRequest.response.ok && Number.isInteger(taskUid), { taskUid });
  const task = await waitTask(primary, taskUid);
  const dumpUid = task.details?.dumpUid;
  const dumpPath = assertRuntimeChild(path.join(runtimeRoot, 'dumps', `${dumpUid}.dump`));
  check('dump-file-created', Boolean(dumpUid) && fs.existsSync(dumpPath), { dumpUid, dumpPath, bytes: fs.existsSync(dumpPath) ? fs.statSync(dumpPath).size : 0 });

  const stoppedPid = stopSecondary();
  check('restore-node-stopped', !(await waitFor('http://127.0.0.1:7710/health', 2500)), { pid: stoppedPid });
  assertRuntimeChild(dataPath);
  assertRuntimeChild(backupPath);
  fs.renameSync(dataPath, backupPath);
  backupCreated = true;
  startSecondary(dumpPath);
  check('dump-import-node-ready', await waitFor('http://127.0.0.1:7710/health', 60_000));
  const restored = await indexEvidence('http://127.0.0.1:7710');
  check('restored-document-counts', restored.customers === before.customers && restored.orders === before.orders, { before, restored });
  check('restored-query-equivalence', restored.firstOrderId === before.firstOrderId, { before: before.firstOrderId, restored: restored.firstOrderId });
  fs.rmSync(assertRuntimeChild(backupPath), { recursive: true, force: true });
  backupCreated = false;
  report.dumpUid = dumpUid;
  report.status = 'passed';
}

main().catch(error => { report.error = String(error.message || error); process.exitCode = 1; }).finally(async () => {
  if (backupCreated) {
    try {
      if (!secondaryStopped) {
        const pid = Number(fs.readFileSync(pidPath, 'utf8').trim());
        if (Number.isInteger(pid) && pid > 0) process.kill(pid, 'SIGTERM');
        await sleep(1500);
      }
      fs.rmSync(assertRuntimeChild(dataPath), { recursive: true, force: true });
      fs.renameSync(backupPath, dataPath);
      backupCreated = false;
      secondaryStopped = true;
    } catch (error) { report.recovery = { status: 'failed', error: String(error.message || error) }; process.exitCode = 1; }
  }
  if (secondaryStopped) startSecondary(null);
  const ready = await waitFor('http://127.0.0.1:7710/health', 30_000);
  report.checks.push({ name: 'restore-node-final-health', status: ready ? 'passed' : 'failed' });
  if (!ready) { report.status = 'failed'; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Meilisearch Dump Restore Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
