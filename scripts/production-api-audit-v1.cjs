const fs = require('fs');
const path = require('path');
const { createChemicalBomAuditContext } = require('./lib/chemical-bom-audit-utils.cjs');

const REPORT_DIR = path.join(__dirname, '../output/playwright');
const REPORT_PATH = path.join(REPORT_DIR, 'production-api-audit-report-v1.json');

const APP_URL = process.env.APP_URL || 'http://localhost:5001';
const chemicalAudit = createChemicalBomAuditContext({
  appUrl: APP_URL,
  reportDir: REPORT_DIR,
  reportPath: path.join(REPORT_DIR, 'production-api-chemical-helper-report-v1.json'),
});

const report = {
  name: "Production Mainline API Audit",
  version: "1.0",
  startTime: new Date().toISOString(),
  status: "running",
  steps: []
};

// Ensure output dir
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function recordStep(name, status, details = {}) {
  const step = { name, status, time: new Date().toISOString(), ...details };
  report.steps.push(step);
  console.log(`[Step] ${name} (${status}):`, JSON.stringify(details));
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  return step;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiFetch(endpoint, options = {}) {
  const url = `${APP_URL}${endpoint}`;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      let data;
      const isJson = res.headers.get('content-type')?.includes('application/json');
      if (isJson) {
        data = await res.json();
      } else {
        data = await res.text();
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
      }
      return data;
    } catch (err) {
      lastError = err;
      const code = err?.cause?.code || err?.code || '';
      const isRetryable = code === 'ECONNRESET' || code === 'ECONNREFUSED';
      if (!isRetryable || attempt === 3) {
        throw err;
      }
      await sleep(800 * attempt);
    }
  }

  throw lastError;
}

async function expectHttpFailure(endpoint, expectedStatus, options = {}) {
  const url = `${APP_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();

  if (res.status !== expectedStatus) {
    throw new Error(`Expected HTTP ${expectedStatus} but got ${res.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function login(username, password) {
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  return res.data.token;
}

async function main() {
  ensureDir(REPORT_DIR);
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  try {
    // 1. Get identity
    const adminToken = await login('admin', 'admin123');
    const getSummary = await apiFetch('/api/production/summary', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    recordStep('get_identity_and_summary', 'passed', {
      bomCount: getSummary.data.bomCount,
      workOrderCount: getSummary.data.workOrderCount,
    });

    // 1.5 Ensure invalid percentage formula is rejected by backend guardrails
    const invalidBomPayload = {
      productName: `API-CHEM-BOM-INVALID-${Date.now()}`,
      version: "1.0",
      bomType: "chemical_formula",
      formulationMode: "percentage",
      outputUnit: "kg",
      items: [
        {
          materialName: "无效树脂-API",
          dosageMode: "percentage",
          percentage: 60,
          quantityPerUnit: 600,
          unit: "kg",
        },
        {
          materialName: "无效固化剂-API",
          dosageMode: "percentage",
          percentage: 20,
          quantityPerUnit: 200,
          unit: "kg",
        }
      ]
    };
    const invalidBomRes = await expectHttpFailure('/api/production/boms', 400, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify(invalidBomPayload)
    });
    recordStep('reject_invalid_percentage_formula', 'passed', {
      message: invalidBomRes.message || null,
    });

    // 2. Create chemical BOM
    const productName = `API-CHEM-BOM-${Date.now()}`;
    const bomPayload = {
      productName,
      version: "1.0",
      bomType: "chemical_formula",
      status: "active",
      formulationMode: "percentage",
      outputUnit: "kg",
      standardBatchSize: 1000,
      batchSizeUnit: "kg",
      density: 1.12,
      solidContent: 55,
      effectiveFrom: "2026-04-16",
      effectiveTo: "2026-12-31",
      processJson: JSON.stringify({
        summary: "常温预混 -> 升温分散 -> 过滤出料",
        stages: ["预混", "分散", "过滤"]
      }),
      qualitySpecJson: JSON.stringify({
        summary: "固含 55%±2%，粘度 6000-9000cps，外观均匀无结块",
      }),
      notes: "化工配方 API 验收",
      items: [
        {
          materialName: "环氧树脂-API",
          materialCode: "RESIN-API",
          ingredientRole: "main_resin",
          dosageMode: "percentage",
          percentage: 70,
          quantityPerUnit: 700,
          unit: "kg",
          lossRate: 1.2,
          processStage: "预混",
          yieldContribution: 98
        },
        {
          materialName: "固化剂-API",
          materialCode: "CURING-API",
          ingredientRole: "curing_agent",
          dosageMode: "percentage",
          percentage: 20,
          quantityPerUnit: 200,
          unit: "kg",
          lossRate: 0.3,
          processStage: "主混"
        },
        {
          materialName: "溶剂-API",
          materialCode: "SOLVENT-API",
          ingredientRole: "solvent",
          dosageMode: "percentage",
          percentage: 10,
          quantityPerUnit: 100,
          unit: "kg",
          lossRate: 2,
          processStage: "调整",
          substituteGroup: "solvent-group-a"
        }
      ]
    };
    const createBOMRes = await apiFetch('/api/production/boms', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify(bomPayload)
    });
    recordStep('create_bom', 'passed', {
      bomId: createBOMRes.data.id,
      bomType: createBOMRes.data.bomType,
      formulationMode: createBOMRes.data.formulationMode,
    });
    const bomId = createBOMRes.data.id;

    // 3. Read BOM back and assert chemical fields persisted
    const listBomsRes = await apiFetch('/api/production/boms', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const createdBom = (listBomsRes.data || []).find(item => item.id === bomId || item.productName === productName);
    if (!createdBom) {
      throw new Error(`Created BOM not found in list read-back: ${bomId}`);
    }
    if (createdBom.bomType !== 'chemical_formula') {
      throw new Error(`BOM type read-back mismatch: ${createdBom.bomType}`);
    }
    if (createdBom.formulationMode !== 'percentage') {
      throw new Error(`Formulation mode read-back mismatch: ${createdBom.formulationMode}`);
    }
    if (createdBom.status !== 'active') {
      throw new Error(`BOM status read-back mismatch: ${createdBom.status}`);
    }
    if (Number(createdBom.standardBatchSize || 0) !== 1000) {
      throw new Error(`Standard batch size read-back mismatch: ${createdBom.standardBatchSize}`);
    }
    if (createdBom.effectiveFrom !== '2026-04-16T00:00:00.000Z') {
      throw new Error(`Effective from read-back mismatch: ${createdBom.effectiveFrom}`);
    }
    if (createdBom.effectiveTo !== '2026-12-31T00:00:00.000Z') {
      throw new Error(`Effective to read-back mismatch: ${createdBom.effectiveTo}`);
    }
    if (!createdBom.qualitySpecJson || !createdBom.qualitySpecJson.includes('粘度')) {
      throw new Error('Quality spec read-back mismatch');
    }
    if (!Array.isArray(createdBom.items) || createdBom.items.length !== 3) {
      throw new Error(`BOM items read-back mismatch: ${createdBom.items?.length}`);
    }
    const solventLine = createdBom.items.find(item => item.materialCode === 'SOLVENT-API');
    if (!solventLine || solventLine.processStage !== '调整') {
      throw new Error('Chemical line detail read-back mismatch for solvent line');
    }
    recordStep('read_back_chemical_bom', 'passed', {
      bomId,
      formulaStatus: createdBom.status,
      items: createdBom.items.length,
      standardBatchSize: createdBom.standardBatchSize,
    });

    const warehouseBootstrap = await chemicalAudit.ensureWarehouseAndLocations(adminToken);
    const rawLocation = warehouseBootstrap.locations['LOC-RAW'];
    const seededBalances = [];
    for (const item of createdBom.items) {
      const materialCode = item.materialCode || item.materialName;
      const balance = await chemicalAudit.ensureRawStock(adminToken, rawLocation.id, materialCode, 50, 12);
      seededBalances.push(balance);
    }
    recordStep('seed_raw_consumption_stock', 'passed', {
      materialCount: seededBalances.length,
      rawLocationId: rawLocation.id,
    });

    // 4. Create Work Order to prove compatibility with existing quantity-based costing/work-order chain
    const woPayload = {
      bomId,
      productName: bomPayload.productName,
      targetQuantity: 10,
      producedQuantity: 10,
      lossQuantity: 0.2,
      steps: [
        { stepNo: 1, title: "混合" },
        { stepNo: 2, title: "灌装" }
      ]
    };
    const createWORes = await apiFetch('/api/production/work-orders', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify(woPayload)
    });
    recordStep('create_work_order', 'passed', { workOrderId: createWORes.data.id });
    const workOrderId = createWORes.data.id;
    const stepId = createWORes.data.steps[0].id;

    // 5. Progress step
    const stepPayload = { status: "completed", operatorName: "API-Worker" };
    await apiFetch(`/api/production/work-orders/${workOrderId}/steps/${stepId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify(stepPayload)
    });
    recordStep('progress_step', 'passed');

    // 6. Quality check
    const qcPayload = { result: "pass", note: "API 自动化免检通过" };
    await apiFetch(`/api/production/work-orders/${workOrderId}/checks`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify(qcPayload)
    });
    recordStep('create_quality_check', 'passed');

    // 7. Complete Work Order
    const completeWOPayload = {
      status: "completed",
      consumptionRecords: seededBalances.map(balance => ({
        stockBalanceId: balance.id,
        quantity: 1,
      })),
    };
    await apiFetch(`/api/production/work-orders/${workOrderId}/status`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify(completeWOPayload)
    });
    recordStep('complete_work_order', 'passed');

    // 8. Read work order back to prove compatibility remains intact
    const workOrdersRes = await apiFetch('/api/production/work-orders?keyword=' + encodeURIComponent(productName), {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const createdWorkOrder = (workOrdersRes.data || []).find(item => item.id === workOrderId);
    if (!createdWorkOrder) {
      throw new Error(`Created work order not found in read-back: ${workOrderId}`);
    }
    if (createdWorkOrder.status !== 'completed') {
      throw new Error(`Work order status read-back mismatch: ${createdWorkOrder.status}`);
    }
    if (!createdWorkOrder.bom || createdWorkOrder.bom.id !== bomId) {
      throw new Error('Work order BOM association was not preserved');
    }
    if (!createdWorkOrder.productBatch || !createdWorkOrder.productBatch.batchNo) {
      throw new Error('Completed work order did not create or bind a product batch');
    }
    const batchId = createdWorkOrder.productBatch.id;
    const batchNo = createdWorkOrder.productBatch.batchNo;
    recordStep('read_back_work_order', 'passed', {
      workOrderId,
      workOrderStatus: createdWorkOrder.status,
      bomId: createdWorkOrder.bom?.id,
      batchNo,
    });

    // 9. Read batch before production adjustment
    const beforeBatchList = await apiFetch('/api/assets/batches?keyword=' + encodeURIComponent(batchNo), {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const beforeBatch = (beforeBatchList.data || []).find(item => item.id === batchId || item.batchNo === batchNo);
    if (!beforeBatch) {
      throw new Error(`Generated batch not found in assets read-back: ${batchNo}`);
    }
    recordStep('read_back_batch_before_adjustment', 'passed', {
      batchId,
      batchNo,
      stockQuantity: beforeBatch.stockQuantity,
    });

    // 10. Create production adjustment against generated batch
    const adjustmentPayload = {
      domain: 'production',
      targetType: 'productBatch',
      batchId,
      targetRef: batchNo,
      quantityDelta: -1,
      reason: 'API 生产损耗调账',
      reasonCategory: 'production_loss',
      lossType: 'scrap',
      note: '化工生产 API 闭环验收',
      status: 'posted',
    };
    const createAdjustmentRes = await apiFetch('/api/adjustments', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify(adjustmentPayload)
    });
    const adjustmentId = createAdjustmentRes.data?.adjustment?.id;
    const adjustedStock = createAdjustmentRes.data?.effects?.production?.stockQuantity;
    if (!adjustmentId) {
      throw new Error('Production adjustment did not return an adjustment id');
    }
    recordStep('create_production_adjustment', 'passed', {
      adjustmentId,
      adjustedStock,
    });

    // 11. Read adjustment detail and batch after adjustment
    const adjustmentDetail = await apiFetch(`/api/adjustments/${adjustmentId}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (adjustmentDetail.data.status !== 'posted') {
      throw new Error(`Production adjustment status mismatch: ${adjustmentDetail.data.status}`);
    }

    const afterBatchList = await apiFetch('/api/assets/batches?keyword=' + encodeURIComponent(batchNo), {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const afterBatch = (afterBatchList.data || []).find(item => item.id === batchId || item.batchNo === batchNo);
    if (!afterBatch) {
      throw new Error(`Adjusted batch not found in assets read-back: ${batchNo}`);
    }
    const expectedAdjustedStock = Number(beforeBatch.stockQuantity) - 1;
    if (Math.abs(Number(afterBatch.stockQuantity) - expectedAdjustedStock) > 0.0001) {
      throw new Error(`Batch stock mismatch after adjustment: expected ${expectedAdjustedStock}, got ${afterBatch.stockQuantity}`);
    }
    recordStep('read_back_adjusted_batch', 'passed', {
      adjustmentId,
      batchId,
      stockQuantity: afterBatch.stockQuantity,
    });

    // 12. Reverse adjustment and verify recovery
    await apiFetch(`/api/adjustments/${adjustmentId}/reverse`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ note: 'API 调账回滚验收' })
    });
    const reversedBatchList = await apiFetch('/api/assets/batches?keyword=' + encodeURIComponent(batchNo), {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const reversedBatch = (reversedBatchList.data || []).find(item => item.id === batchId || item.batchNo === batchNo);
    if (!reversedBatch) {
      throw new Error(`Reversed batch not found in assets read-back: ${batchNo}`);
    }
    if (Math.abs(Number(reversedBatch.stockQuantity) - Number(beforeBatch.stockQuantity)) > 0.0001) {
      throw new Error(`Batch stock mismatch after reversal: expected ${beforeBatch.stockQuantity}, got ${reversedBatch.stockQuantity}`);
    }
    recordStep('reverse_adjustment_and_recover_batch', 'passed', {
      adjustmentId,
      batchId,
      stockQuantity: reversedBatch.stockQuantity,
    });

    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    console.error("Audit failed:", error);
    recordStep('audit_failed', 'failed', { error: error.message });
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    if (report.status === "passed") {
      console.log("Production API Audit successfully completed.");
    }
  }
}

main();
