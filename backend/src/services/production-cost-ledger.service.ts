import prisma from '../config/database';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import { addMoney, multiplyMoney, prorateMoney, roundMoney } from '../utils/money';

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

export interface AdjustmentCostLedgerInput {
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
}

export interface InventoryCostLedgerBatchSummary {
  totalQuantityDelta: number;
  totalCostAmountDelta: number;
  currentQuantity: number;
  currentCostAmount: number;
  currentUnitCost: number | null;
}

const roundQuantity = (value: number) => Number(value.toFixed(6));

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const serializeDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

type BatchCostSnapshot = {
  totalQuantityDelta: number;
  totalCostAmountDelta: number;
  currentUnitCost: number | null;
};

export const calculateInventoryUnitCost = (
  costAmountDelta: number,
  quantityDelta: number,
  fallbackUnitCost: number | null = null,
) => quantityDelta === 0
  ? fallbackUnitCost
  : prorateMoney(costAmountDelta, 1, quantityDelta);

export const calculateInventoryCostDelta = (
  quantityDelta: number,
  explicitCostDelta: number | null | undefined,
  currentUnitCost: number | null,
) => {
  if (explicitCostDelta !== null && explicitCostDelta !== undefined) {
    return roundMoney(explicitCostDelta);
  }

  if (currentUnitCost !== null && Number.isFinite(currentUnitCost)) {
    return multiplyMoney(quantityDelta, currentUnitCost);
  }

  return 0;
};

const mapLedgerRecord = (record: any): InventoryCostLedgerRecord => ({
  id: Number(record.id),
  ledgerNo: record.ledgerNo,
  batchId: Number(record.batchId),
  batchNo: record.productBatch?.batchNo || null,
  productName: record.productBatch?.productName || null,
  sourceType: record.sourceType,
  sourceRef: record.sourceRef,
  workOrderId: record.workOrderId === null ? null : Number(record.workOrderId),
  workOrderNo: record.workOrder?.workOrderNo || null,
  adjustmentId: record.adjustmentId === null ? null : Number(record.adjustmentId),
  adjustmentNo: record.adjustment?.adjustmentNo || null,
  quantityBefore: toNumber(record.quantityBefore),
  quantityDelta: toNumber(record.quantityDelta),
  quantityAfter: toNumber(record.quantityAfter),
  unitCost: record.unitCost === null ? null : roundMoney(toNumber(record.unitCost)),
  costBefore: roundMoney(toNumber(record.costBefore)),
  costAmountDelta: roundMoney(toNumber(record.costAmountDelta)),
  costAfter: roundMoney(toNumber(record.costAfter)),
  note: record.note,
  createdBy: Number(record.createdBy),
  creator: record.creator ? {
    id: Number(record.creator.id),
    username: record.creator.username || '',
    role: record.creator.role || '',
  } : null,
  createdAt: serializeDate(record.createdAt) || new Date().toISOString(),
});

const ledgerInclude = {
  productBatch: { select: { batchNo: true, productName: true } },
  workOrder: { select: { workOrderNo: true } },
  adjustment: { select: { adjustmentNo: true } },
  creator: { select: { id: true, username: true, role: true } },
};

const getBatchCostSnapshot = async (tx: any, batchId: number): Promise<BatchCostSnapshot> => {
  const aggregate = await tx.inventoryCostLedger.aggregate({
    where: { batchId },
    _sum: {
      quantityDelta: true,
      costAmountDelta: true,
    },
  });

  const totalQuantityDelta = roundQuantity(toNumber(aggregate._sum.quantityDelta));
  const totalCostAmountDelta = roundMoney(toNumber(aggregate._sum.costAmountDelta));
  const currentUnitCost = calculateInventoryUnitCost(totalCostAmountDelta, totalQuantityDelta);

  return {
    totalQuantityDelta,
    totalCostAmountDelta,
    currentUnitCost,
  };
};

const insertLedgerRow = async (tx: any, input: InventoryCostLedgerInput) => {
  const batch = await tx.productBatch.findUnique({
    where: { id: input.batchId },
    select: { id: true, batchNo: true, productName: true },
  });

  if (!batch) {
    throw new Error(`Product batch not found: ${input.batchId}`);
  }

  const quantityBefore = roundQuantity(input.quantityBefore);
  const quantityDelta = roundQuantity(input.quantityDelta);
  const quantityAfter = roundQuantity(input.quantityAfter);

  const costSnapshot = await getBatchCostSnapshot(tx, input.batchId);
  const costAmountDelta = calculateInventoryCostDelta(
    quantityDelta,
    input.costAmountDelta,
    costSnapshot.currentUnitCost,
  );
  const costBefore = roundMoney(costSnapshot.totalCostAmountDelta);
  const costAfter = addMoney(costBefore, costAmountDelta);
  const unitCost = calculateInventoryUnitCost(
    costAmountDelta,
    quantityDelta,
    costSnapshot.currentUnitCost,
  );
  const ledgerNo = buildBusinessNo('ICL');

  if (input.adjustmentId !== undefined && input.adjustmentId !== null) {
    try {
      const created = await tx.inventoryCostLedger.create({
        data: {
          ledgerNo,
          batchId: input.batchId,
          sourceType: input.sourceType,
          sourceRef: input.sourceRef ?? null,
          workOrderId: input.workOrderId ?? null,
          adjustmentId: input.adjustmentId,
          quantityBefore,
          quantityDelta,
          quantityAfter,
          unitCost,
          costBefore,
          costAmountDelta,
          costAfter,
          note: input.note ?? null,
          createdBy: input.createdBy,
        },
        include: ledgerInclude,
      });
      return mapLedgerRecord(created);
    } catch (error) {
      const existing = await tx.inventoryCostLedger.findUnique({
        where: { adjustmentId: input.adjustmentId },
        include: ledgerInclude,
      });
      if (!existing) {
        throw error;
      }
      return mapLedgerRecord(existing);
    }
  }

  const created = await tx.inventoryCostLedger.create({
    data: {
      ledgerNo,
      batchId: input.batchId,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef ?? null,
      workOrderId: input.workOrderId ?? null,
      adjustmentId: input.adjustmentId ?? null,
      quantityBefore,
      quantityDelta,
      quantityAfter,
      unitCost,
      costBefore,
      costAmountDelta,
      costAfter,
      note: input.note ?? null,
      createdBy: input.createdBy,
    },
    include: ledgerInclude,
  });

  if (!created) {
    throw new Error(`Inventory cost ledger insert failed: ${ledgerNo}`);
  }

  return mapLedgerRecord(created);
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

  static async recordAdjustmentLedgerTx(tx: any, input: AdjustmentCostLedgerInput) {
    return insertLedgerRow(tx, {
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
    });
  }

  static async recordAdjustmentLedger(input: AdjustmentCostLedgerInput) {
    return withDbRetry(() => prisma.$transaction(async tx => this.recordAdjustmentLedgerTx(tx, input)), { label: 'recordAdjustmentLedger' });
  }

  static async listByBatchId(batchId: number, options: { page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.min(Math.max(1, options.pageSize || 20), 100);
    const skip = (page - 1) * pageSize;

    const [items, total, batchRow, summary] = await Promise.all([
      prisma.inventoryCostLedger.findMany({
        where: { batchId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageSize,
        skip,
        include: ledgerInclude,
      }),
      prisma.inventoryCostLedger.count({ where: { batchId } }),
      prisma.productBatch.findUnique({
        where: { id: batchId },
        select: { id: true, batchNo: true, productName: true, stockQuantity: true, unit: true },
      }),
      prisma.inventoryCostLedger.aggregate({
        where: { batchId },
        _sum: {
          quantityDelta: true,
          costAmountDelta: true,
        },
      }),
    ]);

    const totalQuantityDelta = roundQuantity(toNumber(summary._sum.quantityDelta));
    const totalCostAmountDelta = roundMoney(toNumber(summary._sum.costAmountDelta));
    const currentUnitCost = calculateInventoryUnitCost(totalCostAmountDelta, totalQuantityDelta);
    const batch = batchRow ? {
      id: batchRow.id,
      batchNo: batchRow.batchNo,
      productName: batchRow.productName,
      stockQuantity: Number(batchRow.stockQuantity || 0),
      unit: batchRow.unit,
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
      items: items.map(mapLedgerRecord),
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }
}
