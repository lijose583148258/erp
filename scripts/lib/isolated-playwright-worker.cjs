const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { ROUTES: DEFAULT_ROUTES } = require('./isolated-playwright-routes.cjs');

function parseJsonEnv(name) {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error.message || error}`);
  }
}

function parsePositiveInt(name, defaultValue) {
  const value = Number(process.env[name] || defaultValue);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : defaultValue;
}

function apiUrl(pathname) {
  return new URL(pathname.replace(/^\//, ''), new URL('api/', APP_URL)).toString();
}

const workerConfig = parseJsonEnv('ISOLATED_PLAYWRIGHT_WORKER_CONFIG');
const APP_URL = workerConfig.appUrl || process.env.APP_URL || 'http://127.0.0.1:5001/';
const WORKER_ID = workerConfig.workerId || process.env.ISOLATED_PLAYWRIGHT_WORKER_ID || 'worker-0';
const OUTPUT_DIR = path.resolve(workerConfig.outputDir || path.join(process.cwd(), 'output', 'playwright', 'isolated-parallel', WORKER_ID));
const ROUTES = Array.isArray(workerConfig.routes) && workerConfig.routes.length ? workerConfig.routes : DEFAULT_ROUTES;
const AUDIT_USERNAME = workerConfig.username || process.env.ISOLATED_PLAYWRIGHT_USERNAME || 'ui_isolated_parallel_admin';
const AUDIT_PASSWORD = workerConfig.password || process.env.ISOLATED_PLAYWRIGHT_PASSWORD || 'AuditSmoke12345!';
const HEADLESS = process.env.BROWSER_AUDIT_VISIBLE === '1' ? false : true;
const STEP_TIMEOUT_MS = {
  pageLoad: parsePositiveInt('ISOLATED_PLAYWRIGHT_PAGE_LOAD_TIMEOUT_MS', 15000),
  login: parsePositiveInt('ISOLATED_PLAYWRIGHT_LOGIN_TIMEOUT_MS', 20000),
  route: parsePositiveInt('ISOLATED_PLAYWRIGHT_ROUTE_TIMEOUT_MS', 9000),
  settle: parsePositiveInt('ISOLATED_PLAYWRIGHT_SETTLE_TIMEOUT_MS', 1000),
  screenshot: parsePositiveInt('ISOLATED_PLAYWRIGHT_SCREENSHOT_TIMEOUT_MS', 5000),
};

const report = {
  workerId: WORKER_ID,
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  outputDir: OUTPUT_DIR,
  routes: [],
  consoleErrors: [],
  pageErrors: [],
  httpFailures: [],
  status: 'running',
};

let lastClickText = '';
let lastApiRequestUrl = '';
let lastApiResponseUrl = '';
let lastApiResponseStatus = null;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeReport() {
  report.finishedAt = report.finishedAt || new Date().toISOString();
  report.lastClickText = lastClickText;
  report.lastApiRequestUrl = lastApiRequestUrl;
  report.lastApiResponseUrl = lastApiResponseUrl;
  report.lastApiResponseStatus = lastApiResponseStatus;
  ensureDir(OUTPUT_DIR);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
}

function assertNoVisibleCorruption(routeId, text) {
  const signals = [
    { name: 'replacement-character', pattern: /\ufffd+/ },
    { name: 'undefined-undefined', pattern: /undefined\s+undefined/i },
    { name: 'blank-shell', pattern: /^\s*$/ },
  ];
  const hit = signals.find((signal) => signal.pattern.test(text));
  if (hit) throw new Error(`${routeId} visible text contains ${hit.name}`);
}

function assertExpectedText(route, text) {
  const matched = route.expected.find((item) => text.includes(item));
  if (!matched) throw new Error(`${route.id} missing expected text: ${route.expected.join(' | ')}`);
  return matched;
}

function compactErrors(items, limit = 8) {
  return items.slice(-limit).map((item) => ({
    at: item.at,
    text: item.text,
    url: item.url,
    status: item.status,
  }));
}

async function withTimeout(name, timeoutMs, action) {
  let timer = null;
  try {
    return await Promise.race([
      action(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function safeScreenshot(page, fileName) {
  const screenshotPath = path.join(OUTPUT_DIR, fileName);
  try {
    await withTimeout(`screenshot-${fileName}`, STEP_TIMEOUT_MS.screenshot, async () => {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    });
    return screenshotPath;
  } catch (error) {
    report.screenshotErrors = report.screenshotErrors || [];
    report.screenshotErrors.push({ at: new Date().toISOString(), fileName, error: String(error.message || error) });
    return null;
  }
}

async function seedSession(page) {
  const response = await page.request.post(apiUrl('/auth/login'), {
    data: { username: AUDIT_USERNAME, password: AUDIT_PASSWORD },
  });
  if (!response.ok()) {
    throw new Error(`isolated audit login failed: ${response.status()}`);
  }
  const json = await response.json().catch(() => null);
  const token = json?.data?.token;
  const user = json?.data?.user;
  if (!token || !user || user.mustChangePassword) {
    throw new Error('isolated audit login returned invalid ready user');
  }
  const currentUser = {
    id: String(user.id),
    name: user.username,
    role: user.role,
    segment: user.segment || 'mixed',
    avatar: user.avatar || '',
    mustChangePassword: Boolean(user.mustChangePassword),
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
    dataScopes: Array.isArray(user.dataScopes) ? user.dataScopes : [],
  };
  const session = {
    token,
    refreshToken: json?.data?.refreshToken || '',
    user: currentUser,
    storage: {
      'ailao.language': 'en',
      language: 'en',
      currency: 'CNY',
    },
  };
  const applySession = ({ token: savedToken, refreshToken, user: savedUser, storage }) => {
    localStorage.setItem('token', savedToken);
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
    localStorage.setItem('user', JSON.stringify(savedUser));
    localStorage.setItem('auth_token', savedToken);
    localStorage.setItem('erp_auth_token', savedToken);
    localStorage.setItem('currentUser', JSON.stringify(savedUser));
    localStorage.setItem('erp_current_user', JSON.stringify(savedUser));
    Object.entries(storage).forEach(([key, value]) => localStorage.setItem(key, value));
  };
  await page.addInitScript(applySession, session);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS.pageLoad });
  await page.evaluate(applySession, session);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS.pageLoad });
  report.login = { status: 'passed', username: AUDIT_USERNAME };
}

async function waitForExpectedText(page, route, timeoutMs) {
  const started = Date.now();
  let lastText = '';
  while (Date.now() - started < timeoutMs) {
    lastText = await page.locator('body').innerText().catch(() => '');
    if (lastText.trim() && route.expected.some((item) => lastText.includes(item))) return lastText;
    await page.waitForTimeout(250);
  }
  return lastText;
}

async function auditRoute(page, route) {
  const routeReport = {
    id: route.id,
    hash: route.hash,
    expected: route.expected,
    startedAt: new Date().toISOString(),
    status: 'running',
  };
  report.routes.push(routeReport);
  const started = Date.now();
  try {
    let text = '';
    await withTimeout(`route-${route.id}`, STEP_TIMEOUT_MS.route + STEP_TIMEOUT_MS.settle + 2000, async () => {
      await page.evaluate((hash) => {
        window.localStorage.setItem('ailao.activeTab', hash.replace(/^#/, ''));
        window.location.hash = hash;
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }, route.hash);
      await page.waitForTimeout(STEP_TIMEOUT_MS.settle);
      text = await waitForExpectedText(page, route, STEP_TIMEOUT_MS.route);
    });
    assertNoVisibleCorruption(route.id, text);
    routeReport.matchedText = assertExpectedText(route, text);
    routeReport.screenshot = await safeScreenshot(page, `${route.id}.png`);
    routeReport.status = 'passed';
  } catch (error) {
    routeReport.status = 'failed';
    routeReport.error = String(error.message || error);
    routeReport.pageHash = await page.evaluate(() => window.location.hash).catch(() => '');
    routeReport.pageUrl = page.url();
    routeReport.lastClickText = lastClickText;
    routeReport.lastApiRequestUrl = lastApiRequestUrl;
    routeReport.lastApiResponseUrl = lastApiResponseUrl;
    routeReport.lastApiResponseStatus = lastApiResponseStatus;
    routeReport.consoleErrors = compactErrors(report.consoleErrors);
    routeReport.pageErrors = compactErrors(report.pageErrors);
    routeReport.httpFailures = compactErrors(report.httpFailures);
    routeReport.screenshot = await safeScreenshot(page, `fail-${route.id}.png`);
    throw error;
  } finally {
    routeReport.durationMs = Date.now() - started;
    routeReport.finishedAt = new Date().toISOString();
  }
}

async function run() {
  ensureDir(OUTPUT_DIR);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `erp-pw-${WORKER_ID}-`));
  report.userDataDir = userDataDir;
  let context = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: HEADLESS,
      viewport: { width: 1440, height: 1000 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('console', (message) => {
      if (message.type() === 'error') {
        report.consoleErrors.push({ at: new Date().toISOString(), text: message.text(), url: page.url() });
      }
    });
    page.on('pageerror', (error) => {
      report.pageErrors.push({ at: new Date().toISOString(), text: String(error.message || error), url: page.url() });
    });
    page.on('request', (request) => {
      if (request.url().includes('/api/')) lastApiRequestUrl = request.url();
    });
    page.on('response', (response) => {
      if (response.url().includes('/api/')) {
        lastApiResponseUrl = response.url();
        lastApiResponseStatus = response.status();
      }
      if (response.status() >= 500) {
        report.httpFailures.push({ at: new Date().toISOString(), status: response.status(), url: response.url(), pageUrl: page.url() });
      }
    });
    await page.exposeBinding('__ailaoRecordClick', (_source, text) => {
      lastClickText = String(text || '').slice(0, 120);
    });
    await page.addInitScript(() => {
      document.addEventListener('click', (event) => {
        const target = event.target && event.target.closest ? event.target.closest('button,a,[role="button"]') : null;
        if (target && window.__ailaoRecordClick) {
          window.__ailaoRecordClick((target.innerText || target.getAttribute('aria-label') || target.getAttribute('data-testid') || '').trim());
        }
      }, true);
    });
    await seedSession(page);
    for (const route of ROUTES) await auditRoute(page, route);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
    process.exitCode = 1;
  } finally {
    if (context) await context.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
    report.userDataDirRemoved = true;
    writeReport();
  }
}

run();
