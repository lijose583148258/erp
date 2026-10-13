import { AppError, ErrorCode } from '../middleware/errorHandler';
import { executeRawCompat, queryRawCompat } from '../utils/raw-sql-compat';
import { buildBusinessNo } from '../utils/businessNo';
import { roundMoney } from '../utils/money';
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
  materialId?: number | null;
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

function requireValuedReceiptActor(createdBy: number | null | undefined) {
  if (!Number.isSafeInteger(createdBy) || Number(createdBy) <= 0) {
    throw new AppError('PURCHASE_RECEIPT_ACTOR_REQUIRED', 400, ErrorCode.VALIDATION_ERROR);
  }
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

  requireValuedReceiptActor(createdBy);

  const receiptLocationId = await resolveProcurementReceiptLocationId(tx);
  const receiptNo = buildBusinessNo('PRC');
  await executeRawCompat(tx, 
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
      materialId: order.materialId || null,
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
  const rows = await queryRawCompat<PurchaseReceiptRow[]>(tx, 
    `SELECT
       id,
       receipt_no AS "receiptNo",
       purchase_order_id AS "purchaseOrderId",
       quantity,
       accepted_quantity AS "acceptedQuantity",
       rejected_quantity AS "rejectedQuantity",
       unit,
       batch_no AS "batchNo",
       stock_entry_ref AS "stockEntryRef",
       discrepancy_reason AS "discrepancyReason",
       note,
       received_by AS "receivedBy",
       received_at AS "receivedAt",
       created_at AS "createdAt"
     FROM purchase_receipts
     WHERE purchase_order_id = ?
     ORDER BY id ASC`,
    purchaseOrderId,
  );
  return rows.map(normalizeReceiptRow);
}

export async function getPurchaseReceiptTotals(tx: TransactionClient, purchaseOrderId: number) {
  const rows = await queryRawCompat<PurchaseReceiptTotalsRow[]>(tx, 
    `SELECT
       COALESCE(SUM(quantity), 0) AS "processedQuantity",
       COALESCE(SUM(accepted_quantity), 0) AS "acceptedQuantity",
       COALESCE(SUM(rejected_quantity), 0) AS "rejectedQuantity",
       COUNT(*) AS "receiptCount"
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

export async function readPostedPurchaseReceiptCost(
  tx: TransactionClient, order: PurchaseOrderForReceipt, acceptedQuantityBefore: number,
) {
  const reject = (field: string): never => { throw new AppError(
    'PURCHASE_RECEIPT_COST_RECONCILIATION_REQUIRED', 409, ErrorCode.CONFLICT, { purchaseOrderId: order.id, field },
  ); };
  const number = (value: unknown, field: string) => {
    if (value == null || value === '' || typeof value === 'boolean') return reject(field);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return reject(field);
    return parsed;
  };
  const money = (value: unknown, field: string) => {
    const parsed = number(value, field), cents = Math.round(parsed * 100);
    if (!Number.isSafeInteger(cents) || Math.abs(roundMoney(parsed) - parsed) >= 0.0000001) return reject(field);
    return cents;
  };
  // Legacy full-receipt shortcuts could post stock without a receipt row.
  // Absence of receipts is not proof that no historical cost was posted.
  const orphans = await queryRawCompat<Array<{ id: number }>>(tx,
    `SELECT e.id FROM stock_entries e
     LEFT JOIN purchase_receipts r ON r.purchase_order_id = ? AND r.stock_entry_ref = e.source_ref
     WHERE e.source_type = 'procurement_receipt' AND e.status = 'posted'
       AND (e.source_ref = ? OR e.source_ref LIKE ?) AND r.id IS NULL`,
    order.id, `PO-${order.id}`, `PO-${order.id}-RCV-%`,
  );
  if (orphans.length) reject('orphanPostedEntry');
  const rows = await queryRawCompat<Array<Record<string, unknown>>>(tx,
    `SELECT r.id AS "receiptId", r.quantity, r.accepted_quantity AS "accepted", r.rejected_quantity AS "rejected",
       r.unit, r.batch_no AS "receiptBatch", r.stock_entry_ref AS "receiptRef",
       (SELECT COUNT(*) FROM purchase_receipts linked WHERE linked.stock_entry_ref = r.stock_entry_ref) AS "receiptRefCount",
       e.id AS "entryId", e.entry_no AS "entryNo", m.id AS "movementId",
       m.material_id AS "materialId", m.product_name AS "productName", m.batch_no AS "batchNo", m.unit AS "movementUnit",
       m.quantity_before AS "movementBefore", m.quantity_delta AS "movementDelta", m.quantity_after AS "movementAfter",
       b.id AS "batchId", b.material_id AS "batchMaterialId", b.unit AS "batchUnit",
       l.id AS "ledgerId", l.batch_id AS "ledgerBatchId", l.source_type AS "ledgerSourceType",
       l.quantity_before AS "ledgerBefore", l.quantity_delta AS "ledgerDelta", l.quantity_after AS "ledgerAfter",
       l.cost_before AS "costBefore", l.cost_amount_delta AS "costDelta", l.cost_after AS "costAfter"
     FROM purchase_receipts r
     LEFT JOIN stock_entries e ON e.source_ref = r.stock_entry_ref AND e.source_type = 'procurement_receipt' AND e.status = 'posted'
     LEFT JOIN stock_movements m ON m.entry_id = e.id
     LEFT JOIN product_batches b ON b.batch_no = m.batch_no
     LEFT JOIN inventory_cost_ledgers l ON l.source_ref = e.entry_no
     WHERE r.purchase_order_id = ? ORDER BY r.id, m.id, l.id`, order.id,
  );
  const seen = new Set<string>(); let accepted = 0, costCents = 0;
  const claimId = (row: Record<string, unknown>, key: string) => {
    const id = number(row[key], key);
    if (!Number.isSafeInteger(id) || id === 0 || seen.has(`${key}:${id}`)) reject(key);
    seen.add(`${key}:${id}`);
  };
  for (const row of rows) {
    claimId(row, 'receiptId');
    const quantity = number(row.quantity, 'quantity'), delta = number(row.accepted, 'accepted');
    if (quantity <= 0 || Math.abs(quantity - delta - number(row.rejected, 'rejected')) > 0.000001
      || row.unit !== (order.unit || 'kg')) reject('receiptQuantities');
    accepted += delta;
    if (delta === 0) {
      if (row.receiptRef != null || row.entryId != null) reject('rejectedReceiptPosted');
      continue;
    }
    for (const key of ['entryId', 'movementId', 'ledgerId']) claimId(row, key);
    if (!row.entryNo || !row.receiptRef || !row.receiptBatch || row.receiptBatch !== row.batchNo
      || (row.receiptRef !== `PO-${order.id}` && !String(row.receiptRef).startsWith(`PO-${order.id}-RCV-`))
      || number(row.receiptRefCount, 'receiptRefCount') !== 1
      || row.unit !== row.movementUnit || row.unit !== row.batchUnit
      || number(row.batchId, 'batchId') !== number(row.ledgerBatchId, 'ledgerBatchId')
      || row.ledgerSourceType !== 'inventory_adjustment'
      || (order.materialId ? row.materialId !== order.materialId || row.batchMaterialId !== order.materialId
        : row.productName !== order.item)) reject('receiptIdentity');
    for (const prefix of ['movement', 'ledger']) {
      if (Math.abs(number(row[`${prefix}Delta`], `${prefix}Delta`) - delta) > 0.000001
        || Math.abs(number(row[`${prefix}After`], `${prefix}After`) - number(row[`${prefix}Before`], `${prefix}Before`) - delta) > 0.000001) reject(`${prefix}Quantity`);
    }
    const cents = money(row.costDelta, 'costDelta');
    if (money(row.costBefore, 'costBefore') + cents !== money(row.costAfter, 'costAfter')) reject('ledgerCost');
    costCents += cents;
    if (!Number.isSafeInteger(costCents)) reject('totalCost');
  }
  if (!Number.isFinite(acceptedQuantityBefore) || Math.abs(accepted - acceptedQuantityBefore) > 0.000001) reject('totalAcceptedQuantity');
  return costCents / 100;
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
  if (acceptedQuantity > 0) requireValuedReceiptActor(input.createdBy);
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

  const postedCostBefore = await readPostedPurchaseReceiptCost(tx, order, totals.acceptedQuantity);
  const costAmountDelta = acceptedQuantity > 0
    ? resolveReceiptCostAmount(order, acceptedQuantity, totals.acceptedQuantity, postedCostBefore) : 0;

  const receiptNo = buildBusinessNo('PRC');
  const sourceRef = `PO-${order.id}-RCV-${receiptNo}`;
  const batchNo = String(input.batchNo || sourceRef);
  const receivedAt = normalizeReceiptDate(input.receivedAt);
  const discrepancyReason = toOptionalReceiptText(input.discrepancyReason);
  const receiptNote = toOptionalReceiptText(input.note);

  await executeRawCompat(tx, 
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
        materialId: order.materialId || null,
        productName: order.item,
        batchNo,
        quantityDelta: acceptedQuantity,
        unit: order.unit || 'kg',
        unitCost: resolveReceiptUnitCost(order),
        costAmountDelta,
      }],
    }, tx);
  }

  const receiptRows = await queryRawCompat<Array<{ id: number }>>(tx, 
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
