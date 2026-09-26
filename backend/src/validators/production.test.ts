import {
  createProductionBomSchema,
  createProductionQualityCheckSchema,
} from './production';

const validBom = {
  productName: '水性丙烯酸乳液',
  version: '1.0',
  bomType: 'chemical_formula',
  status: 'active',
  formulationMode: 'percentage',
  outputUnit: 'kg',
  shelfLifeDays: 365,
  standardBatchSize: 1000,
  batchSizeUnit: 'kg',
  qualityCharacteristics: [{
    code: 'PH',
    name: 'pH',
    valueType: 'numeric',
    lowerLimit: 7,
    upperLimit: 8,
  }],
  items: [
    { materialCode: 'RESIN-01', dosageMode: 'percentage', percentage: 80, quantityPerUnit: 800, unit: 'kg' },
    { materialCode: 'ADDITIVE-01', dosageMode: 'percentage', percentage: 20, quantityPerUnit: 200, unit: 'kg' },
  ],
};

describe('production request validation', () => {
  it('accepts a controlled chemical formula with 100% material allocation and structured quality limits', () => {
    expect(createProductionBomSchema.safeParse(validBom).success).toBe(true);
  });

  it('rejects percentage formulas whose material allocation does not total approximately 100%', () => {
    const parsed = createProductionBomSchema.safeParse({
      ...validBom,
      items: validBom.items.map((item, index) => index === 1 ? { ...item, percentage: 10 } : item),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some(issue => issue.message.includes('100%'))).toBe(true);
  });

  it('rejects active chemical formulas without a structured quality specification', () => {
    const parsed = createProductionBomSchema.safeParse({ ...validBom, qualityCharacteristics: [] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some(issue => issue.path[0] === 'qualityCharacteristics')).toBe(true);
  });

  it('rejects duplicate measurements at the HTTP contract boundary', () => {
    const parsed = createProductionQualityCheckSchema.safeParse({
      sampleNo: 'S-001',
      measurements: [
        { characteristicId: 10, measuredNumeric: '7.2' },
        { characteristicId: 10, measuredNumeric: '7.3' },
      ],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some(issue => issue.message.includes('不能重复'))).toBe(true);
  });
});
