const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17)}-${process.pid}`;
const REPORT_PATH = path.join(OUTPUT_DIR, `stable-launcher-health-audit-v1-${RUN_ID}.json`);
const DEFAULT_CLEAN_RUNTIME_ROOT = Buffer.from('RTpc54ix5Yqz6L6+57qv5YeA57O757uf', 'base64').toString('utf8');
const CLEAN_RUNTIME_ROOT = process.env.AILAODA_CLEAN_RUNTIME_ROOT || DEFAULT_CLEAN_RUNTIME_ROOT;
const LAUNCHER = path.join(CLEAN_RUNTIME_ROOT, 'scripts', 'start-stable-v2.ps1');
const ORIGIN_REPORT = path.join(CLEAN_RUNTIME_ROOT, 'output', 'audit', 'stable-runtime-origin-v1.json');
const TIMEOUT_MS = Number(process.env.AILAODA_LAUNCHER_AUDIT_TIMEOUT_MS || 120_000);
const HEALTH_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';

const report = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  status: 'running',
  launcher: LAUNCHER,
  originReport: ORIGIN_REPORT,
  timeoutMs: TIMEOUT_MS,
  healthUrl: HEALTH_URL,
  checks: [],
};

function writeReport() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeHealth() {
  const health = await fetch('http://127.0.0.1:5001/health');
  const home = await fetch(HEALTH_URL);
  return {
    healthStatus: health.status,
    homeStatus: home.status,
    ok: health.status === 200 && home.status === 200,
  };
}

function readOriginReport(minMtimeMs = 0) {
  if (!fs.existsSync(ORIGIN_REPORT)) return null;
  const stat = fs.statSync(ORIGIN_REPORT);
  if (stat.mtimeMs < minMtimeMs) return null;
  const text = fs.readFileSync(ORIGIN_REPORT, 'utf8').replace(/^\uFEFF/, '');
  return {
    mtimeMs: stat.mtimeMs,
    data: JSON.parse(text),
  };
}

function isCleanRuntimeOrigin(origin) {
  if (!origin?.data) return false;
  const expectedRoot = path.resolve(CLEAN_RUNTIME_ROOT).toLowerCase();
  const actualRoot = path.resolve(String(origin.data.root || '')).toLowerCase();
  const runtimeDb = String(origin.data.runtimeDbPath || '').replace(/\//g, '\\').toLowerCase();
  return actualRoot === expectedRoot
    && origin.data.packagedMode === true
    && runtimeDb === 'd:\\ailaodaruntime\\stable.db';
}

async function main() {
  writeReport();
  if (!fs.existsSync(LAUNCHER)) {
    throw new Error(`launcher missing: ${LAUNCHER}`);
  }

  const startedMs = Date.now();
  try {
    const currentOrigin = readOriginReport(0);
    const currentHealth = await probeHealth();
    report.checks.push({
      at: new Date().toISOString(),
      mode: 'already-running-probe',
      originClean: isCleanRuntimeOrigin(currentOrigin),
      ...currentHealth,
    });
    if (currentOrigin && isCleanRuntimeOrigin(currentOrigin) && currentHealth.ok) {
      report.status = 'passed';
      report.finishedAt = new Date().toISOString();
      report.mode = 'already_running_clean_runtime';
      report.origin = currentOrigin.data;
      writeReport();
      console.log(JSON.stringify({
        status: report.status,
        mode: report.mode,
        backendPid: currentOrigin.data.backendPid,
        jsonReport: REPORT_PATH,
      }, null, 2));
      return;
    }
  } catch (error) {
    report.checks.push({
      at: new Date().toISOString(),
      mode: 'already-running-probe',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    LAUNCHER,
  ], {
    cwd: CLEAN_RUNTIME_ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  report.launcherPid = child.pid;
  writeReport();

  const deadline = startedMs + TIMEOUT_MS;
  let lastError = '';
  while (Date.now() < deadline) {
    await sleep(2000);
    try {
      const origin = readOriginReport(startedMs - 1000);
      const health = await probeHealth();
      report.checks.push({
        at: new Date().toISOString(),
        originFresh: Boolean(origin),
        ...health,
      });
      if (origin && health.ok) {
        report.status = 'passed';
        report.finishedAt = new Date().toISOString();
        report.origin = origin.data;
        writeReport();
        console.log(JSON.stringify({
          status: report.status,
          launcherPid: report.launcherPid,
          backendPid: origin.data.backendPid,
          jsonReport: REPORT_PATH,
        }, null, 2));
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      report.checks.push({
        at: new Date().toISOString(),
        ok: false,
        error: lastError,
      });
    }
    writeReport();
  }

  report.status = 'failed';
  report.finishedAt = new Date().toISOString();
  report.error = `stable launcher did not produce fresh origin + healthy 5001 within ${TIMEOUT_MS}ms${lastError ? `; lastError=${lastError}` : ''}`;
  writeReport();
  throw new Error(report.error);
}

main().catch((error) => {
  report.status = 'failed';
  report.finishedAt = new Date().toISOString();
  report.error = error instanceof Error ? error.message : String(error);
  writeReport();
  console.error(report.error);
  process.exit(1);
});
