const path = require('path');
const { createChemicalBomAuditContext } = require('./lib/chemical-bom-audit-utils.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001';
const REPORT_DIR = path.join(__dirname, '../output/playwright');
const REPORT_PATH = path.join(REPORT_DIR, 'chemical-bom-production-chain-audit-report-v1.json');
const OVERALL_TIMEOUT_MS = 280_000;

const {
  report,
  ensureDir,
  writeReport,
  recordStep,
  fail,
  elapsedMs,
  requestJson,
  login,
  ensureWarehouseAndLocations,
  ensureRawStock,
  listStockBalances,
  listStockEntries,
  getPreviewConsumption,
  getBatchCostLedger,
  createBom,
  createWorkOrder,
  completeWorkOrder,
  findWorkOrder,
  getProductionSummary,
} = createChemicalBomAuditContext({
  appUrl: APP_URL,
  reportDir: REPORT_DIR,
  reportPath: REPORT_PATH,
});

const createChemicalBomPayload = (materialCodes) => ({
  productName: `CHEM-GLUE-BOM-${Date.now()}`,
  version: 'qa-chemical-v1',
  bomType: 'chemical_formula',
  status: 'active',
  formulationMode: 'percentage',
  outputUnit: 'kg',
  standardBatchSize: 100,
  batchSizeUnit: 'kg',
  density: 1.08,
  solidContent: 57,
  effectiveFrom: '2026-04-18',
  effectiveTo: '2026-12-31',
  processJson: JSON.stringify({
    summary: 'premix / disperse / filter / package',
    stages: ['premix', 'disperse', 'filter', 'package'],
  }),
  qualitySpecJson: JSON.stringify({
    summary: 'solids, viscosity, appearance, and batch traceability',
    controls: ['solids 57 +/- 2%', 'viscosity within spec', 'no visible sediment'],
  }),
  notes: 'chemical BOM audit sample, internal codes only',
  items: materialCodes.map((code, index) => ({
    materialName: `CODE-${String(index + 1).padStart(2, '0')}`,
    materialCode: code,
    ingredientRole: index === 0 ? 'main_resin' : index === 1 ? 'curing_agent' : index === 2 ? 'solvent' : 'additive',
    dosageMode: 'percentage',
    percentage: 10,
    quantityPerUnit: 0.1,
    unit: 'kg',
    lossRate: index < 3 ? 1 : 0,
    processStage: index < 3 ? 'critical-dosing' : 'auxiliary-dosing',
    notes: 'confidential internal code line',
  })),
});

const assertBomReadback = (bomItem, bomId) => {
  if (!bomItem) {
    fail('Created BOM was not found in API read-back', { bomId });
  }
  if (!Array.isArray(bomItem.items) || bomItem.items.length !== 10) {
    fail('BOM read-back did not contain 10 material lines', { bomItem });
  }
  if (!bomItem.items.every(item => String(item.materialCode || '').startsWith('CHEM-'))) {
    fail('BOM read-back did not preserve internal material codes', { bomItem });
  }
  if (!bomItem.items.every(item => /^CODE-\d{2}$/.test(String(item.materialName || '')))) {
    fail('BOM read-back leaked descriptive formula names', { bomItem });
  }
};

const assertPreviewConsumption = (preview) => {
  if (!Array.isArray(preview) || preview.length !== 10) {
    fail('Preview consumption did not return 10 chemical lines', { preview });
  }
  if (preview.some(row => Number(row.shortageQty || 0) !== 0)) {
    fail('Preview consumption reports shortage before completion', { preview });
  }
};

const assertCompletedWorkOrder = (workOrderReadback, workOrderId) => {
  if (!workOrderReadback) {
    fail('Completed work order was not found in read-back', { workOrderId });
  }
  if (workOrderReadback.status !== 'completed') {
    fail('Completed work order read-back status mismatch', { workOrderReadback });
  }
  if (!workOrderReadback.productBatch || !workOrderReadback.productBatch.id) {
    fail('Completed work order did not bind a product batch', { workOrderReadback });
  }
};

(async () => {
  const startedAt = Date.now();
  ensureDir(REPORT_DIR);
  writeReport();

  try {
    const adminToken = await login('admin', 'admin123');
    recordStep('login_admin', 'passed', { appUrl: APP_URL });

    const bootstrap = await ensureWarehouseAndLocations(adminToken);
    recordStep('bootstrap_warehouse_locations', 'passed', {
      warehouseCode: bootstrap.warehouse.code,
      locationCodes: Object.keys(bootstrap.locations),
    });

    const materialCodes = Array.from({ length: 10 }, (_, index) => `CHEM-${Date.now()}-${String(index + 1).padStart(2, '0')}`);
    const rawLocation = bootstrap.locations['LOC-RAW'];
    const fgLocation = bootstrap.locations['LOC-FG'];

    const seededBalances = [];
    for (let index = 0; index < materialCodes.length; index += 1) {
      const code = materialCodes[index];
      const balance = await ensureRawStock(adminToken, rawLocation.id, code, 50, 10 + index);
      seededBalances.push(balance);
    }
    recordStep('seed_raw_material_stock', 'passed', {
      materialCount: seededBalances.length,
      rawLocationId: rawLocation.id,
    });

    const bom = await createBom(adminToken, createChemicalBomPayload(materialCodes));
    recordStep('create_chemical_bom', 'passed', {
      bomId: bom.id,
      bomNo: bom.bomNo,
      productName: bom.productName,
      itemCount: Array.isArray(bom.items) ? bom.items.length : 0,
    });

    const bomReadback = await requestJson('GET', '/api/production/boms', {
      token: adminToken,
      expectedStatus: 200,
    });
    const bomItem = (Array.isArray(bomReadback.data?.data) ? bomReadback.data.data : []).find(item => item.id === bom.id);
    assertBomReadback(bomItem, bom.id);
    recordStep('read_back_bom_and_code_confidentiality', 'passed', {
      itemCount: bomItem.items.length,
      codeOnlyCount: bomItem.items.filter(item => String(item.materialCode || '').startsWith('CHEM-')).length,
    });

    const workOrder = await createWorkOrder(adminToken, {
      bomId: bom.id,
      productName: bom.productName,
      targetQuantity: 100,
      producedQuantity: 100,
      lossQuantity: 0,
      plannedStartAt: '2026-04-18T08:00:00.000Z',
      plannedEndAt: '2026-04-18T18:00:00.000Z',
      note: 'chemical BOM production audit',
      steps: [
        { stepNo: 1, title: 'premix' },
        { stepNo: 2, title: 'disperse' },
        { stepNo: 3, title: 'filter' },
        { stepNo: 4, title: 'package' },
      ],
    });
    recordStep('create_work_order', 'passed', {
      workOrderId: workOrder.id,
      workOrderNo: workOrder.workOrderNo,
      workOrderStatus: workOrder.status,
    });

    const preview = await getPreviewConsumption(adminToken, workOrder.id);
    assertPreviewConsumption(preview);
    const expectedConsumptionByCode = new Map(preview.map(row => [
      String(row.materialName || ''),
      Number(row.requiredQty || 0),
    ]));
    recordStep('preview_consumption', 'passed', {
      previewLineCount: preview.length,
      firstLine: preview[0],
    });

    let incompleteBlocked = false;
    let incompleteStatus = null;
    let incompleteIssues = [];
    try {
      const incompleteResponse = await completeWorkOrder(adminToken, workOrder.id, {
        status: 'completed',
        consumptionRecords: [
          {
            stockBalanceId: seededBalances[0].id,
            quantity: 1,
          },
        ],
      }, 409);
      incompleteBlocked = incompleteResponse?.status === 409;
      incompleteStatus = incompleteResponse?.data?.message || null;
      incompleteIssues = incompleteResponse?.data?.issues || [];
    } catch (error) {
      incompleteBlocked = true;
      incompleteStatus = error?.responseData?.message || error?.message || null;
      incompleteIssues = error?.responseData?.issues || error?.extra?.issues || [];
      if (!incompleteIssues.length && String(incompleteStatus || '').indexOf('missing_material') === -1) {
        recordStep('incomplete_completion_blocked', 'failed', {
          message: incompleteStatus,
          issues: incompleteIssues,
        });
        fail('Incomplete BOM completion was blocked for the wrong reason', { message: incompleteStatus, issues: incompleteIssues });
      }
    }
    if (!incompleteBlocked) {
      fail('Incomplete BOM completion was allowed', { workOrderId: workOrder.id });
    }
    recordStep('incomplete_completion_blocked', 'passed', {
      message: incompleteStatus,
      issueCount: incompleteIssues.length,
      issueTypes: incompleteIssues.map(issue => issue.type),
    });

    const fullConsumption = preview.map(row => {
      const pick = Array.isArray(row.pickList) ? row.pickList[0] : null;
      if (!pick?.stockBalanceId) {
        fail('Preview consumption did not provide a pick-list stock balance', { row });
      }
      const quantity = Number(pick.deductQty || row.requiredQty || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        fail('Preview consumption produced an invalid deduction quantity', { row, quantity });
      }
      return {
        stockBalanceId: pick.stockBalanceId,
        quantity,
      };
    });

    const completed = await completeWorkOrder(adminToken, workOrder.id, {
      status: 'completed',
      consumptionRecords: fullConsumption,
    });

    if (completed?.data?.status && completed.data.status !== 'completed') {
      fail('Work order completion did not return completed status', completed);
    }
    recordStep('complete_work_order', 'passed', {
      workOrderId: workOrder.id,
      returnedWorkOrderStatus: completed?.data?.status || 'completed',
      httpStatus: completed?.status || 200,
      batchId: completed?.data?.batchId || null,
    });

    const workOrderReadback = await findWorkOrder(adminToken, bom.productName, workOrder.id);
    assertCompletedWorkOrder(workOrderReadback, workOrder.id);
    recordStep('read_back_work_order_and_batch', 'passed', {
      workOrderId: workOrderReadback.id,
      batchId: workOrderReadback.productBatch.id,
      batchNo: workOrderReadback.productBatch.batchNo,
    });

    const batchId = workOrderReadback.productBatch.id;
    const batchNo = workOrderReadback.productBatch.batchNo;

    const rawBalanceChecks = [];
    for (let index = 0; index < materialCodes.length; index += 1) {
      const code = materialCodes[index];
      const balances = await listStockBalances(adminToken, {
        locationId: String(rawLocation.id),
        productName: code,
      });
      const balance = balances.find(item => String(item.productName) === code && Number(item.locationId) === Number(rawLocation.id));
      if (!balance) {
        fail('Raw material stock balance was not found after completion', { code, balances });
      }
      const expectedRemaining = 50 - Number(expectedConsumptionByCode.get(code) || 0);
      if (Math.abs(Number(balance.quantity || 0) - expectedRemaining) > 0.0001) {
        fail('Raw material stock balance was not deducted correctly', {
          code,
          quantity: balance.quantity,
          expectedRemaining,
        });
      }
      rawBalanceChecks.push({
        code,
        deductedQuantity: Number(expectedConsumptionByCode.get(code) || 0),
        quantity: Number(balance.quantity || 0),
      });
    }
    recordStep('read_back_raw_material_deduction', 'passed', {
      checkedCount: rawBalanceChecks.length,
      sample: rawBalanceChecks.slice(0, 3),
    });

    const fgBalances = await listStockBalances(adminToken, {
      locationId: String(fgLocation.id),
      productName: bom.productName,
      batchNo,
    });
    const fgBalance = fgBalances.find(item => Number(item.locationId) === Number(fgLocation.id) || String(item.batchNo) === String(batchNo));
    if (!fgBalance) {
      fail('Finished goods stock balance was not found', { fgLocationId: fgLocation.id, batchNo, fgBalances });
    }
    recordStep('read_back_finished_goods_stock', 'passed', {
      locationId: fgLocation.id,
      batchNo: fgBalance.batchNo,
      quantity: fgBalance.quantity,
    });

    const consumptionEntries = await listStockEntries(adminToken, {
      sourceType: 'production_consumption',
      sourceRef: workOrderReadback.workOrderNo,
    });
    const outputEntries = await listStockEntries(adminToken, {
      sourceType: 'production_output',
      sourceRef: workOrderReadback.workOrderNo,
    });
    if (consumptionEntries.length === 0) {
      fail('No production consumption stock entry was created', { workOrderNo: workOrderReadback.workOrderNo });
    }
    if (outputEntries.length === 0) {
      fail('No production output stock entry was created', { workOrderNo: workOrderReadback.workOrderNo });
    }
    recordStep('read_back_stock_entries', 'passed', {
      consumptionEntryCount: consumptionEntries.length,
      outputEntryCount: outputEntries.length,
      consumptionSourceRef: workOrderReadback.workOrderNo,
    });

    const costLedger = await getBatchCostLedger(adminToken, batchId);
    const ledgerSummary = costLedger.summary || {};
    const ledgerItems = Array.isArray(costLedger.items) ? costLedger.items : [];
    if (ledgerItems.length === 0) {
      fail('No production cost ledger rows were created for finished goods batch', { batchId, costLedger });
    }
    if (Number(ledgerSummary.totalQuantityDelta || 0) <= 0) {
      fail('Production cost ledger summary is missing positive quantity delta', { ledgerSummary });
    }
    if (Number(ledgerSummary.totalCostAmountDelta || 0) <= 0) {
      fail('Production cost ledger summary is missing positive finished goods cost', { ledgerSummary });
    }
    recordStep('read_back_cost_ledger', 'passed', {
      batchId,
      totalQuantityDelta: ledgerSummary.totalQuantityDelta,
      totalCostAmountDelta: ledgerSummary.totalCostAmountDelta,
      currentUnitCost: ledgerSummary.currentUnitCost,
      rowCount: ledgerItems.length,
    });

    const summary = await getProductionSummary(adminToken);
    recordStep('final_summary_read_back', 'passed', {
      bomCount: summary.bomCount,
      workOrderCount: summary.workOrderCount,
      batchCount: summary.batchCount,
      totalProducedQuantity: summary.totalProducedQuantity,
      totalLossQuantity: summary.totalLossQuantity,
    });

    report.status = 'passed';
    report.evidence = {
      warehouseCode: bootstrap.warehouse.code,
      locations: Object.values(bootstrap.locations).map(item => ({
        code: item.code,
        name: item.name,
        id: item.id,
      })),
      bomId: bom.id,
      bomNo: bom.bomNo,
      workOrderId: workOrder.id,
      workOrderNo: workOrderReadback.workOrderNo,
      batchId,
      batchNo,
      incompleteBlocked,
      incompleteIssues,
      bomLineCount: bomItem.items.length,
      previewLineCount: preview.length,
      rawMaterialDeductionCount: rawBalanceChecks.length,
      consumptionEntryCount: consumptionEntries.length,
      outputEntryCount: outputEntries.length,
      finishedGoodsCostLedgerRows: ledgerItems.length,
      finishedGoodsCostAmount: Number(ledgerSummary.totalCostAmountDelta || 0),
    };
  } catch (error) {
    report.status = 'failed';
    const message = error?.message || String(error);
    report.gaps.push(message);
    if (error?.extra) {
      report.gaps.push(error.extra);
    }
    recordStep('audit_failed', 'failed', {
      message,
      extra: error?.extra || null,
    });
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = elapsedMs(startedAt);
    if (report.elapsedMs > OVERALL_TIMEOUT_MS) {
      report.gaps.push({
        type: 'timeout',
        message: `Audit exceeded overall timeout budget: ${report.elapsedMs}ms`,
      });
      report.status = 'failed';
    }
    writeReport();
    if (report.status === 'passed') {
      console.log(JSON.stringify({
        ok: true,
        reportPath: REPORT_PATH,
        evidence: report.evidence,
      }, null, 2));
    } else {
      console.log(JSON.stringify({
        ok: false,
        reportPath: REPORT_PATH,
        gaps: report.gaps,
      }, null, 2));
    }
  }
})();
