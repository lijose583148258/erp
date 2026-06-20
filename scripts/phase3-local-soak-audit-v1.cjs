const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const JSON_REPORT = path.join(OUTPUT_DIR, `phase3-local-soak-audit-${RUN_ID}.json`);
const MD_REPORT = path.join(OUTPUT_DIR, `phase3-local-soak-audit-${RUN_ID}.md`);
const TIMEOUT_MS = 300_000;
const REQUIRE_PACKAGE = ['1', 'true', 'yes', 'on'].includes(String(process.env.AILAODA_SOAK_REQUIRE_PACKAGE || '').toLowerCase());

const TASKS = [
  ...(REQUIRE_PACKAGE ? [{
    name: 'stable-package-origin',
    args: ['run', 'audit:package:origin'],
    expected: 'current 5001 runtime is launched from AilaoDa_Stable_Package, not root or another project',
  }] : []),
  {
    name: 'runtime-check',
    args: ['run', 'check:runtime'],
    expected: 'stable runtime health/home/assets are reachable on 5001',
  },
  {
    name: 'daily-stability',
    args: ['run', REQUIRE_PACKAGE ? 'audit:phase3:daily:package' : 'audit:phase3:daily'],
    expected: REQUIRE_PACKAGE
      ? 'package-mode daily stability ledger appends one pass with origin and freshness proof'
      : 'daily stability ledger appends one pass',
  },
  {
    name: 'db-integrity',
    args: ['run', 'audit:db:integrity'],
    expected: 'SQLite integrity, FK checks, schema drift checks pass',
  },
  {
    name: 'shadow-db-inventory',
    args: ['run', 'audit:db:shadow'],
    expected: 'historical DB files remain quarantined from active runtime',
  },
  {
    name: 'backup-retention-governance',
    args: ['run', 'audit:backup-retention'],
    expected: 'backup count/size/retention telemetry is visible without deleting backups',
  },
  {
    name: 'phase3-governance-dashboard',
    args: ['run', 'audit:phase3:dashboard'],
    expected: 'dashboard summarizes pass/watch/fail decision from latest evidence',
  },
];

const report = {
  name: 'Phase 3 Local Soak Audit',
  version: '1.0',
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  timeoutMsPerTask: TIMEOUT_MS,
  status: 'running',
  tasks: [],
  summary: {},
};

function commandLine(task) {
  return ['npm', ...task.args].join(' ');
}

function spawnNpmArgs(task) {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', ['npm', ...task.args].join(' ')],
    };
  }
  return {
    command: 'npm',
    args: task.args,
  };
}

function runTask(task) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const npmProcess = spawnNpmArgs(task);
    const child = spawn(npmProcess.command, npmProcess.args, {
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

    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', error => {
      clearTimeout(timer);
      resolve({
        name: task.name,
        command: commandLine(task),
        status: 'failed',
        exitCode: null,
        timedOut,
        durationMs: Date.now() - started,
        expected: task.expected,
        stdout: stdout.slice(-3000),
        stderr: `${stderr}\n${error.message}`.trim().slice(-3000),
      });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({
        name: task.name,
        command: commandLine(task),
        status: timedOut ? 'stuck' : code === 0 ? 'passed' : 'failed',
        exitCode: code,
        timedOut,
        durationMs: Date.now() - started,
        expected: task.expected,
        stdout: stdout.slice(-3000),
        stderr: stderr.slice(-3000),
      });
    });
  });
}

function readDashboardDecision() {
  const dashboardPath = path.join(OUTPUT_DIR, 'phase3-governance-dashboard-v1.json');
  if (!fs.existsSync(dashboardPath)) return null;
  try {
    const dashboard = JSON.parse(fs.readFileSync(dashboardPath, 'utf8'));
    return {
      status: dashboard.status,
      decision: dashboard.decision,
      watchItems: dashboard.summary?.watchItems || [],
    };
  } catch {
    return null;
  }
}

function writeReports() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const lines = [
    '# Phase 3 Local Soak Audit',
    '',
    `- status: ${report.status}`,
    `- runId: ${report.runId}`,
    `- started: ${report.startedAt}`,
    `- finished: ${report.finishedAt}`,
    `- tasks: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed, ${report.summary.stuck} stuck`,
    `- dashboard decision: ${report.dashboardDecision?.decision || 'unknown'}`,
    '',
    '## Tasks',
  ];
  for (const task of report.tasks) {
    lines.push(`- ${task.status.toUpperCase()} ${task.name} (${task.durationMs}ms)`);
    lines.push(`  - expected: ${task.expected}`);
    lines.push(`  - command: ${task.command}`);
    if (task.status !== 'passed') {
      lines.push(`  - stdout: ${JSON.stringify((task.stdout || '').slice(-1000))}`);
      lines.push(`  - stderr: ${JSON.stringify((task.stderr || '').slice(-1000))}`);
    }
  }
  lines.push('', '## Watch Items');
  const watchItems = report.dashboardDecision?.watchItems || [];
  if (watchItems.length === 0) {
    lines.push('- none');
  } else {
    for (const item of watchItems) {
      lines.push(`- ${item.id}: ${item.text}`);
    }
  }
  fs.writeFileSync(MD_REPORT, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  for (const task of TASKS) {
    console.log(JSON.stringify({ status: 'running', task: task.name, command: commandLine(task) }));
    const result = await runTask(task);
    report.tasks.push(result);
    console.log(JSON.stringify({ status: result.status, task: result.name, durationMs: result.durationMs }));
  }
  const passed = report.tasks.filter(task => task.status === 'passed').length;
  report.summary = {
    total: report.tasks.length,
    passed,
    failed: report.tasks.filter(task => task.status === 'failed').length,
    stuck: report.tasks.filter(task => task.status === 'stuck').length,
  };
  report.dashboardDecision = readDashboardDecision();
  report.status = passed === report.tasks.length ? 'passed' : 'failed';
  report.finishedAt = new Date().toISOString();
  writeReports();
  console.log(JSON.stringify({
    status: report.status,
    summary: report.summary,
    dashboardDecision: report.dashboardDecision,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}

main().catch(error => {
  report.status = 'failed';
  report.error = String(error.message || error);
  report.finishedAt = new Date().toISOString();
  writeReports();
  console.error(error);
  process.exit(1);
});
