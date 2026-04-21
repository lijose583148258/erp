const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');

const APP_URL = 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'sales-orders-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'sales-orders-audit-report-v1.json');

const UI = {
  routeName: '\u8ba2\u5355',
  newOrder: /\u65b0\u5efa\u8ba2\u5355|\u5f55\u5165\u65b0\u9500\u552e\u5355|New Order|Create Order/i,
  recordPaymentTitle: /\u56de\u6b3e|\u6536\u6b3e|Payment/i,
  historyTitle: /\u5386\u53f2|History|Activity/i,
};

const REQUIRED_ROUTE_COPY = ['\u8ba2\u5355'];
const FORBIDDEN_MOJIBAKE = ['undefined', '\ufffd', '\u951f\u91d1\u62f7'];

const TIMEOUTS = {
  login: 15000,
  route: 20000,
  fill: 25000,
  save: 25000,
  api: 15000,
  modal: 12000,
  readBack: 15000,
};

const runId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const TEST_DATA = {
  productName: `SO-AUDIT-PROD-${runId}`,
  packaging: `BOX-${runId.slice(-4)}`,
  quantity: 5,
  unit: 'kg',
  unitPrice: 99,
  taxAmount: 0,
  paymentAmount: 128,
  paymentNote: `SO-PAY-${runId}`,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  testData: TEST_DATA,
  steps: [],
  status: 'running',
};

let authToken = '';

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

async function safeScreenshot(page, name) {
  const filePath = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function withTimebox(page, step, timeout, task) {
  const started = Date.now();
  try {
    const result = await Promise.race([
      task(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${step} exceeded ${timeout}ms`)), timeout)),
    ]);
    recordStep({ step, timeout, result: 'passed', durationMs: Date.now() - started });
    return result;
  } catch (error) {
    const screenshot = await safeScreenshot(page, `fail-${step}`);
    recordStep({
      step,
      timeout,
      result: 'failed',
      durationMs: Date.now() - started,
      error: String(error.message || error),
      screenshot,
    });
    throw error;
  }
}

async function seedLoginState(page) {
  return withTimebox(page, 'seed-login-state', TIMEOUTS.login, async () => {
    const loginResponse = await page.request.post(`${APP_URL}api/auth/login`, {
      data: { username: 'admin', password: 'admin123', role: 'super_admin' },
    });
    if (!loginResponse.ok()) throw new Error(`login api failed: ${loginResponse.status()}`);

    const loginJson = await loginResponse.json();
    const token = loginJson?.data?.token;
    const user = loginJson?.data?.user;
    if (!token || !user) throw new Error('login api returned empty token or user');
    authToken = token;

    await page.addInitScript(({ savedToken, savedUser }) => {
      const appUser = {
        id: String(savedUser.id),
        name: savedUser.username,
        role: savedUser.role,
        segment: savedUser.segment || 'mixed',
        avatar: savedUser.avatar || '',
      };
      window.localStorage.setItem('token', savedToken);
      window.localStorage.setItem('user', JSON.stringify(appUser));
      window.localStorage.setItem('auth_token', savedToken);
      window.localStorage.setItem('erp_auth_token', savedToken);
      window.localStorage.setItem('currentUser', JSON.stringify(savedUser));
      window.localStorage.setItem('erp_current_user', JSON.stringify(savedUser));
      window.localStorage.setItem('erp_current_role', savedUser.role || 'super_admin');
      window.localStorage.setItem('ailao.activeTab', 'orders');
      window.localStorage.setItem('ailao.language', 'zh');
      window.localStorage.setItem('language', 'zh-CN');
      window.localStorage.setItem('currency', 'CNY');
    }, { savedToken: token, savedUser: user });

    return { token, user };
  });
}

async function apiFetch(page, endpoint, options = {}) {
  const method = options.method || 'GET';
  const response = await page.request.fetch(`${APP_URL}api${endpoint}`, {
    ...options,
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {}),
    },
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

function unwrapList(payload) {
  const data = payload?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function assertNoMojibake(text, scopeName) {
  for (const keyword of FORBIDDEN_MOJIBAKE) {
    if (text.includes(keyword)) {
      throw new Error(`${scopeName} contains mojibake: ${keyword}`);
    }
  }
  if (text.includes('undefined') || text.includes('\ufffd')) {
    throw new Error(`${scopeName} contains visible undefined or replacement char`);
  }
}

async function openOrders(page) {
  await withTimebox(page, 'open-orders-route', TIMEOUTS.route, async () => {
    await page.goto(`${APP_URL}#orders`, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.route });
    await page.evaluate(() => {
      window.localStorage.setItem('ailao.activeTab', 'orders');
      window.location.hash = '#orders';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    for (let index = 0; index < 30; index += 1) {
      const bodyText = await page.locator('body').innerText();
      const hasRequired = REQUIRED_ROUTE_COPY.some((item) => bodyText.includes(item));
      if (hasRequired) {
        assertNoMojibake(bodyText, 'sales-orders route');
        return;
      }
      await page.waitForTimeout(500);
    }
    throw new Error('orders route not ready');
  });

  const shot = await safeScreenshot(page, 'orders-route');
  recordStep({ step: 'orders-route-evidence', result: 'passed', evidence: shot });
}

async function selectFirstRealOption(selectLocator) {
  const value = await selectLocator.evaluate((element) => {
    const options = Array.from(element.options || []);
    const target = options.find((option) => option.value && !option.disabled);
    return target ? target.value : '';
  });
  if (!value) throw new Error('no selectable option found');
  await selectLocator.selectOption(value);
  return value;
}

function extractMarker(rowText) {
  const line = String(rowText || '').split('\n').find(Boolean) || '';
  const hashMatch = line.match(/#\d+/);
  if (hashMatch) return hashMatch[0];
  const orderMatch = rowText.match(/ORD-[A-Z0-9-]+/i);
  if (orderMatch) return orderMatch[0];
  return line.trim().slice(0, 32);
}

async function createOrder(page) {
  return withTimebox(page, 'create-sales-order', TIMEOUTS.save, async () => {
    const beforeFirstRowText = await page.locator('tbody tr').first().innerText().catch(() => '');

    const createButton = page.locator('button').filter({ hasText: UI.newOrder }).first();
    if (!(await createButton.count())) throw new Error('new order button not found');
    await createButton.click();

    const modal = page.locator('div.fixed.inset-0').last();
    await modal.waitFor({ state: 'visible', timeout: TIMEOUTS.modal });

    const selects = modal.locator('select');
    const inputs = modal.locator('input:not([type="file"]):not([type="checkbox"])');

    await selectFirstRealOption(selects.nth(1));
    await inputs.nth(1).fill(TEST_DATA.productName);
    await inputs.nth(2).fill(TEST_DATA.packaging);
    await inputs.nth(3).fill(String(TEST_DATA.quantity));
    await inputs.nth(4).fill(TEST_DATA.unit);
    await inputs.nth(5).fill(String(TEST_DATA.unitPrice));
    await inputs.nth(6).fill(String(TEST_DATA.taxAmount));

    const buttons = modal.locator('button');
    const count = await buttons.count();
    if (!count) throw new Error('order save button not found');
    await buttons.nth(count - 1).click();

    let createdRow = null;
    for (let index = 0; index < 30; index += 1) {
      const row = page.locator('tbody tr').first();
      if (await row.count()) {
        const currentText = await row.innerText();
        if (currentText && currentText !== beforeFirstRowText) {
          createdRow = row;
          report.createdRowText = currentText;
          report.createdRowMarker = extractMarker(currentText);
          break;
        }
      }
      await page.waitForTimeout(400);
    }

    if (!createdRow) throw new Error('new order row did not appear');
    const shot = await safeScreenshot(page, 'sales-order-created');
    recordStep({ step: 'sales-order-created-evidence', result: 'passed', evidence: shot, rowMarker: report.createdRowMarker });
    return createdRow;
  });
}

async function findCreatedOrderByApi(page) {
  return withTimebox(page, 'verify-order-created-readback', TIMEOUTS.api, async () => {
    const markerId = String(report.createdRowMarker || '').match(/#(\d+)/)?.[1];
    if (markerId) {
      const detailResponse = await apiFetch(page, `/orders/${markerId}`);
      if (!detailResponse.ok) throw new Error(`order detail api failed: ${detailResponse.status}`);
      const detail = detailResponse.json?.data;
      const hasProduct = Array.isArray(detail?.items) && detail.items.some((line) => line.productName === TEST_DATA.productName);
      if (!hasProduct) throw new Error('created order detail does not contain expected product');
      report.createdOrder = {
        id: detail.id,
        orderNo: detail.orderNo,
        customerName: detail.customerName || detail.customerDisplayName,
        paidAmount: Number(detail.paidAmount || 0),
        paymentStatus: detail.paymentStatus,
      };
      return detail;
    }

    const response = await apiFetch(page, '/orders?pageSize=100');
    if (!response.ok) throw new Error(`orders api failed: ${response.status}`);
    const created = unwrapList(response).find((item) => Array.isArray(item.items) && item.items.some((line) => line.productName === TEST_DATA.productName));
    if (!created) throw new Error('created order not found by API readback');
    report.createdOrder = {
      id: created.id,
      orderNo: created.orderNo,
      customerName: created.customerName || created.customerDisplayName,
      paidAmount: Number(created.paidAmount || 0),
      paymentStatus: created.paymentStatus,
    };
    return created;
  });
}

async function recordPaymentForRow(page, row) {
  await withTimebox(page, 'record-order-payment', TIMEOUTS.save, async () => {
    await row.hover();
    const paymentButton = row.locator('button[title*="Payment"], button[title*="\u56de\u6b3e"], button[title*="\u6536\u6b3e"]').first();
    if (!(await paymentButton.count())) throw new Error('payment action button not found');
    await paymentButton.click();

    const payModal = page.locator('div.fixed.inset-0').last();
    await payModal.waitFor({ state: 'visible', timeout: TIMEOUTS.modal });
    const payInputs = payModal.locator('input:not([type="checkbox"])');
    await payInputs.nth(0).fill(String(TEST_DATA.paymentAmount));
    await payInputs.last().fill(TEST_DATA.paymentNote);

    const buttons = payModal.locator('button');
    const count = await buttons.count();
    if (!count) throw new Error('payment confirm button not found');
    await buttons.nth(count - 1).click();
    await page.waitForTimeout(1200);
  });

  const shot = await safeScreenshot(page, 'sales-order-payment-recorded');
  recordStep({ step: 'sales-order-payment-recorded-evidence', result: 'passed', evidence: shot, paymentNote: TEST_DATA.paymentNote });
}

async function verifyPaymentByApi(page, orderId) {
  return withTimebox(page, 'verify-payment-api-readback', TIMEOUTS.api, async () => {
    const response = await apiFetch(page, `/orders/${orderId}`);
    if (!response.ok) throw new Error(`order detail api failed: ${response.status}`);
    const order = response.json?.data;
    const payment = Array.isArray(order?.paymentRecords) ? order.paymentRecords.find((item) => item.note === TEST_DATA.paymentNote) : null;
    if (!payment) throw new Error('payment record not found in order detail');
    report.paymentReadback = {
      orderId: order.id,
      paymentId: payment.id,
      status: payment.status,
      amount: Number(payment.amount || 0),
      note: payment.note,
      paidAmount: Number(order.paidAmount || 0),
    };
    return { order, payment };
  });
}

async function openHistoryAndVerify(page) {
  await withTimebox(page, 'verify-history-modal-readback', TIMEOUTS.readBack, async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    let row = page.locator('tbody tr').first();
    if (report.createdRowMarker) {
      const matched = page.locator('tbody tr').filter({ hasText: report.createdRowMarker }).first();
      if (await matched.count()) row = matched;
    }

    await row.hover();
    const historyButton = row.locator('button[title*="History"], button[title*="\u5386\u53f2"]').first();
    if (!(await historyButton.count())) throw new Error('history action button not found');
    await historyButton.click();

    for (let index = 0; index < 30; index += 1) {
      const bodyText = await page.locator('body').innerText();
      if (bodyText.includes(TEST_DATA.paymentNote)) {
        assertNoMojibake(bodyText, 'sales-order history modal');
        return;
      }
      await page.waitForTimeout(400);
    }
    throw new Error('payment note not visible in history modal');
  });

  const shot = await safeScreenshot(page, 'sales-order-history-readback');
  recordStep({ step: 'sales-order-history-readback-evidence', result: 'passed', evidence: shot, paymentNote: TEST_DATA.paymentNote });
}

async function main() {
  ensureDir(OUTPUT_DIR);
  ensureDir(SHOT_DIR);
  let browser = null;
  let page = null;

  try {
    const launched = await launchBrowserWithGuard({
      recordStep,
      retryLimit: 1,
      waitMs: 800,
    });
    browser = launched.browser;
    report.launcher = launched.launcher;
    page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await seedLoginState(page);
    await openOrders(page);
    const row = await createOrder(page);
    const created = await findCreatedOrderByApi(page);
    await recordPaymentForRow(page, row);
    await verifyPaymentByApi(page, created.id);
    await openHistoryAndVerify(page);
    report.status = 'passed';
  } catch (error) {
    markReportFromLaunchError(report, error);
    if (report.status !== 'blocked_env') {
      process.exitCode = 1;
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    if (browser) await browser.close();
  }
}

main();
