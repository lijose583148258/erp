const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');
const { ensureUiAuditAccounts } = require('./lib/ui-audit-user.cjs');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright', 'receivable-adjustment-browser-audit-v1');
const REPORT_PATH = path.join(process.cwd(), 'output', 'playwright', 'receivable-adjustment-browser-audit-report-v1.json');
const SCRIPT_TIMEOUT_MS = 290_000;
const STEP_TIMEOUT_MS = 20_000;
const FLOW_TIMEOUT_MS = 60_000;
const REVERSE_DIALOG_TEST_ID = 'receivable-adjustment-reverse-dialog';
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${process.pid}`;
let ADMIN;
let SALES;

const copy = {
  panelTitle: '\u5e94\u6536\u8c03\u6574\u5de5\u4f5c\u53f0',
  createButton: '\u521b\u5efa\u8c03\u6574\u5355',
  ledgerTitle: '\u5e94\u6536\u8c03\u6574\u53f0\u8d26',
};

const report = {
  name: 'receivable-adjustment-browser-audit-v1',
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  status: 'running',
  steps: [],
  findings: [],
  seeded: {},
  consoleErrors: [],
  serverErrors: [],
  pageErrors: [],
};

let authToken = '';

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function saveReport() {
  ensureDir(path.dirname(REPORT_PATH));
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

function makeTestId(value) {
  return String(value ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function addFinding(entry) {
  report.findings.push({ at: new Date().toISOString(), ...entry });
}

async function withTimeout(name, timeoutMs, action) {
  const started = Date.now();
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    recordStep({ step: name, result: 'passed', durationMs: Date.now() - started, timeoutMs });
    return result;
  } catch (error) {
    recordStep({
      step: name,
      result: 'failed',
      durationMs: Date.now() - started,
      timeoutMs,
      error: String(error?.message || error),
    });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function assert(condition, message, evidence = {}) {
  if (!condition) {
    addFinding({ message, evidence });
    throw new Error(message);
  }
}

async function apiFetch(page, endpoint, options = {}, tokenOverride = '') {
  const response = await page.request.fetch(`${APP_URL}api${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...((tokenOverride || authToken) ? { Authorization: `Bearer ${tokenOverride || authToken}` } : {}),
      ...(options.headers || {}),
    },
    data: options.data,
    timeout: options.timeoutMs || STEP_TIMEOUT_MS,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: response.ok(), status: response.status(), json };
}

async function loginViaApi(page, credentials) {
  const response = await page.request.post(`${APP_URL}api/auth/login`, {
    data: credentials,
    timeout: STEP_TIMEOUT_MS,
  });
  const json = await response.json();
  assert(response.ok() && json?.data?.token && json?.data?.user, `login failed for ${credentials.username}`, {
    status: response.status(),
    body: json,
  });
  return json.data;
}

async function loginAndSeedStorage(page) {
  return withTimeout('login-and-seed-storage', STEP_TIMEOUT_MS, async () => {
    const adminLogin = await loginViaApi(page, ADMIN);
    authToken = adminLogin.token;
    const user = adminLogin.user;
    await page.addInitScript(({ token, savedUser }) => {
      const currentUser = {
        id: String(savedUser.id),
        name: savedUser.username,
        role: savedUser.role,
        segment: savedUser.segment || 'mixed',
        avatar: savedUser.avatar || '',
        permissions: savedUser.permissions || [],
      };
      window.localStorage.setItem('token', token);
      window.localStorage.setItem('user', JSON.stringify(currentUser));
      window.localStorage.setItem('ailao.activeTab', 'financeAnalytics');
      window.localStorage.setItem('ailao.language', 'zh');
      window.localStorage.setItem('currency', 'CNY');
    }, { token: authToken, savedUser: user });
    report.seeded.user = { id: user.id, username: user.username, role: user.role };
    return user;
  });
}

async function seedOrder(page) {
  return withTimeout('seed-order', STEP_TIMEOUT_MS, async () => {
    const salesLogin = await loginViaApi(page, SALES);
    report.seeded.salesUser = {
      id: salesLogin.user.id,
      username: salesLogin.user.username,
      role: salesLogin.user.role,
    };
    const customer = await apiFetch(page, '/customers', {
      method: 'POST',
      data: {
        nameZh: `\u5e94\u6536UI\u5ba2\u6237-${RUN_ID}`,
        nameEn: `Receivable UI Customer ${RUN_ID}`,
        nameVi: `Khach UI Phai Thu ${RUN_ID}`,
        licenseNumber: `RAUI-${RUN_ID}`,
        creditLimit: 100000,
        riskLevel: 'low',
        segment: 'direct',
        poolState: 'private',
        salespersonId: Number(salesLogin.user.id),
        contactName: 'Receivable UI Tester',
        contactPhone: `09${RUN_ID.slice(-8)}`,
        contactEmail: `ra-ui-${RUN_ID}@example.com`,
      },
    }, salesLogin.token);
    assert(customer.ok && customer.json?.data?.id, 'create browser audit customer failed', {
      status: customer.status,
      body: customer.json,
    }, salesLogin.token);

    const order = await apiFetch(page, '/orders', {
      method: 'POST',
      data: {
        customerId: Number(customer.json.data.id),
        items: [{
          productName: `\u5e94\u6536UI\u80f6\u6c34-${RUN_ID}`,
          specification: `RAUI-${RUN_ID}`,
          quantity: 1,
          unit: 'kg',
          unitPrice: 100,
        }],
        paymentTerms: 30,
        notes: `receivable-adjustment-browser-${RUN_ID}`,
      },
    });
    assert(order.ok && order.json?.data?.id, 'create browser audit order failed', {
      status: order.status,
      body: order.json,
    });
    report.seeded.customerId = Number(customer.json.data.id);
    report.seeded.orderId = Number(order.json.data.id);
    report.seeded.orderNo = order.json.data.orderNo;
    return order.json.data;
  });
}

async function openFinancePage(page) {
  return withTimeout('open-finance-page', STEP_TIMEOUT_MS, async () => {
    await page.goto(`${APP_URL}#financeAnalytics`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS });
    await page.waitForSelector('[data-testid="receivable-adjustment-panel"]', { timeout: STEP_TIMEOUT_MS });
    const bodyText = await page.locator('body').innerText({ timeout: STEP_TIMEOUT_MS });
    assert(bodyText.includes(copy.panelTitle), 'receivable adjustment panel title missing', { bodyText: bodyText.slice(0, 500) });
    assert(bodyText.includes(copy.ledgerTitle), 'receivable adjustment ledger title missing', { bodyText: bodyText.slice(0, 500) });
    assert(!bodyText.includes('\u667a\u4ed4'), 'wrong system text appeared on finance page');
    for (const forbidden of ['undefined', 'NaN', '\ufffd']) {
      assert(!bodyText.includes(forbidden), `forbidden UI token found: ${forbidden}`);
    }
  });
}

async function createAdjustmentByUi(page, order) {
  return withTimeout('create-adjustment-by-ui', FLOW_TIMEOUT_MS, async () => {
    const reason = `RA-UI-${RUN_ID}`;
    await page.waitForFunction(
      (orderId) => Array.from(document.querySelectorAll('#receivable-adjustment-order-options option'))
        .some((option) => String(option.getAttribute('value') || '').includes(`ID:${orderId}`)),
      order.id,
      { timeout: STEP_TIMEOUT_MS },
    );
    await page.getByTestId('receivable-adjustment-order').fill(`ID:${order.id}`);
    await page.getByTestId('receivable-adjustment-type').selectOption('discount_allowance');
    await page.getByTestId('receivable-adjustment-amount').fill('12.34');
    await page.getByTestId('receivable-adjustment-reason').fill(reason);
    await page.getByTestId('receivable-adjustment-note').fill(`browser audit note ${RUN_ID}`);
    await page.getByTestId('receivable-adjustment-create').click();

    const created = await waitForAdjustment(page, order.id, reason, 'pending');
    report.seeded.adjustmentId = created.id;
    report.seeded.adjustmentNo = created.adjustmentNo;
    const ledgerSearch = page.getByTestId('receivable-adjustment-search');
    if (await ledgerSearch.count()) {
      await ledgerSearch.fill(created.adjustmentNo);
    }
    await page.waitForSelector(`[data-testid="receivable-adjustment-post-${created.id}"]`, { timeout: STEP_TIMEOUT_MS });
    return created;
  });
}

async function waitForAdjustment(page, orderId, reason, expectedStatus) {
  const started = Date.now();
  while (Date.now() - started < STEP_TIMEOUT_MS) {
    const response = await apiFetch(page, `/finance/receivable-adjustments?orderId=${orderId}&pageSize=20`);
    const rows = Array.isArray(response.json?.data) ? response.json.data : [];
    const found = rows.find((row) => row.reason === reason && (!expectedStatus || row.status === expectedStatus));
    if (found) return found;
    await page.waitForTimeout(500);
  }
  throw new Error(`receivable adjustment ${reason} did not reach ${expectedStatus || 'any'} status`);
}

async function verifySalesOrderPaymentModal(page, order) {
  return withTimeout('verify-sales-order-payment-modal-effective-receivable', FLOW_TIMEOUT_MS, async () => {
    await page.goto(`${APP_URL}#orders`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS });
    const paymentDesk = page.getByTestId('sales-desk-payments');
    await paymentDesk.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    await paymentDesk.click();
    await page.waitForSelector('[data-testid="sales-order-payments-boundary-notice"]', { timeout: STEP_TIMEOUT_MS });
    const searchInput = page.getByTestId('sales-order-search');
    if (await searchInput.count()) {
      await searchInput.fill(String(order.orderNo || order.id));
    }
    const row = page.getByTestId(`sales-order-row-${makeTestId(order.id)}`);
    await row.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    await row.getByTestId('sales-order-payment-button').click();
    const paymentModal = page.getByTestId('sales-order-payment-modal');
    await paymentModal.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    const amountValue = Number(await page.getByTestId('sales-order-payment-amount').inputValue());
    assert(Math.abs(amountValue - 87.66) < 0.01, 'payment modal default amount did not use effective outstanding amount', {
      amountValue,
      expected: 87.66,
    });
    const summaryText = await page.getByTestId('sales-order-payment-effective-summary').innerText({ timeout: STEP_TIMEOUT_MS });
    assert(summaryText.includes('\u5e94\u6536\u8c03\u6574'), 'payment modal effective receivable summary missing adjustment label', { summaryText });
    await page.keyboard.press('Escape').catch(() => {});
    if (await paymentModal.isVisible().catch(() => false)) {
      await paymentModal.getByRole('button', { name: /关闭|close|đóng/i }).click();
    }
    await paymentModal.waitFor({ state: 'hidden', timeout: STEP_TIMEOUT_MS });
  });
}

async function postAndReverseByUi(page, order, adjustment) {
  return withTimeout('post-and-reverse-by-ui', FLOW_TIMEOUT_MS, async () => {
    await page.getByTestId(`receivable-adjustment-post-${adjustment.id}`).click();
    await waitForAdjustment(page, order.id, adjustment.reason, 'posted');
    const afterPost = await apiFetch(page, `/orders/${order.id}`);
    assert(afterPost.ok && afterPost.json?.data, 'order readback after post failed', afterPost);
    assert(Math.abs(Number(afterPost.json.data.receivableAdjustmentAmount || 0) - 12.34) < 0.01, 'posted adjustment did not update receivableAdjustmentAmount', {
      order: afterPost.json.data,
    });
    assert(Number(afterPost.json.data.paidAmount || 0) === 0, 'posted adjustment must not change paidAmount', {
      order: afterPost.json.data,
    });

    await verifySalesOrderPaymentModal(page, order);
    await openFinancePage(page);

    await page.getByTestId(`receivable-adjustment-reverse-${adjustment.id}`).click();
    await page.getByTestId(REVERSE_DIALOG_TEST_ID).waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    await page.getByTestId(`${REVERSE_DIALOG_TEST_ID}-input`).fill(`browser reverse ${RUN_ID}`);
    await page.getByTestId(`${REVERSE_DIALOG_TEST_ID}-confirm`).click();
    await waitForAdjustment(page, order.id, adjustment.reason, 'reversed');
    const afterReverse = await apiFetch(page, `/orders/${order.id}`);
    assert(afterReverse.ok && afterReverse.json?.data, 'order readback after reverse failed', afterReverse);
    assert(Math.abs(Number(afterReverse.json.data.receivableAdjustmentAmount || 0)) < 0.01, 'reverse did not restore receivableAdjustmentAmount', {
      order: afterReverse.json.data,
    });
  });
}

async function main() {
  ensureDir(OUTPUT_DIR);
  let browser = null;
  let context = null;
  const scriptTimer = setTimeout(() => {
    report.status = 'failed';
    report.failure = { stage: 'script-timeout', message: `Script timeout after ${SCRIPT_TIMEOUT_MS}ms` };
    saveReport();
    process.exit(1);
  }, SCRIPT_TIMEOUT_MS);

  try {
    const accounts = await ensureUiAuditAccounts('receivable_browser', ['admin', 'sales'], {
      password: process.env.RECEIVABLE_BROWSER_AUDIT_PASSWORD,
    });
    ADMIN = accounts.admin;
    SALES = accounts.sales;
    const launched = await launchBrowserWithGuard({ recordStep, retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    report.launcher = launched.launcher;
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) {
        report.consoleErrors.push({ type: message.type(), text: message.text() });
      }
    });
    page.on('response', async (response) => {
      if (response.status() < 500) return;
      let body = '';
      try {
        body = (await response.text()).slice(0, 600);
      } catch {
        body = '<unreadable>';
      }
      report.serverErrors.push({ status: response.status(), url: response.url(), body });
    });
    page.on('pageerror', (error) => report.pageErrors.push(String(error?.message || error)));

    await loginAndSeedStorage(page);
    const order = await seedOrder(page);
    await openFinancePage(page);
    const adjustment = await createAdjustmentByUi(page, order);
    await postAndReverseByUi(page, order, adjustment);
    const screenshot = path.join(OUTPUT_DIR, 'finance-receivable-adjustment-panel.png');
    await page.screenshot({ path: screenshot, fullPage: true, timeout: 5000 });
    report.screenshot = screenshot;
    assert(report.pageErrors.length === 0, 'browser page errors detected', { pageErrors: report.pageErrors });
    assert(report.serverErrors.length === 0, 'browser server 5xx responses detected', { serverErrors: report.serverErrors });
    assert(!report.consoleErrors.some((entry) => entry.type === 'error'), 'browser console errors detected', {
      consoleErrors: report.consoleErrors,
    });
    report.status = report.findings.length ? 'failed' : 'passed';
  } catch (error) {
    markReportFromLaunchError(report, error);
    if (!report.status || report.status === 'running') report.status = 'failed';
    report.failure = {
      message: String(error?.message || error),
      stack: error?.stack || null,
    };
    if (report.status !== 'blocked_env') process.exitCode = 1;
  } finally {
    clearTimeout(scriptTimer);
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    saveReport();
    console.log(`Receivable adjustment browser audit ${report.status}. Report: ${REPORT_PATH}`);
  }
}

main();
