import prisma from '../config/database';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';

export type InventoryCostLedgerSourceType =
  | 'production_completion'
  | 'production_material_consumption'
  | 'production_finished_goods_receipt'
  | 'production_adjustment'
  | 'production_reversal'
  | 'inventory_adjustment'
  | 'inventory_reversal';

export interface InventoryCostLedgerInput {
  batchId: number;
  sourceType: InventoryCostLedgerSourceType;
  sourceRef?: string | null;
  workOrderId?: number | null;
  adjustmentId?: number | null;
  quantityBefore: number;
  quantityDelta: number;
  quantityAfter: number;
  costAmountDelta?: number | null;
  note?: string | null;
  createdBy: number;
}

export interface InventoryCostLedgerRecord {
  id: number;
  ledgerNo: string;
  batchId: number;
  batchNo: string | null;
  productName: string | null;
  sourceType: string;
  sourceRef: string | null;
  workOrderId: number | null;
  workOrderNo: string | null;
  adjustmentId: number | null;
  adjustmentNo: string | null;
  quantityBefore: number;
  quantityDelta: number;
  quantityAfter: number;
  unitCost: number | null;
  costBefore: number;
  costAmountDelta: number;
  costAfter: number;
  note: string | null;
  createdBy: number;
  creator: {
    id: number;
    username: string;
    role: string;
  } | null;
  createdAt: string;
}

export interface InventoryCostLedgerBatchSummary {
  totalQuantityDelta: number;
  totalCostAmountDelta: number;
  currentQuantity: number;
  currentCostAmount: number;
  currentUnitCost: number | null;
}

const roundQuantity = (value: number) => Number(value.toFixed(6));
const roundMoney = (value: number) => Number(value.toFixed(2));

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const serializeDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

type LedgerRow = {
  id: number;
  ledger_no: string;
  batch_id: number;
  batch_no: string | null;
  product_name: string | null;
  source_type: string;
  source_ref: string | null;
  work_order_id: number | null;
  work_order_no: string | null;
  adjustment_id: number | null;
  adjustment_no: string | null;
  quantity_before: number | string | null;
  quantity_delta: number | string | null;
  quantity_after: number | string | null;
  unit_cost: number | string | null;
  cost_before: number | string | null;
  cost_amount_delta: number | string | null;
  cost_after: number | string | null;
  note: string | null;
  created_by: number;
  creator_id: number | null;
  creator_username: string | null;
  creator_role: string | null;
  created_at: Date | string | null;
};

type BatchCostSnapshot = {
  totalQuantityDelta: number;
  totalCostAmountDelta: number;
  currentUnitCost: number | null;
};

const mapLedgerRow = (row: LedgerRow): InventoryCostLedgerRecord => ({
  id: row.id,
  ledgerNo: row.ledger_no,
  batchId: Number(row.batch_id),
  batchNo: row.batch_no,
  productName: row.product_name,
  sourceType: row.source_type,
  sourceRef: row.source_ref,
  workOrderId: row.work_order_id === null ? null : Number(row.work_order_id),
  workOrderNo: row.work_order_no,
  adjustmentId: row.adjustment_id === null ? null : Number(row.adjustment_id),
  adjustmentNo: row.adjustment_no,
  quantityBefore: toNumber(row.quantity_before),
  quantityDelta: toNumber(row.quantity_delta),
  quantityAfter: toNumber(row.quantity_after),
  unitCost: row.unit_cost === null ? null : roundMoney(toNumber(row.unit_cost)),
  costBefore: roundMoney(toNumber(row.cost_before)),
  costAmountDelta: roundMoney(toNumber(row.cost_amount_delta)),
  costAfter: roundMoney(toNumber(row.cost_after)),
  note: row.note,
  createdBy: Number(row.created_by),
  creator: row.creator_id === null ? null : {
    id: Number(row.creator_id),
    username: row.creator_username || '',
    role: row.creator_role || '',
  },
  createdAt: serializeDate(row.created_at) || new Date().toISOString(),
});

const getBatchCostSnapshot = async (tx: any, batchId: number): Promise<BatchCostSnapshot> => {
  const rows = await tx.$queryRawUnsafe(
    `SELECT
       COALESCE(SUM(quantity_delta), 0) AS total_quantity_delta,
       COALESCE(SUM(cost_amount_delta), 0) AS total_cost_amount_delta
      FROM inventory_cost_ledgers
      WHERE batch_id = ?`,
    batchId,
  ) as Array<{
    total_quantity_delta: number | string | null;
    total_cost_amount_delta: number | string | null;
  }>;

  const row = rows[0] || { total_quantity_delta: 0, total_cost_amount_delta: 0 };
  const totalQuantityDelta = roundQuantity(toNumber(row.total_quantity_delta));
  const totalCostAmountDelta = roundMoney(toNumber(row.total_cost_amount_delta));
  const currentUnitCost = totalQuantityDelta !== 0 ? roundMoney(totalCostAmountDelta / totalQuantityDelta) : null;

  return {
    totalQuantityDelta,
    totalCostAmountDelta,
    currentUnitCost,
  };
};

const resolveCostDelta = (
  quantityDelta: number,
  explicitCostDelta: number | null | undefined,
  currentUnitCost: number | null,
) => {
  if (explicitCostDelta !== null && explicitCostDelta !== undefined) {
    return roundMoney(explicitCostDelta);
  }

  if (currentUnitCost !== null && Number.isFinite(currentUnitCost)) {
    return roundMoney(quantityDelta * currentUnitCost);
  }

  return 0;
};

const insertLedgerRow = async (tx: any, input: InventoryCostLedgerInput) => {
  const batch = await tx.$queryRawUnsafe(
    'SELECT id, batch_no, product_name FROM product_batches WHERE id = ? LIMIT 1',
    input.batchId,
  ) as Array<{
    id: number;
    batch_no: string;
    product_name: string;
  }>;

  if (!batch.length) {
    throw new Error(`Product batch not found: ${input.batchId}`);
  }

  const quantityBefore = roundQuantity(input.quantityBefore);
  const quantityDelta = roundQuantity(input.quantityDelta);
  const quantityAfter = roundQuantity(input.quantityAfter);

  const costSnapshot = await getBatchCostSnapshot(tx, input.batchId);
  const costAmountDelta = resolveCostDelta(quantityDelta, input.costAmountDelta, costSnapshot.currentUnitCost);
  const costBefore = roundMoney(costSnapshot.totalCostAmountDelta);
  const costAfter = roundMoney(costBefore + costAmountDelta);
  const unitCost = quantityDelta !== 0 ? roundMoney(costAmountDelta / quantityDelta) : costSnapshot.currentUnitCost;
  const ledgerNo = buildBusinessNo('ICL');

  if (input.workOrderId !== undefined && input.workOrderId !== null) {
    await tx.$executeRawUnsafe(
      `INSERT INTO inventory_cost_ledgers (
        ledger_no, batch_id, source_type, source_ref, work_order_id, adjustment_id,
        quantity_before, quantity_delta, quantity_after, unit_cost, cost_before, cost_amount_delta,
        cost_after, note, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      ledgerNo,
      input.batchId,
      input.sourceType,
      input.sourceRef ?? null,
      input.workOrderId,
      input.adjustmentId ?? null,
      quantityBefore,
      quantityDelta,
      quantityAfter,
      unitCost,
      costBefore,
      costAmountDelta,
      costAfter,
      input.note ?? null,
      input.createdBy,
    );

    const rows = await tx.$queryRawUnsafe(
      `SELECT l.id, l.ledger_no, l.batch_id, b.batch_no, b.product_name,
              l.source_type, l.source_ref, l.work_order_id, wo.work_order_no,
              l.adjustment_id, ar.adjustment_no, l.quantity_before, l.quantity_delta,
              l.quantity_after, l.unit_cost, l.cost_before, l.cost_amount_delta,
              l.cost_after, l.note, l.created_by,
              u.id AS creator_id, u.username AS creator_username, u.role AS creator_role,
              l.created_at
       FROM inventory_cost_ledgers l
       LEFT JOIN product_batches b ON b.id = l.batch_id
       LEFT JOIN production_work_orders wo ON wo.id = l.work_order_id
       LEFT JOIN adjustment_records ar ON ar.id = l.adjustment_id
       LEFT JOIN users u ON u.id = l.created_by
      WHERE l.ledger_no = ?
      ORDER BY l.id DESC
      LIMIT 1`,
      ledgerNo,
    ) as LedgerRow[];

    if (!rows.length) {
      throw new Error(`Inventory cost ledger insert failed for work order ${input.workOrderId}: ${ledgerNo}`);
    }

    return mapLedgerRow(rows[0]);
  }

  if (input.adjustmentId !== undefined && input.adjustmentId !== null) {
    await tx.$executeRawUnsafe(
      `INSERT OR IGNORE INTO inventory_cost_ledgers (
        ledger_no, batch_id, source_type, source_ref, work_order_id, adjustment_id,
        quantity_before, quantity_delta, quantity_after, unit_cost, cost_before, cost_amount_delta,
        cost_after, note, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      ledgerNo,
      input.batchId,
      input.sourceType,
      input.sourceRef ?? null,
      input.workOrderId ?? null,
      input.adjustmentId,
      quantityBefore,
      quantityDelta,
      quantityAfter,
      unitCost,
      costBefore,
      costAmountDelta,
      costAfter,
      input.note ?? null,
      input.createdBy,
    );

    const rows = await tx.$queryRawUnsafe(
      `SELECT l.id, l.ledger_no, l.batch_id, b.batch_no, b.product_name,
              l.source_type, l.source_ref, l.work_order_id, wo.work_order_no,
              l.adjustment_id, ar.adjustment_no, l.quantity_before, l.quantity_delta,
              l.quantity_after, l.unit_cost, l.cost_before, l.cost_amount_delta,
              l.cost_after, l.note, l.created_by,
              u.id AS creator_id, u.username AS creator_username, u.role AS creator_role,
              l.created_at
       FROM inventory_cost_ledgers l
       LEFT JOIN product_batches b ON b.id = l.batch_id
       LEFT JOIN production_work_orders wo ON wo.id = l.work_order_id
       LEFT JOIN adjustment_records ar ON ar.id = l.adjustment_id
       LEFT JOIN users u ON u.id = l.created_by
      WHERE l.adjustment_id = ?
      ORDER BY l.id DESC
      LIMIT 1`,
      input.adjustmentId,
    ) as LedgerRow[];

    if (!rows.length) {
      throw new Error(`Inventory cost ledger insert failed for adjustment ${input.adjustmentId}`);
    }

    return mapLedgerRow(rows[0]);
  }

  await tx.$executeRawUnsafe(
    `INSERT INTO inventory_cost_ledgers (
      ledger_no, batch_id, source_type, source_ref, work_order_id, adjustment_id,
      quantity_before, quantity_delta, quantity_after, unit_cost, cost_before, cost_amount_delta,
      cost_after, note, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    ledgerNo,
    input.batchId,
    input.sourceType,
    input.sourceRef ?? null,
    input.workOrderId ?? null,
    input.adjustmentId ?? null,
    quantityBefore,
    quantityDelta,
    quantityAfter,
    unitCost,
    costBefore,
    costAmountDelta,
    costAfter,
    input.note ?? null,
    input.createdBy,
  );

  const rows = await tx.$queryRawUnsafe(
    `SELECT l.id, l.ledger_no, l.batch_id, b.batch_no, b.product_name,
            l.source_type, l.source_ref, l.work_order_id, wo.work_order_no,
            l.adjustment_id, ar.adjustment_no, l.quantity_before, l.quantity_delta,
            l.quantity_after, l.unit_cost, l.cost_before, l.cost_amount_delta,
            l.cost_after, l.note, l.created_by,
            u.id AS creator_id, u.username AS creator_username, u.role AS creator_role,
            l.created_at
     FROM inventory_cost_ledgers l
     LEFT JOIN product_batches b ON b.id = l.batch_id
     LEFT JOIN production_work_orders wo ON wo.id = l.work_order_id
     LEFT JOIN adjustment_records ar ON ar.id = l.adjustment_id
     LEFT JOIN users u ON u.id = l.created_by
     WHERE l.ledger_no = ?
     ORDER BY l.id DESC
     LIMIT 1`,
    ledgerNo,
  ) as LedgerRow[];

  if (!rows.length) {
    throw new Error(`Inventory cost ledger insert failed: ${ledgerNo}`);
  }

  return mapLedgerRow(rows[0]);
};

export class ProductionCostLedgerService {
  static async recordWorkOrderCompletion(tx: any, input: {
    batchId: number;
    workOrderId: number;
    workOrderNo: string;
    quantityBefore: number;
    quantityDelta: number;
    costAmountDelta?: number | null;
    note?: string | null;
    createdBy: number;
  }) {
    const productionSourceType: InventoryCostLedgerSourceType = input.quantityDelta < 0
      ? 'production_material_consumption'
      : 'production_finished_goods_receipt';

    return insertLedgerRow(tx, {
      batchId: input.batchId,
      sourceType: productionSourceType,
      sourceRef: input.workOrderNo,
      workOrderId: input.workOrderId,
      quantityBefore: input.quantityBefore,
      quantityDelta: input.quantityDelta,
      quantityAfter: roundQuantity(input.quantityBefore + input.quantityDelta),
      costAmountDelta: input.costAmountDelta ?? null,
      note: input.note || null,
      createdBy: input.createdBy,
    });
  }

  static async recordInventoryMovement(tx: any, input: {
    batchId: number;
    sourceRef?: string | null;
    quantityBefore: number;
    quantityDelta: number;
    quantityAfter: number;
    costAmountDelta?: number | null;
    note?: string | null;
    createdBy: number;
  }) {
    return insertLedgerRow(tx, {
      batchId: input.batchId,
      sourceType: 'inventory_adjustment',
      sourceRef: input.sourceRef ?? null,
      quantityBefore: input.quantityBefore,
      quantityDelta: input.quantityDelta,
      quantityAfter: input.quantityAfter,
      costAmountDelta: input.costAmountDelta ?? null,
      note: input.note || null,
      createdBy: input.createdBy,
    });
  }

  static async recordAdjustmentLedger(input: {
    batchId: number;
    adjustmentId: number;
    adjustmentNo: string;
    sourceType: InventoryCostLedgerSourceType;
    quantityBefore: number;
    quantityDelta: number;
    quantityAfter: number;
    amountDelta?: number | null;
    note?: string | null;
    createdBy: number;
  }) {
    return withDbRetry(() => prisma.$transaction(async tx => insertLedgerRow(tx, {
      batchId: input.batchId,
      sourceType: input.sourceType,
      sourceRef: input.adjustmentNo,
      adjustmentId: input.adjustmentId,
      quantityBefore: input.quantityBefore,
      quantityDelta: input.quantityDelta,
      quantityAfter: input.quantityAfter,
      costAmountDelta: input.amountDelta ?? null,
      note: input.note || null,
      createdBy: input.createdBy,
    })), { label: 'recordAdjustmentLedger' });
  }

  static async listByBatchId(batchId: number, options: { page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.min(Math.max(1, options.pageSize || 20), 100);
    const skip = (page - 1) * pageSize;

    const [items, count, batchRow, summaryRows] = await Promise.all([
      prisma.$queryRawUnsafe<LedgerRow[]>(`
        SELECT l.id, l.ledger_no, l.batch_id, b.batch_no, b.product_name,
               l.source_type, l.source_ref, l.work_order_id, wo.work_order_no,
               l.adjustment_id, ar.adjustment_no, l.quantity_before, l.quantity_delta,
               l.quantity_after, l.unit_cost, l.cost_before, l.cost_amount_delta,
               l.cost_after, l.note, l.created_by,
               u.id AS creator_id, u.username AS creator_username, u.role AS creator_role,
               l.created_at
        FROM inventory_cost_ledgers l
        LEFT JOIN product_batches b ON b.id = l.batch_id
        LEFT JOIN production_work_orders wo ON wo.id = l.work_order_id
        LEFT JOIN adjustment_records ar ON ar.id = l.adjustment_id
        LEFT JOIN users u ON u.id = l.created_by
        WHERE l.batch_id = ?
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT ? OFFSET ?
      `, batchId, pageSize, skip),
      prisma.$queryRawUnsafe<Array<{ total: number }>>(
        'SELECT COUNT(1) AS total FROM inventory_cost_ledgers WHERE batch_id = ?',
        batchId,
      ),
      prisma.$queryRawUnsafe<Array<{ id: number; batch_no: string; product_name: string; stock_quantity: number; unit: string }>>(
        'SELECT id, batch_no, product_name, stock_quantity, unit FROM product_batches WHERE id = ? LIMIT 1',
        batchId,
      ),
      prisma.$queryRawUnsafe<Array<{
        total_quantity_delta: number | string | null;
        total_cost_amount_delta: number | string | null;
      }>>(
        `SELECT
           COALESCE(SUM(quantity_delta), 0) AS total_quantity_delta,
           COALESCE(SUM(cost_amount_delta), 0) AS total_cost_amount_delta
         FROM inventory_cost_ledgers
         WHERE batch_id = ?`,
        batchId,
      ),
    ]);

    const total = Number(count[0]?.total || 0);
    const summaryRow = summaryRows[0] || { total_quantity_delta: 0, total_cost_amount_delta: 0 };
    const totalQuantityDelta = roundQuantity(toNumber(summaryRow.total_quantity_delta));
    const totalCostAmountDelta = roundMoney(toNumber(summaryRow.total_cost_amount_delta));
    const currentUnitCost = totalQuantityDelta !== 0 ? roundMoney(totalCostAmountDelta / totalQuantityDelta) : null;
    const batch = batchRow[0] ? {
      id: batchRow[0].id,
      batchNo: batchRow[0].batch_no,
      productName: batchRow[0].product_name,
      stockQuantity: Number(batchRow[0].stock_quantity || 0),
      unit: batchRow[0].unit,
    } : null;

    return {
      batch,
      summary: {
        totalQuantityDelta,
        totalCostAmountDelta,
        currentQuantity: batch ? roundQuantity(batch.stockQuantity) : totalQuantityDelta,
        currentCostAmount: totalCostAmountDelta,
        currentUnitCost,
      },
      items: items.map(mapLedgerRow),
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }
}
