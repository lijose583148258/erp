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

export type ProcurementFormErrors = Record<string, string>;

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

export const validateSupplierForm = (form: NewSupplierForm): ProcurementFormErrors => {
  const errors: ProcurementFormErrors = {};
  if (!form.name.trim()) errors.name = '供应商名称不能为空';
  if (!form.category.trim()) errors.category = '供应品类不能为空';
  if (form.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim())) {
    errors.contactEmail = '邮箱格式不正确';
  }
  const rating = Number(form.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) errors.rating = '评级必须在 1 到 5 之间';
  const leadTimeDays = Number(form.leadTimeDays);
  if (!Number.isFinite(leadTimeDays) || leadTimeDays < 0) errors.leadTimeDays = '交期不能为负数';
  return errors;
};

const isNonNegativeNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
};

export const validatePurchaseOrderForm = (form: NewPurchaseOrderForm, isB2B: boolean): ProcurementFormErrors => {
  const errors: ProcurementFormErrors = {};
  const quantity = Number(form.quantity);
  const price = Number(form.price);
  const exchangeRate = Number(form.exchangeRate);

  if (!form.supplierId) errors.supplierId = '请选择供应商';
  if (!form.item.trim()) errors.item = '请填写采购物料';
  if (!Number.isFinite(quantity) || quantity <= 0) errors.quantity = '数量必须大于 0';
  if (!form.unit.trim()) errors.unit = '单位不能为空';
  if (!Number.isFinite(price) || price < 0) errors.price = '单价不能为负数';
  if (!form.currency.trim()) errors.currency = '请选择币种';
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) errors.exchangeRate = '汇率必须大于 0';
  if (!isNonNegativeNumber(form.taxRate)) errors.taxRate = '税率不能为负数';
  if (form.taxAmount.trim() && !isNonNegativeNumber(form.taxAmount)) errors.taxAmount = '税额不能为负数';
  if (!isNonNegativeNumber(form.freightCost)) errors.freightCost = '运费不能为负数';
  if (!isNonNegativeNumber(form.dutyCost)) errors.dutyCost = '关税不能为负数';
  if (!isNonNegativeNumber(form.insuranceCost)) errors.insuranceCost = '保险费不能为负数';
  if (!isNonNegativeNumber(form.otherCost)) errors.otherCost = '其他费用不能为负数';
  if (form.eta && Number.isNaN(Date.parse(form.eta))) errors.eta = '预计到货日期无效';
  if (isB2B && !form.salesOrderRef) errors.salesOrderRef = '背靠背采购必须选择关联销售订单';

  return errors;
};

export const validatePurchaseReceiptForm = (
  form: PurchaseReceiptForm,
  order: PurchaseOrder,
  bundle?: PurchaseReceiptBundle | null,
): ProcurementFormErrors => {
  const errors: ProcurementFormErrors = {};
  const quantity = Number(form.quantity);
  const acceptedQuantity = Number(form.acceptedQuantity || 0);
  const rejectedQuantity = Number(form.rejectedQuantity || 0);
  const remainingQuantity = Number(bundle?.receiptSummary.remainingQuantity ?? order.quantity ?? 0);

  if (!Number.isFinite(quantity) || quantity <= 0) errors.quantity = '本次数量必须大于 0';
  if (!Number.isFinite(acceptedQuantity) || acceptedQuantity < 0) errors.acceptedQuantity = '合格数量不能为负数';
  if (!Number.isFinite(rejectedQuantity) || rejectedQuantity < 0) errors.rejectedQuantity = '差异数量不能为负数';
  if (Number.isFinite(quantity) && Number.isFinite(acceptedQuantity) && Number.isFinite(rejectedQuantity)
    && Math.abs(quantity - acceptedQuantity - rejectedQuantity) > 0.000001) {
    errors.quantity = '本次数量必须等于合格数量与差异数量之和';
  }
  if (Number.isFinite(quantity) && quantity - remainingQuantity > 0.000001) {
    errors.quantity = `本次数量不能超过剩余 ${remainingQuantity}`;
  }

  return errors;
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
