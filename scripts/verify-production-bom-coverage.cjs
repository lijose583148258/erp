const prisma = require('../backend/dist/config/database').default;
const { ProductionMutationService } = require('../backend/dist/services/production-mutation.service');
const { StockMovementService } = require('../backend/dist/services/stock-movement.service');

const fail = (message, extra) => {
  const error = new Error(message);
  error.extra = extra;
  throw error;
};

const getLocationId = async (code) => {
  const location = await prisma.location.findFirst({
    where: { code, status: 'active' },
    select: { id: true },
  });
  if (!location) fail(`Missing location ${code}`);
  return location.id;
};

const getStockBalance = async (locationId, productName, batchNo) => {
  const stock = await prisma.stockBalance.findUnique({
    where: {
      locationId_productName_batchNo: {
        locationId,
        productName,
        batchNo,
      },
    },
    select: { id: true, quantity: true },
  });
  if (!stock) fail(`Missing stock balance ${productName}/${batchNo}`);
  return stock;
};

const getEntryCount = async (sourceRef, sourceType) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS count
     FROM stock_entries
     WHERE source_ref = ?
       AND source_type = ?`,
    sourceRef,
    sourceType,
  );
  return Number(rows[0]?.count || 0);
};

(async () => {
  const stamp = Date.now();
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) fail('Missing user for production verification');
  const rawLocationId = await getLocationId('LOC-RAW');

  const materialCodes = Array.from({ length: 10 }, (_, index) => `QA-MAT-${stamp}-${String(index + 1).padStart(2, '0')}`);
  const stockBalances = [];

  for (const code of materialCodes) {
    const batchNo = `${code}-BATCH`;
    await StockMovementService.postStockEntry({
      sourceType: 'warehouse_initial',
      sourceRef: `QA-BOM-SEED-${code}`,
      reason: 'production_bom_coverage_verification_seed',
      note: 'Seed raw stock for BOM coverage verification',
      createdBy: user.id,
      lines: [{
        locationId: rawLocationId,
        productName: code,
        batchNo,
        quantityDelta: 50,
        unit: 'kg',
      }],
    });
    stockBalances.push(await getStockBalance(rawLocationId, code, batchNo));
  }

  const bom = await ProductionMutationService.createBom({
    productName: `QA Glue Formula ${stamp}`,
    version: 'qa-coverage-v1',
    outputUnit: 'kg',
    shelfLifeDays: 365,
    bomType: 'formula',
    formulationMode: 'chemical_formula',
    standardBatchSize: 100,
    batchSizeUnit: 'kg',
    items: materialCodes.map((code, index) => ({
      materialName: '',
      materialCode: code,
      ingredientRole: index === 0 ? 'main_resin' : 'additive',
      dosageMode: 'quantity_per_unit',
      quantityPerUnit: 0.01,
      unit: 'kg',
      lossRate: 0,
    })),
  }, user.id);

  const workOrder = await ProductionMutationService.createWorkOrder({
    bomId: bom.id,
    productName: `QA Glue Formula ${stamp}`,
    targetQuantity: 100,
    producedQuantity: 100,
    lossQuantity: 0,
    note: 'QA production BOM coverage verification',
  }, user.id);

  let incompleteBlocked = false;
  let incompleteMessage = '';
  let incompleteIssues = [];
  try {
    await ProductionMutationService.updateWorkOrderStatus(workOrder.id, 'completed', [{
      stockBalanceId: stockBalances[0].id,
      quantity: 1,
    }]);
  } catch (error) {
    incompleteBlocked = true;
    incompleteMessage = error.message;
    incompleteIssues = error.issues || [];
  }

  if (!incompleteBlocked) {
    fail('Incomplete BOM consumption was allowed to complete');
  }
  if (!incompleteIssues.some(issue => issue.type === 'missing_material')) {
    fail('Incomplete BOM consumption failed for the wrong reason', { incompleteMessage, incompleteIssues });
  }

  let lowQuantityBlocked = false;
  let lowQuantityMessage = '';
  let lowQuantityIssues = [];
  try {
    await ProductionMutationService.updateWorkOrderStatus(
      workOrder.id,
      'completed',
      stockBalances.map(stock => ({ stockBalanceId: stock.id, quantity: 0.5 })),
    );
  } catch (error) {
    lowQuantityBlocked = true;
    lowQuantityMessage = error.message;
    lowQuantityIssues = error.issues || [];
  }

  if (!lowQuantityBlocked) {
    fail('Low material consumption was allowed to complete');
  }
  if (!lowQuantityIssues.some(issue => issue.type === 'quantity_under')) {
    fail('Low material consumption failed for the wrong reason', { lowQuantityMessage, lowQuantityIssues });
  }

  const completed = await ProductionMutationService.updateWorkOrderStatus(
    workOrder.id,
    'completed',
    stockBalances.map(stock => ({ stockBalanceId: stock.id, quantity: 1 })),
  );

  const consumptionEntryCount = await getEntryCount(completed.workOrderNo, 'production_consumption');
  const outputEntryCount = await getEntryCount(completed.workOrderNo, 'production_output');
  const firstMaterialAfter = await prisma.stockBalance.findUnique({
    where: { id: stockBalances[0].id },
    select: { quantity: true },
  });

  if (completed.status !== 'completed') fail('Complete BOM work order did not finish', completed);
  if (consumptionEntryCount !== 1) fail('Expected one production consumption stock entry', { consumptionEntryCount });
  if (outputEntryCount !== 1) fail('Expected one production output stock entry', { outputEntryCount });
  if (Number(firstMaterialAfter?.quantity || 0) !== 49) fail('Material stock was not deducted correctly', { quantity: firstMaterialAfter?.quantity });

  console.log(JSON.stringify({
    ok: true,
    bomId: bom.id,
    workOrderId: workOrder.id,
    workOrderNo: completed.workOrderNo,
    materialLineCount: materialCodes.length,
    incompleteBlocked,
    incompleteMessage,
    incompleteIssueCount: incompleteIssues.length,
    lowQuantityBlocked,
    lowQuantityMessage,
    lowQuantityIssueCount: lowQuantityIssues.length,
    consumptionEntryCount,
    outputEntryCount,
    firstMaterialAfter: Number(firstMaterialAfter?.quantity || 0),
  }, null, 2));
})()
  .catch(error => {
    console.error(JSON.stringify({
      ok: false,
      message: error.message,
      extra: error.extra || null,
      stack: error.stack,
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
