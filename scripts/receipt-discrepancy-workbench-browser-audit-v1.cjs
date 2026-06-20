const { connectOrLaunchBrowser } = require('./lib/browser-connect-or-launch.cjs');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'receipt-discrepancy-workbench-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'receipt-discrepancy-workbench-browser-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const RULE_NAME = `WB-TOL-RULE-${RUN_ID}`;
const GLOBAL_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 90000);

const STEP_TIMEOUT_MS = {
  pageLoad: 15000,
  login: 20000,
  nav: 12000,
  ui: 10000,
  save: 18000,
  readBack: 12000,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  ruleName: RULE_NAME,
  steps: [],
  consoleErrors: [],
  status: 'running',
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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function writeReport() {
  report.finishedAt = report.finishedAt || new Date().toISOString();
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

async function safeScreenshot(page, name) {
  const filePath = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function closeBrowserSafely(browser) {
  if (!browser) return;
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('browser close exceeded 5000ms')), 5000)),
    ]);
    recordStep({ step: 'browser-close', result: 'passed' });
  } catch (error) {
    recordStep({ step: 'browser-close', result: 'skipped', error: String(error.message || error) });
  }
}

async function withTimebox(page, name, timeout, action) {
  const started = Date.now();
  try {
    const result = await Promise.race([
      action(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} exceeded ${timeout}ms`)), timeout)),
    ]);
    recordStep({ step: name, timeout, result: 'passed', durationMs: Date.now() - started });
    return result;
  } catch (error) {
    const screenshot = await safeScreenshot(page, `fail-${name.replace(/[^a-z0-9-]/gi, '_')}`);
    recordStep({
      step: name,
      timeout,
      result: 'failed',
      durationMs: Date.now() - started,
      error: String(error.message || error),
      screenshot,
    });
    throw error;
  }
}

async function waitForText(page, text, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const bodyText = await page.locator('body').innerText();
    if (bodyText.includes(text)) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`text not visible within ${timeout}ms: ${text}`);
}

async function checkNoVisibleCorruption(page, routeName) {
  const text = await page.locator('body').innerText();
  const corruptionSignals = [
    /undefined\s+undefined/i,
    /\ufffd+/,
    mojibakeTokenPattern,
  ];
  const hit = corruptionSignals.find((signal) => signal.test(text));
  if (hit) throw new Error(`${routeName} shows corruption signal: ${String(hit)}`);
}

async function login(page) {
  await withTimebox(page, 'open-login', STEP_TIMEOUT_MS.pageLoad, async () => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  });

  const loginInput = page.locator('input[name="username"]');
  if (!(await loginInput.count())) {
    recordStep({ step: 'login-form-detection', result: 'skipped', reason: 'login form not found, assuming already authenticated' });
    return;
  }

  await withTimebox(page, 'submit-login', STEP_TIMEOUT_MS.login, async () => {
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await Promise.all([page.waitForTimeout(1200), page.click('button[type="submit"]')]);
  });
}

async function openWorkbench(page) {
  await withTimebox(page, 'route-discrepancy-workbench', STEP_TIMEOUT_MS.nav, async () => {
    await page.evaluate(() => {
      window.location.hash = '#discrepancies';
    });
    await page.waitForTimeout(1500);
    await waitForText(page, '收发货差异工作台', STEP_TIMEOUT_MS.nav);
    await waitForText(page, '差异队列', STEP_TIMEOUT_MS.nav);
    await waitForText(page, '容差规则', STEP_TIMEOUT_MS.nav);
  });
  await checkNoVisibleCorruption(page, 'receipt-discrepancy-workbench');
  const screenshot = await safeScreenshot(page, 'workbench-opened');
  recordStep({ step: 'workbench-opened-evidence', result: 'passed', screenshot });
}

async function createRuleAndReadBack(page) {
  await withTimebox(page, 'open-rule-tab', STEP_TIMEOUT_MS.ui, async () => {
    await page.getByTestId('receipt-discrepancy-tab-rules').click();
    await waitForText(page, '规则清单', STEP_TIMEOUT_MS.ui);
  });

  await withTimebox(page, 'open-rule-form', STEP_TIMEOUT_MS.ui, async () => {
    await page.getByTestId('receipt-tolerance-new-rule').click();
    await page.getByTestId('receipt-tolerance-rule-name').waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS.ui });
  });

  await withTimebox(page, 'create-rule', STEP_TIMEOUT_MS.save, async () => {
    await page.getByTestId('receipt-tolerance-rule-name').fill(RULE_NAME);
    await page.getByRole('button', { name: /保存规则/ }).click();
    await waitForText(page, RULE_NAME, STEP_TIMEOUT_MS.readBack);
  });

  await withTimebox(page, 'refresh-rule-readback', STEP_TIMEOUT_MS.readBack, async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await waitForText(page, '收发货差异工作台', STEP_TIMEOUT_MS.nav);
    await page.getByTestId('receipt-discrepancy-tab-rules').click();
    await page.getByTestId('receipt-tolerance-rule-search').fill(RULE_NAME);
    await waitForText(page, RULE_NAME, STEP_TIMEOUT_MS.readBack);
  });

  const screenshot = await safeScreenshot(page, 'rule-readback');
  recordStep({ step: 'rule-readback-evidence', result: 'passed', screenshot, ruleName: RULE_NAME });
}

async function verifyCasesTab(page) {
  await withTimebox(page, 'open-cases-tab', STEP_TIMEOUT_MS.ui, async () => {
    await page.getByTestId('receipt-discrepancy-tab-cases').click();
    await waitForText(page, '差异队列', STEP_TIMEOUT_MS.ui);
  });
  await checkNoVisibleCorruption(page, 'receipt-discrepancy-cases-tab');
  const screenshot = await safeScreenshot(page, 'cases-tab');
  recordStep({ step: 'cases-tab-evidence', result: 'passed', screenshot });
}

async function run() {
  ensureDir(SHOT_DIR);
  let browser;
  const watchdog = setTimeout(() => {
    report.status = 'stuck';
    report.error = `receipt discrepancy browser audit exceeded ${GLOBAL_TIMEOUT_MS}ms`;
    report.blockerCode = 'BROWSER_AUDIT_TIMEOUT';
    report.blockerVerdict = 'script_stuck';
    writeReport();
    console.error(report.error);
    process.exit(124);
  }, GLOBAL_TIMEOUT_MS);

  try {
    const launched = await connectOrLaunchBrowser({ recordStep, retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    report.launcher = launched.launcher;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

    page.on('console', (message) => {
      if (message.type() === 'error') {
        report.consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      report.consoleErrors.push(String(error.message || error));
    });

    await login(page);
    await openWorkbench(page);
    await createRuleAndReadBack(page);
    await verifyCasesTab(page);

    if (report.consoleErrors.length > 0) {
      throw new Error(`browser console errors detected: ${report.consoleErrors.slice(0, 3).join(' | ')}`);
    }

    report.status = 'passed';
  } catch (error) {
    report.status = error?.auditKind === 'environment_blocker' ? 'blocked_env' : 'failed';
    report.error = String(error.message || error);
    report.blockerCode = error?.auditCode || null;
    report.blockerVerdict = error?.auditVerdict || null;
    if (Array.isArray(error?.launchFailures)) report.launchFailures = error.launchFailures;
    process.exitCode = 1;
  } finally {
    await closeBrowserSafely(browser);
    clearTimeout(watchdog);
    writeReport();
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'receipt discrepancy workbench browser audit failed');
    process.exit(1);
  }

  console.log(`Receipt discrepancy workbench browser audit passed. Report: ${REPORT_PATH}`);
  process.exit(0);
}

run();
