const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');
const { loginUiAuditUser } = require('./lib/ui-audit-user.cjs');
const {
  ensureDir,
  createStepRecorder,
  createStallGuard,
  withTimebox,
  waitForBodyText,
  waitForRowByText,
  assertNoMojibake,
} = require('./lib/audit-utils.cjs');
const {
  FORBIDDEN_MOJIBAKE,
  STEP_TIMEOUT_MS,
  STUCK_MS,
} = require('./lib/production-browser-audit-fixtures.cjs');
const {
  buildBomPasteText,
  fillBomHeaderFields,
  loginViaUi,
  parsePayload,
  readAuthTokenFromStorage,
  waitForAnyBodyText,
} = require('./lib/production-browser-audit-helpers.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.resolve(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'production-save-readback-contract-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'production-save-readback-contract-audit-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const AUDIT_ACCOUNT = {
  username: process.env.AUDIT_READBACK_USERNAME || 'production_readback_admin',
  password: process.env.AUDIT_READBACK_PASSWORD || 'AuditSmoke12345!',
  role: 'admin',
};

const CONTRACT_DATA = {
  bomName: `CONTRACT-BOM-${RUN_ID}`,
  bomVersion: 'v1',
  bomType: 'chemical_formula',
  bomStatus: 'active',
  formulationMode: 'percentage',
  outputUnit: 'kg',
  standardBatchSize: '1000',
  batchSizeUnit: 'kg',
  density: '1.12',
  solidContent: '55',
  effectiveFrom: '2026-04-16',
  effectiveTo: '2026-12-31',
  processSummary: '预混 -> 分散 -> 过滤',
  qualitySummary: '固含 55% +/-2%, 粘度 6000-9000cps, 外观均匀无结块',
  items: [
    { materialName: '树脂主料A', materialCode: 'FIX-01', ingredientRole: 'main_resin', dosageMode: 'fixed', percentage: '', quantityPerUnit: '1.25', unit: 'kg', lossRate: '1', allowedVarianceRate: '3', processStage: '预混', substituteGroup: '', yieldContribution: '', notes: '固定用量' },
    { materialName: '树脂辅料B', materialCode: 'FIX-02', ingredientRole: 'modifier_resin', dosageMode: 'fixed', percentage: '', quantityPerUnit: '0.75', unit: 'kg', lossRate: '0.5', allowedVarianceRate: '3', processStage: '预混', substituteGroup: '', yieldContribution: '', notes: '固定用量' },
    { materialName: '稳定剂C', materialCode: 'FIX-03', ingredientRole: 'additive', dosageMode: 'fixed', percentage: '', quantityPerUnit: '0.40', unit: 'kg', lossRate: '0.2', allowedVarianceRate: '2', processStage: '调配', substituteGroup: '', yieldContribution: '', notes: '固定用量' },
    { materialName: '消泡剂D', materialCode: 'FIX-04', ingredientRole: 'defoamer', dosageMode: 'fixed', percentage: '', quantityPerUnit: '0.15', unit: 'kg', lossRate: '0.2', allowedVarianceRate: '2', processStage: '调漆', substituteGroup: '', yieldContribution: '', notes: '固定用量' },
    { materialName: '增稠剂E', materialCode: 'FIX-05', ingredientRole: 'thickener', dosageMode: 'fixed', percentage: '', quantityPerUnit: '0.30', unit: 'kg', lossRate: '0.3', allowedVarianceRate: '2', processStage: '调粘', substituteGroup: '', yieldContribution: '', notes: '固定用量' },
    { materialName: '溶剂F', materialCode: 'PCT-06', ingredientRole: 'solvent', dosageMode: 'percentage', percentage: '20', quantityPerUnit: '0.20', unit: 'kg', lossRate: '1', allowedVarianceRate: '4', processStage: '分散', substituteGroup: '', yieldContribution: '', notes: '百分比用量' },
    { materialName: '稀释剂G', materialCode: 'PCT-07', ingredientRole: 'diluent', dosageMode: 'percentage', percentage: '18', quantityPerUnit: '0.18', unit: 'kg', lossRate: '1', allowedVarianceRate: '4', processStage: '分散', substituteGroup: '', yieldContribution: '', notes: '百分比用量' },
    { materialName: '颜料H', materialCode: 'PCT-08', ingredientRole: 'pigment', dosageMode: 'percentage', percentage: '16', quantityPerUnit: '0.16', unit: 'kg', lossRate: '1', allowedVarianceRate: '4', processStage: '过滤', substituteGroup: '', yieldContribution: '', notes: '百分比用量' },
    { materialName: '表活I', materialCode: 'PCT-09', ingredientRole: 'surfactant', dosageMode: 'percentage', percentage: '24', quantityPerUnit: '0.24', unit: 'kg', lossRate: '1', allowedVarianceRate: '4', processStage: '过滤', substituteGroup: '', yieldContribution: '', notes: '百分比用量' },
    { materialName: '催化剂J', materialCode: 'PCT-10', ingredientRole: 'catalyst', dosageMode: 'percentage', percentage: '22', quantityPerUnit: '0.22', unit: 'kg', lossRate: '1', allowedVarianceRate: '4', processStage: '后处理', substituteGroup: '', yieldContribution: '', notes: '百分比用量' },
  ],
};

const report = {
  name: 'Production Save Readback Contract Audit',
  version: '1.0',
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  status: 'running',
  steps: [],
};

let authToken = '';
let browser = null;

function recordFinal() {
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

async function apiFetch(page, endpoint, options = {}) {
  let response = await page.request.fetch(`${APP_URL}api${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (response.status() === 401) {
    await seedAuthToken(page);
    response = await page.request.fetch(`${APP_URL}api${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(options.headers || {}),
      },
    });
  }
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: response.ok(), status: response.status(), json };
}

async function seedAuthToken(page) {
  const session = await loginUiAuditUser(page, APP_URL, {
    account: AUDIT_ACCOUNT,
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

async function syncAuthTokenFromPage(page) {
  const token = await readAuthTokenFromStorage(page);
  if (token) authToken = token;
  if (!authToken) throw new Error('audit page has no auth token');
}

async function openProductionRoute(page, recordStep) {
  await withTimebox(page, recordStep, 'open-production-route', STEP_TIMEOUT_MS.route, async () => {
    await page.goto(`${APP_URL}#production`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS.route });
    await page.evaluate(() => {
      window.localStorage.setItem('ailao.activeTab', 'production');
      window.location.hash = '#production';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitForAnyBodyText(page, ['配方主档工作台', '工单工作台', '批次列表'], STEP_TIMEOUT_MS.route);
    assertNoMojibake(await page.locator('body').innerText(), 'production route', FORBIDDEN_MOJIBAKE);
  }, SHOT_DIR);
}

async function fillContractDraft(page) {
  await fillBomHeaderFields(page, CONTRACT_DATA);
  const pasteText = buildBomPasteText(CONTRACT_DATA.items);
  const pasteBox = page.getByTestId('production-bom-paste-textarea');
  if (!(await pasteBox.count())) {
    const openPaste = page.getByTestId('production-bom-open-paste-panel');
    if (await openPaste.count()) await openPaste.click();
  }
  await pasteBox.fill(pasteText);
  await page.getByTestId('production-bom-apply-paste').click();
  await page.waitForTimeout(400);

  for (let index = 0; index < CONTRACT_DATA.items.length; index += 1) {
    const row = page.getByTestId(`production-bom-line-row-${index}`);
    const expected = CONTRACT_DATA.items[index];
    const materialName = await row.getByTestId(`production-bom-row-${index}-material-name`).inputValue();
    const materialCode = await row.getByTestId(`production-bom-row-${index}-material-code`).inputValue();
    const ingredientRole = await row.getByTestId(`production-bom-row-${index}-ingredient-role`).inputValue();
    const dosageMode = await row.getByTestId(`production-bom-row-${index}-dosage-mode`).inputValue();
    const percentage = await row.getByTestId(`production-bom-row-${index}-percentage`).inputValue();
    const quantityPerUnit = await row.getByTestId(`production-bom-row-${index}-quantity-per-unit`).inputValue();
    if (materialName !== expected.materialName) throw new Error(`row ${index + 1} materialName mismatch`);
    if (materialCode !== expected.materialCode) throw new Error(`row ${index + 1} materialCode mismatch`);
    if (ingredientRole !== expected.ingredientRole) throw new Error(`row ${index + 1} ingredientRole mismatch`);
    if (dosageMode !== expected.dosageMode) throw new Error(`row ${index + 1} dosageMode mismatch`);
    if (percentage !== expected.percentage) throw new Error(`row ${index + 1} percentage mismatch`);
    if (Number(quantityPerUnit || 0) !== Number(expected.quantityPerUnit || 0)) throw new Error(`row ${index + 1} quantityPerUnit mismatch`);
  }
}

async function saveAndVerifyReadback(page, recordStep) {
  await withTimebox(page, recordStep, 'trigger-bom-save', STEP_TIMEOUT_MS.save, async () => {
    await page.getByTestId('production-bom-save').click();
    await page.waitForTimeout(300);
  }, SHOT_DIR);

  const created = await withTimebox(page, recordStep, 'verify-bom-readback-list', STEP_TIMEOUT_MS.readBack, async () => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const res = await apiFetch(page, '/production/boms');
      if (!res.ok) throw new Error(`production boms api failed: ${res.status}`);
      const boms = parsePayload(res) || [];
      const bom = boms.find((item) => item.productName === CONTRACT_DATA.bomName);
      if (!bom) {
        await page.waitForTimeout(300);
        continue;
      }
      if (!Array.isArray(bom.items) || bom.items.length !== CONTRACT_DATA.items.length) {
        throw new Error(`bom items count mismatch: ${bom.items?.length}`);
      }
      CONTRACT_DATA.items.forEach((expected, index) => {
        const actual = bom.items[index];
        if (!actual) throw new Error(`missing bom item ${index + 1}`);
        if ((actual.materialCode || '') !== expected.materialCode) throw new Error(`materialCode mismatch at row ${index + 1}`);
        if ((actual.dosageMode || '') !== expected.dosageMode) throw new Error(`dosageMode mismatch at row ${index + 1}`);
        if (Number(actual.percentage || 0) !== Number(expected.percentage || 0)) throw new Error(`percentage mismatch at row ${index + 1}`);
        if (Number(actual.quantityPerUnit || 0) !== Number(expected.quantityPerUnit || 0)) throw new Error(`quantityPerUnit mismatch at row ${index + 1}`);
        if ((actual.processStage || '') !== (expected.processStage || '')) throw new Error(`processStage mismatch at row ${index + 1}`);
      });
      return bom;
    }
    throw new Error('created BOM not found in API readback');
  }, SHOT_DIR);

  await withTimebox(page, recordStep, 'verify-bom-ui-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const row = await waitForRowByText(page, CONTRACT_DATA.bomName, STEP_TIMEOUT_MS.readBack);
    await row.click();
    await waitForBodyText(page, [CONTRACT_DATA.bomName, '配方状态', '质检规范'], STEP_TIMEOUT_MS.readBack);
    assertNoMojibake(await page.locator('body').innerText(), 'bom ui readback', FORBIDDEN_MOJIBAKE);
  }, SHOT_DIR);

  return created;
}

async function verifyDraftPreservedOnFailedSave(page, recordStep) {
  await withTimebox(page, recordStep, 'verify-failed-save-keeps-draft', STEP_TIMEOUT_MS.fill, async () => {
    await fillContractDraft(page);
    await page.getByTestId('production-bom-product-name').fill('');
    await page.getByTestId('production-bom-save').click();
    const warning = await waitForAnyBodyText(page, ['请填写产品名称'], STEP_TIMEOUT_MS.readBack);
    if (!warning.matched) throw new Error('validation warning missing');

    const firstRow = page.getByTestId('production-bom-line-row-0');
    const lastRow = page.getByTestId(`production-bom-line-row-${CONTRACT_DATA.items.length - 1}`);
    const firstMaterialName = await firstRow.getByTestId('production-bom-row-0-material-name').inputValue();
    const lastMaterialCode = await lastRow.getByTestId(`production-bom-row-${CONTRACT_DATA.items.length - 1}-material-code`).inputValue();
    if (firstMaterialName !== CONTRACT_DATA.items[0].materialName) throw new Error('draft was cleared after failed save');
    if (lastMaterialCode !== CONTRACT_DATA.items[CONTRACT_DATA.items.length - 1].materialCode) throw new Error('tail draft was cleared after failed save');
  }, SHOT_DIR);
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
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await seedAuthToken(page);
    await loginViaUi(page, { appUrl: APP_URL, recordStep, withTimebox, timeout: STEP_TIMEOUT_MS.login, shotDir: SHOT_DIR, account: AUDIT_ACCOUNT });
    await syncAuthTokenFromPage(page);
    stallGuard.assertAlive('after-login');
    await openProductionRoute(page, recordStep);
    stallGuard.assertAlive('after-route-open');
    await fillContractDraft(page);
    stallGuard.assertAlive('after-draft-fill');
    await saveAndVerifyReadback(page, recordStep);
    stallGuard.assertAlive('after-readback');
    await verifyDraftPreservedOnFailedSave(page, recordStep);
    stallGuard.assertAlive('after-failed-save');
    report.status = 'passed';
  } catch (error) {
    if (error?.auditKind === 'stuck_timeout') {
      report.status = 'stuck';
      report.error = String(error.message || error);
      report.blockerCode = error.auditCode;
      report.blockerKind = error.auditKind;
      report.blockerVerdict = error.auditVerdict;
      report.elapsedMs = error.elapsedMs;
    } else {
      markReportFromLaunchError(report, error);
      if (report.status !== 'blocked_env') process.exitCode = 1;
    }
    if (report.status !== 'blocked_env' && report.status !== 'stuck') process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    recordFinal();
    if (browser) await browser.close().catch(() => {});
  }
  if (report.status === 'passed') console.log(`Production save readback contract audit passed. Report: ${REPORT_PATH}`);
  else if (report.status === 'blocked_env') console.warn(`Production save readback contract audit blocked by environment. Report: ${REPORT_PATH}`);
  else if (report.status === 'stuck') console.error(`Production save readback contract audit stuck. Report: ${REPORT_PATH}`);
  else console.error(report.error || 'production save readback contract audit failed');
}

main();
