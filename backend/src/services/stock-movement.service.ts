import prisma from '../config/database';
import { ProductionCostLedgerService } from './production-cost-ledger.service';
import { buildBusinessNo } from '../utils/businessNo';
import {
  findPostedEntryResult,
  normalizeDbNumber,
  normalizeId,
  normalizeNumber,
  normalizeOptionalNumber,
  normalizeText,
  resolveDirection,
  roundQuantity,
} from './stock-movement.helpers';
import { syncProductBatchForOperationalStock } from './stock-movement.product-batch-sync';
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
      const normalizedLines = input.lines.map(line => ({
        locationId: normalizeId(line.locationId, 'locationId'),
        productName: normalizeText(line.productName),
        batchNo: normalizeText(line.batchNo),
        quantityDelta: roundQuantity(normalizeNumber(line.quantityDelta, 'quantityDelta')),
        unit: normalizeText(line.unit || 'kg') || 'kg',
        unitCost: normalizeOptionalNumber(line.unitCost, 'unitCost'),
        costAmountDelta: normalizeOptionalNumber(line.costAmountDelta, 'costAmountDelta'),
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
      await tx.$executeRawUnsafe(
        `INSERT OR IGNORE INTO stock_entries
          (entry_no, source_type, source_ref, direction, status, warehouse_id, location_id, reason, note, created_by, created_at, posted_at)
         VALUES (?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        entryNo,
        input.sourceType,
        sourceRef,
        resolveDirection(normalizedLines),
        firstLocation.warehouseId,
        firstLocation.id,
        reason,
        note,
        input.createdBy || null,
      );

      const entries = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT
           id,
           entry_no AS entryNo,
           source_type AS sourceType,
           source_ref AS sourceRef,
           direction,
           status,
           warehouse_id AS warehouseId,
           location_id AS locationId,
           reason,
           note,
           created_by AS createdBy,
           created_at AS createdAt,
           posted_at AS postedAt
         FROM stock_entries
         WHERE entry_no = ?`,
        entryNo,
      );
      const entry = entries[0];
      if (!entry) {
        const existingAfterInsert = await findPostedEntryResult(tx, input.sourceType, sourceRef);
        if (existingAfterInsert) {
          return existingAfterInsert;
        }
        throw new Error(`Stock entry create failed: ${entryNo}`);
      }
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

        const existing = await tx.stockBalance.findUnique({
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
          if (line.quantityDelta < 0) {
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
                lastMoveAt: new Date(),
              },
            });
            if (updated.count !== 1) {
              throw new Error(`库存不足：${line.productName} / ${line.batchNo}，请先核对库存余额。`);
            }
            balance = await tx.stockBalance.findUnique({ where: { id: existing.id } });
          } else {
            balance = await tx.stockBalance.update({
              where: { id: existing.id },
              data: {
                quantity: { increment: line.quantityDelta },
                unit: line.unit,
                lastMoveAt: new Date(),
              },
            });
          }
        } else {
          if (line.quantityDelta < 0) {
            throw new Error(`库存不足：${line.productName} / ${line.batchNo}，请先核对库存余额。`);
          }
          try {
            balance = await tx.stockBalance.create({
              data: {
                locationId: line.locationId,
                productName: line.productName,
                batchNo: line.batchNo,
                quantity: line.quantityDelta,
                unit: line.unit,
                lastMoveAt: new Date(),
              },
            });
          } catch {
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

        await tx.$executeRawUnsafe(
          `INSERT INTO stock_movements
            (entry_id, stock_balance_id, location_id, product_name, batch_no, unit, quantity_before, quantity_delta, quantity_after, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          entryId,
          balance.id,
          line.locationId,
          line.productName,
          line.batchNo,
          line.unit,
          quantityBefore,
          line.quantityDelta,
          quantityAfter,
        );

        const latestMovements = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT
             id,
             entry_id AS entryId,
             stock_balance_id AS stockBalanceId,
             location_id AS locationId,
             product_name AS productName,
             batch_no AS batchNo,
             unit,
             quantity_before AS quantityBefore,
             quantity_delta AS quantityDelta,
             quantity_after AS quantityAfter,
             created_at AS createdAt
           FROM stock_movements
           WHERE entry_id = ? AND stock_balance_id = ?
           ORDER BY id DESC
           LIMIT 1`,
          entryId,
          balance.id,
        );

        movements.push(latestMovements[0]);
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
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.sourceType) {
      where.push('e.source_type = ?');
      params.push(String(filters.sourceType));
    }
    if (filters.sourceRef) {
      where.push('e.source_ref = ?');
      params.push(String(filters.sourceRef));
    }
    if (filters.productName) {
      where.push(`EXISTS (
        SELECT 1
        FROM stock_movements fm
        WHERE fm.entry_id = e.id
          AND fm.product_name LIKE ?
      )`);
      params.push(`%${String(filters.productName)}%`);
    }
    if (filters.batchNo) {
      where.push(`EXISTS (
        SELECT 1
        FROM stock_movements fm
        WHERE fm.entry_id = e.id
          AND fm.batch_no LIKE ?
      )`);
      params.push(`%${String(filters.batchNo)}%`);
    }
    if (Number.isFinite(filters.locationId)) {
      where.push(`EXISTS (
        SELECT 1
        FROM stock_movements fm
        WHERE fm.entry_id = e.id
          AND fm.location_id = ?
      )`);
      params.push(Number(filters.locationId));
    }
    if (Number.isFinite(filters.warehouseId)) {
      where.push(`EXISTS (
        SELECT 1
        FROM stock_movements fm
        JOIN locations fl ON fl.id = fm.location_id
        WHERE fm.entry_id = e.id
          AND fl.warehouse_id = ?
      )`);
      params.push(Number(filters.warehouseId));
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT
         e.id,
         e.entry_no AS entryNo,
         e.source_type AS sourceType,
         e.source_ref AS sourceRef,
         e.direction,
         e.status,
         e.reason,
         e.note,
         e.created_by AS createdBy,
         e.created_at AS createdAt,
         e.posted_at AS postedAt,
         e.warehouse_id AS warehouseId,
         e.location_id AS locationId,
         ew.code AS warehouseCode,
         ew.name AS warehouseName,
         el.code AS locationCode,
         el.name AS locationName,
         COUNT(m.id) AS movementCount,
         COALESCE(SUM(m.quantity_delta), 0) AS netQuantityDelta
       FROM stock_entries e
       LEFT JOIN stock_movements m ON m.entry_id = e.id
       LEFT JOIN warehouses ew ON ew.id = e.warehouse_id
       LEFT JOIN locations el ON el.id = e.location_id
       ${whereSql}
       GROUP BY e.id
       ORDER BY e.id DESC
       LIMIT ?`,
       ...params,
       safeLimit,
     );

    const entryIds = rows.map(row => normalizeDbNumber(row.id)).filter(id => id > 0);
    const movementRows = entryIds.length > 0
      ? await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT
             m.id,
             m.entry_id AS entryId,
             m.stock_balance_id AS stockBalanceId,
             m.location_id AS locationId,
             m.product_name AS productName,
             m.batch_no AS batchNo,
             m.unit,
             m.quantity_before AS quantityBefore,
             m.quantity_delta AS quantityDelta,
             m.quantity_after AS quantityAfter,
             m.created_at AS createdAt,
             l.code AS locationCode,
             l.name AS locationName,
             w.code AS warehouseCode,
             w.name AS warehouseName
           FROM stock_movements m
           LEFT JOIN locations l ON l.id = m.location_id
           LEFT JOIN warehouses w ON w.id = l.warehouse_id
           WHERE m.entry_id IN (${entryIds.map(() => '?').join(',')})
           ORDER BY m.id ASC`,
          ...entryIds,
        )
      : [];
    const movementsByEntryId = new Map<number, Array<Record<string, unknown>>>();
    for (const movement of movementRows) {
      const entryId = normalizeDbNumber(movement.entryId);
      const mapped = {
        ...movement,
        id: normalizeDbNumber(movement.id),
        entryId,
        stockBalanceId: normalizeDbNumber(movement.stockBalanceId),
        locationId: normalizeDbNumber(movement.locationId),
        quantityBefore: Number(movement.quantityBefore || 0),
        quantityDelta: Number(movement.quantityDelta || 0),
        quantityAfter: Number(movement.quantityAfter || 0),
        locationCode: movement.locationCode || '',
        locationName: movement.locationName || '',
        warehouseCode: movement.warehouseCode || '',
        warehouseName: movement.warehouseName || '',
      };
      const bucket = movementsByEntryId.get(entryId) || [];
      bucket.push(mapped);
      movementsByEntryId.set(entryId, bucket);
    }

    return rows.map(row => {
      const id = normalizeDbNumber(row.id);
      return {
      ...row,
      id,
      warehouseId: row.warehouseId == null ? null : normalizeDbNumber(row.warehouseId),
      locationId: row.locationId == null ? null : normalizeDbNumber(row.locationId),
      createdBy: row.createdBy == null ? null : normalizeDbNumber(row.createdBy),
      movementCount: normalizeDbNumber(row.movementCount),
      netQuantityDelta: Number(row.netQuantityDelta || 0),
      movements: movementsByEntryId.get(id) || [],
    };
    });
  }
}
