process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:D:/AilaoDaRuntime/stable.db';

const fs = require('fs');
const path = require('path');
const prisma = require('../backend/dist/config/database').default;
const { BarterService } = require('../backend/dist/services/barter.service');
const { StockMovementService } = require('../backend/dist/services/stock-movement.service');

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'barter-concurrency-reconcile-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const report = {
  name: 'barter-concurrency-reconcile-audit-v1',
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  status: 'running',
  steps: [],
  findings: [],
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function recordStep(step, result, details = {}) {
  report.steps.push({
    at: new Date().toISOString(),
    step,
    result,
    ...details,
  });
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

async function getLocationId(code) {
  const location = await prisma.location.findFirst({
    where: { code, status: 'active' },
    select: { id: true },
  });
  if (!location) fail(`Missing location ${code}`);
  return location.id;
}

async function getBalance(locationId, productName, batchNo) {
  const balance = await prisma.stockBalance.findUnique({
    where: {
      locationId_productName_batchNo: {
        locationId,
        productName,
        batchNo,
      },
    },
    select: { quantity: true },
  });
  return Number(balance?.quantity || 0);
}

async function countEntries(sourceRef, sourceTypes) {
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
}

async function countOffsetPostings(settlementId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(offset_amount), 0) AS total
       FROM barter_offset_postings
      WHERE settlement_id = ?`,
    settlementId,
  );
  return {
    count: Number(rows[0]?.count || 0),
    total: Number(rows[0]?.total || 0),
  };
}

async function countReversalLogs(settlementId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS count
       FROM barter_reversal_logs
      WHERE settlement_id = ?`,
    settlementId,
  );
  return Number(rows[0]?.count || 0);
}

async function settleResult(promise) {
  try {
    const value = await promise;
    return { ok: true, status: value?.status || null, id: value?.id || null };
  } catch (error) {
    return { ok: false, message: error?.message || String(error) };
  }
}

async function seedOurStock(userId, fgLocationId, productName, batchNo, quantity) {
  await StockMovementService.postStockEntry({
    sourceType: 'warehouse_initial',
    sourceRef: `BARTER-CONC-SEED-${RUN_ID}-${batchNo}`,
    reason: 'barter_concurrency_audit_seed',
    note: 'Seed finished goods for barter concurrency audit',
    createdBy: userId,
    lines: [{
      locationId: fgLocationId,
      productName,
      batchNo,
      quantityDelta: quantity,
      unit: 'kg',
    }],
  });
}

async function createApprovedSettlement(userId, fgLocationId, label) {
  const ourProduct = `BARTER-${label}-GLUE-${RUN_ID}`;
  const ourBatch = `BARTER-${label}-GLUE-BATCH-${RUN_ID}`;
  const receivedProduct = `BARTER-${label}-WOOD-${RUN_ID}`;
  const receivedBatch = `BARTER-${label}-WOOD-BATCH-${RUN_ID}`;
  await seedOurStock(userId, fgLocationId, ourProduct, ourBatch, 120);

  const settlement = await BarterService.createSettlement({
    counterpartyType: 'other',
    counterpartyName: `Barter Counterparty ${label} ${RUN_ID}`,
    settlementMode: 'barter',
    currency: 'CNY',
    note: `barter concurrency ${label}`,
    createdBy: userId,
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

  const approved = await BarterService.approveSettlement(settlement.id, userId, `approve ${label}`);
  if (approved.status !== 'approved') {
    fail('Settlement was not approved before race', { label, approved });
  }

  return {
    id: settlement.id,
    sourceRef: `BARTER-${settlement.id}`,
    ourProduct,
    ourBatch,
    receivedProduct,
    receivedBatch,
    offsetAmount: 2280,
  };
}

async function readSettlement(id) {
  return prisma.barterSettlement.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      paymentRecordId: true,
      orderId: true,
    },
  });
}

async function assertPostedOnce(ctx, fgLocationId, rawLocationId) {
  const settlement = await readSettlement(ctx.id);
  const issueEntries = await countEntries(ctx.sourceRef, ['barter_issue']);
  const receiptEntries = await countEntries(ctx.sourceRef, ['barter_receipt']);
  const reversalEntries = await countEntries(`${ctx.sourceRef}-REV`, ['barter_issue_reversal', 'barter_receipt_reversal']);
  const postings = await countOffsetPostings(ctx.id);
  const reversalLogs = await countReversalLogs(ctx.id);
  const ourBalance = await getBalance(fgLocationId, ctx.ourProduct, ctx.ourBatch);
  const receivedBalance = await getBalance(rawLocationId, ctx.receivedProduct, ctx.receivedBatch);

  if (settlement.status !== 'posted') fail('Settlement did not stay posted', { settlement });
  if (issueEntries !== 1 || receiptEntries !== 1) fail('Posted stock entries are not exactly once', { issueEntries, receiptEntries });
  if (reversalEntries !== 0) fail('Unexpected reversal entries for posted-only race', { reversalEntries });
  if (postings.count !== 1 || postings.total !== ctx.offsetAmount) fail('Offset posting drift after post race', { postings });
  if (reversalLogs !== 0) fail('Unexpected reversal log for posted-only race', { reversalLogs });
  if (ourBalance !== 108 || receivedBalance !== 6) fail('Stock balance drift after post race', { ourBalance, receivedBalance });

  return { settlement, issueEntries, receiptEntries, reversalEntries, postings, reversalLogs, ourBalance, receivedBalance };
}

async function assertReversedPostedOnce(ctx, fgLocationId, rawLocationId) {
  const settlement = await readSettlement(ctx.id);
  const issueEntries = await countEntries(ctx.sourceRef, ['barter_issue']);
  const receiptEntries = await countEntries(ctx.sourceRef, ['barter_receipt']);
  const reversalEntries = await countEntries(`${ctx.sourceRef}-REV`, ['barter_issue_reversal', 'barter_receipt_reversal']);
  const postings = await countOffsetPostings(ctx.id);
  const reversalLogs = await countReversalLogs(ctx.id);
  const ourBalance = await getBalance(fgLocationId, ctx.ourProduct, ctx.ourBatch);
  const receivedBalance = await getBalance(rawLocationId, ctx.receivedProduct, ctx.receivedBatch);

  if (settlement.status !== 'reversed') fail('Settlement did not end reversed', { settlement });
  if (issueEntries !== 1 || receiptEntries !== 1) fail('Original posted stock entries are not exactly once', { issueEntries, receiptEntries });
  if (reversalEntries !== 2) fail('Reversal stock entries are not exactly once per direction', { reversalEntries });
  if (postings.count !== 1 || postings.total !== ctx.offsetAmount) fail('Offset posting drift after reverse race', { postings });
  if (reversalLogs !== 1) fail('Reversal log was duplicated or missing', { reversalLogs });
  if (ourBalance !== 120 || receivedBalance !== 0) fail('Stock balance was not restored after reverse race', { ourBalance, receivedBalance });

  return { settlement, issueEntries, receiptEntries, reversalEntries, postings, reversalLogs, ourBalance, receivedBalance };
}

async function assertPostReverseRaceConsistent(ctx, fgLocationId, rawLocationId) {
  const settlement = await readSettlement(ctx.id);
  const issueEntries = await countEntries(ctx.sourceRef, ['barter_issue']);
  const receiptEntries = await countEntries(ctx.sourceRef, ['barter_receipt']);
  const reversalEntries = await countEntries(`${ctx.sourceRef}-REV`, ['barter_issue_reversal', 'barter_receipt_reversal']);
  const postings = await countOffsetPostings(ctx.id);
  const reversalLogs = await countReversalLogs(ctx.id);
  const ourBalance = await getBalance(fgLocationId, ctx.ourProduct, ctx.ourBatch);
  const receivedBalance = await getBalance(rawLocationId, ctx.receivedProduct, ctx.receivedBatch);

  if (settlement.status === 'posted') {
    if (issueEntries !== 1 || receiptEntries !== 1 || reversalEntries !== 0) {
      fail('Posted final state has inconsistent stock entries', { issueEntries, receiptEntries, reversalEntries });
    }
    if (postings.count !== 1 || postings.total !== ctx.offsetAmount) fail('Posted final state has offset drift', { postings });
    if (ourBalance !== 108 || receivedBalance !== 6) fail('Posted final state has stock drift', { ourBalance, receivedBalance });
  } else if (settlement.status === 'reversed') {
    const approvedOnlyReverse = issueEntries === 0 && receiptEntries === 0 && reversalEntries === 0 && postings.count === 0;
    const postedThenReversed = issueEntries === 1 && receiptEntries === 1 && reversalEntries === 2 && postings.count === 1 && reversalLogs === 1;
    if (!approvedOnlyReverse && !postedThenReversed) {
      fail('Reversed final state has inconsistent entry pattern', {
        issueEntries,
        receiptEntries,
        reversalEntries,
        postings,
        reversalLogs,
      });
    }
    if (ourBalance !== 120 || receivedBalance !== 0) fail('Reversed final state did not leave stock neutral', { ourBalance, receivedBalance });
  } else {
    fail('Post/reverse race ended in invalid status', { settlement });
  }

  return { settlement, issueEntries, receiptEntries, reversalEntries, postings, reversalLogs, ourBalance, receivedBalance };
}

(async () => {
  ensureDir(OUTPUT_DIR);

  try {
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!user) fail('Missing user for barter concurrency audit');
    const fgLocationId = await getLocationId('LOC-FG');
    const rawLocationId = await getLocationId('LOC-RAW');
    recordStep('bootstrap', 'passed', { userId: user.id, fgLocationId, rawLocationId });

    const postRace = await createApprovedSettlement(user.id, fgLocationId, 'POST');
    const postResults = await Promise.all([
      settleResult(BarterService.postSettlement(postRace.id, user.id, { postingAmount: postRace.offsetAmount, note: 'post race A' })),
      settleResult(BarterService.postSettlement(postRace.id, user.id, { postingAmount: postRace.offsetAmount, note: 'post race B' })),
    ]);
    const postEvidence = await assertPostedOnce(postRace, fgLocationId, rawLocationId);
    recordStep('double_post_race', 'passed', { results: postResults, evidence: postEvidence });

    const reverseRace = await createApprovedSettlement(user.id, fgLocationId, 'REV');
    await BarterService.postSettlement(reverseRace.id, user.id, { postingAmount: reverseRace.offsetAmount, note: 'prepare reverse race' });
    const reverseResults = await Promise.all([
      settleResult(BarterService.reverseSettlement(reverseRace.id, user.id, 'reverse race A')),
      settleResult(BarterService.reverseSettlement(reverseRace.id, user.id, 'reverse race B')),
    ]);
    const reverseEvidence = await assertReversedPostedOnce(reverseRace, fgLocationId, rawLocationId);
    recordStep('double_reverse_race', 'passed', { results: reverseResults, evidence: reverseEvidence });

    const postReverseRace = await createApprovedSettlement(user.id, fgLocationId, 'MIX');
    const mixedResults = await Promise.all([
      settleResult(BarterService.postSettlement(postReverseRace.id, user.id, { postingAmount: postReverseRace.offsetAmount, note: 'mixed post' })),
      settleResult(BarterService.reverseSettlement(postReverseRace.id, user.id, 'mixed reverse')),
    ]);
    const mixedEvidence = await assertPostReverseRaceConsistent(postReverseRace, fgLocationId, rawLocationId);
    recordStep('post_vs_reverse_race', 'passed', { results: mixedResults, evidence: mixedEvidence });

    report.status = 'passed';
    report.evidence = {
      postRace: { id: postRace.id, results: postResults, finalStatus: postEvidence.settlement.status },
      reverseRace: { id: reverseRace.id, results: reverseResults, finalStatus: reverseEvidence.settlement.status },
      postReverseRace: { id: postReverseRace.id, results: mixedResults, finalStatus: mixedEvidence.settlement.status },
    };
  } catch (error) {
    report.status = 'failed';
    report.error = error?.message || String(error);
    report.details = error?.details || null;
    report.stack = error?.stack || null;
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({
      status: report.status,
      reportPath: REPORT_PATH,
      evidence: report.evidence || null,
      error: report.error || null,
    }, null, 2));
    await prisma.$disconnect();
  }
})();
