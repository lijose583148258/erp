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
const {
  FORBIDDEN_MOJIBAKE,
  S,
  STEP_TIMEOUT_MS,
  STUCK_MS,
  createProductionAuditData,
} = require('./lib/production-browser-audit-fixtures.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.resolve(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'production-browser-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'production-browser-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const TEST_DATA = createProductionAuditData(RUN_ID);

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

function buildBomPasteText(items) {
  return items.map((item) => [
    item.materialName,
    item.materialCode,
    item.ingredientRole,
    item.dosageMode,
    item.percentage,
    item.quantityPerUnit,
    item.unit,
    item.lossRate,
    item.allowedVarianceRate,
    item.processStage,
    item.substituteGroup,
    item.yieldContribution,
    item.notes,
  ].join('\t')).join('\n');
}

function parsePayload(payload) {
  const data = payload?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return data || null;
}

async function waitForAnyBodyText(page, expectedTexts, timeout) {
  const started = Date.now();
  const items = Array.isArray(expectedTexts) ? expectedTexts : [expectedTexts];
  while (Date.now() - started < timeout) {
    const bodyText = await page.locator('body').innerText();
    const matched = items.find((item) => bodyText.includes(item));
    if (matched) return { bodyText, matched };
    await page.waitForTimeout(300);
  }
  throw new Error(`expected any text not visible within ${timeout}ms: ${items.join(' | ')}`);
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
async function importBomLinesViaExcelPaste(page, recordStep) {
  await withTimebox(page, recordStep, 'import-bom-lines-via-excel-paste', STEP_TIMEOUT_MS.fill, async () => {
    const openPasteByTestId = page.getByTestId('production-bom-open-paste-panel');
    if (await openPasteByTestId.count()) {
      await openPasteByTestId.click();
    } else {
      await page.getByRole('button', { name: new RegExp(S.excelPaste.replace(' ', '\\s*')) }).click();
    }

    const pasteText = buildBomPasteText(TEST_DATA.items);
    const pasteBoxByTestId = page.getByTestId('production-bom-paste-textarea');
    if (await pasteBoxByTestId.count()) {
      await pasteBoxByTestId.fill(pasteText);
    } else {
      await page.locator('textarea').filter({ hasText: '' }).last().fill(pasteText);
    }

    const applyPasteByTestId = page.getByTestId('production-bom-apply-paste');
    if (await applyPasteByTestId.count()) {
      await applyPasteByTestId.click();
    } else {
      await page.getByRole('button', { name: new RegExp(S.smartImport) }).click();
    }

    await page.waitForTimeout(500);
    for (let index = 0; index < TEST_DATA.items.length; index += 1) {
      const row = page.getByTestId(`production-bom-line-row-${index}`);
      const targetRow = (await row.count()) ? row : page.locator('table').first().locator('tbody tr').nth(index);
      const inputValues = await targetRow.locator('input').evaluateAll((inputs) => inputs.map((input) => input.value));
      const selectValues = await targetRow.locator('select').evaluateAll((selects) => selects.map((select) => select.value));
      const expected = TEST_DATA.items[index];
      if (inputValues[0] !== expected.materialName) {
        throw new Error(`excel paste materialName mismatch at row ${index + 1}: ${inputValues[0]}`);
      }
      if (inputValues[1] !== expected.materialCode) {
        throw new Error(`excel paste materialCode mismatch at row ${index + 1}: ${inputValues[1]}`);
      }
      if (selectValues[0] !== expected.ingredientRole) {
        throw new Error(`excel paste ingredientRole mismatch at row ${index + 1}: ${selectValues[0]}`);
      }
      if (selectValues[1] !== expected.dosageMode) {
        throw new Error(`excel paste dosageMode mismatch at row ${index + 1}: ${selectValues[1]}`);
      }
      if (inputValues[6] !== expected.percentage) {
        throw new Error(`excel paste percentage mismatch at row ${index + 1}: ${inputValues[6]}`);
      }
      if (inputValues[7] !== expected.quantityPerUnit) {
        throw new Error(`excel paste quantityPerUnit mismatch at row ${index + 1}: ${inputValues[7]}`);
      }
    }
  }, SHOT_DIR);
  recordStep({
    step: 'excel-paste-bom-lines-evidence',
    result: 'passed',
    importedLineCount: TEST_DATA.items.length,
    confidentialCodeOnlyRows: TEST_DATA.items.filter((item) => !item.materialName && item.materialCode).length,
    evidence: await safeScreenshot(page, SHOT_DIR, 'excel-paste-bom-lines'),
  });
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
    await importBomLinesViaExcelPaste(page, recordStep);
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

async function verifyIncompleteCompletionIsBlocked(page, recordStep) {
  await withTimebox(page, recordStep, 'verify-incomplete-consumption-blocked-in-browser', STEP_TIMEOUT_MS.save, async () => {
    const modal = page.getByTestId('production-complete-modal');
    const numberInputs = modal.locator('input[type="number"]');
    let inputCount = 0;
    const started = Date.now();
    while (Date.now() - started < STEP_TIMEOUT_MS.readBack) {
      inputCount = await numberInputs.count();
      if (inputCount >= TEST_DATA.items.length) break;
      await page.waitForTimeout(300);
    }
    if (inputCount < TEST_DATA.items.length) {
      throw new Error(`completion modal did not expose enough material deduction inputs: ${inputCount}`);
    }
    const originalValues = [];
    for (let index = 0; index < inputCount; index += 1) {
      originalValues.push(await numberInputs.nth(index).inputValue());
    }
    for (let index = 0; index < inputCount; index += 1) {
      await numberInputs.nth(index).fill(index === 0 ? (originalValues[index] || '1') : '0');
    }
    await modal.getByTestId('production-complete-confirm').click();
    const blocked = await waitForAnyBodyText(page, [
      'has no confirmed consumption record',
      'consumption is below expected',
      '\u5b8c\u5de5\u6821\u9a8c\u672a\u901a\u8fc7',
      '\u0042\u004f\u004d \u539f\u6599',
    ], STEP_TIMEOUT_MS.readBack);
    await waitForBodyText(page, [S.completionModal, S.completeConfirm], STEP_TIMEOUT_MS.readBack);
    for (let index = 0; index < inputCount; index += 1) {
      await numberInputs.nth(index).fill(originalValues[index] || '0');
    }
    report.incompleteCompletionBlocked = {
      matchedText: blocked.matched,
      inputCount,
    };
  }, SHOT_DIR);
  recordStep({
    step: 'incomplete-consumption-browser-block-evidence',
    result: 'passed',
    evidence: await safeScreenshot(page, SHOT_DIR, 'incomplete-consumption-blocked'),
  });
}

async function completeWorkOrderAndVerifyBatch(page, recordStep, workOrderNo) {
  await withTimebox(page, recordStep, 'complete-work-order', STEP_TIMEOUT_MS.save, async () => {
    await clickWorkOrderButton(page, workOrderNo, S.completeOrder);
    await waitForBodyText(page, [S.completionModal, S.completeConfirm], STEP_TIMEOUT_MS.readBack);
    assertNoMojibake(await page.locator('body').innerText(), 'complete work order modal', FORBIDDEN_MOJIBAKE);
    await verifyIncompleteCompletionIsBlocked(page, recordStep);
    const modal = page.getByTestId('production-complete-modal');
    await modal.getByTestId('production-complete-confirm').click();
    await modal.waitFor({ state: 'detached', timeout: STEP_TIMEOUT_MS.readBack });
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
