const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');
const { loadRoutes, VALID_SEVERITIES } = require('./lib/isolated-playwright-routes.cjs');

const ROOT = process.cwd();
const WORKER_SCRIPT = path.join(__dirname, 'lib', 'isolated-playwright-worker.cjs');
const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const SANDBOX_TEMPLATE = (process.env.SANDBOX_RUNTIME_COMMAND || '').trim();
const AUDIT_USERNAME_MAX_LENGTH = 50;

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 15);
  const random = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${process.pid}-${random}`;
}

function parsePositiveInt(name, defaultValue, min = 1) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }
  return value;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quote(value) {
  const stringValue = String(value);
  if (process.platform === 'win32') return `"${stringValue.replace(/"/g, '\\"')}"`;
  return `'${stringValue.replace(/'/g, `'"'"'`)}'`;
}

function chunkRoutes(routes, workerCount) {
  const buckets = Array.from({ length: workerCount }, () => []);
  routes.forEach((route, index) => buckets[index % workerCount].push(route));
  return buckets.filter((bucket) => bucket.length > 0);
}

function validateSandboxTemplate(template, warnings) {
  if (!template) return;
  const hasWorkerCommand = template.includes('{workerCommand}');
  const hasConfigStyle = template.includes('{node}') &&
    template.includes('{workerScript}') &&
    template.includes('{configFile}');
  if (!hasWorkerCommand && !hasConfigStyle) {
    throw new Error(
      'SANDBOX_RUNTIME_COMMAND must include {workerCommand}, or all of {node}, {workerScript}, and {configFile}',
    );
  }
  if (!template.includes('{repo}')) warnings.push('SANDBOX_RUNTIME_COMMAND does not include {repo}');
  if (!template.includes('{output}')) warnings.push('SANDBOX_RUNTIME_COMMAND does not include {output}');

  const allowed = new Set([
    '{workerCommand}',
    '{node}',
    '{workerScript}',
    '{configFile}',
    '{repo}',
    '{output}',
    '{outputRoot}',
    '{appUrl}',
    '{workerId}',
  ]);
  for (const placeholder of template.match(/\{[^}]+\}/g) || []) {
    if (!allowed.has(placeholder)) {
      throw new Error(`SANDBOX_RUNTIME_COMMAND contains unsupported placeholder ${placeholder}`);
    }
  }
}

function applySandboxTemplate(template, vars) {
  const workerCommand = `${quote(process.execPath)} ${quote(WORKER_SCRIPT)} ${quote(vars.configFile)}`;
  return template
    .replaceAll('{workerCommand}', workerCommand)
    .replaceAll('{node}', quote(process.execPath))
    .replaceAll('{workerScript}', quote(WORKER_SCRIPT))
    .replaceAll('{configFile}', quote(vars.configFile))
    .replaceAll('{repo}', quote(ROOT))
    .replaceAll('{output}', quote(vars.outputDir))
    .replaceAll('{outputRoot}', quote(vars.outputRoot))
    .replaceAll('{appUrl}', quote(APP_URL))
    .replaceAll('{workerId}', quote(vars.workerId));
}

function auditAccountFor(workerId) {
  const rawBase = process.env.PLAYWRIGHT_USERNAME ||
    process.env.ISOLATED_PLAYWRIGHT_USERNAME ||
    'ui_isolated_parallel_admin';
  const password = process.env.PLAYWRIGHT_PASSWORD || process.env.ISOLATED_PLAYWRIGHT_PASSWORD || 'AuditSmoke12345!';
  const safeWorkerId = String(workerId).replace(/[^a-zA-Z0-9_]/g, '_');
  const suffix = `_${safeWorkerId}`;
  const safeBase = String(rawBase).replace(/[^a-zA-Z0-9_]/g, '_');
  const maxBaseLength = Math.max(1, AUDIT_USERNAME_MAX_LENGTH - suffix.length);
  return {
    username: `${safeBase.slice(0, maxBaseLength)}${suffix}`,
    password,
    role: 'admin',
    segment: 'mixed',
  };
}

function writeWorkerConfig(job) {
  const configPath = path.join(job.outputDir, 'worker-config.json');
  const config = {
    workerId: job.workerId,
    appUrl: APP_URL,
    routes: job.routes,
    outputDir: job.outputDir,
    userDataDir: path.join(job.outputDir, 'user-data'),
    screenshotsDir: path.join(job.outputDir, 'screenshots'),
    username: job.account.username,
    password: job.account.password,
    defaultViewport: { width: 1440, height: 900 },
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return configPath;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return { value: null, error: 'report not written' };
  try {
    return { value: JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')), error: null };
  } catch (error) {
    return { value: null, error: String(error.message || error) };
  }
}

function runWorker(job, settings) {
  return new Promise((resolve) => {
    ensureDir(job.outputDir);
    ensureDir(job.screenshotsDir);
    const configFile = writeWorkerConfig(job);
    const stdoutPath = path.join(job.outputDir, 'stdout.log');
    const stderrPath = path.join(job.outputDir, 'stderr.log');
    const stdout = fs.createWriteStream(stdoutPath);
    const stderr = fs.createWriteStream(stderrPath);
    const startedAt = Date.now();
    let settled = false;
    let timedOut = false;
    let child = null;
    let killTimer = null;

    function settle(result) {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      stdout.end();
      stderr.end();
      resolve(result);
    }

    const env = {
      ...process.env,
      ISOLATED_PLAYWRIGHT_CONFIG_FILE: configFile,
      ISOLATED_PLAYWRIGHT_OUTPUT_DIR: job.outputDir,
    };
    const spawnOptions = { cwd: ROOT, env, windowsHide: true };
    if (SANDBOX_TEMPLATE) {
      const command = applySandboxTemplate(SANDBOX_TEMPLATE, {
        configFile,
        outputDir: job.outputDir,
        outputRoot: settings.outputRoot,
        workerId: job.workerId,
      });
      child = spawn(command, { ...spawnOptions, shell: true });
    } else {
      child = spawn(process.execPath, [WORKER_SCRIPT, configFile], spawnOptions);
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {}
      killTimer = setTimeout(() => {
        if (!settled) {
          try {
            child.kill('SIGKILL');
          } catch {}
        }
      }, 3000);
    }, settings.workerTimeoutMs);

    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    child.on('error', (error) => {
      clearTimeout(timeout);
      settle({
        workerId: job.workerId,
        status: 'failed',
        error: String(error.message || error),
        timedOut,
        durationMs: Date.now() - startedAt,
        stdoutPath,
        stderrPath,
        outputDir: job.outputDir,
        reportPath: path.join(job.outputDir, 'report.json'),
      });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      const reportPath = path.join(job.outputDir, 'report.json');
      const parsed = readJson(reportPath);
      const reportPassed = parsed.value?.status === 'passed';
      const exitWarning = reportPassed && code !== 0
        ? `worker exited with code ${code} after writing a passed report`
        : null;
      settle({
        workerId: job.workerId,
        status: !timedOut && code === 0 && reportPassed ? 'passed' : 'failed',
        code,
        signal: signal || null,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdoutPath,
        stderrPath,
        outputDir: job.outputDir,
        configFile,
        reportPath,
        report: parsed.value,
        reportError: parsed.error,
        exitWarning,
        error: timedOut
          ? `worker timeout after ${settings.workerTimeoutMs}ms`
          : parsed.error || parsed.value?.error || exitWarning,
      });
    });
  });
}

function emptySeverityCounts() {
  return Object.fromEntries(Array.from(VALID_SEVERITIES).map((severity) => [severity, 0]));
}

function summarize(workers) {
  const routes = [];
  const findingsBySeverity = emptySeverityCounts();
  const failures = [];

  for (const worker of workers) {
    const routeReports = Array.isArray(worker.report?.routes) ? worker.report.routes : [];
    for (const route of routeReports) {
      const routeWithWorker = { ...route, workerId: worker.workerId };
      routes.push(routeWithWorker);
      if (route.status !== 'passed') {
        findingsBySeverity[route.severity] = (findingsBySeverity[route.severity] || 0) + 1;
        failures.push({
          workerId: worker.workerId,
          routeId: route.id,
          severity: route.severity,
          message: route.error || 'route failed',
          screenshot: route.screenshot,
        });
      }
      const errorLikeFindings = [
        ...(route.pageErrors || []),
        ...(route.httpFailures || []),
        ...(route.failedRequests || []),
      ];
      if (errorLikeFindings.length > 0) {
        findingsBySeverity[route.severity] = (findingsBySeverity[route.severity] || 0) + errorLikeFindings.length;
      }
    }

    if (worker.status !== 'passed') {
      failures.push({
        workerId: worker.workerId,
        severity: 'blocker',
        message: worker.error || `worker ${worker.workerId} failed`,
      });
      findingsBySeverity.blocker += 1;
    }
  }

  const routeFailures = routes.filter((route) => route.status !== 'passed');
  const blockingRouteFailures = routeFailures.filter((route) => ['error', 'blocker'].includes(route.severity));
  const workerFailures = workers.filter((worker) => worker.status !== 'passed');
  return { routes, findingsBySeverity, failures, routeFailures, blockingRouteFailures, workerFailures };
}

function writeAggregateReport(outputRoot, report) {
  ensureDir(outputRoot);
  const reportPath = path.join(outputRoot, 'parallel-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return reportPath;
}

async function main() {
  const warnings = [];
  validateSandboxTemplate(SANDBOX_TEMPLATE, warnings);

  const loaded = loadRoutes({ repoRoot: ROOT });
  const routes = loaded.routes;
  const defaultWorkerCount = Math.max(1, Math.min(4, routes.length));
  const requestedWorkers = parsePositiveInt('ISOLATED_PLAYWRIGHT_WORKERS', defaultWorkerCount);
  const workerCount = Math.max(1, Math.min(requestedWorkers, routes.length));
  const workerTimeoutMs = parsePositiveInt(
    'ISOLATED_PLAYWRIGHT_WORKER_TIMEOUT_MS',
    Math.max(60000, routes.length * 30000),
  );
  const startStaggerMs = parsePositiveInt('ISOLATED_PLAYWRIGHT_WORKER_START_STAGGER_MS', 3000, 0);
  const runId = process.env.ISOLATED_PLAYWRIGHT_RUN_ID || createRunId();
  const defaultOutputRoot = path.join(ROOT, 'output', 'playwright', 'isolated-parallel', runId);
  const outputRoot = path.resolve(process.env.ISOLATED_PLAYWRIGHT_OUTPUT_ROOT || defaultOutputRoot);
  ensureDir(outputRoot);

  const buckets = chunkRoutes(routes, workerCount);
  const jobs = buckets.map((bucket, index) => {
    const workerId = `worker-${index + 1}`;
    const outputDir = path.join(outputRoot, workerId);
    const account = auditAccountFor(workerId);
    return {
      workerId,
      routes: bucket,
      outputDir,
      screenshotsDir: path.join(outputDir, 'screenshots'),
      account,
      startDelayMs: index * startStaggerMs,
    };
  });

  for (const job of jobs) {
    await ensureUiAuditUser(job.account);
  }

  const workers = await Promise.all(jobs.map(async (job) => {
    if (job.startDelayMs) await delay(job.startDelayMs);
    return runWorker(job, { outputRoot, workerTimeoutMs });
  }));

  const summary = summarize(workers);
  const aggregate = {
    schemaVersion: 1,
    runId,
    startedAt: new Date(Date.now() - Math.max(...workers.map((worker) => worker.durationMs), 0)).toISOString(),
    finishedAt: new Date().toISOString(),
    appUrl: APP_URL,
    routesFile: path.relative(ROOT, loaded.routesFile).replace(/\\/g, '/'),
    workerCount: jobs.length,
    workerTimeoutMs,
    sandboxRuntimeEnabled: Boolean(SANDBOX_TEMPLATE),
    warnings,
    status: summary.workerFailures.length || summary.blockingRouteFailures.length ? 'failed' : 'passed',
    summary: {
      routesTotal: routes.length,
      routesPassed: summary.routes.filter((route) => route.status === 'passed').length,
      routesFailed: summary.routeFailures.length,
      workersPassed: workers.filter((worker) => worker.status === 'passed').length,
      workersFailed: summary.workerFailures.length,
      findingsBySeverity: summary.findingsBySeverity,
    },
    workers: workers.map((worker) => ({
      workerId: worker.workerId,
      status: worker.status,
      code: worker.code,
      signal: worker.signal,
      timedOut: worker.timedOut,
      durationMs: worker.durationMs,
      routes: Array.isArray(worker.report?.routes) ? worker.report.routes.map((route) => route.id) : [],
      outputDir: worker.outputDir,
      reportPath: worker.reportPath,
      stdoutPath: worker.stdoutPath,
      stderrPath: worker.stderrPath,
      error: worker.error,
      exitWarning: worker.exitWarning,
    })),
    routes: summary.routes,
    failures: summary.failures,
  };
  const reportPath = writeAggregateReport(outputRoot, aggregate);

  if (aggregate.status !== 'passed') {
    console.error(`Parallel isolated Playwright audit failed. Report: ${reportPath}`);
    process.exit(1);
  }
  console.log(`Parallel isolated Playwright audit passed. Report: ${reportPath}`);
}

main().catch((error) => {
  const runId = process.env.ISOLATED_PLAYWRIGHT_RUN_ID || createRunId();
  const defaultOutputRoot = path.join(ROOT, 'output', 'playwright', 'isolated-parallel', runId);
  const outputRoot = path.resolve(process.env.ISOLATED_PLAYWRIGHT_OUTPUT_ROOT || defaultOutputRoot);
  const report = {
    schemaVersion: 1,
    runId,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    appUrl: APP_URL,
    routesFile: process.env.ISOLATED_PLAYWRIGHT_ROUTES_FILE || 'scripts/lib/isolated-playwright-routes.cjs',
    workerCount: 0,
    sandboxRuntimeEnabled: Boolean(SANDBOX_TEMPLATE),
    status: 'failed',
    summary: {
      routesTotal: 0,
      routesPassed: 0,
      routesFailed: 0,
      workersPassed: 0,
      workersFailed: 0,
      findingsBySeverity: emptySeverityCounts(),
    },
    workers: [],
    failures: [{ severity: 'blocker', message: String(error.message || error) }],
  };
  const reportPath = writeAggregateReport(outputRoot, report);
  console.error(`Parallel isolated Playwright audit failed. Report: ${reportPath}`);
  console.error(error.message || error);
  process.exit(1);
});
