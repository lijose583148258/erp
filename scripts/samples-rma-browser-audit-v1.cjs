const fs = require('fs');
const path = require('path');
const { connectOrLaunchBrowser } = require('./lib/browser-connect-or-launch.cjs');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright', 'samples-rma-browser-audit-v1');
const REPORT_PATH = path.join(process.cwd(), 'output', 'playwright', 'samples-rma-browser-audit-report-v1.json');
const GLOBAL_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 290000);
const STEP_TIMEOUT_MS = 20000;
const ADMIN = { username: 'admin', password: 'admin123' };
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${process.pid}`;

const BAD_VISIBLE_TOKENS = [
  'undefined',
  'NaN',
  '\ufffd',
  '\u667a\u4ed4',
  '\u7039',
  '\u7481',
  '\u93c0',
  '\u95b2',
  '\u9351',
  '\u74a7',
  '\u748b',
  '\u7490',
  '\u93b9',
  '\u9417',
  '\u7db7',
  '\u951b',
  '\u697c',
];

const report = {
  name: 'samples-rma-browser-audit-v1',
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  status: 'running',
  launcher: null,
  seeded: {},
  steps: [],
  findings: [],
  consoleErrors: [],
  pageErrors: [],
  httpFailures: [],
};

let authToken = '';

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function saveReport() {
  ensureDir(path.dirname(REPORT_PATH));
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
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

async function apiFetch(page, endpoint, options = {}) {
  const response = await page.request.fetch(`${APP_URL}api${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
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

async function loginAndSeedStorage(page) {
  return withTimeout('login-and-seed-storage', STEP_TIMEOUT_MS, async () => {
    const response = await page.request.post(`${APP_URL}api/auth/login`, {
      data: ADMIN,
      timeout: STEP_TIMEOUT_MS,
    });
    const json = await response.json();
    assert(response.ok() && json?.data?.token && json?.data?.user, 'admin login failed', {
      status: response.status(),
      body: json,
    });
    authToken = json.data.token;
    const user = json.data.user;
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
      window.localStorage.setItem('auth_token', token);
      window.localStorage.setItem('erp_auth_token', token);
      window.localStorage.setItem('user', JSON.stringify(currentUser));
      window.localStorage.setItem('currentUser', JSON.stringify(currentUser));
      window.localStorage.setItem('erp_current_user', JSON.stringify(currentUser));
      window.localStorage.setItem('ailao.language', 'zh');
      window.localStorage.setItem('language', 'zh-CN');
      window.localStorage.setItem('currency', 'CNY');
    }, { token: authToken, savedUser: user });
    report.seeded.user = { id: user.id, username: user.username, role: user.role };
    return user;
  });
}

async function seedBusinessRecords(page) {
  return withTimeout('seed-samples-rma-records', STEP_TIMEOUT_MS, async () => {
    const customerName = `\u6837\u54c1\u552e\u540eUI\u5ba2\u6237-${RUN_ID}`;
    const customer = await apiFetch(page, '/customers', {
      method: 'POST',
      data: {
        nameZh: customerName,
        nameEn: `Samples RMA UI Customer ${RUN_ID}`,
        nameVi: `Khach Hang Mau RMA ${RUN_ID}`,
        licenseNumber: `SRUI-${RUN_ID}`,
        creditLimit: 20000,
        riskLevel: 'low',
        segment: 'direct',
        poolState: 'internal',
        contactName: 'Samples RMA Tester',
        contactPhone: `09${RUN_ID.slice(-8)}`,
        contactEmail: `samples-rma-${RUN_ID}@example.com`,
      },
    });
    assert(customer.ok && customer.json?.data?.id, 'create audit customer failed', {
      status: customer.status,
      body: customer.json,
    });

    const customerId = Number(customer.json.data.id);
    const sampleProduct = `UI-SAMPLE-GLUE-${RUN_ID}`;
    const sample = await apiFetch(page, '/samples', {
      method: 'POST',
      data: {
        customerId,
        productName: sampleProduct,
        quantity: 2,
        unit: 'kg',
        shippingAddress: `Sample audit address ${RUN_ID}`,
      },
    });
    assert(sample.ok && sample.json?.data?.id, 'create sample failed', {
      status: sample.status,
      body: sample.json,
    });

    const sentSample = await apiFetch(page, `/samples/${sample.json.data.id}/status`, {
      method: 'PATCH',
      data: {
        status: 'sent',
        trackingNo: `TRACK-${RUN_ID}`,
      },
    });
    assert(sentSample.ok && sentSample.json?.data?.status === 'sent', 'sample status update failed', {
      status: sentSample.status,
      body: sentSample.json,
    });

    const pendingRmaReason = `RMA-PENDING-${RUN_ID}`;
    const pendingRma = await apiFetch(page, '/rma', {
      method: 'POST',
      data: {
        customerId,
        productName: `UI-RMA-RESIN-${RUN_ID}`,
        quantity: 1,
        unit: 'kg',
        reason: pendingRmaReason,
        type: 'return',
      },
    });
    assert(pendingRma.ok && pendingRma.json?.data?.id && pendingRma.json.data.status === 'pending', 'create pending RMA failed', {
      status: pendingRma.status,
      body: pendingRma.json,
    });

    const approvedRmaReason = `RMA-APPROVED-${RUN_ID}`;
    const approvedRma = await apiFetch(page, '/rma', {
      method: 'POST',
      data: {
        customerId,
        productName: `UI-RMA-COATING-${RUN_ID}`,
        quantity: 1,
        unit: 'kg',
        reason: approvedRmaReason,
        type: 'refund',
      },
    });
    assert(approvedRma.ok && approvedRma.json?.data?.id, 'create approved RMA seed failed', {
      status: approvedRma.status,
      body: approvedRma.json,
    });

    const resolvedRma = await apiFetch(page, `/rma/${approvedRma.json.data.id}/resolve`, {
      method: 'PATCH',
      data: {
        status: 'approved',
        resolution: `approved by browser audit ${RUN_ID}`,
        refundAmount: 12.5,
      },
    });
    assert(resolvedRma.ok && resolvedRma.json?.data?.status === 'approved', 'approve RMA failed', {
      status: resolvedRma.status,
      body: resolvedRma.json,
    });

    report.seeded.customerId = customerId;
    report.seeded.sampleId = Number(sample.json.data.id);
    report.seeded.sampleProduct = sampleProduct;
    report.seeded.pendingRmaId = Number(pendingRma.json.data.id);
    report.seeded.pendingRmaReason = pendingRmaReason;
    report.seeded.approvedRmaId = Number(approvedRma.json.data.id);
    report.seeded.approvedRmaReason = approvedRmaReason;
  });
}

async function readBodyText(page, scope) {
  const bodyText = await page.locator('body').innerText({ timeout: STEP_TIMEOUT_MS });
  const badToken = BAD_VISIBLE_TOKENS.find((token) => bodyText.includes(token));
  assert(!badToken, `${scope} contains forbidden visible token`, {
    badToken,
    bodyPreview: bodyText.slice(0, 1200),
  });
  return bodyText;
}

async function waitForNoBlockingLoader(page, scope) {
  await page.waitForFunction(() => {
    const text = document.body.innerText || '';
    return !text.includes('\u7cfb\u7edf\u52a0\u8f7d\u4e2d...');
  }, null, { timeout: STEP_TIMEOUT_MS }).catch((error) => {
    throw new Error(`${scope} blocking loader did not disappear: ${String(error?.message || error)}`);
  });
}

async function screenshot(page, name) {
  const filePath = path.join(OUTPUT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true, timeout: 5000 });
  return filePath;
}

async function openAndVerifySamples(page) {
  return withTimeout('open-and-verify-samples-page', STEP_TIMEOUT_MS, async () => {
    await page.goto(`${APP_URL}#samples`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS });
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), report.seeded.sampleProduct, { timeout: STEP_TIMEOUT_MS });
    await waitForNoBlockingLoader(page, 'samples');
    const bodyText = await readBodyText(page, 'samples');
    assert(bodyText.includes(report.seeded.sampleProduct), 'sample product not visible after API seed', {
      sampleProduct: report.seeded.sampleProduct,
      bodyPreview: bodyText.slice(0, 1200),
    });
    assert(bodyText.includes('\u6837\u54c1') || /sample/i.test(bodyText), 'samples page title not visible', {
      bodyPreview: bodyText.slice(0, 1200),
    });
    report.seeded.samplesScreenshot = await screenshot(page, 'samples-page');
  });
}

async function openAndVerifyRma(page) {
  return withTimeout('open-and-verify-rma-page', STEP_TIMEOUT_MS, async () => {
    await page.goto(`${APP_URL}#rma`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS });
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), report.seeded.pendingRmaReason, { timeout: STEP_TIMEOUT_MS });
    await waitForNoBlockingLoader(page, 'rma');
    const bodyText = await readBodyText(page, 'rma');
    assert(bodyText.includes(report.seeded.pendingRmaReason), 'pending RMA reason not visible after API seed', {
      pendingRmaReason: report.seeded.pendingRmaReason,
      bodyPreview: bodyText.slice(0, 1200),
    });
    assert(bodyText.includes(report.seeded.approvedRmaReason), 'approved RMA reason not visible after resolve', {
      approvedRmaReason: report.seeded.approvedRmaReason,
      bodyPreview: bodyText.slice(0, 1200),
    });
    assert(bodyText.includes('\u5f85\u5ba1\u6279') || bodyText.includes('\u5f85\u5ba1\u6838') || /pending/i.test(bodyText), 'RMA pending status label not visible', {
      bodyPreview: bodyText.slice(0, 1200),
    });
    assert(bodyText.includes('\u5df2\u901a\u8fc7') || bodyText.includes('\u5df2\u9a8c\u8bc1') || /approved/i.test(bodyText), 'RMA approved status label not visible', {
      bodyPreview: bodyText.slice(0, 1200),
    });
    report.seeded.rmaScreenshot = await screenshot(page, 'rma-page');
  });
}

async function createRmaByUi(page) {
  return withTimeout('create-rma-by-ui', STEP_TIMEOUT_MS, async () => {
    const uiReason = `RMA-UI-CREATE-${RUN_ID}`;
    const uiProduct = `UI-RMA-FORM-RESIN-${RUN_ID}`;

    await page.getByTestId('rma-open-create').click({ timeout: STEP_TIMEOUT_MS });
    await page.getByTestId('rma-create-customer').selectOption(String(report.seeded.customerId), { timeout: STEP_TIMEOUT_MS });
    await page.getByTestId('rma-create-product').fill(uiProduct, { timeout: STEP_TIMEOUT_MS });
    await page.getByTestId('rma-create-quantity').fill('3', { timeout: STEP_TIMEOUT_MS });
    await page.getByTestId('rma-create-unit').fill('kg', { timeout: STEP_TIMEOUT_MS });
    await page.getByTestId('rma-create-type').selectOption('return', { timeout: STEP_TIMEOUT_MS });
    await page.getByTestId('rma-create-reason').fill(uiReason, { timeout: STEP_TIMEOUT_MS });
    await page.getByTestId('rma-create-submit').click({ timeout: STEP_TIMEOUT_MS });
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), uiReason, { timeout: STEP_TIMEOUT_MS });
    await waitForNoBlockingLoader(page, 'rma-ui-create');

    const bodyText = await readBodyText(page, 'rma-ui-create');
    assert(bodyText.includes(uiReason), 'UI-created RMA reason not visible after save', {
      uiReason,
      bodyPreview: bodyText.slice(0, 1200),
    });
    assert(bodyText.includes(uiProduct), 'UI-created RMA product not visible after save', {
      uiProduct,
      bodyPreview: bodyText.slice(0, 1200),
    });

    const readBack = await apiFetch(page, '/rma?pageSize=50');
    const rows = Array.isArray(readBack.json?.data) ? readBack.json.data : [];
    const found = rows.find((row) => row.reason === uiReason && row.status === 'pending');
    assert(readBack.ok && found, 'UI-created RMA did not read back from API as pending', {
      status: readBack.status,
      uiReason,
      body: readBack.json,
    });

    report.seeded.uiRmaId = Number(found.id);
    report.seeded.uiRmaReason = uiReason;
    report.seeded.uiRmaProduct = uiProduct;
    report.seeded.uiRmaScreenshot = await screenshot(page, 'rma-ui-created-page');
  });
}

async function resolveRmaByUi(page) {
  return withTimeout('resolve-rma-by-ui', STEP_TIMEOUT_MS, async () => {
    await page.getByTestId('rma-filter-pending').click({ timeout: STEP_TIMEOUT_MS });
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), report.seeded.uiRmaReason, { timeout: STEP_TIMEOUT_MS });
    await page.getByTestId(`rma-reject-${report.seeded.pendingRmaId}`).click({ timeout: STEP_TIMEOUT_MS });

    const rejected = await waitForRmaStatus(page, report.seeded.pendingRmaId, 'rejected');
    assert(rejected.reason === report.seeded.pendingRmaReason, 'rejected RMA reason changed after UI rejection', {
      expected: report.seeded.pendingRmaReason,
      actual: rejected,
    });

    await page.getByTestId(`rma-approve-${report.seeded.uiRmaId}`).click({ timeout: STEP_TIMEOUT_MS });
    const approved = await waitForRmaStatus(page, report.seeded.uiRmaId, 'approved');
    assert(approved.reason === report.seeded.uiRmaReason, 'approved UI-created RMA reason changed after UI approval', {
      expected: report.seeded.uiRmaReason,
      actual: approved,
    });

    await page.getByTestId('rma-filter-pending').click({ timeout: STEP_TIMEOUT_MS });
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), report.seeded.uiRmaReason, { timeout: STEP_TIMEOUT_MS });
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), report.seeded.pendingRmaReason, { timeout: STEP_TIMEOUT_MS });
    const bodyText = await readBodyText(page, 'rma-ui-resolve');
    assert(bodyText.includes('\u5df2\u901a\u8fc7') || bodyText.includes('\u5df2\u9a8c\u8bc1') || /approved/i.test(bodyText), 'approved status label not visible after UI approval', {
      bodyPreview: bodyText.slice(0, 1200),
    });
    assert(bodyText.includes('\u5df2\u62d2\u7edd') || /rejected/i.test(bodyText), 'rejected status label not visible after UI rejection', {
      bodyPreview: bodyText.slice(0, 1200),
    });

    report.seeded.uiRmaApprovedStatus = approved.status;
    report.seeded.pendingRmaRejectedStatus = rejected.status;
    report.seeded.rmaResolvedScreenshot = await screenshot(page, 'rma-resolved-page');
  });
}

async function waitForRmaStatus(page, id, expectedStatus) {
  const started = Date.now();
  while (Date.now() - started < STEP_TIMEOUT_MS) {
    const readBack = await apiFetch(page, '/rma?pageSize=100');
    const rows = Array.isArray(readBack.json?.data) ? readBack.json.data : [];
    const found = rows.find((row) => Number(row.id) === Number(id));
    if (readBack.ok && found?.status === expectedStatus) return found;
    await page.waitForTimeout(400);
  }
  throw new Error(`RMA ${id} did not reach ${expectedStatus}`);
}

async function main() {
  ensureDir(OUTPUT_DIR);
  saveReport();
  const watchdog = setTimeout(() => {
    report.status = 'stuck';
    report.error = `samples/rma browser audit exceeded ${GLOBAL_TIMEOUT_MS}ms`;
    saveReport();
    console.error(report.error);
    process.exit(124);
  }, GLOBAL_TIMEOUT_MS);

  let browser = null;
  let context = null;
  let page = null;
  try {
    const launched = await connectOrLaunchBrowser({
      recordStep,
      retryLimit: 1,
      waitMs: 800,
      cdpRequired: process.env.BROWSER_CDP_REQUIRED === '1',
    });
    browser = launched.browser;
    report.launcher = launched.launcher;
    report.endpoint = launched.endpoint || null;

    context = browser.contexts()[0] || await browser.newContext({ viewport: { width: 1440, height: 980 } });
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('console', (message) => {
      if (message.type() === 'error') report.consoleErrors.push({ at: new Date().toISOString(), text: message.text(), url: page.url() });
    });
    page.on('pageerror', (error) => {
      report.pageErrors.push({ at: new Date().toISOString(), text: String(error.message || error), url: page.url() });
    });
    page.on('requestfailed', (request) => {
      const url = request.url();
      if (url.startsWith(APP_URL)) {
        report.httpFailures.push({
          at: new Date().toISOString(),
          url,
          method: request.method(),
          failure: request.failure()?.errorText || 'unknown',
        });
      }
    });

    await loginAndSeedStorage(page);
    await seedBusinessRecords(page);
    await openAndVerifySamples(page);
    await openAndVerifyRma(page);
    await createRmaByUi(page);
    await resolveRmaByUi(page);

    assert(report.pageErrors.length === 0, 'page errors appeared during samples/rma audit', { pageErrors: report.pageErrors });
    const fatalConsoleErrors = report.consoleErrors.filter((entry) => !/timeout of \d+ms exceeded/i.test(entry.text));
    assert(fatalConsoleErrors.length === 0, 'console errors appeared during samples/rma audit', { consoleErrors: fatalConsoleErrors });

    report.status = 'passed';
  } catch (error) {
    report.status = error?.auditKind === 'environment_blocker' ? 'blocked_env' : 'failed';
    report.error = String(error?.message || error);
    report.blockerCode = error?.auditCode || null;
    report.blockerVerdict = error?.auditVerdict || null;
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    if (page) await withTimeout('page-close', 5000, async () => page.close()).catch(() => {});
    if (context) await withTimeout('context-close', 5000, async () => context.close()).catch(() => {});
    if (browser && report.launcher !== 'cdp') await withTimeout('browser-close', 5000, async () => browser.close()).catch(() => {});
    report.finishedAt = new Date().toISOString();
    saveReport();
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'samples/rma browser audit failed');
    process.exit(process.exitCode || 1);
  }

  console.log(`samples/rma browser audit passed. Report: ${REPORT_PATH}`);
}

main().catch((error) => {
  report.status = 'failed';
  report.error = String(error?.message || error);
  report.finishedAt = new Date().toISOString();
  saveReport();
  console.error(report.error);
  process.exit(1);
});
