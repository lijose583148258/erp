import { AppError, ErrorCode } from '../middleware/errorHandler';
import { buildBusinessNo } from '../utils/businessNo';
import { ReceiptDiscrepancyService } from './receipt-discrepancy.service';
import { StockMovementService, type TransactionClient } from './stock-movement.service';
import {
  getSupplierDisplayName,
  resolveReceiptCostAmount,
  resolveReceiptUnitCost,
} from './procurement-domain.service';

export const PARTIAL_RECEIPT_ERROR = 'PARTIAL_RECEIPT_REQUIRES_RECEIPT_ENDPOINT';
export const PARTIAL_RECEIPT_MESSAGE = '采购单已有部分收货，必须继续通过分批收货接口处理剩余数量';

type PurchaseOrderForReceipt = {
  id: number;
  supplierId?: number | null;
  supplier?: Record<string, unknown> | null;
  salesOrder?: Record<string, unknown> | null;
  quantity?: number | null;
  unit?: string | null;
  item: string;
  price?: number | null;
  landedCostAmount?: number | null;
  landedUnitCost?: number | null;
};

type PurchaseReceiptRow = {
  id?: unknown;
  receiptNo?: unknown;
  purchaseOrderId?: unknown;
  quantity?: unknown;
  acceptedQuantity?: unknown;
  rejectedQuantity?: unknown;
  unit?: unknown;
  batchNo?: unknown;
  stockEntryRef?: unknown;
  discrepancyReason?: unknown;
  note?: unknown;
  receivedBy?: unknown;
  receivedAt?: unknown;
  createdAt?: unknown;
};

type PurchaseReceiptTotalsRow = {
  processedQuantity?: unknown;
  acceptedQuantity?: unknown;
  rejectedQuantity?: unknown;
  receiptCount?: unknown;
};

export interface CreatePurchaseReceiptBatchInput {
  purchaseOrderId: number;
  quantity: unknown;
  acceptedQuantity?: unknown;
  rejectedQuantity?: unknown;
  batchNo?: unknown;
  receivedAt?: unknown;
  discrepancyReason?: unknown;
  discrepancyType?: unknown;
  note?: unknown;
  createdBy?: number | null;
}

function toFiniteReceiptNumber(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AppError(
      'PURCHASE_RECEIPT_INVALID_QUANTITY',
      400,
      ErrorCode.VALIDATION_ERROR,
      { field: label, value },
    );
  }
  return parsed;
}

function normalizeReceiptQuantities(input: CreatePurchaseReceiptBatchInput) {
  const inputQuantity = toFiniteReceiptNumber(input.quantity || 0, 'quantity');
  const acceptedQuantity = toFiniteReceiptNumber(input.acceptedQuantity ?? inputQuantity, 'acceptedQuantity');
  const rejectedQuantity = toFiniteReceiptNumber(input.rejectedQuantity ?? 0, 'rejectedQuantity');

  if (inputQuantity <= 0 || acceptedQuantity < 0 || rejectedQuantity < 0) {
    throw new AppError(
      'PURCHASE_RECEIPT_INVALID_QUANTITY',
      400,
      ErrorCode.VALIDATION_ERROR,
      { inputQuantity, acceptedQuantity, rejectedQuantity },
    );
  }

  if (Math.abs((acceptedQuantity + rejectedQuantity) - inputQuantity) > 0.000001) {
    throw new AppError(
      'PURCHASE_RECEIPT_QUANTITY_MISMATCH',
      400,
      ErrorCode.VALIDATION_ERROR,
      { inputQuantity, acceptedQuantity, rejectedQuantity },
    );
  }

  return { inputQuantity, acceptedQuantity, rejectedQuantity };
}

function normalizeReceiptDate(value: unknown) {
  if (!value) return new Date();
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new AppError('PURCHASE_RECEIPT_INVALID_DATE', 400, ErrorCode.VALIDATION_ERROR);
  }
  return date;
}

function toOptionalReceiptText(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

async function claimPurchaseReceiptWrite(tx: TransactionClient, purchaseOrderId: number) {
  const normalizedId = Number(purchaseOrderId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    throw new AppError('PURCHASE_ORDER_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
  }

  // Make the first operation a write so concurrent partial receipts serialize before remaining quantity is calculated.
  const claim = await tx.purchaseOrder.updateMany({
    where: { id: normalizedId },
    data: { updatedAt: new Date() },
  });
  if (claim.count !== 1) {
    throw new AppError('PURCHASE_ORDER_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
  }

  const order = await tx.purchaseOrder.findUnique({
    where: { id: normalizedId },
    include: { supplier: true, salesOrder: true },
  });
  if (!order) {
    throw new AppError('PURCHASE_ORDER_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
  }
  return order;
}

export function createPartialReceiptError() {
  return new AppError(PARTIAL_RECEIPT_ERROR, 409, ErrorCode.CONFLICT);
}

export async function resolveProcurementReceiptLocationId(tx: TransactionClient) {
  const rawLocation = await tx.location.findFirst({
    where: { code: 'LOC-RAW', status: 'active' },
    select: { id: true },
  });
  if (rawLocation) return rawLocation.id;

  const fallbackLocation = await tx.location.findFirst({
    where: { type: 'internal', status: 'active' },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  if (fallbackLocation) return fallbackLocation.id;

  throw new Error('Procurement receipt location is not configured');
}

export async function postProcurementReceiptIfMissing(
  tx: TransactionClient,
  order: PurchaseOrderForReceipt,
  createdBy?: number | null,
) {
  const sourceRef = `PO-${order.id}`;
  const existingReceipt = await tx.stockEntry.findFirst({
    where: {
      sourceType: 'procurement_receipt',
      sourceRef,
      status: 'posted',
    },
    select: { id: true },
  });

  if (existingReceipt) {
    return { posted: false, sourceRef };
  }

  const receiptLocationId = await resolveProcurementReceiptLocationId(tx);
  const receiptNo = buildBusinessNo('PRC');
  await tx.$executeRawUnsafe(
    `INSERT INTO purchase_receipts
      (receipt_no, purchase_order_id, quantity, accepted_quantity, rejected_quantity, unit, batch_no, stock_entry_ref, note, received_by, received_at, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    receiptNo,
    Number(order.id),
    Number(order.quantity || 0),
    Number(order.quantity || 0),
    order.unit || 'kg',
    sourceRef,
    sourceRef,
    'Full receipt created from legacy status transition',
    createdBy || null,
  );
  await StockMovementService.postStockEntry({
    sourceType: 'procurement_receipt',
    sourceRef,
    reason: 'purchase_order_received',
    note: `Purchase order received: ${sourceRef}`,
    createdBy: createdBy || null,
    lines: [{
      locationId: receiptLocationId,
      productName: order.item,
      batchNo: sourceRef,
      quantityDelta: Number(order.quantity || 0),
      unit: order.unit || 'kg',
      unitCost: resolveReceiptUnitCost(order),
      costAmountDelta: resolveReceiptCostAmount(order, Number(order.quantity || 0)),
    }],
  }, tx);

  return { posted: true, sourceRef };
}

function normalizeReceiptRow(row: PurchaseReceiptRow) {
  return {
    id: Number(row.id),
    receiptNo: String(row.receiptNo || ''),
    purchaseOrderId: Number(row.purchaseOrderId),
    quantity: Number(row.quantity || 0),
    acceptedQuantity: Number(row.acceptedQuantity || 0),
    rejectedQuantity: Number(row.rejectedQuantity || 0),
    unit: String(row.unit || 'kg'),
    batchNo: row.batchNo ? String(row.batchNo) : null,
    stockEntryRef: row.stockEntryRef ? String(row.stockEntryRef) : null,
    discrepancyReason: row.discrepancyReason ? String(row.discrepancyReason) : null,
    note: row.note ? String(row.note) : null,
    receivedBy: row.receivedBy == null ? null : Number(row.receivedBy),
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
  };
}

export async function listPurchaseReceipts(tx: TransactionClient, purchaseOrderId: number) {
  const rows = await tx.$queryRawUnsafe<PurchaseReceiptRow[]>(
    `SELECT
       id,
       receipt_no AS receiptNo,
       purchase_order_id AS purchaseOrderId,
       quantity,
       accepted_quantity AS acceptedQuantity,
       rejected_quantity AS rejectedQuantity,
       unit,
       batch_no AS batchNo,
       stock_entry_ref AS stockEntryRef,
       discrepancy_reason AS discrepancyReason,
       note,
       received_by AS receivedBy,
       received_at AS receivedAt,
       created_at AS createdAt
     FROM purchase_receipts
     WHERE purchase_order_id = ?
     ORDER BY id ASC`,
    purchaseOrderId,
  );
  return rows.map(normalizeReceiptRow);
}

export async function getPurchaseReceiptTotals(tx: TransactionClient, purchaseOrderId: number) {
  const rows = await tx.$queryRawUnsafe<PurchaseReceiptTotalsRow[]>(
    `SELECT
       COALESCE(SUM(quantity), 0) AS processedQuantity,
       COALESCE(SUM(accepted_quantity), 0) AS acceptedQuantity,
       COALESCE(SUM(rejected_quantity), 0) AS rejectedQuantity,
       COUNT(*) AS receiptCount
     FROM purchase_receipts
     WHERE purchase_order_id = ?`,
    purchaseOrderId,
  );
  const row = rows[0] || {};
  return {
    processedQuantity: Number(row.processedQuantity || 0),
    acceptedQuantity: Number(row.acceptedQuantity || 0),
    rejectedQuantity: Number(row.rejectedQuantity || 0),
    receiptCount: Number(row.receiptCount || 0),
  };
}

export async function buildPurchaseReceiptSummary(
  tx: TransactionClient,
  order: { id: number; quantity: number },
) {
  const totals = await getPurchaseReceiptTotals(tx, Number(order.id));
  const orderedQuantity = Number(order.quantity || 0);
  return {
    orderedQuantity,
    processedQuantity: totals.processedQuantity,
    acceptedQuantity: totals.acceptedQuantity,
    rejectedQuantity: totals.rejectedQuantity,
    remainingQuantity: Math.max(0, orderedQuantity - totals.processedQuantity),
    receiptCount: totals.receiptCount,
  };
}

export async function getPurchaseOrderReceiptBundle(
  tx: TransactionClient,
  order: { id: number; quantity: number },
) {
  const [receipts, receiptSummary, discrepancyCases] = await Promise.all([
    listPurchaseReceipts(tx, order.id),
    buildPurchaseReceiptSummary(tx, order),
    ReceiptDiscrepancyService.listCases(tx, {
      relatedModule: 'procurement',
      relatedId: order.id,
      page: 1,
      pageSize: 100,
    }),
  ]);

  return {
    receiptSummary,
    receipts,
    discrepancyCases: discrepancyCases.items,
  };
}

export async function createPurchaseReceiptBatch(
  tx: TransactionClient,
  input: CreatePurchaseReceiptBatchInput,
) {
  const { inputQuantity, acceptedQuantity, rejectedQuantity } = normalizeReceiptQuantities(input);
  const order = await claimPurchaseReceiptWrite(tx, input.purchaseOrderId);
  if (order.status === 'cancelled') {
    throw new AppError('PURCHASE_ORDER_CANCELLED', 409, ErrorCode.CONFLICT);
  }
  if (order.status === 'pending') {
    throw new AppError('PURCHASE_ORDER_NOT_APPROVED', 409, ErrorCode.CONFLICT);
  }

  const totals = await getPurchaseReceiptTotals(tx, order.id);
  const remainingQuantity = Number(order.quantity || 0) - totals.processedQuantity;
  if (remainingQuantity <= 0.000001) {
    throw new AppError('PURCHASE_ORDER_ALREADY_FULLY_RECEIVED', 409, ErrorCode.CONFLICT);
  }
  if (inputQuantity - remainingQuantity > 0.000001) {
    throw new AppError(
      'PURCHASE_RECEIPT_EXCEEDS_REMAINING',
      409,
      ErrorCode.CONFLICT,
      { remainingQuantity, inputQuantity },
    );
  }

  const receiptNo = buildBusinessNo('PRC');
  const sourceRef = `PO-${order.id}-RCV-${receiptNo}`;
  const batchNo = String(input.batchNo || sourceRef);
  const receivedAt = normalizeReceiptDate(input.receivedAt);
  const discrepancyReason = toOptionalReceiptText(input.discrepancyReason);
  const receiptNote = toOptionalReceiptText(input.note);

  await tx.$executeRawUnsafe(
    `INSERT INTO purchase_receipts
      (receipt_no, purchase_order_id, quantity, accepted_quantity, rejected_quantity, unit, batch_no, stock_entry_ref, discrepancy_reason, note, received_by, received_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    receiptNo,
    order.id,
    inputQuantity,
    acceptedQuantity,
    rejectedQuantity,
    order.unit || 'kg',
    batchNo,
    acceptedQuantity > 0 ? sourceRef : null,
    discrepancyReason,
    receiptNote,
    input.createdBy || null,
    receivedAt,
  );

  if (acceptedQuantity > 0) {
    const receiptLocationId = await resolveProcurementReceiptLocationId(tx);
    await StockMovementService.postStockEntry({
      sourceType: 'procurement_receipt',
      sourceRef,
      reason: 'purchase_order_partial_received',
      note: `Purchase receipt ${receiptNo} for PO-${order.id}`,
      createdBy: input.createdBy || null,
      lines: [{
        locationId: receiptLocationId,
        productName: order.item,
        batchNo,
        quantityDelta: acceptedQuantity,
        unit: order.unit || 'kg',
        unitCost: resolveReceiptUnitCost(order),
        costAmountDelta: resolveReceiptCostAmount(order, acceptedQuantity, totals.acceptedQuantity),
      }],
    }, tx);
  }

  const receiptRows = await tx.$queryRawUnsafe<Array<{ id: number }>>(
    `SELECT id FROM purchase_receipts WHERE receipt_no = ? LIMIT 1`,
    receiptNo,
  );
  const discrepancyType = ReceiptDiscrepancyService.normalizeDiscrepancyType(
    input.discrepancyType,
    'short_shipped',
  );
  const discrepancyCase = await ReceiptDiscrepancyService.createCaseForRejectedReceipt(tx, {
    sourceType: 'purchase_receipt',
    sourceRef: receiptNo,
    sourceId: receiptRows[0]?.id ? Number(receiptRows[0].id) : null,
    relatedModule: 'procurement',
    relatedId: order.id,
    businessRef: `PO-${order.id}`,
    counterpartyType: 'supplier',
    counterpartyId: order.supplierId,
    counterpartyName: getSupplierDisplayName(order.supplier || {}),
    productName: order.item,
    quantity: rejectedQuantity,
    unit: order.unit || 'kg',
    referenceQuantity: Number(order.quantity || 0),
    discrepancyType,
    reason: discrepancyReason || '采购收货差异待处理',
    severity: rejectedQuantity / Math.max(inputQuantity, 1) >= 0.5 ? 'high' : 'normal',
    suggestedAction: 'supplier_claim_or_replacement',
    note: receiptNote,
    createdBy: input.createdBy || null,
  });

  const nextTotals = await getPurchaseReceiptTotals(tx, order.id);
  const nextStatus = nextTotals.processedQuantity + 0.000001 >= Number(order.quantity || 0)
    ? 'received'
    : 'in_transit';
  const updatedOrder = await tx.purchaseOrder.update({
    where: { id: order.id },
    data: { status: nextStatus },
    include: { supplier: true, salesOrder: true },
  });
  const receiptBundle = await getPurchaseOrderReceiptBundle(tx, {
    id: order.id,
    quantity: Number(updatedOrder.quantity || 0),
  });

  return {
    purchaseOrder: updatedOrder,
    ...receiptBundle,
    discrepancyCase,
    receiptNo,
  };
}
