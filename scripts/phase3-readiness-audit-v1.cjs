const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { childOutputTailBase64, decodeChildOutputDetails } = require('./lib/child-output-decoder.cjs');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const REPORT_PATH = path.join(OUTPUT_DIR, 'phase3-readiness-audit-v1.json');
const MD_PATH = path.join(OUTPUT_DIR, 'phase3-readiness-audit-v1.md');
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_CLEAN_RUNTIME_ROOT = Buffer.from('RTpc54ix5Yqz6L6+57qv5YeA57O757uf', 'base64').toString('utf8');
const CLEAN_RUNTIME_ROOT = process.env.AILAODA_CLEAN_RUNTIME_ROOT || DEFAULT_CLEAN_RUNTIME_ROOT;
const CLEAN_RUNTIME_LAUNCHER = path.join(CLEAN_RUNTIME_ROOT, 'scripts', 'start-stable-v2.ps1');
const STABLE_PACKAGE_LAUNCHER = path.join(ROOT, 'AilaoDa_Stable_Package', 'scripts', 'start-stable-v2.ps1');
const RETRY_POLICIES = {
  'auth-account-lifecycle-chain': {
    maxAttempts: 2,
    retryDelayMs: 1500,
    reason: 'transient-auth-register-401-or-node-handle-close',
    shouldRetry(result) {
      if (!result || result.status === 'passed' || result.timedOut) return false;
      const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
      return /register-sales-user:\s*expected 201 but got 401/i.test(combined)
        || /UV_HANDLE_CLOSING/i.test(combined);
    },
  },
};

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

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function shouldRestartFromPackage() {
  return isTruthy(process.env.AILAODA_RESTART_FROM_PACKAGE)
    || fs.existsSync(CLEAN_RUNTIME_LAUNCHER)
    || fs.existsSync(STABLE_PACKAGE_LAUNCHER);
}

function getPreferredPackageLauncher() {
  if (fs.existsSync(CLEAN_RUNTIME_LAUNCHER)) return CLEAN_RUNTIME_LAUNCHER;
  if (fs.existsSync(STABLE_PACKAGE_LAUNCHER)) return STABLE_PACKAGE_LAUNCHER;
  return null;
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
      text: decodeChildOutputDetails([buffer]).text,
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
  for (const scriptName of ['start:stable', 'verify:release:core', 'verify:release', 'audit:package:freshness', 'db:backup', 'db:restore', 'db:pg']) {
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runTask(task) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const timeoutMs = task.timeoutMs || DEFAULT_TIMEOUT_MS;
    const stdoutChunks = [];
    const stderrChunks = [];
    let timedOut = false;
    const child = spawn(task.command, task.args, {
      cwd: ROOT,
      env: {
        ...process.env,
        CI: '1',
        AILODA_PHASE3_GATE: '1',
        AILAODA_RESTART_FROM_PACKAGE: shouldRestartFromPackage() ? '1' : process.env.AILAODA_RESTART_FROM_PACKAGE,
        AILAODA_CLEAN_RUNTIME_ROOT: CLEAN_RUNTIME_ROOT,
      },
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

    child.stdout.on('data', chunk => { stdoutChunks.push(Buffer.from(chunk)); });
    child.stderr.on('data', chunk => { stderrChunks.push(Buffer.from(chunk)); });
    child.on('error', error => {
      clearTimeout(timer);
      const stdoutDecoded = decodeChildOutputDetails(stdoutChunks);
      const stderrDecoded = decodeChildOutputDetails(stderrChunks);
      resolve({
        name: task.name,
        command: commandLine(task),
        status: 'failed',
        durationMs: Date.now() - startedAt,
        timedOut,
        stdout: stdoutDecoded.text.slice(-4000),
        stderr: `${stderrDecoded.text}\n${error.message}`.trim().slice(-4000),
        stdoutEncoding: stdoutDecoded,
        stderrEncoding: stderrDecoded,
        stdoutRawTailBase64: childOutputTailBase64(stdoutChunks),
        stderrRawTailBase64: childOutputTailBase64(stderrChunks),
      });
    });
    child.on('close', code => {
      clearTimeout(timer);
      const stdoutDecoded = decodeChildOutputDetails(stdoutChunks);
      const stderrDecoded = decodeChildOutputDetails(stderrChunks);
      const status = timedOut ? 'stuck' : code === 0 ? 'passed' : 'failed';
      const failed = status !== 'passed';
      resolve({
        name: task.name,
        command: commandLine(task),
        status,
        exitCode: code,
        durationMs: Date.now() - startedAt,
        timedOut,
        stdout: stdoutDecoded.text.slice(-4000),
        stderr: stderrDecoded.text.slice(-4000),
        stdoutEncoding: stdoutDecoded,
        stderrEncoding: stderrDecoded,
        stdoutRawTailBase64: failed ? childOutputTailBase64(stdoutChunks) : undefined,
        stderrRawTailBase64: failed ? childOutputTailBase64(stderrChunks) : undefined,
      });
    });
  });
}

async function runTaskWithRetry(task) {
  const policy = RETRY_POLICIES[task.name];
  const attempts = [];
  let result = await runTask(task);
  attempts.push(result);

  if (policy) {
    while (attempts.length < policy.maxAttempts && policy.shouldRetry(result)) {
      await delay(policy.retryDelayMs);
      result = await runTask(task);
      attempts.push(result);
    }
  }

  if (attempts.length > 1) {
    result = {
      ...result,
      retried: true,
      retryReason: policy?.reason || 'manual-policy',
      retryAttempts: attempts.length,
      recoveredFromRetry: result.status === 'passed' && attempts.slice(0, -1).some(item => item.status !== 'passed'),
      attempts: attempts.map((attempt, index) => ({
        attempt: index + 1,
        name: attempt.name,
        command: attempt.command,
        status: attempt.status,
        exitCode: attempt.exitCode,
        durationMs: attempt.durationMs,
        timedOut: attempt.timedOut,
        stdout: attempt.stdout,
        stderr: attempt.stderr,
        stdoutEncoding: attempt.stdoutEncoding,
        stderrEncoding: attempt.stderrEncoding,
        stdoutRawTailBase64: attempt.stdoutRawTailBase64,
        stderrRawTailBase64: attempt.stderrRawTailBase64,
      })),
    };
  }

  return result;
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
    task('backend-build-gate', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm --prefix backend run build'] : ['--prefix', 'backend', 'run', 'build']),
    task('runtime-resource-check', 'powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/check-runtime.ps1']),
    task('stable-package-origin-early', 'node', ['scripts/stable-package-origin-audit-v1.cjs']),
    task('runtime-db-integrity', process.platform === 'win32' ? 'cmd.exe' : 'npx', process.platform === 'win32' ? ['/d', '/s', '/c', 'npx tsx scripts/runtime-db-integrity-audit-v1.ts'] : ['tsx', 'scripts/runtime-db-integrity-audit-v1.ts']),
    task('runtime-db-shadow-inventory', 'node', ['scripts/runtime-db-shadow-inventory-audit-v1.cjs']),
    npxTask('test-data-retention-inventory', ['tsx', 'scripts/test-data-retention-inventory-audit-v1.ts']),
    npxTask('test-data-retention-dependency-graph', ['tsx', 'scripts/test-data-retention-dependency-graph-audit-v1.ts']),
    task('runtime-restart-persistence', process.platform === 'win32' ? 'cmd.exe' : 'npx', process.platform === 'win32' ? ['/d', '/s', '/c', 'npx tsx scripts/runtime-restart-persistence-audit-v1.ts'] : ['tsx', 'scripts/runtime-restart-persistence-audit-v1.ts']),
    task('runtime-write-read-restart', process.platform === 'win32' ? 'cmd.exe' : 'npx', process.platform === 'win32' ? ['/d', '/s', '/c', 'npx tsx scripts/runtime-write-read-restart-audit-v1.ts'] : ['tsx', 'scripts/runtime-write-read-restart-audit-v1.ts']),
    task('effective-source-mojibake-gate', 'node', ['scripts/effective-source-mojibake-gate-v1.cjs']),
    task('business-rejection-log-classification', process.platform === 'win32' ? 'cmd.exe' : 'npx', process.platform === 'win32' ? ['/d', '/s', '/c', 'npx tsx scripts/business-rejection-log-classification-audit-v1.ts'] : ['tsx', 'scripts/business-rejection-log-classification-audit-v1.ts']),
    npxTask('frontend-typescript-gate', ['tsc', '--noEmit']),
    task('status-badge-governance', 'node', ['scripts/status-badge-governance-audit-v1.cjs']),
    task('active-source-inventory', 'node', ['scripts/active-source-inventory-v1.cjs']),
    task('refactor-freeze-gate', 'node', ['scripts/refactor-freeze-gate-v1.cjs']),
    task('stable-entrypoint-policy', 'node', ['scripts/stable-entrypoint-policy-audit-v1.cjs']),
    task('legacy-interface-disconnect', 'node', ['scripts/legacy-interface-disconnect-audit-v1.cjs']),
    task('dist-entry-asset-audit', 'node', ['scripts/dist-entry-asset-audit-v1.cjs']),
    task('package-freshness-gate', 'powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/package-stable.ps1', '-CheckOnly']),
    task('bulk-write-singleflight-governance', 'node', ['scripts/bulk-write-singleflight-governance-audit-v1.cjs']),
    task('concurrency-consistency', 'node', ['scripts/concurrency-consistency-audit-v1.cjs']),
    task('adjustment-finance-boundary', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:adjustment:finance-boundary'] : ['run', 'audit:adjustment:finance-boundary']),
    task('payment-verification-concurrency', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:payment:verification-concurrency'] : ['run', 'audit:payment:verification-concurrency']),
    task('collection-concurrency-reconcile', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:collection:concurrency'] : ['run', 'audit:collection:concurrency']),
    task('barter-concurrency-reconcile', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:barter:concurrency'] : ['run', 'audit:barter:concurrency']),
    task('money-goods-chain', 'node', ['scripts/money-goods-chain-api-audit-v1.cjs']),
    task('stock-ledger-reconcile', 'node', ['scripts/stock-ledger-reconcile-audit-v1.cjs']),
    task('warehouse-transfer-api-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:warehouse:transfer'] : ['run', 'audit:warehouse:transfer']),
    task('warehouse-ledger-api-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:warehouse:ledger'] : ['run', 'audit:warehouse:ledger']),
    npxTask('import-export-standardization', ['tsx', 'scripts/import-export-standardization-audit-v1.ts']),
    task('shipping-ocr-regression', process.platform === 'win32' ? 'cmd.exe' : 'npx', process.platform === 'win32' ? ['/d', '/s', '/c', 'npx tsx scripts/shipping-ocr-regression-v1.ts'] : ['tsx', 'scripts/shipping-ocr-regression-v1.ts']),
    task('backup-restore-api-chain', 'node', ['scripts/backup-restore-api-audit-v1.cjs']),
    task('backup-restore-concurrency-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:backup-restore:concurrency'] : ['run', 'audit:backup-restore:concurrency']),
    task('backup-restore-data-fingerprint', process.platform === 'win32' ? 'cmd.exe' : 'npx', process.platform === 'win32' ? ['/d', '/s', '/c', 'npx tsx scripts/backup-restore-data-fingerprint-audit-v1.ts'] : ['tsx', 'scripts/backup-restore-data-fingerprint-audit-v1.ts']),
    task('runtime-write-backup-restore-readback', process.platform === 'win32' ? 'cmd.exe' : 'npx', process.platform === 'win32' ? ['/d', '/s', '/c', 'npx tsx scripts/runtime-write-backup-restore-readback-audit-v1.ts'] : ['tsx', 'scripts/runtime-write-backup-restore-readback-audit-v1.ts']),
    task('deployment-migration-readiness', 'node', ['scripts/deployment-migration-readiness-audit-v1.cjs']),
    task('commercial-platform-api-chain', 'node', ['scripts/commercial-platform-api-audit-v1.cjs']),
    task('auth-session-token-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:auth:session-token'] : ['run', 'audit:auth:session-token']),
    task('auth-account-lifecycle-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:auth:account-lifecycle'] : ['run', 'audit:auth:account-lifecycle']),
    task('supplier-permission-api-chain', 'node', ['scripts/supplier-permission-api-audit-v1.cjs']),
    task('role-permission-assignment-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:permissions:assignment'] : ['run', 'audit:permissions:assignment']),
    task('role-assignment-escalation-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:permissions:role-assignment'] : ['run', 'audit:permissions:role-assignment']),
    task('audit-read-dynamic-permission-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:permissions:audit-read'] : ['run', 'audit:permissions:audit-read']),
    task('casbin-fallback-policy-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:permissions:casbin-fallback'] : ['run', 'audit:permissions:casbin-fallback']),
    task('procurement-api-chain', 'node', ['scripts/procurement-api-audit-v1.cjs']),
    task('receivable-adjustment-api-chain', 'node', ['scripts/receivable-adjustment-api-audit-v1.cjs']),
    task('receipt-discrepancy-action-api-chain', 'node', ['scripts/receipt-discrepancy-action-api-audit-v1.cjs']),
    task('chemical-bom-production-chain', 'node', ['scripts/chemical-bom-production-chain-audit-v1.cjs']),
    task('shipping-api-chain', 'node', ['scripts/shipping-api-audit-v1.cjs']),
    task('ai-security-regression', process.platform === 'win32' ? 'cmd.exe' : 'npx', process.platform === 'win32' ? ['/d', '/s', '/c', 'npx tsx scripts/ai-security-regression.ts'] : ['tsx', 'scripts/ai-security-regression.ts']),
    task('ai-isolation-redteam-regression', process.platform === 'win32' ? 'cmd.exe' : 'npx', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:ai:isolation'] : ['run', 'audit:ai:isolation']),
  ];
  if (options.withBrowser) {
    tasks.push(
      task('cdp-core-pages-smoke', 'node', ['scripts/cdp-core-pages-smoke-audit-v1.cjs']),
      task('ui-module-title-browser-gate', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:ui:module-titles'] : ['run', 'audit:ui:module-titles']),
      task('ui-language-switch-browser-gate', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:ui:language-switch'] : ['run', 'audit:ui:language-switch']),
      task('crm-human-flow-browser-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:human-flow:crm'] : ['run', 'audit:human-flow:crm']),
      task('production-browser-background', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:production:background'] : ['run', 'audit:production:background']),
      task('collection-center-human-flow-browser-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:collection:human-flow'] : ['run', 'audit:collection:human-flow']),
      task('warehouse-transfer-browser-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:warehouse:transfer:browser'] : ['run', 'audit:warehouse:transfer:browser']),
      task('role-system-permission-browser-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:permissions:system-ui'] : ['run', 'audit:permissions:system-ui']),
      task('team-account-lifecycle-browser-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:team:account-lifecycle'] : ['run', 'audit:team:account-lifecycle']),
      task('samples-rma-browser-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:ui:samples-rma'] : ['run', 'audit:ui:samples-rma']),
      task('receipt-discrepancy-rma-browser-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:ui:receipt-discrepancy-rma'] : ['run', 'audit:ui:receipt-discrepancy-rma']),
      task('sales-orders-browser-chain', 'node', ['scripts/sales-orders-browser-audit-v1.cjs']),
      task('human-flow-procurement-warehouse', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:human-flow -- --module=procurement-warehouse'] : ['run', 'audit:human-flow', '--', '--module=procurement-warehouse']),
      task('receivable-adjustment-browser-chain', process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run audit:receivable:browser'] : ['run', 'audit:receivable:browser']),
      task('shipping-browser-chain', 'node', ['scripts/shipping-browser-audit-v1.cjs']),
    );
  }
  if (shouldRestartFromPackage()) {
    tasks.push(task('stable-package-origin-final', 'node', ['scripts/stable-package-origin-audit-v1.cjs']));
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
  md.push(`- runtime origin: ${report.runtimeOrigin.mode}`);
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
    if (step.retried) {
      md.push(`  - retried: true (${step.retryAttempts} attempts, recovered=${step.recoveredFromRetry ? 'yes' : 'no'}, reason=${step.retryReason})`);
      for (const attempt of step.attempts || []) {
        md.push(`  - attempt ${attempt.attempt}: ${attempt.status.toUpperCase()} (${attempt.durationMs}ms)`);
        if (attempt.status !== 'passed') {
          md.push(`    - stderr: ${JSON.stringify((attempt.stderr || '').slice(-600))}`);
        }
      }
    }
    if (step.status !== 'passed') {
      md.push(`  - command: ${step.command}`);
      md.push(`  - stdout encoding: ${JSON.stringify(step.stdoutEncoding || null)}`);
      md.push(`  - stderr encoding: ${JSON.stringify(step.stderrEncoding || null)}`);
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
  const restartFromPackage = shouldRestartFromPackage();
  const preferredPackageLauncher = getPreferredPackageLauncher();
  let stoppedEarly = false;

  console.log(JSON.stringify({ status: 'started', gate: 'phase3-readiness', options, restartFromPackage, preferredPackageLauncher }));
  for (const currentTask of getRuntimeTasks(options)) {
    console.log(JSON.stringify({ status: 'running', step: currentTask.name, command: commandLine(currentTask) }));
    const result = await runTaskWithRetry(currentTask);
    runtimeSteps.push(result);
    console.log(JSON.stringify({
      status: result.status,
      step: result.name,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      retried: Boolean(result.retried),
      retryAttempts: result.retryAttempts || 1,
      recoveredFromRetry: Boolean(result.recoveredFromRetry),
    }));
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
    runtimeOrigin: {
      mode: restartFromPackage
        ? preferredPackageLauncher && preferredPackageLauncher.startsWith(CLEAN_RUNTIME_ROOT)
          ? 'clean-runtime-package'
          : 'stable-package'
        : 'workspace',
      restartFromPackage,
      cleanRuntimeRoot: CLEAN_RUNTIME_ROOT,
      cleanRuntimeLauncher: CLEAN_RUNTIME_LAUNCHER,
      cleanRuntimeLauncherExists: fs.existsSync(CLEAN_RUNTIME_LAUNCHER),
      stablePackageLauncher: STABLE_PACKAGE_LAUNCHER,
      stablePackageLauncherExists: fs.existsSync(STABLE_PACKAGE_LAUNCHER),
      preferredPackageLauncher,
    },
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
