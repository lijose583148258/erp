#!/usr/bin/env node

const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const runtimeDb = process.env.DATABASE_URL || 'file:D:/AilaoDaRuntime/stable.db';
process.env.DATABASE_URL = runtimeDb;

const workOrderId = Number(process.argv[2]);

if (!Number.isInteger(workOrderId) || workOrderId <= 0) {
  console.error(JSON.stringify({ ok: false, error: 'Usage: node scripts/audit-work-order-ledgers-v1.cjs <workOrderId>' }, null, 2));
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const workOrderRows = await prisma.$queryRawUnsafe(
    `SELECT id, work_order_no, product_name, status, produced_quantity, batch_id
       FROM production_work_orders
      WHERE id = ?`,
    workOrderId,
  );
  const workOrderNo = workOrderRows[0]?.work_order_no || null;

  if (!workOrderNo) {
    console.log(JSON.stringify({
      ok: false,
      runtimeDb,
      workOrderId,
      summary: { workOrderFound: false },
      workOrder: null,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const stockEntries = await prisma.$queryRawUnsafe(
    `SELECT id, entry_no, source_type, source_ref, status, posted_at
       FROM stock_entries
      WHERE source_type IN ('production_consumption', 'production_output')
        AND source_ref = ?
      ORDER BY id`,
    workOrderNo,
  );

  const stockMovements = await prisma.$queryRawUnsafe(
    `SELECT se.id AS stock_entry_id,
            se.entry_no,
            se.source_type,
            sm.product_name,
            sm.batch_no,
            sm.quantity_delta,
            sm.unit,
            sm.location_id
       FROM stock_movements sm
       JOIN stock_entries se ON se.id = sm.entry_id
      WHERE se.source_type IN ('production_consumption', 'production_output')
        AND se.source_ref = ?
      ORDER BY se.id, sm.id`,
    workOrderNo,
  );

  const costLedgers = await prisma.$queryRawUnsafe(
    `SELECT id, ledger_no, work_order_id, batch_id, source_type, source_ref, quantity_delta,
            cost_amount_delta, note, created_at
       FROM inventory_cost_ledgers
      WHERE work_order_id = ?
      ORDER BY id`,
    workOrderId,
  );

  const batchRows = await prisma.$queryRawUnsafe(
    `SELECT pb.id, pb.batch_no, pb.product_name, pb.stock_quantity, pb.unit, pb.notes
       FROM product_batches pb
      WHERE pb.id IN (
        SELECT DISTINCT batch_id
          FROM inventory_cost_ledgers
         WHERE work_order_id = ?
           AND batch_id IS NOT NULL
      )
      ORDER BY pb.id`,
    workOrderId,
  );

  const materialMovementCount = stockMovements.filter((row) => row.source_type === 'production_consumption').length;
  const outputMovementCount = stockMovements.filter((row) => row.source_type === 'production_output').length;
  const materialLedgerCount = costLedgers.filter((row) => row.source_type === 'production_material_consumption').length;
  const outputLedgerCount = costLedgers.filter((row) => row.source_type === 'production_finished_goods_receipt').length;
  const legacyProductionCompletionCount = costLedgers.filter((row) => row.source_type === 'production_completion').length;

  const result = {
    ok: materialMovementCount > 0
      && outputMovementCount > 0
      && materialLedgerCount === materialMovementCount
      && outputLedgerCount === outputMovementCount,
    runtimeDb,
    workOrderId,
    summary: {
      workOrderFound: workOrderRows.length === 1,
      materialMovementCount,
      outputMovementCount,
      materialLedgerCount,
      outputLedgerCount,
      legacyProductionCompletionCount,
      stockEntryCount: stockEntries.length,
      linkedBatchCount: batchRows.length,
    },
    workOrder: workOrderRows[0] || null,
    stockEntries,
    stockMovements,
    costLedgers,
    linkedBatches: batchRows,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, runtimeDb, workOrderId, error: error.message }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
