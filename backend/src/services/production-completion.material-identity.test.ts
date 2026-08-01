import {
  assertBomConsumptionCoverage,
  ProductionCompletionValidationError,
} from './production-completion.validation';

const bomItem = {
  id: 1,
  materialId: 7,
  materialCode: 'RM-0007',
  materialName: '树脂',
  quantityPerUnit: 1,
  unit: 'kg',
  allowedVarianceRate: 0,
};

describe('production completion material identity', () => {
  it('accepts an exact material identity even when the display name changed', () => {
    expect(() => assertBomConsumptionCoverage([bomItem], [{
      stock: { materialId: 7, productName: '新的规范名称', batchNo: 'RAW-001', unit: 'kg' },
      quantity: 10,
    }], 10)).not.toThrow();
  });

  it('rejects a similar free-text name when material identities differ', () => {
    expect(() => assertBomConsumptionCoverage([bomItem], [{
      stock: { materialId: 8, productName: '树脂', batchNo: 'RM-0007-BATCH', unit: 'kg' },
      quantity: 10,
    }], 10)).toThrow(ProductionCompletionValidationError);
  });

  it('keeps the exact legacy text fallback only when neither side has an identity', () => {
    expect(() => assertBomConsumptionCoverage([{ ...bomItem, materialId: null }], [{
      stock: { materialId: null, productName: '树脂', batchNo: 'RAW-001', unit: 'kg' },
      quantity: 10,
    }], 10)).not.toThrow();
  });
});
