const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ROUTES } = require('./lib/isolated-playwright-routes.cjs');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');

function parsePositiveInt(name, defaultValue) {
  const value = Number(process.env[name] || defaultValue);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : defaultValue;
}

function defaultWorkerCount() {
  const cpuCount = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.min(cpuCount || 2, 2);
}

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const RUN_ID = process.env.ISOLATED_PLAYWRIGHT_RUN_ID || new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const OUTPUT_ROOT = path.resolve(process.env.ISOLATED_PLAYWRIGHT_OUTPUT_ROOT || path.join(process.cwd(), 'output', 'playwright', 'isolated-parallel', RUN_ID));
const MAX_WORKERS = Math.max(1, Math.min(parsePositiveInt('ISOLATED_PLAYWRIGHT_WORKERS', defaultWorkerCount()), ROUTES.length));
const WORKER_SCRIPT = path.join(__dirname, 'lib', 'isolated-playwright-worker.cjs');
const SANDBOX_TEMPLATE = (process.env.SANDBOX_RUNTIME_COMMAND || '').trim();
const AUDIT_ACCOUNT = {
  username: process.env.ISOLATED_PLAYWRIGHT_USERNAME || 'ui_isolated_parallel_admin',
  password: process.env.ISOLATED_PLAYWRIGHT_PASSWORD || 'AuditSmoke12345!',
  role: 'admin',
};

const report = {
  runId: RUN_ID,
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  outputRoot: OUTPUT_ROOT,
  maxWorkers: MAX_WORKERS,
  sandboxRuntimeEnabled: Boolean(SANDBOX_TEMPLATE),
  workers: [],
  routes: [],
  status: 'running',
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function chunkRoutes(routes, count) {
  const buckets = Array.from({ length: count }, () => []);
  routes.forEach((route, index) => buckets[index % count].push(route));
  return buckets.filter((bucket) => bucket.length > 0);
}

function shellQuote(value) {
  const stringValue = String(value);
  if (process.platform === 'win32') return `"${stringValue.replace(/"/g, '\\"')}"`;
  return `'${stringValue.replace(/'/g, `'"'"'`)}'`;
}

function buildWorkerEnv(workerId, routes, outputDir) {
  return {
    ...process.env,
    ISOLATED_PLAYWRIGHT_WORKER_ID: workerId,
    ISOLATED_PLAYWRIGHT_USERNAME: AUDIT_ACCOUNT.username,
    ISOLATED_PLAYWRIGHT_PASSWORD: AUDIT_ACCOUNT.password,
    ISOLATED_PLAYWRIGHT_WORKER_CONFIG: JSON.stringify({
      workerId,
      appUrl: APP_URL,
      outputDir,
      routes,
      username: AUDIT_ACCOUNT.username,
      password: AUDIT_ACCOUNT.password,
    }),
  };
}

function applySandboxTemplate(template, vars) {
  return template
    .replaceAll('{node}', shellQuote(process.execPath))
    .replaceAll('{workerScript}', shellQuote(WORKER_SCRIPT))
    .replaceAll('{workerCommand}', `${shellQuote(process.execPath)} ${shellQuote(WORKER_SCRIPT)}`)
    .replaceAll('{repo}', shellQuote(process.cwd()))
    .replaceAll('{output}', shellQuote(vars.outputDir))
    .replaceAll('{outputRoot}', shellQuote(OUTPUT_ROOT))
    .replaceAll('{appUrl}', shellQuote(APP_URL))
    .replaceAll('{workerId}', shellQuote(vars.workerId));
}

function readWorkerReport(workerReportPath) {
  if (!fs.existsSync(workerReportPath)) return { report: null, parseError: null };
  try {
    return { report: JSON.parse(fs.readFileSync(workerReportPath, 'utf8')), parseError: null };
  } catch (error) {
    return { report: null, parseError: String(error.message || error) };
  }
}

function runWorker({ workerId, routes, outputDir }) {
  return new Promise((resolve) => {
    ensureDir(outputDir);
    const env = buildWorkerEnv(workerId, routes, outputDir);
    const stdoutPath = path.join(outputDir, 'stdout.log');
    const stderrPath = path.join(outputDir, 'stderr.log');
    const stdout = fs.createWriteStream(stdoutPath);
    const stderr = fs.createWriteStream(stderrPath);
    const startedAt = Date.now();
    let settled = false;

    function settle(result) {
      if (settled) return;
      settled = true;
      stdout.end();
      stderr.end();
      resolve(result);
    }

    const spawnOptions = {
      cwd: process.cwd(),
      env,
      windowsHide: true,
    };
    const child = SANDBOX_TEMPLATE
      ? spawn(applySandboxTemplate(SANDBOX_TEMPLATE, { workerId, outputDir }), { ...spawnOptions, shell: true })
      : spawn(process.execPath, [WORKER_SCRIPT], spawnOptions);

    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    child.on('error', (error) => {
      settle({
        workerId,
        routes: routes.map((route) => route.id),
        status: 'failed',
        error: String(error.message || error),
        durationMs: Date.now() - startedAt,
        stdoutPath,
        stderrPath,
        outputDir,
      });
    });
    child.on('exit', (code, signal) => {
      const workerReportPath = path.join(outputDir, 'report.json');
      const { report: workerReport, parseError } = readWorkerReport(workerReportPath);
      settle({
        workerId,
        routes: routes.map((route) => route.id),
        status: code === 0 && workerReport && workerReport.status === 'passed' ? 'passed' : 'failed',
        code,
        signal: signal || null,
        durationMs: Date.now() - startedAt,
        stdoutPath,
        stderrPath,
        outputDir,
        reportPath: workerReportPath,
        report: workerReport,
        reportParseError: parseError,
      });
    });
  });
}

function summarize(workers) {
  const routes = [];
  for (const worker of workers) {
    const routeReports = Array.isArray(worker.report && worker.report.routes) ? worker.report.routes : [];
    for (const route of routeReports) routes.push({ ...route, workerId: worker.workerId });
  }
  const failedRoutes = routes.filter((route) => route.status !== 'passed');
  const failedWorkers = workers.filter((worker) => worker.status !== 'passed');
  return { routes, failedRoutes, failedWorkers };
}

function writeReport() {
  ensureDir(OUTPUT_ROOT);
  const reportPath = path.join(OUTPUT_ROOT, 'parallel-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return reportPath;
}

async function run() {
  ensureDir(OUTPUT_ROOT);
  await ensureUiAuditUser(AUDIT_ACCOUNT);
  const buckets = chunkRoutes(ROUTES, MAX_WORKERS);
  const workerJobs = buckets.map((routes, index) => ({
    workerId: `worker-${index + 1}`,
    routes,
    outputDir: path.join(OUTPUT_ROOT, `worker-${index + 1}`),
  }));

  const workers = await Promise.all(workerJobs.map(runWorker));
  const summary = summarize(workers);
  report.workers = workers.map((worker) => ({
    workerId: worker.workerId,
    status: worker.status,
    code: worker.code,
    signal: worker.signal,
    durationMs: worker.durationMs,
    routes: worker.routes,
    outputDir: worker.outputDir,
    reportPath: worker.reportPath,
    stdoutPath: worker.stdoutPath,
    stderrPath: worker.stderrPath,
    error: worker.error || worker.reportParseError || (worker.report && worker.report.error) || null,
  }));
  report.routes = summary.routes;
  report.failedRoutes = summary.failedRoutes;
  report.status = summary.failedWorkers.length || summary.failedRoutes.length ? 'failed' : 'passed';
  report.finishedAt = new Date().toISOString();
  const reportPath = writeReport();

  if (report.status !== 'passed') {
    console.error(`Parallel isolated Playwright audit failed. Report: ${reportPath}`);
    process.exit(1);
  }
  console.log(`Parallel isolated Playwright audit passed. Report: ${reportPath}`);
}

run().catch((error) => {
  report.status = 'failed';
  report.error = String(error.message || error);
  report.finishedAt = new Date().toISOString();
  const reportPath = writeReport();
  console.error(`Parallel isolated Playwright audit failed. Report: ${reportPath}`);
  console.error(report.error);
  process.exit(1);
});
