import { StockMovementService, type StockMovementLineInput, type StockSourceType, type TransactionClient } from '../stock-movement.service';
import { addMoney, prorateMoney, subtractMoney } from '../../utils/money';

const BARTER_RECEIPT_LOCATION_CODE = 'LOC-RAW';
const BARTER_ISSUE_LOCATION_CODE = 'LOC-FG';

const buildBarterStockSourceRef = (settlementId: number) => `BARTER-${settlementId}`;

const normalizeStockName = (value: unknown, fallback: string) => {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
};

type BarterStockItem = {
  id: number;
  materialId?: number | null;
  side?: string | null;
  itemName?: string | null;
  sourceDocument?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  marketValue?: number | null;
};

type BarterStockSettlement = {
  id: number;
  settlementNo: string;
  items?: BarterStockItem[] | null;
};

const resolveBarterLocationId = async (tx: TransactionClient, code: string) => {
  const location = await tx.location.findFirst({
    where: { code, status: 'active' },
    select: { id: true },
  });
  if (!location) {
    throw new Error(`Required barter stock location is missing: ${code}`);
  }
  return location.id;
};

const buildBarterStockLine = (
  item: BarterStockItem,
  locationId: number,
  quantityDelta: number,
  settlementId: number,
): StockMovementLineInput => ({
  locationId,
  materialId: item.materialId ?? null,
  productName: normalizeStockName(item.itemName, `barter-item-${item.id}`),
  batchNo: normalizeStockName(item.sourceDocument, `BARTER-${settlementId}-${String(item.side || 'item').toUpperCase()}-${item.id}`),
  quantityDelta,
  unit: normalizeStockName(item.unit, 'kg'),
});

export const postBarterStockEntries = async (
  settlement: BarterStockSettlement,
  tx: TransactionClient,
  postedBy: number,
) => {
  const sourceRef = buildBarterStockSourceRef(settlement.id);
  const issueLocationId = await resolveBarterLocationId(tx, BARTER_ISSUE_LOCATION_CODE);
  const receiptLocationId = await resolveBarterLocationId(tx, BARTER_RECEIPT_LOCATION_CODE);

  const issueLines = (settlement.items || [])
    .filter((item) => item.side === 'our' && Number(item.quantity || 0) > 0)
    .map((item) => buildBarterStockLine(item, issueLocationId, -Math.abs(Number(item.quantity || 0)), settlement.id));

  const receiptLines = (settlement.items || [])
    .filter((item) => item.side === 'counterparty' && Number(item.quantity || 0) > 0)
    .map((item) => buildBarterStockLine(item, receiptLocationId, Math.abs(Number(item.quantity || 0)), settlement.id));

  if (issueLines.length > 0) {
    await StockMovementService.postStockEntry({
      sourceType: 'barter_issue',
      sourceRef,
      reason: 'barter_settlement_posted',
      note: `Barter settlement posted: ${settlement.settlementNo}`,
      createdBy: postedBy,
      lines: issueLines,
    }, tx);
  }

  if (receiptLines.length > 0) {
    const receiptItems = (settlement.items || []).filter(item => item.side === 'counterparty' && Number(item.quantity || 0) > 0);
    receiptLines.forEach((line, index) => {
      const value = receiptItems[index].marketValue;
      if (value == null || !Number.isFinite(value) || value < 0) throw new Error('Barter receipt requires an approved valuation');
      line.costAmountDelta = value;
    });
    await StockMovementService.postStockEntry({
      sourceType: 'barter_receipt',
      sourceRef,
      reason: 'barter_settlement_posted',
      note: `Barter settlement posted: ${settlement.settlementNo}`,
      createdBy: postedBy,
      lines: receiptLines,
    }, tx);
  }
};

export const allocateBarterReversalCosts = (quantities: number[], originalCost: number): number[] => {
  const total = quantities.reduce((sum, quantity) => sum + Math.abs(quantity), 0);
  if (!total) throw new Error('Cannot reverse a zero-quantity barter valuation');
  let remaining = subtractMoney(0, originalCost);
  return quantities.map((quantity, index) => {
    const amount = index === quantities.length - 1 ? remaining : prorateMoney(-originalCost, Math.abs(quantity), total);
    remaining = subtractMoney(remaining, amount);
    return amount;
  });
};

export const postBarterStockReversalEntries = async (
  settlement: { id: number; settlementNo: string },
  tx: TransactionClient,
  reversedBy: number,
  reason: string,
) => {
  const sourceRef = buildBarterStockSourceRef(settlement.id);
  const originalEntries = await tx.stockEntry.findMany({
    where: {
      sourceRef,
      sourceType: { in: ['barter_receipt', 'barter_issue'] },
      status: 'posted',
    },
    select: {
      entryNo: true,
      sourceType: true,
      movements: {
        select: {
          locationId: true,
          materialId: true,
          productName: true,
          batchNo: true,
          unit: true,
          quantityDelta: true,
        },
        orderBy: { id: 'asc' },
      },
    },
    orderBy: { id: 'asc' },
  });
  const originalMovements: Array<typeof originalEntries[number]['movements'][number] & { sourceType: string; reversalCost: number }> = [];
  for (const entry of originalEntries) {
    for (const batchNo of new Set(entry.movements.map(movement => movement.batchNo))) {
      const movements = entry.movements.filter(movement => movement.batchNo === batchNo);
      const batch = await tx.productBatch.findUnique({ where: { batchNo }, select: { id: true } });
      const valuation = batch ? await tx.inventoryCostLedger.findMany({
        where: { batchId: batch.id, sourceRef: entry.entryNo },
        select: { quantityDelta: true, costAmountDelta: true },
      }) : [];
      const originalQuantity = movements.reduce((sum, movement) => sum + movement.quantityDelta, 0);
      const valuedQuantity = valuation.reduce((sum, row) => sum + row.quantityDelta, 0);
      // Historical postings without cost evidence need an explicit reconciliation,
      // not a fabricated reversal using today's unit cost.
      if (!valuation.length || Math.abs(originalQuantity - valuedQuantity) > 0.000001) {
        throw new Error(`BARTER_COST_REVERSAL_REQUIRES_RECONCILIATION:${entry.entryNo}:${batchNo}`);
      }
      const costs = allocateBarterReversalCosts(movements.map(movement => movement.quantityDelta), addMoney(...valuation.map(row => row.costAmountDelta)));
      movements.forEach((movement, index) => originalMovements.push({ ...movement, sourceType: entry.sourceType, reversalCost: costs[index] }));
    }
  }

  if (originalMovements.length === 0) {
    return;
  }

  const groups: Record<string, Array<{
    locationId: number;
    materialId: number | null;
    productName: string;
    batchNo: string;
    quantityDelta: number;
    unit: string;
    costAmountDelta: number;
  }>> = {};

  for (const movement of originalMovements) {
    const originalType = String(movement.sourceType || '');
    const reversalType: StockSourceType = originalType === 'barter_receipt'
      ? 'barter_receipt_reversal'
      : 'barter_issue_reversal';
    if (!groups[reversalType]) {
      groups[reversalType] = [];
    }
    groups[reversalType].push({
      locationId: Number(movement.locationId),
      materialId: movement.materialId == null ? null : Number(movement.materialId),
      productName: String(movement.productName || ''),
      batchNo: String(movement.batchNo || ''),
      quantityDelta: -Number(movement.quantityDelta || 0),
      unit: String(movement.unit || 'kg'),
      costAmountDelta: movement.reversalCost,
    });
  }

  for (const [sourceType, lines] of Object.entries(groups)) {
    await StockMovementService.postStockEntry({
      sourceType: sourceType as StockSourceType,
      sourceRef: `${sourceRef}-REV`,
      reason: 'barter_settlement_reversed',
      note: `Barter settlement reversed: ${settlement.settlementNo}; ${reason}`,
      createdBy: reversedBy,
      lines,
    }, tx);
  }
};
