const fs = require('fs');
const path = require('path');
const { connectOrLaunchBrowser } = require('./lib/browser-connect-or-launch.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'cdp-core-pages-smoke-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'cdp-core-pages-smoke-audit-report-v1.json');
const GLOBAL_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 180000);

const STEP_TIMEOUT_MS = {
  pageLoad: 15000,
  login: 20000,
  route: 9000,
  settle: 1400,
  screenshot: 5000,
  close: 5000,
};

const MOJIBAKE_CODE_POINTS = [
  0x7039,
  0x7481,
  0x93c0,
  0x95b2,
  0x9351,
  0x74a7,
  0x748b,
  0x7490,
  0x93b9,
  0x7edb,
  0x9417,
  0x7db7,
  0x951b,
  0x697c,
];
const mojibakeTokenPattern = new RegExp(MOJIBAKE_CODE_POINTS.map((code) => String.fromCodePoint(code)).join('|'), 'u');

const ROUTES = [
  { id: 'dashboard', hash: '#dashboard', expected: ['经营总览', '快捷中心', '系统已一键启动'] },
  { id: 'crm', hash: '#crm', expected: ['客户关系与信用档案', '客户关系', '客户管理'] },
  { id: 'orders', hash: '#orders', expected: ['销售订单', '订单', 'Sales'] },
  { id: 'collections', hash: '#collections', expected: ['回款工作台', '收款台账', '承诺付款'] },
  { id: 'financeAnalytics', hash: '#financeAnalytics', expected: ['财务经营', 'Revenue', 'Aging'] },
  { id: 'contracts', hash: '#contracts', expected: ['合同管理', '全部合同', '合同'] },
  { id: 'barter', hash: '#barter', expected: ['货抵支付', '换货贸易', '协议'] },
  { id: 'risk', hash: '#risk', expected: ['风险', 'Risk', '盲区'] },
  { id: 'samples', hash: '#samples', expected: ['样品', 'Sample', '新样品'] },
  { id: 'shipping', hash: '#shipping', expected: ['出货物流', '物流', 'shipment'] },
  { id: 'discrepancies', hash: '#discrepancies', expected: ['收发货差异工作台', '差异队列', '容差规则'] },
  { id: 'rma', hash: '#rma', expected: ['售后', 'RMA', '售后处理'] },
  { id: 'assets', hash: '#assets', expected: ['资产', 'Assets', '资产管理'] },
  { id: 'production', hash: '#production', expected: ['生产配方与工单', '配方主档工作台', '工单工作台'] },
  { id: 'warehouse', hash: '#warehouse', expected: ['仓库、库位与库存', '仓储库存', '库存'] },
  { id: 'procurement', hash: '#procurement', expected: ['采购、供应商与收货', '供应商', '采购订单'] },
  { id: 'adjustment', hash: '#adjustment', expected: ['调账', '财务、生产、库存统一调账', 'Adjustment'] },
  { id: 'audit', hash: '#audit', expected: ['系统操作列表', '审计', 'Audit'] },
];

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  cdpUrl: process.env.BROWSER_CDP_URL || null,
  routes: [],
  steps: [],
  consoleErrors: [],
  consoleWarnings: [],
  consoleFatalErrors: [],
  httpFailures: [],
  status: 'running',
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function writeReport() {
  report.finishedAt = report.finishedAt || new Date().toISOString();
  ensureDir(OUTPUT_DIR);
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

async function withTimeout(name, timeoutMs, action) {
  const started = Date.now();
  try {
    const result = await Promise.race([
      action(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} exceeded ${timeoutMs}ms`)), timeoutMs)),
    ]);
    recordStep({ step: name, result: 'passed', durationMs: Date.now() - started, timeoutMs });
    return result;
  } catch (error) {
    recordStep({ step: name, result: 'failed', durationMs: Date.now() - started, timeoutMs, error: String(error.message || error) });
    throw error;
  }
}

async function waitForBody(page, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = await page.locator('body').innerText().catch(() => '');
    if (text.trim().length > 0) return text;
    await page.waitForTimeout(200);
  }
  throw new Error(`body text not available within ${timeoutMs}ms`);
}

function assertNoVisibleCorruption(routeId, text) {
  const signals = [
    { name: 'replacement-character', pattern: /\ufffd+/ },
    { name: 'undefined-undefined', pattern: /undefined\s+undefined/i },
    { name: 'mojibake-token', pattern: mojibakeTokenPattern },
  ];
  const hit = signals.find((signal) => signal.pattern.test(text));
  if (hit) {
    throw new Error(`${routeId} visible text contains ${hit.name}`);
  }
}

function assertExpectedText(route, text) {
  const matched = route.expected.find((item) => text.includes(item));
  if (!matched) {
    throw new Error(`${route.id} missing expected text: ${route.expected.join(' | ')}`);
  }
  return matched;
}

function isRecoverableConsoleEntry(entry) {
  if (entry?.source === 'pageerror') return false;
  const text = String(entry?.text || '').trim();
  return /^timeout of 10000ms exceeded$/i.test(text)
    || /^Error:\s*timeout of 10000ms exceeded/i.test(text)
    || (/timeout of 10000ms exceeded/i.test(text)
      && (/^API Error:/i.test(text) || /^Failed to load .+?:?/i.test(text)));
}

async function waitForExpectedText(page, route, timeoutMs) {
  const started = Date.now();
  let lastText = '';
  while (Date.now() - started < timeoutMs) {
    lastText = await page.locator('body').innerText().catch(() => '');
    if (lastText.trim() && route.expected.some((item) => lastText.includes(item))) {
      return lastText;
    }
    await page.waitForTimeout(250);
  }
  return lastText || await waitForBody(page, 1000);
}

async function screenshotRoute(page, routeId) {
  const filePath = path.join(SHOT_DIR, `${routeId}.png`);
  await withTimeout(`screenshot-${routeId}`, STEP_TIMEOUT_MS.screenshot, async () => {
    await page.screenshot({ path: filePath, fullPage: true });
  });
  return filePath;
}

async function login(page) {
  await withTimeout('open-login', STEP_TIMEOUT_MS.pageLoad, async () => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS.pageLoad });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  });

  const loginInput = page.locator('input[name="username"]');
  if (!(await loginInput.count())) {
    recordStep({ step: 'login-form-detection', result: 'skipped', reason: 'login form not found, assuming already authenticated' });
    return;
  }

  await withTimeout('submit-login', STEP_TIMEOUT_MS.login, async () => {
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await Promise.all([
      page.waitForTimeout(1200),
      page.click('button[type="submit"]'),
    ]);
  });

  const bodyText = await waitForBody(page, 3000);
  if (/invalid credentials|用户名或密码错误|sai mật khẩu/i.test(bodyText)) {
    throw new Error('login rejected with invalid credentials');
  }
}

async function auditRoute(page, route) {
  const started = Date.now();
  const beforeErrorCount = report.consoleErrors.length;
  const routeReport = {
    id: route.id,
    hash: route.hash,
    expected: route.expected,
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  report.routes.push(routeReport);

  try {
    let text = '';
    await withTimeout(`route-${route.id}`, STEP_TIMEOUT_MS.route, async () => {
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, route.hash);
      await page.waitForTimeout(STEP_TIMEOUT_MS.settle);
      text = await waitForExpectedText(page, route, STEP_TIMEOUT_MS.route - STEP_TIMEOUT_MS.settle);
    });

    assertNoVisibleCorruption(route.id, text);
    routeReport.matchedText = assertExpectedText(route, text);
    routeReport.url = page.url();
    routeReport.screenshot = await screenshotRoute(page, route.id);
    const routeConsoleEntries = report.consoleErrors.slice(beforeErrorCount);
    const recoverableConsoleEntries = routeConsoleEntries.filter(isRecoverableConsoleEntry);
    const fatalConsoleEntries = routeConsoleEntries.filter((entry) => !isRecoverableConsoleEntry(entry));
    routeReport.consoleWarningCount = recoverableConsoleEntries.length;
    routeReport.consoleErrorCount = fatalConsoleEntries.length;
    if (recoverableConsoleEntries.length > 0) {
      const warnings = recoverableConsoleEntries.map((entry) => ({ ...entry, routeId: route.id }));
      report.consoleWarnings.push(...warnings);
      routeReport.consoleWarnings = warnings;
      recordStep({
        step: `console-warning-${route.id}`,
        result: 'warning',
        count: recoverableConsoleEntries.length,
        reason: 'recoverable API timeout; route rendered expected text and screenshot was captured',
      });
    }
    if (fatalConsoleEntries.length > 0) {
      const fatalErrors = fatalConsoleEntries.map((entry) => ({ ...entry, routeId: route.id }));
      report.consoleFatalErrors.push(...fatalErrors);
      routeReport.consoleFatalErrors = fatalErrors;
      throw new Error(`${route.id} produced ${fatalConsoleEntries.length} fatal console error(s)`);
    }
    routeReport.status = 'passed';
    routeReport.durationMs = Date.now() - started;
  } catch (error) {
    routeReport.status = 'failed';
    routeReport.error = String(error.message || error);
    routeReport.durationMs = Date.now() - started;
    routeReport.screenshot = await page.screenshot({
      path: path.join(SHOT_DIR, `fail-${route.id}.png`),
      fullPage: true,
    }).then(() => path.join(SHOT_DIR, `fail-${route.id}.png`)).catch(() => null);
    throw error;
  } finally {
    routeReport.finishedAt = new Date().toISOString();
  }
}

async function closeSafely(browser, launcher) {
  if (!browser || launcher === 'cdp') return;
  await withTimeout('browser-close', STEP_TIMEOUT_MS.close, async () => {
    await browser.close();
  }).catch((error) => {
    recordStep({ step: 'browser-close', result: 'skipped', error: String(error.message || error) });
  });
}

async function run() {
  ensureDir(SHOT_DIR);
  let browser = null;
  let page = null;
  let launcher = null;
  const watchdog = setTimeout(() => {
    report.status = 'stuck';
    report.error = `core pages smoke audit exceeded ${GLOBAL_TIMEOUT_MS}ms`;
    report.blockerCode = 'CORE_PAGES_SMOKE_TIMEOUT';
    report.blockerVerdict = 'script_stuck';
    writeReport();
    console.error(report.error);
    process.exit(124);
  }, GLOBAL_TIMEOUT_MS);

  try {
    const launched = await connectOrLaunchBrowser({ recordStep, retryLimit: 1, waitMs: 800, cdpRequired: process.env.BROWSER_CDP_REQUIRED === '1' });
    browser = launched.browser;
    launcher = launched.launcher;
    report.launcher = launcher;
    report.endpoint = launched.endpoint || null;

    const context = browser.contexts()[0] || await browser.newContext();
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('console', (message) => {
      if (message.type() === 'error') {
        report.consoleErrors.push({ at: new Date().toISOString(), source: 'console', text: message.text(), url: page.url() });
      }
    });
    page.on('pageerror', (error) => {
      report.consoleErrors.push({ at: new Date().toISOString(), source: 'pageerror', text: String(error.message || error), url: page.url() });
    });
    page.on('response', (response) => {
      const status = response.status();
      if (status >= 400) {
        report.httpFailures.push({
          at: new Date().toISOString(),
          status,
          url: response.url(),
          pageUrl: page.url(),
        });
      }
    });

    await login(page);
    for (const route of ROUTES) {
      await auditRoute(page, route);
    }

    report.status = report.consoleWarnings.length > 0 ? 'passed_with_warnings' : 'passed';
  } catch (error) {
    report.status = error?.auditKind === 'environment_blocker' ? 'blocked_env' : 'failed';
    report.error = String(error.message || error);
    report.blockerCode = error?.auditCode || null;
    report.blockerVerdict = error?.auditVerdict || null;
    if (Array.isArray(error?.launchFailures)) report.launchFailures = error.launchFailures;
    process.exitCode = 1;
  } finally {
    if (page) {
      await withTimeout('page-close', STEP_TIMEOUT_MS.close, async () => page.close()).catch(() => {});
    }
    await closeSafely(browser, launcher);
    clearTimeout(watchdog);
    writeReport();
  }

  if (!['passed', 'passed_with_warnings'].includes(report.status)) {
    console.error(report.error || 'core pages smoke audit failed');
    process.exit(1);
  }

  console.log(`Core pages CDP smoke audit ${report.status}. Report: ${REPORT_PATH}`);
  process.exit(0);
}

run();
