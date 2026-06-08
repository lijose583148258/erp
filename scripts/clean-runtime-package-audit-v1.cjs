const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { killSpawnedProcessTree } = require('./lib/win32-audit-process-guard.cjs');

const ROOT = process.cwd();
const DEFAULT_CLEAN_ROOT = Buffer.from('RTpc54ix5Yqz6L6+57qv5YeA57O757uf', 'base64').toString('utf8');
const TARGET = process.env.AILAODA_CLEAN_PACKAGE_DIR || DEFAULT_CLEAN_ROOT;
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'clean-runtime-package-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'clean-runtime-package-audit-v1.md');
const EXE_PATH = path.join(TARGET, 'AilaoDa-ERP-CRM.exe');
const SHELL_REPORT = path.join(TARGET, 'output', 'audit', 'desktop-shell-v1.json');
const ORIGIN_REPORT = path.join(TARGET, 'output', 'audit', 'stable-runtime-origin-v1.json');

const REQUIRED_PATHS = [
  'AilaoDa-ERP-CRM.exe',
  'PURE_RUNTIME_PACKAGE.json',
  '.env.production',
  'dist/index.html',
  'backend/dist/server.js',
  'backend/package.json',
  'backend/package-lock.json',
  'backend/prisma',
  'backend/node_modules',
  'scripts/start-stable-v2.ps1',
  'scripts/stop-runtime.ps1',
  'scripts/check-runtime.ps1',
];

const FORBIDDEN_SOURCE_DIRS = [
  'app',
  'components',
  'pages',
  'services',
  'translations',
  'utils',
  'node_modules',
  '爱劳达软件治理中心',
  '.git',
];

const report = {
  name: 'Clean Runtime Package Audit',
  version: '1.0',
  startedAt: new Date().toISOString(),
  target: TARGET,
  status: 'running',
  findings: [],
  tasks: [],
};

function toProjectPath(filePath) {
  if (filePath.startsWith(ROOT)) return path.relative(ROOT, filePath).split(path.sep).join('/');
  return filePath;
}

function normalize(filePath) {
  return path.resolve(filePath).replace(/\//g, '\\').toLowerCase();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function addFinding(level, area, message, evidence = {}) {
  report.findings.push({ level, area, message, evidence });
}

function recordTask(task) {
  report.tasks.push({ at: new Date().toISOString(), ...task });
}

function runExe(args, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(EXE_PATH, args, {
      cwd: TARGET,
      windowsHide: true,
      shell: false,
    });
    const timer = setTimeout(async () => {
      timedOut = true;
        await killSpawnedProcessTree(child.pid);
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', error => {
      clearTimeout(timer);
      resolve({ status: 'failed', exitCode: null, durationMs: Date.now() - started, stdout, stderr, error: String(error.message || error) });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ status: timedOut ? 'stuck' : code === 0 ? 'passed' : 'failed', exitCode: code, durationMs: Date.now() - started, stdout, stderr });
    });
  });
}

function readRuntimeOrigin() {
  if (!fs.existsSync(ORIGIN_REPORT)) {
    return { report: null, root: null, matchesTarget: false };
  }
  try {
    const origin = readJson(ORIGIN_REPORT);
    return {
      report: origin,
      root: origin?.root || null,
      matchesTarget: normalize(origin?.root || '') === normalize(TARGET),
    };
  } catch (error) {
    return {
      report: { parseError: String(error.message || error) },
      root: null,
      matchesTarget: false,
    };
  }
}

async function probeHealth(timeoutMs = 5000) {
  try {
    const health = await httpGetJson('http://127.0.0.1:5001/health', timeoutMs);
    return {
      ok: health.statusCode === 200 && health.json?.status === 'ok',
      statusCode: health.statusCode,
      mode: health.json?.mode || null,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      error: String(error.message || error),
    };
  }
}

async function waitForTargetRuntime(timeoutMs) {
  const started = Date.now();
  let lastHealth = null;
  let lastOrigin = null;
  while (Date.now() - started < timeoutMs) {
    lastHealth = await probeHealth(5000);
    lastOrigin = readRuntimeOrigin();
    if (lastHealth.ok && lastOrigin.matchesTarget) {
      return {
        ok: true,
        durationMs: Date.now() - started,
        health: lastHealth,
        origin: lastOrigin,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return {
    ok: false,
    durationMs: Date.now() - started,
    health: lastHealth,
    origin: lastOrigin,
  };
}

async function runStartExe(timeoutMs) {
  const started = Date.now();
  const preStartHealth = await probeHealth(5000);
  const preStartOrigin = readRuntimeOrigin();
  if (preStartHealth.ok && preStartOrigin.matchesTarget) {
    return {
      status: 'passed',
      exitCode: 0,
      durationMs: Date.now() - started,
      timedOut: false,
      launcherPid: null,
      launcherClosed: true,
      cleanupStatus: 'skipped-runtime-already-healthy',
      runtime: { ok: true, health: preStartHealth, origin: preStartOrigin },
      postCleanupHealth: preStartHealth,
      postCleanupOrigin: preStartOrigin,
      stdout: '',
      stderr: '',
    };
  }

  let spawnError = null;
  let closed = false;
  const child = spawn(EXE_PATH, ['--start'], {
    cwd: TARGET,
    windowsHide: true,
    shell: false,
    stdio: 'ignore',
  });
  child.unref();
  child.on('error', (error) => {
    spawnError = String(error.message || error);
  });
  child.on('close', () => {
    closed = true;
  });

  const runtime = await waitForTargetRuntime(Math.min(timeoutMs, 90_000));
  if (runtime.ok) {
    const closeWaitStarted = Date.now();
    while (!closed && Date.now() - closeWaitStarted < 15_000) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  let cleanupStatus = 'not-needed';
  if (!closed) {
    cleanupStatus = 'killed-audit-launcher';
      await killSpawnedProcessTree(child.pid);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const postCleanupHealth = await probeHealth(5000);
  const postCleanupOrigin = readRuntimeOrigin();
  return {
    status: spawnError
      ? 'failed'
      : runtime.ok && postCleanupHealth.ok && postCleanupOrigin.matchesTarget
        ? 'passed'
        : 'failed',
    exitCode: spawnError ? 1 : 0,
    durationMs: Date.now() - started,
    timedOut: !runtime.ok,
    launcherPid: child.pid || null,
    launcherClosed: closed,
    cleanupStatus,
    runtime,
    postCleanupHealth,
    postCleanupOrigin,
    error: spawnError,
    stdout: '',
    stderr: '',
  };
}

function httpGetJson(url, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let text = '';
      res.on('data', chunk => { text += chunk.toString('utf8'); });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, json: JSON.parse(text), text });
        } catch {
          resolve({ statusCode: res.statusCode, json: null, text });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${url} timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
  });
}

function checkShape() {
  if (!fs.existsSync(TARGET)) {
    addFinding('P0', 'target', 'clean runtime package directory is missing', { target: TARGET });
    return;
  }
  for (const relativePath of REQUIRED_PATHS) {
    const fullPath = path.join(TARGET, relativePath);
    if (!fs.existsSync(fullPath)) addFinding('P0', 'required-path', `missing ${relativePath}`);
  }
  for (const relativePath of FORBIDDEN_SOURCE_DIRS) {
    const fullPath = path.join(TARGET, relativePath);
    if (fs.existsSync(fullPath)) addFinding('P1', 'purity', `source/governance directory should not be in clean runtime package: ${relativePath}`);
  }

  const envPath = path.join(TARGET, '.env.production');
  if (fs.existsSync(envPath)) {
    const envText = fs.readFileSync(envPath, 'utf8');
    for (const required of [
      'AILAODA_RUNTIME_DB_PATH=D:\\AilaoDaRuntime\\stable.db',
      'BACKUP_DIR=D:\\AilaoDaRuntime\\backups',
      'UPLOAD_DIR=D:\\AilaoDaRuntime\\uploads',
      'LOG_DIR=D:\\AilaoDaRuntime\\logs',
    ]) {
      if (!envText.includes(required)) addFinding('P1', 'runtime-data-policy', `.env.production missing ${required}`);
    }
  }
}

async function runCliTask(name, args, timeoutMs) {
  const result = name === 'start-from-clean-exe'
    ? await runStartExe(timeoutMs)
    : await runExe(args, timeoutMs);
  let shellReport = null;
  try {
    if (fs.existsSync(SHELL_REPORT)) shellReport = readJson(SHELL_REPORT);
  } catch (error) {
    shellReport = { parseError: String(error.message || error) };
  }
  recordTask({
    task: name,
    args,
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    timedOut: result.status === 'stuck' || Boolean(result.timedOut),
    launcherPid: result.launcherPid || null,
    launcherClosed: result.launcherClosed ?? null,
    cleanupStatus: result.cleanupStatus || null,
    runtime: result.runtime || null,
    postCleanupHealth: result.postCleanupHealth || null,
    postCleanupOrigin: result.postCleanupOrigin || null,
    shellReportStatus: shellReport?.status || null,
    shellCommand: shellReport?.command || null,
    shellPackageRoot: shellReport?.config?.packageRoot || null,
    stderr: (result.stderr || '').slice(-1200),
  });
  if (result.status !== 'passed') addFinding('P0', name, `${name} failed`, { exitCode: result.exitCode, stderr: result.stderr?.slice(-1200) });
}

function validateShellRoot() {
  if (!fs.existsSync(SHELL_REPORT)) {
    addFinding('P0', 'desktop-shell', 'desktop shell report missing after print-config/start/health');
    return;
  }
  const shellReport = readJson(SHELL_REPORT);
  const packageRoot = shellReport?.config?.packageRoot || '';
  if (normalize(packageRoot) !== normalize(TARGET)) {
    addFinding('P0', 'desktop-shell-root', 'EXE is not rooted at the clean runtime directory', { packageRoot, expected: TARGET });
  }
}

async function validateRuntimeOrigin() {
  if (!fs.existsSync(ORIGIN_REPORT)) {
    addFinding('P0', 'origin', 'stable runtime origin report missing in clean runtime package');
    return;
  }
  const origin = readJson(ORIGIN_REPORT);
  if (normalize(origin.root || '') !== normalize(TARGET)) {
    addFinding('P0', 'origin-root', 'active runtime was not launched from clean runtime package', { root: origin.root, expected: TARGET });
  }
  if (!origin.packagedMode) addFinding('P0', 'origin-mode', 'packagedMode must be true');
  if (String(origin.runtimeDbPath || '').replace(/\//g, '\\').toLowerCase() !== 'd:\\ailaodaruntime\\stable.db') {
    addFinding('P1', 'runtime-db', 'runtime DB is not the expected D drive stable DB', { runtimeDbPath: origin.runtimeDbPath });
  }
  const health = await httpGetJson('http://127.0.0.1:5001/health');
  recordTask({ task: 'http-health', status: health.statusCode === 200 && health.json?.status === 'ok' ? 'passed' : 'failed', durationMs: 0, httpStatus: health.statusCode, mode: health.json?.mode });
  if (health.statusCode !== 200 || health.json?.status !== 'ok') {
    addFinding('P0', 'health', '5001 health check failed after clean runtime start', { statusCode: health.statusCode, text: health.text?.slice(0, 200) });
  }
}

function writeReports() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const p0 = report.findings.filter(item => item.level === 'P0').length;
  report.status = p0 > 0 ? 'failed' : 'passed';
  report.finishedAt = new Date().toISOString();
  report.summary = {
    findings: report.findings.length,
    p0,
    p1: report.findings.filter(item => item.level === 'P1').length,
    tasks: report.tasks.length,
    passedTasks: report.tasks.filter(item => item.status === 'passed').length,
  };
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const lines = [
    '# Clean Runtime Package Audit',
    '',
    `- status: ${report.status}`,
    `- target: ${TARGET}`,
    `- startedAt: ${report.startedAt}`,
    `- finishedAt: ${report.finishedAt}`,
    `- findings: ${report.summary.findings}`,
    '',
    '## Tasks',
    '',
    '| task | status | durationMs |',
    '| --- | --- | ---: |',
  ];
  for (const task of report.tasks) lines.push(`| ${task.task} | ${task.status} | ${task.durationMs || 0} |`);
  lines.push('', '## Findings');
  if (report.findings.length === 0) lines.push('- none');
  for (const finding of report.findings) lines.push(`- ${finding.level} ${finding.area}: ${finding.message}`);
  fs.writeFileSync(MD_REPORT, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  checkShape();
  if (report.findings.some(item => item.level === 'P0')) {
    writeReports();
  } else {
    await runCliTask('print-config', ['--print-config'], 15_000);
    validateShellRoot();
    await runCliTask('start-from-clean-exe', ['--start'], 300_000);
    await runCliTask('health-from-clean-exe', ['--health'], 90_000);
    validateShellRoot();
    await validateRuntimeOrigin();
    writeReports();
  }
  console.log(JSON.stringify({
    status: report.status,
    summary: report.summary,
    jsonReport: toProjectPath(JSON_REPORT),
    markdownReport: toProjectPath(MD_REPORT),
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
