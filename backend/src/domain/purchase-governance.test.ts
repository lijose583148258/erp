import {
  freezeIncomingQualityPlan, freezeSupplierPayableBasis, incomingQualityPlanSchema,
  purchaseGovernanceSnapshots, requireIncomingQualityPlan, requireSupplierPayableBasis,
  supplierPayableTermsSchema, type PurchaseGovernanceBinding,
} from './purchase-governance';

const binding: PurchaseGovernanceBinding = { revision: 0, supplierId: 2, materialId: 3, unit: 'kg', quantity: 100,
  price: 10, currency: 'USD', exchangeRate: 0.125 };
const terms = { taxTreatment: 'additional_supplier_tax' as const, supplierTaxAmount: 100, supplierChargesAmount: 50, evidenceRef: 'SUPPLIER-QUOTE-001' };
const plan = { specificationRef: 'INCOMING-RESIN', specificationRevision: '2026-r1', characteristics: [
  { code: 'ph', name: 'pH', valueType: 'numeric' as const, lowerLimit: '7.0', upperLimit: '8.0', testMethod: 'Calibrated pH meter', required: true },
  { code: 'appearance', name: 'Appearance', valueType: 'text' as const, targetText: 'clear|transparent', testMethod: 'Visual', required: true },
] };

describe('PO revision-bound supplier liability and incoming inspection snapshots', () => {
  it('derives supplier liability in native currency and divides by the frozen procurement FX', () => {
    const snapshot = freezeSupplierPayableBasis(binding, terms);
    expect(snapshot).toMatchObject({ goodsAmountNative: 1000, amountNative: 1150, amountBase: 9200,
      baseCurrency: 'CNY', rateDirection: 'foreign_per_CNY', binding, terms });
  });

  it('does not infer supplier debts from inventory tax, freight or landed cost', () => {
    const actual = freezeSupplierPayableBasis(binding, { ...terms, taxTreatment: 'none_or_third_party', supplierTaxAmount: 0, supplierChargesAmount: 0 });
    expect(actual.amountNative).toBe(1000); expect(actual.amountBase).toBe(8000);
    expect(actual).not.toHaveProperty('landedCostAmount');
  });

  it('never invents legacy or unconfirmed snapshots as zero AP or not_required QC', () => {
    expect(purchaseGovernanceSnapshots(binding)).toEqual({ supplierPayableBasisJson: null, incomingQualityPlanJson: null });
    expect(() => requireSupplierPayableBasis(binding, null)).toThrow('SOURCE_REQUIRED');
    expect(() => requireIncomingQualityPlan(binding, null)).toThrow('SOURCE_REQUIRED');
    expect(() => requireSupplierPayableBasis(binding, '{')).toThrow('SOURCE_INVALID');
  });

  it.each(['included_in_price', 'none_or_third_party'])('does not add supplier tax again for %s', taxTreatment => {
    expect(supplierPayableTermsSchema.safeParse({ ...terms, taxTreatment }).success).toBe(false);
    expect(freezeSupplierPayableBasis(binding, { ...terms, taxTreatment, supplierTaxAmount: 0 }).amountNative).toBe(1050);
  });

  it.each([undefined, null, NaN, Infinity, -0.01, 0.001, Number.MAX_SAFE_INTEGER])('rejects incomplete/unsafe explicit supplier tax %s', supplierTaxAmount => {
    expect(supplierPayableTermsSchema.safeParse({ ...terms, supplierTaxAmount }).success).toBe(false);
  });

  it('requires accountable quote evidence and rejects client-computed amounts or result flags', () => {
    for (const extra of [{ evidenceRef: '' }, { amountNative: 1 }, { amountBase: 1 }, { passed: true }]) {
      expect(supplierPayableTermsSchema.safeParse({ ...terms, ...extra }).success).toBe(false);
    }
  });

  it('rejects wrong CNY FX and nonfinite binding values instead of quietly correcting them', () => {
    for (const invalid of [{ currency: 'CNY', exchangeRate: 2 }, { exchangeRate: 0 }, { exchangeRate: Infinity },
      { quantity: NaN }, { price: Infinity }, { supplierId: 0 }, { revision: -1 }]) {
      expect(() => freezeSupplierPayableBasis({ ...binding, ...invalid }, terms)).toThrow('INPUT_INVALID');
    }
  });

  it('fails closed on overflow after individually valid inputs or FX conversion', () => {
    expect(() => freezeSupplierPayableBasis({ ...binding, quantity: 1e15 }, terms)).toThrow('AMOUNT_INVALID');
    expect(() => freezeSupplierPayableBasis({ ...binding, exchangeRate: 1e-15 }, terms)).toThrow('AMOUNT_INVALID');
  });

  it('canonicalizes frozen standard text and decimal bounds without retaining live characteristic IDs', () => {
    const frozen = freezeIncomingQualityPlan(binding, plan);
    expect(frozen.plan.characteristics[0]).toMatchObject({ code: 'PH', lowerLimit: '7', upperLimit: '8', unit: null, sortOrder: 0 });
    expect(frozen.plan.characteristics[1]).toMatchObject({ code: 'APPEARANCE', lowerLimit: null, upperLimit: null, targetText: 'clear|transparent', sortOrder: 1 });
    expect(frozen.plan.characteristics[0]).not.toHaveProperty('id');
    const source = purchaseGovernanceSnapshots(binding, terms, plan);
    expect(requireIncomingQualityPlan(binding, source.incomingQualityPlanJson)).toEqual(frozen);
    expect(requireSupplierPayableBasis(binding, source.supplierPayableBasisJson)).toEqual(freezeSupplierPayableBasis(binding, terms));
    plan.characteristics[0].lowerLimit = '6';
    expect(requireIncomingQualityPlan(binding, source.incomingQualityPlanJson).plan.characteristics[0].lowerLimit).toBe('7');
    plan.characteristics[0].lowerLimit = '7.0';
  });

  it('rejects empty/optional-only/duplicate/ambiguous standards rather than treating them as a release', () => {
    const character = plan.characteristics[0];
    for (const characteristics of [[], [{ ...character, required: false }], [character, { ...character, code: 'PH' }],
      [{ ...character, testMethod: '' }], [{ ...character, lowerLimit: 'NaN' }], [{ ...character, lowerLimit: 'Infinity' }],
      [{ ...character, lowerLimit: '7.000000000000000001', upperLimit: '7.000000000000000000' }],
      [{ ...plan.characteristics[1], lowerLimit: 1 }], [{ ...character, passed: true }]]) {
      expect(() => incomingQualityPlanSchema.safeParse({ ...plan, characteristics })).not.toThrow();
      expect(incomingQualityPlanSchema.safeParse({ ...plan, characteristics }).success).toBe(false);
    }
    expect(incomingQualityPlanSchema.safeParse({ ...plan, characteristics: [{ ...plan.characteristics[1], targetText: ' | | ' }] }).success).toBe(false);
    expect(incomingQualityPlanSchema.safeParse({ ...plan, characteristics: [{ ...character, targetText: 'PASS' }] }).success).toBe(false);
  });

  it.each(['revision', 'quantity', 'price', 'supplierId', 'materialId', 'unit', 'currency', 'exchangeRate'] as const)('rejects stale or transplanted %s binding', key => {
    const source = purchaseGovernanceSnapshots(binding, terms, plan);
    const changed = { ...binding, [key]: key === 'unit' ? 'g' : key === 'currency' ? 'EUR' : Number(binding[key]) + 1 };
    expect(() => requireSupplierPayableBasis(changed, source.supplierPayableBasisJson)).toThrow('SOURCE_CHANGED');
    expect(() => requireIncomingQualityPlan(changed, source.incomingQualityPlanJson)).toThrow('SOURCE_CHANGED');
  });

  it('recomputes native/base money and rejects hidden snapshot properties', () => {
    const source = purchaseGovernanceSnapshots(binding, terms, plan);
    const original = JSON.parse(source.supplierPayableBasisJson!);
    for (const change of [{ amountNative: 1 }, { amountBase: 1 }, { goodsAmountNative: 1 }, { rateDirection: 'CNY_per_foreign' }, { paidAmount: 1150 }]) {
      expect(() => requireSupplierPayableBasis(binding, JSON.stringify({ ...original, ...change }))).toThrow('SOURCE_');
    }
  });
});
