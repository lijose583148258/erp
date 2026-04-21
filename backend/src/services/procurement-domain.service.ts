import type { Prisma } from '@prisma/client';

export function normalizeSupplierAliases(value: unknown): string[] {
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

export function serializeSupplierAliases(value: unknown): string | null {
  const aliases = normalizeSupplierAliases(value);
  return aliases.length > 0 ? JSON.stringify(aliases) : null;
}

export function parseSupplierAliases(value: string | null | undefined): string[] {
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

export function normalizeJsonList<T extends Record<string, unknown>>(value: unknown): T[] {
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

export function serializeJsonList(value: unknown): string | null {
  const rows = normalizeJsonList(value);
  return rows.length > 0 ? JSON.stringify(rows) : null;
}

export function getSupplierDisplayName(supplier: {
  name?: string;
  nameZh?: string | null;
  nameEn?: string | null;
  nameVi?: string | null;
}) {
  return supplier.nameZh || supplier.nameEn || supplier.nameVi || supplier.name || '';
}

export function buildSupplierSearchClause(search: unknown, includeSensitive: boolean) {
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

export function mapSupplier(supplier: any, includeSensitive = true) {
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

export function normalizeCurrency(value: unknown) {
  const normalized = String(value || 'CNY').trim().toUpperCase();
  return normalized || 'CNY';
}

export function mapPurchaseOrder(order: any) {
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

export function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

export function calculatePurchaseValuation(input: {
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

export function resolveReceiptUnitCost(order: { landedUnitCost?: number | null; price?: number | null }) {
  const landedUnitCost = toFiniteNumber(order.landedUnitCost, 0);
  if (landedUnitCost > 0) return landedUnitCost;
  return toFiniteNumber(order.price, 0);
}

export function resolveReceiptCostAmount(
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

export function normalizePurchaseStatus(status: string | null | undefined) {
  const normalized = String(status || 'pending');
  if (normalized === 'confirmed') return 'approved';
  if (normalized === 'shipped') return 'in_transit';
  if (normalized === 'delivered') return 'received';
  return normalized;
}

export function canTransitionPurchaseStatus(currentStatus: string, nextStatus: string) {
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
