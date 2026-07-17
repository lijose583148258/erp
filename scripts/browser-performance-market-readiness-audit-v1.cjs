const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchBrowserWithGuard } = require('./lib/browser-launch-guard.cjs');
const { loginUiAuditUser } = require('./lib/ui-audit-user.cjs');

const DEFAULT_ROUTES = ['#dashboard', '#crm', '#orders', '#warehouse', '#procurement', '#financeAnalytics', '#audit'];
const DEFAULT_VIEWPORTS = [
  { id: 'desktop-lg', width: 1440, height: 900, kind: 'desktop' },
  { id: 'mobile-md', width: 390, height: 844, kind: 'mobile' },
];

function parseIntEnv(name, defaultValue, min = 1) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) throw new Error(`${name} must be an integer >= ${min}`);
  return value;
}

function normalizeRoute(value) {
  const route = String(value || '').trim();
  if (!route) return '';
  if (route.startsWith('#/')) return `#${route.slice(2)}`;
  if (route.startsWith('#')) return route;
  if (route.startsWith('/#')) return route.slice(1);
  if (route.startsWith('/')) return `#${route}`;
  return `#${route}`;
}

function parseRoutes() {
  return [...new Set((process.env.PERF_AUDIT_ROUTES || DEFAULT_ROUTES.join(','))
    .split(',')
    .map(normalizeRoute)
    .filter(Boolean))];
}

function parseViewports() {
  const raw = process.env.PERF_AUDIT_VIEWPORTS;
  if (!raw) return DEFAULT_VIEWPORTS;
  return raw.split(',').map((item) => {
    const match = item.trim().match(/^(\d+)x(\d+)$/i);
    if (!match) throw new Error(`Invalid PERF_AUDIT_VIEWPORTS item: ${item}`);
    const width = Number(match[1]);
    const height = Number(match[2]);
    return {
      id: `${width}x${height}`,
      width,
      height,
      kind: width <= 600 ? 'mobile' : 'desktop',
    };
  });
}

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);
  return `${stamp}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeName(value) {
  return String(value || 'root')
    .replace(/^#\/?/, '')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '') || 'root';
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function addFinding(report, finding) {
  report.findings.push({
    severity: finding.severity || 'warning',
    code: finding.code,
    message: finding.message,
    route: finding.route || '',
    viewport: finding.viewport || '',
    repeat: finding.repeat || 1,
    details: finding.details || {},
  });
}

function routeThresholds(kind) {
  if (kind === 'mobile') {
    return { settleError: 8000, loadError: 6000, bytesWarning: 10 * 1024 * 1024, bytesError: 18 * 1024 * 1024 };
  }
  return { settleError: 5000, loadError: 4000, bytesWarning: 8 * 1024 * 1024, bytesError: 15 * 1024 * 1024 };
}

async function waitForSettled(page, timeoutMs) {
  await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 6000) }).catch(() => {});
  await page.waitForTimeout(250);
}

async function waitForRouteReady(page, route, timeoutMs) {
  await page.waitForFunction((expectedRoute) => {
    const text = document.body?.innerText || '';
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const blockingLoading = Array.from(document.body.querySelectorAll('*')).some((node) => {
      const nodeText = (node.textContent || '').trim();
      return visible(node) && /^(正在加载|Loading)\.{0,3}$/i.test(nodeText);
    });
    if (document.querySelector('input[type="password"]')) return true;
    if (window.location.hash !== expectedRoute) return false;
    if (blockingLoading) return false;
    return text.trim().length > 100;
  }, route, { timeout: Math.min(timeoutMs, 10000) }).catch(() => {});
}

async function readPerformance(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByType('paint');
    const fcp = paint.find((entry) => entry.name === 'first-contentful-paint');
    const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
    const bodyText = (document.body?.innerText || '').trim();
    const visibleHeadingText = Array.from(document.querySelectorAll('h1,h2,h3'))
      .map((node) => (node.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 8);
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const blockingLoading = Array.from(document.body.querySelectorAll('*')).some((node) => {
      const nodeText = (node.textContent || '').trim();
      return visible(node) && /^(正在加载|Loading)\.{0,3}$/i.test(nodeText);
    });
    return {
      navigationDurationMs: nav ? Math.round(nav.duration) : 0,
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : 0,
      loadEventMs: nav ? Math.round(nav.loadEventEnd) : 0,
      firstContentfulPaintMs: fcp ? Math.round(fcp.startTime) : null,
      largestContentfulPaintMs: lcpEntries.length ? Math.round(lcpEntries[lcpEntries.length - 1].startTime) : null,
      jsHeapUsedBytes: performance.memory ? Math.round(performance.memory.usedJSHeapSize) : null,
      documentScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      bodyTextLength: bodyText.length,
      isRouteLoading: blockingLoading,
      passwordInputCount: document.querySelectorAll('input[type="password"]').length,
      visibleHeadingText,
      title: document.title,
      hash: window.location.hash,
    };
  });
}

async function ensureAuthenticatedShell(page, config) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs });
  await waitForSettled(page, config.pageTimeoutMs);
  const state = await page.evaluate(() => ({
    token: window.localStorage.getItem('token'),
    user: window.localStorage.getItem('user'),
    passwordInputCount: document.querySelectorAll('input[type="password"]').length,
    bodyText: (document.body?.innerText || '').slice(0, 400),
  }));
  if (!state.token || !state.user) {
    throw new Error('Performance audit login did not persist token/user in localStorage');
  }
  if (state.passwordInputCount > 0) {
    throw new Error('Performance audit is still on the login page after API login and reload');
  }
}

async function auditOne(page, run, route, viewport, repeat) {
  const requests = new Map();
  const failedRequests = [];
  const consoleErrors = [];
  const slowRequests = [];
  const startedAt = Date.now();

  const onRequest = (request) => {
    requests.set(request, { url: request.url(), method: request.method(), startedAt: Date.now(), bytes: 0 });
  };
  const onRequestFailed = (request) => {
    const tracked = requests.get(request);
    failedRequests.push({ url: request.url(), failure: request.failure()?.errorText || 'request failed', durationMs: tracked ? Date.now() - tracked.startedAt : null });
  };
  const onResponse = async (response) => {
    const tracked = requests.get(response.request());
    if (!tracked) return;
    tracked.status = response.status();
    tracked.resourceType = response.request().resourceType();
    tracked.durationMs = Date.now() - tracked.startedAt;
    const length = Number(response.headers()['content-length'] || 0);
    tracked.bytes = Number.isFinite(length) ? length : 0;
    if (tracked.status >= 400) failedRequests.push({ url: tracked.url, status: tracked.status, durationMs: tracked.durationMs });
    if (/\/api\//.test(tracked.url) && tracked.durationMs > 2000) {
      slowRequests.push({ url: tracked.url, status: tracked.status, durationMs: tracked.durationMs });
    }
  };
  const onConsole = (message) => {
    if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() });
  };

  page.on('request', onRequest);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  page.on('console', onConsole);

  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${run.config.appUrl.replace(/\/?$/, '/')}${route}`, { waitUntil: 'domcontentloaded', timeout: run.config.pageTimeoutMs });
    await waitForSettled(page, run.config.pageTimeoutMs);
    await waitForRouteReady(page, route, run.config.pageTimeoutMs);
    const settledMs = Date.now() - startedAt;
    const perf = await readPerformance(page);
    const screenshotRelative = path.join('screenshots', safeName(route), viewport.id, `repeat-${repeat}.png`);
    const screenshotPath = path.join(run.root, screenshotRelative);
    ensureDir(path.dirname(screenshotPath));
    await page.screenshot({ path: screenshotPath, fullPage: false });

    const transferredBytes = Array.from(requests.values()).reduce((sum, item) => sum + (item.bytes || 0), 0);
    const result = {
      route,
      viewport: viewport.id,
      viewportKind: viewport.kind,
      repeat,
      requestedHash: route,
      actualHash: perf.hash,
      title: perf.title,
      settleMs: settledMs,
      transferredBytes,
      failedRequests,
      consoleErrors,
      slowRequests,
      screenshot: screenshotPath,
      ...perf,
    };
    run.report.results.push(result);

    const thresholds = routeThresholds(viewport.kind);
    if (perf.passwordInputCount > 0) addFinding(run.report, { severity: 'error', code: 'LOGIN_PAGE_RENDERED', message: 'Route audit rendered the login page instead of the authenticated business shell', route, viewport: viewport.id, repeat, details: { headings: perf.visibleHeadingText } });
    if (perf.isRouteLoading) addFinding(run.report, { severity: 'error', code: 'ROUTE_STILL_LOADING', message: 'Route was still showing a loading state when audited', route, viewport: viewport.id, repeat, details: { headings: perf.visibleHeadingText } });
    if (perf.hash !== route) addFinding(run.report, { severity: 'error', code: 'ROUTE_HASH_MISMATCH', message: `Expected ${route} but browser hash is ${perf.hash || '(empty)'}`, route, viewport: viewport.id, repeat });
    if (!perf.bodyTextLength) addFinding(run.report, { severity: 'error', code: 'EMPTY_PAGE_TEXT', message: 'Route rendered no visible body text', route, viewport: viewport.id, repeat });
    if (settledMs > thresholds.settleError) addFinding(run.report, { severity: 'error', code: 'ROUTE_SETTLE_TOO_SLOW', message: `Route settle time ${settledMs}ms exceeded ${thresholds.settleError}ms`, route, viewport: viewport.id, repeat });
    if (perf.loadEventMs > thresholds.loadError) addFinding(run.report, { severity: 'error', code: 'LOAD_EVENT_TOO_SLOW', message: `Load event ${perf.loadEventMs}ms exceeded ${thresholds.loadError}ms`, route, viewport: viewport.id, repeat });
    if (failedRequests.length) addFinding(run.report, { severity: 'error', code: 'FAILED_REQUESTS', message: `${failedRequests.length} failed requests`, route, viewport: viewport.id, repeat, details: { failedRequests: failedRequests.slice(0, 10) } });
    if (consoleErrors.length) addFinding(run.report, { severity: 'error', code: 'CONSOLE_ERRORS', message: `${consoleErrors.length} console errors`, route, viewport: viewport.id, repeat, details: { consoleErrors: consoleErrors.slice(0, 10) } });
    if (transferredBytes > thresholds.bytesError) addFinding(run.report, { severity: 'error', code: 'TRANSFER_BYTES_TOO_HIGH', message: `Transferred bytes ${transferredBytes} exceeded ${thresholds.bytesError}`, route, viewport: viewport.id, repeat });
    else if (transferredBytes > thresholds.bytesWarning) addFinding(run.report, { severity: 'warning', code: 'TRANSFER_BYTES_HIGH', message: `Transferred bytes ${transferredBytes} exceeded ${thresholds.bytesWarning}`, route, viewport: viewport.id, repeat });
    for (const slow of slowRequests) {
      if (slow.durationMs > 8000) addFinding(run.report, { severity: 'error', code: 'API_REQUEST_VERY_SLOW', message: `API request exceeded 8000ms: ${slow.durationMs}ms`, route, viewport: viewport.id, repeat, details: slow });
      else if (slow.durationMs > 3000) addFinding(run.report, { severity: 'warning', code: 'API_REQUEST_SLOW', message: `API request exceeded 3000ms: ${slow.durationMs}ms`, route, viewport: viewport.id, repeat, details: slow });
    }
  } finally {
    page.off('request', onRequest);
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);
    page.off('console', onConsole);
  }
}

function summarize(report) {
  const groups = new Map();
  for (const result of report.results) {
    const key = `${result.route} ${result.viewport}`;
    const group = groups.get(key) || { route: result.route, viewport: result.viewport, samples: 0, settleMs: [], loadEventMs: [], transferredBytes: [] };
    group.samples += 1;
    group.settleMs.push(result.settleMs);
    group.loadEventMs.push(result.loadEventMs);
    group.transferredBytes.push(result.transferredBytes);
    groups.set(key, group);
  }
  report.summary = {
    resultCount: report.results.length,
    errorCount: report.findings.filter((item) => item.severity === 'error').length,
    warningCount: report.findings.filter((item) => item.severity === 'warning').length,
    routeViewportStats: Array.from(groups.values()).map((group) => ({
      route: group.route,
      viewport: group.viewport,
      samples: group.samples,
      settleP50Ms: percentile(group.settleMs, 0.5),
      settleP95Ms: percentile(group.settleMs, 0.95),
      loadP50Ms: percentile(group.loadEventMs, 0.5),
      loadP95Ms: percentile(group.loadEventMs, 0.95),
      bytesP50: percentile(group.transferredBytes, 0.5),
      bytesP95: percentile(group.transferredBytes, 0.95),
    })),
    topSlowRequests: report.results
      .flatMap((result) => result.slowRequests.map((request) => ({ ...request, route: result.route, viewport: result.viewport, repeat: result.repeat })))
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 20),
    failedRequests: report.results.flatMap((result) => result.failedRequests.map((request) => ({ ...request, route: result.route, viewport: result.viewport, repeat: result.repeat }))).slice(0, 50),
    consoleErrors: report.results.flatMap((result) => result.consoleErrors.map((error) => ({ ...error, route: result.route, viewport: result.viewport, repeat: result.repeat }))).slice(0, 50),
  };
}

function writeReports(run) {
  summarize(run.report);
  run.report.finishedAt = new Date().toISOString();
  run.report.durationMs = Date.now() - run.startedAt;
  run.report.status = run.report.summary.errorCount ? 'failed' : 'passed';
  const jsonPath = path.join(run.root, 'report.json');
  const mdPath = path.join(run.root, 'report.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(run.report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, renderMarkdown(run.report), 'utf8');
  return { jsonPath, mdPath };
}

function renderMarkdown(report) {
  const lines = [
    '# Browser Performance Market Readiness Audit',
    '',
    `Status: **${report.status}**`,
    `Run ID: \`${report.runId}\``,
    `App URL: \`${report.appUrl}\``,
    `Routes: ${report.routes.join(', ')}`,
    `Viewports: ${report.viewports.map((item) => `${item.width}x${item.height}`).join(', ')}`,
    `Repeats: ${report.repeat}`,
    '',
    '## Summary',
    '',
    `Results: ${report.summary.resultCount}`,
    `Errors: ${report.summary.errorCount}`,
    `Warnings: ${report.summary.warningCount}`,
    '',
    '## Route / Viewport p50 p95',
    '',
    '| Route | Viewport | Samples | Settle p50 | Settle p95 | Load p50 | Load p95 | Bytes p95 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.summary.routeViewportStats.map((row) => `| ${row.route} | ${row.viewport} | ${row.samples} | ${row.settleP50Ms} | ${row.settleP95Ms} | ${row.loadP50Ms} | ${row.loadP95Ms} | ${row.bytesP95} |`),
    '',
    '## Findings',
    '',
    report.findings.length ? report.findings.map((item) => `- ${item.severity.toUpperCase()} [${item.code}] ${item.route} ${item.viewport} repeat ${item.repeat}: ${item.message}`).join('\n') : 'No findings.',
    '',
    '## Top Slow Requests',
    '',
    report.summary.topSlowRequests.length ? report.summary.topSlowRequests.map((item) => `- ${item.durationMs}ms ${item.status || ''} ${item.route} ${item.url}`).join('\n') : 'No slow requests.',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

async function run() {
  const config = {
    appUrl: process.env.APP_URL || 'http://127.0.0.1:5001/',
    pageTimeoutMs: parseIntEnv('PERF_AUDIT_PAGE_TIMEOUT_MS', 30000, 1000),
  };
  const runId = createRunId();
  const root = path.join(process.cwd(), 'output', 'performance-audit', runId);
  ensureDir(root);
  const runState = {
    runId,
    root,
    startedAt: Date.now(),
    config,
    report: {
      runId,
      startedAt: new Date().toISOString(),
      appUrl: config.appUrl,
      routes: parseRoutes(),
      viewports: parseViewports(),
      repeat: parseIntEnv('PERF_AUDIT_REPEAT', 1, 1),
      results: [],
      findings: [],
      environment: { platform: os.platform(), node: process.version },
    },
  };

  let browser;
  let context;
  try {
    const launched = await launchBrowserWithGuard({ retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(config.appUrl, { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs });
    await loginUiAuditUser(page, config.appUrl, {
      account: { username: 'ui_perf_market_admin', password: 'AuditSmoke12345!', role: 'admin' },
      defaultStorage: { 'ailao.language': 'en', language: 'en', 'ailao.activeTab': 'dashboard' },
    });
    await ensureAuthenticatedShell(page, config);

    for (let repeat = 1; repeat <= runState.report.repeat; repeat += 1) {
      for (const route of runState.report.routes) {
        for (const viewport of runState.report.viewports) {
          await auditOne(page, runState, route, viewport, repeat);
        }
      }
    }
  } catch (error) {
    addFinding(runState.report, {
      severity: 'error',
      code: 'PERFORMANCE_AUDIT_FAILED',
      message: String(error.message || error),
    });
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  const paths = writeReports(runState);
  if (runState.report.status !== 'passed') {
    console.error(`Browser performance market readiness audit failed. Report: ${paths.jsonPath}`);
    process.exit(1);
  }
  console.log(`Browser performance market readiness audit passed. Report: ${paths.jsonPath}`);
}

run().catch((error) => {
  console.error(String(error.message || error));
  process.exit(1);
});
