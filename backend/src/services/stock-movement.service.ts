import prisma from '../config/database';
import { ProductionCostLedgerService } from './production-cost-ledger.service';
import { buildBusinessNo } from '../utils/businessNo';
import {
  assertIdempotentReplayMatches,
  findPostedEntryResult,
  normalizeDbNumber,
  normalizeId,
  normalizeNumber,
  normalizeOptionalNumber,
  normalizeText,
  resolveDirection,
  roundQuantity,
} from './stock-movement.helpers';
import { StockMovementConflictError } from './stock-movement.errors';
import { syncProductBatchForOperationalStock } from './stock-movement.product-batch-sync';
import { resolveStockMaterialIdentity } from './stock-movement.material-identity';
import type {
  PostStockEntryInput,
  StockEntryListFilters,
  StockEntryResult,
  StockMovementLineInput,
  StockSourceType,
  TransactionClient,
} from './stock-movement.types';

export type {
  PostStockEntryInput,
  StockEntryListFilters,
  StockEntryResult,
  StockMovementLineInput,
  StockSourceType,
  TransactionClient,
} from './stock-movement.types';

export class StockMovementService {
  static async postStockEntry(input: PostStockEntryInput, txClient?: TransactionClient): Promise<StockEntryResult> {
    const runner = async (tx: TransactionClient): Promise<StockEntryResult> => {
      const sourceRef = normalizeText(input.sourceRef) || null;
      const reason = normalizeText(input.reason) || null;
      const note = normalizeText(input.note) || null;
      const normalizedLines = await Promise.all(input.lines.map(async line => {
        const identity = await resolveStockMaterialIdentity(tx, line);
        return {
          locationId: normalizeId(line.locationId, 'locationId'),
          materialId: identity.materialId,
          shelfLifeDays: identity.shelfLifeDays,
          productName: identity.productName,
          batchNo: normalizeText(line.batchNo),
          quantityDelta: roundQuantity(normalizeNumber(line.quantityDelta, 'quantityDelta')),
          unit: identity.unit,
          unitCost: normalizeOptionalNumber(line.unitCost, 'unitCost'),
          costAmountDelta: normalizeOptionalNumber(line.costAmountDelta, 'costAmountDelta'),
          expectedQuantityBefore: normalizeOptionalNumber(line.expectedQuantityBefore, 'expectedQuantityBefore'),
        };
      }));

      if (input.sourceType === 'warehouse_manual_inbound' && (!sourceRef || !reason)) {
        throw new Error('应急补录必须填写来源单号和补录原因。');
      }

      if (normalizedLines.length === 0) {
        throw new Error('Stock entry requires at least one movement line');
      }

      for (const line of normalizedLines) {
        if (!line.productName || !line.batchNo) {
          throw new Error('Stock movement requires product name and batch number');
        }
        if (line.quantityDelta === 0) {
          throw new Error('Stock movement quantity delta cannot be zero');
        }
      }

      const existingPostedEntry = await findPostedEntryResult(tx, input.sourceType, sourceRef);
      if (existingPostedEntry) {
        assertIdempotentReplayMatches(existingPostedEntry, normalizedLines);
        return existingPostedEntry;
      }

      const firstLocation = await tx.location.findUnique({
        where: { id: normalizedLines[0].locationId },
        select: { id: true, warehouseId: true },
      });
      if (!firstLocation) {
        throw new Error(`Location not found: ${normalizedLines[0].locationId}`);
      }

      const entryNo = buildBusinessNo('STK');
      let createdEntry;
      try {
        createdEntry = await tx.stockEntry.create({
          data: {
            entryNo,
            sourceType: input.sourceType,
            sourceRef,
            direction: resolveDirection(normalizedLines),
            status: 'posted',
            warehouseId: firstLocation.warehouseId,
            locationId: firstLocation.id,
            reason,
            note,
            createdBy: input.createdBy || null,
            postedAt: new Date(),
          },
        });
      } catch (error) {
        const existingAfterInsert = await findPostedEntryResult(tx, input.sourceType, sourceRef);
        if (existingAfterInsert) {
          assertIdempotentReplayMatches(existingAfterInsert, normalizedLines);
          return existingAfterInsert;
        }
        throw error;
      }
      const entry: Record<string, unknown> = {
        id: createdEntry.id,
        entryNo: createdEntry.entryNo,
        sourceType: createdEntry.sourceType,
        sourceRef: createdEntry.sourceRef,
        direction: createdEntry.direction,
        status: createdEntry.status,
        warehouseId: createdEntry.warehouseId,
        locationId: createdEntry.locationId,
        reason: createdEntry.reason,
        note: createdEntry.note,
        createdBy: createdEntry.createdBy,
        createdAt: createdEntry.createdAt,
        postedAt: createdEntry.postedAt,
      };
      const entryId = normalizeDbNumber(entry.id);

      const movements: Record<string, unknown>[] = [];
      const balances: Record<string, unknown>[] = [];

      for (const line of normalizedLines) {
        const location = await tx.location.findUnique({
          where: { id: line.locationId },
          select: { id: true },
        });
        if (!location) {
          throw new Error(`Location not found: ${line.locationId}`);
        }

        const existing = line.materialId
          ? await tx.stockBalance.findUnique({
            where: {
              locationId_materialId_batchNo: {
                locationId: line.locationId,
                materialId: line.materialId,
                batchNo: line.batchNo,
              },
            },
          })
          : await tx.stockBalance.findUnique({
            where: {
              locationId_productName_batchNo: {
                locationId: line.locationId,
                productName: line.productName,
                batchNo: line.batchNo,
              },
            },
          });

        let balance;
        if (existing) {
          if (line.expectedQuantityBefore !== null) {
            const tolerance = 0.000001;
            const expectedQuantity = line.expectedQuantityBefore;
            const nextQuantity = expectedQuantity + line.quantityDelta;
            if (nextQuantity < -tolerance) {
              throw new StockMovementConflictError(`调整后库存不能小于 0：${line.productName} / ${line.batchNo}`);
            }
            const updated = await tx.stockBalance.updateMany({
              where: {
                id: existing.id,
                quantity: {
                  gte: expectedQuantity - tolerance,
                  lte: expectedQuantity + tolerance,
                },
              },
              data: {
                quantity: { increment: line.quantityDelta },
                unit: line.unit,
                materialId: line.materialId,
                lastMoveAt: new Date(),
              },
            });
            if (updated.count !== 1) {
              throw new StockMovementConflictError(`库存已被其他操作更新：${line.productName} / ${line.batchNo}，请刷新后重试。`);
            }
            balance = await tx.stockBalance.findUnique({ where: { id: existing.id } });
          } else if (line.quantityDelta < 0) {
            const requestedDecrease = Math.abs(line.quantityDelta);
            const availableQuantity = Number(existing.quantity || 0);
            const tolerance = 0.000001;
            const safeDecrease = availableQuantity + tolerance < requestedDecrease
              ? requestedDecrease
              : Math.min(requestedDecrease, availableQuantity);
            const updated = await tx.stockBalance.updateMany({
              where: {
                id: existing.id,
                quantity: { gte: requestedDecrease - tolerance },
              },
              data: {
                quantity: { decrement: safeDecrease },
                unit: line.unit,
                materialId: line.materialId,
                lastMoveAt: new Date(),
              },
            });
            if (updated.count !== 1) {
              throw new StockMovementConflictError(`库存不足或已被其他操作更新：${line.productName} / ${line.batchNo}，请刷新后重试。`);
            }
            balance = await tx.stockBalance.findUnique({ where: { id: existing.id } });
          } else {
            balance = await tx.stockBalance.update({
              where: { id: existing.id },
              data: {
                quantity: { increment: line.quantityDelta },
                unit: line.unit,
                materialId: line.materialId,
                lastMoveAt: new Date(),
              },
            });
          }
        } else {
          if (line.expectedQuantityBefore !== null && Math.abs(line.expectedQuantityBefore) > 0.000001) {
            throw new StockMovementConflictError(`库存记录已变化：${line.productName} / ${line.batchNo}，请刷新后重试。`);
          }
          if (line.quantityDelta < 0) {
            throw new StockMovementConflictError(`库存不足：${line.productName} / ${line.batchNo}，请刷新后重试。`);
          }
          try {
            balance = await tx.stockBalance.create({
              data: {
                locationId: line.locationId,
                materialId: line.materialId,
                productName: line.productName,
                batchNo: line.batchNo,
                quantity: line.quantityDelta,
                unit: line.unit,
                lastMoveAt: new Date(),
              },
            });
          } catch (error) {
            if ((error as { code?: string })?.code !== 'P2002') {
              throw error;
            }
            if (line.materialId) {
              const concurrent = await tx.stockBalance.findUnique({
                where: {
                  locationId_materialId_batchNo: {
                    locationId: line.locationId,
                    materialId: line.materialId,
                    batchNo: line.batchNo,
                  },
                },
              });
              if (!concurrent) {
                throw new StockMovementConflictError(
                  `Legacy stock identity conflicts with material master: ${line.productName} / ${line.batchNo}`,
                );
              }
              balance = await tx.stockBalance.update({
                where: { id: concurrent.id },
                data: {
                  quantity: { increment: line.quantityDelta },
                  unit: line.unit,
                  lastMoveAt: new Date(),
                },
              });
            } else {
              balance = await tx.stockBalance.update({
                where: {
                  locationId_productName_batchNo: {
                    locationId: line.locationId,
                    productName: line.productName,
                    batchNo: line.batchNo,
                  },
                },
                data: {
                  quantity: { increment: line.quantityDelta },
                  unit: line.unit,
                  lastMoveAt: new Date(),
                },
              });
            }
          }
        }

        if (!balance) {
          throw new Error(`Stock balance update failed for ${line.productName} / ${line.batchNo}`);
        }

        const batchSync = await syncProductBatchForOperationalStock(tx, input.sourceType, line);
        const explicitCostAmountDelta = line.costAmountDelta ?? (
          line.unitCost === null ? null : line.quantityDelta * line.unitCost
        );

        if (batchSync && explicitCostAmountDelta !== null && input.createdBy) {
          await ProductionCostLedgerService.recordInventoryMovement(tx, {
            batchId: batchSync.batchId,
            sourceRef: String(entry.entryNo || entryNo),
            quantityBefore: batchSync.quantityBefore,
            quantityDelta: line.quantityDelta,
            quantityAfter: batchSync.quantityAfter,
            costAmountDelta: explicitCostAmountDelta,
            note: input.note || `Stock valuation from ${input.sourceType}`,
            createdBy: input.createdBy,
          });
        }

        const quantityAfter = Number(balance.quantity || 0);
        const quantityBefore = quantityAfter - line.quantityDelta;

        const createdMovement = await tx.stockMovement.create({
          data: {
            entryId,
            stockBalanceId: balance.id,
            locationId: line.locationId,
            materialId: line.materialId,
            productName: line.productName,
            batchNo: line.batchNo,
            unit: line.unit,
            quantityBefore,
            quantityDelta: line.quantityDelta,
            quantityAfter,
          },
        });

        movements.push({
          ...createdMovement,
          quantityBefore: Number(createdMovement.quantityBefore || 0),
          quantityDelta: Number(createdMovement.quantityDelta || 0),
          quantityAfter: Number(createdMovement.quantityAfter || 0),
        });
        balances.push({
          ...balance,
          quantity: Number(balance.quantity || 0),
        });
      }

      return { entry, movements, balances };
    };

    if (txClient) {
      return runner(txClient);
    }

    return prisma.$transaction(runner);
  }

  static async listRecentEntries(limit = 50, filters: StockEntryListFilters = {}) {
    const safeLimit = Math.min(200, Math.max(1, Math.floor(Number(limit) || 50)));
    const where: Record<string, unknown> = {};
    const movementFilters: Record<string, unknown>[] = [];

    if (filters.sourceType) {
      where.sourceType = String(filters.sourceType);
    }
    if (filters.sourceRef) {
      where.sourceRef = String(filters.sourceRef);
    }
    if (filters.productName) {
      movementFilters.push({ productName: { contains: String(filters.productName) } });
    }
    if (filters.batchNo) {
      movementFilters.push({ batchNo: { contains: String(filters.batchNo) } });
    }
    if (Number.isFinite(filters.locationId)) {
      movementFilters.push({ locationId: Number(filters.locationId) });
    }
    if (Number.isFinite(filters.warehouseId)) {
      movementFilters.push({ location: { warehouseId: Number(filters.warehouseId) } });
    }

    if (movementFilters.length > 0) {
      where.movements = { some: movementFilters.length === 1 ? movementFilters[0] : { AND: movementFilters } };
    }

    const rows = await prisma.stockEntry.findMany({
      where,
      orderBy: { id: 'desc' },
      take: safeLimit,
      include: {
        warehouse: { select: { code: true, name: true } },
        location: { select: { code: true, name: true } },
        movements: {
          orderBy: { id: 'asc' },
          include: {
            location: {
              select: {
                code: true,
                name: true,
                warehouse: { select: { code: true, name: true } },
              },
            },
          },
        },
      },
    });

    const movementsByEntryId = new Map<number, Array<Record<string, unknown>>>();
    for (const row of rows) {
      for (const movement of row.movements) {
        const entryId = normalizeDbNumber(movement.entryId);
        const mapped = {
          ...movement,
          id: normalizeDbNumber(movement.id),
          entryId,
          stockBalanceId: movement.stockBalanceId == null ? null : normalizeDbNumber(movement.stockBalanceId),
          locationId: normalizeDbNumber(movement.locationId),
          materialId: movement.materialId == null ? null : normalizeDbNumber(movement.materialId),
          quantityBefore: Number(movement.quantityBefore || 0),
          quantityDelta: Number(movement.quantityDelta || 0),
          quantityAfter: Number(movement.quantityAfter || 0),
          locationCode: movement.location?.code || '',
          locationName: movement.location?.name || '',
          warehouseCode: movement.location?.warehouse?.code || '',
          warehouseName: movement.location?.warehouse?.name || '',
        };
        const bucket = movementsByEntryId.get(entryId) || [];
        bucket.push(mapped);
        movementsByEntryId.set(entryId, bucket);
      }
    }

    return rows.map(row => {
      const id = normalizeDbNumber(row.id);
      const movements = movementsByEntryId.get(id) || [];
      return {
        id,
        entryNo: row.entryNo,
        sourceType: row.sourceType,
        sourceRef: row.sourceRef,
        direction: row.direction,
        status: row.status,
        reason: row.reason,
        note: row.note,
        createdAt: row.createdAt,
        postedAt: row.postedAt,
        warehouseId: row.warehouseId == null ? null : normalizeDbNumber(row.warehouseId),
        locationId: row.locationId == null ? null : normalizeDbNumber(row.locationId),
        createdBy: row.createdBy == null ? null : normalizeDbNumber(row.createdBy),
        warehouseCode: row.warehouse?.code || '',
        warehouseName: row.warehouse?.name || '',
        locationCode: row.location?.code || '',
        locationName: row.location?.name || '',
        movementCount: movements.length,
        netQuantityDelta: movements.reduce((sum, movement) => sum + Number(movement.quantityDelta || 0), 0),
        movements,
      };
    });
  }
}
