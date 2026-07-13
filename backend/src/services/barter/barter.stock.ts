import { StockMovementService, type StockMovementLineInput, type StockSourceType, type TransactionClient } from '../stock-movement.service';

const BARTER_RECEIPT_LOCATION_CODE = 'LOC-RAW';
const BARTER_ISSUE_LOCATION_CODE = 'LOC-FG';

const buildBarterStockSourceRef = (settlementId: number) => `BARTER-${settlementId}`;

const normalizeStockName = (value: unknown, fallback: string) => {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
};

type BarterStockItem = {
  id: number;
  side?: string | null;
  itemName?: string | null;
  sourceDocument?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
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
      sourceType: true,
      movements: {
        select: {
          locationId: true,
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
  const originalMovements = originalEntries.flatMap(entry =>
    entry.movements.map(movement => ({
      sourceType: entry.sourceType,
      locationId: movement.locationId,
      productName: movement.productName,
      batchNo: movement.batchNo,
      unit: movement.unit,
      quantityDelta: movement.quantityDelta,
    })),
  );

  if (originalMovements.length === 0) {
    return;
  }

  const groups: Record<string, Array<{
    locationId: number;
    productName: string;
    batchNo: string;
    quantityDelta: number;
    unit: string;
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
      productName: String(movement.productName || ''),
      batchNo: String(movement.batchNo || ''),
      quantityDelta: -Number(movement.quantityDelta || 0),
      unit: String(movement.unit || 'kg'),
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
