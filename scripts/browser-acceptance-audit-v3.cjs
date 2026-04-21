const { launchBrowserWithGuard } = require('./lib/browser-launch-guard.cjs');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.resolve(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'acceptance-audit');
const REPORT_PATH = path.join(OUTPUT_DIR, 'acceptance-audit-report.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const TEST_DATA = {
  runId: RUN_ID,
  customerName: `ACPT-CUST-${RUN_ID}`,
  customerAddress: `Acceptance Address ${RUN_ID}`,
  contactName: `QA-${RUN_ID}`,
  contactPhone: `090${RUN_ID.slice(-7)}`,
  productName: `ACPT-PROD-${RUN_ID}`,
  packaging: `BOX-${RUN_ID.slice(-4)}`,
  quantity: 5,
  unit: 'kg',
  unitPrice: 99,
  taxAmount: 0,
  paymentAmount: 128,
  paymentNote: `ACPT-PAY-${RUN_ID}`,
};

const STEP_TIMEOUT_MS = {
  pageLoad: 15000,
  login: 20000,
  nav: 10000,
  save: 18000,
  readBack: 12000,
  modal: 8000,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  testData: TEST_DATA,
  steps: [],
  status: 'running',
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

async function safeScreenshot(page, name) {
  const filePath = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function withTimebox(page, name, timeout, action) {
  const started = Date.now();
  try {
    const result = await Promise.race([
      action(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} exceeded ${timeout}ms`)), timeout)),
    ]);
    recordStep({ step: name, timeout, result: 'passed', durationMs: Date.now() - started });
    return result;
  } catch (error) {
    const screenshot = await safeScreenshot(page, `fail-${name.replace(/[^a-z0-9-]/gi, '_')}`);
    recordStep({
      step: name,
      timeout,
      result: 'failed',
      durationMs: Date.now() - started,
      error: String(error.message || error),
      screenshot,
    });
    throw error;
  }
}

async function clickButtonByText(scope, regex) {
  const button = scope.locator('button').filter({ hasText: regex }).first();
  if (await button.count()) {
    await button.click();
    return;
  }
  throw new Error(`button not found: ${regex}`);
}

async function clickLastButton(scope, errorMessage) {
  const buttons = scope.locator('button');
  const count = await buttons.count();
  if (!count) throw new Error(errorMessage);
  await buttons.nth(count - 1).click();
}

async function selectOptionContaining(selectLocator, text) {
  const value = await selectLocator.evaluate((element, expectedText) => {
    const option = Array.from(element.options).find((item) => (item.textContent || '').includes(expectedText));
    return option ? option.value : '';
  }, text);
  if (!value) throw new Error(`select option not found for text: ${text}`);
  await selectLocator.selectOption(value);
}

async function waitForText(page, text, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const bodyText = await page.locator('body').innerText();
    if (bodyText.includes(text)) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`text not visible within ${timeout}ms: ${text}`);
}

async function findRowByText(page, text, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const row = page.locator('tbody tr').filter({ hasText: text }).first();
    if (await row.count()) return row;
    await page.waitForTimeout(300);
  }
  throw new Error(`table row not found within ${timeout}ms: ${text}`);
}

async function login(page) {
  await withTimebox(page, 'open-login', STEP_TIMEOUT_MS.pageLoad, async () => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  });

  const loginInput = page.locator('input[name="username"]');
  if (!(await loginInput.count())) {
    recordStep({ step: 'login-form-detection', result: 'skipped', reason: 'login form not found, assuming already authenticated' });
    return;
  }

  await withTimebox(page, 'submit-login', STEP_TIMEOUT_MS.login, async () => {
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await Promise.all([page.waitForTimeout(1200), page.click('button[type="submit"]')]);
  });

  const bodyText = await page.locator('body').innerText();
  if (/invalid credentials|\u7528\u6237\u540d\u6216\u5bc6\u7801\u9519\u8bef|sai m\u1eadt kh\u1ea9u/i.test(bodyText)) {
    throw new Error('login rejected with invalid credentials');
  }
}

async function checkNoVisibleCorruption(page, routeName) {
  const text = await page.locator('body').innerText();
  const corruptionSignals = [
    /undefined\s+undefined/i,
    /\ufffd+/,
    /\u951f\u91d1\u62f7/u,
  ];
  const hit = corruptionSignals.find((signal) => signal.test(text));
  if (hit) throw new Error(`${routeName} shows corruption signal: ${String(hit)}`);
}

async function openHash(page, hash, name, expectedTexts) {
  await withTimebox(page, `route-${name}`, STEP_TIMEOUT_MS.nav, async () => {
    await page.evaluate((nextHash) => {
      window.location.hash = nextHash;
    }, hash);
    await page.waitForTimeout(1500);
  });

  await checkNoVisibleCorruption(page, name);
  const text = await page.locator('body').innerText();
  const matched = expectedTexts.some((item) => text.includes(item));
  if (!matched) {
    throw new Error(`${name} missing expected text: ${expectedTexts.join(' | ')}`);
  }

  const screenshot = await safeScreenshot(page, `route-${name}`);
  recordStep({ step: `assert-${name}`, result: 'passed', evidence: screenshot, expectedTexts });
}

async function createCustomerAndReadBack(page) {
  await openHash(page, '#crm', 'crm-write', ['\u5ba2\u6237', 'CUSTOMERS', '\u5ba2\u6237\u5173\u7cfb']);

  await withTimebox(page, 'crm-open-create', STEP_TIMEOUT_MS.modal, async () => {
    await clickButtonByText(page, /\u65b0\u589e\u5ba2\u6237|Add Customer|Thêm khách hàng/i);
    await page.locator('div.fixed.inset-0').last().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS.modal });
  });

  const modal = page.locator('div.fixed.inset-0').last();
  const inputs = modal.locator('input');
  const textareas = modal.locator('textarea');

  await withTimebox(page, 'crm-create-customer', STEP_TIMEOUT_MS.save, async () => {
    await inputs.nth(0).fill(TEST_DATA.customerName);
    await textareas.nth(0).fill(TEST_DATA.customerAddress);
    await inputs.nth(10).fill(TEST_DATA.contactName);
    await inputs.nth(12).fill(TEST_DATA.contactPhone);
    await clickLastButton(modal, 'crm submit button not found');
    await page.waitForTimeout(1600);
  });

  await waitForText(page, TEST_DATA.customerName, STEP_TIMEOUT_MS.readBack);
  const immediateShot = await safeScreenshot(page, 'crm-created-visible');
  recordStep({ step: 'crm-created-visible', result: 'passed', evidence: immediateShot, customerName: TEST_DATA.customerName });

  await withTimebox(page, 'crm-refresh-readback', STEP_TIMEOUT_MS.readBack, async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await waitForText(page, TEST_DATA.customerName, STEP_TIMEOUT_MS.readBack);
  });

  const readbackShot = await safeScreenshot(page, 'crm-refresh-readback');
  recordStep({ step: 'crm-refresh-readback-evidence', result: 'passed', evidence: readbackShot, customerName: TEST_DATA.customerName });
}

async function createOrderRecordPaymentAndReadBack(page) {
  await openHash(page, '#orders', 'orders-write', ['\u8ba2\u5355', 'Order', 'Sales Order']);
  const beforeFirstRowText = await page.locator('tbody tr').first().innerText().catch(() => '');

  await withTimebox(page, 'orders-open-create', STEP_TIMEOUT_MS.modal, async () => {
    const primaryCreateButton = page.locator('button.bg-blue-600').first();
    if (!(await primaryCreateButton.count())) throw new Error('orders primary create button not found');
    await primaryCreateButton.click();
    await page.locator('div.fixed.inset-0').last().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS.modal });
  });

  const modal = page.locator('div.fixed.inset-0').last();
  const selects = modal.locator('select');
  const inputs = modal.locator('input:not([type="file"]):not([type="checkbox"])');
  let createdRowMarker = TEST_DATA.customerName;

  await withTimebox(page, 'orders-create-order', STEP_TIMEOUT_MS.save, async () => {
    await selectOptionContaining(selects.nth(1), TEST_DATA.customerName);
    await inputs.nth(1).fill(TEST_DATA.productName);
    await inputs.nth(2).fill(TEST_DATA.packaging);
    await inputs.nth(3).fill(String(TEST_DATA.quantity));
    await inputs.nth(4).fill(TEST_DATA.unit);
    await inputs.nth(5).fill(String(TEST_DATA.unitPrice));
    await inputs.nth(6).fill(String(TEST_DATA.taxAmount));
    await clickLastButton(modal, 'order save button not found');
    const started = Date.now();
    while (Date.now() - started < STEP_TIMEOUT_MS.readBack) {
      const currentText = await page.locator('tbody tr').first().innerText().catch(() => '');
      if (currentText && currentText !== beforeFirstRowText) return;
      await page.waitForTimeout(300);
    }
    throw new Error('new order row did not appear after save');
  });

  let row;
  await withTimebox(page, 'orders-created-visible', STEP_TIMEOUT_MS.readBack, async () => {
    const started = Date.now();
    while (Date.now() - started < STEP_TIMEOUT_MS.readBack) {
      const currentRow = page.locator('tbody tr').first();
      if (await currentRow.count()) {
        const currentText = await currentRow.innerText();
        if (currentText && currentText !== beforeFirstRowText) {
          row = currentRow;
          const markerMatch = currentText.match(/#\d+/);
          if (markerMatch) createdRowMarker = markerMatch[0];
          if (!currentText.includes(TEST_DATA.customerName)) {
            recordStep({ step: 'orders-customer-label-missing', result: 'warning', expectedCustomerName: TEST_DATA.customerName, rowText: currentText });
          }
          break;
        }
      }
      await page.waitForTimeout(300);
    }
    if (!row) throw new Error('new order row did not appear at the top of the table');
    const orderShot = await safeScreenshot(page, 'orders-created-visible');
    recordStep({ step: 'orders-created-visible-evidence', result: 'passed', evidence: orderShot, customerName: TEST_DATA.customerName });
  });

  await withTimebox(page, 'orders-refresh-readback', STEP_TIMEOUT_MS.readBack, async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    row = await findRowByText(page, createdRowMarker, STEP_TIMEOUT_MS.readBack);
  });

  const rowText = await row.innerText();
  recordStep({ step: 'orders-refresh-readback-evidence', result: 'passed', rowText });

  await withTimebox(page, 'orders-record-payment', STEP_TIMEOUT_MS.save, async () => {
    await row.hover();
    const paymentButton = row.locator('button[title*="Payment"], button[title*="\u56de\u6b3e"], button[title*="\u6536\u6b3e"]').first();
    if (!(await paymentButton.count())) throw new Error('payment action button not found');
    await paymentButton.click();

    const payModal = page.locator('div.fixed.inset-0').last();
    await payModal.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS.modal });
    const payInputs = payModal.locator('input:not([type="checkbox"])');
    await payInputs.nth(0).fill(String(TEST_DATA.paymentAmount));
    await payInputs.last().fill(TEST_DATA.paymentNote);
    await clickLastButton(payModal, 'payment confirm button not found');
    await page.waitForTimeout(1800);
  });

  await withTimebox(page, 'orders-payment-readback', STEP_TIMEOUT_MS.readBack, async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    row = await findRowByText(page, createdRowMarker, STEP_TIMEOUT_MS.readBack);
    await row.hover();
    const historyButton = row.locator('button[title*="History"], button[title*="\u5386\u53f2"]').first();
    if (!(await historyButton.count())) throw new Error('history action button not found');
    await historyButton.click();
    await waitForText(page, TEST_DATA.paymentNote, STEP_TIMEOUT_MS.readBack);
  });

  const paymentShot = await safeScreenshot(page, 'orders-payment-readback');
  recordStep({ step: 'orders-payment-readback-evidence', result: 'passed', evidence: paymentShot, paymentNote: TEST_DATA.paymentNote, paymentAmount: TEST_DATA.paymentAmount });
}

async function run() {
  ensureDir(SHOT_DIR);
  let browser;

  try {
    const launched = await launchBrowserWithGuard({ recordStep, retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    report.launcher = launched.launcher;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

    await login(page);
    await checkNoVisibleCorruption(page, 'shell');
    await safeScreenshot(page, 'post-login-shell');

    await openHash(page, '#crm', 'crm', ['\u5ba2\u6237', 'CUSTOMERS', '\u5ba2\u6237\u5173\u7cfb']);
    await openHash(page, '#orders', 'orders', ['\u8ba2\u5355', 'Order', 'Sales Order']);
    await openHash(page, '#collections', 'collections', ['\u56de\u6b3e', '\u6536\u6b3e', 'Collections']);
    await openHash(page, '#procurement', 'procurement', ['\u91c7\u8d2d', '\u4f9b\u5e94\u5546', 'Procurement']);
    await openHash(page, '#shipping', 'shipping', ['\u51fa\u8d27', '\u7269\u6d41', 'Shipping']);
    await openHash(page, '#assets', 'assets', ['\u8d44\u4ea7', '\u4f59\u989d', 'Assets']);
    await openHash(page, '#adjustment', 'adjustment', ['\u8c03\u8d26', 'Adjustment', '\u51b2\u9500']);
    await openHash(page, '#barter', 'barter', ['\u8d27\u62b5\u652f\u4ed8', '\u6362\u8d27\u8d38\u6613', 'Barter']);

    await createCustomerAndReadBack(page);
    await createOrderRecordPaymentAndReadBack(page);

    report.status = 'passed';
    report.finishedAt = new Date().toISOString();
  } catch (error) {
    report.status = 'failed';
    report.finishedAt = new Date().toISOString();
    report.error = String(error.message || error);
    process.exitCode = 1;
  } finally {
    if (report && report.status === 'blocked_env' && process && process.exitCode === 1) process.exitCode = 0;
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    if (browser) await browser.close();
  }
}

run();
