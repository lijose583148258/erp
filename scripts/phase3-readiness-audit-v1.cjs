const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const REPORT_PATH = path.join(OUTPUT_DIR, 'phase3-readiness-audit-v1.json');
const MD_PATH = path.join(OUTPUT_DIR, 'phase3-readiness-audit-v1.md');
const DEFAULT_TIMEOUT_MS = 300_000;

const REQUIRED_ENV_KEYS = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'JWT_SECRET',
  'CORS_ORIGIN',
  'VITE_API_BASE_URL',
  'BACKUP_DIR',
  'LOG_DIR',
  'UPLOAD_DIR',
  'FRONTEND_DIST_DIR',
  'SERVE_FRONTEND',
  'TRUST_PROXY',
];

const ACTIVE_SOURCE_DIRS = [
  'backend/src',
  'app',
  'components',
  'pages',
  'services',
  'translations',
  'utils',
];

function parseArgs(argv) {
  return {
    withBrowser: argv.includes('--with-browser'),
    withReleaseCore: argv.includes('--with-release-core'),
  };
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
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
  const startedAt = Date.now();
  const growth = readErrorLogGrowth(before);
  return {
    name: 'error-log-quiet-window',
    command: 'compare logs/error.log before and after phase3 gate',
    status: growth.grew ? 'failed' : 'passed',
    exitCode: growth.grew ? 1 : 0,
    durationMs: Date.now() - startedAt,
    timedOut: false,
    stdout: growth.grew ? `error.log grew from ${growth.before.size} to ${growth.after.size} bytes` : '',
    stderr: growth.grew ? growth.text.slice(-4000) : '',
  };
}

function parseEnvExample(filePath) {
  const text = readText(filePath);
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

function walkFiles(dirPath, acc = []) {
  if (!fs.existsSync(dirPath)) return acc;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'output', '.git', '历史归档', '文档归档'].includes(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) walkFiles(fullPath, acc);
    else if (/\.(ts|tsx|js|cjs|html|css)$/.test(entry.name)) acc.push(fullPath);
  }
  return acc;
}

function staticReadinessChecks() {
  const findings = [];
  const envExamplePath = path.join(ROOT, '.env.production.example');
  if (!fs.existsSync(envExamplePath)) {
    findings.push({ level: 'P0', area: 'env', message: '.env.production.example 缺失' });
  } else {
    const keys = parseEnvExample(envExamplePath);
    for (const key of REQUIRED_ENV_KEYS) {
      if (!keys.has(key)) {
        findings.push({ level: 'P1', area: 'env', message: `.env.production.example 缺少 ${key}` });
      }
    }
  }

  const packageJson = JSON.parse(readText(path.join(ROOT, 'package.json')));
  const scripts = packageJson.scripts || {};
  for (const scriptName of ['start:stable', 'verify:release:core', 'verify:release', 'db:backup', 'db:restore', 'db:pg']) {
    if (!scripts[scriptName]) {
      findings.push({ level: 'P1', area: 'scripts', message: `package.json 缺少 ${scriptName}` });
    }
  }

  const indexHtml = readText(path.join(ROOT, 'index.html'));
  if (/cdn\.tailwindcss|fonts\.googleapis|fonts\.gstatic|unpkg\.com|jsdelivr\.net/i.test(indexHtml)) {
    findings.push({ level: 'P0', area: 'offline', message: 'index.html 存在外部 CDN 或 Google Fonts 依赖' });
  }

  const sourceFiles = ACTIVE_SOURCE_DIRS.flatMap(dir => walkFiles(path.join(ROOT, dir)));
  const forbiddenFrontendPatterns = [
    { pattern: /cdn\.tailwindcss/i, message: 'Tailwind CDN' },
    { pattern: /fonts\.googleapis|fonts\.gstatic/i, message: 'Google Fonts' },
    { pattern: /unpkg\.com|jsdelivr\.net/i, message: '公共 CDN' },
  ];
  for (const filePath of sourceFiles) {
    const rel = path.relative(ROOT, filePath);
    const text = readText(filePath);
    for (const rule of forbiddenFrontendPatterns) {
      if (rule.pattern.test(text)) {
        findings.push({ level: 'P0', area: 'offline', message: `${rel} 存在 ${rule.message}` });
      }
    }
  }

  const runtimeConfig = readText(path.join(ROOT, 'backend', 'src', 'config', 'runtime.ts'));
  for (const token of ['DATABASE_URL', 'AILAODA_RUNTIME_DB_PATH', 'BACKUP_DIR', 'UPLOAD_DIR', 'FRONTEND_DIST_DIR', 'CORS_ORIGIN']) {
    if (!runtimeConfig.includes(token)) {
      findings.push({ level: 'P1', area: 'runtime', message: `runtime.ts 未显式支持 ${token}` });
    }
  }

  return {
    status: findings.some(item => item.level === 'P0') ? 'failed' : findings.length ? 'warning' : 'passed',
    findings,
    scannedFiles: sourceFiles.length,
  };
}

function commandLine(task) {
  return [task.command, ...task.args].join(' ');
}

function runTask(task) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const timeoutMs = task.timeoutMs || DEFAULT_TIMEOUT_MS;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(task.command, task.args, {
      cwd: ROOT,
      env: { ...process.env, CI: '1', AILODA_PHASE3_GATE: '1' },
      windowsHide: true,
      shell: false,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 3000).unref();
    }, timeoutMs);

    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', error => {
      clearTimeout(timer);
      resolve({
        name: task.name,
        command: commandLine(task),
        status: 'failed',
        durationMs: Date.now() - startedAt,
        timedOut,
        stdout: stdout.slice(-4000),
        stderr: `${stderr}\n${error.message}`.trim().slice(-4000),
      });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({
        name: task.name,
        command: commandLine(task),
        status: timedOut ? 'stuck' : code === 0 ? 'passed' : 'failed',
        exitCode: code,
        durationMs: Date.now() - startedAt,
        timedOut,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
      });
    });
  });
}

function task(name, command, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return { name, command, args, timeoutMs };
}

function npxTask(name, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (process.platform === 'win32') {
    return task(name, 'cmd.exe', ['/d', '/s', '/c', ['npx', ...args].join(' ')], timeoutMs);
  }
  return task(name, 'npx', args, timeoutMs);
}

function getRuntimeTasks(options) {
  const tasks = [
    task('runtime-resource-check', 'powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/check-runtime.ps1']),
    task('runtime-db-integrity', process.platform === 'win32' ? 'cmd.exe' : 'npx', process.platform === 'win32' ? ['/d', '/s', '/c', 'npx tsx scripts/runtime-db-integrity-audit-v1.ts'] : ['tsx', 'scripts/runtime-db-integrity-audit-v1.ts']),
    task('effective-source-mojibake-gate', 'node', ['scripts/effective-source-mojibake-gate-v1.cjs']),
    task('business-rejection-log-classification', process.platform === 'win32' ? 'cmd.exe' : 'npx', process.platform === 'win32' ? ['/d', '/s', '/c', 'npx tsx scripts/business-rejection-log-classification-audit-v1.ts'] : ['tsx', 'scripts/business-rejection-log-classification-audit-v1.ts']),
    npxTask('frontend-typescript-gate', ['tsc', '--noEmit']),
    task('stable-entrypoint-policy', 'node', ['scripts/stable-entrypoint-policy-audit-v1.cjs']),
    task('dist-entry-asset-audit', 'node', ['scripts/dist-entry-asset-audit-v1.cjs']),
    task('shipping-ocr-regression', process.platform === 'win32' ? 'cmd.exe' : 'npx', process.platform === 'win32' ? ['/d', '/s', '/c', 'npx tsx scripts/shipping-ocr-regression-v1.ts'] : ['tsx', 'scripts/shipping-ocr-regression-v1.ts']),
    task('backup-restore-api-chain', 'node', ['scripts/backup-restore-api-audit-v1.cjs']),
    task('deployment-migration-readiness', 'node', ['scripts/deployment-migration-readiness-audit-v1.cjs']),
    task('supplier-permission-api-chain', 'node', ['scripts/supplier-permission-api-audit-v1.cjs']),
    task('procurement-api-chain', 'node', ['scripts/procurement-api-audit-v1.cjs']),
    task('receivable-adjustment-api-chain', 'node', ['scripts/receivable-adjustment-api-audit-v1.cjs']),
    task('chemical-bom-production-chain', 'node', ['scripts/chemical-bom-production-chain-audit-v1.cjs']),
    task('shipping-api-chain', 'node', ['scripts/shipping-api-audit-v1.cjs']),
    task('ai-security-regression', process.platform === 'win32' ? 'cmd.exe' : 'npx', process.platform === 'win32' ? ['/d', '/s', '/c', 'npx tsx scripts/ai-security-regression.ts'] : ['tsx', 'scripts/ai-security-regression.ts']),
  ];
  if (options.withBrowser) {
    tasks.push(
      task('cdp-core-pages-smoke', 'node', ['scripts/cdp-core-pages-smoke-audit-v1.cjs']),
      task('human-flow-procurement-warehouse', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:human-flow -- --module=procurement-warehouse'] : ['run', 'audit:human-flow', '--', '--module=procurement-warehouse']),
      task('receivable-adjustment-browser-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:receivable:browser'] : ['run', 'audit:receivable:browser']),
      task('shipping-browser-chain', 'node', ['scripts/shipping-browser-audit-v1.cjs']),
    );
  }
  if (options.withReleaseCore) {
    tasks.push(task('release-core-gate', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run verify:release:core'] : ['run', 'verify:release:core']));
  }
  return tasks;
}

function writeReports(report) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const md = [];
  md.push('# Phase 3 Readiness Audit v1');
  md.push('');
  md.push(`- status: ${report.status}`);
  md.push(`- started: ${report.startedAt}`);
  md.push(`- finished: ${report.finishedAt}`);
  md.push(`- static: ${report.static.status}`);
  md.push(`- runtime steps: ${report.summary.passed}/${report.summary.total} passed`);
  md.push('');
  md.push('## Static Findings');
  if (report.static.findings.length === 0) md.push('- none');
  for (const finding of report.static.findings) {
    md.push(`- ${finding.level} ${finding.area}: ${finding.message}`);
  }
  md.push('');
  md.push('## Runtime Steps');
  for (const step of report.runtimeSteps) {
    md.push(`- ${step.status.toUpperCase()} ${step.name} (${step.durationMs}ms)`);
    if (step.status !== 'passed') {
      md.push(`  - command: ${step.command}`);
      md.push(`  - stdout: ${JSON.stringify((step.stdout || '').slice(-1200))}`);
      md.push(`  - stderr: ${JSON.stringify((step.stderr || '').slice(-1200))}`);
    }
  }
  fs.writeFileSync(MD_PATH, `${md.join('\n')}\n`, 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const staticResult = staticReadinessChecks();
  const runtimeSteps = [];
  const errorLogBefore = readErrorLogSnapshot();
  let stoppedEarly = false;

  console.log(JSON.stringify({ status: 'started', gate: 'phase3-readiness', options }));
  for (const currentTask of getRuntimeTasks(options)) {
    console.log(JSON.stringify({ status: 'running', step: currentTask.name, command: commandLine(currentTask) }));
    const result = await runTask(currentTask);
    runtimeSteps.push(result);
    console.log(JSON.stringify({ status: result.status, step: result.name, durationMs: result.durationMs, timedOut: result.timedOut }));
    if (result.status !== 'passed') {
      stoppedEarly = true;
      break;
    }
  }

  if (!stoppedEarly) {
    const result = buildErrorLogQuietStep(errorLogBefore);
    runtimeSteps.push(result);
    console.log(JSON.stringify({ status: result.status, step: result.name, durationMs: result.durationMs, timedOut: result.timedOut }));
  }

  const failedRuntime = runtimeSteps.filter(item => item.status !== 'passed');
  const report = {
    status: staticResult.status === 'failed' || failedRuntime.length > 0 ? 'failed' : staticResult.status === 'warning' ? 'warning' : 'passed',
    startedAt,
    finishedAt: new Date().toISOString(),
    options,
    static: staticResult,
    runtimeSteps,
    stoppedEarly,
    summary: {
      total: runtimeSteps.length,
      passed: runtimeSteps.filter(item => item.status === 'passed').length,
      failed: runtimeSteps.filter(item => item.status === 'failed').length,
      stuck: runtimeSteps.filter(item => item.status === 'stuck').length,
    },
    reports: {
      json: REPORT_PATH,
      markdown: MD_PATH,
    },
  };
  writeReports(report);
  console.log(JSON.stringify({
    status: report.status,
    summary: report.summary,
    static: report.static.status,
    jsonReport: REPORT_PATH,
    markdownReport: MD_PATH,
  }, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
