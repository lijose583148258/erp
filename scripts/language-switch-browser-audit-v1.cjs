const fs = require('fs');
const path = require('path');
const { connectOrLaunchBrowser } = require('./lib/browser-connect-or-launch.cjs');
const { loginUiAuditUser } = require('./lib/ui-audit-user.cjs');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.resolve(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'language-switch-browser-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'language-switch-browser-audit-report-v1.json');

const TIMEOUTS = {
  script: 290_000,
  login: 20_000,
  page: 20_000,
  action: 15_000,
  screenshot: 5_000,
};

const cp = (...codes) => String.fromCodePoint(...codes);

const BAD_VISIBLE_TOKENS = [
  'undefined',
  '\uFFFD',
  '\u00e2\u20ac',
  '\u9416',
  '\u6d93\ue15f\u6783',
  cp(0x7f01, 0x5fda, 0x60c0),
  cp(0x7f02, 0x4f78, 0x7e57, 0x93af, 0x20ac),
  cp(0x9416, 0x535e),
  cp(0x7039, 0x3221),
  cp(0x95bf, 0x20ac),
  cp(0x9365, 0x70b4),
  cp(0x6434, 0x65c0),
  cp(0x7490, 0x3220),
  cp(0x935a, 0x581d),
  cp(0x690b, 0x5ea2),
  cp(0x5a13, 0x72bb),
  cp(0x93cd, 0x5cf0),
  cp(0x9359, 0x6223),
  cp(0x9422, 0x71b6),
  cp(0x6d60, 0x64b3),
  cp(0x95b2, 0x56ea),
  cp(0x7039, 0x00a4),
  cp(0x54, 0x69, 0x5cb7),
  cp(0x54, 0x5cc4),
];

const LANGUAGE_CASES = [
  {
    code: 'en',
    menuLabel: 'English',
    expectedText: 'Overview',
    screenshot: 'language-en',
  },
  {
    code: 'vi',
    menuLabel: 'Tieng Viet',
    expectedText: 'Tong quan',
    screenshot: 'language-vi',
  },
  {
    code: 'zh',
    menuLabel: '中文',
    expectedText: '经营总览',
    screenshot: 'language-zh-return',
  },
];

const report = {
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

async function openLanguageMenu(page, currentCode) {
  await withTimebox(`open-language-menu-${currentCode}`, TIMEOUTS.action, async () => {
    const button = page.locator('button').filter({ hasText: new RegExp(`^${currentCode}$`, 'i') }).first();
    await button.waitFor({ state: 'visible', timeout: TIMEOUTS.action });
    await button.click();
    await page.locator('button').filter({ hasText: 'English' }).first().waitFor({ state: 'visible', timeout: TIMEOUTS.action });
  });
}

async function switchLanguage(page, currentCode, target) {
  await openLanguageMenu(page, currentCode);
  await withTimebox(`select-language-${target.code}`, TIMEOUTS.action, async () => {
    await page.locator('button').filter({ hasText: target.menuLabel }).first().click();
    await page.waitForFunction(({ code, expected }) => (
      window.localStorage.getItem('ailao.language') === code
      && document.body.innerText.includes(expected)
    ), { code: target.code, expected: target.expectedText }, { timeout: TIMEOUTS.action });
  });

  await assertNoBadVisibleText(page, `language-${target.code}`);
  await screenshot(page, target.screenshot);
  recordStep({
    step: `language-${target.code}-readback`,
    result: 'passed',
    expectedText: target.expectedText,
    storageLanguage: await page.evaluate(() => window.localStorage.getItem('ailao.language')),
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
      await page.waitForFunction(() => document.body.innerText.includes('经营总览'), null, { timeout: TIMEOUTS.page });
    });
    await assertNoBadVisibleText(page, 'language-zh-initial');
    await screenshot(page, 'language-zh-initial');

    let currentCode = 'zh';
    for (const target of LANGUAGE_CASES) {
      await switchLanguage(page, currentCode, target);
      currentCode = target.code;
    }

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
    console.error(`Language switch browser audit failed. Report: ${REPORT_PATH}`);
    process.exit(1);
  }
  console.log(`Language switch browser audit passed. Report: ${REPORT_PATH}`);
}).catch((error) => {
  console.error(String(error?.stack || error));
  process.exit(1);
});
