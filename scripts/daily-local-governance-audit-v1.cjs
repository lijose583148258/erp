const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const GOVERNANCE_DIR = path.join(ROOT, '爱劳达软件治理中心', '10_主线任务');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const JSON_REPORT = path.join(OUTPUT_DIR, 'daily-local-governance-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'daily-local-governance-audit-v1.md');
const GOVERNANCE_REPORT = path.join(GOVERNANCE_DIR, '每日本地试跑审计-当前版.md');
const WITH_SOAK = process.argv.includes('--with-soak');
const WITH_BROWSER = process.argv.includes('--with-browser');
const WITH_BROWSER_FULL = process.argv.includes('--with-browser-full');

const BROWSER_SMOKE_TASKS = [
  { name: 'browser-cdp-core-pages-smoke', command: 'node .\\scripts\\cdp-core-pages-smoke-audit-v1.cjs', timeoutMs: 90_000 },
  { name: 'browser-ui-language-switch', command: 'npm run audit:ui:language-switch', timeoutMs: 90_000 },
  { name: 'browser-ui-theme-switch', command: 'npm run audit:ui:theme-switch', timeoutMs: 90_000 },
  { name: 'browser-ui-human-boundary', command: 'npm run audit:ui:human-boundary', timeoutMs: 90_000 },
  { name: 'browser-ui-unsaved-changes', command: 'npm run audit:ui:unsaved-changes', timeoutMs: 120_000 },
  { name: 'browser-crm-human-flow', command: 'npm run audit:human-flow:crm', timeoutMs: 90_000 },
  { name: 'browser-production-background', command: 'npm run audit:production:background', timeoutMs: 120_000 },
  { name: 'browser-collection-human-flow', command: 'npm run audit:collection:human-flow', timeoutMs: 120_000 },
  { name: 'browser-warehouse-transfer', command: 'npm run audit:warehouse:transfer:browser', timeoutMs: 120_000 },
];

const BROWSER_FULL_EXTRA_TASKS = [
  { name: 'browser-ui-module-titles', command: 'npm run audit:ui:module-titles', timeoutMs: 90_000 },
  { name: 'browser-role-system-permission', command: 'npm run audit:permissions:system-ui', timeoutMs: 120_000 },
  { name: 'browser-samples-rma', command: 'npm run audit:ui:samples-rma', timeoutMs: 120_000 },
  { name: 'browser-receipt-discrepancy-rma', command: 'npm run audit:ui:receipt-discrepancy-rma', timeoutMs: 120_000 },
  { name: 'browser-sales-orders', command: 'node .\\scripts\\sales-orders-browser-audit-v1.cjs', timeoutMs: 120_000 },
  { name: 'browser-human-flow-procurement-warehouse', command: 'npm run audit:human-flow -- --module=procurement-warehouse', timeoutMs: 120_000 },
  { name: 'browser-receivable-adjustment', command: 'npm run audit:receivable:browser', timeoutMs: 120_000 },
  { name: 'browser-shipping', command: 'node .\\scripts\\shipping-browser-audit-v1.cjs', timeoutMs: 120_000 },
];

const SELECTED_BROWSER_TASKS = WITH_BROWSER_FULL
  ? [...BROWSER_SMOKE_TASKS, ...BROWSER_FULL_EXTRA_TASKS]
  : WITH_BROWSER
    ? BROWSER_SMOKE_TASKS
    : [];

const TASKS = [
  { name: 'win10-runtime-environment', command: 'node .\\scripts\\win10-runtime-environment-audit-v1.cjs', timeoutMs: 30_000 },
  { name: 'baseline-freeze', command: 'node .\\scripts\\stable-baseline-freeze-v1.cjs', timeoutMs: 60_000 },
  { name: 'governance-ledger', command: 'node .\\scripts\\governance-ledger-inventory-v1.cjs', timeoutMs: 60_000 },
  { name: 'package-freshness', command: 'npm run audit:package:freshness', timeoutMs: 120_000 },
  { name: 'clean-runtime-desktop-shell', command: 'node .\\scripts\\clean-runtime-desktop-shell-audit-v1.cjs', timeoutMs: 300_000 },
  { name: 'package-origin', command: 'npm run audit:package:origin', timeoutMs: 60_000 },
  { name: 'runtime-check', command: 'npm run check:runtime', timeoutMs: 90_000 },
  { name: 'daily-package-smoke', command: 'npm run audit:phase3:daily:package', timeoutMs: 180_000 },
  { name: 'db-integrity', command: 'npm run audit:db:integrity', timeoutMs: 120_000 },
  { name: 'source-mojibake-gate', command: 'node .\\scripts\\effective-source-mojibake-gate-v1.cjs', timeoutMs: 120_000 },
  { name: 'phase3-dashboard', command: 'npm run audit:phase3:dashboard', timeoutMs: 120_000 },
  ...(WITH_SOAK ? [{ name: 'phase3-soak-package', command: 'npm run audit:phase3:soak:package', timeoutMs: 300_000 }] : []),
  ...SELECTED_BROWSER_TASKS,
];

const report = {
  name: 'Daily Local Governance Audit',
  version: '1.0',
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  status: 'running',
  entryUrl: 'http://127.0.0.1:5001/',
  runtimeDb: 'D:/AilaoDaRuntime/stable.db',
  withSoak: WITH_SOAK,
  withBrowser: WITH_BROWSER,
  withBrowserFull: WITH_BROWSER_FULL,
  tasks: [],
};

function toProjectPath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid || process.platform !== 'win32') {
      resolve();
      return;
    }
    // Ownership guard: this script only passes the PID returned by spawn()
    // for the current audit child process; it never targets node.exe globally.
    execFile('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { windowsHide: true }, () => resolve());
  });
}

function runTask(task) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn('cmd.exe', ['/d', '/s', '/c', task.command], {
      cwd: ROOT,
      env: {
        ...process.env,
        APP_URL: 'http://127.0.0.1:5001/',
        AILAODA_DAILY_REQUIRE_PACKAGE: '1',
        AILAODA_SOAK_REQUIRE_PACKAGE: '1',
      },
      windowsHide: true,
      shell: false,
    });
    const timer = setTimeout(async () => {
      timedOut = true;
      await killProcessTree(child.pid);
    }, task.timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        name: task.name,
        command: task.command,
        timeoutMs: task.timeoutMs,
        status: 'failed',
        exitCode: null,
        durationMs: Date.now() - started,
        stdout: stdout.slice(-3000),
        stderr: `${stderr}\n${error.message}`.trim().slice(-3000),
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        name: task.name,
        command: task.command,
        timeoutMs: task.timeoutMs,
        status: timedOut ? 'stuck' : code === 0 ? 'passed' : 'failed',
        exitCode: code,
        durationMs: Date.now() - started,
        stdout: stdout.slice(-3000),
        stderr: stderr.slice(-3000),
      });
    });
  });
}

function readDashboardDecision() {
  const filePath = path.join(OUTPUT_DIR, 'phase3-governance-dashboard-v1.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      status: data.status,
      decision: data.decision,
      watchItems: data.summary?.watchItems || [],
    };
  } catch (error) {
    return { status: 'unreadable', decision: 'unreadable', error: String(error.message || error) };
  }
}

function writeReports() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(GOVERNANCE_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const lines = [
    '# 每日本地试跑审计',
    '',
    `- generatedAt: ${report.finishedAt}`,
    `- status: ${report.status}`,
    `- runId: ${report.runId}`,
    `- entryUrl: ${report.entryUrl}`,
    `- runtimeDb: ${report.runtimeDb}`,
    `- withSoak: ${report.withSoak}`,
    `- withBrowser: ${report.withBrowser}`,
    `- withBrowserFull: ${report.withBrowserFull}`,
    `- passed: ${report.summary?.passed || 0}/${report.summary?.total || 0}`,
    `- failed: ${report.summary?.failed || 0}`,
    `- stuck: ${report.summary?.stuck || 0}`,
    `- dashboardDecision: ${report.dashboardDecision?.decision || 'unknown'}`,
    '',
    '## 固定边界',
    '',
    '- 每日默认只跑本地稳定包链路，不跑根目录开发版。',
    '- 每个任务都有 timeout，超过即记录 stuck，不无限等待。',
    '- `--with-browser` 只追加日常可判定的浏览器小包，避免单个超长串联超过 5 分钟后误判卡住。',
    '- `--with-soak` 可追加更重的本地试跑包；`--with-browser-full` 会分解追加完整浏览器全链路，适合周检或壳验收。',
    '',
    '## 任务结果',
    '',
    '| task | status | durationMs | timeoutMs |',
    '| --- | --- | ---: | ---: |',
  ];
  for (const task of report.tasks) {
    lines.push(`| ${task.name} | ${task.status} | ${task.durationMs} | ${task.timeoutMs} |`);
  }
  const failed = report.tasks.filter((task) => task.status !== 'passed');
  lines.push('', '## 失败/卡住项');
  if (failed.length === 0) {
    lines.push('', '- none');
  } else {
    for (const task of failed) {
      lines.push('', `### ${task.name}`);
      lines.push(`- command: ${task.command}`);
      lines.push(`- status: ${task.status}`);
      lines.push(`- stderrTail: ${JSON.stringify((task.stderr || '').slice(-800))}`);
    }
  }
  lines.push('', '## 下一步制度');
  lines.push('');
  lines.push('- 连续试跑期间，每天先运行 `npm run audit:daily:local-governance`。');
  lines.push('- 做壳或迁服务器前，运行 `npm run audit:daily:local-governance -- --with-soak`。');
  lines.push('- 做 UI/业务闭环大改后，先运行 `npm run audit:daily:local-governance -- --with-browser`。');
  lines.push('- 周检/壳验收再运行 `npm run audit:daily:local-governance -- --with-browser-full`，每个浏览器子任务独立 timeout，若单项超过 5 分钟按 stuck 拆包处理。');
  const md = `${lines.join('\n')}\n`;
  fs.writeFileSync(MD_REPORT, md, 'utf8');
  fs.writeFileSync(GOVERNANCE_REPORT, md, 'utf8');
}

async function main() {
  for (const task of TASKS) {
    console.log(JSON.stringify({ status: 'running', task: task.name, timeoutMs: task.timeoutMs, command: task.command }));
    const result = await runTask(task);
    report.tasks.push(result);
    console.log(JSON.stringify({ status: result.status, task: result.name, durationMs: result.durationMs }));
    if (result.status !== 'passed') break;
  }
  const passed = report.tasks.filter((task) => task.status === 'passed').length;
  report.summary = {
    total: report.tasks.length,
    passed,
    failed: report.tasks.filter((task) => task.status === 'failed').length,
    stuck: report.tasks.filter((task) => task.status === 'stuck').length,
  };
  report.dashboardDecision = readDashboardDecision();
  report.status = passed === report.tasks.length && report.tasks.length === TASKS.length ? 'passed' : 'failed';
  report.finishedAt = new Date().toISOString();
  report.outputs = {
    json: toProjectPath(JSON_REPORT),
    markdown: toProjectPath(MD_REPORT),
    governanceMarkdown: toProjectPath(GOVERNANCE_REPORT),
  };
  writeReports();
  console.log(JSON.stringify({
    status: report.status,
    summary: report.summary,
    dashboardDecision: report.dashboardDecision,
    outputs: report.outputs,
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
