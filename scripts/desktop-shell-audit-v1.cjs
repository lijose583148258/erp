const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { killSpawnedProcessTree } = require('./lib/win32-audit-process-guard.cjs');

const ROOT = process.cwd();
const PACKAGE_ROOT = path.join(ROOT, 'AilaoDa_Stable_Package');
const EXE_PATH = path.join(PACKAGE_ROOT, 'AilaoDa-ERP-CRM.exe');
const SHELL_REPORT = path.join(PACKAGE_ROOT, 'output', 'audit', 'desktop-shell-v1.json');
const RUNTIME_ORIGIN_REPORT = path.join(PACKAGE_ROOT, 'output', 'audit', 'stable-runtime-origin-v1.json');
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'desktop-shell-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'desktop-shell-audit-v1.md');

const report = {
  name: 'Desktop Shell P0 Audit',
  version: '1.0',
  startedAt: new Date().toISOString(),
  status: 'running',
  exePath: toProjectPath(EXE_PATH),
  tasks: [],
};

function toProjectPath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function record(task) {
  report.tasks.push({ at: new Date().toISOString(), ...task });
}

function readShellReport() {
  if (!fs.existsSync(SHELL_REPORT)) return null;
  return JSON.parse(fs.readFileSync(SHELL_REPORT, 'utf8').replace(/^\uFEFF/, ''));
}

function normalizePathForCompare(filePath) {
  return path.resolve(filePath || '').replace(/[\\/]+$/, '').toLowerCase();
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { parseError: String(error.message || error) };
  }
}

function readRuntimeOrigin() {
  const origin = readJsonIfExists(RUNTIME_ORIGIN_REPORT);
  const originRoot = origin?.root || null;
  return {
    report: origin,
    root: originRoot,
    matchesPackageRoot: Boolean(originRoot) && normalizePathForCompare(originRoot) === normalizePathForCompare(PACKAGE_ROOT),
  };
}

function probeHealth(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const request = http.get('http://127.0.0.1:5001/health', { timeout: timeoutMs }, (response) => {
      response.resume();
      response.on('end', () => {
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          statusCode: response.statusCode,
        });
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error(`health probe timed out after ${timeoutMs}ms`));
    });
    request.on('error', (error) => {
      resolve({
        ok: false,
        statusCode: null,
        error: String(error.message || error),
      });
    });
  });
}

async function waitForPackageRuntime(timeoutMs) {
  const started = Date.now();
  let lastHealth = null;
  let lastOrigin = null;
  while (Date.now() - started < timeoutMs) {
    lastHealth = await probeHealth(5000);
    lastOrigin = readRuntimeOrigin();
    if (lastHealth.ok && lastOrigin.matchesPackageRoot) {
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

function runExe(args, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(EXE_PATH, args, {
      cwd: PACKAGE_ROOT,
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
      resolve({
        status: 'failed',
        exitCode: null,
        durationMs: Date.now() - started,
        error: String(error.message || error),
        stdout,
        stderr,
      });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({
        status: timedOut ? 'stuck' : code === 0 ? 'passed' : 'failed',
        exitCode: code,
        durationMs: Date.now() - started,
        stdout,
        stderr,
      });
    });
  });
}

async function runStartExe(timeoutMs) {
  const started = Date.now();
  const preStartHealth = await probeHealth(5000);
  const preStartOrigin = readRuntimeOrigin();
  if (preStartHealth.ok && preStartOrigin.matchesPackageRoot) {
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
    cwd: PACKAGE_ROOT,
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

  const runtime = await waitForPackageRuntime(Math.min(timeoutMs, 90_000));
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
      : runtime.ok && postCleanupHealth.ok && postCleanupOrigin.matchesPackageRoot
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

function assertExeShape() {
  if (!fs.existsSync(EXE_PATH)) {
    record({ task: 'exe-exists', status: 'failed', message: 'desktop shell exe is missing' });
    return false;
  }
  const header = fs.readFileSync(EXE_PATH).subarray(0, 2).toString('ascii');
  const stat = fs.statSync(EXE_PATH);
  const ok = header === 'MZ' && stat.size > 8 * 1024;
  record({
    task: 'exe-shape',
    status: ok ? 'passed' : 'failed',
    header,
    bytes: stat.size,
    lastWriteTime: stat.mtime.toISOString(),
  });
  return ok;
}

async function runCliTask(name, args, timeoutMs) {
  const result = name === 'start-runtime-from-exe'
    ? await runStartExe(timeoutMs)
    : await runExe(args, timeoutMs);
  let shellReport = null;
  try {
    shellReport = readShellReport();
  } catch (error) {
    shellReport = { parseError: String(error.message || error) };
  }
  record({
    task: name,
    status: result.status,
    args,
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
    shellReportCommand: shellReport?.command || null,
    shellConfig: shellReport?.config || null,
    stderr: result.stderr.slice(-1000),
  });
  return result.status === 'passed';
}

function writeReports() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const lines = [
    '# Desktop Shell P0 Audit',
    '',
    `- status: ${report.status}`,
    `- exe: ${report.exePath}`,
    `- startedAt: ${report.startedAt}`,
    `- finishedAt: ${report.finishedAt}`,
    '',
    '## Tasks',
    '',
    '| task | status | durationMs |',
    '| --- | --- | ---: |',
  ];
  for (const task of report.tasks) {
    lines.push(`| ${task.task} | ${task.status} | ${task.durationMs || 0} |`);
  }
  fs.writeFileSync(MD_REPORT, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const exeOk = assertExeShape();
  if (exeOk) {
    await runCliTask('print-config', ['--print-config'], 15_000);
    await runCliTask('start-runtime-from-exe', ['--start'], 300_000);
    await runCliTask('health-from-exe', ['--health'], 90_000);
  }
  const passed = report.tasks.filter(task => task.status === 'passed').length;
  report.summary = {
    total: report.tasks.length,
    passed,
    failed: report.tasks.filter(task => task.status === 'failed').length,
    stuck: report.tasks.filter(task => task.status === 'stuck').length,
  };
  report.status = passed === report.tasks.length ? 'passed' : 'failed';
  report.finishedAt = new Date().toISOString();
  writeReports();
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
