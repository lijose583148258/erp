const fs = require('fs');
const path = require('path');
const { connectOrLaunchBrowser } = require('./lib/browser-connect-or-launch.cjs');
const { loginUiAuditUser } = require('./lib/ui-audit-user.cjs');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.resolve(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'theme-switch-browser-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'theme-switch-browser-audit-report-v1.json');

const TIMEOUTS = {
  script: 290_000,
  login: 20_000,
  page: 20_000,
  action: 15_000,
  screenshot: 5_000,
};

const BAD_VISIBLE_TOKENS = ['undefined', '\uFFFD'];

const report = {
  name: 'theme-switch-browser-audit-v1',
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  status: 'running',
  steps: [],
  screenshots: [],
  consoleErrors: [],
  failure: null,
};

let scriptTimer = null;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function writeReport() {
  ensureDir(OUTPUT_DIR);
  report.finishedAt = new Date().toISOString();
  report.durationMs = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function withTimebox(step, timeoutMs, task) {
  const started = Date.now();
  recordStep({ step, result: 'running', timeoutMs });
  try {
    const result = await Promise.race([
      task(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${step} exceeded ${timeoutMs}ms`)), timeoutMs)),
    ]);
    recordStep({ step, result: 'passed', durationMs: Date.now() - started, timeoutMs });
    return result;
  } catch (error) {
    recordStep({
      step,
      result: 'failed',
      durationMs: Date.now() - started,
      timeoutMs,
      error: String(error?.message || error),
    });
    throw error;
  }
}

async function screenshot(page, name) {
  ensureDir(SHOT_DIR);
  const filePath = path.join(SHOT_DIR, `${name}.png`);
  await withTimebox(`screenshot-${name}`, TIMEOUTS.screenshot, () => page.screenshot({ path: filePath, fullPage: true }));
  report.screenshots.push(filePath);
  return filePath;
}

async function loginByApi(page) {
  return withTimebox('login-audit-user-api', TIMEOUTS.login, async () => {
    await loginUiAuditUser(page, APP_URL, {
      storage: {
        'ailao.language': 'zh',
        language: 'zh',
        currency: 'CNY',
        'ailao.activeTab': 'dashboard',
      },
      defaultStorage: {
        'ailao.theme': 'light',
      },
    });
  });
}

async function assertNoBadVisibleText(page, scope) {
  const bodyText = await page.locator('body').innerText({ timeout: TIMEOUTS.page });
  const badToken = BAD_VISIBLE_TOKENS.find((token) => bodyText.includes(token));
  if (badToken) {
    throw new Error(`${scope} contains bad visible token: ${badToken}`);
  }
}

async function assertTheme(page, expectedTheme, scope) {
  await withTimebox(`assert-theme-${scope}-${expectedTheme}`, TIMEOUTS.action, async () => {
    await page.waitForFunction((theme) => {
      const isDark = document.documentElement.classList.contains('dark');
      const storedTheme = window.localStorage.getItem('ailao.theme');
      return theme === 'dark'
        ? isDark && storedTheme === 'dark'
        : !isDark && storedTheme === 'light';
    }, expectedTheme, { timeout: TIMEOUTS.action });
  });
  recordStep({
    step: `theme-readback-${scope}`,
    result: 'passed',
    expectedTheme,
    storedTheme: await page.evaluate(() => window.localStorage.getItem('ailao.theme')),
    rootHasDarkClass: await page.evaluate(() => document.documentElement.classList.contains('dark')),
  });
}

async function clickThemeToggle(page, scope) {
  await withTimebox(`click-theme-toggle-${scope}`, TIMEOUTS.action, async () => {
    const button = page.getByTestId('theme-toggle');
    await button.waitFor({ state: 'visible', timeout: TIMEOUTS.action });
    await button.click();
  });
}

async function main() {
  ensureDir(SHOT_DIR);
  scriptTimer = setTimeout(() => {
    report.status = 'failed';
    report.failure = { stage: 'script-timeout', message: `Script exceeded ${TIMEOUTS.script}ms` };
    writeReport();
    process.exit(1);
  }, TIMEOUTS.script);

  let browser = null;
  let context = null;
  try {
    const launched = await connectOrLaunchBrowser({
      recordStep,
      retryLimit: 1,
      waitMs: 800,
    });
    browser = launched.browser;
    report.launcher = launched.launcher;
    report.endpoint = launched.endpoint || null;

    context = await browser.newContext({ viewport: { width: 1600, height: 980 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('console', (message) => {
      if (message.type() === 'error') {
        report.consoleErrors.push({ at: new Date().toISOString(), text: message.text(), url: page.url() });
      }
    });
    page.on('pageerror', (error) => {
      report.consoleErrors.push({ at: new Date().toISOString(), text: String(error?.message || error), url: page.url() });
    });

    await loginByApi(page);
    await withTimebox('open-dashboard', TIMEOUTS.page, async () => {
      await page.goto(`${APP_URL}#dashboard`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      await page.locator('body').waitFor({ state: 'visible', timeout: TIMEOUTS.page });
      await page.getByTestId('theme-toggle').waitFor({ state: 'visible', timeout: TIMEOUTS.page });
    });
    await assertNoBadVisibleText(page, 'theme-initial');
    await assertTheme(page, 'light', 'initial');
    await screenshot(page, 'theme-light-initial');

    await clickThemeToggle(page, 'to-dark');
    await assertTheme(page, 'dark', 'after-toggle-dark');
    await assertNoBadVisibleText(page, 'theme-dark');
    await screenshot(page, 'theme-dark');

    await withTimebox('reload-dashboard-dark-persistence', TIMEOUTS.page, async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      await page.getByTestId('theme-toggle').waitFor({ state: 'visible', timeout: TIMEOUTS.page });
    });
    await assertTheme(page, 'dark', 'after-reload');

    await clickThemeToggle(page, 'to-light');
    await assertTheme(page, 'light', 'after-toggle-light');
    await assertNoBadVisibleText(page, 'theme-light-return');
    await screenshot(page, 'theme-light-return');

    report.status = report.consoleErrors.length === 0 ? 'passed' : 'failed';
    if (report.consoleErrors.length > 0) {
      report.failure = { stage: 'console-errors', count: report.consoleErrors.length };
    }
  } catch (error) {
    report.status = 'failed';
    report.failure = {
      message: String(error?.message || error),
      stack: error?.stack || null,
    };
    throw error;
  } finally {
    if (scriptTimer) clearTimeout(scriptTimer);
    try {
      if (context) await context.close();
      if (browser) await browser.close();
    } catch {
      // ignore browser close failures in report-only probe
    }
    writeReport();
  }
}

main().then(() => {
  if (report.status !== 'passed') {
    console.error(`Theme switch browser audit failed. Report: ${REPORT_PATH}`);
    process.exit(1);
  }
  console.log(`Theme switch browser audit passed. Report: ${REPORT_PATH}`);
}).catch((error) => {
  console.error(String(error?.stack || error));
  process.exit(1);
});
