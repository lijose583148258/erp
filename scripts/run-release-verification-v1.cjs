/**
 * Serial release verification gate for AilaoDa ERP+CRM.
 *
 * It runs checks one-by-one with a per-step timeout. Heavy write/stress checks
 * stay serial on purpose because the local SQLite runtime can look falsely red
 * if stress tests are run concurrently with read-performance probes.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const DEFAULT_TIMEOUT_MS = 300_000;
const startedAt = new Date();

function parseArgs(argv) {
  const args = { profile: 'core' };
  for (const arg of argv) {
    if (arg.startsWith('--profile=')) args.profile = arg.slice('--profile='.length);
  }
  if (!['core', 'full'].includes(args.profile)) {
    throw new Error(`Unsupported profile: ${args.profile}. Use core or full.`);
  }
  return args;
}

function commandLine(task) {
  return [task.command, ...task.args].join(' ');
}

function truncate(text, max = 6000) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]` : text;
}

function resolveErrorLogPath() {
  const configuredLogDir = process.env.LOG_DIR || 'logs';
  const logDir = path.isAbsolute(configuredLogDir)
    ? configuredLogDir
    : path.join(ROOT, configuredLogDir);
  return path.join(logDir, 'error.log');
}

function readErrorLogSnapshot() {
  const filePath = resolveErrorLogPath();
  if (!fs.existsSync(filePath)) {
    return { filePath, size: 0 };
  }
  return { filePath, size: fs.statSync(filePath).size };
}

function readErrorLogGrowth(before) {
  const after = readErrorLogSnapshot();
  if (after.filePath !== before.filePath || after.size <= before.size || !fs.existsSync(after.filePath)) {
    return { before, after, grew: false, text: '' };
  }

  const fd = fs.openSync(after.filePath, 'r');
  try {
    const length = Math.min(after.size - before.size, 12_000);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, before.size);
    return {
      before,
      after,
      grew: true,
      text: buffer.toString('utf8'),
    };
  } finally {
    fs.closeSync(fd);
  }
}

function buildErrorLogQuietStep(before) {
  const taskStarted = Date.now();
  const growth = readErrorLogGrowth(before);
  return {
    name: 'error-log-quiet-window',
    command: 'compare logs/error.log before and after release gate',
    status: growth.grew ? 'failed' : 'passed',
    exitCode: growth.grew ? 1 : 0,
    durationMs: Date.now() - taskStarted,
    timedOut: false,
    stdout: growth.grew ? truncate(`error.log grew from ${growth.before.size} to ${growth.after.size} bytes`) : '',
    stderr: growth.grew ? truncate(growth.text) : '',
  };
}

function runTask(task) {
  return new Promise((resolve) => {
    const taskStarted = Date.now();
    const timeoutMs = task.timeoutMs || DEFAULT_TIMEOUT_MS;
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    let child;
    try {
      child = spawn(task.command, task.args, {
        cwd: ROOT,
        env: {
          ...process.env,
          CI: '1',
          AILODA_RELEASE_GATE: '1',
        },
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      resolve({
        name: task.name,
        command: commandLine(task),
        status: 'failed',
        exitCode: null,
        durationMs: Date.now() - taskStarted,
        timedOut,
        stdout: truncate(stdout),
        stderr: truncate(error.message),
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {}
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
      }, 3000).unref();
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', error => {
      clearTimeout(timer);
      resolve({
        name: task.name,
        command: commandLine(task),
        status: 'failed',
        exitCode: null,
        durationMs: Date.now() - taskStarted,
        timedOut,
        stdout: truncate(stdout),
        stderr: truncate(`${stderr}\n${error.message}`.trim()),
      });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({
        name: task.name,
        command: commandLine(task),
        status: timedOut ? 'stuck' : code === 0 ? 'passed' : 'failed',
        exitCode: code,
        durationMs: Date.now() - taskStarted,
        timedOut,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
      });
    });
  });
}

function task(name, command, args, options = {}) {
  return { name, command, args, ...options };
}

function npmTask(name, args, options = {}) {
  if (process.platform === 'win32') {
    return task(name, 'cmd.exe', ['/d', '/s', '/c', ['npm', ...args].join(' ')], options);
  }
  return task(name, 'npm', args, options);
}

function npxTask(name, args, options = {}) {
  if (process.platform === 'win32') {
    return task(name, 'cmd.exe', ['/d', '/s', '/c', ['npx', ...args].join(' ')], options);
  }
  return task(name, 'npx', args, options);
}

function getTasks(profile) {
  const core = [
    task('active-source-inventory', 'node', ['scripts/active-source-inventory-v1.cjs']),
    task('stable-entrypoint-policy', 'node', ['scripts/stable-entrypoint-policy-audit-v1.cjs']),
    task('legacy-interface-disconnect', 'node', ['scripts/legacy-interface-disconnect-audit-v1.cjs']),
    task('effective-source-mojibake-gate', 'node', ['scripts/effective-source-mojibake-gate-v1.cjs']),
    npmTask('pilot-stability', ['run', 'test:pilot-stability']),
    npxTask('business-rejection-log-classification', ['tsx', 'scripts/business-rejection-log-classification-audit-v1.ts']),
    task('runtime-resource-check', 'powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/check-runtime.ps1']),
    npxTask('runtime-db-integrity', ['tsx', 'scripts/runtime-db-integrity-audit-v1.ts']),
    task('runtime-db-shadow-inventory', 'node', ['scripts/runtime-db-shadow-inventory-audit-v1.cjs']),
    npxTask('runtime-restart-persistence', ['tsx', 'scripts/runtime-restart-persistence-audit-v1.ts']),
    npxTask('runtime-write-read-restart', ['tsx', 'scripts/runtime-write-read-restart-audit-v1.ts']),
    task('dual-port-stable-audit', 'node', ['scripts/dual-port-audit-v2.cjs']),
    task('cdp-core-pages-smoke', 'node', ['scripts/cdp-core-pages-smoke-audit-v1.cjs']),
    npxTask('frontend-typescript-gate', ['tsc', '--noEmit']),
    npmTask('frontend-build', ['run', 'build']),
    npmTask('backend-build', ['--prefix', 'backend', 'run', 'build']),
    npmTask('lint', ['run', 'lint']),
    npxTask('ai-security-regression', ['tsx', 'scripts/ai-security-regression.ts']),
    task('full-codebase-audit', 'node', ['scripts/full-codebase-audit-v1.cjs']),
  ];

  if (profile === 'core') return core;

  return [
    ...core,
    task('orders-api-chain', 'node', ['scripts/orders-api-audit-v1.cjs']),
    task('procurement-api-chain', 'node', ['scripts/procurement-api-audit-v1.cjs']),
    task('partial-receipt-chain', 'node', ['scripts/partial-receipt-api-audit-v1.cjs']),
    task('money-goods-chain', 'node', ['scripts/money-goods-chain-api-audit-v1.cjs']),
    task('chemical-bom-production-chain', 'node', ['scripts/chemical-bom-production-chain-audit-v1.cjs']),
    task('backup-restore-chain', 'node', ['scripts/backup-restore-api-audit-v1.cjs']),
    npxTask('backup-restore-data-fingerprint', ['tsx', 'scripts/backup-restore-data-fingerprint-audit-v1.ts']),
    npxTask('runtime-write-backup-restore-readback', ['tsx', 'scripts/runtime-write-backup-restore-readback-audit-v1.ts']),
    task('dynamic-role-rbac-chain', 'node', ['scripts/dynamic-role-rbac-audit-v1.cjs']),
    task('crm-permission-ai-chain', 'node', ['scripts/crm-permission-ai-audit-v1.cjs']),
    task('collection-performance-serial', 'node', ['scripts/collection-performance-audit-v1.cjs']),
    task('concurrency-reconcile-serial', 'node', ['scripts/concurrency-reconcile-deep-audit-v1.cjs']),
    task('concurrency-consistency-serial', 'node', ['scripts/concurrency-consistency-audit-v1.cjs']),
    task('stock-ledger-reconcile', 'node', ['scripts/stock-ledger-reconcile-audit-v1.cjs']),
  ];
}

function writeReports(profile, results) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(OUTPUT_DIR, `release-verification-v1-${profile}-${stamp}.json`);
  const mdPath = path.join(OUTPUT_DIR, `release-verification-v1-${profile}-${stamp}.md`);
  const failed = results.filter(item => item.status !== 'passed');
  const report = {
    meta: {
      profile,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      root: ROOT,
      perStepTimeoutMs: DEFAULT_TIMEOUT_MS,
    },
    status: failed.length === 0 ? 'passed' : 'failed',
    summary: {
      total: results.length,
      passed: results.filter(item => item.status === 'passed').length,
      failed: results.filter(item => item.status === 'failed').length,
      stuck: results.filter(item => item.status === 'stuck').length,
    },
    results,
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const md = [];
  md.push(`# Release Verification v1 - ${profile}`);
  md.push('');
  md.push(`- status: ${report.status}`);
  md.push(`- started: ${report.meta.startedAt}`);
  md.push(`- finished: ${report.meta.finishedAt}`);
  md.push(`- per step timeout: ${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s`);
  md.push(`- summary: ${JSON.stringify(report.summary)}`);
  md.push('');
  md.push('## Steps');
  for (const item of results) {
    md.push(`- ${item.status.toUpperCase()} ${item.name} (${item.durationMs}ms)`);
    md.push(`  - command: ${item.command}`);
    if (item.status !== 'passed') {
      md.push(`  - stdout: ${JSON.stringify(item.stdout.slice(0, 1000))}`);
      md.push(`  - stderr: ${JSON.stringify(item.stderr.slice(0, 1000))}`);
    }
  }
  fs.writeFileSync(mdPath, `${md.join('\n')}\n`, 'utf8');

  return { report, jsonPath, mdPath };
}

async function main() {
  const { profile } = parseArgs(process.argv.slice(2));
  const tasks = getTasks(profile);
  const results = [];
  const errorLogBefore = readErrorLogSnapshot();

  console.log(JSON.stringify({
    status: 'started',
    profile,
    totalSteps: tasks.length + 1,
    perStepTimeoutMs: DEFAULT_TIMEOUT_MS,
  }));

  for (const currentTask of tasks) {
    console.log(JSON.stringify({ status: 'running', step: currentTask.name, command: commandLine(currentTask) }));
    const result = await runTask(currentTask);
    results.push(result);
    console.log(JSON.stringify({
      status: result.status,
      step: result.name,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    }));
    if (result.status !== 'passed') {
      break;
    }
  }

  if (results.every(item => item.status === 'passed')) {
    const result = buildErrorLogQuietStep(errorLogBefore);
    results.push(result);
    console.log(JSON.stringify({
      status: result.status,
      step: result.name,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    }));
  }

  const { report, jsonPath, mdPath } = writeReports(profile, results);
  console.log(JSON.stringify({
    status: report.status,
    summary: report.summary,
    jsonReport: jsonPath,
    markdownReport: mdPath,
  }, null, 2));

  if (report.status !== 'passed') {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
