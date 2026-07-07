const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { validateRoutes } = require('./isolated-playwright-routes.cjs');

function readConfig() {
  const configFile = process.argv[2] || process.env.ISOLATED_PLAYWRIGHT_CONFIG_FILE;
  if (!configFile) {
    throw new Error('worker config file is required');
  }
  const resolved = path.resolve(configFile);
  const config = JSON.parse(fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, ''));
  return { ...config, configFile: resolved };
}

function parsePositiveInt(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeReportFile(outputDir, report) {
  ensureDir(outputDir);
  fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function shouldCleanUserDataDir() {
  const raw = process.env.ISOLATED_PLAYWRIGHT_CLEAN_USER_DATA;
  if (raw != null && raw !== '') return raw === '1' || raw.toLowerCase() === 'true';
  return process.platform !== 'win32';
}

function cleanupUserDataDir(userDataDir) {
  if (!shouldCleanUserDataDir()) {
    return {
      status: 'skipped',
      userDataDirRemoved: false,
      reason: 'recursive Playwright profile deletion is skipped by default on Windows',
    };
  }
  fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return { status: 'completed', userDataDirRemoved: true };
}

function toRelative(from, target) {
  if (!target) return null;
  return path.relative(from, target).replace(/\\/g, '/');
}

function isPathInside(parent, child) {
  const relativePath = path.relative(parent, child);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function apiUrl(appUrl, pathname) {
  return new URL(pathname.replace(/^\//, ''), new URL('api/', appUrl)).toString();
}

function compact(items, limit = 20) {
  return items.slice(-limit).map((item) => ({
    at: item.at,
    text: item.text,
    url: item.url,
    status: item.status,
    method: item.method,
    failure: item.failure,
  }));
}

function shouldIgnoreHttpStatus(status) {
  return status < 400;
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

async function safeScreenshot(page, outputDir, screenshotsDir, fileName, timeoutMs) {
  const screenshotPath = path.join(screenshotsDir, fileName);
  try {
    await withTimeout(`screenshot:${fileName}`, timeoutMs, async () => {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    });
    return toRelative(outputDir, screenshotPath);
  } catch (error) {
    return null;
  }
}

async function tryUiLogin(page, appUrl, username, password, timeoutMs) {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  const usernameInput = page
    .locator([
      'input[name="username"]:not([readonly])',
      'input[autocomplete="username"]:not([readonly])',
      'input[type="text"]:not([readonly]):not([aria-hidden="true"])',
    ].join(', '))
    .first();
  const passwordInput = page
    .locator([
      'input[name="password"]:not([readonly])',
      'input[autocomplete="current-password"]:not([readonly])',
      'input[type="password"]:not([readonly])',
    ].join(', '))
    .first();
  await usernameInput.fill(username, { timeout: timeoutMs });
  await passwordInput.fill(password, { timeout: timeoutMs });

  const submit = page
    .locator([
      'button[type="submit"]',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
    ].join(', '))
    .first();
  if (await submit.count()) {
    await submit.click({ timeout: timeoutMs });
  } else {
    await passwordInput.press('Enter', { timeout: timeoutMs });
  }
}

async function seedOrLogin(page, config, report, timeouts) {
  const appUrl = config.appUrl;
  const username = config.username;
  const password = config.password;

  const applySession = ({ token, refreshToken, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('erp_auth_token', token);
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('currentUser', JSON.stringify(user));
    localStorage.setItem('erp_current_user', JSON.stringify(user));
    localStorage.setItem('ailao.language', 'en');
    localStorage.setItem('language', 'en');
  };

  let apiLoginError = null;
  try {
    const response = await page.request.post(apiUrl(appUrl, '/auth/login'), {
      data: { username, password },
      timeout: timeouts.login,
    });
    if (!response.ok()) {
      throw new Error(`API login failed: ${response.status()}`);
    }
    const json = await response.json();
    const token = json?.data?.token;
    const user = json?.data?.user;
    if (!token || !user || user.mustChangePassword) {
      throw new Error('API login returned invalid ready user');
    }
    const session = { token, refreshToken: json?.data?.refreshToken || '', user };
    await page.addInitScript(applySession, session);
    await page
      .goto(`${appUrl.replace(/\/?$/, '/')}#dashboard`, {
        waitUntil: 'commit',
        timeout: timeouts.pageLoad,
      })
      .catch((error) => {
        report.navigationWarning = String(error.message || error);
      });
    await page.evaluate(applySession, session).catch(() => {});
  } catch (error) {
    apiLoginError = error;
  }

  let ready = await page.waitForFunction(
    () => {
      const text = document.body?.innerText || '';
      const loginVisible = Boolean(document.querySelector('input[type="password"], input[name="password"]'));
      return !loginVisible && text.trim().length > 0;
    },
    null,
    { timeout: timeouts.login },
  ).then(() => true).catch(() => false);

  if (!ready && apiLoginError) {
    await tryUiLogin(page, appUrl, username, password, timeouts.login);
    ready = await page.waitForFunction(
      () => {
        const text = document.body?.innerText || '';
        const loginVisible = Boolean(document.querySelector('input[type="password"], input[name="password"]'));
        return !loginVisible && text.trim().length > 0;
      },
      null,
      { timeout: timeouts.login },
    ).then(() => true).catch(() => false);
  }

  if (!ready) {
    const apiMessage = apiLoginError ? `; API fallback was: ${apiLoginError.message}` : '';
    throw new Error(`login did not reach app shell${apiMessage}`);
  }

  report.login = { status: 'passed', username };
}

function makeRouteReport(route) {
  return {
    id: route.id,
    hash: route.hash,
    title: route.title,
    category: route.category,
    severity: route.severity,
    tags: route.tags,
    status: 'running',
    durationMs: 0,
    screenshot: null,
    consoleErrors: [],
    pageErrors: [],
    httpFailures: [],
    failedRequests: [],
    error: null,
  };
}

async function auditRoute(page, route, state, config, report, timeouts) {
  const routeReport = makeRouteReport(route);
  const started = Date.now();
  report.routes.push(routeReport);

  const startConsole = report.consoleErrors.length;
  const startPage = report.pageErrors.length;
  const startHttp = report.httpFailures.length;
  const startRequests = report.failedRequests.length;

  try {
    if (route.viewport) {
      await page.setViewportSize({ width: route.viewport.width, height: route.viewport.height });
    } else if (config.defaultViewport) {
      await page.setViewportSize(config.defaultViewport);
    }

    await page.goto(`${config.appUrl.replace(/\/?$/, '/')}${route.hash}`, {
      waitUntil: 'domcontentloaded',
      timeout: timeouts.pageLoad,
    });
    await page.waitForLoadState('networkidle', { timeout: timeouts.networkIdle }).catch(() => {});
    await page.waitForTimeout(timeouts.settle);

    const bodyText = await page.locator('body').innerText({ timeout: timeouts.route });
    const expected = route.expected.find((item) => bodyText.includes(item));
    if (!expected) {
      throw new Error(`missing expected text: ${route.expected.join(' | ')}`);
    }

    routeReport.matchedText = expected;
    routeReport.status = 'passed';
  } catch (error) {
    routeReport.status = 'failed';
    routeReport.error = String(error.message || error);
    routeReport.pageHash = await page.evaluate(() => window.location.hash).catch(() => '');
    routeReport.pageUrl = page.url();
  } finally {
    routeReport.consoleErrors = compact(report.consoleErrors.slice(startConsole));
    routeReport.pageErrors = compact(report.pageErrors.slice(startPage));
    routeReport.httpFailures = compact(report.httpFailures.slice(startHttp));
    routeReport.failedRequests = compact(report.failedRequests.slice(startRequests));
    routeReport.lastClickText = state.lastClickText;
    routeReport.lastApiRequestUrl = state.lastApiRequestUrl;
    routeReport.lastApiResponseUrl = state.lastApiResponseUrl;
    routeReport.lastApiResponseStatus = state.lastApiResponseStatus;
    routeReport.screenshot = await safeScreenshot(
      page,
      config.outputDir,
      config.screenshotsDir,
      `${route.id.replace(/[^a-z0-9_-]/gi, '_')}.png`,
      timeouts.screenshot,
    );
    routeReport.durationMs = Date.now() - started;
    routeReport.finishedAt = new Date().toISOString();
  }
}

async function run() {
  const config = readConfig();
  config.routes = validateRoutes(config.routes || []);
  config.outputDir = path.resolve(config.outputDir);
  config.userDataDir = path.resolve(config.userDataDir || path.join(config.outputDir, 'user-data'));
  config.screenshotsDir = path.resolve(config.screenshotsDir || path.join(config.outputDir, 'screenshots'));
  config.appUrl = (config.appUrl || process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');

  if (!isPathInside(config.outputDir, config.userDataDir)) {
    throw new Error('worker userDataDir must be inside worker outputDir');
  }

  ensureDir(config.outputDir);
  ensureDir(config.screenshotsDir);
  ensureDir(config.userDataDir);

  const timeouts = {
    pageLoad: parsePositiveInt('ISOLATED_PLAYWRIGHT_PAGE_LOAD_TIMEOUT_MS', 30000),
    login: parsePositiveInt('ISOLATED_PLAYWRIGHT_LOGIN_TIMEOUT_MS', 20000),
    route: parsePositiveInt('ISOLATED_PLAYWRIGHT_ROUTE_TIMEOUT_MS', 18000),
    networkIdle: parsePositiveInt('ISOLATED_PLAYWRIGHT_NETWORK_IDLE_TIMEOUT_MS', 5000),
    settle: parsePositiveInt('ISOLATED_PLAYWRIGHT_SETTLE_TIMEOUT_MS', 700),
    screenshot: parsePositiveInt('ISOLATED_PLAYWRIGHT_SCREENSHOT_TIMEOUT_MS', 5000),
  };
  const strictConsole = process.env.ISOLATED_PLAYWRIGHT_FAIL_ON_CONSOLE_ERRORS === '1';
  const strictHttp = process.env.ISOLATED_PLAYWRIGHT_FAIL_ON_HTTP_FAILURES === '1';
  const headless = process.env.BROWSER_AUDIT_VISIBLE === '1' ? false : true;

  const report = {
    schemaVersion: 1,
    workerId: config.workerId,
    appUrl: config.appUrl,
    startedAt: new Date().toISOString(),
    outputDir: config.outputDir,
    userDataDir: config.userDataDir,
    screenshotsDir: config.screenshotsDir,
    routes: [],
    consoleErrors: [],
    pageErrors: [],
    httpFailures: [],
    failedRequests: [],
    cleanup: null,
    status: 'running',
  };
  const state = {
    lastClickText: '',
    lastApiRequestUrl: '',
    lastApiResponseUrl: '',
    lastApiResponseStatus: null,
  };

  let context = null;
  try {
    context = await chromium.launchPersistentContext(config.userDataDir, {
      headless,
      viewport: config.defaultViewport || { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('console', (message) => {
      if (message.type() === 'error') {
        report.consoleErrors.push({ at: new Date().toISOString(), text: message.text(), url: page.url() });
      }
    });
    page.on('pageerror', (error) => {
      report.pageErrors.push({ at: new Date().toISOString(), text: String(error.message || error), url: page.url() });
    });
    page.on('request', (request) => {
      if (request.url().includes('/api/')) state.lastApiRequestUrl = request.url();
    });
    page.on('requestfailed', (request) => {
      report.failedRequests.push({
        at: new Date().toISOString(),
        method: request.method(),
        url: request.url(),
        failure: request.failure()?.errorText || 'request failed',
      });
    });
    page.on('response', (response) => {
      if (response.url().includes('/api/')) {
        state.lastApiResponseUrl = response.url();
        state.lastApiResponseStatus = response.status();
      }
      if (!shouldIgnoreHttpStatus(response.status())) {
        report.httpFailures.push({
          at: new Date().toISOString(),
          status: response.status(),
          url: response.url(),
          pageUrl: page.url(),
        });
      }
    });
    await page.exposeBinding('__ailaoRecordClick', (_source, text) => {
      state.lastClickText = String(text || '').slice(0, 160);
    });
    await page.addInitScript(() => {
      document.addEventListener('click', (event) => {
        const target = event.target && event.target.closest ? event.target.closest('button,a,[role="button"]') : null;
        if (target && window.__ailaoRecordClick) {
          const text = target.innerText ||
            target.getAttribute('aria-label') ||
            target.getAttribute('data-testid') ||
            '';
          window.__ailaoRecordClick(text.trim());
        }
      }, true);
    });

    await seedOrLogin(page, config, report, timeouts);
    for (const route of config.routes) {
      await auditRoute(page, route, state, config, report, timeouts);
    }

    const blockingRouteFailure = report.routes.some((route) =>
      route.status !== 'passed' && ['error', 'blocker'].includes(route.severity),
    );
    if (strictConsole && (report.consoleErrors.length || report.pageErrors.length)) {
      throw new Error(`console/page errors detected: ${report.consoleErrors.length + report.pageErrors.length}`);
    }
    if (strictHttp && (report.httpFailures.length || report.failedRequests.length)) {
      throw new Error(`HTTP/request failures detected: ${report.httpFailures.length + report.failedRequests.length}`);
    }
    report.status = blockingRouteFailure ? 'failed' : 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
  } finally {
    report.finishedAt = new Date().toISOString();
    if (!report.cleanup) {
      report.cleanup = { status: 'pending', userDataDirRemoved: false };
    }
    writeReportFile(config.outputDir, report);
    report.preCleanupReportWritten = true;

    if (context) await context.close().catch(() => {});
    try {
      report.cleanup = cleanupUserDataDir(config.userDataDir);
    } catch (error) {
      report.cleanup = { status: 'failed', userDataDirRemoved: false, error: String(error.message || error) };
    }
    report.finishedAt = new Date().toISOString();
    writeReportFile(config.outputDir, report);
  }

  if (report.status !== 'passed') {
    process.exit(1);
  }
}

run().catch((error) => {
  const outputDir = path.resolve(process.env.ISOLATED_PLAYWRIGHT_OUTPUT_DIR || process.cwd());
  ensureDir(outputDir);
  fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify({
    schemaVersion: 1,
    status: 'failed',
    error: String(error.message || error),
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
  console.error(error);
  process.exit(1);
});
