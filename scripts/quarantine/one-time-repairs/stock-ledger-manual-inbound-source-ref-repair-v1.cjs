const fs = require('fs');
const path = require('path');

const prisma = require('../backend/dist/config/database').default;

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'stock-ledger-manual-inbound-source-ref-repair-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const APPLY = process.argv.includes('--apply');

const report = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry-run',
  scope: 'warehouse-manual-inbound-source-ref-backfill',
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
    `SELECT id, entry_no AS entryNo, source_type AS sourceType, status, created_at AS createdAt
     FROM stock_entries
     WHERE source_type = 'warehouse_manual_inbound'
       AND status = 'posted'
       AND (source_ref IS NULL OR source_ref = '')
     ORDER BY id ASC`,
  ));
}

async function sourceRefExists(tx, sourceRef) {
  const rows = await tx.$queryRawUnsafe(
    `SELECT id
     FROM stock_entries
     WHERE source_type = 'warehouse_manual_inbound'
       AND source_ref = ?
     LIMIT 1`,
    sourceRef,
  );
  return rows.length > 0;
}

async function applyCandidate(tx, candidate) {
  const entryId = Number(candidate.id || 0);
  const entryNo = String(candidate.entryNo || '').trim();
  if (!entryId || !entryNo) {
    return { status: 'skipped', reason: 'missing-entry-identity', entryId, entryNo };
  }

  const sourceRef = `LEGACY-MANUAL-INBOUND:${entryNo}`;
  if (await sourceRefExists(tx, sourceRef)) {
    return { status: 'skipped', reason: 'source-ref-already-exists', entryId, entryNo, sourceRef };
  }

  await tx.$executeRawUnsafe(
    `UPDATE stock_entries
     SET source_ref = ?,
         note = CASE
           WHEN note IS NULL OR note = '' THEN ?
           ELSE note || char(10) || ?
         END
     WHERE id = ?
       AND source_type = 'warehouse_manual_inbound'
       AND status = 'posted'
       AND (source_ref IS NULL OR source_ref = '')`,
    sourceRef,
    `System backfilled historical sourceRef ${sourceRef} on ${RUN_ID}`,
    `System backfilled historical sourceRef ${sourceRef} on ${RUN_ID}`,
    entryId,
  );

  return { status: 'applied', entryId, entryNo, sourceRef };
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
