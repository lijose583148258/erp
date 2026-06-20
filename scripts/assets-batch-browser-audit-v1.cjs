const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');
const {
  ensureDir,
  createStepRecorder,
  createStallGuard,
  safeScreenshot,
  withTimebox,
  waitForBodyText,
  waitForRowByText,
  assertNoMojibake,
} = require('./lib/audit-utils.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.resolve(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'assets-batch-browser-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'assets-batch-browser-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const STUCK_MS = 5 * 60 * 1000;
const TIMEOUTS = {
  login: 20000,
  route: 20000,
  save: 30000,
  readBack: 20000,
};
const FORBIDDEN_MOJIBAKE = ['\uFFFD', '鍔', '鐢', '涓', '乱码'];
const DATA = {
  batchNo: `ASSET-BATCH-${RUN_ID}`,
  productName: `资产批次边界测试-${RUN_ID}`,
  productionDate: '2026-04-16',
  expiryDate: '2026-12-31',
  storageTemp: '常温',
  unit: 'kg',
  notes: `assets batch browser audit ${RUN_ID}`,
};

const report = {
  name: 'Assets Batch Browser Audit',
  version: '1.0',
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  data: DATA,
  steps: [],
  status: 'running',
};

let browser = null;
let authToken = '';

function recordFinal() {
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

async function loginApi(page) {
  const response = await page.request.post(`${APP_URL}api/auth/login`, {
    data: { username: 'admin', password: 'admin123', role: 'super_admin' },
  });
  if (!response.ok()) throw new Error(`login api failed: ${response.status()}`);
  const json = await response.json();
  authToken = json?.data?.token;
  const user = json?.data?.user;
  if (!authToken || !user) throw new Error('login api returned empty token or user');
  await page.addInitScript(({ token, currentUser }) => {
    const appUser = {
      id: String(currentUser.id),
      name: currentUser.username,
      role: currentUser.role,
      segment: currentUser.segment || 'mixed',
      avatar: currentUser.avatar || '',
    };
    window.localStorage.setItem('token', token);
    window.localStorage.setItem('auth_token', token);
    window.localStorage.setItem('erp_auth_token', token);
    window.localStorage.setItem('user', JSON.stringify(appUser));
    window.localStorage.setItem('currentUser', JSON.stringify(currentUser));
    window.localStorage.setItem('erp_current_user', JSON.stringify(currentUser));
    window.localStorage.setItem('erp_current_role', currentUser.role || 'admin');
    window.localStorage.setItem('ailao.activeTab', 'assets');
    window.localStorage.setItem('ailao.language', 'zh');
    window.localStorage.setItem('language', 'zh-CN');
  }, { token: authToken, currentUser: user });
}

async function apiFetch(page, endpoint, options = {}) {
  const response = await page.request.fetch(`${APP_URL}api${endpoint}`, {
    ...options,
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

function parseList(payload) {
  const data = payload?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function openAssetsBatchPage(page, recordStep) {
  await withTimebox(page, recordStep, 'open-assets-batch-route', TIMEOUTS.route, async () => {
    await page.goto(`${APP_URL}#assets`, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.route });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.getByTestId('assets-tab-batch').waitFor({ state: 'visible', timeout: TIMEOUTS.route });
    await page.getByTestId('assets-tab-batch').click();
    await waitForBodyText(page, ['批次档案补录', '真实库存请从生产完工、仓储入库或库存调整入口形成凭证'], TIMEOUTS.readBack);
    assertNoMojibake(await page.locator('body').innerText(), 'assets batch route', FORBIDDEN_MOJIBAKE);
  }, SHOT_DIR);
  recordStep({ step: 'assets-batch-route-evidence', result: 'passed', evidence: await safeScreenshot(page, SHOT_DIR, 'assets-batch-route') });
}

async function verifyStockInputBoundary(page, recordStep) {
  await withTimebox(page, recordStep, 'verify-assets-batch-stock-readonly', TIMEOUTS.readBack, async () => {
    const stockInput = page.getByTestId('assets-batch-stock-readonly');
    await stockInput.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    const value = await stockInput.inputValue();
    const readOnly = await stockInput.evaluate((element) => element.readOnly);
    const title = await stockInput.getAttribute('title');
    if (value !== '0') throw new Error(`expected readonly batch stock default 0, got ${value}`);
    if (!readOnly) throw new Error('assets batch stock input is not readonly');
    if (!String(title || '').includes('库存凭证')) throw new Error(`assets batch stock title does not explain ledger source: ${title}`);
    report.stockBoundary = { value, readOnly, title };
  }, SHOT_DIR);
}

async function createBatchViaUi(page, recordStep) {
  await withTimebox(page, recordStep, 'create-assets-batch-via-ui', TIMEOUTS.save, async () => {
    await page.getByTestId('assets-batch-no-input').fill(DATA.batchNo);
    await page.getByTestId('assets-batch-product-input').fill(DATA.productName);
    await page.getByTestId('assets-batch-storage-temp-input').fill(DATA.storageTemp);
    await page.getByTestId('assets-batch-production-date-input').fill(DATA.productionDate);
    await page.getByTestId('assets-batch-expiry-date-input').fill(DATA.expiryDate);
    await page.getByTestId('assets-batch-unit-input').fill(DATA.unit);
    await page.getByTestId('assets-batch-notes-input').fill(DATA.notes);
    await page.getByTestId('assets-batch-cold-chain-checkbox').check();
    await page.getByTestId('assets-batch-create-button').click();
  }, SHOT_DIR);
}

async function verifyBatchReadback(page, recordStep) {
  let batch = null;
  await withTimebox(page, recordStep, 'verify-assets-batch-ui-readback', TIMEOUTS.readBack, async () => {
    await page.getByTestId('assets-batch-status-filter').selectOption('all');
    await page.getByTestId('assets-batch-search-input').fill(DATA.batchNo);
    const row = await waitForRowByText(page, DATA.batchNo, TIMEOUTS.readBack);
    await row.click();
    const bodyText = await page.locator('body').innerText();
    if (!bodyText.includes(DATA.productName)) throw new Error('created asset batch product name missing from UI readback');
    if (!bodyText.includes('0 kg')) throw new Error('created asset batch should show 0 kg stock from UI ledger boundary');
    assertNoMojibake(bodyText, 'assets batch ui readback', FORBIDDEN_MOJIBAKE);
  }, SHOT_DIR);

  await withTimebox(page, recordStep, 'verify-assets-batch-api-readback', TIMEOUTS.readBack, async () => {
    const response = await apiFetch(page, `/assets/batches?keyword=${encodeURIComponent(DATA.batchNo)}&page=1&pageSize=10`);
    if (!response.ok) throw new Error(`assets batch api readback failed: ${response.status}`);
    const list = parseList(response);
    batch = list.find((item) => item.batchNo === DATA.batchNo);
    if (!batch) throw new Error('created asset batch not found in API readback');
    if (String(batch.productName) !== DATA.productName) throw new Error(`asset batch productName mismatch: ${batch.productName}`);
    if (Number(batch.stockQuantity || 0) !== 0) throw new Error(`asset batch stock should stay 0 in archive UI path, got ${batch.stockQuantity}`);
    if (!batch.isColdChain) throw new Error('asset batch cold-chain flag was not persisted');
    report.createdBatch = {
      id: batch.id,
      batchNo: batch.batchNo,
      productName: batch.productName,
      stockQuantity: Number(batch.stockQuantity || 0),
      unit: batch.unit,
      isColdChain: Boolean(batch.isColdChain),
    };
  }, SHOT_DIR);

  recordStep({
    step: 'assets-batch-readback-evidence',
    result: 'passed',
    batchId: batch?.id,
    evidence: await safeScreenshot(page, SHOT_DIR, 'assets-batch-readback'),
  });
}

async function main() {
  ensureDir(OUTPUT_DIR);
  ensureDir(SHOT_DIR);
  recordFinal();
  const recordStep = createStepRecorder(report, REPORT_PATH);
  const stallGuard = createStallGuard(report, STUCK_MS);
  try {
    const launched = await launchBrowserWithGuard({ recordStep, retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    report.launcher = launched.launcher;
    report.spawnPolicyProbe = launched.spawnPolicyProbe || null;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await loginApi(page);
    stallGuard.assertAlive('after-login');
    await openAssetsBatchPage(page, recordStep);
    stallGuard.assertAlive('after-route');
    await verifyStockInputBoundary(page, recordStep);
    stallGuard.assertAlive('after-boundary');
    await createBatchViaUi(page, recordStep);
    stallGuard.assertAlive('after-create');
    await verifyBatchReadback(page, recordStep);
    stallGuard.assertAlive('after-readback');
    report.status = 'passed';
  } catch (error) {
    if (error?.auditKind === 'stuck_timeout') {
      report.status = 'stuck';
      report.error = String(error.message || error);
      report.blockerCode = error.auditCode;
      report.blockerKind = error.auditKind;
      report.elapsedMs = error.elapsedMs;
    } else {
      markReportFromLaunchError(report, error);
      if (report.status !== 'blocked_env') process.exitCode = 1;
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    recordFinal();
    if (browser) await browser.close().catch(() => {});
  }
  if (report.status === 'passed') console.log(`Assets batch browser audit passed. Report: ${REPORT_PATH}`);
  else if (report.status === 'blocked_env') console.warn(`Assets batch browser audit blocked by environment. Report: ${REPORT_PATH}`);
  else if (report.status === 'stuck') console.error(`Assets batch browser audit stuck. Report: ${REPORT_PATH}`);
  else console.error(report.error || 'assets batch browser audit failed');
}

main();
