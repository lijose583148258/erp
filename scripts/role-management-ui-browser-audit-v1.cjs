const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.resolve(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'role-management-ui-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'role-management-ui-browser-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const ROLE_CODE = `ui_role_${RUN_ID}`;
const USERNAME = `ui_role_user_${RUN_ID}`;
const PASSWORD = 'Audit12345';

const TIMEOUTS = {
  script: 290_000,
  pageLoad: 18_000,
  login: 20_000,
  route: 15_000,
  save: 20_000,
  readBack: 15_000,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  roleCode: ROLE_CODE,
  username: USERNAME,
  status: 'running',
  steps: [],
  screenshots: [],
  findings: [],
};

let scriptTimer = null;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
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
    const result = await Promise.race([
      action(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${step} exceeded ${timeout}ms`)), timeout)),
    ]);
    recordStep({ step, result: 'passed', timeout, durationMs: Date.now() - started });
    return result;
  } catch (error) {
    const evidence = page ? await screenshot(page, `fail-${step.replace(/[^a-z0-9-]/gi, '_')}`).catch(() => null) : null;
    recordStep({
      step,
      result: 'failed',
      timeout,
      durationMs: Date.now() - started,
      error: String(error?.message || error),
      evidence,
    });
    throw error;
  }
}

function expect(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

async function login(page) {
  await withTimebox(page, 'open-login', TIMEOUTS.pageLoad, async () => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  });

  const usernameInput = page.locator('input[name="username"]');
  if (!(await usernameInput.count())) {
    recordStep({ step: 'login-form-detection', result: 'skipped', reason: 'already authenticated or no login form' });
    return;
  }

  await withTimebox(page, 'submit-admin-login', TIMEOUTS.login, async () => {
    await usernameInput.fill('admin');
    await page.locator('input[name="password"]').fill('admin123');
    await page.locator('button[type="submit"]').click();
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
  });
}

async function openTeam(page) {
  await withTimebox(page, 'open-team-route', TIMEOUTS.route, async () => {
    await page.evaluate(() => {
      window.location.hash = '#team';
    });
    await page.locator('[data-testid="role-management-panel"]').waitFor({ state: 'visible', timeout: TIMEOUTS.route });
  });
  const text = await page.locator('body').innerText();
  expect(text.includes('ERP+CRM'), 'shell missing ERP+CRM brand');
  expect(text.includes('角色权限管理') || text.includes('Role & Permission Management'), 'role panel title missing');
  await screenshot(page, 'team-role-panel-loaded');
}

async function ensureChecked(page, testId) {
  const checkbox = page.locator(`[data-testid="${testId}"]`);
  await checkbox.waitFor({ state: 'attached', timeout: TIMEOUTS.readBack });
  if (!(await checkbox.isChecked())) {
    await checkbox.check({ force: true });
  }
}

async function createRoleFromUi(page) {
  await withTimebox(page, 'create-role-from-ui', TIMEOUTS.save, async () => {
    await page.locator('[data-testid="role-create-start"]').click();
    await page.locator('[data-testid="role-code-input"]').fill(ROLE_CODE);
    await page.locator('[data-testid="role-name-input"]').fill(`UI审计角色 ${RUN_ID}`);
    await page.locator('[data-testid="role-description-input"]').fill('Created by role-management-ui-browser-audit-v1');
    await ensureChecked(page, 'role-permission-dashboard.read');
    await ensureChecked(page, 'role-permission-customers.read');
    await ensureChecked(page, 'role-permission-orders.read');
    await page.locator('[data-testid="role-save"]').click();
    await page.locator(`[data-testid="role-card-${ROLE_CODE}"]`).waitFor({ state: 'visible', timeout: TIMEOUTS.save });
  });
  await screenshot(page, 'role-created-readback-in-ui');
}

async function createUserWithCustomRole(page) {
  await withTimebox(page, 'create-user-with-custom-role', TIMEOUTS.save, async () => {
    await page.locator('[data-testid="team-new-member"]').click();
    await page.locator('[data-testid="team-create-form"]').waitFor({ state: 'visible', timeout: TIMEOUTS.route });
    await page.locator('[data-testid="team-username-input"]').fill(USERNAME);
    await page.locator('[data-testid="team-password-input"]').fill(PASSWORD);
    await page.locator('[data-testid="team-email-input"]').fill(`${USERNAME}@example.com`);
    await page.locator('[data-testid="team-member-role-select"]').selectOption(ROLE_CODE);
    await page.locator('[data-testid="team-segment-select"]').selectOption('direct');
    await page.locator('[data-testid="team-create-submit"]').click();
    await page.locator('body').filter({ hasText: USERNAME }).waitFor({ state: 'visible', timeout: TIMEOUTS.save });
  });
  await screenshot(page, 'custom-role-user-created');
}

async function apiReadbackFromBrowser(page) {
  return withTimebox(page, 'browser-api-readback', TIMEOUTS.readBack, async () => {
    const result = await page.evaluate(async ({ roleCode, username }) => {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      const [rolesResponse, teamResponse] = await Promise.all([
        fetch('/api/roles', { headers }),
        fetch('/api/team', { headers }),
      ]);
      const rolesJson = await rolesResponse.json();
      const teamJson = await teamResponse.json();
      return {
        roleStatus: rolesResponse.status,
        teamStatus: teamResponse.status,
        role: (rolesJson.data || []).find((item) => item.code === roleCode) || null,
        user: (teamJson.data || []).find((item) => item.username === username) || null,
      };
    }, { roleCode: ROLE_CODE, username: USERNAME });

    expect(result.roleStatus === 200, 'role readback API failed', result);
    expect(result.teamStatus === 200, 'team readback API failed', result);
    expect(result.role?.code === ROLE_CODE, 'created role missing from API readback', result);
    expect(result.role?.permissions?.includes('customers.read'), 'created role missing customers.read after UI save', result);
    expect(result.user?.role === ROLE_CODE, 'created user missing custom role after UI save', result);
    return result;
  });
}

async function scanVisibleText(page) {
  await withTimebox(page, 'visible-text-gate', TIMEOUTS.readBack, async () => {
    const text = await page.locator('body').innerText();
    const replacementChar = String.fromCharCode(0xfffd);
    const forbidden = [replacementChar.repeat(3), replacementChar, 'undefined undefined'];
    const hit = forbidden.find((token) => text.includes(token));
    expect(!hit, `visible text contains forbidden token: ${hit}`, { hit });
  });
}

async function saveReport() {
  report.endedAt = new Date().toISOString();
  report.durationMs = new Date(report.endedAt).getTime() - new Date(report.startedAt).getTime();
  ensureDir(OUTPUT_DIR);
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
    const launch = await launchBrowserWithGuard({ recordStep, retryLimit: 1 });
    browser = launch.browser;
    report.browserLauncher = launch.launcher;
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });

    await login(page);
    await openTeam(page);
    await scanVisibleText(page);
    await createRoleFromUi(page);
    await createUserWithCustomRole(page);
    const readback = await apiReadbackFromBrowser(page);
    recordStep({ step: 'api-readback-summary', result: 'passed', role: readback.role, userId: readback.user?.id });

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
    console.log(`Role management UI browser audit passed. Report: ${REPORT_PATH}`);
  })
  .catch((error) => {
    console.error(`Role management UI browser audit failed: ${error?.message || error}`);
    process.exit(1);
  });
