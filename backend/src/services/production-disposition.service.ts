import prisma from '../config/database';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import { prorateMoney, roundMoney } from '../utils/money';
import { StockMovementConflictError } from './stock-movement.errors';
import { StockMovementService, type TransactionClient } from './stock-movement.service';

export type ProductionDispositionType = 'scrap' | 'rework_return';

export type CreateProductionDispositionInput = {
  workOrderId: number;
  type: ProductionDispositionType;
  quantity: number;
  reason: string;
  note?: string | null;
  idempotencyKey: string;
  stockBalanceId?: number | null;
  sourceDispositionId?: number | null;
  destinationLocationId?: number | null;
};

const QUANTITY_TOLERANCE = 0.000001;
const roundQuantity = (value: number) => Number(value.toFixed(6));
const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const normalizedText = (value: unknown) => String(value || '').trim();
const serialize = (value: unknown) => JSON.stringify(value);

const dispositionInclude = {
  workOrder: { select: { workOrderNo: true } },
  productBatch: { select: { batchNo: true, productName: true, unit: true, qualityStatus: true } },
  stockBalance: {
    select: {
      locationId: true,
      productName: true,
      batchNo: true,
      quantity: true,
      unit: true,
      location: { select: { code: true, name: true } },
    },
  },
  creator: { select: { id: true, username: true, role: true } },
};

const mapDisposition = (record: any) => ({
  id: Number(record.id),
  dispositionNo: record.dispositionNo,
  idempotencyKey: record.idempotencyKey,
  workOrderId: Number(record.workOrderId),
  workOrderNo: record.workOrder?.workOrderNo || null,
  batchId: Number(record.batchId),
  batchNo: record.productBatch?.batchNo || null,
  productName: record.productBatch?.productName || null,
  qualityStatus: record.productBatch?.qualityStatus || null,
  stockBalanceId: Number(record.stockBalanceId),
  locationId: Number(record.stockBalance?.locationId || 0) || null,
  locationCode: record.stockBalance?.location?.code || null,
  locationName: record.stockBalance?.location?.name || null,
  dispositionType: record.dispositionType,
  sourceDispositionId: record.sourceDispositionId == null ? null : Number(record.sourceDispositionId),
  quantity: asNumber(record.quantity),
  unit: record.unit,
  costAmount: roundMoney(asNumber(record.costAmount)),
  reworkedQuantity: roundQuantity(asNumber(record.reworkedQuantity)),
  reworkedCostAmount: roundMoney(asNumber(record.reworkedCostAmount)),
  reason: record.reason,
  note: record.note || null,
  status: record.status,
  beforeSnapshot: record.beforeSnapshot ? JSON.parse(record.beforeSnapshot) : null,
  afterSnapshot: record.afterSnapshot ? JSON.parse(record.afterSnapshot) : null,
  createdBy: Number(record.createdBy),
  creator: record.creator || null,
  createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
  updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt,
});

const assertIdenticalReplay = (record: any, input: CreateProductionDispositionInput) => {
  const same = Number(record.workOrderId) === Number(input.workOrderId)
    && record.dispositionType === input.type
    && roundQuantity(asNumber(record.quantity)) === roundQuantity(input.quantity)
    && normalizedText(record.reason) === normalizedText(input.reason)
    && normalizedText(record.note) === normalizedText(input.note)
    && (input.type === 'scrap'
      ? Number(record.stockBalanceId) === Number(input.stockBalanceId)
      : Number(record.sourceDispositionId) === Number(input.sourceDispositionId));
  if (!same) {
    throw new StockMovementConflictError('生产处置幂等键已用于不同业务事实，请生成新的 idempotencyKey。');
  }
};

const findExistingReplay = async (tx: TransactionClient, input: CreateProductionDispositionInput) => {
  const existing = await tx.productionDisposition.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: dispositionInclude,
  });
  if (!existing) return null;
  assertIdenticalReplay(existing, input);
  return mapDisposition(existing);
};

const loadCompletedWorkOrder = async (tx: TransactionClient, workOrderId: number) => {
  const workOrder = await tx.productionWorkOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, workOrderNo: true, batchId: true, status: true, productName: true },
  });
  if (!workOrder) throw new Error('PRODUCTION_DISPOSITION_WORK_ORDER_NOT_FOUND');
  if (workOrder.status !== 'completed') throw new Error('PRODUCTION_DISPOSITION_WORK_ORDER_NOT_COMPLETED');
  if (!workOrder.batchId) throw new Error('PRODUCTION_DISPOSITION_OUTPUT_BATCH_REQUIRED');
  return workOrder;
};

const loadBatchStock = async (tx: TransactionClient, batchId: number, stockBalanceId: number) => {
  const [batch, stock] = await Promise.all([
    tx.productBatch.findUnique({
      where: { id: batchId },
      select: { id: true, batchNo: true, productName: true, materialId: true, unit: true, stockQuantity: true, productionDate: true, expiryDate: true, isColdChain: true },
    }),
    tx.stockBalance.findUnique({
      where: { id: stockBalanceId },
      include: { location: { select: { id: true, code: true, name: true } } },
    }),
  ]);
  if (!batch) throw new Error('PRODUCTION_DISPOSITION_BATCH_NOT_FOUND');
  if (!stock) throw new Error('PRODUCTION_DISPOSITION_STOCK_BALANCE_NOT_FOUND');
  const sameMaterial = batch.materialId ? stock.materialId === batch.materialId : stock.productName === batch.productName;
  if (!sameMaterial || stock.batchNo !== batch.batchNo || stock.unit !== batch.unit) {
    throw new Error('PRODUCTION_DISPOSITION_STOCK_BATCH_MISMATCH');
  }
  return { batch, stock };
};

const loadBatchCarryingCost = async (tx: TransactionClient, batchId: number, expectedQuantity: number) => {
  const sums = await tx.inventoryCostLedger.aggregate({
    where: { batchId },
    _sum: { quantityDelta: true, costAmountDelta: true },
  });
  const quantity = roundQuantity(asNumber(sums._sum.quantityDelta));
  const costAmount = roundMoney(asNumber(sums._sum.costAmountDelta));
  if (Math.abs(quantity - expectedQuantity) > QUANTITY_TOLERANCE) {
    throw new StockMovementConflictError('PRODUCTION_DISPOSITION_COST_RECONCILIATION_REQUIRED');
  }
  return { quantity, costAmount };
};

const createAudit = async (tx: TransactionClient, actorId: number, record: any, operation: string) => {
  await tx.auditLog.create({
    data: {
      userId: actorId,
      action: operation,
      resource: 'production_disposition',
      resourceId: record.id,
      details: serialize({
        dispositionNo: record.dispositionNo,
        workOrderId: record.workOrderId,
        batchId: record.batchId,
        stockBalanceId: record.stockBalanceId,
        type: record.dispositionType,
        sourceDispositionId: record.sourceDispositionId,
        quantity: asNumber(record.quantity),
        unit: record.unit,
        costAmount: roundMoney(asNumber(record.costAmount)),
        idempotencyKey: record.idempotencyKey,
      }),
    },
  });
};

export class ProductionDispositionService {
  static async create(input: CreateProductionDispositionInput, actorId: number) {
    const normalized: CreateProductionDispositionInput = {
      ...input,
      quantity: roundQuantity(Number(input.quantity)),
      reason: normalizedText(input.reason),
      note: normalizedText(input.note) || null,
      idempotencyKey: normalizedText(input.idempotencyKey),
    };
    if (!Number.isSafeInteger(normalized.workOrderId) || normalized.workOrderId <= 0) throw new Error('PRODUCTION_DISPOSITION_WORK_ORDER_REQUIRED');
    if (!Number.isFinite(normalized.quantity) || normalized.quantity <= 0) throw new Error('PRODUCTION_DISPOSITION_QUANTITY_REQUIRED');
    if (!normalized.reason) throw new Error('PRODUCTION_DISPOSITION_REASON_REQUIRED');
    if (!normalized.idempotencyKey || normalized.idempotencyKey.length > 120) throw new Error('PRODUCTION_DISPOSITION_IDEMPOTENCY_KEY_REQUIRED');

    try {
      return await withDbRetry(() => prisma.$transaction(async tx => {
        const replay = await findExistingReplay(tx, normalized);
        if (replay) return replay;
        const workOrder = await loadCompletedWorkOrder(tx, normalized.workOrderId);
        const outputBatchId = Number(workOrder.batchId);

        if (normalized.type === 'scrap') {
          if (!Number.isSafeInteger(Number(normalized.stockBalanceId)) || Number(normalized.stockBalanceId) <= 0) {
            throw new Error('PRODUCTION_DISPOSITION_STOCK_BALANCE_REQUIRED');
          }
          const { batch, stock } = await loadBatchStock(tx, outputBatchId, Number(normalized.stockBalanceId));
          if (asNumber(stock.quantity) + QUANTITY_TOLERANCE < normalized.quantity) {
            throw new StockMovementConflictError('PRODUCTION_DISPOSITION_INSUFFICIENT_STOCK');
          }
          const carrying = await loadBatchCarryingCost(tx, batch.id, asNumber(batch.stockQuantity));
          const lossCost = Math.abs(prorateMoney(carrying.costAmount, normalized.quantity, carrying.quantity));
          const dispositionNo = buildBusinessNo('PDS');
          const stockEntry = await StockMovementService.postStockEntry({
            sourceType: 'production_scrap',
            sourceRef: dispositionNo,
            reason: normalized.reason,
            note: normalized.note || `Scrap disposition ${dispositionNo}`,
            createdBy: actorId,
            lines: [{
              locationId: stock.locationId,
              materialId: batch.materialId,
              productName: batch.productName,
              batchNo: batch.batchNo,
              quantityDelta: -normalized.quantity,
              unit: batch.unit,
              costAmountDelta: -lossCost,
            }],
          }, tx);
          const balance = stockEntry.balances[0] as any;
          const afterBatch = await tx.productBatch.findUniqueOrThrow({ where: { id: batch.id }, select: { stockQuantity: true } });
          const created = await tx.productionDisposition.create({
            data: {
              dispositionNo,
              idempotencyKey: normalized.idempotencyKey,
              workOrderId: workOrder.id,
              batchId: batch.id,
              stockBalanceId: Number(balance.id),
              dispositionType: 'scrap',
              quantity: normalized.quantity,
              unit: batch.unit,
              costAmount: lossCost,
              reason: normalized.reason,
              note: normalized.note,
              beforeSnapshot: serialize({ batchQuantity: asNumber(batch.stockQuantity), stockQuantity: asNumber(stock.quantity), carryingCost: carrying.costAmount }),
              afterSnapshot: serialize({ batchQuantity: asNumber(afterBatch.stockQuantity), stockQuantity: asNumber(balance.quantity), stockEntryNo: stockEntry.entry.entryNo }),
              status: 'posted',
              createdBy: actorId,
            },
            include: dispositionInclude,
          });
          await createAudit(tx, actorId, created, 'POST_PRODUCTION_SCRAP_DISPOSITION');
          return mapDisposition(created);
        }

        if (normalized.type !== 'rework_return') throw new Error('PRODUCTION_DISPOSITION_TYPE_INVALID');
        if (!Number.isSafeInteger(Number(normalized.sourceDispositionId)) || Number(normalized.sourceDispositionId) <= 0) {
          throw new Error('PRODUCTION_DISPOSITION_SOURCE_SCRAP_REQUIRED');
        }
        if (!Number.isSafeInteger(Number(normalized.destinationLocationId)) || Number(normalized.destinationLocationId) <= 0) {
          throw new Error('PRODUCTION_DISPOSITION_DESTINATION_LOCATION_REQUIRED');
        }
        const source = await tx.productionDisposition.findUnique({ where: { id: Number(normalized.sourceDispositionId) } });
        if (!source || source.dispositionType !== 'scrap' || source.status !== 'posted') {
          throw new Error('PRODUCTION_DISPOSITION_SOURCE_SCRAP_REQUIRED');
        }
        if (source.workOrderId !== workOrder.id) throw new Error('PRODUCTION_DISPOSITION_SOURCE_WORK_ORDER_MISMATCH');
        const sourceBatch = await tx.productBatch.findUnique({ where: { id: source.batchId } });
        if (!sourceBatch) throw new Error('PRODUCTION_DISPOSITION_SOURCE_BATCH_NOT_FOUND');
        const remainingQuantity = roundQuantity(asNumber(source.quantity) - asNumber(source.reworkedQuantity));
        const remainingCost = roundMoney(asNumber(source.costAmount) - asNumber(source.reworkedCostAmount));
        if (remainingQuantity + QUANTITY_TOLERANCE < normalized.quantity) {
          throw new StockMovementConflictError('PRODUCTION_DISPOSITION_REWORK_EXCEEDS_SCRAP');
        }
        const recoveredCost = Math.abs(Math.abs(remainingQuantity - normalized.quantity) <= QUANTITY_TOLERANCE
          ? remainingCost
          : prorateMoney(asNumber(source.costAmount), normalized.quantity, asNumber(source.quantity)));
        const claimed = await tx.productionDisposition.updateMany({
          where: {
            id: source.id,
            dispositionType: 'scrap',
            status: 'posted',
            reworkedQuantity: { lte: remainingQuantity - normalized.quantity + QUANTITY_TOLERANCE + asNumber(source.reworkedQuantity) },
            reworkedCostAmount: { lte: remainingCost - recoveredCost + 0.01 + asNumber(source.reworkedCostAmount) },
          },
          data: { reworkedQuantity: { increment: normalized.quantity }, reworkedCostAmount: { increment: recoveredCost } },
        });
        if (claimed.count !== 1) throw new StockMovementConflictError('PRODUCTION_DISPOSITION_SOURCE_CHANGED');

        const destination = await tx.location.findUnique({ where: { id: Number(normalized.destinationLocationId) }, select: { id: true, status: true } });
        if (!destination || destination.status !== 'active') throw new Error('PRODUCTION_DISPOSITION_DESTINATION_LOCATION_INVALID');
        const dispositionNo = buildBusinessNo('PDS');
        const reworkBatch = await tx.productBatch.create({
          data: {
            materialId: sourceBatch.materialId,
            batchNo: buildBusinessNo('RWK'),
            productName: sourceBatch.productName,
            productionDate: new Date(),
            expiryDate: sourceBatch.expiryDate,
            isColdChain: sourceBatch.isColdChain,
            stockQuantity: 0,
            qualityStatus: 'quarantined',
            unit: sourceBatch.unit,
            notes: `Rework return from scrap disposition ${source.dispositionNo}; QA release required before issue.`,
          },
        });
        const stockEntry = await StockMovementService.postStockEntry({
          sourceType: 'production_rework_return',
          sourceRef: dispositionNo,
          reason: normalized.reason,
          note: normalized.note || `Rework return from ${source.dispositionNo}`,
          createdBy: actorId,
          lines: [{
            locationId: destination.id,
            materialId: sourceBatch.materialId,
            productName: sourceBatch.productName,
            batchNo: reworkBatch.batchNo,
            quantityDelta: normalized.quantity,
            unit: sourceBatch.unit,
            costAmountDelta: recoveredCost,
          }],
        }, tx);
        const balance = stockEntry.balances[0] as any;
        const afterSource = await tx.productionDisposition.findUniqueOrThrow({ where: { id: source.id }, select: { reworkedQuantity: true, reworkedCostAmount: true } });
        const created = await tx.productionDisposition.create({
          data: {
            dispositionNo,
            idempotencyKey: normalized.idempotencyKey,
            workOrderId: workOrder.id,
            batchId: reworkBatch.id,
            stockBalanceId: Number(balance.id),
            dispositionType: 'rework_return',
            sourceDispositionId: source.id,
            quantity: normalized.quantity,
            unit: sourceBatch.unit,
            costAmount: recoveredCost,
            reason: normalized.reason,
            note: normalized.note,
            beforeSnapshot: serialize({ sourceDispositionNo: source.dispositionNo, sourceRemainingQuantity: remainingQuantity, sourceRemainingCost: remainingCost }),
            afterSnapshot: serialize({ reworkBatchNo: reworkBatch.batchNo, stockQuantity: asNumber(balance.quantity), qualityStatus: 'quarantined', stockEntryNo: stockEntry.entry.entryNo, sourceReworkedQuantity: asNumber(afterSource.reworkedQuantity), sourceReworkedCostAmount: roundMoney(asNumber(afterSource.reworkedCostAmount)) }),
            status: 'posted',
            createdBy: actorId,
          },
          include: dispositionInclude,
        });
        await createAudit(tx, actorId, created, 'POST_PRODUCTION_REWORK_RETURN');
        return mapDisposition(created);
      }), { label: 'production-disposition-post' });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const existing = await prisma.productionDisposition.findUnique({ where: { idempotencyKey: normalized.idempotencyKey }, include: dispositionInclude });
        if (existing) {
          assertIdenticalReplay(existing, normalized);
          return mapDisposition(existing);
        }
      }
      throw error;
    }
  }

  static async listByWorkOrder(workOrderId: number) {
    const rows = await prisma.productionDisposition.findMany({
      where: { workOrderId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: dispositionInclude,
    });
    return rows.map(mapDisposition);
  }
}
