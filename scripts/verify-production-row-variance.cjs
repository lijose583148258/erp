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

const seedStock = async (userId, locationId, productName, batchNo, quantity) => {
  await StockMovementService.postStockEntry({
    sourceType: 'warehouse_initial',
    sourceRef: `QA-VARIANCE-SEED-${productName}-${Date.now()}`,
    reason: 'production_row_variance_verification_seed',
    note: 'Seed raw stock for row variance verification',
    createdBy: userId,
    lines: [{
      locationId,
      productName,
      batchNo,
      quantityDelta: quantity,
      unit: 'kg',
    }],
  });
  return prisma.stockBalance.findUnique({
    where: {
      locationId_productName_batchNo: {
        locationId,
        productName,
        batchNo,
      },
    },
    select: { id: true, quantity: true },
  });
};

const createOneLineWorkOrder = async ({ userId, code, allowedVarianceRate }) => {
  const bom = await ProductionMutationService.createBom({
    productName: `QA Variance Glue ${code}`,
    version: 'qa-row-variance-v1',
    outputUnit: 'kg',
    bomType: 'formula',
    formulationMode: 'chemical_formula',
    standardBatchSize: 100,
    batchSizeUnit: 'kg',
    items: [{
      materialName: '',
      materialCode: code,
      ingredientRole: 'main_resin',
      dosageMode: 'quantity_per_unit',
      quantityPerUnit: 0.01,
      unit: 'kg',
      lossRate: 0,
      allowedVarianceRate,
    }],
  }, userId);

  const workOrder = await ProductionMutationService.createWorkOrder({
    bomId: bom.id,
    productName: `QA Variance Glue ${code}`,
    targetQuantity: 100,
    producedQuantity: 100,
    lossQuantity: 0,
    note: 'QA row variance verification',
  }, userId);

  return { bom, workOrder };
};

(async () => {
  const stamp = Date.now();
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) fail('Missing user for production row variance verification');
  const rawLocationId = await getLocationId('LOC-RAW');

  const strictCode = `QA-STRICT-RESIN-${stamp}`;
  const looseCode = `QA-LOOSE-RESIN-${stamp}`;
  const strictStock = await seedStock(user.id, rawLocationId, strictCode, `${strictCode}-BATCH`, 50);
  const looseStock = await seedStock(user.id, rawLocationId, looseCode, `${looseCode}-BATCH`, 50);
  if (!strictStock || !looseStock) fail('Seed stock was not readable');

  const strict = await createOneLineWorkOrder({
    userId: user.id,
    code: strictCode,
    allowedVarianceRate: null,
  });

  let strictBlocked = false;
  let strictIssues = [];
  try {
    await ProductionMutationService.updateWorkOrderStatus(strict.workOrder.id, 'completed', [{
      stockBalanceId: strictStock.id,
      quantity: 0.5,
    }]);
  } catch (error) {
    strictBlocked = true;
    strictIssues = error.issues || [];
  }

  if (!strictBlocked) fail('Strict main resin variance was not blocked');
  if (!strictIssues.some(issue => issue.type === 'quantity_under' && Number(issue.toleranceRate) === 0.03)) {
    fail('Strict variance did not use main resin default tolerance', { strictIssues });
  }

  const loose = await createOneLineWorkOrder({
    userId: user.id,
    code: looseCode,
    allowedVarianceRate: 60,
  });

  const completed = await ProductionMutationService.updateWorkOrderStatus(loose.workOrder.id, 'completed', [{
    stockBalanceId: looseStock.id,
    quantity: 0.5,
  }]);

  const looseAfter = await prisma.stockBalance.findUnique({
    where: { id: looseStock.id },
    select: { quantity: true },
  });

  if (completed.status !== 'completed') fail('Loose row variance work order did not complete', completed);
  if (Number(looseAfter?.quantity || 0) !== 49.5) fail('Loose row variance stock was not deducted correctly', { looseAfter });

  console.log(JSON.stringify({
    ok: true,
    strictBomId: strict.bom.id,
    strictWorkOrderId: strict.workOrder.id,
    strictBlocked,
    strictIssueCount: strictIssues.length,
    strictToleranceRate: strictIssues[0]?.toleranceRate,
    looseBomId: loose.bom.id,
    looseWorkOrderId: loose.workOrder.id,
    looseStatus: completed.status,
    looseStockAfter: Number(looseAfter?.quantity || 0),
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
