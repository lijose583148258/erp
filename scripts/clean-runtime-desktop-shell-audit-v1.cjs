const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { killSpawnedProcessTree } = require('./lib/win32-audit-process-guard.cjs');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const DEFAULT_CLEAN_ROOT = Buffer.from('RTpc54ix5Yqz6L6+57qv5YeA57O757uf', 'base64').toString('utf8');
const CLEAN_ROOT = process.env.AILAODA_CLEAN_RUNTIME_ROOT || DEFAULT_CLEAN_ROOT;
const EXE_PATH = path.join(CLEAN_ROOT, 'AilaoDa-ERP-CRM.exe');
const SHELL_REPORT = path.join(CLEAN_ROOT, 'output', 'audit', 'desktop-shell-v1.json');
const RUNTIME_ORIGIN_REPORT = path.join(CLEAN_ROOT, 'output', 'audit', 'stable-runtime-origin-v1.json');
const JSON_REPORT = path.join(OUTPUT_DIR, 'clean-runtime-desktop-shell-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'clean-runtime-desktop-shell-audit-v1.md');
const RUNTIME_HEALTH_URL = process.env.AILAODA_RUNTIME_HEALTH_URL || 'http://127.0.0.1:5001/health';

const report = {
  name: 'Clean Runtime Desktop Shell Audit',
  version: '1.0',
  startedAt: new Date().toISOString(),
  status: 'running',
  cleanRoot: CLEAN_ROOT,
  exePath: EXE_PATH,
  tasks: [],
};

function record(task) {
  report.tasks.push({ at: new Date().toISOString(), ...task });
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { parseError: String(error.message || error) };
  }
}

function normalizePathForCompare(filePath) {
  return path.resolve(filePath || '').replace(/[\\/]+$/, '').toLowerCase();
}

function readRuntimeOrigin() {
  const origin = readJsonIfExists(RUNTIME_ORIGIN_REPORT);
  const originRoot = origin?.root || null;
  return {
    report: origin,
    root: originRoot,
    matchesCleanRoot: Boolean(originRoot) && normalizePathForCompare(originRoot) === normalizePathForCompare(CLEAN_ROOT),
  };
}

function probeHealth(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const request = http.get(RUNTIME_HEALTH_URL, { timeout: timeoutMs }, (response) => {
      response.resume();
      response.on('end', () => {
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          statusCode: response.statusCode,
          durationMs: Date.now() - started,
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
        durationMs: Date.now() - started,
        error: String(error.message || error),
      });
    });
  });
}

async function waitForHealthy(timeoutMs) {
  const started = Date.now();
  let lastProbe = null;
  let lastOrigin = null;
  while (Date.now() - started < timeoutMs) {
    lastProbe = await probeHealth(5000);
    lastOrigin = readRuntimeOrigin();
    if (lastProbe.ok && lastOrigin.matchesCleanRoot) {
      return {
        ok: true,
        durationMs: Date.now() - started,
        probe: lastProbe,
        origin: lastOrigin,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return {
    ok: false,
    durationMs: Date.now() - started,
    probe: lastProbe,
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
      cwd: CLEAN_ROOT,
      windowsHide: true,
      shell: false,
    });
    const timer = setTimeout(async () => {
      timedOut = true;
        await killSpawnedProcessTree(child.pid);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
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
    child.on('close', (code) => {
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
  if (preStartHealth.ok && preStartOrigin.matchesCleanRoot) {
    return {
      status: 'passed',
      exitCode: 0,
      durationMs: Date.now() - started,
      timedOut: false,
      launcherPid: null,
      launcherClosed: true,
      cleanupStatus: 'skipped-runtime-already-healthy',
      health: {
        ok: true,
        durationMs: Date.now() - started,
        probe: preStartHealth,
        origin: preStartOrigin,
      },
      postCleanupHealth: preStartHealth,
      postCleanupOrigin: preStartOrigin,
      error: null,
      stdout: '',
      stderr: '',
    };
  }

  let stdout = '';
  let stderr = '';
  let spawnError = null;
  let closed = false;
  const child = spawn(EXE_PATH, ['--start'], {
    cwd: CLEAN_ROOT,
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

  const health = await waitForHealthy(Math.min(timeoutMs, 90_000));
  if (health.ok) {
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
      : health.ok && postCleanupHealth.ok && postCleanupOrigin.matchesCleanRoot
        ? 'passed'
        : 'failed',
    exitCode: spawnError ? 1 : 0,
    durationMs: Date.now() - started,
    timedOut: !health.ok,
    launcherPid: child.pid || null,
    launcherClosed: closed,
    cleanupStatus,
    health,
    postCleanupHealth,
    postCleanupOrigin,
    error: spawnError,
    stdout,
    stderr,
  };
}

function assertExeShape() {
  if (!fs.existsSync(EXE_PATH)) {
    record({ task: 'exe-exists', status: 'failed', message: 'clean runtime desktop shell exe is missing' });
    return false;
  }
  const buffer = fs.readFileSync(EXE_PATH);
  const stat = fs.statSync(EXE_PATH);
  const header = buffer.subarray(0, 2).toString('ascii');
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
  const result = name === 'start-runtime-from-clean-exe'
    ? await runStartExe(timeoutMs)
    : await runExe(args, timeoutMs);
  const shellReport = readJsonIfExists(SHELL_REPORT);
  const shellRoot = shellReport?.config?.packageRoot || null;
  const rootMatches = shellRoot === CLEAN_ROOT;
  const status = result.status === 'passed' && (!shellRoot || rootMatches) ? 'passed' : 'failed';
  record({
    task: name,
    status,
    args,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    timedOut: result.status === 'stuck' || Boolean(result.timedOut),
    launcherPid: result.launcherPid || null,
    launcherClosed: result.launcherClosed ?? null,
    cleanupStatus: result.cleanupStatus || null,
    startVerifiedBy: name === 'start-runtime-from-clean-exe' ? 'runtime-health-probe' : null,
    runtimeHealth: result.health || null,
    postCleanupHealth: result.postCleanupHealth || null,
    postCleanupOrigin: result.postCleanupOrigin || null,
    shellReportStatus: shellReport?.status || null,
    shellReportCommand: shellReport?.command || null,
    shellPackageRoot: shellRoot,
    shellPackageRootMatchesCleanRoot: rootMatches,
    error: result.error || null,
    stderr: result.stderr.slice(-1000),
  });
  return status === 'passed';
}

function writeReports() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const lines = [
    '# Clean Runtime Desktop Shell Audit',
    '',
    `- status: ${report.status}`,
    `- cleanRoot: ${report.cleanRoot}`,
    `- exePath: ${report.exePath}`,
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
    await runCliTask('print-config-from-clean-exe', ['--print-config'], 15_000);
    await runCliTask('start-runtime-from-clean-exe', ['--start'], 300_000);
    await runCliTask('health-from-clean-exe', ['--health'], 90_000);
  }
  const passed = report.tasks.filter((task) => task.status === 'passed').length;
  report.summary = {
    total: report.tasks.length,
    passed,
    failed: report.tasks.filter((task) => task.status === 'failed').length,
    stuck: report.tasks.filter((task) => task.status === 'stuck').length,
  };
  report.status = passed === report.tasks.length ? 'passed' : 'failed';
  report.finishedAt = new Date().toISOString();
  writeReports();
  console.log(JSON.stringify({
    status: report.status,
    summary: report.summary,
    jsonReport: path.relative(ROOT, JSON_REPORT).split(path.sep).join('/'),
    markdownReport: path.relative(ROOT, MD_REPORT).split(path.sep).join('/'),
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
