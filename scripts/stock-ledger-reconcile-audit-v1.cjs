const fs = require('fs');
const path = require('path');

const prisma = require('../backend/dist/config/database').default;

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'stock-ledger-reconcile-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const IDEMPOTENT_SOURCE_TYPES = [
  'warehouse_manual_inbound',
  'warehouse_transfer',
  'production_consumption',
  'production_output',
  'procurement_receipt',
  'shipping_issue',
  'barter_receipt',
  'barter_issue',
  'barter_receipt_reversal',
  'barter_issue_reversal',
];
const GENERAL_STOCK_SOURCE_UNIQUE_TYPES = IDEMPOTENT_SOURCE_TYPES.filter((sourceType) => sourceType !== 'warehouse_transfer');

const REQUIRED_LOCATIONS = ['WH-MAIN', 'LOC-RAW', 'LOC-FG', 'LOC-WIP', 'LOC-SCRAP'];
const EPSILON = 0.000001;

const report = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  scope: 'stock-ledger-history-reconcile',
  mode: 'read-only',
  status: 'running',
  summary: {},
  findings: {},
  recommendations: [],
};

const normalizeRow = (row) => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [
    key,
    typeof value === 'bigint' ? Number(value) : value,
  ]),
);

const normalizeRows = (rows) => rows.map(normalizeRow);

const placeholders = (values) => values.map(() => '?').join(',');

async function queryRows(sql, ...params) {
  return normalizeRows(await prisma.$queryRawUnsafe(sql, ...params));
}

async function getRuntimeDbPath() {
  const rows = await queryRows('PRAGMA database_list');
  return rows.find((row) => row.name === 'main')?.file || null;
}

async function findRequiredLocationState() {
  const rows = await queryRows(
    `SELECT code, name, status, 'warehouse' AS kind
     FROM warehouses
     WHERE code = 'WH-MAIN'
     UNION ALL
     SELECT code, name, status, 'location' AS kind
     FROM locations
     WHERE code IN ('LOC-RAW', 'LOC-FG', 'LOC-WIP', 'LOC-SCRAP')
     ORDER BY kind, code`,
  );
  const foundCodes = new Set(rows.map((row) => row.code));
  const missing = REQUIRED_LOCATIONS.filter((code) => !foundCodes.has(code));
  return { rows, missing };
}

async function findIdempotentDuplicateEntries() {
  return queryRows(
    `SELECT
       source_type AS sourceType,
       source_ref AS sourceRef,
       status,
       COUNT(*) AS entryCount,
       GROUP_CONCAT(id) AS entryIds,
       GROUP_CONCAT(entry_no) AS entryNos,
       MIN(created_at) AS firstCreatedAt,
       MAX(created_at) AS lastCreatedAt
     FROM stock_entries
     WHERE source_ref IS NOT NULL
       AND source_ref <> ''
       AND source_type IN (${placeholders(IDEMPOTENT_SOURCE_TYPES)})
     GROUP BY source_type, source_ref, status
     HAVING COUNT(*) > 1
     ORDER BY entryCount DESC, lastCreatedAt DESC
     LIMIT 200`,
    ...IDEMPOTENT_SOURCE_TYPES,
  );
}

async function getDuplicateDetails(duplicateGroups) {
  const details = [];
  for (const group of duplicateGroups.slice(0, 20)) {
    const rows = await queryRows(
      `SELECT
         e.id AS entryId,
         e.entry_no AS entryNo,
         e.source_type AS sourceType,
         e.source_ref AS sourceRef,
         e.status AS entryStatus,
         e.created_at AS entryCreatedAt,
         m.id AS movementId,
         m.stock_balance_id AS stockBalanceId,
         m.location_id AS locationId,
         l.code AS locationCode,
         m.product_name AS productName,
         m.batch_no AS batchNo,
         m.unit,
         m.quantity_before AS quantityBefore,
         m.quantity_delta AS quantityDelta,
         m.quantity_after AS quantityAfter
       FROM stock_entries e
       LEFT JOIN stock_movements m ON m.entry_id = e.id
       LEFT JOIN locations l ON l.id = m.location_id
       WHERE e.source_type = ?
         AND e.source_ref = ?
         AND e.status = ?
       ORDER BY e.id ASC, m.id ASC`,
      group.sourceType,
      group.sourceRef,
      group.status,
    );
    details.push({ group, rows });
  }
  return details;
}

async function findMissingSourceRefs() {
  return queryRows(
    `SELECT
       id,
       entry_no AS entryNo,
       source_type AS sourceType,
       source_ref AS sourceRef,
       status,
       created_at AS createdAt
     FROM stock_entries
     WHERE source_type IN (${placeholders(IDEMPOTENT_SOURCE_TYPES)})
       AND (source_ref IS NULL OR source_ref = '')
     ORDER BY id DESC
     LIMIT 200`,
    ...IDEMPOTENT_SOURCE_TYPES,
  );
}

async function findNegativeBalances() {
  return queryRows(
    `SELECT
       b.id AS balanceId,
       l.code AS locationCode,
       b.product_name AS productName,
       b.batch_no AS batchNo,
       b.quantity,
       b.unit,
       b.updated_at AS updatedAt
     FROM stock_balances b
     LEFT JOIN locations l ON l.id = b.location_id
     WHERE b.quantity < ?
     ORDER BY b.quantity ASC, b.updated_at DESC
     LIMIT 200`,
    -EPSILON,
  );
}

async function findLatestMovementMismatches() {
  return queryRows(
    `SELECT
       b.id AS balanceId,
       l.code AS locationCode,
       b.product_name AS productName,
       b.batch_no AS batchNo,
       b.quantity AS balanceQuantity,
       b.unit,
       m.id AS latestMovementId,
       m.quantity_after AS latestQuantityAfter,
       m.created_at AS latestMovementAt,
       ABS(COALESCE(b.quantity, 0) - COALESCE(m.quantity_after, 0)) AS drift
     FROM stock_balances b
     LEFT JOIN locations l ON l.id = b.location_id
     LEFT JOIN stock_movements m ON m.id = (
       SELECT sm.id
       FROM stock_movements sm
       WHERE sm.stock_balance_id = b.id
       ORDER BY sm.id DESC
       LIMIT 1
     )
     WHERE m.id IS NULL
        OR ABS(COALESCE(b.quantity, 0) - COALESCE(m.quantity_after, 0)) > ?
     ORDER BY drift DESC, b.updated_at DESC
     LIMIT 200`,
    EPSILON,
  );
}

async function findMovementChainBreaks() {
  return queryRows(
    `WITH ordered AS (
       SELECT
         m.id,
         m.stock_balance_id AS stockBalanceId,
         m.location_id AS locationId,
         l.code AS locationCode,
         m.product_name AS productName,
         m.batch_no AS batchNo,
         m.quantity_before AS quantityBefore,
         m.quantity_delta AS quantityDelta,
         m.quantity_after AS quantityAfter,
         LAG(m.quantity_after) OVER (
           PARTITION BY m.stock_balance_id
           ORDER BY m.id
         ) AS previousQuantityAfter
       FROM stock_movements m
       LEFT JOIN locations l ON l.id = m.location_id
       WHERE m.stock_balance_id IS NOT NULL
     )
     SELECT
       *,
       ABS(COALESCE(quantityBefore, 0) - COALESCE(previousQuantityAfter, 0)) AS drift
     FROM ordered
     WHERE previousQuantityAfter IS NOT NULL
       AND ABS(COALESCE(quantityBefore, 0) - COALESCE(previousQuantityAfter, 0)) > ?
     ORDER BY drift DESC, id DESC
     LIMIT 200`,
    EPSILON,
  );
}

async function findEntriesWithoutMovements() {
  return queryRows(
    `SELECT
       e.id,
       e.entry_no AS entryNo,
       e.source_type AS sourceType,
       e.source_ref AS sourceRef,
       e.status,
       e.created_at AS createdAt
     FROM stock_entries e
     LEFT JOIN stock_movements m ON m.entry_id = e.id
     GROUP BY e.id
     HAVING COUNT(m.id) = 0
     ORDER BY e.id DESC
     LIMIT 200`,
  );
}

async function findMovementsWithoutEntries() {
  return queryRows(
    `SELECT
       m.id,
       m.entry_id AS entryId,
       m.stock_balance_id AS stockBalanceId,
       m.location_id AS locationId,
       m.product_name AS productName,
       m.batch_no AS batchNo,
       m.quantity_delta AS quantityDelta,
       m.quantity_after AS quantityAfter
     FROM stock_movements m
     LEFT JOIN stock_entries e ON e.id = m.entry_id
     WHERE e.id IS NULL
     ORDER BY m.id DESC
     LIMIT 200`,
  );
}

async function findMovementsWithoutBalances() {
  return queryRows(
    `SELECT
       m.id,
       m.entry_id AS entryId,
       m.stock_balance_id AS stockBalanceId,
       m.location_id AS locationId,
       m.product_name AS productName,
       m.batch_no AS batchNo,
       m.quantity_delta AS quantityDelta,
       m.quantity_after AS quantityAfter
     FROM stock_movements m
     LEFT JOIN stock_balances b ON b.id = m.stock_balance_id
     WHERE m.stock_balance_id IS NOT NULL
       AND b.id IS NULL
     ORDER BY m.id DESC
     LIMIT 200`,
  );
}

async function getSourceSummary() {
  return queryRows(
    `SELECT
       source_type AS sourceType,
       status,
       COUNT(*) AS entryCount,
       COUNT(DISTINCT source_ref) AS sourceRefCount,
       MIN(created_at) AS firstCreatedAt,
       MAX(created_at) AS lastCreatedAt
     FROM stock_entries
     GROUP BY source_type, status
     ORDER BY entryCount DESC, sourceType ASC`,
  );
}

async function getUniqueIndexState() {
  return queryRows(
    `SELECT name, sql
     FROM sqlite_master
     WHERE type = 'index'
       AND name = 'stock_entries_source_type_ref_status_key'
     LIMIT 1`,
  );
}

async function getWarehouseTransferUniqueIndexState() {
  return queryRows(
    `SELECT name, sql
     FROM sqlite_master
     WHERE type = 'index'
       AND name = 'stock_entries_warehouse_transfer_ref_status_key'
     LIMIT 1`,
  );
}

function uniqueIndexIncludesAllIdempotentTypes(uniqueIndexRows) {
  const sql = String(uniqueIndexRows[0]?.sql || '');
  return GENERAL_STOCK_SOURCE_UNIQUE_TYPES.every((sourceType) => sql.includes(`'${sourceType}'`));
}

function pushRecommendation(condition, text) {
  if (condition) report.recommendations.push(text);
}

function deriveRiskLevel(findings) {
  const latestMovementDrifts = findings.latestMovementMismatches.filter((row) => row.latestMovementId);
  const balancesWithoutMovement = findings.latestMovementMismatches.filter((row) => !row.latestMovementId);
  const p0 =
    findings.duplicateEntryGroups.length > 0
    || findings.negativeBalances.length > 0
    || latestMovementDrifts.length > 0
    || findings.movementChainBreaks.length > 0
    || findings.movementsWithoutEntries.length > 0;
  if (p0) return 'P0';

  const p1 =
    findings.missingSourceRefs.length > 0
    || balancesWithoutMovement.length > 0
    || findings.entriesWithoutMovements.length > 0
    || findings.movementsWithoutBalances.length > 0
    || findings.uniqueIndex.length === 0
    || !findings.uniqueIndexCoversAllTypes
    || findings.warehouseTransferUniqueIndex.length === 0;
  if (p1) return 'P1';

  const p2 = findings.requiredLocations.missing.length > 0;
  return p2 ? 'P2' : 'clean';
}

async function run() {
  try {
    report.runtimeDbPath = await getRuntimeDbPath();

    const requiredLocations = await findRequiredLocationState();
    const duplicateEntryGroups = await findIdempotentDuplicateEntries();
    const duplicateDetails = await getDuplicateDetails(duplicateEntryGroups);
    const missingSourceRefs = await findMissingSourceRefs();
    const negativeBalances = await findNegativeBalances();
    const latestMovementMismatches = await findLatestMovementMismatches();
    const movementChainBreaks = await findMovementChainBreaks();
    const entriesWithoutMovements = await findEntriesWithoutMovements();
    const movementsWithoutEntries = await findMovementsWithoutEntries();
    const movementsWithoutBalances = await findMovementsWithoutBalances();
    const sourceSummary = await getSourceSummary();
    const uniqueIndex = await getUniqueIndexState();
    const warehouseTransferUniqueIndex = await getWarehouseTransferUniqueIndexState();
    const uniqueIndexCoversAllTypes = uniqueIndexIncludesAllIdempotentTypes(uniqueIndex);

    report.findings = {
      requiredLocations,
      uniqueIndex,
      warehouseTransferUniqueIndex,
      uniqueIndexCoversAllTypes,
      duplicateEntryGroups,
      duplicateDetails,
      missingSourceRefs,
      negativeBalances,
      latestMovementMismatches,
      movementChainBreaks,
      entriesWithoutMovements,
      movementsWithoutEntries,
      movementsWithoutBalances,
      sourceSummary,
    };

    report.summary = {
      requiredLocationMissingCount: requiredLocations.missing.length,
      uniqueIndexPresent: uniqueIndex.length > 0,
      warehouseTransferUniqueIndexPresent: warehouseTransferUniqueIndex.length > 0,
      uniqueIndexCoversAllTypes,
      duplicateEntryGroupCount: duplicateEntryGroups.length,
      missingSourceRefCount: missingSourceRefs.length,
      negativeBalanceCount: negativeBalances.length,
      latestMovementMismatchCount: latestMovementMismatches.length,
      latestMovementDriftCount: latestMovementMismatches.filter((row) => row.latestMovementId).length,
      balanceWithoutMovementCount: latestMovementMismatches.filter((row) => !row.latestMovementId).length,
      movementChainBreakCount: movementChainBreaks.length,
      entriesWithoutMovementsCount: entriesWithoutMovements.length,
      movementsWithoutEntriesCount: movementsWithoutEntries.length,
      movementsWithoutBalancesCount: movementsWithoutBalances.length,
    };

    report.riskLevel = deriveRiskLevel(report.findings);
    report.status = report.riskLevel === 'clean' ? 'clean' : 'findings';

    pushRecommendation(duplicateEntryGroups.length > 0, 'Create a manual reconciliation plan for duplicate idempotent stock entries before enforcing a hard unique index.');
    pushRecommendation(missingSourceRefs.length > 0, 'Backfill or quarantine stock entries from closed business flows that have missing sourceRef.');
    pushRecommendation(negativeBalances.length > 0, 'Investigate negative stock balances immediately before further outbound or production consumption.');
    pushRecommendation(latestMovementMismatches.length > 0, 'Compare each mismatched balance with its latest movement before allowing migration to server deployment.');
    pushRecommendation(latestMovementMismatches.some((row) => !row.latestMovementId), 'Historical stock balances without movement vouchers were found; classify them as opening balances or quarantine them before server migration.');
    pushRecommendation(movementChainBreaks.length > 0, 'Review movement chain breaks as possible historical manual edits or concurrent write drift.');
    pushRecommendation(entriesWithoutMovements.length > 0, 'Quarantine stock entries that have no movement rows; do not delete automatically.');
    pushRecommendation(uniqueIndex.length === 0, 'Runtime unique index for idempotent business stock entries is absent or skipped; inspect duplicate groups first.');
    pushRecommendation(warehouseTransferUniqueIndex.length === 0, 'Runtime unique index for warehouse transfers is absent or skipped; inspect duplicate transfer groups first.');
    pushRecommendation(!uniqueIndexCoversAllTypes, 'Runtime unique index exists but is stale; rebuild it so every non-transfer idempotent stock source type is covered.');
    pushRecommendation(requiredLocations.missing.length > 0, 'Seed missing default warehouse/location records before browser-level warehouse tests.');
    if (report.recommendations.length === 0) {
      report.recommendations.push('No blocking stock-ledger history drift found in this read-only audit.');
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
    console.error(report.error || 'stock ledger reconcile audit failed');
    process.exit(1);
  }

  console.log(JSON.stringify({
    status: report.status,
    riskLevel: report.riskLevel,
    summary: report.summary,
    reportPath: REPORT_PATH,
  }, null, 2));
}

run();
