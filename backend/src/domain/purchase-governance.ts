import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { productionQualityCharacteristicSchema } from '../validators/production';
import { addMoney, multiplyMoney, prorateMoney, roundMoney } from '../utils/money';

const money = z.number().finite().nonnegative().refine(value =>
  Number.isSafeInteger(Math.round(value * 100)) && Math.abs(roundMoney(value) - value) < 0.0000001, '金额须为有效的两位小数');
const bindingSchema = z.object({
  revision: z.number().int().nonnegative(), supplierId: z.number().int().positive(),
  materialId: z.number().int().positive().nullable(), unit: z.string().trim().min(1).max(30),
  quantity: z.number().finite().positive(), price: z.number().finite().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/), exchangeRate: z.number().finite().positive(),
}).strict().refine(value => value.currency !== 'CNY' || value.exchangeRate === 1, '人民币采购汇率必须为 1');
export type PurchaseGovernanceBinding = z.infer<typeof bindingSchema>;

export const supplierPayableTermsSchema = z.object({
  taxTreatment: z.enum(['included_in_price', 'additional_supplier_tax', 'none_or_third_party']),
  supplierTaxAmount: money, supplierChargesAmount: money,
  evidenceRef: z.string().trim().min(3).max(200),
}).strict().refine(value => value.taxTreatment === 'additional_supplier_tax' || value.supplierTaxAmount === 0,
  '价内税及第三方税费不得重复增加供应商应付');

export const incomingQualityPlanSchema = z.object({
  specificationRef: z.string().trim().min(3).max(200),
  specificationRevision: z.string().trim().min(1).max(80),
  characteristics: z.array(productionQualityCharacteristicSchema).min(1).max(100),
}).strict().superRefine((plan, context) => {
  const codes = plan.characteristics.map(item => item.code.toUpperCase());
  if (new Set(codes).size !== codes.length) context.addIssue({ code: 'custom', path: ['characteristics'], message: '检验项目编码不能重复' });
  if (!plan.characteristics.some(item => item.required)) context.addIssue({ code: 'custom', path: ['characteristics'], message: '至少提供一个必检项目' });
  plan.characteristics.forEach((item, index) => {
    if (!item.testMethod) context.addIssue({ code: 'custom', path: ['characteristics', index, 'testMethod'], message: '来料检验必须注明方法' });
    if (item.valueType === 'numeric' && item.lowerLimit != null && item.upperLimit != null) {
      try {
        if (new Prisma.Decimal(item.lowerLimit).greaterThan(new Prisma.Decimal(item.upperLimit))) {
          context.addIssue({ code: 'custom', path: ['characteristics', index, 'upperLimit'], message: '精确上限不能小于下限' });
        }
      } catch { context.addIssue({ code: 'custom', path: ['characteristics', index], message: '检验限值须为有效十进制数字' }); }
    }
    if (item.valueType === 'text' && (item.lowerLimit != null || item.upperLimit != null)) {
      context.addIssue({ code: 'custom', path: ['characteristics', index], message: '文本检验不得混用数值阈值' });
    }
    if (item.valueType === 'numeric' && item.targetText) {
      context.addIssue({ code: 'custom', path: ['characteristics', index, 'targetText'], message: '数值检验不得混用文本合格结论' });
    }
    if (item.valueType === 'text' && !item.targetText?.split('|').some(target => target.trim())) {
      context.addIssue({ code: 'custom', path: ['characteristics', index, 'targetText'], message: '文本检验须有明确合格目标' });
    }
  });
});

const checkedMoney = (value: number) => {
  const result = money.safeParse(value);
  if (!result.success) throw new AppError('PURCHASE_PAYABLE_AMOUNT_INVALID', 400, ErrorCode.VALIDATION_ERROR);
  return result.data;
};

const bindOrder = (binding: PurchaseGovernanceBinding) => {
  const parsed = bindingSchema.safeParse(binding);
  if (!parsed.success) throw new AppError('PURCHASE_GOVERNANCE_INPUT_INVALID', 400, ErrorCode.VALIDATION_ERROR, { issues: parsed.error.issues });
  return parsed.data;
};

export function freezeSupplierPayableBasis(binding: PurchaseGovernanceBinding, raw: unknown) {
  const bound = bindOrder(binding), terms = supplierPayableTermsSchema.parse(raw);
  const goodsAmountNative = checkedMoney(multiplyMoney(bound.price, bound.quantity));
  const amountNative = checkedMoney(addMoney(goodsAmountNative, terms.supplierTaxAmount, terms.supplierChargesAmount));
  // Procurement stores 1 CNY = X foreign units; inventory landed costs are
  // intentionally NOT used to infer supplier tax/charges or historical AP.
  const amountBase = checkedMoney(bound.currency === 'CNY' ? amountNative : prorateMoney(amountNative, 1, bound.exchangeRate));
  return { schema: 'supplier-payable-basis/v1' as const, binding: bound, terms,
    goodsAmountNative, amountNative, amountBase, baseCurrency: 'CNY' as const, rateDirection: 'foreign_per_CNY' as const };
}

export function freezeIncomingQualityPlan(binding: PurchaseGovernanceBinding, raw: unknown) {
  const bound = bindOrder(binding), input = incomingQualityPlanSchema.parse(raw);
  const plan = { ...input, characteristics: input.characteristics.map((item, index) => ({
    code: item.code.toUpperCase(), name: item.name, valueType: item.valueType, unit: item.unit || null,
    lowerLimit: item.lowerLimit == null ? null : new Prisma.Decimal(item.lowerLimit).toString(),
    upperLimit: item.upperLimit == null ? null : new Prisma.Decimal(item.upperLimit).toString(),
    targetText: item.targetText || null, testMethod: item.testMethod!, required: item.required, sortOrder: item.sortOrder ?? index,
  })) };
  return { schema: 'purchase-incoming-quality/v1' as const, binding: bound, plan };
}

export function purchaseGovernanceSnapshots(binding: PurchaseGovernanceBinding, terms?: unknown, plan?: unknown) {
  return {
    supplierPayableBasisJson: terms === undefined ? null : JSON.stringify(freezeSupplierPayableBasis(binding, terms)),
    incomingQualityPlanJson: plan === undefined ? null : JSON.stringify(freezeIncomingQualityPlan(binding, plan)),
  };
}

const payableSnapshotSchema = z.object({
  schema: z.literal('supplier-payable-basis/v1'), binding: bindingSchema, terms: supplierPayableTermsSchema,
  goodsAmountNative: money, amountNative: money, amountBase: money,
  baseCurrency: z.literal('CNY'), rateDirection: z.literal('foreign_per_CNY'),
}).strict();
const qualitySnapshotSchema = z.object({
  schema: z.literal('purchase-incoming-quality/v1'), binding: bindingSchema, plan: incomingQualityPlanSchema,
}).strict();

const parseStored = (raw: string | null | undefined) => {
  if (!raw) throw new AppError('PURCHASE_GOVERNANCE_SOURCE_REQUIRED', 409, ErrorCode.CONFLICT);
  try { return JSON.parse(raw); }
  catch { throw new AppError('PURCHASE_GOVERNANCE_SOURCE_INVALID', 409, ErrorCode.CONFLICT); }
};

export function requireSupplierPayableBasis(binding: PurchaseGovernanceBinding, raw: string | null | undefined) {
  const parsed = payableSnapshotSchema.safeParse(parseStored(raw));
  if (!parsed.success) throw new AppError('PURCHASE_GOVERNANCE_SOURCE_INVALID', 409, ErrorCode.CONFLICT);
  const expected = freezeSupplierPayableBasis(binding, parsed.data.terms);
  if (JSON.stringify(parsed.data) !== JSON.stringify(expected)) throw new AppError('PURCHASE_GOVERNANCE_SOURCE_CHANGED', 409, ErrorCode.CONFLICT);
  return expected;
}

export function requireIncomingQualityPlan(binding: PurchaseGovernanceBinding, raw: string | null | undefined) {
  const parsed = qualitySnapshotSchema.safeParse(parseStored(raw));
  if (!parsed.success) throw new AppError('PURCHASE_GOVERNANCE_SOURCE_INVALID', 409, ErrorCode.CONFLICT);
  const expected = freezeIncomingQualityPlan(binding, parsed.data.plan);
  if (JSON.stringify(parsed.data) !== JSON.stringify(expected)) throw new AppError('PURCHASE_GOVERNANCE_SOURCE_CHANGED', 409, ErrorCode.CONFLICT);
  return expected;
}
