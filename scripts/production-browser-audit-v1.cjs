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
const {
  buildBomPasteText,
  fillBomHeaderFields: fillBomHeaderFieldsWithData,
  loginViaUi: runLoginViaUi,
  openProductionRoute: runOpenProductionRoute,
  parsePayload,
  setControlByLabel,
  setControlByPlaceholder,
  switchProductionDesk: runSwitchProductionDesk,
  waitForAnyBodyText,
} = require('./lib/production-browser-audit-helpers.cjs');
const { createProductionBrowserAuditRuntime } = require('./lib/production-browser-audit-runtime.cjs');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.resolve(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'production-browser-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'production-browser-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const TEST_DATA = createProductionAuditData(RUN_ID);
const SETUP_ACCOUNT = {
  username: process.env.AUDIT_PRODUCTION_SETUP_USERNAME || 'production_browser_setup',
  password: process.env.AUDIT_PRODUCTION_SETUP_PASSWORD || 'AuditSmoke12345!',
  role: 'admin',
};
const INSPECTOR_ACCOUNT = {
  username: process.env.AUDIT_PRODUCTION_INSPECTOR_USERNAME || 'production_browser_inspector',
  password: process.env.AUDIT_PRODUCTION_INSPECTOR_PASSWORD || 'AuditSmoke12345!',
  role: 'warehouse',
};
const REVIEWER_ACCOUNT = {
  username: process.env.AUDIT_PRODUCTION_REVIEWER_USERNAME || 'production_browser_reviewer',
  password: process.env.AUDIT_PRODUCTION_REVIEWER_PASSWORD || 'AuditSmoke12345!',
  role: 'manager',
};

function prepareShotDirectory() {
  const resolvedOutput = path.resolve(OUTPUT_DIR);
  const resolvedShots = path.resolve(SHOT_DIR);
  if (path.dirname(resolvedShots) !== resolvedOutput) {
    throw new Error(`refusing to clean browser evidence outside ${resolvedOutput}`);
  }
  ensureDir(resolvedShots);
  const staleEntries = fs.readdirSync(resolvedShots, { withFileTypes: true });
  for (const entry of staleEntries) {
    const target = path.join(resolvedShots, entry.name);
    if (entry.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
    else fs.unlinkSync(target);
  }
  const remaining = fs.readdirSync(resolvedShots);
  if (remaining.length) throw new Error(`browser evidence cleanup incomplete: ${remaining.join(', ')}`);
  return staleEntries.length;
}

const fillBomHeaderFields = (page) => fillBomHeaderFieldsWithData(page, TEST_DATA);
const switchProductionDesk = (page, options) => runSwitchProductionDesk(
  page,
  options,
  waitForBodyText,
  STEP_TIMEOUT_MS.route,
);
const loginViaUi = (page, recordStep, account = INSPECTOR_ACCOUNT) => runLoginViaUi(page, {
  appUrl: APP_URL,
  recordStep,
  withTimebox,
  timeout: STEP_TIMEOUT_MS.route,
  shotDir: SHOT_DIR,
  account,
});

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
const {
  apiFetch,
  recordFinal,
  seedAuthToken,
  syncAuthTokenFromPage,
} = createProductionBrowserAuditRuntime({
  appUrl: APP_URL,
  auditAccount: SETUP_ACCOUNT,
  report,
  reportPath: REPORT_PATH,
});

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
      const expected = TEST_DATA.items[index];
      if (!(await row.count())) {
        throw new Error(`excel paste row missing at row ${index + 1}`);
      }
      const materialName = await row.getByTestId(`production-bom-row-${index}-material-name`).inputValue();
      const materialCode = await row.getByTestId(`production-bom-row-${index}-material-code`).inputValue();
      const ingredientRole = await row.getByTestId(`production-bom-row-${index}-ingredient-role`).inputValue();
      const dosageMode = await row.getByTestId(`production-bom-row-${index}-dosage-mode`).inputValue();
      const percentage = await row.getByTestId(`production-bom-row-${index}-percentage`).inputValue();
      const quantityPerUnit = expected.dosageMode === 'percentage'
        ? String(Number(percentage) / 100)
        : await row.getByTestId(`production-bom-row-${index}-quantity-per-unit`).inputValue();
      if (materialName !== expected.materialName) {
        throw new Error(`excel paste materialName mismatch at row ${index + 1}: ${materialName}`);
      }
      if (materialCode !== expected.materialCode) {
        throw new Error(`excel paste materialCode mismatch at row ${index + 1}: ${materialCode}`);
      }
      if (ingredientRole !== expected.ingredientRole) {
        throw new Error(`excel paste ingredientRole mismatch at row ${index + 1}: ${ingredientRole}`);
      }
      if (dosageMode !== expected.dosageMode) {
        throw new Error(`excel paste dosageMode mismatch at row ${index + 1}: ${dosageMode}`);
      }
      if (percentage !== expected.percentage) {
        throw new Error(`excel paste percentage mismatch at row ${index + 1}: ${percentage}`);
      }
      if (quantityPerUnit !== expected.quantityPerUnit) {
        throw new Error(`excel paste quantityPerUnit mismatch at row ${index + 1}: ${quantityPerUnit}`);
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

async function seedProductionMaterialMasters(page, recordStep) {
  await withTimebox(page, recordStep, 'seed-production-material-masters', STEP_TIMEOUT_MS.save, async () => {
    const fixtures = [
      TEST_DATA.finishedGood,
      ...TEST_DATA.items.map(item => ({
        code: item.materialCode,
        nameZh: item.materialName || item.materialCode,
        category: 'raw_material',
        baseUnit: item.unit || 'kg',
        shelfLifeDays: 730,
      })),
    ];
    for (const fixture of fixtures) {
      const existing = await apiFetch(page, `/materials?q=${encodeURIComponent(fixture.code)}&limit=10`);
      if (!existing.ok) throw new Error(`material search failed: ${existing.status}`);
      const current = parsePayload(existing) || [];
      const matched = current.find((item) => item.code === fixture.code);
      if (matched) {
        if (!matched.shelfLifeDays && fixture.shelfLifeDays) {
          const updated = await apiFetch(page, `/materials/${matched.id}`, {
            method: 'PATCH',
            data: { shelfLifeDays: fixture.shelfLifeDays },
          });
          if (!updated.ok) throw new Error(`material shelf-life update failed for ${fixture.code}: ${updated.status}`);
        }
        continue;
      }
      const created = await apiFetch(page, '/materials', {
        method: 'POST',
        data: { ...fixture, status: 'active', isTemporary: false, aliases: [] },
      });
      if (!created.ok) throw new Error(`material seed failed for ${fixture.code}: ${created.status}`);
    }
  }, SHOT_DIR);
}

async function fillQualityCharacteristics(page) {
  await page.getByTestId('production-quality-spec-add-template').click();
  for (const [index, item] of TEST_DATA.qualityCharacteristics.entries()) {
    await page.getByTestId(`production-quality-spec-code-${index}`).fill(item.code);
    await page.getByTestId(`production-quality-spec-name-${index}`).fill(item.name);
    await page.getByTestId(`production-quality-spec-type-${index}`).selectOption(item.valueType);
    await page.getByTestId(`production-quality-spec-unit-${index}`).fill(item.unit || '');
    if (item.valueType === 'numeric') {
      await page.getByTestId(`production-quality-spec-lower-${index}`).fill(item.lowerLimit || '');
      await page.getByTestId(`production-quality-spec-upper-${index}`).fill(item.upperLimit || '');
    } else {
      await page.getByTestId(`production-quality-spec-target-${index}`).fill(item.targetText || '');
    }
    await page.getByTestId(`production-quality-spec-method-${index}`).fill(item.testMethod || '');
  }
}

async function linkImportedBomRowsToMaterialMaster(page) {
  for (const [index, expected] of TEST_DATA.items.entries()) {
    const row = page.getByTestId(`production-bom-line-row-${index}`);
    await row.getByTestId(`production-bom-row-${index}-material-code`).focus();
    const option = row.getByRole('option').filter({ hasText: expected.materialCode }).first();
    await option.waitFor({ state: 'visible', timeout: 10000 });
    await option.click();
  }
}

async function createChemicalBom(page, recordStep) {
  await withTimebox(page, recordStep, 'fill-create-chemical-bom', STEP_TIMEOUT_MS.fill, async () => {
    await fillBomHeaderFields(page);
    await fillQualityCharacteristics(page);
    await importBomLinesViaExcelPaste(page, recordStep);
    await linkImportedBomRowsToMaterialMaster(page);
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
    if (!Array.isArray(bom.qualityCharacteristics) || bom.qualityCharacteristics.length !== TEST_DATA.qualityCharacteristics.length) {
      throw new Error(`quality characteristics count mismatch: ${bom.qualityCharacteristics?.length}`);
    }
    TEST_DATA.qualityCharacteristics.forEach((expected) => {
      const actual = bom.qualityCharacteristics.find((item) => item.code === expected.code);
      if (!actual) throw new Error(`quality characteristic missing: ${expected.code}`);
      if (actual.valueType !== expected.valueType) throw new Error(`quality characteristic type mismatch: ${expected.code}`);
    });
    if (!Array.isArray(bom.items) || bom.items.length !== TEST_DATA.items.length) throw new Error('bom items count mismatch');
    TEST_DATA.items.forEach((expectedItem, index) => {
      const actualItem = bom.items[index];
      if (!actualItem) throw new Error(`bom item missing at row ${index + 1}`);
      if ((actualItem.materialCode || '') !== expectedItem.materialCode) {
        throw new Error(`bom materialCode mismatch at row ${index + 1}: ${actualItem.materialCode}`);
      }
      if ((actualItem.dosageMode || '') !== expectedItem.dosageMode) {
        throw new Error(`bom dosageMode mismatch at row ${index + 1}: ${actualItem.dosageMode}`);
      }
      if (Number(actualItem.percentage || 0) !== Number(expectedItem.percentage || 0)) {
        throw new Error(`bom percentage mismatch at row ${index + 1}: ${actualItem.percentage}`);
      }
      if (Number(actualItem.quantityPerUnit || 0) !== Number(expectedItem.quantityPerUnit || 0)) {
        throw new Error(`bom quantityPerUnit mismatch at row ${index + 1}: ${actualItem.quantityPerUnit}`);
      }
      if ((actualItem.processStage || '') !== (expectedItem.processStage || '')) {
        throw new Error(`bom processStage mismatch at row ${index + 1}: ${actualItem.processStage}`);
      }
    });
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
    await switchProductionDesk(page, {
      testId: 'production-desk-work-orders',
      fallbackName: /工单\s*\/\s*质检/,
      expectedText: S.workOrderDesk,
    });
    await page.waitForTimeout(400);
  }, SHOT_DIR);
  await withTimebox(page, recordStep, 'fill-create-work-order', STEP_TIMEOUT_MS.fill, async () => {
    await setControlByPlaceholder(page, S.fromBom, TEST_DATA.workOrder.productName);
    await setControlByLabel(page, S.targetQuantity, TEST_DATA.workOrder.targetQuantity);
    await setControlByLabel(page, S.producedQuantity, TEST_DATA.workOrder.producedQuantity);
    await setControlByLabel(page, S.lossQuantity, TEST_DATA.workOrder.lossQuantity);
    await setControlByLabel(page, S.plannedStart, TEST_DATA.workOrder.plannedStartAt);
    await setControlByLabel(page, S.plannedEnd, TEST_DATA.workOrder.plannedEndAt);
    await setControlByLabel(page, S.workOrderNote, TEST_DATA.workOrder.note);
    const createButtons = page.locator('button').filter({ hasText: S.createWorkOrder });
    if (!(await createButtons.count())) {
      throw new Error('create work order button not found');
    }
    const createButton = createButtons.first();
    await createButton.scrollIntoViewIfNeeded({ timeout: 5000 });
    await createButton.click({ force: true, timeout: 5000 });
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
      const materialRes = await apiFetch(page, `/materials?q=${encodeURIComponent(item.materialCode)}&limit=10`);
      if (!materialRes.ok) throw new Error(`material lookup failed for stock seed ${item.materialCode}: ${materialRes.status}`);
      const material = (parsePayload(materialRes) || []).find(candidate => candidate.code === item.materialCode);
      if (!material?.id) throw new Error(`material master missing for stock seed ${item.materialCode}`);
      const requiredQty =
        Number(item.quantityPerUnit || 0)
        * Number(TEST_DATA.workOrder.targetQuantity || 0)
        * (1 + Number(item.lossRate || 0) / 100);
      const payload = {
        locationId: Number(rawLocation.id),
        materialId: Number(material.id),
        productName: material.nameZh || item.materialCode,
        batchNo: `QA-STOCK-${RUN_ID}-${String(index + 1).padStart(2, '0')}`,
        quantity: Math.ceil(requiredQty + 50),
        unit: item.unit || 'kg',
        sourceRef: `PROD-STOCK-SEED-${RUN_ID}-${String(index + 1).padStart(2, '0')}`,
        reason: 'production_material_seed',
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
async function waitForQualityCheck(page, workOrderNo, expectedNote, expectedStatus) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const res = await apiFetch(page, `/production/work-orders?keyword=${encodeURIComponent(workOrderNo)}`);
    if (!res.ok) throw new Error(`quality check readback api failed: ${res.status}`);
    const orders = parsePayload(res) || [];
    const order = orders.find((item) => item.workOrderNo === workOrderNo);
    const check = Array.isArray(order?.qualityChecks)
      ? order.qualityChecks.find((item) => item.note === expectedNote)
      : null;
    if (check && (!expectedStatus || check.status === expectedStatus)) return check;
    await page.waitForTimeout(400);
  }
  throw new Error('quality check not found in API readback');
}

async function waitForAdjustmentByNote(page, { batchId, note, status, timeout = STEP_TIMEOUT_MS.readBack }) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const res = await apiFetch(page, `/adjustments?pageSize=100&domain=production&batchId=${encodeURIComponent(String(batchId))}`);
    if (!res.ok) throw new Error(`adjustment api failed: ${res.status}`);
    const adjustments = parsePayload(res) || [];
    const record = adjustments.find((item) => String(item.note || '').includes(note) && (!status || item.status === status));
    if (record) return record;
    await page.waitForTimeout(400);
  }
  throw new Error(`adjustment not found in API readback: ${note}`);
}

async function waitForAdjustmentStatus(page, { id, status, timeout = STEP_TIMEOUT_MS.readBack }) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const res = await apiFetch(page, `/adjustments/${encodeURIComponent(String(id))}`);
    if (!res.ok) throw new Error(`adjustment detail api failed: ${res.status}`);
    const record = res.json?.data;
    if (record?.status === status) return record;
    await page.waitForTimeout(400);
  }
  throw new Error(`adjustment ${id} did not reach status ${status}`);
}

async function createAndReverseProductionAdjustment(page, recordStep, completedBatch) {
  if (!completedBatch?.id) throw new Error('completed batch missing id for production adjustment reversal audit');
  const adjustmentNote = `browser-adjustment-${RUN_ID}`;
  const reversalNote = `browser-reversal-${RUN_ID}`;
  let createdAdjustment = null;
  let reversedOriginal = null;
  let reverseAdjustment = null;

  await withTimebox(page, recordStep, 'create-production-adjustment-via-ui', STEP_TIMEOUT_MS.save, async () => {
    await switchProductionDesk(page, {
      testId: 'production-desk-batches',
      fallbackName: /批次\s*\/\s*调整/,
      expectedText: S.batchList,
    });
    await page.getByTestId('production-batch-status-filter').selectOption('all');
    await page.getByTestId('production-batch-search-input').fill(completedBatch.batchNo);
    const row = await waitForRowByText(page, completedBatch.batchNo, STEP_TIMEOUT_MS.readBack);
    await row.click();
    await page.getByTestId('production-adjustment-quantity-input').fill('1');
    await page.getByTestId('production-adjustment-note-input').fill(adjustmentNote);
    await page.getByTestId('production-adjustment-save').click();
    createdAdjustment = await waitForAdjustmentByNote(page, {
      batchId: completedBatch.id,
      note: adjustmentNote,
      status: 'posted',
      timeout: STEP_TIMEOUT_MS.readBack,
    });
    if (Number(createdAdjustment.quantityDelta || 0) !== 1) {
      throw new Error(`created production adjustment quantity mismatch: ${createdAdjustment.quantityDelta}`);
    }
    await waitForBodyText(page, [createdAdjustment.adjustmentNo], STEP_TIMEOUT_MS.readBack);
    assertNoMojibake(await page.locator('body').innerText(), 'production adjustment create ui', FORBIDDEN_MOJIBAKE);
  }, SHOT_DIR);

  await withTimebox(page, recordStep, 'reverse-production-adjustment-via-ui', STEP_TIMEOUT_MS.save, async () => {
    const adjustmentRow = page.getByTestId(`production-adjustment-row-${createdAdjustment.id}`);
    await adjustmentRow.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS.readBack });
    await adjustmentRow.getByTestId('production-adjustment-reverse-button').click();
    await page.getByTestId('production-adjustment-reverse-dialog').waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS.readBack });
    await page.getByTestId('production-adjustment-reverse-dialog-input').fill(reversalNote);
    await page.getByTestId('production-adjustment-reverse-dialog-confirm').click();
    await page.getByTestId('production-adjustment-reverse-dialog').waitFor({ state: 'detached', timeout: STEP_TIMEOUT_MS.readBack });
    reversedOriginal = await waitForAdjustmentStatus(page, {
      id: createdAdjustment.id,
      status: 'reversed',
      timeout: STEP_TIMEOUT_MS.readBack,
    });
    reverseAdjustment = await waitForAdjustmentByNote(page, {
      batchId: completedBatch.id,
      note: reversalNote,
      status: 'posted',
      timeout: STEP_TIMEOUT_MS.readBack,
    });
    if (Number(reverseAdjustment.quantityDelta || 0) !== -1) {
      throw new Error(`reverse production adjustment quantity mismatch: ${reverseAdjustment.quantityDelta}`);
    }
    assertNoMojibake(await page.locator('body').innerText(), 'production adjustment reverse ui', FORBIDDEN_MOJIBAKE);
  }, SHOT_DIR);

  report.productionAdjustmentReversal = {
    originalId: createdAdjustment.id,
    originalNo: createdAdjustment.adjustmentNo,
    originalStatus: reversedOriginal.status,
    reverseId: reverseAdjustment.id,
    reverseNo: reverseAdjustment.adjustmentNo,
    reverseQuantityDelta: Number(reverseAdjustment.quantityDelta || 0),
  };
  recordStep({
    step: 'production-adjustment-reversal-evidence',
    result: 'passed',
    evidence: await safeScreenshot(page, SHOT_DIR, 'production-adjustment-reversal'),
    originalNo: createdAdjustment.adjustmentNo,
    reverseNo: reverseAdjustment.adjustmentNo,
  });
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
    const order = await waitForOrderStatus(page, workOrderNo, 'qc_pending');
    const characteristics = order?.bom?.qualityCharacteristics || [];
    if (characteristics.length !== TEST_DATA.qualityCharacteristics.length) {
      throw new Error(`work order quality characteristics mismatch: ${characteristics.length}`);
    }
    await page.getByTestId('production-quality-sample-no').fill(TEST_DATA.qc.sampleNo);
    for (const expected of TEST_DATA.qualityCharacteristics) {
      const characteristic = characteristics.find((item) => item.code === expected.code);
      if (!characteristic) throw new Error(`work order quality characteristic missing: ${expected.code}`);
      await page.getByTestId(`production-quality-value-${characteristic.id}`).fill(expected.actual);
      if (expected.instrumentNo) {
        await page.getByTestId(`production-quality-instrument-${characteristic.id}`).fill(expected.instrumentNo);
      }
    }
    await page.getByTestId('production-quality-note').fill(TEST_DATA.qc.note);
    await page.getByTestId('production-qc-save').click();
  }, SHOT_DIR);
  await withTimebox(page, recordStep, 'verify-quality-check-api-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const check = await waitForQualityCheck(page, workOrderNo, TEST_DATA.qc.note, 'submitted');
    if (check.result !== TEST_DATA.qc.result) throw new Error(`qc result mismatch: ${check.result}`);
    if (check.status !== 'submitted') throw new Error(`qc status mismatch: ${check.status}`);
    if (check.checkedBy !== INSPECTOR_ACCOUNT.username) throw new Error(`qc inspector identity mismatch: ${check.checkedBy}`);
    if (!Array.isArray(check.measurements) || check.measurements.length !== TEST_DATA.qualityCharacteristics.length) {
      throw new Error(`qc measurements count mismatch: ${check.measurements?.length}`);
    }
  }, SHOT_DIR);
  recordStep({ step: 'quality-check-evidence', result: 'passed', evidence: await safeScreenshot(page, SHOT_DIR, 'quality-check-saved'), workOrderNo });
}

async function switchAuditAccount(page, recordStep, account) {
  await ensureUiAuditUser(account);
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS.route });
  await loginViaUi(page, recordStep, account);
  await syncAuthTokenFromPage(page);
  await runOpenProductionRoute(page, recordStep, { appUrl: APP_URL, assertNoMojibake, forbiddenMojibake: FORBIDDEN_MOJIBAKE, routeCopy: [S.productionTitle], routeTimeout: STEP_TIMEOUT_MS.route, safeScreenshot, shotDir: SHOT_DIR, withTimebox });
}

async function reviewQualityCheck(page, recordStep, workOrderNo) {
  await withTimebox(page, recordStep, 'switch-to-independent-reviewer', STEP_TIMEOUT_MS.route, async () => {
    await switchAuditAccount(page, recordStep, REVIEWER_ACCOUNT);
    await switchProductionDesk(page, {
      testId: 'production-desk-work-orders',
      fallbackName: /\u5de5\u5355\s*\/\s*\u8d28\u68c0/,
      expectedText: S.workOrderDesk,
    });
  }, SHOT_DIR);
  await withTimebox(page, recordStep, 'release-quality-check-via-ui', STEP_TIMEOUT_MS.qc, async () => {
    const row = await waitForRowByText(page, workOrderNo, STEP_TIMEOUT_MS.readBack);
    await row.click();
    await page.getByTestId('production-quality-review-note').fill(TEST_DATA.qc.reviewNote);
    await page.getByTestId('production-qc-release').click();
  }, SHOT_DIR);
  await withTimebox(page, recordStep, 'verify-independent-release-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const check = await waitForQualityCheck(page, workOrderNo, TEST_DATA.qc.note, 'released');
    if (check.status !== 'released' || check.disposition !== 'released') throw new Error(`qc release mismatch: ${check.status}/${check.disposition}`);
    if (check.reviewedBy !== REVIEWER_ACCOUNT.username) throw new Error(`qc reviewer identity mismatch: ${check.reviewedBy}`);
    if (Number(check.inspectorUserId) === Number(check.reviewedByUserId)) throw new Error('qc separation-of-duties identity mismatch');
  }, SHOT_DIR);
  recordStep({ step: 'independent-quality-release-evidence', result: 'passed', evidence: await safeScreenshot(page, SHOT_DIR, 'quality-release-saved'), workOrderNo });
}

async function verifyIncompleteCompletionIsBlocked(page, recordStep) {
  await withTimebox(page, recordStep, 'verify-incomplete-consumption-blocked-in-browser', STEP_TIMEOUT_MS.save, async () => {
    const modal = page.getByTestId('production-complete-modal');
    // The modal intentionally renders separate desktop-table and mobile-card
    // controls. Only one set is visible at a time, but both remain in the DOM.
    // Restrict the human-flow audit to the controls the operator can actually
    // interact with; otherwise Playwright waits on the hidden responsive copy.
    const numberInputs = modal.locator('input[type="number"]:visible');
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
    const inputLocators = await numberInputs.all();
    const originalValues = [];
    for (const input of inputLocators) {
      originalValues.push(await input.inputValue());
    }
    for (let index = 0; index < inputLocators.length; index += 1) {
      await inputLocators[index].fill(index === 0 ? (originalValues[index] || '1') : '0');
    }
    await modal.getByTestId('production-complete-confirm').click();
    const blocked = await waitForAnyBodyText(page, [
      'has no confirmed consumption record',
      'consumption is below expected',
      '\u5b8c\u5de5\u6821\u9a8c\u672a\u901a\u8fc7',
      '\u0042\u004f\u004d \u539f\u6599',
    ], STEP_TIMEOUT_MS.readBack);
    await waitForBodyText(page, [S.completionModal, S.completeConfirm], STEP_TIMEOUT_MS.readBack);
    for (let index = 0; index < inputLocators.length; index += 1) {
      await inputLocators[index].fill(originalValues[index] || '0');
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

async function verifyCompletionModalResponsive(page, recordStep) {
  const desktopViewport = page.viewportSize() || { width: 1600, height: 1200 };
  await withTimebox(page, recordStep, 'verify-completion-modal-mobile-hierarchy', STEP_TIMEOUT_MS.readBack, async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const modal = page.getByTestId('production-complete-modal');
    await modal.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS.readBack });

    const mobilePicks = modal.locator('[data-testid="production-complete-mobile-picks"]:visible');
    if (await mobilePicks.count() < 1) throw new Error('mobile completion cards are not visible at 390px');
    if (await modal.locator('table:visible').count() > 0) throw new Error('desktop completion table remained visible at 390px');

    const overflow = await page.evaluate(() => {
      const dialog = document.querySelector('[data-testid="production-complete-modal"]');
      return {
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        dialogOverflow: dialog ? dialog.scrollWidth - dialog.clientWidth : -1,
      };
    });
    if (overflow.documentOverflow > 1 || overflow.dialogOverflow > 1) {
      throw new Error(`mobile completion overflow: document=${overflow.documentOverflow}, dialog=${overflow.dialogOverflow}`);
    }

    const confirm = modal.getByTestId('production-complete-confirm');
    await confirm.scrollIntoViewIfNeeded();
    await confirm.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS.readBack });
    const hitTarget = await confirm.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(centerX, centerY);
      return {
        buttonRect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        centerInsideViewport: centerX >= 0 && centerX <= window.innerWidth && centerY >= 0 && centerY <= window.innerHeight,
        buttonReceivesClick: Boolean(hit && (hit === button || button.contains(hit))),
        hitTag: hit?.tagName || null,
        hitTestId: hit?.getAttribute('data-testid') || null,
      };
    });
    if (!hitTarget.centerInsideViewport || !hitTarget.buttonReceivesClick) {
      throw new Error(`mobile completion confirm is obscured: ${JSON.stringify(hitTarget)}`);
    }
    const toastCloseButtons = page.getByTestId('global-toast').getByRole('button', { name: '关闭通知' });
    while (await toastCloseButtons.count()) {
      await toastCloseButtons.first().click();
    }
    report.completionMobileLayout = {
      viewport: '390x844',
      documentOverflowPx: overflow.documentOverflow,
      dialogOverflowPx: overflow.dialogOverflow,
      mobileCardGroups: await mobilePicks.count(),
      confirmHitTarget: hitTarget,
    };
    recordStep({
      step: 'completion-modal-mobile-evidence',
      result: 'passed',
      evidence: await safeScreenshot(page, SHOT_DIR, 'completion-modal-mobile'),
      ...report.completionMobileLayout,
    });
  }, SHOT_DIR);
  await page.setViewportSize(desktopViewport);
  await page.getByTestId('production-complete-modal').waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS.readBack });
}

async function completeWorkOrderAndVerifyBatch(page, recordStep, workOrderNo) {
  await withTimebox(page, recordStep, 'complete-work-order', STEP_TIMEOUT_MS.save, async () => {
    const row = await waitForRowByText(page, workOrderNo, STEP_TIMEOUT_MS.readBack);
    await row.click();
    await page.getByTestId('production-quality-enter-completion').click();
    await waitForBodyText(page, [S.completionModal, S.completeConfirm], STEP_TIMEOUT_MS.readBack);
    assertNoMojibake(await page.locator('body').innerText(), 'complete work order modal', FORBIDDEN_MOJIBAKE);
    await verifyCompletionModalResponsive(page, recordStep);
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
  let completedBatch = null;
  await withTimebox(page, recordStep, 'verify-batch-ui-readback', STEP_TIMEOUT_MS.readBack, async () => {
    await switchProductionDesk(page, {
      testId: 'production-desk-batches',
      fallbackName: /批次\s*\/\s*调整/,
      expectedText: S.batchList,
    });
    await page.getByTestId('production-batch-status-filter').selectOption('all');
    await page.getByTestId('production-batch-search-input').fill(batchNo);
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
    completedBatch = batch;
    report.completedBatch = { id: batch.id, batchNo: batch.batchNo, stockQuantity: Number(batch.stockQuantity || 0), status: batch.status };
  }, SHOT_DIR);
  recordStep({ step: 'batch-readback-evidence', result: 'passed', evidence: await safeScreenshot(page, SHOT_DIR, 'batch-readback'), batchNo, workOrderNo });
  return { workOrder, batchNo, batch: completedBatch };
}

async function main() {
  ensureDir(OUTPUT_DIR);
  report.evidenceCleanup = { removedStaleEntries: prepareShotDirectory(), remainingBeforeRun: 0 };
  recordFinal();
  const recordStep = createStepRecorder(report, REPORT_PATH);
  const stallGuard = createStallGuard(report, STUCK_MS);
  let browser = null;
  try {
    const launched = await launchBrowserWithGuard({ recordStep, retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    report.launcher = launched.launcher;
    report.spawnPolicyProbe = launched.spawnPolicyProbe || null;
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await seedAuthToken(page);
    await loginViaUi(page, recordStep, SETUP_ACCOUNT);
    await syncAuthTokenFromPage(page);
    await seedProductionMaterialMasters(page, recordStep);
    await switchAuditAccount(page, recordStep, INSPECTOR_ACCOUNT);
    stallGuard.assertAlive('after-inspector-login');
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
    await reviewQualityCheck(page, recordStep, workOrder.workOrderNo);
    stallGuard.assertAlive('after-quality-release');
    const completed = await completeWorkOrderAndVerifyBatch(page, recordStep, workOrder.workOrderNo);
    stallGuard.assertAlive('after-batch');
    await createAndReverseProductionAdjustment(page, recordStep, completed.batch);
    stallGuard.assertAlive('after-production-adjustment-reversal');
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
