const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');
const { createAuditRuntime, ensureDir } = require('./lib/audit-runtime-utils.cjs');
const {
  assertNoBrowserRuntimeErrors,
  openCollectionsRoute,
  setupBrowserContext,
} = require('./lib/collection-human-flow-browser.cjs');

const ROOT = process.cwd();
const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'collection-overdue-server-pagination-browser-audit-v1');
const REPORT_PATH = path.join(ROOT, 'output', 'playwright', 'collection-overdue-server-pagination-browser-audit-report-v1.json');
const ADMIN = { username: 'admin', password: 'admin123' };
const STEP_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 290_000;
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${process.pid}_${Math.random().toString(36).slice(2, 7)}`;
const runtimeDbPath = process.env.AILAODA_RUNTIME_DB_PATH || 'D:/AilaoDaRuntime/stable.db';
process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${runtimeDbPath.replace(/\\/g, '/')}`;
const { PrismaClient } = require(path.join(ROOT, 'backend', 'node_modules', '@prisma', 'client'));

const copy = {
  workbench: '\u56de\u6b3e\u5de5\u4f5c\u53f0',
  overdue: '\u903e\u671f\u6e05\u5355',
  promiseNav: '\u627f\u8bfa\u8ddf\u8fdb',
};
const forbiddenTokens = ['\ufffd', 'undefined', 'NaN', '\u935a', '\u9359', '\u95ab', '\u93c0', '\u9428', '\u7035', '\u93c6', '\u941c', '\u8216', '\u20ac'];

const report = {
  name: 'collection-overdue-server-pagination-browser-audit-v1',
  appUrl: APP_URL,
  runtimeDbPath,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  status: 'running',
  steps: [],
  consoleErrors: [],
  pageErrors: [],
  seeded: {},
};

const runtime = createAuditRuntime({
  appUrl: APP_URL,
  outputDir: OUTPUT_DIR,
  report,
  reportPath: REPORT_PATH,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
});

async function loginAdmin() {
  return runtime.withTimeout('api-login-admin', STEP_TIMEOUT_MS, async () => {
    const response = await runtime.apiFetch('/auth/login', {
      method: 'POST',
      data: ADMIN,
    });
    runtime.expectStatus(response, [200], 'admin login');
    const data = runtime.dataOf(response);
    runtime.expect(Boolean(data?.token), 'admin login returned no token', response.json);
    return { token: data.token, user: data.user };
  });
}

async function seedPaginatedOverdueOrders(token, prisma) {
  return runtime.withTimeout('seed-paginated-overdue-orders', STEP_TIMEOUT_MS * 3, async () => {
    const customerName = `SRCH-PAGE-${RUN_ID} Customer`;
    const customerResponse = await runtime.apiFetch('/customers', {
      method: 'POST',
      data: {
        nameZh: customerName,
        nameEn: customerName,
        nameVi: `SRCH-PAGE-${RUN_ID} Khach Hang`,
        licenseNumber: `LIC-PAGE-${RUN_ID}`.slice(0, 64),
        creditLimit: 200000,
        riskLevel: 'medium',
        segment: 'direct',
        contactName: `Pagination Contact ${RUN_ID}`,
        contactPhone: `090${String(Date.now()).slice(-7)}`,
        contactEmail: `pagination-${RUN_ID}@example.com`,
        address: `Pagination audit address ${RUN_ID}`,
        status: 'active',
      },
    }, token);
    runtime.expectStatus(customerResponse, [201], 'create pagination customer');
    const customer = runtime.dataOf(customerResponse);
    runtime.expect(Boolean(customer?.id), 'pagination customer create returned no id', customerResponse.json);

    const orders = [];
    for (let index = 0; index < 12; index += 1) {
      const orderResponse = await runtime.apiFetch('/orders', {
        method: 'POST',
        data: {
          customerId: Number(customer.id),
          items: [{
            productName: `Pagination Resin ${RUN_ID}-${String(index + 1).padStart(2, '0')}`,
            specification: 'server-pagination-browser-audit',
            quantity: 10 + index,
            unit: 'kg',
            unitPrice: 100,
          }],
          paymentTerms: 1,
          notes: `collection overdue server pagination browser audit ${RUN_ID}`,
        },
      }, token);
      runtime.expectStatus(orderResponse, [201], `create pagination order ${index + 1}`);
      const order = runtime.dataOf(orderResponse);
      runtime.expect(Boolean(order?.id), `pagination order ${index + 1} returned no id`, orderResponse.json);
      orders.push({ id: Number(order.id), orderNo: order.orderNo });
    }

    await prisma.order.updateMany({
      where: { id: { in: orders.map((order) => order.id) } },
      data: {
        createdAt: new Date(Date.now() - 12 * 24 * 3600 * 1000),
        updatedAt: new Date(),
      },
    });

    const syncResponse = await runtime.apiFetch('/collections/sync-overdue', { method: 'POST' }, token);
    runtime.expectStatus(syncResponse, [200], 'sync overdue after pagination seed');

    report.seeded = {
      customerId: Number(customer.id),
      customerName,
      orderIds: orders.map((order) => order.id),
      orderNos: orders.map((order) => order.orderNo),
    };
    return report.seeded;
  });
}

async function assertPaginationByBrowser(page, seed) {
  return runtime.withTimeout('browser-server-pagination-readback', STEP_TIMEOUT_MS * 2, async () => {
    await page.getByTestId('collection-tab-overdue').click();
    await page.getByTestId('collection-overdue-search').fill(seed.customerName);

    const firstPageExpectedId = Math.max(...seed.orderIds);
    const secondPageExpectedId = Math.min(...seed.orderIds);
    const firstPageRow = page.getByTestId(`collection-overdue-row-${firstPageExpectedId}`);
    await firstPageRow.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    await page.getByTestId('collection-overdue-page-size').selectOption('10');
    await firstPageRow.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    const nextButton = page.getByTestId('collection-overdue-next');
    await nextButton.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-testid="collection-overdue-next"]');
      return Boolean(button && !button.disabled);
    }, null, { timeout: STEP_TIMEOUT_MS });
    runtime.expect(!(await nextButton.isDisabled()), 'server pagination next button stayed disabled after 12 matching rows');

    const page1Screenshot = await runtime.saveScreenshot(page, '01-overdue-search-page-1');
    await nextButton.click();
    const secondPageRow = page.getByTestId(`collection-overdue-row-${secondPageExpectedId}`);
    await secondPageRow.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    const page2Screenshot = await runtime.saveScreenshot(page, '02-overdue-search-page-2');
    const bodyText = await runtime.assertBodyClean(page, 'collection overdue server pagination', forbiddenTokens);
    runtime.expect(bodyText.includes(seed.customerName), 'search result lost customer name after moving to page 2');
    report.readback = {
      firstPageExpectedId,
      secondPageExpectedId,
      screenshots: [page1Screenshot, page2Screenshot],
    };
  });
}

async function main() {
  ensureDir(OUTPUT_DIR);
  let prisma = null;
  let browser = null;
  let context = null;
  const scriptTimer = setTimeout(() => {
    report.status = 'failed';
    report.failure = { stage: 'script-timeout', message: `Script timeout after ${SCRIPT_TIMEOUT_MS}ms` };
    runtime.saveReport().finally(() => process.exit(1));
  }, SCRIPT_TIMEOUT_MS);

  try {
    prisma = new PrismaClient();
    const admin = await loginAdmin();
    const seed = await seedPaginatedOverdueOrders(admin.token, prisma);
    const launched = await launchBrowserWithGuard({ recordStep: runtime.recordStep, retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    report.launcher = launched.launcher;
    const browserSetup = await setupBrowserContext(browser, admin, report);
    context = browserSetup.context;
    const page = browserSetup.page;
    await openCollectionsRoute(runtime, page, { appUrl: APP_URL, copy, forbiddenTokens, stepTimeoutMs: STEP_TIMEOUT_MS });
    await assertPaginationByBrowser(page, seed);
    assertNoBrowserRuntimeErrors(runtime, report);
    report.status = 'passed';
  } catch (error) {
    markReportFromLaunchError(report, error);
    if (!report.status || report.status === 'running') report.status = 'failed';
    report.failure = {
      message: String(error?.message || error),
      status: error?.status || null,
      details: error?.details || null,
      stack: error?.stack || null,
    };
    if (report.status !== 'blocked_env') process.exitCode = 1;
  } finally {
    clearTimeout(scriptTimer);
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (prisma) await prisma.$disconnect().catch(() => {});
    await runtime.saveReport();
    console.log(`Collection overdue server-pagination browser audit ${report.status}. Report: ${REPORT_PATH}`);
  }
}

main();
