import { AppError, ErrorCode } from '../middleware/errorHandler';
import {
  calculatePurchaseValuation,
  normalizeCurrency,
  normalizePurchaseStatus,
} from './procurement-domain.service';
import type { TransactionClient } from './stock-movement.service';

export interface CreatePurchaseOrderInput {
  supplierId?: unknown;
  item?: unknown;
  quantity?: unknown;
  unit?: unknown;
  price?: unknown;
  eta?: unknown;
  status?: unknown;
  salesOrderRef?: unknown;
  salesOrderId?: unknown;
  isB2B?: unknown;
  currency?: unknown;
  exchangeRate?: unknown;
  taxRate?: unknown;
  taxAmount?: unknown;
  freightCost?: unknown;
  dutyCost?: unknown;
  insuranceCost?: unknown;
  otherCost?: unknown;
}

const CREATE_ALLOWED_STATUSES = new Set(['pending', 'approved', 'in_transit', 'cancelled']);

function toPositiveInteger(value: unknown, code: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(code, 400, ErrorCode.VALIDATION_ERROR, { value });
  }
  return parsed;
}

function toRequiredText(value: unknown, code: string) {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new AppError(code, 400, ErrorCode.VALIDATION_ERROR, { value });
  }
  return text;
}

function toRequiredPositiveNumber(value: unknown, code: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError(code, 400, ErrorCode.VALIDATION_ERROR, { value });
  }
  return parsed;
}

function toRequiredNonNegativeNumber(value: unknown, code: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AppError(code, 400, ErrorCode.VALIDATION_ERROR, { value });
  }
  return parsed;
}

function toOptionalNonNegativeNumber(value: unknown, code: string) {
  if (value === undefined || value === null || value === '') return undefined;
  return toRequiredNonNegativeNumber(value, code);
}

function toOptionalPositiveNumber(value: unknown, code: string, fallback: number) {
  if (value === undefined || value === null || value === '') return fallback;
  return toRequiredPositiveNumber(value, code);
}

function toOptionalDate(value: unknown) {
  if (!value) return new Date();
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new AppError('PURCHASE_ORDER_INVALID_DATE', 400, ErrorCode.VALIDATION_ERROR, { value });
  }
  return date;
}

function toOptionalText(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim() || null;
}

function normalizeCreateStatus(value: unknown) {
  const status = normalizePurchaseStatus(value == null || value === '' ? 'pending' : String(value));
  if (status === 'received') {
    throw new AppError('PURCHASE_ORDER_DIRECT_RECEIVE_NOT_ALLOWED', 409, ErrorCode.CONFLICT);
  }
  if (!CREATE_ALLOWED_STATUSES.has(status)) {
    throw new AppError('PURCHASE_ORDER_INVALID_STATUS', 400, ErrorCode.VALIDATION_ERROR, { status });
  }
  return status;
}

export async function createPurchaseOrder(tx: TransactionClient, input: CreatePurchaseOrderInput) {
  const supplierId = toPositiveInteger(input.supplierId, 'PURCHASE_ORDER_INVALID_SUPPLIER_ID');
  const item = toRequiredText(input.item, 'PURCHASE_ORDER_INVALID_ITEM');
  const quantity = toRequiredPositiveNumber(input.quantity, 'PURCHASE_ORDER_INVALID_QUANTITY');
  const price = toRequiredNonNegativeNumber(input.price, 'PURCHASE_ORDER_INVALID_PRICE');
  const currency = normalizeCurrency(input.currency);
  const exchangeRate = toOptionalPositiveNumber(input.exchangeRate, 'PURCHASE_ORDER_INVALID_EXCHANGE_RATE', 1);
  const taxRate = toOptionalNonNegativeNumber(input.taxRate, 'PURCHASE_ORDER_INVALID_COST');
  const taxAmount = toOptionalNonNegativeNumber(input.taxAmount, 'PURCHASE_ORDER_INVALID_COST');
  const freightCost = toOptionalNonNegativeNumber(input.freightCost, 'PURCHASE_ORDER_INVALID_COST');
  const dutyCost = toOptionalNonNegativeNumber(input.dutyCost, 'PURCHASE_ORDER_INVALID_COST');
  const insuranceCost = toOptionalNonNegativeNumber(input.insuranceCost, 'PURCHASE_ORDER_INVALID_COST');
  const otherCost = toOptionalNonNegativeNumber(input.otherCost, 'PURCHASE_ORDER_INVALID_COST');
  const eta = toOptionalDate(input.eta);
  const initialStatus = normalizeCreateStatus(input.status);

  const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) {
    throw new AppError('SUPPLIER_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
  }

  const requestedSalesOrderId = input.salesOrderId ? toPositiveInteger(input.salesOrderId, 'PURCHASE_ORDER_INVALID_SALES_ORDER_ID') : null;
  const salesOrder = requestedSalesOrderId
    ? await tx.order.findUnique({
        where: { id: requestedSalesOrderId },
        select: { id: true, orderNo: true, status: true },
      })
    : null;
  if (requestedSalesOrderId && !salesOrder) {
    throw new AppError('SALES_ORDER_NOT_FOUND', 404, ErrorCode.NOT_FOUND);
  }
  if (salesOrder?.status === 'cancelled') {
    throw new AppError('SALES_ORDER_CANCELLED', 409, ErrorCode.CONFLICT);
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

  return tx.purchaseOrder.create({
    data: {
      supplierId,
      item,
      quantity,
      unit: toOptionalText(input.unit) || 'kg',
      price,
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
      eta,
      status: initialStatus,
      salesOrderRef: toOptionalText(input.salesOrderRef) || salesOrder?.orderNo || null,
      salesOrderId: salesOrder ? salesOrder.id : requestedSalesOrderId,
      isB2B: Boolean(input.isB2B),
    },
    include: { supplier: true, salesOrder: true },
  });
}
