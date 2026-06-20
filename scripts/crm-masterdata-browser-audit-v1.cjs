const fs = require('fs');
const path = require('path');
const { connectOrLaunchBrowser } = require('./lib/browser-connect-or-launch.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const API_URL = `${APP_URL.replace(/\/$/, '')}/api`;
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'crm-masterdata-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'crm-masterdata-browser-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const GLOBAL_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 120000);

const TEST_DATA = {
  name: `ALD Master ${RUN_ID}`,
  nameZh: `爱劳达测试客户${RUN_ID.slice(-6)}`,
  nameEn: `Ailaoda Test Customer ${RUN_ID}`,
  nameVi: `Khach hang Ai Lao Da ${RUN_ID}`,
  aliasA: `ALD-Alias-${RUN_ID}`,
  aliasB: `交易名-${RUN_ID}`,
  legalAddress: `越南平阳省化工园法定地址 ${RUN_ID}`,
  billingAddress: `Vietnam Binh Duong billing site ${RUN_ID}`,
  primaryContact: `主联系人-${RUN_ID.slice(-4)}`,
  secondaryContact: `Finance ${RUN_ID.slice(-4)}`,
  phone: `09${RUN_ID.slice(-8)}`,
  email: `crm-${RUN_ID}@example.com`,
  licenseNumber: `ALD-LIC-${RUN_ID}`,
  taxNo: `VAT-${RUN_ID}`,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  testData: TEST_DATA,
  steps: [],
  consoleErrors: [],
  status: 'running',
};

const MOJIBAKE_CODE_POINTS = [
  0x7039,
  0x7481,
  0x93c0,
  0x95b2,
  0x9351,
  0x74a7,
  0x748b,
  0x7490,
  0x93b9,
  0x7edb,
  0x9417,
  0x7db7,
  0x951b,
  0x697c,
];
const mojibakeTokenPattern = new RegExp(MOJIBAKE_CODE_POINTS.map((code) => String.fromCodePoint(code)).join('|'), 'u');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function writeReport() {
  report.finishedAt = report.finishedAt || new Date().toISOString();
  ensureDir(OUTPUT_DIR);
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

async function withTimeout(name, timeoutMs, action) {
  const started = Date.now();
  try {
    const result = await Promise.race([
      action(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} exceeded ${timeoutMs}ms`)), timeoutMs)),
    ]);
    recordStep({ step: name, result: 'passed', durationMs: Date.now() - started, timeoutMs });
    return result;
  } catch (error) {
    recordStep({ step: name, result: 'failed', durationMs: Date.now() - started, timeoutMs, error: String(error.message || error) });
    throw error;
  }
}

async function safeScreenshot(page, name) {
  const filePath = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function apiFetch(endpoint, options = {}, token = '') {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.data ? JSON.stringify(options.data) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: response.ok, status: response.status, json };
}

async function expectOk(label, promise) {
  const response = await promise;
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response;
}

function unwrapList(payload) {
  const data = payload?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForText(page, text, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (bodyText.includes(text)) return bodyText;
    await page.waitForTimeout(250);
  }
  throw new Error(`text not visible within ${timeoutMs}ms: ${text}`);
}

function assertNoVisibleCorruption(routeId, text) {
  const signals = [
    { name: 'replacement-character', pattern: /\ufffd+/ },
    { name: 'undefined-undefined', pattern: /undefined\s+undefined/i },
    { name: 'mojibake-token', pattern: mojibakeTokenPattern },
  ];
  const hit = signals.find((signal) => signal.pattern.test(text));
  if (hit) throw new Error(`${routeId} visible text contains ${hit.name}`);
}

async function login(page) {
  await withTimeout('open-login', 15000, async () => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  });

  const loginInput = page.locator('input[name="username"]');
  if (!(await loginInput.count())) {
    recordStep({ step: 'login-form-detection', result: 'skipped', reason: 'already authenticated' });
    return;
  }

  await withTimeout('submit-login', 20000, async () => {
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await Promise.all([page.waitForTimeout(1200), page.click('button[type="submit"]')]);
  });
}

async function fillByTestId(page, testId, value) {
  const locator = page.getByTestId(testId);
  await locator.scrollIntoViewIfNeeded();
  await locator.fill(String(value));
}

async function selectByTestId(page, testId, value) {
  const locator = page.getByTestId(testId);
  await locator.scrollIntoViewIfNeeded();
  await locator.selectOption(value);
}

async function createCustomerViaUi(page) {
  await withTimeout('open-crm', 12000, async () => {
    await page.evaluate(() => {
      window.location.hash = '#crm';
    });
    await page.waitForTimeout(1600);
    await waitForText(page, '客户关系', 8000);
  });
  assertNoVisibleCorruption('crm-open', await page.locator('body').innerText());
  recordStep({ step: 'crm-open-evidence', result: 'passed', screenshot: await safeScreenshot(page, 'crm-open') });

  await withTimeout('open-create-modal', 10000, async () => {
    await page.getByTestId('crm-add-customer').click();
    await page.getByTestId('crm-create-modal').waitFor({ state: 'visible', timeout: 8000 });
  });

  await withTimeout('fill-core-masterdata', 20000, async () => {
    await fillByTestId(page, 'crm-name', TEST_DATA.name);
    await fillByTestId(page, 'crm-name-zh', TEST_DATA.nameZh);
    await fillByTestId(page, 'crm-name-en', TEST_DATA.nameEn);
    await fillByTestId(page, 'crm-name-vi', TEST_DATA.nameVi);
    await fillByTestId(page, 'crm-primary-address-label', '法定主体');
    await fillByTestId(page, 'crm-primary-address-country', 'VN');
    await fillByTestId(page, 'crm-primary-address-registered-name', TEST_DATA.nameZh);
    await fillByTestId(page, 'crm-primary-address-registration-no', TEST_DATA.licenseNumber);
    await fillByTestId(page, 'crm-primary-address-tax-no', TEST_DATA.taxNo);
    await fillByTestId(page, 'crm-primary-address-city', 'Binh Duong');
    await fillByTestId(page, 'crm-primary-address-full-address', TEST_DATA.legalAddress);
    await fillByTestId(page, 'crm-primary-contact-name', TEST_DATA.primaryContact);
    await fillByTestId(page, 'crm-primary-contact-role', '采购负责人');
    await fillByTestId(page, 'crm-primary-contact-phone', TEST_DATA.phone);
    await fillByTestId(page, 'crm-primary-contact-email', TEST_DATA.email);
    await fillByTestId(page, 'crm-primary-contact-department', '采购部');
    await selectByTestId(page, 'crm-primary-contact-language', 'zh');
  });

  await withTimeout('fill-advanced-masterdata', 24000, async () => {
    await page.getByTestId('crm-advanced-toggle').scrollIntoViewIfNeeded();
    await page.getByTestId('crm-advanced-toggle').click();
    await fillByTestId(page, 'crm-aliases', `${TEST_DATA.aliasA}\n${TEST_DATA.aliasB}`);
    await fillByTestId(page, 'crm-license-number', TEST_DATA.licenseNumber);
    await fillByTestId(page, 'crm-credit-limit', '880000');
    await fillByTestId(page, 'crm-terms-days', '45');
    await selectByTestId(page, 'crm-risk-level', 'low');
    await selectByTestId(page, 'crm-segment', 'mixed');
    await page.getByTestId('crm-add-site').scrollIntoViewIfNeeded();
    await page.getByTestId('crm-add-site').click();
    await selectByTestId(page, 'crm-address-1-type', 'billing');
    await fillByTestId(page, 'crm-address-1-label', '账单地址');
    await fillByTestId(page, 'crm-address-1-country', 'VN');
    await fillByTestId(page, 'crm-address-1-city', 'Ho Chi Minh');
    await fillByTestId(page, 'crm-address-1-full-address', TEST_DATA.billingAddress);
    await page.getByTestId('crm-add-contact').scrollIntoViewIfNeeded();
    await page.getByTestId('crm-add-contact').click();
    await fillByTestId(page, 'crm-contact-1-name', TEST_DATA.secondaryContact);
    await fillByTestId(page, 'crm-contact-1-role', '财务对账');
    await fillByTestId(page, 'crm-contact-1-phone', `08${RUN_ID.slice(-8)}`);
    await fillByTestId(page, 'crm-contact-1-email', `finance-${RUN_ID}@example.com`);
    await selectByTestId(page, 'crm-contact-1-language', 'en');
    await fillByTestId(page, 'crm-notes', 'CDP 浏览器主数据验收：多名、多址、多联系人');
  });

  recordStep({ step: 'crm-modal-filled-evidence', result: 'passed', screenshot: await safeScreenshot(page, 'crm-modal-filled') });

  await withTimeout('submit-customer', 20000, async () => {
    await page.getByTestId('crm-create-submit').scrollIntoViewIfNeeded();
    await page.getByTestId('crm-create-submit').click();
    await page.getByTestId('crm-create-modal').waitFor({ state: 'hidden', timeout: 16000 });
    await waitForText(page, TEST_DATA.nameZh, 12000);
  });

  recordStep({ step: 'crm-created-visible', result: 'passed', screenshot: await safeScreenshot(page, 'crm-created-visible') });
}

async function apiReadback() {
  const loginResponse = await expectOk('api login', apiFetch('/auth/login', {
    method: 'POST',
    data: { username: 'admin', password: 'admin123' },
  }));
  const token = loginResponse.json.data.token;
  const response = await expectOk('customers readback', apiFetch('/customers?pageSize=1000', {}, token));
  const customers = unwrapList(response);
  const found = customers.find((item) =>
    item.name === TEST_DATA.name ||
    item.nameZh === TEST_DATA.nameZh ||
    item.nameEn === TEST_DATA.nameEn ||
    item.nameVi === TEST_DATA.nameVi
  );
  assert(found, 'created customer not found by API readback');
  assert(found.nameZh === TEST_DATA.nameZh, `nameZh mismatch: ${found.nameZh}`);
  assert(found.nameEn === TEST_DATA.nameEn, `nameEn mismatch: ${found.nameEn}`);
  assert(found.nameVi === TEST_DATA.nameVi, `nameVi mismatch: ${found.nameVi}`);
  assert(Array.isArray(found.addresses) && found.addresses.length >= 2, `addresses length mismatch: ${found.addresses?.length}`);
  assert(Array.isArray(found.contacts) && found.contacts.length >= 2, `contacts length mismatch: ${found.contacts?.length}`);
  assert(found.addresses.some((item) => String(item.fullAddress || '').includes(TEST_DATA.legalAddress)), 'legal address not found');
  assert(found.addresses.some((item) => String(item.fullAddress || '').includes(TEST_DATA.billingAddress)), 'billing address not found');
  assert(found.contacts.some((item) => String(item.name || '') === TEST_DATA.primaryContact), 'primary contact not found');
  assert(found.contacts.some((item) => String(item.name || '') === TEST_DATA.secondaryContact), 'secondary contact not found');

  report.apiReadback = {
    id: found.id,
    nameZh: found.nameZh,
    nameEn: found.nameEn,
    nameVi: found.nameVi,
    addressCount: found.addresses.length,
    contactCount: found.contacts.length,
    segment: found.segment,
    poolState: found.poolState,
  };
  recordStep({ step: 'api-readback', result: 'passed', ...report.apiReadback });
}

async function browserRefreshReadback(page) {
  await withTimeout('browser-refresh-search-readback', 18000, async () => {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1400);
    await waitForText(page, '客户关系', 8000);
    await fillByTestId(page, 'crm-search', TEST_DATA.nameZh);
    await waitForText(page, TEST_DATA.nameZh, 10000);
  });
  assertNoVisibleCorruption('crm-refresh-readback', await page.locator('body').innerText());
  recordStep({ step: 'browser-refresh-readback-evidence', result: 'passed', screenshot: await safeScreenshot(page, 'crm-refresh-readback') });
}

async function closeSafely(browser, page, launcher) {
  if (page) {
    await withTimeout('page-close', 5000, async () => page.close()).catch(() => {});
  }
  if (browser && launcher !== 'cdp') {
    await withTimeout('browser-close', 5000, async () => browser.close()).catch(() => {});
  }
}

async function run() {
  ensureDir(SHOT_DIR);
  let browser = null;
  let page = null;
  let launcher = null;
  const watchdog = setTimeout(() => {
    report.status = 'stuck';
    report.error = `crm masterdata browser audit exceeded ${GLOBAL_TIMEOUT_MS}ms`;
    report.blockerCode = 'CRM_MASTERDATA_TIMEOUT';
    report.blockerVerdict = 'script_stuck';
    writeReport();
    console.error(report.error);
    process.exit(124);
  }, GLOBAL_TIMEOUT_MS);

  try {
    const launched = await connectOrLaunchBrowser({ recordStep, retryLimit: 1, waitMs: 800, cdpRequired: process.env.BROWSER_CDP_REQUIRED === '1' });
    browser = launched.browser;
    launcher = launched.launcher;
    report.launcher = launcher;
    report.endpoint = launched.endpoint || null;
    const context = browser.contexts()[0] || await browser.newContext();
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('console', (message) => {
      if (message.type() === 'error') {
        report.consoleErrors.push({ at: new Date().toISOString(), text: message.text(), url: page.url() });
      }
    });
    page.on('pageerror', (error) => {
      report.consoleErrors.push({ at: new Date().toISOString(), text: String(error.message || error), url: page.url() });
    });

    await login(page);
    await createCustomerViaUi(page);
    await apiReadback();
    await browserRefreshReadback(page);

    if (report.consoleErrors.length > 0) {
      throw new Error(`browser console errors detected: ${report.consoleErrors.slice(0, 3).map((item) => item.text).join(' | ')}`);
    }
    report.status = 'passed';
  } catch (error) {
    report.status = error?.auditKind === 'environment_blocker' ? 'blocked_env' : 'failed';
    report.error = String(error.message || error);
    report.blockerCode = error?.auditCode || null;
    report.blockerVerdict = error?.auditVerdict || null;
    if (Array.isArray(error?.launchFailures)) report.launchFailures = error.launchFailures;
    process.exitCode = 1;
  } finally {
    await closeSafely(browser, page, launcher);
    clearTimeout(watchdog);
    writeReport();
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'crm masterdata browser audit failed');
    process.exit(1);
  }

  console.log(`CRM masterdata browser audit passed. Report: ${REPORT_PATH}`);
  process.exit(0);
}

run();
