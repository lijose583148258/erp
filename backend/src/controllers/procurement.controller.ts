import { Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { StockMovementService, type TransactionClient } from '../services/stock-movement.service';
import { ReceiptDiscrepancyService } from '../services/receipt-discrepancy.service';
import { buildBusinessNo } from '../utils/businessNo';
import { buildOperationalDataScopeWhere, canUseOperationalDataScope, mergeWhereAnd } from '../utils/recordAccess';

const PROCUREMENT_DATA_SCOPE = 'procurement_visible' as const;
const PARTIAL_RECEIPT_ERROR = 'PARTIAL_RECEIPT_REQUIRES_RECEIPT_ENDPOINT';
const PARTIAL_RECEIPT_MESSAGE = '采购单已有部分收货，必须继续通过分批收货接口处理剩余数量';

function createPartialReceiptError() {
  return new AppError(PARTIAL_RECEIPT_ERROR, 409, ErrorCode.CONFLICT);
}

function getProcurementErrorStatus(error: unknown) {
  return error instanceof AppError ? error.statusCode : 500;
}

function rejectProcurementScope(res: Response) {
  return res.status(403).json({ success: false, message: '当前角色未获得采购数据范围' });
}

function normalizeSupplierAliases(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean)));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return Array.from(new Set(parsed.map(item => String(item).trim()).filter(Boolean)));
      }
    } catch {
      return Array.from(new Set(trimmed.split(/[\n,;，、]+/).map(item => String(item).trim()).filter(Boolean)));
    }
  }
  return [];
}

function serializeSupplierAliases(value: unknown): string | null {
  const aliases = normalizeSupplierAliases(value);
  return aliases.length > 0 ? JSON.stringify(aliases) : null;
}

function parseSupplierAliases(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return Array.from(new Set(parsed.map(item => String(item).trim()).filter(Boolean)));
    }
  } catch {
    return value
      .split(/[\n,;，、]+/)
      .map(item => String(item).trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeJsonList<T extends Record<string, unknown>>(value: unknown): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object') as T[];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object') as T[] : [];
    } catch {
      return [];
    }
  }
  return [];
}

function serializeJsonList(value: unknown): string | null {
  const rows = normalizeJsonList(value);
  return rows.length > 0 ? JSON.stringify(rows) : null;
}

function getSupplierDisplayName(supplier: {
  name?: string;
  nameZh?: string | null;
  nameEn?: string | null;
  nameVi?: string | null;
}) {
  return supplier.nameZh || supplier.nameEn || supplier.nameVi || supplier.name || '';
}

function canViewSupplierSensitiveData(req: AuthRequest) {
  return canUseOperationalDataScope(req, PROCUREMENT_DATA_SCOPE);
}

function canViewProcurementOrders(req: AuthRequest) {
  return canUseOperationalDataScope(req, PROCUREMENT_DATA_SCOPE);
}

function buildSupplierSearchClause(search: unknown, includeSensitive: boolean) {
  if (!search) return undefined;
  const keyword = String(search);
  const clauses: Prisma.SupplierWhereInput[] = [
    { name: { contains: keyword } },
    { nameZh: { contains: keyword } },
    { nameEn: { contains: keyword } },
    { nameVi: { contains: keyword } },
    { nameAliases: { contains: keyword } },
    { category: { contains: keyword } },
  ];

  if (includeSensitive) {
    clauses.push(
      { contactsJson: { contains: keyword } },
      { addressesJson: { contains: keyword } },
      { contact: { contains: keyword } },
    );
  }

  return clauses;
}

function mapSupplier(supplier: any, includeSensitive = true) {
  return {
    ...supplier,
    id: String(supplier.id),
    nameAliases: parseSupplierAliases(supplier.nameAliases),
    contacts: includeSensitive ? normalizeJsonList(supplier.contactsJson) : [],
    addresses: includeSensitive ? normalizeJsonList(supplier.addressesJson) : [],
    supplierDisplayName: getSupplierDisplayName(supplier),
    rating: Number(supplier.rating),
    leadTimeDays: Number(supplier.leadTimeDays),
    contact: includeSensitive ? supplier.contact : '',
    contactsJson: undefined,
    addressesJson: undefined,
  };
}

function mapPurchaseOrder(order: any) {
  return {
    ...order,
    id: String(order.id),
    supplierId: String(order.supplierId),
    supplierNameZh: order.supplier?.nameZh || undefined,
    supplierNameEn: order.supplier?.nameEn || undefined,
    supplierNameVi: order.supplier?.nameVi || undefined,
    supplierDisplayName: getSupplierDisplayName(order.supplier || {}),
    supplierName: order.supplier?.name || '',
    salesOrderRef: order.salesOrderRef || order.salesOrder?.orderNo || '',
    salesOrderId: order.salesOrderId ? String(order.salesOrderId) : '',
    quantity: Number(order.quantity),
    price: Number(order.price),
    currency: normalizeCurrency(order.currency),
    exchangeRate: Number(order.exchangeRate ?? 1),
    taxRate: Number(order.taxRate ?? 0),
    taxAmount: Number(order.taxAmount ?? 0),
    freightCost: Number(order.freightCost ?? 0),
    dutyCost: Number(order.dutyCost ?? 0),
    insuranceCost: Number(order.insuranceCost ?? 0),
    otherCost: Number(order.otherCost ?? 0),
    landedCostAmount: Number(order.landedCostAmount ?? 0),
    landedUnitCost: Number(order.landedUnitCost ?? 0),
    isB2B: Boolean(order.isB2B),
  };
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function normalizeCurrency(value: unknown) {
  const normalized = String(value || 'CNY').trim().toUpperCase();
  return normalized || 'CNY';
}

function calculatePurchaseValuation(input: {
  quantity: unknown;
  price: unknown;
  currency?: unknown;
  exchangeRate?: unknown;
  taxRate?: unknown;
  taxAmount?: unknown;
  freightCost?: unknown;
  dutyCost?: unknown;
  insuranceCost?: unknown;
  otherCost?: unknown;
}) {
  const quantity = toFiniteNumber(input.quantity, 0);
  const price = toFiniteNumber(input.price, 0);
  const currency = normalizeCurrency(input.currency);
  const exchangeRate = Math.max(toFiniteNumber(input.exchangeRate, 1), 0.000001);
  const taxRate = Math.max(toFiniteNumber(input.taxRate, 0), 0);
  const itemAmount = price * quantity;
  const baseItemAmount = currency === 'CNY' ? itemAmount : itemAmount / exchangeRate;
  const explicitTaxAmount = input.taxAmount === undefined || input.taxAmount === null || input.taxAmount === ''
    ? null
    : toFiniteNumber(input.taxAmount, 0);
  const taxAmount = explicitTaxAmount === null ? baseItemAmount * (taxRate / 100) : explicitTaxAmount;
  const freightCost = toFiniteNumber(input.freightCost, 0);
  const dutyCost = toFiniteNumber(input.dutyCost, 0);
  const insuranceCost = toFiniteNumber(input.insuranceCost, 0);
  const otherCost = toFiniteNumber(input.otherCost, 0);
  // Extra costs are stored in the base accounting currency (CNY). Only item price is converted from order currency.
  const landedCostAmount = roundMoney(baseItemAmount + taxAmount + freightCost + dutyCost + insuranceCost + otherCost);
  const landedUnitCost = quantity > 0 ? roundMoney(landedCostAmount / quantity) : 0;

  return {
    currency,
    exchangeRate,
    taxRate,
    taxAmount: roundMoney(taxAmount),
    freightCost: roundMoney(freightCost),
    dutyCost: roundMoney(dutyCost),
    insuranceCost: roundMoney(insuranceCost),
    otherCost: roundMoney(otherCost),
    landedCostAmount,
    landedUnitCost,
  };
}

function resolveReceiptUnitCost(order: { landedUnitCost?: number | null; price?: number | null }) {
  const landedUnitCost = toFiniteNumber(order.landedUnitCost, 0);
  if (landedUnitCost > 0) return landedUnitCost;
  return toFiniteNumber(order.price, 0);
}

function resolveReceiptCostAmount(
  order: { landedCostAmount?: number | null; landedUnitCost?: number | null; price?: number | null; quantity?: number | null },
  quantityDelta: number,
  acceptedQuantityBefore = 0,
) {
  const landedCostAmount = toFiniteNumber(order.landedCostAmount, 0);
  const orderQuantity = toFiniteNumber(order.quantity, 0);
  const unitCost = resolveReceiptUnitCost(order);
  if (landedCostAmount > 0 && orderQuantity > 0) {
    const acceptedQuantityAfter = acceptedQuantityBefore + quantityDelta;
    if (acceptedQuantityAfter >= orderQuantity - 0.000001) {
      return roundMoney(landedCostAmount - roundMoney(unitCost * acceptedQuantityBefore));
    }
  }
  return roundMoney(unitCost * quantityDelta);
}

function normalizePurchaseStatus(status: string | null | undefined) {
  const normalized = String(status || 'pending');
  if (normalized === 'confirmed') return 'approved';
  if (normalized === 'shipped') return 'in_transit';
  if (normalized === 'delivered') return 'received';
  return normalized;
}

function canTransitionPurchaseStatus(currentStatus: string, nextStatus: string) {
  if (currentStatus === nextStatus) return true;

  const transitionMap: Record<string, string[]> = {
    pending: ['approved', 'cancelled'],
    approved: ['in_transit', 'cancelled'],
    in_transit: ['received', 'cancelled'],
    received: [],
    cancelled: [],
  };

  return (transitionMap[normalizePurchaseStatus(currentStatus)] || []).includes(normalizePurchaseStatus(nextStatus));
}

async function resolveProcurementReceiptLocationId(tx: TransactionClient) {
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

async function postProcurementReceiptIfMissing(tx: TransactionClient, order: {
  id: number;
  quantity?: number | null;
  unit?: string | null;
  item: string;
  price?: number | null;
  landedCostAmount?: number | null;
  landedUnitCost?: number | null;
}, createdBy?: number | null) {
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

async function listPurchaseReceipts(tx: TransactionClient, purchaseOrderId: number) {
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

async function getPurchaseReceiptTotals(tx: TransactionClient, purchaseOrderId: number) {
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

async function buildPurchaseReceiptSummary(tx: TransactionClient, order: { id: number; quantity: number }) {
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

async function getSupplierColumnSet() {
  // SAFE: 参数为硬编码表名 'suppliers'，无用户输入拼接
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info('suppliers')`);
  return new Set((rows || []).map(row => String(row.name)));
}

async function writeAuditLog(params: {
  req: AuthRequest;
  action: string;
  resource: string;
  resourceId: number;
  details: string;
}) {
  try {
    if (!params.req.user?.userId) return;
    await prisma.auditLog.create({
      data: {
        userId: params.req.user.userId,
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId,
        details: params.details,
        ipAddress: params.req.ip,
        userAgent: params.req.get('user-agent'),
      },
    });
  } catch (error) {
    logger.error('采购审计写入失败:', error);
  }
}

export class ProcurementController {
  async getSuppliers(req: AuthRequest, res: Response) {
    try {
      const { page = 1, pageSize = 20, search, status, riskLevel } = req.query;
      const currentPage = Math.max(Number(page) || 1, 1);
      const limit = Math.min(Number(pageSize) || 20, 100);
      const offset = (currentPage - 1) * limit;
      const where: Prisma.SupplierWhereInput = {};
      const includeSensitive = canViewSupplierSensitiveData(req);

      if (search) {
        where.OR = buildSupplierSearchClause(search, includeSensitive);
      }

      if (status) where.status = String(status);
      if (riskLevel) where.riskLevel = String(riskLevel);

      const scopedWhere = mergeWhereAnd(where, buildOperationalDataScopeWhere(req, PROCUREMENT_DATA_SCOPE));

      const [suppliers, total] = await Promise.all([
        prisma.supplier.findMany({
          where: scopedWhere,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
        }),
        prisma.supplier.count({ where: scopedWhere }),
      ]);

      return res.json({
        success: true,
        data: suppliers.map(supplier => mapSupplier(supplier, includeSensitive)),
        meta: {
          page: currentPage,
          pageSize: limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('获取供应商列表错误:', error);
      return res.status(500).json({ success: false, message: '服务器内部错误' });
    }
  }

  async createSupplier(req: AuthRequest, res: Response) {
    try {
      if (!canViewProcurementOrders(req)) {
        return rejectProcurementScope(res);
      }

      const {
        name,
        nameZh,
        nameEn,
        nameVi,
        nameAliases,
        contacts,
        addresses,
        category,
        rating,
        leadTimeDays,
        riskLevel,
        contact,
        status,
      } = req.body;

      const supplierColumns = await getSupplierColumnSet();
      const supplierData: Prisma.SupplierCreateInput = {
        name,
        category,
        rating: rating !== undefined ? Number(rating) : 4,
        leadTimeDays: leadTimeDays !== undefined ? Number(leadTimeDays) : 7,
        riskLevel: riskLevel || 'medium',
        contact: contact || '',
        status: status || 'active',
      };

      if (supplierColumns.has('name_zh')) supplierData.nameZh = nameZh || null;
      if (supplierColumns.has('name_en')) supplierData.nameEn = nameEn || null;
      if (supplierColumns.has('name_vi')) supplierData.nameVi = nameVi || null;
      if (supplierColumns.has('name_aliases')) supplierData.nameAliases = serializeSupplierAliases(nameAliases);
      if (supplierColumns.has('contacts_json')) supplierData.contactsJson = serializeJsonList(contacts);
      if (supplierColumns.has('addresses_json')) supplierData.addressesJson = serializeJsonList(addresses);

      const supplier = await prisma.supplier.create({
        data: supplierData,
      });

      await writeAuditLog({
        req,
        action: 'CREATE',
        resource: 'supplier',
        resourceId: supplier.id,
        details: `创建供应商 ${supplier.name}`,
      });

      return res.status(201).json({
        success: true,
        data: mapSupplier(supplier),
        message: '供应商创建成功',
      });
    } catch (error) {
      logger.error('创建供应商错误:', error);
      return res.status(500).json({ success: false, message: '服务器内部错误' });
    }
  }

  async getOrders(req: AuthRequest, res: Response) {
    try {
      const { page = 1, pageSize = 20, status, supplierId, search } = req.query;
      const currentPage = Math.max(Number(page) || 1, 1);
      const limit = Math.min(Number(pageSize) || 20, 100);
      const offset = (currentPage - 1) * limit;
      const where: Prisma.PurchaseOrderWhereInput = {};

      if (status) where.status = String(status);
      if (supplierId) where.supplierId = Number(supplierId);
      if (search) {
        where.OR = [
          { item: { contains: String(search) } },
          { salesOrderRef: { contains: String(search) } },
        ];
      }

      const scopedWhere = mergeWhereAnd(where, buildOperationalDataScopeWhere(req, PROCUREMENT_DATA_SCOPE));

      const [orders, total] = await Promise.all([
        prisma.purchaseOrder.findMany({
          where: scopedWhere,
          include: { supplier: true, salesOrder: true },
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
        }),
        prisma.purchaseOrder.count({ where: scopedWhere }),
      ]);

      return res.json({
        success: true,
        data: orders.map(mapPurchaseOrder),
        meta: {
          page: currentPage,
          pageSize: limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('获取采购单列表错误:', error);
      return res.status(500).json({ success: false, message: '服务器内部错误' });
    }
  }

  async getOrderReceipts(req: AuthRequest, res: Response) {
    try {
      const purchaseOrderId = Number(req.params.id);
      const order = await prisma.purchaseOrder.findFirst({
        where: mergeWhereAnd({ id: purchaseOrderId }, buildOperationalDataScopeWhere(req, PROCUREMENT_DATA_SCOPE)),
        include: { supplier: true, salesOrder: true },
      });
      if (!order) {
        return res.status(404).json({ success: false, message: '采购单不存在' });
      }

      const [receipts, receiptSummary, discrepancyCases] = await Promise.all([
        listPurchaseReceipts(prisma, purchaseOrderId),
        buildPurchaseReceiptSummary(prisma, { id: order.id, quantity: Number(order.quantity || 0) }),
        ReceiptDiscrepancyService.listCases(prisma, {
          relatedModule: 'procurement',
          relatedId: purchaseOrderId,
          page: 1,
          pageSize: 100,
        }),
      ]);

      return res.json({
        success: true,
        data: {
          purchaseOrder: mapPurchaseOrder(order),
          receiptSummary,
          receipts,
          discrepancyCases: discrepancyCases.items,
        },
      });
    } catch (error) {
      logger.error('查询采购收货批次失败:', error);
      return res.status(500).json({ success: false, message: '查询采购收货批次失败' });
    }
  }

  async createReceipt(req: AuthRequest, res: Response) {
    try {
      if (!canViewProcurementOrders(req)) {
        return rejectProcurementScope(res);
      }

      const purchaseOrderId = Number(req.params.id);
      const inputQuantity = Number(req.body.quantity || 0);
      const acceptedQuantity = Number(req.body.acceptedQuantity ?? inputQuantity);
      const rejectedQuantity = Number(req.body.rejectedQuantity ?? 0);

      if (Math.abs((acceptedQuantity + rejectedQuantity) - inputQuantity) > 0.000001) {
        return res.status(400).json({ success: false, message: '收货数量必须等于合格数量与差异数量之和' });
      }

      const result = await prisma.$transaction(async tx => {
        const order = await tx.purchaseOrder.findUnique({
          where: { id: purchaseOrderId },
          include: { supplier: true, salesOrder: true },
        });
        if (!order) {
          throw new AppError('PURCHASE_ORDER_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
        }
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
        const batchNo = String(req.body.batchNo || sourceRef);
        const receivedAt = req.body.receivedAt ? new Date(req.body.receivedAt) : new Date();

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
          req.body.discrepancyReason || null,
          req.body.note || null,
          req.user?.userId || null,
          receivedAt,
        );

        if (acceptedQuantity > 0) {
          const receiptLocationId = await resolveProcurementReceiptLocationId(tx);
          await StockMovementService.postStockEntry({
            sourceType: 'procurement_receipt',
            sourceRef,
            reason: 'purchase_order_partial_received',
            note: `Purchase receipt ${receiptNo} for PO-${order.id}`,
            createdBy: req.user?.userId || null,
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
          req.body.discrepancyType,
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
          reason: req.body.discrepancyReason || '采购收货差异待处理',
          severity: rejectedQuantity / Math.max(inputQuantity, 1) >= 0.5 ? 'high' : 'normal',
          suggestedAction: 'supplier_claim_or_replacement',
          note: req.body.note || null,
          createdBy: req.user?.userId || null,
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

        return {
          purchaseOrder: updatedOrder,
          receiptSummary: await buildPurchaseReceiptSummary(tx, updatedOrder),
          receipts: await listPurchaseReceipts(tx, order.id),
          discrepancyCases: (await ReceiptDiscrepancyService.listCases(tx, {
            relatedModule: 'procurement',
            relatedId: order.id,
            page: 1,
            pageSize: 100,
          })).items,
          discrepancyCase,
          receiptNo,
        };
      });

      await writeAuditLog({
        req,
        action: 'CREATE_RECEIPT',
        resource: 'purchase_order',
        resourceId: purchaseOrderId,
        details: `采购单 ${purchaseOrderId} 新增收货批次 ${result.receiptNo}`,
      });

      return res.status(201).json({
        success: true,
        data: {
          purchaseOrder: mapPurchaseOrder(result.purchaseOrder),
          receiptSummary: result.receiptSummary,
          receipts: result.receipts,
          discrepancyCases: result.discrepancyCases,
          discrepancyCase: result.discrepancyCase,
        },
        message: '采购收货批次已记录',
      });
    } catch (error) {
      const statusCode = error instanceof AppError ? error.statusCode : 500;
      const errorKey = error instanceof Error ? error.message : '';
      const details = error instanceof AppError ? error.details : undefined;
      const messages: Record<string, string> = {
        PURCHASE_ORDER_NOT_FOUND: '采购单不存在',
        PURCHASE_ORDER_CANCELLED: '已取消采购单不能收货',
        PURCHASE_ORDER_NOT_APPROVED: '采购单尚未审批，不能收货',
        PURCHASE_ORDER_ALREADY_FULLY_RECEIVED: '采购单已全部处理，不能重复收货',
        PURCHASE_RECEIPT_EXCEEDS_REMAINING: '收货数量超过剩余未处理数量',
        RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE: '收货差异超过容差规则，已阻止处理',
      };
      logger.error('创建采购收货批次失败:', error);
      return res.status(statusCode).json({
        success: false,
        message: messages[errorKey] || '创建采购收货批次失败',
        details,
      });
    }
  }

  async createOrder(req: AuthRequest, res: Response) {
    try {
      if (!canViewProcurementOrders(req)) {
        return rejectProcurementScope(res);
      }

      const {
        supplierId,
        item,
        quantity,
        unit,
        price,
        eta,
        status,
        salesOrderRef,
        salesOrderId,
        isB2B,
        currency,
        exchangeRate,
        taxRate,
        taxAmount,
        freightCost,
        dutyCost,
        insuranceCost,
        otherCost,
      } = req.body;
      const initialStatus = normalizePurchaseStatus(status);
      if (initialStatus === 'received') {
        return res.status(409).json({ success: false, message: '采购入库必须通过收货动作完成，不能在创建时直接设为已收货' });
      }
      const supplier = await prisma.supplier.findUnique({ where: { id: Number(supplierId) } });
      if (!supplier) {
        return res.status(404).json({ success: false, message: '供应商不存在' });
      }

      let salesOrder = null;
      if (salesOrderId) {
        salesOrder = await prisma.order.findUnique({
          where: { id: Number(salesOrderId) },
          select: { id: true, orderNo: true, status: true },
        });
        if (!salesOrder) {
          return res.status(404).json({ success: false, message: '关联销售订单不存在' });
        }
        if (salesOrder.status === 'cancelled') {
          return res.status(409).json({ success: false, message: '已取消销售订单不能关联采购单' });
        }
      }

      const valuation = calculatePurchaseValuation({
        quantity,
        price,
        currency,
        exchangeRate,
        taxRate,
        taxAmount,
        freightCost,
        dutyCost,
        insuranceCost,
        otherCost,
      });

      const order = await prisma.purchaseOrder.create({
        data: {
          supplierId: Number(supplierId),
          item,
          quantity: Number(quantity),
          unit,
          price: Number(price),
          currency: valuation.currency,
          exchangeRate: valuation.exchangeRate,
          taxRate: valuation.taxRate,
          taxAmount: valuation.taxAmount,
          freightCost: valuation.freightCost,
          dutyCost: valuation.dutyCost,
          insuranceCost: valuation.insuranceCost,
          otherCost: valuation.otherCost,
          landedCostAmount: valuation.landedCostAmount,
          landedUnitCost: valuation.landedUnitCost,
          eta: eta ? new Date(eta) : new Date(),
          status: initialStatus,
          salesOrderRef: salesOrderRef || salesOrder?.orderNo || null,
          salesOrderId: salesOrder ? salesOrder.id : (salesOrderId ? Number(salesOrderId) : null),
          isB2B: Boolean(isB2B),
        },
        include: { supplier: true, salesOrder: true },
      });

      await writeAuditLog({
        req,
        action: 'CREATE',
        resource: 'purchase_order',
        resourceId: order.id,
        details: `创建采购单 ${order.id}`,
      });

      return res.status(201).json({
        success: true,
        data: mapPurchaseOrder(order),
        message: '采购单创建成功',
      });
    } catch (error) {
      logger.error('创建采购单错误:', error);
      return res.status(500).json({ success: false, message: '服务器内部错误' });
    }
  }

  async updateOrderStatus(req: AuthRequest, res: Response) {
    try {
      if (!canViewProcurementOrders(req)) {
        return rejectProcurementScope(res);
      }

      const { id } = req.params;
      const nextStatus = normalizePurchaseStatus(req.body.status);
      const existing = await prisma.purchaseOrder.findUnique({
        where: { id: Number(id) },
        include: { supplier: true, salesOrder: true },
      });

      if (!existing) {
        return res.status(404).json({ success: false, message: '采购单不存在' });
      }

      if (!canTransitionPurchaseStatus(existing.status, nextStatus)) {
        return res.status(409).json({
          success: false,
          message: `采购单状态不允许从 ${existing.status} 变更为 ${nextStatus}`,
        });
      }

      const order = await prisma.$transaction(async tx => {
        const shouldPostReceipt = normalizePurchaseStatus(existing.status) !== 'received' && nextStatus === 'received';
        if (shouldPostReceipt) {
          const totals = await getPurchaseReceiptTotals(tx, existing.id);
          if (totals.processedQuantity > 0 && totals.processedQuantity + 0.000001 < Number(existing.quantity || 0)) {
            throw createPartialReceiptError();
          }
        }

        const updated = await tx.purchaseOrder.update({
          where: { id: Number(id) },
          data: { status: nextStatus },
          include: { supplier: true, salesOrder: true },
        });

        if (shouldPostReceipt) {
          const totals = await getPurchaseReceiptTotals(tx, updated.id);
          if (totals.processedQuantity <= 0.000001) {
            await postProcurementReceiptIfMissing(tx, updated, req.user?.userId || null);
          }
        }

        return updated;
      });

      await writeAuditLog({
        req,
        action: 'STATUS_CHANGE',
        resource: 'purchase_order',
        resourceId: order.id,
        details: `采购单 ${order.id} 状态更新为 ${nextStatus}`,
      });

      return res.json({
        success: true,
        data: mapPurchaseOrder(order),
        message: '采购单状态更新成功',
      });
    } catch (error) {
      logger.error('更新采购单状态错误:', error);
      if (error instanceof AppError && error.message === PARTIAL_RECEIPT_ERROR) {
        return res.status(error.statusCode).json({ success: false, message: PARTIAL_RECEIPT_MESSAGE });
      }
      return res.status(getProcurementErrorStatus(error)).json({ success: false, message: '服务器内部错误' });
    }
  }

  async linkB2BOrder(req: AuthRequest, res: Response) {
    try {
      if (!canViewProcurementOrders(req)) {
        return rejectProcurementScope(res);
      }

      const { id } = req.params;
      const { salesOrderId } = req.body;

      const order = await prisma.purchaseOrder.findUnique({ where: { id: Number(id) } });
      if (!order) {
        return res.status(404).json({ success: false, message: '采购单不存在' });
      }

      const salesOrder = await prisma.order.findUnique({
        where: { id: Number(salesOrderId) },
        select: { id: true, orderNo: true },
      });
      if (!salesOrder) {
        return res.status(404).json({ success: false, message: '关联销售订单不存在' });
      }

      const updated = await prisma.purchaseOrder.update({
        where: { id: Number(id) },
        data: {
          salesOrderId: salesOrder.id,
          salesOrderRef: salesOrder.orderNo,
          isB2B: true,
        },
        include: { supplier: true, salesOrder: true },
      });

      await writeAuditLog({
        req,
        action: 'LINK_B2B',
        resource: 'purchase_order',
        resourceId: updated.id,
        details: `采购单 ${updated.id} 关联销售订单 ${salesOrder.orderNo}`,
      });

      return res.json({
        success: true,
        data: {
          purchaseOrder: mapPurchaseOrder(updated),
          salesOrder,
        },
        message: 'B2B 关联成功',
      });
    } catch (error) {
      logger.error('关联 B2B 销售订单错误:', error);
      return res.status(500).json({ success: false, message: '服务器内部错误' });
    }
  }

  async getB2BStatus(req: AuthRequest, res: Response) {
    try {
      const { salesOrderId } = req.params;
      if (req.user?.role === 'sales') {
        const salesOrder = await prisma.order.findFirst({
          where: {
            id: Number(salesOrderId),
            createdBy: req.user.userId,
          },
          select: { id: true },
        });

        if (!salesOrder) {
          return res.status(404).json({ success: false, message: '关联销售订单不存在' });
        }
      } else if (!canViewProcurementOrders(req)) {
        return rejectProcurementScope(res);
      }

      const purchaseOrder = await prisma.purchaseOrder.findFirst({
        where: { salesOrderId: Number(salesOrderId) },
        include: { supplier: true, salesOrder: true },
      });

      if (!purchaseOrder) {
        return res.json({ success: true, data: { linked: false } });
      }

      return res.json({
        success: true,
        data: {
          linked: true,
          purchaseOrder: mapPurchaseOrder(purchaseOrder),
        },
      });
    } catch (error) {
      logger.error('获取 B2B 状态错误:', error);
      return res.status(500).json({ success: false, message: '服务器内部错误' });
    }
  }

  async syncB2BStatus(req: AuthRequest, res: Response) {
    try {
      if (!canViewProcurementOrders(req)) {
        return rejectProcurementScope(res);
      }

      const { salesOrderId } = req.params;
      const { salesStatus } = req.body;
      const purchaseOrder = await prisma.purchaseOrder.findFirst({
        where: { salesOrderId: Number(salesOrderId) },
        include: { supplier: true, salesOrder: true },
      });

      if (!purchaseOrder) {
        return res.json({ success: true, data: { linked: false } });
      }

      const statusMap: Record<string, string> = {
        pending: 'pending',
        confirmed: 'approved',
        shipped: 'in_transit',
        delivered: 'received',
        cancelled: 'cancelled',
      };
      const nextStatus = normalizePurchaseStatus(statusMap[String(salesStatus)] || purchaseOrder.status);

      const updated = await prisma.$transaction(async tx => {
        const shouldPostReceipt = normalizePurchaseStatus(purchaseOrder.status) !== 'received' && nextStatus === 'received';
        if (shouldPostReceipt) {
          const totals = await getPurchaseReceiptTotals(tx, purchaseOrder.id);
          if (totals.processedQuantity > 0 && totals.processedQuantity + 0.000001 < Number(purchaseOrder.quantity || 0)) {
            throw createPartialReceiptError();
          }
        }

        const updatedOrder = await tx.purchaseOrder.update({
          where: { id: purchaseOrder.id },
          data: { status: nextStatus },
          include: { supplier: true, salesOrder: true },
        });

        if (shouldPostReceipt) {
          const totals = await getPurchaseReceiptTotals(tx, updatedOrder.id);
          if (totals.processedQuantity <= 0.000001) {
            await postProcurementReceiptIfMissing(tx, updatedOrder, req.user?.userId || null);
          }
        }

        return updatedOrder;
      });

      await writeAuditLog({
        req,
        action: 'SYNC_B2B',
        resource: 'purchase_order',
        resourceId: updated.id,
        details: `销售订单 ${salesOrderId} 状态同步为 ${salesStatus}`,
      });

      return res.json({
        success: true,
        data: {
          purchaseOrder: mapPurchaseOrder(updated),
          salesOrder: updated.salesOrder,
        },
        message: 'B2B 状态同步成功',
      });
    } catch (error) {
      logger.error('同步 B2B 状态错误:', error);
      if (error instanceof AppError && error.message === PARTIAL_RECEIPT_ERROR) {
        return res.status(error.statusCode).json({ success: false, message: PARTIAL_RECEIPT_MESSAGE });
      }
      return res.status(getProcurementErrorStatus(error)).json({ success: false, message: '服务器内部错误' });
    }
  }
}
