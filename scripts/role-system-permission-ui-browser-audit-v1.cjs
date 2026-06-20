const fs = require('fs');
const path = require('path');
const bcrypt = require('../backend/node_modules/bcryptjs');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.resolve(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'role-system-permission-ui-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'role-system-permission-ui-browser-audit-report-v1.json');
const ORIGIN_REPORT = path.resolve(process.cwd(), 'output', 'audit', 'stable-runtime-origin-v1.json');
const PERMISSION = 'warehouse.ledger.read';
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const ADMIN = { username: `role_ui_admin_${RUN_ID}`, password: 'AuditAdmin12345' };
const TIMEOUTS = { script: 290_000, page: 20_000, save: 20_000 };

if (!process.env.DATABASE_URL) {
  try {
    const origin = JSON.parse(fs.readFileSync(ORIGIN_REPORT, 'utf8').replace(/^\uFEFF/, ''));
    if (origin?.runtimeDbPath) {
      process.env.DATABASE_URL = `file:${String(origin.runtimeDbPath).replace(/\\/g, '/')}`;
    }
  } catch {}
}

const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();
const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
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
    recordStep({ step, result: 'passed', durationMs: Date.now() - started, timeout });
    return value;
  } catch (error) {
    const evidence = page ? await screenshot(page, `fail-${step.replace(/[^a-z0-9-]/gi, '_')}`).catch(() => null) : null;
    recordStep({ step, result: 'failed', durationMs: Date.now() - started, timeout, error: String(error?.message || error), evidence });
    throw error;
  }
}

async function ensureAuditAdmin() {
  const passwordHash = await bcrypt.hash(ADMIN.password, 12);
  await prisma.user.upsert({
    where: { username: ADMIN.username },
    update: {
      passwordHash,
      role: 'admin',
      segment: 'mixed',
      email: `${ADMIN.username}@example.com`,
      isActive: true,
      mustChangePassword: false,
    },
    create: {
      username: ADMIN.username,
      passwordHash,
      role: 'admin',
      segment: 'mixed',
      email: `${ADMIN.username}@example.com`,
      isActive: true,
      mustChangePassword: false,
    },
  });
}

async function login(page) {
  await ensureAuditAdmin();
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  const username = page.locator('input[name="username"]');
  if (await username.count()) {
    await username.fill(ADMIN.username);
    await page.locator('input[name="password"]').fill(ADMIN.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await page.locator('input[name="username"]').waitFor({ state: 'detached', timeout: TIMEOUTS.page }).catch(() => {});
    expect(await page.locator('input[name="username"]').count() === 0, 'audit admin login did not leave login page');
  }
}

async function getSalesRoleFromBrowser(page) {
  return page.evaluate(async () => {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/roles', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await response.json();
    return {
      status: response.status,
      role: (json.data || []).find((item) => item.code === 'sales') || null,
    };
  });
}

async function waitForSalesPermission(page, expected) {
  await page.waitForFunction(async ({ permission, expectedValue }) => {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/roles', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status !== 200) return false;
    const json = await response.json();
    const role = (json.data || []).find((item) => item.code === 'sales');
    return Boolean(role?.permissions?.includes(permission)) === expectedValue;
  }, { permission: PERMISSION, expectedValue: expected }, { timeout: TIMEOUTS.save });
}

async function setPermissionViaUi(page, checked) {
  await page.locator('[data-testid="role-card-sales"]').click();
  await page.locator('[data-testid="role-permission-search"]').fill(PERMISSION);
  const checkbox = page.locator(`[data-testid="role-permission-${PERMISSION}"]`);
  await checkbox.waitFor({ state: 'attached', timeout: TIMEOUTS.page });
  const before = await checkbox.isChecked();
  if (before !== checked) {
    if (checked) await checkbox.check({ force: true });
    else await checkbox.uncheck({ force: true });
  } else {
    return { changed: false };
  }
  await page.locator('[data-testid="role-save"]').click();
  await page.locator('[data-testid="role-change-review"]').waitFor({ state: 'visible', timeout: TIMEOUTS.save });
  await page.locator('[data-testid="role-save"]').click();
  await waitForSalesPermission(page, checked);
  return { changed: true };
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
  let originalHasPermission = null;
  try {
    const launch = await launchBrowserWithGuard({ recordStep, retryLimit: 1 });
    browser = launch.browser;
    report.browserLauncher = launch.launcher;
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });

    await withTimebox(page, 'audit-admin-login', TIMEOUTS.page, () => login(page));
    await withTimebox(page, 'roles-loading-fails-closed', TIMEOUTS.page, async () => {
      await page.route('**/api/roles', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.continue();
      });
      await page.evaluate(() => { window.location.hash = '#team'; });
      await page.locator('[data-testid="role-management-unavailable"]').waitFor({ state: 'visible', timeout: TIMEOUTS.page });
      expect(await page.locator('[data-testid="role-save"]').count() === 0, 'role save must be unavailable while roles are loading');
      await page.locator('[data-testid="role-management-panel"]').waitFor({ state: 'visible', timeout: TIMEOUTS.page });
      await page.unroute('**/api/roles');
    });
    await withTimebox(page, 'roles-error-fails-closed', TIMEOUTS.page, async () => {
      await page.route('**/api/roles', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'forced role load failure' }),
        });
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('[data-testid="role-management-unavailable"]').waitFor({ state: 'visible', timeout: TIMEOUTS.page });
      await page.locator('[data-testid="role-load-retry"]').waitFor({ state: 'visible', timeout: TIMEOUTS.page });
      expect(await page.locator('[data-testid="role-save"]').count() === 0, 'role save must be unavailable after role load failure');
      await page.unroute('**/api/roles');
      await page.locator('[data-testid="role-load-retry"]').click();
      await page.locator('[data-testid="role-management-panel"]').waitFor({ state: 'visible', timeout: TIMEOUTS.page });
    });

    const initial = await getSalesRoleFromBrowser(page);
    expect(initial.status === 200, 'admin could not read roles from browser', initial);
    expect(initial.role?.code === 'sales', 'sales role missing from browser readback', initial);
    originalHasPermission = Boolean(initial.role.permissions?.includes(PERMISSION));
    recordStep({ step: 'read-original-sales-permission', result: 'passed', originalHasPermission });

    await withTimebox(page, 'ui-grant-sales-warehouse-ledger', TIMEOUTS.save, () => setPermissionViaUi(page, true));
    await screenshot(page, 'sales-ledger-granted');
    await withTimebox(page, 'ui-revoke-sales-warehouse-ledger', TIMEOUTS.save, () => setPermissionViaUi(page, false));
    await screenshot(page, 'sales-ledger-revoked');

    report.status = 'passed';
  } catch (error) {
    if (error?.auditKind) markReportFromLaunchError(report, error);
    else {
      report.status = 'failed';
      report.failure = {
        message: String(error?.message || error),
        details: error?.details || null,
        stack: error?.stack || null,
      };
    }
    throw error;
  } finally {
    try {
      if (browser && originalHasPermission !== null) {
        const restorePage = (await browser.contexts()[0]?.pages()?.[0]) || await browser.newPage();
        await setPermissionViaUi(restorePage, originalHasPermission);
        recordStep({ step: 'restore-original-sales-permission', result: 'passed', restoredHasPermission: originalHasPermission });
      }
    } catch (restoreError) {
      report.status = 'failed';
      report.failure = {
        stage: 'restore-original-sales-permission',
        message: String(restoreError?.message || restoreError),
      };
    }
    if (scriptTimer) clearTimeout(scriptTimer);
    if (browser) await browser.close();
    await prisma.$disconnect();
    await saveReport();
  }
}

main()
  .then(() => {
    if (report.status !== 'passed') {
      console.error(`Role system permission UI browser audit failed: ${report.failure?.message || report.status}`);
      process.exit(1);
    }
    console.log(`Role system permission UI browser audit passed. Report: ${REPORT_PATH}`);
  })
  .catch((error) => {
    console.error(`Role system permission UI browser audit failed: ${error?.message || error}`);
    process.exit(1);
  });
