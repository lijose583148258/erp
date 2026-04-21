const path = require('path');
const { createChemicalBomAuditContext } = require('./lib/chemical-bom-audit-utils.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001';
const REPORT_DIR = path.join(__dirname, '../output/playwright');
const REPORT_PATH = path.join(REPORT_DIR, 'production-completion-concurrency-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const {
  report,
  ensureDir,
  writeReport,
  recordStep,
  fail,
  login,
  ensureWarehouseAndLocations,
  ensureRawStock,
  listStockBalances,
  listStockEntries,
  getBatchCostLedger,
  createBom,
  createWorkOrder,
  findWorkOrder,
} = createChemicalBomAuditContext({
  appUrl: APP_URL,
  reportDir: REPORT_DIR,
  reportPath: REPORT_PATH,
});

report.name = 'production-completion-concurrency-audit-v1';
report.runId = RUN_ID;
report.appUrl = APP_URL;

function buildBomPayload(materialCodes) {
  return {
    productName: `CONC-GLUE-${RUN_ID}`,
    version: 'concurrency-v1',
    bomType: 'chemical_formula',
    status: 'active',
    formulationMode: 'percentage',
    outputUnit: 'kg',
    standardBatchSize: 100,
    batchSizeUnit: 'kg',
    notes: 'production completion concurrency audit',
    items: materialCodes.map((code, index) => ({
      materialName: `MAT-${String(index + 1).padStart(2, '0')}`,
      materialCode: code,
      ingredientRole: index === 0 ? 'main_resin' : index === 1 ? 'curing_agent' : 'additive',
      dosageMode: 'percentage',
      percentage: 10,
      quantityPerUnit: 0.1,
      unit: 'kg',
      processStage: 'audit',
      notes: 'code-only audit line',
    })),
  };
}

async function completeWithoutThrow(token, workOrderId, payload) {
  const response = await fetch(`${APP_URL}/api/production/work-orders/${workOrderId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  return { status: response.status, data };
}

(async () => {
  ensureDir(REPORT_DIR);
  writeReport();

  try {
    const token = await login('admin', 'admin123');
    recordStep('login_admin', 'passed', { appUrl: APP_URL });

    const bootstrap = await ensureWarehouseAndLocations(token);
    const rawLocation = bootstrap.locations['LOC-RAW'];
    const fgLocation = bootstrap.locations['LOC-FG'];
    recordStep('bootstrap_locations', 'passed', {
      rawLocationId: rawLocation.id,
      fgLocationId: fgLocation.id,
    });

    const materialCodes = Array.from({ length: 10 }, (_, index) => `CONC-${RUN_ID}-${String(index + 1).padStart(2, '0')}`);
    const seededBalances = [];
    for (let index = 0; index < materialCodes.length; index += 1) {
      seededBalances.push(await ensureRawStock(token, rawLocation.id, materialCodes[index], 50, 10 + index));
    }
    recordStep('seed_raw_stock', 'passed', { materialCount: seededBalances.length });

    const bom = await createBom(token, buildBomPayload(materialCodes));
    if (!Array.isArray(bom.items) || bom.items.length !== 10) {
      fail('BOM did not create 10 material lines', { bomId: bom.id, itemCount: bom.items?.length });
    }
    recordStep('create_10_line_bom', 'passed', { bomId: bom.id, itemCount: bom.items.length });

    const workOrder = await createWorkOrder(token, {
      bomId: bom.id,
      productName: bom.productName,
      targetQuantity: 100,
      producedQuantity: 100,
      lossQuantity: 0,
      note: 'concurrent completion audit',
      steps: [
        { stepNo: 1, title: 'premix' },
        { stepNo: 2, title: 'react' },
        { stepNo: 3, title: 'package' },
      ],
    });
    recordStep('create_work_order', 'passed', {
      workOrderId: workOrder.id,
      workOrderNo: workOrder.workOrderNo,
    });

    const payload = {
      status: 'completed',
      consumptionRecords: seededBalances.map(balance => ({
        stockBalanceId: balance.id,
        quantity: 1,
      })),
    };

    const responses = await Promise.all([
      completeWithoutThrow(token, workOrder.id, payload),
      completeWithoutThrow(token, workOrder.id, payload),
    ]);
    const statuses = responses.map(item => item.status);
    if (!statuses.every(status => status === 200 || status === 409)) {
      fail('Concurrent completion returned unexpected status', { statuses, responses });
    }
    if (!responses.some(item => item.status === 200)) {
      fail('Concurrent completion had no successful winner', { statuses });
    }
    recordStep('concurrent_complete_requests', 'passed', { statuses });

    const readback = await findWorkOrder(token, bom.productName, workOrder.id);
    if (!readback || readback.status !== 'completed') {
      fail('Completed work order read-back failed', { workOrderId: workOrder.id, readback });
    }
    if (!readback.productBatch?.batchNo) {
      fail('Completed work order did not bind exactly one finished goods batch', { readback });
    }
    recordStep('read_back_completed_work_order', 'passed', {
      workOrderId: readback.id,
      batchId: readback.productBatch.id,
      batchNo: readback.productBatch.batchNo,
    });

    const rawChecks = [];
    for (const code of materialCodes) {
      const balances = await listStockBalances(token, {
        locationId: String(rawLocation.id),
        productName: code,
      });
      const balance = balances.find(item => String(item.productName) === code && Number(item.locationId) === Number(rawLocation.id));
      if (!balance) {
        fail('Raw stock balance missing after concurrent completion', { code, balances });
      }
      if (Math.abs(Number(balance.quantity || 0) - 49) > 0.0001) {
        fail('Raw stock was deducted more than once or not deducted once', { code, quantity: balance.quantity });
      }
      rawChecks.push({ code, quantity: Number(balance.quantity || 0) });
    }
    recordStep('verify_raw_deducted_once', 'passed', { checkedCount: rawChecks.length });

    const outputEntries = await listStockEntries(token, {
      sourceType: 'production_output',
      sourceRef: readback.workOrderNo,
    });
    const consumptionEntries = await listStockEntries(token, {
      sourceType: 'production_consumption',
      sourceRef: readback.workOrderNo,
    });
    if (outputEntries.length !== 1 || consumptionEntries.length !== 1) {
      fail('Production stock entries duplicated or missing after concurrent completion', {
        outputEntryCount: outputEntries.length,
        consumptionEntryCount: consumptionEntries.length,
      });
    }
    recordStep('verify_stock_entries_once', 'passed', {
      outputEntryCount: outputEntries.length,
      consumptionEntryCount: consumptionEntries.length,
    });

    const fgBalances = await listStockBalances(token, {
      locationId: String(fgLocation.id),
      productName: bom.productName,
      batchNo: readback.productBatch.batchNo,
    });
    const fgBalance = fgBalances.find(item => String(item.batchNo) === String(readback.productBatch.batchNo));
    if (!fgBalance) {
      fail('Finished goods balance missing after concurrent completion', { fgBalances });
    }
    if (Math.abs(Number(fgBalance.quantity || 0) - 100) > 0.0001) {
      fail('Finished goods quantity drifted after concurrent completion', { quantity: fgBalance.quantity });
    }
    recordStep('verify_finished_goods_once', 'passed', {
      quantity: Number(fgBalance.quantity || 0),
      batchNo: fgBalance.batchNo,
    });

    const costLedger = await getBatchCostLedger(token, readback.productBatch.id);
    const ledgerItems = Array.isArray(costLedger.items) ? costLedger.items : [];
    if (ledgerItems.length !== 1) {
      fail('Finished goods cost ledger duplicated or missing', {
        rowCount: ledgerItems.length,
        costLedger,
      });
    }
    recordStep('verify_finished_goods_cost_ledger_once', 'passed', {
      rowCount: ledgerItems.length,
      totalCostAmountDelta: costLedger.summary?.totalCostAmountDelta,
    });

    report.status = 'passed';
    report.evidence = {
      workOrderId: readback.id,
      workOrderNo: readback.workOrderNo,
      statuses,
      rawDeductionCount: rawChecks.length,
      outputEntryCount: outputEntries.length,
      consumptionEntryCount: consumptionEntries.length,
      finishedGoodsQuantity: Number(fgBalance.quantity || 0),
      finishedGoodsCostLedgerRows: ledgerItems.length,
    };
  } catch (error) {
    report.status = 'failed';
    report.gaps.push(error?.message || String(error));
    if (error?.extra) report.gaps.push(error.extra);
    recordStep('audit_failed', 'failed', {
      message: error?.message || String(error),
      extra: error?.extra || null,
    });
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    writeReport();
    console.log(JSON.stringify({
      status: report.status,
      reportPath: REPORT_PATH,
      evidence: report.evidence || null,
      gaps: report.gaps || [],
    }, null, 2));
  }
})();
