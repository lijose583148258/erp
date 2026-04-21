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
const SHOT_DIR = path.join(OUTPUT_DIR, 'production-browser-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'production-browser-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const STUCK_MS = 5 * 60 * 1000;
const FORBIDDEN_MOJIBAKE = [0x95ba, 0x95b8, 0x95bb, 0x7039, 0x9420, 0x95c1, 0x9422, 0x5bb8, 0x93bc, 0x9417, 0x7490, 0x6fb6, 0x9352, 0x93c7, 0x8133, 0xfffd].map((code) => String.fromCharCode(code));

const S = {
  bomManagement: '\u0042\u004f\u004d \u7ba1\u7406',
  workOrderDesk: '\u5de5\u5355\u5de5\u4f5c\u53f0',
  batchList: '\u6279\u6b21\u5217\u8868',
  productName: '\u4ea7\u54c1\u540d\u79f0',
  version: '\u7248\u672c',
  bomType: '\u0042\u004f\u004d \u7c7b\u578b',
  formulaStatus: '\u914d\u65b9\u72b6\u6001',
  formulaMode: '\u914d\u65b9\u6a21\u5f0f',
  outputUnit: '\u8f93\u51fa\u5355\u4f4d',
  standardBatch: '\u6807\u51c6\u6279\u91cf',
  batchUnit: '\u6279\u91cf\u5355\u4f4d',
  density: '\u5bc6\u5ea6',
  solidContent: '\u56fa\u542b %',
  processSummary: '\u5de5\u827a\u6458\u8981',
  effectiveFrom: '\u751f\u6548\u5f00\u59cb',
  effectiveTo: '\u751f\u6548\u7ed3\u675f',
  qualitySpec: '\u8d28\u68c0\u89c4\u8303',
  materialName: '\u7269\u6599\u540d\u79f0',
  materialCode: '\u7269\u6599\u7f16\u7801',
  ingredientRole: '\u7ec4\u5206\u89d2\u8272',
  dosageMode: '\u8ba1\u91cf\u6a21\u5f0f',
  percentage: '\u767e\u5206\u6bd4 %',
  quantityPerUnit: '\u5355\u8017',
  unit: '\u5355\u4f4d',
  lossRate: '\u635f\u8017\u7387 %',
  processStage: '\u5de5\u827a\u9636\u6bb5',
  substituteGroup: '\u66ff\u4ee3\u7ec4',
  yieldContribution: '\u6536\u7387\u8d21\u732e%',
  note: '\u5907\u6ce8',
  ensureTenRows: '\u8865\u9f5010\u884c',
  materialNamePlaceholder: '\u7269\u6599\u540d\u79f0',
  materialCodePlaceholder: '\u4ee3\u53f7/\u7f16\u7801',
  percentagePlaceholder: '\u767e\u5206\u6bd4',
  quantityPerUnitPlaceholder: '\u5355\u8017',
  unitPlaceholder: '\u5355\u4f4d',
  lossRatePlaceholder: '\u635f\u8017',
  variancePlaceholder: '\u504f\u5dee',
  createBom: '\u521b\u5efa BOM',
  selected: '\u9009\u4e2d',
  workOrderDetail: '\u5de5\u5355\u8be6\u60c5',
  targetQuantity: '\u76ee\u6807\u6570\u91cf',
  producedQuantity: '\u5df2\u4ea7\u6570\u91cf',
  lossQuantity: '\u635f\u8017\u6570\u91cf',
  plannedStart: '\u8ba1\u5212\u5f00\u59cb',
  plannedEnd: '\u8ba1\u5212\u7ed3\u675f',
  workOrderNote: '\u5de5\u5355\u5907\u6ce8',
  createWorkOrder: '\u521b\u5efa\u5de5\u5355',
  fromBom: '\u4ece BOM \u6216\u6279\u6b21\u5e26\u5165',
  startOrder: '\u5f00\u5de5',
  startStep: '\u5f00\u59cb',
  completeStep: '\u5b8c\u6210',
  sendQc: '\u9001\u68c0',
  saveQc: '\u4fdd\u5b58\u8d28\u68c0',
  completeOrder: '\u5b8c\u5de5',
  completeConfirm: '\u786e\u8ba4\u6263\u51cf\u5e76\u5b8c\u5de5',
  completionModal: '\u5de5\u5355\u5b8c\u5de5\u8017\u6599\u786e\u8ba4',
  defectRate: '\u7f3a\u9677\u7387 %',
  qcPerson: '\u8d28\u68c0\u4eba',
  qcNote: '\u8d28\u68c0\u5907\u6ce8',
  batchTrace: '\u6279\u6b21\u8ffd\u8e2a',
};

const STEP_TIMEOUT_MS = {
  login: 20000,
  route: 20000,
  fill: 45000,
  save: 30000,
  readBack: 20000,
  qc: 20000,
};

const TEST_DATA = {
  bomName: `T9-CHEM-BOM-${RUN_ID}`,
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
  processSummary: '\u5e38\u6e29\u9884\u6df7 -> \u5347\u6e29\u5206\u6563 -> \u8fc7\u6ee4\u51fa\u6599',
  qualitySummary: '\u56fa\u542b 55% +/-2%, \u7c98\u5ea6 6000-9000cps, \u5916\u89c2\u5747\u5300\u65e0\u7ed3\u5757',
  items: [
    { materialName: '\u73af\u6c27\u6811\u8102-\u4e3b\u6599', materialCode: 'RESIN-MAIN', ingredientRole: 'main_resin', dosageMode: 'percentage', percentage: '45', quantityPerUnit: '450', unit: 'kg', lossRate: '1.2', allowedVarianceRate: '3', processStage: '\u9884\u6df7', substituteGroup: '', yieldContribution: '98', notes: '\u4e3b\u6811\u8102' },
    { materialName: '\u56fa\u5316\u5242-\u8f85\u6599', materialCode: 'CURING-AGENT', ingredientRole: 'curing_agent', dosageMode: 'percentage', percentage: '15', quantityPerUnit: '150', unit: 'kg', lossRate: '0.3', allowedVarianceRate: '2', processStage: '\u4e3b\u6df7', substituteGroup: '', yieldContribution: '', notes: '\u56fa\u5316\u5242' },
    { materialName: '\u6eb6\u5242-\u7a00\u91ca', materialCode: 'SOLVENT-THIN', ingredientRole: 'solvent', dosageMode: 'percentage', percentage: '10', quantityPerUnit: '100', unit: 'kg', lossRate: '2', allowedVarianceRate: '5', processStage: '\u8c03\u914d', substituteGroup: 'solvent-group-a', yieldContribution: '', notes: '\u7a00\u91ca\u6eb6\u5242' },
    { materialName: '', materialCode: 'MOD-SECRET-01', ingredientRole: 'modifier_resin', dosageMode: 'percentage', percentage: '8', quantityPerUnit: '80', unit: 'kg', lossRate: '1', allowedVarianceRate: '4', processStage: '\u9884\u6df7', substituteGroup: '', yieldContribution: '', notes: '\u4fdd\u5bc6\u4ee3\u53f7' },
    { materialName: '', materialCode: 'TACK-SECRET-02', ingredientRole: 'tackifier', dosageMode: 'percentage', percentage: '6', quantityPerUnit: '60', unit: 'kg', lossRate: '1', allowedVarianceRate: '4', processStage: '\u9884\u6df7', substituteGroup: '', yieldContribution: '', notes: '\u4fdd\u5bc6\u4ee3\u53f7' },
    { materialName: '', materialCode: 'FILLER-SECRET-03', ingredientRole: 'pigment', dosageMode: 'percentage', percentage: '5', quantityPerUnit: '50', unit: 'kg', lossRate: '1', allowedVarianceRate: '5', processStage: '\u5206\u6563', substituteGroup: '', yieldContribution: '', notes: '\u4fdd\u5bc6\u4ee3\u53f7' },
    { materialName: '', materialCode: 'SURF-SECRET-04', ingredientRole: 'surfactant', dosageMode: 'percentage', percentage: '4', quantityPerUnit: '40', unit: 'kg', lossRate: '0.5', allowedVarianceRate: '5', processStage: '\u5206\u6563', substituteGroup: '', yieldContribution: '', notes: '\u4fdd\u5bc6\u4ee3\u53f7' },
    { materialName: '', materialCode: 'DEFOAM-SECRET-05', ingredientRole: 'defoamer', dosageMode: 'percentage', percentage: '3', quantityPerUnit: '30', unit: 'kg', lossRate: '0.5', allowedVarianceRate: '5', processStage: '\u8c03\u6f06', substituteGroup: '', yieldContribution: '', notes: '\u4fdd\u5bc6\u4ee3\u53f7' },
    { materialName: '', materialCode: 'THICK-SECRET-06', ingredientRole: 'thickener', dosageMode: 'percentage', percentage: '2', quantityPerUnit: '20', unit: 'kg', lossRate: '0.5', allowedVarianceRate: '5', processStage: '\u8c03\u7c98', substituteGroup: '', yieldContribution: '', notes: '\u4fdd\u5bc6\u4ee3\u53f7' },
    { materialName: '', materialCode: 'ADD-SECRET-07', ingredientRole: 'additive', dosageMode: 'percentage', percentage: '2', quantityPerUnit: '20', unit: 'kg', lossRate: '0.5', allowedVarianceRate: '5', processStage: '\u540e\u6dfb\u52a0', substituteGroup: '', yieldContribution: '', notes: '\u4fdd\u5bc6\u4ee3\u53f7' },
  ],
  workOrder: {
    productName: `T9-CHEM-WO-${RUN_ID}`,
    targetQuantity: '10',
    producedQuantity: '10',
    lossQuantity: '0.2',
    plannedStartAt: '2026-04-16T09:00',
    plannedEndAt: '2026-04-16T18:00',
    note: `Work order for ${RUN_ID}`,
  },
  qc: { result: 'pass', defectRate: '0.8', checkedBy: `QC-${RUN_ID.slice(-4)}`, note: `QC note ${RUN_ID}` },
};

const report = {
  name: 'Production Browser Audit',
  version: '1.2-ascii-source',
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  testData: TEST_DATA,
  steps: [],
  status: 'running',
};

let authToken = '';
let browser = null;

function parsePayload(payload) {
  const data = payload?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return data || null;
}

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
  const loginResponse = await page.request.post(`${APP_URL}api/auth/login`, { data: { username: 'admin', password: 'admin123', role: 'super_admin' } });
  if (!loginResponse.ok()) throw new Error(`login api failed: ${loginResponse.status()}`);
  const loginJson = await loginResponse.json();
  authToken = loginJson?.data?.token;
  if (!authToken) throw new Error('login api returned empty token');
}

async function loginViaUi(page, recordStep) {
  await withTimebox(page, recordStep, 'open-login', STEP_TIMEOUT_MS.login, async () => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  }, SHOT_DIR);
  const username = page.locator('input[name="username"]');
  const password = page.locator('input[name="password"]');
  const submit = page.locator('button[type="submit"]');
  if (!(await username.count()) || !(await password.count()) || !(await submit.count())) {
    recordStep({ step: 'login-form-detection', result: 'skipped', reason: 'login form not found, using existing session' });
    return;
  }
  await withTimebox(page, recordStep, 'submit-login', STEP_TIMEOUT_MS.login, async () => {
    await username.fill('admin');
    await password.fill('admin123');
    await Promise.all([page.waitForTimeout(1200), submit.click()]);
  }, SHOT_DIR);
}

async function openProductionRoute(page, recordStep) {
  await withTimebox(page, recordStep, 'open-production-route', STEP_TIMEOUT_MS.route, async () => {
    await page.goto(`${APP_URL}#production`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS.route });
    await page.evaluate(() => {
      window.localStorage.setItem('ailao.activeTab', 'production');
      window.location.hash = '#production';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitForBodyText(page, [S.bomManagement, S.workOrderDesk, S.batchList], STEP_TIMEOUT_MS.route);
    assertNoMojibake(await page.locator('body').innerText(), 'production route', FORBIDDEN_MOJIBAKE);
  }, SHOT_DIR);
  recordStep({ step: 'production-route-evidence', result: 'passed', evidence: await safeScreenshot(page, SHOT_DIR, 'production-route') });
}

async function fillByLabel(page, label, value, index = 0) {
  await page.getByLabel(label, { exact: true }).nth(index).fill(value);
}
async function selectByLabel(page, label, value, index = 0) {
  await page.getByLabel(label).nth(index).selectOption(value);
}
async function fillBomItem(page, index, item) {
  const row = page.locator('table').first().locator('tbody tr').nth(index);
  await row.getByPlaceholder(new RegExp(S.materialNamePlaceholder)).fill(item.materialName);
  await row.getByPlaceholder(new RegExp(S.materialCodePlaceholder)).fill(item.materialCode);
  await row.locator('select').nth(0).selectOption(item.ingredientRole);
  await row.locator('select').nth(1).selectOption(item.dosageMode);
  await row.getByPlaceholder(new RegExp(`${S.percentagePlaceholder}|\u6bd4\u4f8b/\u5907\u7528`)).fill(item.percentage);
  await row.getByPlaceholder(S.quantityPerUnitPlaceholder).fill(item.quantityPerUnit);
  await row.getByPlaceholder(S.unitPlaceholder).fill(item.unit);
  await row.getByPlaceholder(S.lossRatePlaceholder).fill(item.lossRate);
  const varianceInput = row.getByPlaceholder(S.variancePlaceholder);
  if (await varianceInput.count()) await varianceInput.fill(item.allowedVarianceRate || '');
  await row.getByPlaceholder(S.processStage).fill(item.processStage);
  await row.getByPlaceholder(S.substituteGroup).fill(item.substituteGroup);
  await row.getByPlaceholder(S.yieldContribution).fill(item.yieldContribution);
  await row.getByPlaceholder(S.note).fill(item.notes);
}

async function createChemicalBom(page, recordStep) {
  await withTimebox(page, recordStep, 'fill-create-chemical-bom', STEP_TIMEOUT_MS.fill, async () => {
    await page.getByLabel(S.productName, { exact: true }).first().fill(TEST_DATA.bomName);
    await fillByLabel(page, S.version, TEST_DATA.bomVersion);
    await selectByLabel(page, S.bomType, TEST_DATA.bomType);
    await selectByLabel(page, S.formulaStatus, TEST_DATA.bomStatus);
    await selectByLabel(page, S.formulaMode, TEST_DATA.formulationMode);
    await fillByLabel(page, S.outputUnit, TEST_DATA.outputUnit);
    await fillByLabel(page, S.standardBatch, TEST_DATA.standardBatchSize);
    await fillByLabel(page, S.batchUnit, TEST_DATA.batchSizeUnit);
    await fillByLabel(page, S.density, TEST_DATA.density);
    await fillByLabel(page, S.solidContent, TEST_DATA.solidContent);
    await fillByLabel(page, S.processSummary, TEST_DATA.processSummary);
    await fillByLabel(page, S.effectiveFrom, TEST_DATA.effectiveFrom);
    await fillByLabel(page, S.effectiveTo, TEST_DATA.effectiveTo);
    await page.getByLabel(S.qualitySpec, { exact: true }).fill(TEST_DATA.qualitySummary);
    const ensureTenRowsButton = page.getByRole('button', { name: new RegExp(S.ensureTenRows) });
    if (await ensureTenRowsButton.count()) await ensureTenRowsButton.click();
    for (let index = 0; index < TEST_DATA.items.length; index += 1) {
      await fillBomItem(page, index, TEST_DATA.items[index]);
    }
    await page.getByRole('button', { name: new RegExp(S.createBom.replace(' ', '\\s*')) }).click();
  }, SHOT_DIR);
  await withTimebox(page, recordStep, 'verify-bom-ui-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const row = await waitForRowByText(page, TEST_DATA.bomName, STEP_TIMEOUT_MS.readBack);
    await row.click();
    await waitForBodyText(page, [TEST_DATA.bomName, S.formulaStatus, S.standardBatch, S.qualitySpec], STEP_TIMEOUT_MS.readBack);
    assertNoMojibake(await page.locator('body').innerText(), 'bom ui readback', FORBIDDEN_MOJIBAKE);
  }, SHOT_DIR);
  const created = await withTimebox(page, recordStep, 'verify-bom-api-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const res = await apiFetch(page, '/production/boms');
    if (!res.ok) throw new Error(`production boms api failed: ${res.status}`);
    const boms = parsePayload(res) || [];
    const bom = boms.find((item) => item.productName === TEST_DATA.bomName);
    if (!bom) throw new Error('created chemical BOM not found in API readback');
    if (bom.bomType !== TEST_DATA.bomType) throw new Error(`bomType mismatch: ${bom.bomType}`);
    if (bom.status !== TEST_DATA.bomStatus) throw new Error(`bom status mismatch: ${bom.status}`);
    if (bom.formulationMode !== TEST_DATA.formulationMode) throw new Error(`formulationMode mismatch: ${bom.formulationMode}`);
    if (Number(bom.standardBatchSize || 0) !== Number(TEST_DATA.standardBatchSize)) throw new Error(`standardBatchSize mismatch: ${bom.standardBatchSize}`);
    if (String(bom.qualitySpecJson || '').indexOf('\u56fa\u542b') === -1) throw new Error('qualitySpecJson missing quality summary');
    if (!Array.isArray(bom.items) || bom.items.length !== TEST_DATA.items.length) throw new Error('bom items count mismatch');
    if (!bom.items.some((item) => Number(item.allowedVarianceRate || 0) > 0)) throw new Error('allowedVarianceRate missing in BOM API readback');
    return bom;
  }, SHOT_DIR);
  recordStep({ step: 'chemical-bom-created-evidence', result: 'passed', evidence: await safeScreenshot(page, SHOT_DIR, 'chemical-bom-created'), bomId: created.id, bomNo: created.bomNo });
  return created;
}

async function createWorkOrder(page, recordStep, bom) {
  await withTimebox(page, recordStep, 'select-latest-bom-for-work-order', STEP_TIMEOUT_MS.readBack, async () => {
    const row = await waitForRowByText(page, bom.productName, STEP_TIMEOUT_MS.readBack);
    await row.getByRole('button', { name: S.selected }).click();
    await page.waitForTimeout(400);
  }, SHOT_DIR);
  await withTimebox(page, recordStep, 'fill-create-work-order', STEP_TIMEOUT_MS.fill, async () => {
    await page.getByPlaceholder(S.fromBom).fill(TEST_DATA.workOrder.productName);
    await fillByLabel(page, S.targetQuantity, TEST_DATA.workOrder.targetQuantity);
    await fillByLabel(page, S.producedQuantity, TEST_DATA.workOrder.producedQuantity);
    await fillByLabel(page, S.lossQuantity, TEST_DATA.workOrder.lossQuantity);
    await fillByLabel(page, S.plannedStart, TEST_DATA.workOrder.plannedStartAt);
    await fillByLabel(page, S.plannedEnd, TEST_DATA.workOrder.plannedEndAt);
    await page.getByLabel(S.workOrderNote, { exact: true }).fill(TEST_DATA.workOrder.note);
    await page.getByRole('button', { name: S.createWorkOrder }).click();
  }, SHOT_DIR);
  const created = await withTimebox(page, recordStep, 'verify-work-order-api-readback', STEP_TIMEOUT_MS.readBack, async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const res = await apiFetch(page, '/production/work-orders?pageSize=200');
      if (!res.ok) throw new Error(`production work orders api failed: ${res.status}`);
      const orders = parsePayload(res) || [];
      const order = orders.find((item) => String(item.note || '') === TEST_DATA.workOrder.note || String(item.productName || '') === TEST_DATA.workOrder.productName);
      if (order) {
        if (order.status !== 'planned') throw new Error(`work order initial status mismatch: ${order.status}`);
        if (!order.bom || Number(order.bom.id) !== Number(bom.id)) throw new Error('work order BOM association mismatch');
        return order;
      }
      await page.waitForTimeout(400);
    }
    throw new Error('created work order not found in API readback');
  }, SHOT_DIR);
  await withTimebox(page, recordStep, 'verify-work-order-ui-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const row = await waitForRowByText(page, created.workOrderNo, STEP_TIMEOUT_MS.readBack);
    await row.click();
    await waitForBodyText(page, [created.workOrderNo, TEST_DATA.workOrder.productName, S.workOrderDetail], STEP_TIMEOUT_MS.readBack);
    assertNoMojibake(await page.locator('body').innerText(), 'work order ui readback', FORBIDDEN_MOJIBAKE);
  }, SHOT_DIR);
  recordStep({ step: 'work-order-created-evidence', result: 'passed', evidence: await safeScreenshot(page, SHOT_DIR, 'work-order-created'), workOrderId: created.id, workOrderNo: created.workOrderNo });
  return created;
}

async function seedMaterialStock(page, recordStep) {
  await withTimebox(page, recordStep, 'seed-material-stock-for-completion', STEP_TIMEOUT_MS.save, async () => {
    const warehouseRes = await apiFetch(page, '/warehouses');
    if (!warehouseRes.ok) throw new Error(`warehouse api failed: ${warehouseRes.status}`);
    const warehouses = parsePayload(warehouseRes) || [];
    const allLocations = warehouses.flatMap((warehouse) => Array.isArray(warehouse.locations) ? warehouse.locations : []);
    const rawLocation = allLocations.find((location) => location.code === 'LOC-RAW') || allLocations[0];
    if (!rawLocation?.id) throw new Error('no warehouse location available for material stock seed');

    for (const [index, item] of TEST_DATA.items.entries()) {
      const requiredQty =
        Number(item.quantityPerUnit || 0)
        * Number(TEST_DATA.workOrder.targetQuantity || 0)
        * (1 + Number(item.lossRate || 0) / 100);
      const payload = {
        locationId: Number(rawLocation.id),
        productName: item.materialCode,
        batchNo: `QA-STOCK-${RUN_ID}-${String(index + 1).padStart(2, '0')}`,
        quantity: Math.ceil(requiredQty + 50),
        unit: item.unit || 'kg',
        note: `production browser audit stock ${RUN_ID}`,
      };
      const res = await apiFetch(page, '/warehouses/stock-balances', {
        method: 'POST',
        data: payload,
      });
      if (!res.ok) throw new Error(`stock seed failed for ${item.materialCode}: ${res.status}`);
    }
  }, SHOT_DIR);
}

async function waitForOrderStatus(page, workOrderNo, expectedStatus) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const res = await apiFetch(page, `/production/work-orders?keyword=${encodeURIComponent(workOrderNo)}`);
    if (!res.ok) throw new Error(`work order status api failed: ${res.status}`);
    const orders = parsePayload(res) || [];
    const order = orders.find((item) => item.workOrderNo === workOrderNo);
    if (order?.status === expectedStatus) return order;
    await page.waitForTimeout(400);
  }
  const res = await apiFetch(page, `/production/work-orders?keyword=${encodeURIComponent(workOrderNo)}`);
  const orders = parsePayload(res) || [];
  const order = orders.find((item) => item.workOrderNo === workOrderNo);
  throw new Error(`expected ${expectedStatus}, got ${order?.status}`);
}
async function waitForQualityCheck(page, workOrderNo, expectedNote) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const res = await apiFetch(page, `/production/work-orders?keyword=${encodeURIComponent(workOrderNo)}`);
    if (!res.ok) throw new Error(`quality check readback api failed: ${res.status}`);
    const orders = parsePayload(res) || [];
    const order = orders.find((item) => item.workOrderNo === workOrderNo);
    const check = Array.isArray(order?.qualityChecks)
      ? order.qualityChecks.find((item) => item.note === expectedNote)
      : null;
    if (check) return check;
    await page.waitForTimeout(400);
  }
  throw new Error('quality check not found in API readback');
}
async function clickWorkOrderButton(page, workOrderNo, buttonText) {
  const row = await waitForRowByText(page, workOrderNo, STEP_TIMEOUT_MS.readBack);
  await row.locator('button').filter({ hasText: buttonText }).first().click();
}
async function advanceWorkOrderAndVerify(page, recordStep, workOrderNo) {
  await withTimebox(page, recordStep, 'select-work-order-row-before-status-action', STEP_TIMEOUT_MS.save, async () => {
    const row = await waitForRowByText(page, workOrderNo, STEP_TIMEOUT_MS.readBack);
    await row.click();
    await page.waitForTimeout(200);
  }, SHOT_DIR);
  await withTimebox(page, recordStep, 'work-order-status-open', STEP_TIMEOUT_MS.save, async () => {
    await clickWorkOrderButton(page, workOrderNo, S.startOrder);
    await waitForOrderStatus(page, workOrderNo, 'in_progress');
  }, SHOT_DIR);
  await withTimebox(page, recordStep, 'first-step-start-complete', STEP_TIMEOUT_MS.save, async () => {
    const row = await waitForRowByText(page, workOrderNo, STEP_TIMEOUT_MS.readBack);
    await row.click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: S.startStep }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: S.completeStep }).first().click();
  }, SHOT_DIR);
  await withTimebox(page, recordStep, 'work-order-status-send-to-qc', STEP_TIMEOUT_MS.save, async () => {
    await clickWorkOrderButton(page, workOrderNo, S.sendQc);
    await waitForOrderStatus(page, workOrderNo, 'qc_pending');
  }, SHOT_DIR);
  recordStep({ step: 'work-order-qc-pending-evidence', result: 'passed', evidence: await safeScreenshot(page, SHOT_DIR, 'work-order-qc-pending'), workOrderNo });
}
async function createQualityCheck(page, recordStep, workOrderNo) {
  await withTimebox(page, recordStep, 'create-quality-check', STEP_TIMEOUT_MS.qc, async () => {
    const row = await waitForRowByText(page, workOrderNo, STEP_TIMEOUT_MS.readBack);
    await row.click();
    await page.getByPlaceholder(S.defectRate).fill(TEST_DATA.qc.defectRate);
    await page.getByPlaceholder(S.qcPerson).fill(TEST_DATA.qc.checkedBy);
    await page.getByPlaceholder(S.qcNote).fill(TEST_DATA.qc.note);
    await page.getByRole('button', { name: S.saveQc }).click();
  }, SHOT_DIR);
  await withTimebox(page, recordStep, 'verify-quality-check-api-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const check = await waitForQualityCheck(page, workOrderNo, TEST_DATA.qc.note);
    if (check.result !== TEST_DATA.qc.result) throw new Error(`qc result mismatch: ${check.result}`);
  }, SHOT_DIR);
  recordStep({ step: 'quality-check-evidence', result: 'passed', evidence: await safeScreenshot(page, SHOT_DIR, 'quality-check-saved'), workOrderNo });
}
async function completeWorkOrderAndVerifyBatch(page, recordStep, workOrderNo) {
  await withTimebox(page, recordStep, 'complete-work-order', STEP_TIMEOUT_MS.save, async () => {
    await clickWorkOrderButton(page, workOrderNo, S.completeOrder);
    await waitForBodyText(page, [S.completionModal, S.completeConfirm], STEP_TIMEOUT_MS.readBack);
    assertNoMojibake(await page.locator('body').innerText(), 'complete work order modal', FORBIDDEN_MOJIBAKE);
    await page.getByRole('button', { name: new RegExp(S.completeConfirm) }).click();
  }, SHOT_DIR);
  const workOrder = await withTimebox(page, recordStep, 'verify-completed-work-order', STEP_TIMEOUT_MS.readBack, async () => {
    const order = await waitForOrderStatus(page, workOrderNo, 'completed');
    if (!order.productBatch || !order.productBatch.batchNo) throw new Error('completed work order missing product batch');
    if (String(order.productBatch.productName || '') !== TEST_DATA.workOrder.productName) {
      throw new Error(`completed batch product mismatch: ${order.productBatch.productName}`);
    }
    return order;
  }, SHOT_DIR);
  const batchNo = workOrder.productBatch.batchNo;
  await withTimebox(page, recordStep, 'verify-batch-ui-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const row = await waitForRowByText(page, batchNo, STEP_TIMEOUT_MS.readBack);
    await row.click();
    await waitForBodyText(page, [batchNo, workOrder.productBatch.productName, S.batchTrace], STEP_TIMEOUT_MS.readBack);
    assertNoMojibake(await page.locator('body').innerText(), 'batch ui readback', FORBIDDEN_MOJIBAKE);
  }, SHOT_DIR);
  await withTimebox(page, recordStep, 'verify-batch-api-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const res = await apiFetch(page, `/assets/batches?keyword=${encodeURIComponent(batchNo)}`);
    if (!res.ok) throw new Error(`batch api failed: ${res.status}`);
    const batches = parsePayload(res) || [];
    const batch = batches.find((item) => item.batchNo === batchNo);
    if (!batch) throw new Error('completed batch not found in API readback');
    if (String(batch.productName || '') !== String(workOrder.productBatch.productName || '')) throw new Error(`batch productName mismatch: ${batch.productName}`);
    report.completedBatch = { id: batch.id, batchNo: batch.batchNo, stockQuantity: Number(batch.stockQuantity || 0), status: batch.status };
  }, SHOT_DIR);
  recordStep({ step: 'batch-readback-evidence', result: 'passed', evidence: await safeScreenshot(page, SHOT_DIR, 'batch-readback'), batchNo, workOrderNo });
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
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await seedAuthToken(page);
    await loginViaUi(page, recordStep);
    stallGuard.assertAlive('after-login');
    await openProductionRoute(page, recordStep);
    stallGuard.assertAlive('after-route-open');
    const bom = await createChemicalBom(page, recordStep);
    stallGuard.assertAlive('after-bom');
    const workOrder = await createWorkOrder(page, recordStep, bom);
    stallGuard.assertAlive('after-work-order');
    await seedMaterialStock(page, recordStep);
    stallGuard.assertAlive('after-material-stock-seed');
    await advanceWorkOrderAndVerify(page, recordStep, workOrder.workOrderNo);
    stallGuard.assertAlive('after-work-order-advance');
    await createQualityCheck(page, recordStep, workOrder.workOrderNo);
    stallGuard.assertAlive('after-qc');
    await completeWorkOrderAndVerifyBatch(page, recordStep, workOrder.workOrderNo);
    stallGuard.assertAlive('after-batch');
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
  if (report.status === 'passed') console.log(`Production browser audit passed. Report: ${REPORT_PATH}`);
  else if (report.status === 'blocked_env') console.warn(`Production browser audit blocked by environment. Report: ${REPORT_PATH}`);
  else if (report.status === 'stuck') console.error(`Production browser audit stuck. Report: ${REPORT_PATH}`);
  else console.error(report.error || 'production browser audit failed');
}

main();
