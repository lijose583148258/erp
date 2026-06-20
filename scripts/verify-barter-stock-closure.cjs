const prisma = require('../backend/dist/config/database').default;
const { BarterService } = require('../backend/dist/services/barter.service');
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

const getBalance = async (locationId, productName, batchNo) => {
  const balance = await prisma.stockBalance.findUnique({
    where: {
      locationId_productName_batchNo: {
        locationId,
        productName,
        batchNo,
      },
    },
    select: { quantity: true, unit: true },
  });
  return Number(balance?.quantity || 0);
};

const countEntries = async (sourceRef, sourceTypes) => {
  const placeholders = sourceTypes.map(() => '?').join(',');
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS count
     FROM stock_entries
     WHERE source_ref = ?
       AND source_type IN (${placeholders})`,
    sourceRef,
    ...sourceTypes,
  );
  return Number(rows[0]?.count || 0);
};

(async () => {
  const stamp = Date.now();
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) fail('Missing user for barter verification');

  const fgLocationId = await getLocationId('LOC-FG');
  const rawLocationId = await getLocationId('LOC-RAW');
  const ourProduct = `QA-GLUE-BARTER-${stamp}`;
  const ourBatch = `QA-GLUE-BATCH-${stamp}`;
  const receivedProduct = `QA-TIMBER-BARTER-${stamp}`;
  const receivedBatch = `QA-TIMBER-BATCH-${stamp}`;

  await StockMovementService.postStockEntry({
    sourceType: 'warehouse_initial',
    sourceRef: `QA-BARTER-SEED-${stamp}`,
    reason: 'barter_stock_closure_verification_seed',
    note: 'Seed finished-goods stock for barter closure verification',
    createdBy: user.id,
    lines: [{
      locationId: fgLocationId,
      productName: ourProduct,
      batchNo: ourBatch,
      quantityDelta: 120,
      unit: 'kg',
    }],
  });

  const beforeOur = await getBalance(fgLocationId, ourProduct, ourBatch);
  const beforeReceived = await getBalance(rawLocationId, receivedProduct, receivedBatch);

  const settlement = await BarterService.createSettlement({
    counterpartyType: 'other',
    counterpartyName: `QA Barter Counterparty ${stamp}`,
    settlementMode: 'barter',
    currency: 'CNY',
    note: 'QA barter stock closure verification',
    createdBy: user.id,
    items: [
      {
        side: 'our',
        itemName: ourProduct,
        specification: '25kg pail',
        unit: 'kg',
        quantity: 12,
        unitPrice: 210,
        sourceDocument: ourBatch,
      },
      {
        side: 'counterparty',
        itemName: receivedProduct,
        specification: 'board material',
        unit: 'm3',
        quantity: 6,
        unitPrice: 380,
        sourceDocument: receivedBatch,
      },
    ],
  });

  await BarterService.approveSettlement(settlement.id, user.id, 'QA approve barter stock closure');
  const posted = await BarterService.postSettlement(settlement.id, user.id, {
    postingAmount: 2280,
    note: 'QA post barter stock closure',
  });
  const sourceRef = `BARTER-${settlement.id}`;

  const afterPostOur = await getBalance(fgLocationId, ourProduct, ourBatch);
  const afterPostReceived = await getBalance(rawLocationId, receivedProduct, receivedBatch);
  const postEntryCount = await countEntries(sourceRef, ['barter_issue', 'barter_receipt']);

  if (posted.status !== 'posted') fail('Settlement was not posted', posted);
  if (beforeOur !== 120) fail('Seed stock did not land before posting', { beforeOur });
  if (afterPostOur !== 108) fail('Barter issue did not deduct finished goods stock', { afterPostOur });
  if (afterPostReceived !== beforeReceived + 6) fail('Barter receipt did not add raw stock', { beforeReceived, afterPostReceived });
  if (postEntryCount !== 2) fail('Expected one barter issue and one barter receipt stock entry', { postEntryCount });

  const reversed = await BarterService.reverseSettlement(settlement.id, user.id, 'QA reverse barter stock closure');
  const afterReverseOur = await getBalance(fgLocationId, ourProduct, ourBatch);
  const afterReverseReceived = await getBalance(rawLocationId, receivedProduct, receivedBatch);
  const reversalEntryCount = await countEntries(`${sourceRef}-REV`, ['barter_issue_reversal', 'barter_receipt_reversal']);

  if (reversed.status !== 'reversed') fail('Settlement was not reversed', reversed);
  if (afterReverseOur !== beforeOur) fail('Barter reversal did not restore finished goods stock', { beforeOur, afterReverseOur });
  if (afterReverseReceived !== beforeReceived) fail('Barter reversal did not restore raw stock', { beforeReceived, afterReverseReceived });
  if (reversalEntryCount !== 2) fail('Expected one issue reversal and one receipt reversal stock entry', { reversalEntryCount });

  console.log(JSON.stringify({
    ok: true,
    settlementId: settlement.id,
    sourceRef,
    beforeOur,
    afterPostOur,
    afterReverseOur,
    beforeReceived,
    afterPostReceived,
    afterReverseReceived,
    postEntryCount,
    reversalEntryCount,
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
