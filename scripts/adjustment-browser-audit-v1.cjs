const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'adjustment-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'adjustment-audit-report-v1.json');

const UI = {
  pageTitle: '\u8c03\u8d26\u4e2d\u5fc3',
  createTitle: '\u65b0\u5efa\u8c03\u8d26',
  heroTitle: '\u8d22\u52a1\u3001\u751f\u4ea7\u3001\u5e93\u5b58\u7edf\u4e00\u8c03\u8d26',
  filtersTitle: '\u8fc7\u6ee4',
  createButton: '\u521b\u5efa\u5355\u636e',
  applyButton: '\u751f\u6548',
  reverseButton: '\u51b2\u9500',
  orderIdPlaceholder: '\u8ba2\u5355ID',
  amountDeltaPlaceholder: '\u91d1\u989d\u53d8\u52a8',
  reasonPlaceholder: '\u8c03\u8d26\u539f\u56e0',
  notePlaceholder: '\u5907\u6ce8',
  reverseNotePlaceholder: '\u4eba\u5de5\u51b2\u9500',
};

const REQUIRED_COPY = [
  UI.pageTitle,
  UI.createTitle,
  UI.heroTitle,
  '\u603b\u5355\u636e',
  '\u5df2\u751f\u6548',
  '\u5f85\u5904\u7406',
  '\u8fc7\u6ee4',
  '\u5168\u90e8\u4e1a\u52a1\u57df',
];

// Keep only stable corruption sentinels in the audit script.
const FORBIDDEN_MOJIBAKE = [
  'undefined',
  '\ufffd',
];

const TIMEOUTS = {
  login: 15000,
  route: 20000,
  api: 15000,
  fill: 20000,
  save: 25000,
  stateChange: 20000,
  readBack: 15000,
};

const runId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const TEST_DATA = {
  amountDelta: 12.34,
  reason: `ADJ-AUDIT-${runId}`,
  reasonCategory: 'manual_reconciliation',
  note: `ADJ-NOTE-${runId}`,
  reverseNote: `ADJ-REVERSE-${runId}`,
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
  report.steps.push({
    at: new Date().toISOString(),
    ...entry,
  });
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
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${step} exceeded ${timeout}ms`)), timeout);
      }),
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
    if (!loginResponse.ok()) {
      throw new Error(`login api failed: ${loginResponse.status()}`);
    }

    const loginJson = await loginResponse.json();
    const token = loginJson?.data?.token;
    const user = loginJson?.data?.user;
    if (!token || !user) {
      throw new Error('login api returned empty token or user');
    }
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
      window.localStorage.setItem('ailao.activeTab', 'adjustment');
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

function assertNear(actual, expected, tolerance, label) {
  if (Math.abs(Number(actual) - Number(expected)) > tolerance) {
    throw new Error(`${label} expected ${expected}, got ${actual}`);
  }
}

async function pickOrderForFinanceAdjustment(page) {
  return withTimebox(page, 'pick-order-for-adjustment', TIMEOUTS.api, async () => {
    const response = await apiFetch(page, '/orders?pageSize=50');
    if (!response.ok) {
      throw new Error(`orders api failed: ${response.status}`);
    }
    const orders = unwrapList(response);
    const order = orders.find((item) => item.status !== 'cancelled' && Number(item.finalAmount || 0) > 0);
    if (!order) {
      throw new Error('no usable order found for finance adjustment');
    }
    const before = {
      id: Number(order.id),
      orderNo: order.orderNo,
      finalAmount: Number(order.finalAmount || order.totalAmount || 0),
      paidAmount: Number(order.paidAmount || 0),
      paymentStatus: order.paymentStatus,
    };
    report.orderBefore = before;
    return before;
  });
}

async function openAdjustment(page) {
  await withTimebox(page, 'open-adjustment-route', TIMEOUTS.route, async () => {
    await page.goto(`${APP_URL}#adjustment`, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.route });
    await page.evaluate(() => {
      window.localStorage.setItem('ailao.activeTab', 'adjustment');
      window.location.hash = '#adjustment';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    for (let index = 0; index < 30; index += 1) {
      const bodyText = await page.locator('body').innerText();
      if (bodyText.includes(UI.pageTitle) && bodyText.includes(UI.createTitle)) {
        for (const required of REQUIRED_COPY) {
          if (!bodyText.includes(required)) {
            throw new Error(`required copy missing: ${required}`);
          }
        }
        for (const keyword of FORBIDDEN_MOJIBAKE) {
          if (bodyText.includes(keyword)) {
            throw new Error(`mojibake detected: ${keyword}`);
          }
        }
        if (bodyText.includes('undefined') || bodyText.includes('\ufffd')) {
          throw new Error('adjustment page contains visible undefined or replacement character');
        }
        return;
      }
      await page.waitForTimeout(500);
    }
    throw new Error('adjustment route not ready');
  });
  const shot = await safeScreenshot(page, 'adjustment-route');
  recordStep({ step: 'adjustment-route-evidence', result: 'passed', evidence: shot });
}

async function fillAndCreatePendingAdjustment(page, order) {
  await withTimebox(page, 'fill-create-pending-adjustment', TIMEOUTS.fill, async () => {
    const selects = page.locator('select');
    await selects.nth(0).selectOption('finance');
    await selects.nth(1).selectOption('pending');
    await selects.nth(2).selectOption('order');
    await page.locator(`input[placeholder="${UI.orderIdPlaceholder}"]`).fill(String(order.id));
    await page.locator(`input[placeholder="${UI.amountDeltaPlaceholder}"]`).fill(String(TEST_DATA.amountDelta));
    await page.locator('input[placeholder="\u539f\u56e0\u5206\u7c7b"]').fill(TEST_DATA.reasonCategory);
    await page.locator(`textarea[placeholder="${UI.reasonPlaceholder}"]`).fill(TEST_DATA.reason);
    await page.locator(`textarea[placeholder="${UI.notePlaceholder}"]`).fill(TEST_DATA.note);
    await page.locator('button').filter({ hasText: UI.createButton }).first().click();
  });

  await withTimebox(page, 'created-adjustment-visible', TIMEOUTS.save, async () => {
    for (let index = 0; index < 30; index += 1) {
      const bodyText = await page.locator('body').innerText();
      if (bodyText.includes(TEST_DATA.reason) && bodyText.includes('\u5f85\u5904\u7406')) {
        await page.locator('tr').filter({ hasText: TEST_DATA.reason }).first().click();
        return;
      }
      await page.waitForTimeout(500);
    }
    throw new Error('created pending adjustment was not visible');
  });
  const shot = await safeScreenshot(page, 'adjustment-created-pending');
  recordStep({ step: 'adjustment-created-pending-evidence', result: 'passed', evidence: shot });
}

async function findCreatedAdjustment(page) {
  return withTimebox(page, 'verify-created-adjustment-readback', TIMEOUTS.readBack, async () => {
    const response = await apiFetch(page, '/adjustments?pageSize=100&status=pending');
    if (!response.ok) {
      throw new Error(`adjustments api failed: ${response.status}`);
    }
    const hit = unwrapList(response).find((item) => item.reason === TEST_DATA.reason && item.note === TEST_DATA.note);
    if (!hit) {
      throw new Error('created pending adjustment not found by API readback');
    }
    if (hit.status !== 'pending') {
      throw new Error(`created adjustment expected pending, got ${hit.status}`);
    }
    assertNear(hit.amountDelta, TEST_DATA.amountDelta, 0.01, 'created amountDelta');
    report.created = { id: hit.id, adjustmentNo: hit.adjustmentNo };
    return hit;
  });
}

async function applyAdjustmentViaUi(page, adjustment) {
  await withTimebox(page, 'apply-adjustment-ui', TIMEOUTS.stateChange, async () => {
    await page.locator('tr').filter({ hasText: TEST_DATA.reason }).first().click();
    await page.getByRole('button', { name: UI.applyButton, exact: true }).click();
    for (let index = 0; index < 30; index += 1) {
      const detail = await apiFetch(page, `/adjustments/${adjustment.id}`);
      if (detail.ok && detail.json?.data?.status === 'posted') {
        return;
      }
      await page.waitForTimeout(500);
    }
    throw new Error('adjustment did not become posted after UI apply');
  });
  const shot = await safeScreenshot(page, 'adjustment-applied');
  recordStep({ step: 'adjustment-applied-evidence', result: 'passed', evidence: shot });
}

async function verifyOrderAfterApply(page, orderBefore) {
  await withTimebox(page, 'verify-order-after-apply', TIMEOUTS.readBack, async () => {
    const response = await apiFetch(page, `/orders/${orderBefore.id}`);
    if (!response.ok) {
      throw new Error(`order detail after apply failed: ${response.status}`);
    }
    const order = response.json?.data;
    const expectedPaidAmount = Number(orderBefore.paidAmount) + TEST_DATA.amountDelta;
    assertNear(order.paidAmount, expectedPaidAmount, 0.01, 'order paidAmount after apply');
    report.orderAfterApply = {
      id: order.id,
      paidAmount: Number(order.paidAmount || 0),
      paymentStatus: order.paymentStatus,
    };
  });
}

async function reverseAdjustmentViaUi(page, adjustment) {
  await withTimebox(page, 'reverse-adjustment-ui', TIMEOUTS.stateChange, async () => {
    await page.locator('tr').filter({ hasText: TEST_DATA.reason }).first().click();
    const reverseInput = page.locator(`input[placeholder="${UI.reverseNotePlaceholder}"]`).first();
    await reverseInput.fill(TEST_DATA.reverseNote);
    await page.getByRole('button', { name: UI.reverseButton, exact: true }).click();
    for (let index = 0; index < 30; index += 1) {
      const detail = await apiFetch(page, `/adjustments/${adjustment.id}`);
      if (detail.ok && detail.json?.data?.status === 'reversed') {
        return;
      }
      await page.waitForTimeout(500);
    }
    throw new Error('adjustment did not become reversed after UI reverse');
  });
  const shot = await safeScreenshot(page, 'adjustment-reversed');
  recordStep({ step: 'adjustment-reversed-evidence', result: 'passed', evidence: shot });
}

async function verifyReverseAndOrderRestored(page, adjustment, orderBefore) {
  await withTimebox(page, 'verify-reverse-readback-and-order-restored', TIMEOUTS.readBack, async () => {
    const adjustmentResponse = await apiFetch(page, `/adjustments/${adjustment.id}`);
    if (!adjustmentResponse.ok) {
      throw new Error(`original adjustment detail failed: ${adjustmentResponse.status}`);
    }
    if (adjustmentResponse.json?.data?.status !== 'reversed') {
      throw new Error(`original adjustment expected reversed, got ${adjustmentResponse.json?.data?.status}`);
    }

    const listResponse = await apiFetch(page, '/adjustments?pageSize=100&status=posted');
    if (!listResponse.ok) {
      throw new Error(`reverse list readback failed: ${listResponse.status}`);
    }
    const reverse = unwrapList(listResponse).find((item) => item.note === TEST_DATA.reverseNote && Number(item.amountDelta) === -TEST_DATA.amountDelta);
    if (!reverse) {
      throw new Error('reverse adjustment record not found');
    }
    report.reverse = { id: reverse.id, adjustmentNo: reverse.adjustmentNo };

    const orderResponse = await apiFetch(page, `/orders/${orderBefore.id}`);
    if (!orderResponse.ok) {
      throw new Error(`order detail after reverse failed: ${orderResponse.status}`);
    }
    const order = orderResponse.json?.data;
    assertNear(order.paidAmount, orderBefore.paidAmount, 0.01, 'order paidAmount after reverse');
    report.orderAfterReverse = {
      id: order.id,
      paidAmount: Number(order.paidAmount || 0),
      paymentStatus: order.paymentStatus,
    };
  });
}

async function main() {
  ensureDir(OUTPUT_DIR);
  ensureDir(SHOT_DIR);
  let browser = null;

  try {
    const launched = await launchBrowserWithGuard({
      recordStep,
      retryLimit: 1,
      waitMs: 800,
    });
    browser = launched.browser;
    report.launcher = launched.launcher;
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await seedLoginState(page);
    const order = await pickOrderForFinanceAdjustment(page);
    await openAdjustment(page);
    await fillAndCreatePendingAdjustment(page, order);
    const adjustment = await findCreatedAdjustment(page);
    await applyAdjustmentViaUi(page, adjustment);
    await verifyOrderAfterApply(page, order);
    await reverseAdjustmentViaUi(page, adjustment);
    await verifyReverseAndOrderRestored(page, adjustment, order);
    report.status = 'passed';
  } catch (error) {
    markReportFromLaunchError(report, error);
    if (report.status !== 'blocked_env') {
      process.exitCode = 1;
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    if (browser) await browser.close().catch(() => {});
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  }
}

main();
