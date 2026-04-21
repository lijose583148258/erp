import type { PurchaseOrder, PurchaseReceiptBundle } from '../../services/procurement.service';

export type NewSupplierForm = {
  name: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  nameAliases: string;
  category: string;
  rating: string;
  leadTimeDays: string;
  riskLevel: string;
  contact: string;
  contactPhone: string;
  contactEmail: string;
  addressLabel: string;
  addressCountryCode: string;
  addressCity: string;
  addressFullAddress: string;
};

export type NewPurchaseOrderForm = {
  supplierId: string;
  item: string;
  quantity: string;
  unit: string;
  price: string;
  currency: string;
  exchangeRate: string;
  taxRate: string;
  taxAmount: string;
  freightCost: string;
  dutyCost: string;
  insuranceCost: string;
  otherCost: string;
  eta: string;
  salesOrderRef: string;
};

export type PurchaseReceiptForm = {
  quantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  batchNo: string;
  discrepancyReason: string;
  note: string;
};

export type PurchaseCostPreview = {
  landedCostAmount: number;
  landedUnitCost: number;
};

export const createEmptySupplierForm = (): NewSupplierForm => ({
  name: '',
  nameZh: '',
  nameEn: '',
  nameVi: '',
  nameAliases: '',
  category: '',
  rating: '4',
  leadTimeDays: '7',
  riskLevel: 'medium',
  contact: '',
  contactPhone: '',
  contactEmail: '',
  addressLabel: '',
  addressCountryCode: '',
  addressCity: '',
  addressFullAddress: '',
});

export const createEmptyPurchaseOrderForm = (): NewPurchaseOrderForm => ({
  supplierId: '',
  item: '',
  quantity: '10',
  unit: '件',
  price: '7200',
  currency: 'CNY',
  exchangeRate: '1',
  taxRate: '0',
  taxAmount: '',
  freightCost: '0',
  dutyCost: '0',
  insuranceCost: '0',
  otherCost: '0',
  eta: '',
  salesOrderRef: '',
});

export const createEmptyReceiptForm = (): PurchaseReceiptForm => ({
  quantity: '',
  acceptedQuantity: '',
  rejectedQuantity: '0',
  batchNo: '',
  discrepancyReason: '',
  note: '',
});

export const splitAliases = (value: string) =>
  value
    .split(/[\n,;\uFF0C\u3001]+/)
    .map((item) => item.trim())
    .filter(Boolean);

export const upsertById = <T extends { id: string }>(item: T, list: T[]) => [
  item,
  ...list.filter((current) => String(current.id) !== String(item.id)),
];

export const parseNumericInput = (value: string, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const roundMoney = (value: number) => Math.round(value * 100) / 100;

export const mergePreservingLocalWrites = <T extends { id: string }>(localFirst: T[], serverList: T[]) => {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of [...localFirst, ...serverList]) {
    const key = String(item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
};

export const calculatePurchaseCostPreview = (newOrder: NewPurchaseOrderForm): PurchaseCostPreview => {
  const quantity = parseNumericInput(newOrder.quantity);
  const price = parseNumericInput(newOrder.price);
  const exchangeRate = Math.max(parseNumericInput(newOrder.exchangeRate, 1), 0.000001);
  const taxRate = Math.max(parseNumericInput(newOrder.taxRate), 0);
  const itemAmount = quantity * price;
  const baseItemAmount = newOrder.currency === 'CNY' ? itemAmount : itemAmount / exchangeRate;
  const explicitTaxAmount = newOrder.taxAmount.trim() ? parseNumericInput(newOrder.taxAmount) : null;
  const taxAmount = explicitTaxAmount === null ? baseItemAmount * (taxRate / 100) : explicitTaxAmount;
  const landedCostAmount = roundMoney(
    baseItemAmount
    + taxAmount
    + parseNumericInput(newOrder.freightCost)
    + parseNumericInput(newOrder.dutyCost)
    + parseNumericInput(newOrder.insuranceCost)
    + parseNumericInput(newOrder.otherCost),
  );

  return {
    landedCostAmount,
    landedUnitCost: quantity > 0 ? roundMoney(landedCostAmount / quantity) : 0,
  };
};

export const createReceiptFormForOrder = (
  order?: PurchaseOrder | null,
  bundle?: PurchaseReceiptBundle | null,
): PurchaseReceiptForm => {
  const remaining = bundle?.receiptSummary.remainingQuantity ?? order?.quantity ?? 0;
  const nextQuantity = remaining > 0 ? String(remaining) : '';
  return {
    quantity: nextQuantity,
    acceptedQuantity: nextQuantity,
    rejectedQuantity: '0',
    batchNo: order ? `${order.item}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}` : '',
    discrepancyReason: '',
    note: '',
  };
};
