import { Prisma } from '@prisma/client';
import { freezeSupplierPayableBasis } from './purchase-governance';
import { buildPurchaseReceiptPayable, payableMoney, requireReceiptPayableSource, type BuildPurchaseReceiptPayableInput } from './purchase-payable';

const input = (change: Partial<BuildPurchaseReceiptPayableInput> = {}): BuildPurchaseReceiptPayableInput => {
  const binding = { revision: 1, supplierId: 2, materialId: 3, unit: 'kg', quantity: 3, price: 1 / 3, currency: 'CNY', exchangeRate: 1 };
  return { purchaseOrderId: 4, receiptNo: 'PRC-5', supplierBatchNo: 'Supplier lot 6', batchNo: 'Internal-5', receivedBy: 7,
    binding, supplierPayableBasisJson: JSON.stringify(freezeSupplierPayableBasis(binding,
      { taxTreatment: 'none_or_third_party', supplierTaxAmount: 0, supplierChargesAmount: 0, evidenceRef: 'Quote 8' })),
    sourceAuditId: 9, approvalAuditId: 10, receivedQuantity: 0.5, receivedQuantityBefore: 0,
    postedAmountNativeBefore: 0, postedAmountBaseBefore: 0, ...change };
};
const receipt = (i = input()) => {
  const result = buildPurchaseReceiptPayable(i);
  return { purchaseOrderId: i.purchaseOrderId, receiptNo: i.receiptNo, supplierBatchNo: i.supplierBatchNo, batchNo: i.batchNo,
    receivedBy: i.receivedBy, acceptedQuantity: i.receivedQuantity, payableAmountNative: result.payableAmountNative,
    payableAmountBase: result.payableAmountBase, payableSnapshotJson: result.payableSnapshotJson };
};
test('six real half-unit receipts conserve both independently allocated currencies', () => {
  for (const currency of ['CNY', 'USD']) {
    const i = input(), rate = currency === 'CNY' ? 1 : 0.14;
    i.binding = { ...i.binding, currency, exchangeRate: rate };
    i.supplierPayableBasisJson = JSON.stringify(freezeSupplierPayableBasis(i.binding,
      { taxTreatment: 'none_or_third_party', supplierTaxAmount: 0, supplierChargesAmount: 0, evidenceRef: 'Quote 8' }));
    let native = new Prisma.Decimal(0), base = new Prisma.Decimal(0);
    const deltas = [];
    for (let n = 0; n < 6; n++) {
      const result = buildPurchaseReceiptPayable({ ...i, receivedQuantityBefore: n / 2, postedAmountNativeBefore: native, postedAmountBaseBefore: base });
      deltas.push(result.payableAmountNative.toNumber()); native = native.plus(result.payableAmountNative); base = base.plus(result.payableAmountBase);
    }
    expect(deltas).toEqual([0.17, 0.16, 0.17, 0.17, 0.16, 0.17]); expect(native.toFixed(2)).toBe('1.00');
    expect(base.toFixed(2)).toBe(currency === 'CNY' ? '1.00' : '7.14');
  }
});
test('uses actual preceding AP, never ideal-history rounding or inventory landed cost', () => {
  const result = buildPurchaseReceiptPayable(input({ receivedQuantity: 1, receivedQuantityBefore: 2, postedAmountNativeBefore: '0.66', postedAmountBaseBefore: '0.66' }));
  expect(result.payableAmountNative.toFixed(2)).toBe('0.34'); expect(result.payableAmountBase.toFixed(2)).toBe('0.34');
  expect(result.snapshot.source.supplierPayableBasisJson).not.toContain('landedCost');
});
test('zero is valid only when explicitly proved, including genuinely free goods', () => {
  const i = input(); i.binding.price = 0;
  i.supplierPayableBasisJson = JSON.stringify(freezeSupplierPayableBasis(i.binding,
    { taxTreatment: 'none_or_third_party', supplierTaxAmount: 0, supplierChargesAmount: 0, evidenceRef: 'Free quote approved' }));
  const r = receipt(i); expect(requireReceiptPayableSource(r, i.binding).allocation.amountNative).toBe('0.00');
  expect(() => requireReceiptPayableSource({ ...r, payableAmountNative: null })).toThrow('RECONCILIATION_REQUIRED');
});
test.each([null, undefined, '', false, NaN, Infinity, -1, 0.001, 'unknown', '1e999', 90071992547410])('rejects unknown/unsafe money %p', value => {
  expect(() => payableMoney(value)).toThrow('RECONCILIATION_REQUIRED');
});
test.each([null, undefined, '', false, NaN, Infinity, -0.1, 0.0000001, 9007199255])('rejects invalid received quantities %p', receivedQuantity => {
  expect(() => buildPurchaseReceiptPayable(input({ receivedQuantity }))).toThrow('RECONCILIATION_REQUIRED');
});
test.each([
  { receivedQuantity: 4 }, { receivedQuantityBefore: null }, { postedAmountNativeBefore: null }, { postedAmountBaseBefore: null },
  { postedAmountNativeBefore: 0.01 }, { receivedQuantityBefore: 2, postedAmountNativeBefore: 1.01, postedAmountBaseBefore: 0.67 },
  { receivedQuantityBefore: 2, postedAmountNativeBefore: 0.99, postedAmountBaseBefore: 0.67 }, { sourceAuditId: 10 },
  { receivedQuantity: 0, receivedQuantityBefore: 2, postedAmountNativeBefore: 0.66, postedAmountBaseBefore: 0.66 },
])('refuses missing history, overreceipt, phantom AP, negative correction or ambiguous source %p', change => {
  expect(() => buildPurchaseReceiptPayable(input(change))).toThrow('RECONCILIATION_REQUIRED');
});
test('typed source validates independently and rejects altered snapshot or physical identities', () => {
  const i = input(), r = receipt(i); expect(requireReceiptPayableSource(r, i.binding).currency).toBe('CNY');
  for (const patch of [{ payableSnapshotJson: null }, { payableSnapshotJson: '{}' }, { payableAmountNative: 0.5 },
    { payableAmountBase: null }, { acceptedQuantity: 1 }, { purchaseOrderId: 99 }, { receiptNo: 'Other receipt' },
    { supplierBatchNo: 'Other lot' }, { batchNo: 'Other internal batch' }, { receivedBy: 99 }]) {
    expect(() => requireReceiptPayableSource({ ...r, ...patch })).toThrow('RECONCILIATION_REQUIRED');
  }
  const snapshot = JSON.parse(r.payableSnapshotJson);
  for (const changed of [
    { ...snapshot, extra: true }, { ...snapshot, rateDirection: 'CNY_per_foreign' },
    { ...snapshot, allocation: { ...snapshot.allocation, amountNative: '0.18' } },
    { ...snapshot, binding: { ...snapshot.binding, materialId: null } },
  ]) expect(() => requireReceiptPayableSource({ ...r, payableSnapshotJson: JSON.stringify(changed) })).toThrow('RECONCILIATION_REQUIRED');
  expect(() => requireReceiptPayableSource(r, { ...i.binding, revision: 2 })).toThrow('RECONCILIATION_REQUIRED');
});
