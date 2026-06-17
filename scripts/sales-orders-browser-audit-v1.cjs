const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'sales-orders-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'sales-orders-audit-report-v1.json');

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

  await withTimebox(page, 'wait-orders-workspace-ready', TIMEOUTS.route, async () => {
    for (let index = 0; index < 40; index += 1) {
      const deskVisible = await page.locator('[data-testid="sales-desk-orders"]').first().isVisible().catch(() => false);
      const createVisible = await page.locator('[data-testid="sales-order-create-button"]').first().isVisible().catch(() => false);
      const loadingText = await page.locator('body').innerText().catch(() => '');
      if ((deskVisible || createVisible) && !/LOADING/i.test(loadingText)) {
        assertNoMojibake(loadingText, 'sales-orders workspace ready');
        return;
      }
      await page.waitForTimeout(500);
    }
    throw new Error('orders workspace still loading or actions unavailable');
  });

  const shot = await safeScreenshot(page, 'orders-route');
  recordStep({ step: 'orders-route-evidence', result: 'passed', evidence: shot });
}

async function selectFirstRealOption(selectLocator) {
  if (await selectLocator.getAttribute('role') === 'combobox') {
    await selectLocator.click();
    await selectLocator.press('Home');
    const activeOptionId = await selectLocator.getAttribute('aria-activedescendant');
    if (!activeOptionId) throw new Error('customer combobox did not expose an active option');
    const option = selectLocator.page().locator(`#${activeOptionId}`);
    await option.waitFor({ state: 'visible', timeout: TIMEOUTS.modal });
    const value = (await option.getAttribute('data-testid') || '').replace('sales-order-customer-option-', '');
    const label = (await option.innerText()).trim();
    await selectLocator.press('ArrowDown');
    const nextActiveOptionId = await selectLocator.getAttribute('aria-activedescendant');
    if (!nextActiveOptionId) throw new Error('customer combobox lost active option after ArrowDown');
    const selectedOption = selectLocator.page().locator(`#${nextActiveOptionId}`);
    const selectedValue = (await selectedOption.getAttribute('data-testid') || '').replace('sales-order-customer-option-', '');
    const selectedLabel = (await selectedOption.innerText()).trim();
    await selectLocator.press('Enter');
    if (await selectLocator.getAttribute('aria-expanded') !== 'false') {
      throw new Error('customer combobox did not close after keyboard selection');
    }
    return { value: selectedValue || value, label: selectedLabel || label };
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const option = await selectLocator.evaluate((element) => {
      const options = Array.from(element.options || []);
      const target = options.find((item) => item.value && !item.disabled);
      return target ? { value: target.value, label: target.textContent || '' } : null;
    });

    if (option?.value) {
      await selectLocator.selectOption(option.value);
      return option;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('no selectable option found');
}

function extractMarker(rowText) {
  const line = String(rowText || '').split('\n').find(Boolean) || '';
  const hashMatch = line.match(/#\d+/);
  if (hashMatch) return hashMatch[0];
  const orderMatch = rowText.match(/ORD-[A-Z0-9-]+/i);
  if (orderMatch) return orderMatch[0];
  return line.trim().slice(0, 32);
}

async function readFirstOrderRowSnapshot(page) {
  const row = page.locator('[data-testid^="sales-order-row-"]').first();
  if (!(await row.count())) return null;

  const testId = await row.getAttribute('data-testid');
  const text = await row.innerText().catch(() => '');
  return {
    row,
    testId: testId || '',
    text,
  };
}

async function createOrder(page) {
  return withTimebox(page, 'create-sales-order', TIMEOUTS.save, async () => {
    const beforeFirstRow = await readFirstOrderRowSnapshot(page);
    const createButton = page.locator('[data-testid="sales-order-create-button"]').first();
    if (!(await createButton.count())) throw new Error('new order button not found');
    await createButton.click();

    const modal = page.locator('[data-testid="sales-order-editor-modal"]').first();
    await modal.waitFor({ state: 'visible', timeout: TIMEOUTS.modal });
    const dialog = modal.locator('[role="dialog"]').first();
    if (await dialog.getAttribute('aria-modal') !== 'true') {
      throw new Error('sales order editor is missing modal dialog semantics');
    }

    const customerSelect = modal.locator('[data-testid="sales-order-customer-select"]').first();
    const selectedCustomer = await selectFirstRealOption(customerSelect);
    report.selectedCustomer = selectedCustomer;

    const saveButton = modal.locator('[data-testid="sales-order-save-button"]').first();
    if (!(await saveButton.count())) throw new Error('order save button not found');

    const notes = modal.locator('[data-testid="sales-order-notes"]').first();
    await notes.fill('超'.repeat(1001));
    if (await notes.getAttribute('aria-invalid') !== 'true') {
      throw new Error('order notes did not expose the over-limit state');
    }
    await saveButton.click();
    if (!(await modal.isVisible())) throw new Error('over-limit order notes did not block save');
    await notes.fill('');
    recordStep({
      step: 'sales-order-notes-over-limit-blocked',
      result: 'passed',
      evidence: '1001/1000 characters blocked before save',
    });

    await saveButton.click();
    const errorSummary = modal.locator('[data-testid="sales-order-line-error-summary"]').first();
    await errorSummary.waitFor({ state: 'visible', timeout: TIMEOUTS.modal });
    const lineError = modal.locator('[data-testid="sales-order-line-0-errors"]').first();
    await lineError.waitFor({ state: 'visible', timeout: TIMEOUTS.modal });
    const validationText = `${await errorSummary.innerText()} ${await lineError.innerText()}`;
    assertNoMojibake(validationText, 'sales-order line validation');
    if (!validationText.includes('商品名称') && !validationText.includes('至少录入一行商品明细')) {
      throw new Error('line validation did not explain the missing product name');
    }
    recordStep({
      step: 'sales-order-line-validation-blocked',
      result: 'passed',
      evidence: validationText,
    });

    await modal.locator('[data-testid="sales-order-line-0-product"]').fill(TEST_DATA.productName);
    await modal.locator('[data-testid="sales-order-line-0-packaging"]').fill(TEST_DATA.packaging);
    await modal.locator('[data-testid="sales-order-line-0-quantity"]').fill(String(TEST_DATA.quantity));
    await modal.locator('[data-testid="sales-order-line-0-unit"]').fill(TEST_DATA.unit);
    await modal.locator('[data-testid="sales-order-line-0-unit-price"]').fill(String(TEST_DATA.unitPrice));
    await modal.locator('[data-testid="sales-order-line-0-discount"]').fill('0');
    await modal.locator('[data-testid="sales-order-line-0-tax"]').fill(String(TEST_DATA.taxAmount));

    await saveButton.click();
    await modal.waitFor({ state: 'hidden', timeout: TIMEOUTS.save });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const afterFirstRow = await readFirstOrderRowSnapshot(page);
      const rowChanged = afterFirstRow
        && (!beforeFirstRow || afterFirstRow.testId !== beforeFirstRow.testId || afterFirstRow.text !== beforeFirstRow.text);

      if (rowChanged) {
        report.createdRowText = afterFirstRow.text;
        report.createdRowTestId = afterFirstRow.testId;
        report.createdRowMarker = extractMarker(afterFirstRow.text);
        report.createdOrderIdFromGrid = String(afterFirstRow.testId).replace(/^sales-order-row-/, '');
        return afterFirstRow;
      }

      await page.waitForTimeout(400);
    }

    throw new Error('new order row did not appear in grid');
  });
}

async function findCreatedOrderByApi(page) {
  return withTimebox(page, 'verify-order-created-readback', TIMEOUTS.api, async () => {
    const candidateId = String(report.createdOrderIdFromGrid || '').trim()
      || String(report.createdRowMarker || '').match(/#(\d+)/)?.[1];
    if (!candidateId) {
      throw new Error('created order id not captured from grid');
    }

    const detailResponse = await apiFetch(page, `/orders/${candidateId}`);
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
    report.createdRowMarker = extractMarker(detail.orderNo || `#${detail.id}`);
    return detail;
  });
}

function getOrderRowTestId(orderId) {
  return `sales-order-row-${String(orderId ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

async function waitForCreatedOrderRow(page, orderId) {
  const rowTestId = getOrderRowTestId(orderId);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const row = page.locator(`[data-testid="${rowTestId}"]`).first();
    if (await row.count()) {
      return row;
    }

    if (attempt === 9) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
    } else {
      await page.waitForTimeout(400);
    }
  }

  throw new Error(`created order row not visible: ${rowTestId}`);
}

async function captureCreatedRowEvidence(page, orderId) {
  return withTimebox(page, 'verify-created-row-visible', TIMEOUTS.readBack, async () => {
    const row = await waitForCreatedOrderRow(page, orderId);
    const rowText = await row.innerText();
    assertNoMojibake(rowText, 'sales-order row readback');
    report.createdRowText = rowText;
    report.createdRowTestId = getOrderRowTestId(orderId);
    const shot = await safeScreenshot(page, 'sales-order-created');
    recordStep({
      step: 'sales-order-created-evidence',
      result: 'passed',
      evidence: shot,
      rowMarker: report.createdRowMarker,
      rowTestId: report.createdRowTestId,
    });
    return row;
  });
}

async function recordPaymentForRow(page, orderId) {
  await withTimebox(page, 'record-order-payment', TIMEOUTS.save, async () => {
    const paymentDesk = page.locator('[data-testid="sales-desk-payments"]').first();
    if (await paymentDesk.count()) {
      await paymentDesk.click();
      await page.waitForTimeout(500);
    }

    const row = await waitForCreatedOrderRow(page, orderId);
    await row.hover();
    const paymentButton = row.locator('[data-testid="sales-order-payment-button"]').first();
    if (!(await paymentButton.count())) throw new Error('payment action button not found');
    await paymentButton.click();

    const payModal = page.locator('[data-testid="sales-order-payment-modal"]').first();
    await payModal.waitFor({ state: 'visible', timeout: TIMEOUTS.modal });
    const paymentDialog = payModal.locator('[role="dialog"]').first();
    if (await paymentDialog.getAttribute('aria-modal') !== 'true') {
      throw new Error('sales order payment modal is missing dialog semantics');
    }
    await page.waitForTimeout(100);
    const paymentFocus = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    if (paymentFocus !== 'sales-order-payment-amount') {
      throw new Error(`sales order payment initial focus is incorrect: ${paymentFocus || 'none'}`);
    }
    await payModal.locator('[data-testid="sales-order-payment-amount"]').fill(String(TEST_DATA.paymentAmount));
    await payModal.locator('input[type="text"]').last().fill(TEST_DATA.paymentNote);
    const confirmButton = payModal.locator('[data-testid="sales-order-payment-confirm"]').first();
    if (!(await confirmButton.count())) throw new Error('payment confirm button not found');
    await confirmButton.click();
    await payModal.waitFor({ state: 'hidden', timeout: TIMEOUTS.save });
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

    const row = await waitForCreatedOrderRow(page, report.createdOrder?.id);
    await row.hover();
    const historyButton = row.locator('[data-testid="sales-order-history-button"]').first();
    if (!(await historyButton.count())) throw new Error('history action button not found');
    await historyButton.click();

    const modal = page.locator('[data-testid="sales-order-history-modal"]').first();
    await modal.waitFor({ state: 'visible', timeout: TIMEOUTS.modal });
    const historyDialog = modal.locator('[role="dialog"]').first();
    if (await historyDialog.getAttribute('aria-modal') !== 'true') {
      throw new Error('sales order history modal is missing dialog semantics');
    }
    await page.waitForTimeout(100);
    const historyFocusText = await page.evaluate(() => document.activeElement?.textContent?.trim() || '');
    if (!historyFocusText) throw new Error('sales order history modal did not set initial focus');
    for (let index = 0; index < 30; index += 1) {
      const modalText = await modal.innerText();
      if (modalText.includes(TEST_DATA.paymentNote)) {
        assertNoMojibake(modalText, 'sales-order history modal');
        return;
      }
      await page.waitForTimeout(400);
    }
    throw new Error('payment note not visible in history modal');
  });

  const shot = await safeScreenshot(page, 'sales-order-history-readback');
  recordStep({ step: 'sales-order-history-readback-evidence', result: 'passed', evidence: shot, paymentNote: TEST_DATA.paymentNote });
}

async function verifyAccessibilityLayout(page) {
  await withTimebox(page, 'verify-accessibility-layout', TIMEOUTS.route, async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 640, height: 720 });
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });

    const createButton = page.locator('[data-testid="sales-order-create-button"]').first();
    await createButton.waitFor({ state: 'visible', timeout: TIMEOUTS.route });
    await createButton.focus();
    await createButton.click();

    const modal = page.locator('[data-testid="sales-order-editor-modal"]').first();
    await modal.waitFor({ state: 'visible', timeout: TIMEOUTS.modal });
    await page.waitForTimeout(100);

    const activeTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    if (activeTestId !== 'sales-order-customer-select') {
      throw new Error(`sales order dialog initial focus is incorrect: ${activeTestId || 'none'}`);
    }

    const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (bodyOverflow > 2) {
      throw new Error(`sales order dialog causes ${bodyOverflow}px page-level horizontal overflow at narrow viewport`);
    }

    const saveButton = modal.locator('[data-testid="sales-order-save-button"]').first();
    await saveButton.focus();
    await saveButton.press('Tab');
    const focusStayedInDialog = await modal.locator('[role="dialog"]').evaluate(
      (dialog) => dialog.contains(document.activeElement),
    );
    if (!focusStayedInDialog) throw new Error('Tab escaped the sales order dialog');

    const motionDurations = await modal.locator('[role="dialog"]').evaluate((dialog) => {
      const style = getComputedStyle(dialog);
      return {
        animationDuration: style.animationDuration,
        transitionDuration: style.transitionDuration,
      };
    });
    if (Number.parseFloat(motionDurations.animationDuration) > 0.00002) {
      throw new Error(`reduced motion did not suppress dialog animation: ${motionDurations.animationDuration}`);
    }

    const screenshot = await safeScreenshot(page, 'sales-order-accessibility-640-forced-colors');
    recordStep({
      step: 'sales-order-accessibility-evidence',
      result: 'passed',
      evidence: screenshot,
      viewport: '640x720',
      forcedColors: 'active',
      reducedMotion: 'reduce',
    });

    await modal.locator('[data-testid="sales-order-editor-close"]').click();
    await modal.waitFor({ state: 'hidden', timeout: TIMEOUTS.modal });
    const returnedTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    if (returnedTestId !== 'sales-order-create-button') {
      throw new Error(`sales order dialog did not return focus to its trigger: ${returnedTestId || 'none'}`);
    }
  });
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
    await createOrder(page);
    const created = await findCreatedOrderByApi(page);
    await captureCreatedRowEvidence(page, created.id);
    await recordPaymentForRow(page, created.id);
    await verifyPaymentByApi(page, created.id);
    await openHistoryAndVerify(page);
    await verifyAccessibilityLayout(page);
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
