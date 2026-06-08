const fs = require('fs');
const path = require('path');

const prisma = require('../backend/dist/config/database').default;

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'audit');
const REPORT_PATH = path.join(OUTPUT_DIR, 'product-batch-shadow-stock-reconcile-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const APPLY = process.argv.includes('--apply');
const EPSILON = 0.000001;

const report = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry-run',
  scope: 'product-batch-shadow-stock-reconcile',
  status: 'running',
  candidates: [],
  applied: [],
  skipped: [],
};

const normalizeRow = (row) => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [
    key,
    typeof value === 'bigint' ? Number(value) : value,
  ]),
);

const normalizeRows = (rows) => rows.map(normalizeRow);

async function findCandidates(tx = prisma) {
  return normalizeRows(await tx.$queryRawUnsafe(
    `SELECT
       pb.id,
       pb.batch_no AS batchNo,
       pb.product_name AS productName,
       pb.stock_quantity AS productBatchQuantity,
       COALESCE(SUM(sb.quantity), 0) AS stockBalanceQuantity
     FROM product_batches pb
     LEFT JOIN stock_balances sb
       ON sb.product_name = pb.product_name
      AND sb.batch_no = pb.batch_no
     GROUP BY pb.id
     HAVING ABS(COALESCE(pb.stock_quantity, 0) - COALESCE(SUM(sb.quantity), 0)) > ?
     ORDER BY pb.id ASC`,
    EPSILON,
  ));
}

async function applyCandidate(tx, candidate) {
  const id = Number(candidate.id || 0);
  const nextQuantity = Number(candidate.stockBalanceQuantity || 0);
  if (!id || !Number.isFinite(nextQuantity) || nextQuantity < 0) {
    return { status: 'skipped', reason: 'invalid-candidate', id, nextQuantity };
  }

  await tx.$executeRawUnsafe(
    `UPDATE product_batches
     SET stock_quantity = ?
     WHERE id = ?`,
    nextQuantity,
    id,
  );

  return {
    status: 'applied',
    id,
    batchNo: candidate.batchNo,
    productName: candidate.productName,
    previousQuantity: Number(candidate.productBatchQuantity || 0),
    nextQuantity,
  };
}

async function run() {
  try {
    report.candidates = await findCandidates();
    if (!APPLY) {
      report.status = report.candidates.length > 0 ? 'dry-run-findings' : 'dry-run-clean';
    } else {
      await prisma.$transaction(async (tx) => {
        const candidates = await findCandidates(tx);
        for (const candidate of candidates) {
          const result = await applyCandidate(tx, candidate);
          if (result.status === 'applied') report.applied.push(result);
          else report.skipped.push(result);
        }
      });
      report.status = report.skipped.length > 0 ? 'applied-with-skips' : 'applied';
    }
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
    report.stack = error.stack || null;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    await prisma.$disconnect();
  }

  const summary = {
    status: report.status,
    mode: report.mode,
    candidateCount: report.candidates.length,
    appliedCount: report.applied.length,
    skippedCount: report.skipped.length,
    reportPath: REPORT_PATH,
  };

  if (report.status === 'failed') {
    console.error(JSON.stringify(summary, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(summary, null, 2));
}

run();
