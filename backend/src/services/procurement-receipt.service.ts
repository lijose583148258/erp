import { AppError, ErrorCode } from '../middleware/errorHandler';
import { Prisma } from '@prisma/client';
import { executeRawCompat, queryRawCompat } from '../utils/raw-sql-compat';
import { buildBusinessNo } from '../utils/businessNo';
import { roundMoney } from '../utils/money';
import {
  requirePurchaseReceiptKey,
  purchaseReceiptSubmissionSchema, readPurchaseReceiptSubmission, invalidPurchaseReceiptSubmission,
  type PurchaseReceiptFacts, type PurchaseReceiptSubmission,
} from '../domain/purchase-receipt-submission';
import { controlledPurchaseReceiptFactsSchema, controlledPurchaseReceiptFingerprint, controlledPurchaseReceiptAuditDetails,
  controlledPurchaseReceiptSubmissionSchema, normalizeControlledPurchaseReceipt, readControlledPurchaseReceiptSubmission } from '../domain/purchase-controlled-receipt';
import { buildPurchaseReceiptPayable, payableMoney, requireReceiptPayableSource } from '../domain/purchase-payable';
import { requireCommittedPurchaseReceipt } from './purchase-receipt-evidence.service';
import { resolveApprovedPurchaseSources, resolveReceiptApprovedSources } from './procurement-source-confirmation.service';
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
  revision?: number;
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
  supplierBatchNo?: unknown; batchId?: unknown; payableAmountNative?: unknown; payableAmountBase?: unknown;
};

type PurchaseReceiptTotalsRow = {
  processedQuantity?: unknown;
  acceptedQuantity?: unknown;
  rejectedQuantity?: unknown;
  receiptCount?: unknown;
};

export interface CreatePurchaseReceiptBatchInput {
  purchaseOrderId: number;
  idempotencyKey?: unknown;
  expectedRevision?: unknown;
  quantity: unknown;
  acceptedQuantity?: unknown;
  rejectedQuantity?: unknown;
  batchNo?: unknown;
  receivedAt?: unknown;
  discrepancyReason?: unknown;
  discrepancyType?: unknown;
  note?: unknown;
  createdBy?: number | null;
  ipAddress?: string;
  userAgent?: string;
}

function toFiniteReceiptNumber(value: unknown, label: string) {
  const parsed = Number(value);
  if (value == null || typeof value === 'boolean' || value === '' || !Number.isFinite(parsed)
    || new Prisma.Decimal(parsed).decimalPlaces() > 6 || !Number.isSafeInteger(new Prisma.Decimal(parsed).times(1000000).toNumber())) {
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
  if (typeof value !== 'string') throw new AppError('PURCHASE_RECEIPT_INVALID_TEXT', 400, ErrorCode.VALIDATION_ERROR);
  return value.trim() || null;
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

  // Serialize new receipt owners without advancing the commercial revision timestamp.
  const claim = await executeRawCompat(tx, 'UPDATE purchase_orders SET id = id WHERE id = ?', normalizedId);
  if (claim !== 1) {
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

  // Status/B2B delivery is not a warehouse receipt. Preserve old posted rows
  // above, but never invent a new physical lot, liability or QA from a status.
  throw new AppError('ACTUAL_RECEIPT_REQUIRED', 409, ErrorCode.CONFLICT);
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
    receivedAt: receiptDateIso(row.receivedAt),
    createdAt: receiptDateIso(row.createdAt),
  };
}

function receiptDateIso(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw invalidPurchaseReceiptSubmission();
  return date.toISOString();
}

function controlledFacts(facts: PurchaseReceiptFacts, expectedRevision: unknown) {
  const parsed = controlledPurchaseReceiptFactsSchema.safeParse({ ...facts, expectedRevision });
  if (!parsed.success) throw new AppError('PURCHASE_RECEIPT_SOURCE_FACTS_REQUIRED', 400, ErrorCode.VALIDATION_ERROR, { issues: parsed.error.issues });
  return parsed.data;
}
async function readReceiptReplay(tx: TransactionClient, facts: PurchaseReceiptFacts, key: string, expectedRevision: unknown) {
  const stored = await tx.purchaseReceipt.findFirst({ where: { purchaseOrderId: facts.purchaseOrderId, submissionKey: key } });
  if (!stored) return null;
  let raw: unknown;
  try { raw = JSON.parse(stored.submissionJson || ''); }
  catch { throw invalidPurchaseReceiptSubmission(); }
  const v2 = controlledPurchaseReceiptSubmissionSchema.safeParse(raw);
  let submission;
  if (v2.success) {
    const audit = await tx.auditLog.findUnique({ where: { id: v2.data.auditId } });
    submission = readControlledPurchaseReceiptSubmission(stored, normalizeControlledPurchaseReceipt(stored), audit,
      { key, facts: controlledFacts(facts, expectedRevision) });
  } else {
    const v1 = purchaseReceiptSubmissionSchema.safeParse(raw);
    if (!v1.success) throw invalidPurchaseReceiptSubmission();
    const audit = await tx.auditLog.findUnique({ where: { id: v1.data.auditId } });
    submission = readPurchaseReceiptSubmission(stored, normalizeReceiptRow(stored) as PurchaseReceiptSubmission['receipt'], facts, key, audit);
  }
  const order = await tx.purchaseOrder.findUnique({ where: { id: facts.purchaseOrderId }, include: { supplier: true, salesOrder: true } });
  if (!order) throw invalidPurchaseReceiptSubmission();
  const bundle = await getPurchaseOrderReceiptBundle(tx, order);
  const discrepancyCase = bundle.discrepancyCases.find(c => c.sourceRef === submission.receipt.receiptNo) || null;
  return { purchaseOrder: order, ...bundle, discrepancyCase, receiptNo: submission.receipt.receiptNo, submission, replayed: true };
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
       supplier_batch_no AS "supplierBatchNo", batch_id AS "batchId",
       payable_amount_native AS "payableAmountNative", payable_amount_base AS "payableAmountBase",
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
  return rows.map(row => ({ ...normalizeReceiptRow(row), supplierBatchNo: row.supplierBatchNo == null ? null : String(row.supplierBatchNo),
    batchId: row.batchId == null ? null : Number(row.batchId), payableAmountNative: row.payableAmountNative == null ? null : payableMoney(row.payableAmountNative).toFixed(2),
    payableAmountBase: row.payableAmountBase == null ? null : payableMoney(row.payableAmountBase).toFixed(2) }));
}

async function readReceiptPayableHistory(tx: TransactionClient, order: Awaited<ReturnType<typeof claimPurchaseReceiptWrite>>) {
  let quantity = new Prisma.Decimal(0), native = new Prisma.Decimal(0), base = new Prisma.Decimal(0);
  const rows = await tx.purchaseReceipt.findMany({ where: { purchaseOrderId: order.id }, orderBy: { id: 'asc' } });
  for (const row of rows) {
    await requireCommittedPurchaseReceipt(tx, row);
    await resolveReceiptApprovedSources(tx, row);
    const snapshot = requireReceiptPayableSource(row, { revision: order.revision, supplierId: order.supplierId, materialId: order.materialId,
      unit: order.unit, quantity: order.quantity, price: order.price, currency: order.currency, exchangeRate: order.exchangeRate });
    if (!quantity.equals(snapshot.allocation.receivedQuantityBefore) || !native.equals(snapshot.allocation.postedAmountNativeBefore)
      || !base.equals(snapshot.allocation.postedAmountBaseBefore)) throw new AppError('PURCHASE_PAYABLE_RECONCILIATION_REQUIRED', 409, ErrorCode.CONFLICT);
    quantity = quantity.plus(row.acceptedQuantity); native = native.plus(snapshot.allocation.amountNative); base = base.plus(snapshot.allocation.amountBase);
  }
  return { receivedQuantityBefore: quantity, postedAmountNativeBefore: native, postedAmountBaseBefore: base };
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
  requireValuedReceiptActor(input.createdBy);
  const key = requirePurchaseReceiptKey(input.idempotencyKey);
  const discrepancyType = ReceiptDiscrepancyService.normalizeDiscrepancyType(input.discrepancyType, 'short_shipped');
  const facts: PurchaseReceiptFacts = {
    purchaseOrderId: input.purchaseOrderId, receivedBy: Number(input.createdBy), quantity: inputQuantity, acceptedQuantity, rejectedQuantity,
    batchNo: toOptionalReceiptText(input.batchNo), receivedAt: input.receivedAt ? normalizeReceiptDate(input.receivedAt).toISOString() : null,
    discrepancyReason: toOptionalReceiptText(input.discrepancyReason), discrepancyType, note: toOptionalReceiptText(input.note),
  };
  const existing = await readReceiptReplay(tx, facts, key, input.expectedRevision);
  if (existing) return existing;
  const order = await claimPurchaseReceiptWrite(tx, input.purchaseOrderId);
  const raced = await readReceiptReplay(tx, facts, key, input.expectedRevision);
  if (raced) return raced;
  if (order.status === 'cancelled') {
    throw new AppError('PURCHASE_ORDER_CANCELLED', 409, ErrorCode.CONFLICT);
  }
  if (order.status === 'pending') {
    throw new AppError('PURCHASE_ORDER_NOT_APPROVED', 409, ErrorCode.CONFLICT);
  }
  const sourcedFacts = controlledFacts(facts, input.expectedRevision);
  if (sourcedFacts.expectedRevision !== order.revision) throw new AppError('PURCHASE_RECEIPT_REVISION_CONFLICT', 409, ErrorCode.CONFLICT);
  const sources = await resolveApprovedPurchaseSources(tx, order);
  const fingerprint = controlledPurchaseReceiptFingerprint(sourcedFacts);

  const totals = await getPurchaseReceiptTotals(tx, order.id);
  const remaining = new Prisma.Decimal(order.quantity).minus(new Prisma.Decimal(totals.processedQuantity).toDecimalPlaces(6));
  const remainingQuantity = remaining.toNumber();
  if (remaining.lessThanOrEqualTo(0)) {
    throw new AppError('PURCHASE_ORDER_ALREADY_FULLY_RECEIVED', 409, ErrorCode.CONFLICT);
  }
  if (new Prisma.Decimal(inputQuantity).greaterThan(remaining)) {
    throw new AppError(
      'PURCHASE_RECEIPT_EXCEEDS_REMAINING',
      409,
      ErrorCode.CONFLICT,
      { remainingQuantity, inputQuantity },
    );
  }

  const postedCostBefore = await readPostedPurchaseReceiptCost(tx, order, totals.acceptedQuantity);
  const payableBefore = await readReceiptPayableHistory(tx, order);
  const costAmountDelta = acceptedQuantity > 0
    ? resolveReceiptCostAmount(order, acceptedQuantity, totals.acceptedQuantity, postedCostBefore) : 0;

  const receiptNo = buildBusinessNo('PRC');
  const sourceRef = `PO-${order.id}-RCV-${receiptNo}`;
  const batchNo = sourceRef; // Repeated supplier lots never merge into an already released internal batch.
  const payable = buildPurchaseReceiptPayable({ purchaseOrderId: order.id, receiptNo, supplierBatchNo: sourcedFacts.batchNo, batchNo,
    receivedBy: facts.receivedBy, binding: sources.binding, supplierPayableBasisJson: order.supplierPayableBasisJson!,
    sourceAuditId: sources.sourceAuditId, approvalAuditId: sources.approvalAuditId, receivedQuantity: acceptedQuantity, ...payableBefore });
  const receivedAt = facts.receivedAt ? new Date(facts.receivedAt) : new Date();
  const discrepancyReason = facts.discrepancyReason;
  const receiptNote = facts.note;

  let persisted = await tx.purchaseReceipt.create({ data: { receiptNo, purchaseOrderId: order.id, quantity: inputQuantity,
    acceptedQuantity, rejectedQuantity, unit: order.unit, batchNo, supplierBatchNo: sourcedFacts.batchNo,
    stockEntryRef: acceptedQuantity > 0 ? sourceRef : null, discrepancyReason, note: receiptNote, receivedBy: facts.receivedBy,
    receivedAt, submissionKey: key, submissionFingerprint: fingerprint, payableAmountNative: payable.payableAmountNative,
    payableAmountBase: payable.payableAmountBase, payableSnapshotJson: payable.payableSnapshotJson, incomingQualityPlanJson: order.incomingQualityPlanJson } });

  if (acceptedQuantity > 0) {
    if (await tx.productBatch.findUnique({ where: { batchNo } })) throw new AppError('PURCHASE_RECEIPT_BATCH_COLLISION', 409, ErrorCode.CONFLICT);
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
    const batch = await tx.productBatch.findUnique({ where: { batchNo } });
    if (!batch || batch.materialId !== order.materialId || batch.unit !== order.unit) throw invalidPurchaseReceiptSubmission();
    await tx.productBatch.update({ where: { id: batch.id }, data: { qualityStatus: 'hold' } });
    persisted = await tx.purchaseReceipt.update({ where: { id: persisted.id }, data: { batchId: batch.id } });
  }
  const discrepancyCase = await ReceiptDiscrepancyService.createCaseForRejectedReceipt(tx, {
    sourceType: 'purchase_receipt',
    sourceRef: receiptNo,
    sourceId: persisted.id,
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
  const nextStatus = new Prisma.Decimal(nextTotals.processedQuantity).toDecimalPlaces(6).greaterThanOrEqualTo(order.quantity)
    ? 'received'
    : 'in_transit';
  const updatedOrder = order.status === nextStatus ? order : await tx.purchaseOrder.update({
    where: { id: order.id },
    data: { status: nextStatus },
    include: { supplier: true, salesOrder: true },
  });
  const receiptBundle = await getPurchaseOrderReceiptBundle(tx, {
    id: order.id,
    quantity: Number(updatedOrder.quantity || 0),
  });

  const receipt = normalizeControlledPurchaseReceipt(persisted);
  const audit = await tx.auditLog.create({ data: {
    userId: facts.receivedBy, action: 'CREATE_RECEIPT', resource: 'purchase_order', resourceId: order.id,
    details: JSON.stringify(controlledPurchaseReceiptAuditDetails(key, fingerprint, receipt)), ipAddress: input.ipAddress, userAgent: input.userAgent,
  } });
  const submission = controlledPurchaseReceiptSubmissionSchema.parse({ schema: 'purchase-receipt-submission/v2', key, fingerprint, auditId: audit.id,
    facts: sourcedFacts, receipt });
  await tx.purchaseReceipt.update({ where: { id: receipt.id }, data: { submissionJson: JSON.stringify(submission) } });

  return {
    purchaseOrder: updatedOrder,
    ...receiptBundle,
    discrepancyCase,
    receiptNo,
    submission,
    replayed: false,
  };
}
