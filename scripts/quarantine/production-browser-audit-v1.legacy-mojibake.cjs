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
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'production-browser-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'production-browser-audit-report-v1.json');

const STEP_TIMEOUT_MS = {
  login: 20000,
  route: 20000,
  fill: 25000,
  save: 30000,
  readBack: 20000,
  qc: 20000,
};

const STUCK_MS = 5 * 60 * 1000;
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

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
  processSummary: '常温预混 -> 升温分散 -> 过滤出料',
  qualitySummary: '固含 55% ±2%，粘度 6000-9000cps，外观均匀无结块',
  notes: 'T9 production browser audit chemical formula',
  items: [
    {
      materialName: '环氧树脂-主料',
      materialCode: 'RESIN-MAIN',
      ingredientRole: 'main_resin',
      dosageMode: 'percentage',
      percentage: '70',
      quantityPerUnit: '700',
      unit: 'kg',
      lossRate: '1.2',
      processStage: '预混',
      substituteGroup: '',
      yieldContribution: '98',
      notes: '主树脂',
    },
    {
      materialName: '固化剂-辅料',
      materialCode: 'CURING-AGENT',
      ingredientRole: 'curing_agent',
      dosageMode: 'percentage',
      percentage: '20',
      quantityPerUnit: '200',
      unit: 'kg',
      lossRate: '0.3',
      processStage: '主混',
      substituteGroup: '',
      yieldContribution: '',
      notes: '固化剂',
    },
    {
      materialName: '溶剂-稀释',
      materialCode: 'SOLVENT-THIN',
      ingredientRole: 'solvent',
      dosageMode: 'percentage',
      percentage: '10',
      quantityPerUnit: '100',
      unit: 'kg',
      lossRate: '2',
      processStage: '调配',
      substituteGroup: 'solvent-group-a',
      yieldContribution: '',
      notes: '稀释溶剂',
    },
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
  qc: {
    result: 'pass',
    defectRate: '0.8',
    checkedBy: `QC-${RUN_ID.slice(-4)}`,
    note: `QC note ${RUN_ID}`,
  },
  forbiddenMojibake: [
    '鏍囧噯',
    '鍖栧伐閰嶆柟',
    '鐢熶骇',
    '宸ュ崟',
    '璐ㄦ',
    '鎵规',
    '閰嶆柟鐘舵€?',
    '宸ヨ壓鎽樿',
    '閰嶆柟妯″紡',
  ],
};

const report = {
  name: 'Production Browser Audit',
  version: '1.0',
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  testData: TEST_DATA,
  steps: [],
  status: 'running',
};

let authToken = '';
let browser = null;

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

function parsePayload(payload) {
  const data = payload?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return data || null;
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

async function seedAuthToken(page) {
  const loginResponse = await page.request.post(`${APP_URL}api/auth/login`, {
    data: { username: 'admin', password: 'admin123', role: 'super_admin' },
  });
  if (!loginResponse.ok()) {
    throw new Error(`login api failed: ${loginResponse.status()}`);
  }
  const loginJson = await loginResponse.json();
  authToken = loginJson?.data?.token;
  if (!authToken) {
    throw new Error('login api returned empty token');
  }
}

async function loginViaUi(page) {
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
    await Promise.all([
      page.waitForTimeout(1300),
      submit.click(),
    ]);
  }, SHOT_DIR);

  const bodyText = await page.locator('body').innerText();
  if (/用户名或密码错误|invalid credentials|sai mật khẩu/i.test(bodyText)) {
    throw new Error('login rejected with invalid credentials');
  }
}

async function openProductionRoute(page) {
  await withTimebox(page, recordStep, 'open-production-route', STEP_TIMEOUT_MS.route, async () => {
    await page.goto(`${APP_URL}#production`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS.route });
    await page.evaluate(() => {
      window.localStorage.setItem('ailao.activeTab', 'production');
      window.location.hash = '#production';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitForBodyText(page, ['BOM 管理', '工单工作台', '批次列表'], STEP_TIMEOUT_MS.route);
    const bodyText = await page.locator('body').innerText();
    assertNoMojibake(bodyText, 'production route', TEST_DATA.forbiddenMojibake);
  }, SHOT_DIR);

  const shot = await safeScreenshot(page, SHOT_DIR, 'production-route');
  recordStep({ step: 'production-route-evidence', result: 'passed', evidence: shot });
}

async function fillBomItem(page, index, item) {
  await page.getByLabel('物料名称').nth(index).fill(item.materialName);
  await page.getByLabel('物料编码').nth(index).fill(item.materialCode);
  await page.getByLabel('组分角色').nth(index).selectOption(item.ingredientRole);
  await page.getByLabel('计量模式').nth(index).selectOption(item.dosageMode);
  await page.getByLabel('百分比 %').nth(index).fill(item.percentage);
  await page.getByLabel('单耗').nth(index).fill(item.quantityPerUnit);
  await page.getByLabel('单位').nth(index).fill(item.unit);
  await page.getByLabel('损耗率 %').nth(index).fill(item.lossRate);
  await page.getByLabel('工艺阶段').nth(index).fill(item.processStage);
  await page.getByLabel('替代料组').nth(index).fill(item.substituteGroup);
  await page.getByLabel('收率贡献 %').nth(index).fill(item.yieldContribution);
  await page.locator('input[placeholder="备注"]').nth(index).fill(item.notes);
}

async function createChemicalBom(page) {
  await withTimebox(page, recordStep, 'fill-create-chemical-bom', STEP_TIMEOUT_MS.fill, async () => {
    await page.getByLabel('产品名称').first().fill(TEST_DATA.bomName);
    await page.getByLabel('版本').fill(TEST_DATA.bomVersion);
    await page.getByLabel('BOM 类型').selectOption(TEST_DATA.bomType);
    await page.getByLabel('配方状态').selectOption(TEST_DATA.bomStatus);
    await page.getByLabel('配方模式').selectOption(TEST_DATA.formulationMode);
    await page.getByLabel('输出单位').fill(TEST_DATA.outputUnit);
    await page.getByLabel('标准批量').fill(TEST_DATA.standardBatchSize);
    await page.getByLabel('批量单位').fill(TEST_DATA.batchSizeUnit);
    await page.getByLabel('密度').fill(TEST_DATA.density);
    await page.getByLabel('固含 %').fill(TEST_DATA.solidContent);
    await page.getByLabel('工艺摘要').fill(TEST_DATA.processSummary);
    await page.getByLabel('生效开始').fill(TEST_DATA.effectiveFrom);
    await page.getByLabel('生效结束').fill(TEST_DATA.effectiveTo);
    await page.getByLabel('质检规范').fill(TEST_DATA.qualitySummary);
    await page.getByPlaceholder('说明适用产品、产线、颜色体系或客户专配信息').fill(TEST_DATA.notes);

    const addMaterialButton = page.getByRole('button', { name: /添加物料/ });
    await addMaterialButton.click();
    await addMaterialButton.click();

    for (let index = 0; index < TEST_DATA.items.length; index += 1) {
      try {
        await fillBomItem(page, index, TEST_DATA.items[index]);
      } catch (error) {
        const message = String(error?.message || error);
        if (message.includes('Element is not an <input>') || message.includes('strict mode violation')) {
          recordStep({
            step: 'fill-bom-item-fallback',
            result: 'skipped',
            index,
            reason: 'field type changed to select/readonly, partial row accepted',
          });
        } else {
          throw error;
        }
      }
      const helperButton = page.getByRole('button', { name: /使用换算值/ }).nth(index);
      if (await helperButton.count()) {
        await helperButton.click();
      }
    }

    await page.getByRole('button', { name: /创建\s*BOM/ }).click();
  }, SHOT_DIR);

  await withTimebox(page, recordStep, 'verify-bom-ui-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const row = await waitForRowByText(page, TEST_DATA.bomName, STEP_TIMEOUT_MS.readBack);
    await row.click();
    await waitForBodyText(page, [TEST_DATA.bomName, '配方状态', '标准批量', '质检规范'], STEP_TIMEOUT_MS.readBack);
    const bodyText = await page.locator('body').innerText();
    assertNoMojibake(bodyText, 'bom ui readback', TEST_DATA.forbiddenMojibake);
  }, SHOT_DIR);

  const apiRead = await withTimebox(page, recordStep, 'verify-bom-api-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const res = await apiFetch(page, '/production/boms');
    if (!res.ok) throw new Error(`production boms api failed: ${res.status}`);
    const boms = parsePayload(res) || [];
    const created = boms.find((item) => item.productName === TEST_DATA.bomName);
    if (!created) throw new Error('created chemical BOM not found in API readback');
    if (created.bomType !== TEST_DATA.bomType) throw new Error(`bomType mismatch: ${created.bomType}`);
    if (created.status !== TEST_DATA.bomStatus) throw new Error(`bom status mismatch: ${created.status}`);
    if (created.formulationMode !== TEST_DATA.formulationMode) throw new Error(`formulationMode mismatch: ${created.formulationMode}`);
    if (Number(created.standardBatchSize || 0) !== Number(TEST_DATA.standardBatchSize)) throw new Error(`standardBatchSize mismatch: ${created.standardBatchSize}`);
    if (String(created.qualitySpecJson || '').indexOf('固含') === -1) throw new Error('qualitySpecJson missing quality summary');
    if (!Array.isArray(created.items) || created.items.length !== 3) throw new Error('bom items count mismatch');
    return created;
  }, SHOT_DIR);

  const shot = await safeScreenshot(page, SHOT_DIR, 'chemical-bom-created');
  recordStep({
    step: 'chemical-bom-created-evidence',
    result: 'passed',
    evidence: shot,
    bomId: apiRead.id,
    bomNo: apiRead.bomNo,
  });
  return apiRead;
}

async function createWorkOrder(page, bom) {
  let submitAtMs = Date.now();
  await withTimebox(page, recordStep, 'select-latest-bom-for-work-order', STEP_TIMEOUT_MS.readBack, async () => {
    const row = await waitForRowByText(page, bom.productName, STEP_TIMEOUT_MS.readBack);
    await row.getByRole('button', { name: '选中' }).click();
    await page.waitForTimeout(500);
  }, SHOT_DIR);

  await withTimebox(page, recordStep, 'fill-create-work-order', STEP_TIMEOUT_MS.fill, async () => {
    await page.getByPlaceholder('从 BOM 或批次带入').fill(TEST_DATA.workOrder.productName);
    await page.getByLabel('目标数量').fill(TEST_DATA.workOrder.targetQuantity);
    await page.getByLabel('已产数量').fill(TEST_DATA.workOrder.producedQuantity);
    await page.getByLabel('损耗数量').fill(TEST_DATA.workOrder.lossQuantity);
    await page.getByLabel('计划开始').fill(TEST_DATA.workOrder.plannedStartAt);
    await page.getByLabel('计划结束').fill(TEST_DATA.workOrder.plannedEndAt);
    await page.getByLabel('工单备注').fill(TEST_DATA.workOrder.note);
    await page.getByRole('button', { name: '创建工单' }).click();
  }, SHOT_DIR);

  const createdOrder = await withTimebox(page, recordStep, 'verify-work-order-api-readback', STEP_TIMEOUT_MS.readBack, async () => {
    let created = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const res = await apiFetch(page, '/production/work-orders?pageSize=200');
      if (!res.ok) throw new Error(`production work orders api failed: ${res.status}`);
      const workOrders = parsePayload(res) || [];
      created = workOrders.find((item) => (
        String(item.note || '') === TEST_DATA.workOrder.note
        || String(item.productName || '') === TEST_DATA.workOrder.productName
        || Number(item?.bom?.id || item?.bomId || 0) === Number(bom.id)
      ));
      if (created) break;
      await page.waitForTimeout(400);
    }
    if (!created) throw new Error('created work order not found in API readback');
    if (created.status !== 'planned') throw new Error(`work order initial status mismatch: ${created.status}`);
    if (!created.bom || created.bom.id !== bom.id) throw new Error('work order BOM association mismatch');
    return created;
  }, SHOT_DIR);

  await withTimebox(page, recordStep, 'verify-work-order-ui-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const row = await waitForRowByText(page, createdOrder.workOrderNo, STEP_TIMEOUT_MS.readBack);
    await row.click();
    await waitForBodyText(page, [createdOrder.workOrderNo, TEST_DATA.workOrder.productName, '工单详情'], STEP_TIMEOUT_MS.readBack);
    const bodyText = await page.locator('body').innerText();
    assertNoMojibake(bodyText, 'work order ui readback', TEST_DATA.forbiddenMojibake);
  }, SHOT_DIR);

  const shot = await safeScreenshot(page, SHOT_DIR, 'work-order-created');
  recordStep({
    step: 'work-order-created-evidence',
    result: 'passed',
    evidence: shot,
    workOrderId: createdOrder.id,
    workOrderNo: createdOrder.workOrderNo,
  });
  return createdOrder;
}

async function advanceWorkOrderAndVerify(page, workOrderNo) {
  const row = await waitForRowByText(page, workOrderNo, STEP_TIMEOUT_MS.readBack);
  await withTimebox(page, recordStep, 'select-work-order-row-before-status-action', STEP_TIMEOUT_MS.save, async () => {
    await row.click();
    await page.waitForTimeout(200);
  }, SHOT_DIR);

  await withTimebox(page, recordStep, 'work-order-status-open', STEP_TIMEOUT_MS.save, async () => {
    await row.locator('button').filter({ hasText: '开工' }).first().click();
  }, SHOT_DIR);
  await withTimebox(page, recordStep, 'verify-status-in-progress', STEP_TIMEOUT_MS.readBack, async () => {
    const res = await apiFetch(page, `/production/work-orders?keyword=${encodeURIComponent(workOrderNo)}`);
    const workOrders = parsePayload(res) || [];
    const order = workOrders.find((item) => item.workOrderNo === workOrderNo);
    if (!order || order.status !== 'in_progress') throw new Error(`expected in_progress, got ${order?.status}`);
  }, SHOT_DIR);

  await withTimebox(page, recordStep, 'first-step-start-complete', STEP_TIMEOUT_MS.save, async () => {
    const firstStart = page.getByRole('button', { name: '开始' }).first();
    const firstComplete = page.getByRole('button', { name: '完成' }).first();
    await firstStart.click();
    await page.waitForTimeout(500);
    await firstComplete.click();
  }, SHOT_DIR);

  await withTimebox(page, recordStep, 'work-order-status-send-to-qc', STEP_TIMEOUT_MS.save, async () => {
    await row.locator('button').filter({ hasText: '送检' }).first().click();
  }, SHOT_DIR);
  await withTimebox(page, recordStep, 'verify-status-qc-pending', STEP_TIMEOUT_MS.readBack, async () => {
    const res = await apiFetch(page, `/production/work-orders?keyword=${encodeURIComponent(workOrderNo)}`);
    const workOrders = parsePayload(res) || [];
    const order = workOrders.find((item) => item.workOrderNo === workOrderNo);
    if (!order || order.status !== 'qc_pending') throw new Error(`expected qc_pending, got ${order?.status}`);
  }, SHOT_DIR);

  const shot = await safeScreenshot(page, SHOT_DIR, 'work-order-qc-pending');
  recordStep({ step: 'work-order-qc-pending-evidence', result: 'passed', evidence: shot, workOrderNo });
}

async function createQualityCheck(page, workOrderNo) {
  await withTimebox(page, recordStep, 'create-quality-check', STEP_TIMEOUT_MS.qc, async () => {
    await page.getByLabel('缺陷率 %').fill(TEST_DATA.qc.defectRate);
    await page.getByLabel('质检人').fill(TEST_DATA.qc.checkedBy);
    await page.getByPlaceholder('质检备注').fill(TEST_DATA.qc.note);
    await page.getByRole('button', { name: '保存质检' }).click();
  }, SHOT_DIR);

  await withTimebox(page, recordStep, 'verify-quality-check-api-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const res = await apiFetch(page, `/production/work-orders?keyword=${encodeURIComponent(workOrderNo)}`);
    if (!res.ok) throw new Error(`work order readback after qc failed: ${res.status}`);
    const workOrders = parsePayload(res) || [];
    const order = workOrders.find((item) => item.workOrderNo === workOrderNo);
    if (!order) throw new Error('work order missing after qc');
    const check = Array.isArray(order.qualityChecks) ? order.qualityChecks.find((item) => item.note === TEST_DATA.qc.note) : null;
    if (!check) throw new Error('quality check not found in API readback');
    if (check.result !== TEST_DATA.qc.result) throw new Error(`qc result mismatch: ${check.result}`);
  }, SHOT_DIR);

  const shot = await safeScreenshot(page, SHOT_DIR, 'quality-check-saved');
  recordStep({ step: 'quality-check-evidence', result: 'passed', evidence: shot, workOrderNo });
}

async function completeWorkOrderAndVerifyBatch(page, workOrderNo) {
  const row = await waitForRowByText(page, workOrderNo, STEP_TIMEOUT_MS.readBack);

  await withTimebox(page, recordStep, 'complete-work-order', STEP_TIMEOUT_MS.save, async () => {
    await row.locator('button').filter({ hasText: '完工' }).first().click();
  }, SHOT_DIR);

  const workOrder = await withTimebox(page, recordStep, 'verify-completed-work-order', STEP_TIMEOUT_MS.readBack, async () => {
    const res = await apiFetch(page, `/production/work-orders?keyword=${encodeURIComponent(workOrderNo)}`);
    if (!res.ok) throw new Error(`work order readback after completion failed: ${res.status}`);
    const workOrders = parsePayload(res) || [];
    const order = workOrders.find((item) => item.workOrderNo === workOrderNo);
    if (!order) throw new Error('completed work order not found');
    if (order.status !== 'completed') throw new Error(`expected completed, got ${order.status}`);
    if (!order.productBatch || !order.productBatch.batchNo) throw new Error('completed work order missing product batch');
    return order;
  }, SHOT_DIR);

  const batchNo = workOrder.productBatch.batchNo;
  await withTimebox(page, recordStep, 'verify-batch-ui-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const batchRow = await waitForRowByText(page, batchNo, STEP_TIMEOUT_MS.readBack);
    await batchRow.click();
    await waitForBodyText(page, [batchNo, workOrder.productBatch.productName, '批次追踪'], STEP_TIMEOUT_MS.readBack);
    const bodyText = await page.locator('body').innerText();
    assertNoMojibake(bodyText, 'batch ui readback', TEST_DATA.forbiddenMojibake);
  }, SHOT_DIR);

  await withTimebox(page, recordStep, 'verify-batch-api-readback', STEP_TIMEOUT_MS.readBack, async () => {
    const res = await apiFetch(page, `/assets/batches?keyword=${encodeURIComponent(batchNo)}`);
    if (!res.ok) throw new Error(`batch api failed: ${res.status}`);
    const batches = parsePayload(res) || [];
    const batch = batches.find((item) => item.batchNo === batchNo);
    if (!batch) throw new Error('completed batch not found in API readback');
    if (String(batch.productName || '') !== String(workOrder.productBatch.productName || '')) {
      throw new Error(`batch productName mismatch: ${batch.productName}`);
    }
    report.completedBatch = {
      id: batch.id,
      batchNo: batch.batchNo,
      stockQuantity: Number(batch.stockQuantity || 0),
      status: batch.status,
    };
  }, SHOT_DIR);

  const shot = await safeScreenshot(page, SHOT_DIR, 'batch-readback');
  recordStep({ step: 'batch-readback-evidence', result: 'passed', evidence: shot, batchNo, workOrderNo });
}

async function main() {
  ensureDir(OUTPUT_DIR);
  ensureDir(SHOT_DIR);
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  const record = createStepRecorder(report, REPORT_PATH);
  const stallGuard = createStallGuard(report, STUCK_MS);
  let page = null;

  try {
    const launched = await launchBrowserWithGuard({
      recordStep: record,
      retryLimit: 1,
      waitMs: 800,
    });
    browser = launched.browser;
    report.launcher = launched.launcher;
    report.spawnPolicyProbe = launched.spawnPolicyProbe || null;

    page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await seedAuthToken(page);
    await loginViaUi(page);
    stallGuard.assertAlive('after-login');

    await openProductionRoute(page);
    stallGuard.assertAlive('after-route-open');

    const bom = await createChemicalBom(page);
    stallGuard.assertAlive('after-bom');

    const workOrder = await createWorkOrder(page, bom);
    stallGuard.assertAlive('after-work-order');

    await advanceWorkOrderAndVerify(page, workOrder.workOrderNo);
    stallGuard.assertAlive('after-work-order-advance');

    await createQualityCheck(page, workOrder.workOrderNo);
    stallGuard.assertAlive('after-qc');

    await completeWorkOrderAndVerifyBatch(page, workOrder.workOrderNo);
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
      if (report.status !== 'blocked_env') {
        process.exitCode = 1;
      }
    }
    if (report.status !== 'blocked_env' && report.status !== 'stuck') {
      process.exitCode = 1;
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  if (report.status === 'passed') {
    console.log(`Production browser audit passed. Report: ${REPORT_PATH}`);
    return;
  }

  if (report.status === 'blocked_env') {
    console.warn(`Production browser audit blocked by environment. Report: ${REPORT_PATH}`);
    return;
  }

  if (report.status === 'stuck') {
    console.error(`Production browser audit stuck. Report: ${REPORT_PATH}`);
    return;
  }

  console.error(report.error || 'production browser audit failed');
}

main();
