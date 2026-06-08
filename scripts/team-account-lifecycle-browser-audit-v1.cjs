const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.resolve(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'team-account-lifecycle-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'team-account-lifecycle-browser-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const USERNAME = `team_life_${RUN_ID}`;
const PASSWORD = 'Audit12345';

const TIMEOUTS = {
  script: 290_000,
  page: 20_000,
  save: 25_000,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  username: USERNAME,
  status: 'running',
  steps: [],
  screenshots: [],
  failure: null,
};

let scriptTimer = null;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function expect(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function verifyStableRuntimeOrigin() {
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'scripts', 'stable-package-origin-audit-v1.cjs')],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: TIMEOUTS.page,
      windowsHide: true,
    },
  );
  const passed = result.status === 0;
  recordStep({
    step: 'stable-runtime-origin-preflight',
    result: passed ? 'passed' : 'failed',
    timeout: TIMEOUTS.page,
    durationMs: Date.now() - started,
    exitCode: result.status,
  });
  expect(
    passed,
    'stable runtime origin preflight failed; rebuild and restart the governed package before browser auditing',
    {
      stdout: String(result.stdout || '').slice(-1000),
      stderr: String(result.stderr || '').slice(-1000),
    },
  );
}

async function screenshot(page, name) {
  const filePath = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  report.screenshots.push(filePath);
  return filePath;
}

async function withTimebox(page, step, timeout, action) {
  const started = Date.now();
  try {
    const value = await Promise.race([
      action(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${step} exceeded ${timeout}ms`)), timeout)),
    ]);
    recordStep({ step, result: 'passed', timeout, durationMs: Date.now() - started });
    return value;
  } catch (error) {
    const evidence = page ? await screenshot(page, `fail-${step.replace(/[^a-z0-9-]/gi, '_')}`).catch(() => null) : null;
    recordStep({ step, result: 'failed', timeout, durationMs: Date.now() - started, error: String(error?.message || error), evidence });
    throw error;
  }
}

async function loginViaUi(page, username, password, expectSuccess) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.locator('input[name="username"]').waitFor({ state: 'visible', timeout: TIMEOUTS.page });
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(1200);

  const token = await page.evaluate(() => localStorage.getItem('token'));
  if (expectSuccess) {
    expect(Boolean(token), `login should succeed for ${username}`);
    await page.waitForFunction(() => !document.querySelector('input[name="username"]'), null, { timeout: TIMEOUTS.page }).catch(() => {});
    return token;
  }
  expect(!token, `disabled login should not create token for ${username}`);
  const disabledMessageVisible = await page.getByText(/账号已停用|account is disabled|Tài khoản đã bị vô hiệu hóa/i).count();
  expect(disabledMessageVisible > 0, 'disabled login did not show a clear account-disabled message');
  return null;
}

async function createMemberViaUi(page) {
  await page.evaluate(() => { window.location.hash = '#team'; });
  await page.locator('[data-testid="team-new-member"]').waitFor({ state: 'visible', timeout: TIMEOUTS.page });
  await page.locator('[data-testid="team-new-member"]').click();
  await page.locator('[data-testid="team-create-form"]').waitFor({ state: 'visible', timeout: TIMEOUTS.page });
  await page.locator('[data-testid="team-username-input"]').fill(USERNAME);
  await page.locator('[data-testid="team-password-input"]').fill(PASSWORD);
  await page.locator('[data-testid="team-email-input"]').fill(`${USERNAME}@example.com`);
  await page.locator('[data-testid="team-member-role-select"]').selectOption('sales');
  await page.locator('[data-testid="team-segment-select"]').selectOption('direct');
  await page.locator('[data-testid="team-create-submit"]').click();
  await page.waitForFunction((username) => document.body.innerText.includes(username), USERNAME, { timeout: TIMEOUTS.save });
}

async function readMemberFromApi(page) {
  return page.evaluate(async (username) => {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/team', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await response.json();
    return {
      status: response.status,
      member: (json.data || []).find((item) => item.username === username) || null,
    };
  }, USERNAME);
}

async function saveReport() {
  ensureDir(OUTPUT_DIR);
  report.endedAt = new Date().toISOString();
  report.durationMs = new Date(report.endedAt).getTime() - new Date(report.startedAt).getTime();
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  ensureDir(SHOT_DIR);
  scriptTimer = setTimeout(() => {
    report.status = 'failed';
    report.failure = { stage: 'script-timeout', message: `Script exceeded ${TIMEOUTS.script}ms` };
    saveReport().finally(() => process.exit(1));
  }, TIMEOUTS.script);

  let browser;
  try {
    verifyStableRuntimeOrigin();
    const launch = await launchBrowserWithGuard({ recordStep, retryLimit: 1 });
    browser = launch.browser;
    report.browserLauncher = launch.launcher;

    const adminPage = await browser.newPage({ viewport: { width: 1440, height: 980 } });
    await withTimebox(adminPage, 'admin-login-ui', TIMEOUTS.page, () => loginViaUi(adminPage, 'admin', 'admin123', true));
    await withTimebox(adminPage, 'admin-create-sales-user-ui', TIMEOUTS.save, () => createMemberViaUi(adminPage));
    await screenshot(adminPage, 'admin-created-team-user');

    const readback = await withTimebox(adminPage, 'admin-readback-created-user-api', TIMEOUTS.page, () => readMemberFromApi(adminPage));
    expect(readback.status === 200, 'team readback failed', readback);
    expect(readback.member?.id, 'created member missing from team readback', readback);
    report.createdUserId = readback.member.id;

    const employeePage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await withTimebox(employeePage, 'employee-login-ui-before-disable', TIMEOUTS.page, () => loginViaUi(employeePage, USERNAME, PASSWORD, true));
    await screenshot(employeePage, 'employee-login-success-before-disable');

    await withTimebox(adminPage, 'admin-disable-user-ui', TIMEOUTS.save, async () => {
      const statusButton = adminPage.locator(`[data-testid="team-member-status-${readback.member.id}"]`);
      await statusButton.waitFor({ state: 'visible', timeout: TIMEOUTS.page });
      await statusButton.click();
      await adminPage.getByText('已停用', { exact: true }).last().waitFor({ state: 'visible', timeout: TIMEOUTS.save });
    });

    await employeePage.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await withTimebox(employeePage, 'employee-login-ui-after-disable-blocked', TIMEOUTS.page, () => loginViaUi(employeePage, USERNAME, PASSWORD, false));
    await screenshot(employeePage, 'employee-login-blocked-after-disable');

    report.status = 'passed';
  } catch (error) {
    if (error?.auditKind) {
      markReportFromLaunchError(report, error);
    } else {
      report.status = 'failed';
      report.failure = {
        message: String(error?.message || error),
        details: error?.details || null,
        stack: error?.stack || null,
      };
    }
    throw error;
  } finally {
    clearTimeout(scriptTimer);
    if (browser) await browser.close();
    await saveReport();
  }
}

main()
  .then(() => {
    console.log(`Team account lifecycle browser audit passed. Report: ${REPORT_PATH}`);
  })
  .catch((error) => {
    console.error(`Team account lifecycle browser audit failed: ${error?.message || error}`);
    process.exit(1);
  });
