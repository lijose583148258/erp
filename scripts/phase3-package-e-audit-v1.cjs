const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17)}-${process.pid}`;
const JSON_REPORT = path.join(OUTPUT_DIR, `phase3-package-e-audit-${RUN_ID}.json`);
const MD_REPORT = path.join(OUTPUT_DIR, `phase3-package-e-audit-${RUN_ID}.md`);
const TIMEOUT_MS = 300_000;
const DEFAULT_CLEAN_RUNTIME_ROOT = Buffer.from('RTpc54ix5Yqz6L6+57qv5YeA57O757uf', 'base64').toString('utf8');
const CLEAN_RUNTIME_ROOT = process.env.AILAODA_CLEAN_RUNTIME_ROOT || DEFAULT_CLEAN_RUNTIME_ROOT;
const CLEAN_RUNTIME_LAUNCHER = path.join(CLEAN_RUNTIME_ROOT, 'scripts', 'start-stable-v2.ps1');
const STABLE_PACKAGE_LAUNCHER = path.join(ROOT, 'AilaoDa_Stable_Package', 'scripts', 'start-stable-v2.ps1');
const TASK_FILTER = (process.env.AILAODA_PHASE3_TASK_FILTER || process.argv.find((arg) => arg.startsWith('--task='))?.slice('--task='.length) || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function resolvePackageLauncher() {
  if (fs.existsSync(CLEAN_RUNTIME_LAUNCHER)) return CLEAN_RUNTIME_LAUNCHER;
  return STABLE_PACKAGE_LAUNCHER;
}

function nodeTask(name, script, expectedEvidence) {
  return {
    name,
    command: process.execPath,
    args: [script],
    expectedEvidence,
  };
}

function psTask(name, args, expectedEvidence) {
  return {
    name,
    command: 'powershell.exe',
    args,
    expectedEvidence,
  };
}

const TASKS = [
  nodeTask('stable-package-launcher', 'scripts/stable-launcher-health-audit-v1.cjs', 'packaged launcher starts production runtime with stable DB and JWT secret, preferring E clean runtime'),
  nodeTask('stable-package-origin', 'scripts/stable-package-origin-audit-v1.cjs', '5001 runtime origin report proves it was launched from E clean runtime or governed stable package'),
  nodeTask('default-credential-release-gate', 'scripts/default-credential-release-gate-v1.cjs', 'packaged release runtime rejects seeded demo credentials such as admin/admin123'),
  psTask('runtime-check', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/check-runtime.ps1'], 'stable runtime 5001 health/assets all 200'),
  nodeTask('active-source-inventory', 'scripts/active-source-inventory-v1.cjs', 'obsolete active paths and package references are zero'),
  nodeTask('stable-entrypoint-policy', 'scripts/stable-entrypoint-policy-audit-v1.cjs', 'root launchers and npm start default to the stable 5001 entry'),
  nodeTask('legacy-interface-disconnect', 'scripts/legacy-interface-disconnect-audit-v1.cjs', 'legacy timber APIs return 410 with replacement marker'),
  nodeTask('backup-retention-governance', 'scripts/backup-retention-governance-audit-v1.cjs', 'backup count, size, and retention policy telemetry are visible without deleting user backups'),
  nodeTask('dual-port-and-encoding', 'scripts/dual-port-audit-v2.cjs', '5001 endpoints are healthy and API text has no mojibake'),
  nodeTask('concurrency-consistency', 'scripts/concurrency-consistency-audit-v1.cjs', 'two payments, verification, and long read loop keep order/customer values stable'),
  nodeTask('concurrency-reconcile-deep', 'scripts/concurrency-reconcile-deep-audit-v1.cjs', 'duplicate payment/barter/shipping submissions do not drift amount or stock'),
  nodeTask('stock-ledger-reconcile', 'scripts/stock-ledger-reconcile-audit-v1.cjs', 'stock entries, movements, balances, unique source refs, and required locations reconcile'),
];
const SELECTED_TASKS = TASK_FILTER.length
  ? TASKS.filter((task) => TASK_FILTER.includes(task.name))
  : TASKS;

if (TASK_FILTER.length && SELECTED_TASKS.length !== TASK_FILTER.length) {
  const known = new Set(TASKS.map((task) => task.name));
  const unknown = TASK_FILTER.filter((name) => !known.has(name));
  throw new Error(`Unknown phase3 task filter: ${unknown.join(', ')}`);
}

const report = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  scope: 'phase3-package-e-concurrency-idempotency-reconcile-legacy-entry',
  packageLauncher: resolvePackageLauncher(),
  cleanRuntimeRoot: CLEAN_RUNTIME_ROOT,
  taskFilter: TASK_FILTER,
  timeoutMsPerTask: TIMEOUT_MS,
  status: 'running',
  tasks: [],
  summary: {},
};

function commandLine(task) {
  return [task.command, ...task.args].join(' ');
}

function runTask(task) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(task.command, task.args, {
      cwd: ROOT,
      env: { ...process.env, APP_URL: process.env.APP_URL || 'http://127.0.0.1:5001/' },
      windowsHide: true,
      shell: false,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 3000).unref();
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        name: task.name,
        command: commandLine(task),
        status: 'failed',
        exitCode: null,
        timedOut,
        durationMs: Date.now() - started,
        expectedEvidence: task.expectedEvidence,
        stdout: stdout.slice(-4000),
        stderr: `${stderr}\n${error.message}`.trim().slice(-4000),
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        name: task.name,
        command: commandLine(task),
        status: timedOut ? 'stuck' : code === 0 ? 'passed' : 'failed',
        exitCode: code,
        timedOut,
        durationMs: Date.now() - started,
        expectedEvidence: task.expectedEvidence,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
      });
    });
  });
}

function writeReports() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const md = [];
  md.push('# Phase 3 Package E Audit');
  md.push('');
  md.push(`- status: ${report.status}`);
  md.push(`- runId: ${report.runId}`);
  md.push(`- started: ${report.startedAt}`);
  md.push(`- finished: ${report.finishedAt}`);
  md.push(`- timeout per task: ${report.timeoutMsPerTask}ms`);
  md.push(`- passed: ${report.summary.passed}/${report.summary.total}`);
  md.push('');
  md.push('## Tasks');
  for (const task of report.tasks) {
    md.push(`- ${task.status.toUpperCase()} ${task.name} (${task.durationMs}ms)`);
    md.push(`  - expected: ${task.expectedEvidence}`);
    md.push(`  - command: ${task.command}`);
    if (task.status !== 'passed') {
      md.push(`  - stdout: ${JSON.stringify((task.stdout || '').slice(-1200))}`);
      md.push(`  - stderr: ${JSON.stringify((task.stderr || '').slice(-1200))}`);
    }
  }
  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');
}

async function main() {
  writeReports();
  for (const task of SELECTED_TASKS) {
    console.log(JSON.stringify({ status: 'running', task: task.name, command: commandLine(task) }));
    const result = await runTask(task);
    report.tasks.push(result);
    report.summary = {
      total: SELECTED_TASKS.length,
      passed: report.tasks.filter((item) => item.status === 'passed').length,
      failed: report.tasks.filter((item) => item.status === 'failed').length,
      stuck: report.tasks.filter((item) => item.status === 'stuck').length,
      completed: report.tasks.length,
    };
    writeReports();
    console.log(JSON.stringify({ status: result.status, task: result.name, durationMs: result.durationMs }));
  }

  const passed = report.tasks.filter((task) => task.status === 'passed').length;
  report.summary = {
    total: SELECTED_TASKS.length,
    passed,
    failed: report.tasks.filter((task) => task.status === 'failed').length,
    stuck: report.tasks.filter((task) => task.status === 'stuck').length,
  };
  report.status = passed === SELECTED_TASKS.length ? 'passed' : 'failed';
  report.finishedAt = new Date().toISOString();
  writeReports();

  console.log(JSON.stringify({
    status: report.status,
    summary: report.summary,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));

  if (report.status !== 'passed') process.exitCode = 1;
}

main().catch((error) => {
  report.status = 'failed';
  report.error = String(error.message || error);
  report.finishedAt = new Date().toISOString();
  writeReports();
  console.error(error);
  process.exit(1);
});
