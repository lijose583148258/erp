const fs = require('fs');
const path = require('path');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:D:/AilaoDaRuntime/stable.db';

const { PrismaClient } = require(path.join(process.cwd(), 'backend', 'node_modules', '@prisma', 'client'));

const OUTPUT_DIR = path.resolve(process.cwd(), 'output', 'audit');
const REPORT_PATH = path.join(OUTPUT_DIR, 'production-state-reconcile-audit-v1.json');
const STRICT = process.env.AILAODA_RECONCILE_STRICT === '1';
const EPSILON = Number(process.env.AILAODA_PRODUCTION_RECONCILE_EPSILON || 0.000001);
const SAMPLE_LIMIT = Number(process.env.AILAODA_RECONCILE_SAMPLE_LIMIT || 20);
const MIN_CHEMICAL_BOM_ITEMS = Number(process.env.AILAODA_CHEMICAL_BOM_MIN_ITEMS || 10);

const report = {
  name: 'production-state-reconcile-audit-v1',
  databaseUrl: process.env.DATABASE_URL,
  strict: STRICT,
  startedAt: new Date().toISOString(),
  status: 'running',
  summary: {},
  samples: {},
  failure: null,
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeReport() {
  ensureDir(OUTPUT_DIR);
  report.finishedAt = new Date().toISOString();
  report.durationMs = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function normalizeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    typeof value === 'bigint' ? Number(value) : value,
  ]));
}

function firstNumber(rows, key) {
  return Number(normalizeRow(rows[0] || {})[key] || 0);
}

(async () => {
  const prisma = new PrismaClient();
  try {
    const completedGrossClosureWatchCount = firstNumber(await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) AS count
      FROM production_work_orders
      WHERE status = 'completed'
        AND ABS((COALESCE(produced_quantity, 0) + COALESCE(loss_quantity, 0)) - COALESCE(target_quantity, 0)) > ${EPSILON};
    `), 'count');

    const completedMissingBatchCount = firstNumber(await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) AS count
      FROM production_work_orders
      WHERE status = 'completed'
        AND batch_id IS NULL;
    `), 'count');

    const nonCompletedHasOutputCount = firstNumber(await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) AS count
      FROM production_work_orders
      WHERE status <> 'completed'
        AND (COALESCE(produced_quantity, 0) <> 0 OR COALESCE(loss_quantity, 0) <> 0);
    `), 'count');

    const missingCostLedgerCount = firstNumber(await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) AS count
      FROM (
        SELECT wo.id
        FROM production_work_orders wo
        LEFT JOIN inventory_cost_ledgers icl ON icl.work_order_id = wo.id
        WHERE wo.status = 'completed'
        GROUP BY wo.id
        HAVING COUNT(icl.id) = 0
      ) rows_without_ledger;
    `), 'count');

    const bomItemCountWatchCount = firstNumber(await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) AS count
      FROM (
        SELECT b.id
        FROM production_boms b
        LEFT JOIN production_bom_items i ON i.bom_id = b.id
        GROUP BY b.id
        HAVING COUNT(i.id) <> ${MIN_CHEMICAL_BOM_ITEMS}
      ) bom_rows;
    `), 'count');

    const activeChemicalBomUnderMinItemCount = firstNumber(await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) AS count
      FROM (
        SELECT b.id
        FROM production_boms b
        LEFT JOIN production_bom_items i ON i.bom_id = b.id
        WHERE b.status = 'active'
          AND (b.bom_type = 'chemical_formula' OR b.formulation_mode = 'percentage')
        GROUP BY b.id
        HAVING COUNT(i.id) < ${MIN_CHEMICAL_BOM_ITEMS}
      ) bom_rows;
    `), 'count');

    const activePercentageBomPctDriftCount = firstNumber(await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) AS count
      FROM (
        SELECT b.id
        FROM production_boms b
        JOIN production_bom_items i ON i.bom_id = b.id
        WHERE b.status = 'active'
          AND b.formulation_mode = 'percentage'
          AND i.percentage IS NOT NULL
        GROUP BY b.id
        HAVING ABS(COALESCE(SUM(i.percentage), 0) - 100) > 0.0001
      ) bom_pct_rows;
    `), 'count');

    const completedGrossClosureWatchRows = await prisma.$queryRawUnsafe(`
      SELECT
        id,
        work_order_no AS workOrderNo,
        product_name AS productName,
        target_quantity AS targetQuantity,
        produced_quantity AS producedQuantity,
        loss_quantity AS lossQuantity,
        ROUND(COALESCE(produced_quantity, 0) + COALESCE(loss_quantity, 0) - COALESCE(target_quantity, 0), 6) AS diff,
        status,
        batch_id AS batchId,
        bom_id AS bomId,
        updated_at AS updatedAt
      FROM production_work_orders
      WHERE status = 'completed'
        AND ABS((COALESCE(produced_quantity, 0) + COALESCE(loss_quantity, 0)) - COALESCE(target_quantity, 0)) > ${EPSILON}
      ORDER BY ABS(diff) DESC
      LIMIT ${SAMPLE_LIMIT};
    `);

    const nonCompletedHasOutputRows = await prisma.$queryRawUnsafe(`
      SELECT
        id,
        work_order_no AS workOrderNo,
        product_name AS productName,
        target_quantity AS targetQuantity,
        produced_quantity AS producedQuantity,
        loss_quantity AS lossQuantity,
        status,
        batch_id AS batchId,
        bom_id AS bomId,
        updated_at AS updatedAt
      FROM production_work_orders
      WHERE status <> 'completed'
        AND (COALESCE(produced_quantity, 0) <> 0 OR COALESCE(loss_quantity, 0) <> 0)
      ORDER BY updated_at DESC
      LIMIT ${SAMPLE_LIMIT};
    `);

    const bomItemCountWatchRows = await prisma.$queryRawUnsafe(`
      SELECT
        b.id AS bomId,
        b.bom_no AS bomNo,
        b.product_name AS productName,
        b.bom_type AS bomType,
        b.formulation_mode AS formulationMode,
        b.status,
        COUNT(i.id) AS itemCount,
        ROUND(COALESCE(SUM(i.percentage), 0), 6) AS percentageSum
      FROM production_boms b
      LEFT JOIN production_bom_items i ON i.bom_id = b.id
      GROUP BY b.id
      HAVING COUNT(i.id) <> ${MIN_CHEMICAL_BOM_ITEMS}
      ORDER BY itemCount ASC, b.id DESC
      LIMIT ${SAMPLE_LIMIT};
    `);

    const activeChemicalBomUnderMinItemRows = await prisma.$queryRawUnsafe(`
      SELECT
        b.id AS bomId,
        b.bom_no AS bomNo,
        b.product_name AS productName,
        b.bom_type AS bomType,
        b.formulation_mode AS formulationMode,
        b.status,
        COUNT(i.id) AS itemCount,
        ROUND(COALESCE(SUM(i.percentage), 0), 6) AS percentageSum
      FROM production_boms b
      LEFT JOIN production_bom_items i ON i.bom_id = b.id
      WHERE b.status = 'active'
        AND (b.bom_type = 'chemical_formula' OR b.formulation_mode = 'percentage')
      GROUP BY b.id
      HAVING COUNT(i.id) < ${MIN_CHEMICAL_BOM_ITEMS}
      ORDER BY itemCount ASC, b.id DESC
      LIMIT ${SAMPLE_LIMIT};
    `);

    const verdict = (
      completedMissingBatchCount > 0
      || nonCompletedHasOutputCount > 0
      || missingCostLedgerCount > 0
      || activeChemicalBomUnderMinItemCount > 0
      || activePercentageBomPctDriftCount > 0
    ) ? 'historical_production_data_requires_compensation_or_policy_confirmation' : 'clean';

    report.summary = {
      completedGrossClosureWatchCount,
      completedMissingBatchCount,
      nonCompletedHasOutputCount,
      missingCostLedgerCount,
      bomItemCountWatchCount,
      activeChemicalBomUnderMinItemCount,
      activePercentageBomPctDriftCount,
      minChemicalBomItems: MIN_CHEMICAL_BOM_ITEMS,
      epsilon: EPSILON,
      policyNotes: [
        'gross closure watch uses produced + loss vs target only as a legacy data signal; current service posts net output as produced - loss',
        'BOM item count is enforced only for active chemical/percentage formulas; draft and non-chemical BOM rows stay as watch items',
      ],
      verdict,
    };
    report.samples = {
      completedGrossClosureWatch: completedGrossClosureWatchRows.map(normalizeRow),
      nonCompletedHasOutput: nonCompletedHasOutputRows.map(normalizeRow),
      bomItemCountWatch: bomItemCountWatchRows.map(normalizeRow),
      activeChemicalBomUnderMinItems: activeChemicalBomUnderMinItemRows.map(normalizeRow),
    };

    if (report.summary.verdict === 'clean') {
      report.status = 'passed';
    } else {
      report.status = STRICT ? 'failed' : 'warning';
      if (STRICT) process.exitCode = 1;
    }
  } catch (error) {
    report.status = 'failed';
    report.failure = {
      message: String(error?.message || error),
      stack: error?.stack || null,
    };
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
    writeReport();
    console.log(JSON.stringify({
      status: report.status,
      strict: STRICT,
      reportPath: REPORT_PATH,
      summary: report.summary,
      failure: report.failure,
    }, null, 2));
  }
})();
