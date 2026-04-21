import { IDEMPOTENT_SOURCE_TYPES } from './stock-movement.policy';
import type {
  StockEntryResult,
  StockMovementLineInput,
  StockSourceType,
  TransactionClient,
} from './stock-movement.types';

export const normalizeText = (value: unknown) => String(value ?? '').trim();

export const normalizeNumber = (value: unknown, label: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number`);
  }
  return parsed;
};

export const roundQuantity = (value: number, precision = 6) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

export const normalizeId = (value: unknown, label: string) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
};

export const normalizeDbNumber = (value: unknown) =>
  typeof value === 'bigint' ? Number(value) : Number(value || 0);

export const normalizeOptionalNumber = (value: unknown, label: string) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number`);
  }
  return parsed;
};

export const resolveDirection = (lines: StockMovementLineInput[]) => {
  const hasInbound = lines.some(line => line.quantityDelta > 0);
  const hasOutbound = lines.some(line => line.quantityDelta < 0);
  if (hasInbound && hasOutbound) return 'adjustment';
  if (hasOutbound) return 'outbound';
  return 'inbound';
};

const mapEntryRow = (entry: Record<string, unknown>) => ({
  ...entry,
  id: normalizeDbNumber(entry.id),
  warehouseId: entry.warehouseId == null ? null : normalizeDbNumber(entry.warehouseId),
  locationId: entry.locationId == null ? null : normalizeDbNumber(entry.locationId),
  createdBy: entry.createdBy == null ? null : normalizeDbNumber(entry.createdBy),
});

export const loadStockEntryResult = async (
  tx: TransactionClient,
  entry: Record<string, unknown>,
): Promise<StockEntryResult> => {
  const entryId = normalizeDbNumber(entry.id);
  const movementRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
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
     WHERE entry_id = ?
     ORDER BY id ASC`,
    entryId,
  );

  const movements = movementRows.map((movement) => ({
    ...movement,
    id: normalizeDbNumber(movement.id),
    entryId: normalizeDbNumber(movement.entryId),
    stockBalanceId: movement.stockBalanceId == null ? null : normalizeDbNumber(movement.stockBalanceId),
    locationId: normalizeDbNumber(movement.locationId),
    quantityBefore: Number(movement.quantityBefore || 0),
    quantityDelta: Number(movement.quantityDelta || 0),
    quantityAfter: Number(movement.quantityAfter || 0),
  }));

  const balanceIds = Array.from(new Set(
    movements
      .map((movement) => Number(movement.stockBalanceId || 0))
      .filter((id) => id > 0),
  ));
  const balances = balanceIds.length > 0
    ? await tx.stockBalance.findMany({ where: { id: { in: balanceIds } } })
    : [];

  return {
    entry: mapEntryRow(entry),
    movements,
    balances: balances.map((balance) => ({
      ...balance,
      quantity: Number(balance.quantity || 0),
    })),
  };
};

export const findPostedEntryResult = async (
  tx: TransactionClient,
  sourceType: string,
  sourceRef?: string | null,
): Promise<StockEntryResult | null> => {
  const normalizedSourceRef = normalizeText(sourceRef);
  if (!IDEMPOTENT_SOURCE_TYPES.has(sourceType as StockSourceType)) return null;
  if (!normalizedSourceRef) return null;

  const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
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
     WHERE source_type = ?
       AND source_ref = ?
       AND status = 'posted'
     ORDER BY id ASC
     LIMIT 1`,
    sourceType,
    normalizedSourceRef,
  );

  return rows[0] ? loadStockEntryResult(tx, rows[0]) : null;
};
