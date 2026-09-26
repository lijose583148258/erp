const fs = require('fs');
const path = require('path');

const prisma = require('../backend/dist/config/database').default;

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'stock-ledger-opening-balance-repair-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const APPLY = process.argv.includes('--apply');
const EPSILON = 0.000001;

const report = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry-run',
  scope: 'stock-ledger-opening-balance-backfill',
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

async function findOpeningBalanceCandidates(tx = prisma) {
  return normalizeRows(await tx.$queryRawUnsafe(
    `SELECT
       b.id AS balanceId,
       b.location_id AS locationId,
       l.code AS locationCode,
       l.warehouse_id AS warehouseId,
       w.code AS warehouseCode,
       b.product_name AS productName,
       b.batch_no AS batchNo,
       b.quantity,
       b.unit,
       b.created_at AS createdAt,
       b.updated_at AS updatedAt
     FROM stock_balances b
     LEFT JOIN locations l ON l.id = b.location_id
     LEFT JOIN warehouses w ON w.id = l.warehouse_id
     LEFT JOIN stock_movements m ON m.stock_balance_id = b.id
     GROUP BY b.id
     HAVING COUNT(m.id) = 0
        AND b.quantity > ?
     ORDER BY b.id ASC`,
    EPSILON,
  ));
}

async function hasExistingOpeningEntry(tx, balanceId) {
  const rows = await tx.$queryRawUnsafe(
    `SELECT id
     FROM stock_entries
     WHERE source_type = 'warehouse_initial'
       AND source_ref = ?
     LIMIT 1`,
    `OPENING-BALANCE:${balanceId}`,
  );
  return rows.length > 0;
}

async function balanceHasMovement(tx, balanceId) {
  const rows = await tx.$queryRawUnsafe(
    `SELECT id
     FROM stock_movements
     WHERE stock_balance_id = ?
     LIMIT 1`,
    balanceId,
  );
  return rows.length > 0;
}

async function applyCandidate(tx, candidate) {
  const balanceId = Number(candidate.balanceId);
  if (await balanceHasMovement(tx, balanceId)) {
    return { status: 'skipped', reason: 'movement-already-exists', balanceId };
  }
  if (await hasExistingOpeningEntry(tx, balanceId)) {
    return { status: 'skipped', reason: 'opening-entry-already-exists', balanceId };
  }

  const entryNo = `OPEN-${RUN_ID}-${balanceId}`;
  const sourceRef = `OPENING-BALANCE:${balanceId}`;
  const quantity = Number(candidate.quantity || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { status: 'skipped', reason: 'non-positive-quantity', balanceId, quantity };
  }

  await tx.$executeRawUnsafe(
    `INSERT INTO stock_entries
       (entry_no, source_type, source_ref, direction, status, warehouse_id, location_id, reason, note, created_by, created_at, posted_at)
     VALUES (?, 'warehouse_initial', ?, 'inbound', 'posted', ?, ?, 'opening_balance_backfill', ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    entryNo,
    sourceRef,
    candidate.warehouseId || null,
    candidate.locationId,
    `Backfilled opening movement for historical stock balance ${balanceId}`,
  );

  const entries = await tx.$queryRawUnsafe(
    `SELECT id
     FROM stock_entries
     WHERE entry_no = ?
     LIMIT 1`,
    entryNo,
  );
  const entryId = Number(entries[0]?.id || 0);
  if (!entryId) {
    throw new Error(`opening balance entry insert failed for balance ${balanceId}`);
  }

  await tx.$executeRawUnsafe(
    `INSERT INTO stock_movements
       (entry_id, stock_balance_id, location_id, product_name, batch_no, unit, quantity_before, quantity_delta, quantity_after, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, CURRENT_TIMESTAMP)`,
    entryId,
    balanceId,
    candidate.locationId,
    candidate.productName,
    candidate.batchNo,
    candidate.unit || 'kg',
    quantity,
    quantity,
  );

  return {
    status: 'applied',
    balanceId,
    entryNo,
    sourceRef,
    locationCode: candidate.locationCode,
    productName: candidate.productName,
    batchNo: candidate.batchNo,
    quantity,
    unit: candidate.unit || 'kg',
  };
}

async function run() {
  try {
    report.candidates = await findOpeningBalanceCandidates();
    if (!APPLY) {
      report.status = report.candidates.length > 0 ? 'dry-run-findings' : 'dry-run-clean';
    } else {
      await prisma.$transaction(async (tx) => {
        const candidates = await findOpeningBalanceCandidates(tx);
        for (const candidate of candidates) {
          const result = await applyCandidate(tx, candidate);
          if (result.status === 'applied') report.applied.push(result);
          else report.skipped.push(result);
        }
      });

      report.status = 'applied';
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

  if (report.status === 'failed') {
    console.error(report.error || 'opening balance repair failed');
    process.exit(1);
  }

  console.log(JSON.stringify({
    status: report.status,
    mode: report.mode,
    candidateCount: report.candidates.length,
    appliedCount: report.applied.length,
    skippedCount: report.skipped.length,
    reportPath: REPORT_PATH,
  }, null, 2));
}

run();
