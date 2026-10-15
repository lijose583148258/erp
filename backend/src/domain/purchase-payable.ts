import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { requireSupplierPayableBasis, type PurchaseGovernanceBinding } from './purchase-governance';

const reject = (field: string): never => { throw new AppError('PURCHASE_PAYABLE_RECONCILIATION_REQUIRED', 409, ErrorCode.CONFLICT, { field }); };
export function payableMoney(value: unknown, field = 'amount'): Prisma.Decimal {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean'
    || !(typeof value === 'string' || typeof value === 'number' || value instanceof Prisma.Decimal)) return reject(field);
  let d: Prisma.Decimal;
  try { d = new Prisma.Decimal(String(value)); } catch { return reject(field); }
  if (!d.isFinite() || d.isNegative() || d.decimalPlaces() > 2 || !Number.isSafeInteger(d.times(100).toNumber())) return reject(field);
  return d;
}
function quantity(value: unknown, field: string): Prisma.Decimal {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean'
    || !(typeof value === 'string' || typeof value === 'number' || value instanceof Prisma.Decimal)) return reject(field);
  let d: Prisma.Decimal;
  try { d = new Prisma.Decimal(String(value)); } catch { return reject(field); }
  if (!d.isFinite() || d.isNegative() || d.decimalPlaces() > 6 || !Number.isSafeInteger(d.times(1000000).toNumber())) return reject(field);
  return d;
}
const id = z.number().int().positive().refine(Number.isSafeInteger);
const label = z.string().min(1).max(200);
const bindingSchema = z.object({ revision: z.number().int().nonnegative(), supplierId: id, materialId: id,
  unit: z.string().min(1).max(30), quantity: z.number().finite().positive(), price: z.number().finite().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/), exchangeRate: z.number().finite().positive() }).strict();
const decimalText = z.string().regex(/^\d+(?:\.\d+)?$/);
const snapshotSchema = z.object({
  schema: z.literal('purchase-receipt-payable/v1'), allocationPolicy: z.literal('cumulative_received_target_less_actual_posted/v1'),
  purchaseOrderId: id, receiptNo: label, supplierBatchNo: label, batchNo: label, receivedBy: id, binding: bindingSchema,
  source: z.object({ sourceAuditId: id, approvalAuditId: id, supplierPayableBasisJson: z.string().min(1) }).strict(),
  allocation: z.object({ receivedQuantity: decimalText, receivedQuantityBefore: decimalText, receivedQuantityAfter: decimalText,
    postedAmountNativeBefore: decimalText, postedAmountBaseBefore: decimalText, targetAmountNative: decimalText, targetAmountBase: decimalText,
    amountNative: decimalText, amountBase: decimalText }).strict(),
  currency: z.string().regex(/^[A-Z]{3}$/), baseCurrency: z.literal('CNY'), rateDirection: z.literal('foreign_per_CNY'),
}).strict();
export type PurchaseReceiptPayableSnapshot = z.infer<typeof snapshotSchema>;
export type BuildPurchaseReceiptPayableInput = {
  purchaseOrderId: number; receiptNo: string; supplierBatchNo: string; batchNo: string; receivedBy: number;
  binding: PurchaseGovernanceBinding; supplierPayableBasisJson: string; sourceAuditId: number; approvalAuditId: number;
  receivedQuantity: unknown; receivedQuantityBefore: unknown; postedAmountNativeBefore: unknown; postedAmountBaseBefore: unknown;
};
export function buildPurchaseReceiptPayable(input: BuildPurchaseReceiptPayableInput) {
  const binding = bindingSchema.safeParse(input.binding);
  if (!binding.success) reject('binding');
  const basis = requireSupplierPayableBasis(binding.data!, input.supplierPayableBasisJson);
  const ordered = quantity(binding.data!.quantity, 'orderedQuantity');
  const received = quantity(input.receivedQuantity, 'receivedQuantity'), before = quantity(input.receivedQuantityBefore, 'receivedQuantityBefore');
  const after = before.plus(received), nativeBefore = payableMoney(input.postedAmountNativeBefore, 'postedAmountNativeBefore');
  const baseBefore = payableMoney(input.postedAmountBaseBefore, 'postedAmountBaseBefore');
  if (ordered.isZero() || after.greaterThan(ordered) || (before.isZero() && (!nativeBefore.isZero() || !baseBefore.isZero()))) reject('receivedHistory');
  const nativeTotal = payableMoney(basis.amountNative), baseTotal = payableMoney(basis.amountBase);
  const nativeTarget = nativeTotal.times(after).dividedBy(ordered).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const baseTarget = baseTotal.times(after).dividedBy(ordered).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const native = nativeTarget.minus(nativeBefore), base = baseTarget.minus(baseBefore);
  if (native.isNegative() || base.isNegative() || nativeBefore.greaterThan(nativeTotal) || baseBefore.greaterThan(baseTotal)) reject('postedHistory');
  if (received.isZero() && (!native.isZero() || !base.isZero())) reject('noReceivedQuantityAllocation');
  const snapshot: PurchaseReceiptPayableSnapshot = {
    schema: 'purchase-receipt-payable/v1', allocationPolicy: 'cumulative_received_target_less_actual_posted/v1',
    purchaseOrderId: input.purchaseOrderId, receiptNo: input.receiptNo, supplierBatchNo: input.supplierBatchNo, batchNo: input.batchNo,
    receivedBy: input.receivedBy, binding: binding.data!,
    source: { sourceAuditId: input.sourceAuditId, approvalAuditId: input.approvalAuditId, supplierPayableBasisJson: input.supplierPayableBasisJson },
    allocation: { receivedQuantity: received.toFixed(), receivedQuantityBefore: before.toFixed(), receivedQuantityAfter: after.toFixed(),
      postedAmountNativeBefore: nativeBefore.toFixed(2), postedAmountBaseBefore: baseBefore.toFixed(2),
      targetAmountNative: nativeTarget.toFixed(2), targetAmountBase: baseTarget.toFixed(2), amountNative: native.toFixed(2), amountBase: base.toFixed(2) },
    currency: basis.binding.currency, baseCurrency: 'CNY', rateDirection: 'foreign_per_CNY',
  };
  if (!snapshotSchema.safeParse(snapshot).success || input.sourceAuditId === input.approvalAuditId) reject('sourceIdentity');
  return { payableAmountNative: native, payableAmountBase: base, payableSnapshotJson: JSON.stringify(snapshot), snapshot };
}
export interface ReceiptPayableSource {
  purchaseOrderId: number; receiptNo: string; supplierBatchNo: string | null; batchNo: string | null; receivedBy: number | null;
  acceptedQuantity: unknown; payableAmountNative: unknown; payableAmountBase: unknown; payableSnapshotJson: string | null;
}
export function requireReceiptPayableSource(receipt: ReceiptPayableSource, po?: PurchaseGovernanceBinding) {
  let raw: unknown;
  if (!receipt.payableSnapshotJson) reject('unknownHistoricalPayable');
  try { raw = JSON.parse(receipt.payableSnapshotJson!); } catch { return reject('payableSnapshotJson'); }
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) reject('payableSnapshotJson');
  const s = parsed.data!;
  if (po) {
    const current = bindingSchema.safeParse(po);
    if (!current.success || JSON.stringify(current.data) !== JSON.stringify(s.binding)) reject('orderBinding');
  }
  const expected = buildPurchaseReceiptPayable({ ...s, binding: s.binding, supplierPayableBasisJson: s.source.supplierPayableBasisJson,
    sourceAuditId: s.source.sourceAuditId, approvalAuditId: s.source.approvalAuditId,
    receivedQuantity: s.allocation.receivedQuantity, receivedQuantityBefore: s.allocation.receivedQuantityBefore,
    postedAmountNativeBefore: s.allocation.postedAmountNativeBefore, postedAmountBaseBefore: s.allocation.postedAmountBaseBefore });
  if (JSON.stringify(s) !== JSON.stringify(expected.snapshot)) reject('allocationSnapshot');
  for (const field of ['purchaseOrderId', 'receiptNo', 'supplierBatchNo', 'batchNo', 'receivedBy'] as const) if (receipt[field] !== s[field]) reject(field);
  if (!quantity(receipt.acceptedQuantity, 'acceptedQuantity').equals(s.allocation.receivedQuantity)
    || !payableMoney(receipt.payableAmountNative, 'payableAmountNative').equals(expected.payableAmountNative)
    || !payableMoney(receipt.payableAmountBase, 'payableAmountBase').equals(expected.payableAmountBase)) reject('typedPayable');
  return s;
}
export const requirePurchaseReceiptPayable = requireReceiptPayableSource;
