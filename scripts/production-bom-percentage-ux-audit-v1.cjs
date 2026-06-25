const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard } = require('./lib/browser-launch-guard.cjs');
const { loginUiAuditUser } = require('./lib/ui-audit-user.cjs');
const {
  ensureDir,
  createStepRecorder,
  createStallGuard,
  safeScreenshot,
  withTimebox,
  waitForBodyText,
  waitForRowByText,
} = require('./lib/audit-utils.cjs');
const {
  S,
  STEP_TIMEOUT_MS,
  STUCK_MS,
  createProductionAuditData,
} = require('./lib/production-browser-audit-fixtures.cjs');
const {
  buildBomPasteText,
  fillBomHeaderFields,
  loginViaUi,
  parsePayload,
  switchProductionDesk,
  waitForAnyBodyText,
} = require('./lib/production-browser-audit-helpers.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.resolve(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'production-bom-percentage-ux-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'production-bom-percentage-ux-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const TEST_DATA = createProductionAuditData(RUN_ID);

const report = {
  name: 'Production BOM Percentage UX Audit',
  version: '1.0',
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  steps: [],
  status: 'running',
};

let authToken = '';

function recordFinal() {
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

async function apiFetch(page, endpoint, options = {}) {
  const response = await page.request.fetch(`${APP_URL}api${endpoint}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...(options.headers || {}) },
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { ok: response.ok(), status: response.status(), json };
}

async function seedAuthToken(page) {
  const session = await loginUiAuditUser(page, APP_URL, {
    storage: {
      'ailao.activeTab': 'production',
      'ailao.language': 'zh',
      language: 'zh',
      currency: 'CNY',
    },
  });
  authToken = session.token;
  if (!authToken) throw new Error('login api returned empty token');
}

async function openProductionRoute(page, recordStep) {
  await withTimebox(page, recordStep, 'open-production-route', STEP_TIMEOUT_MS.route, async () => {
    await page.goto(`${APP_URL}#production`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS.route });
    await page.evaluate(() => {
      window.localStorage.setItem('ailao.activeTab', 'production');
      window.location.hash = '#production';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitForAnyBodyText(page, [S.bomManagement, S.workOrderDesk, S.batchList], STEP_TIMEOUT_MS.route);
  }, SHOT_DIR);
  recordStep({ step: 'production-route-evidence', result: 'passed', evidence: await safeScreenshot(page, SHOT_DIR, 'production-route') });
}

async function createPercentageBom(page, recordStep) {
  const pasteItems = TEST_DATA.items.map((item, index) => {
    if (index === 0) return { ...item, percentage: '35', quantityPerUnit: '350' };
    if (index === 1) return { ...item, percentage: '25', quantityPerUnit: '250' };
    return item;
  });
  const pasteText = buildBomPasteText(pasteItems);

  await withTimebox(page, recordStep, 'fill-percentage-bom', STEP_TIMEOUT_MS.fill, async () => {
    await fillBomHeaderFields(page, TEST_DATA);
    const openPaste = page.getByTestId('production-bom-open-paste-panel');
    if (await openPaste.count()) await openPaste.click();
    await page.getByTestId('production-bom-paste-textarea').fill(pasteText);
    await page.getByTestId('production-bom-apply-paste').click();
    const previewChips = {
      effective: page.getByTestId('production-bom-preview-effective-count'),
      rejected: page.getByTestId('production-bom-preview-rejected-count'),
      percentage: page.getByTestId('production-bom-preview-percentage-total'),
      batch: page.getByTestId('production-bom-preview-standard-batch'),
      expected: page.getByTestId('production-bom-preview-expected-saved-count'),
    };
    for (const [name, locator] of Object.entries(previewChips)) {
      if (!(await locator.count())) {
        throw new Error(`missing preview chip: ${name}`);
      }
    }
    const previewValues = {
      effective: await previewChips.effective.innerText(),
      rejected: await previewChips.rejected.innerText(),
      percentage: await previewChips.percentage.innerText(),
      batch: await previewChips.batch.innerText(),
      expected: await previewChips.expected.innerText(),
    };
    if (!previewValues.effective.includes('10 行')) throw new Error(`effective preview mismatch: ${previewValues.effective}`);
    if (!previewValues.rejected.includes('0 行')) throw new Error(`rejected preview mismatch: ${previewValues.rejected}`);
    if (!previewValues.percentage.includes('100.00%')) throw new Error(`percentage preview mismatch: ${previewValues.percentage}`);
    if (!previewValues.batch.includes('1000')) throw new Error(`batch preview mismatch: ${previewValues.batch}`);
    if (!previewValues.expected.includes('10 行')) throw new Error(`expected preview mismatch: ${previewValues.expected}`);
  }, SHOT_DIR);

  await withTimebox(page, recordStep, 'save-percentage-bom', STEP_TIMEOUT_MS.save, async () => {
    await page.getByTestId('production-bom-save').click();
  }, SHOT_DIR);

  const created = await withTimebox(page, recordStep, 'verify-percentage-api-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const res = await apiFetch(page, '/production/boms');
    if (!res.ok) throw new Error(`production boms api failed: ${res.status}`);
    const boms = parsePayload(res) || [];
    const bom = boms.find((item) => item.productName === TEST_DATA.bomName);
    if (!bom) throw new Error('saved percentage BOM not found in API readback');
    if (!Array.isArray(bom.items) || bom.items.length !== 10) throw new Error(`saved BOM item count mismatch: ${bom.items?.length || 0}`);
    const first = bom.items[0];
    if (String(first.percentage || '') !== '35') throw new Error(`saved first percentage mismatch: ${first.percentage}`);
    if (String(first.quantityPerUnit || '') !== '0.35') throw new Error(`saved first quantity mismatch: ${first.quantityPerUnit}`);
    return bom;
  }, SHOT_DIR);

  await withTimebox(page, recordStep, 'verify-percentage-ui-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const row = await waitForRowByText(page, TEST_DATA.bomName, STEP_TIMEOUT_MS.readBack);
    await row.click();
    await waitForBodyText(page, [TEST_DATA.bomName, S.standardBatch, S.formulaStatus], STEP_TIMEOUT_MS.readBack);
  }, SHOT_DIR);

  recordStep({ step: 'percentage-bom-created-evidence', result: 'passed', bomId: created.id, bomNo: created.bomNo, evidence: await safeScreenshot(page, SHOT_DIR, 'percentage-bom-created') });
}

async function main() {
  ensureDir(SHOT_DIR);
  const recordStep = createStepRecorder(report, REPORT_PATH);
  const stallGuard = createStallGuard(STUCK_MS, SHOT_DIR, recordStep, report);
  let browser;
  try {
    const launched = await launchBrowserWithGuard({ recordStep, retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    report.launcher = launched.launcher;
    report.spawnPolicyProbe = launched.spawnPolicyProbe || null;
    const page = await browser.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS.readBack);
    await seedAuthToken(page);
    await loginViaUi(page, { appUrl: APP_URL, recordStep, withTimebox, timeout: STEP_TIMEOUT_MS.login, shotDir: SHOT_DIR });
    await openProductionRoute(page, recordStep);
    await switchProductionDesk(page, {
      testId: 'production-desk-bom',
      fallbackName: /配方/,
      expectedText: S.bomManagement,
    }, waitForAnyBodyText, STEP_TIMEOUT_MS.readBack);
    await createPercentageBom(page, recordStep);
    report.status = 'passed';
    recordFinal();
  } catch (error) {
    report.status = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
    recordFinal();
    throw error;
  } finally {
    stallGuard.stop?.();
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
