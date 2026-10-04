import { MASS_PERCENTAGE_V1, massPercentageQuantityV1, massRequiredQuantityV1, assertMassSnapshotV1 } from './production-mass-basis';
import { assertBomPercentageUnits } from '../services/production-unit-safety.service';
import { assertBomConsumptionCoverage } from '../services/production-completion.validation';

describe('immutable explicit mass percentage v1 contract', () => {
  it.each([[100, 'g', 'kg', 1000], [100, 'kg', 't', 1000], [100, 't', 'kg', 0.001],
    [35, 'g', 'kg', 350], [0.000001, 'mg', 'kg', 0.01], [100, '公斤', '吨', 1000], [50, ' KG ', 'kg', 0.5]])
  ('converts %s%% %s/%s without floating multiplication', (percentage, input, output, expected) => {
    expect(massPercentageQuantityV1(percentage, String(input), String(output))).toBe(expected);
  });
  it.each(['L', '桶', 'constructor', '__proto__', 'unknown'])('never guesses a mass for %s', unit => {
    expect(() => massPercentageQuantityV1(100, unit, 'kg')).toThrow('BOM_UNIT_MASS_BASIS_REQUIRED');
  });
  it.each([0, -1, 101, Infinity, NaN, ''])('rejects invalid percentage %s', percentage => {
    expect(() => massPercentageQuantityV1(percentage, 'g', 'kg')).toThrow('BOM_UNIT_');
  });
  it('rejects unrepresentable per-unit or actual quantities instead of rounding to zero', () => {
    expect(() => massPercentageQuantityV1(0.00000001, 'g', 'kg')).toThrow('PRECISION_UNSUPPORTED');
    expect(() => massRequiredQuantityV1(0.000001, 0.1)).toThrow('PRECISION_UNSUPPORTED');
    expect(() => massRequiredQuantityV1(1e12, 1e12)).toThrow('QUANTITY_TOO_LARGE');
    expect(massRequiredQuantityV1(0.1, 3)).toBe(0.3);
    expect(massRequiredQuantityV1(1000, 10, 2)).toBe(10200);
  });
  it('checks the frozen tuple, refuses unknown rule versions and preserves legacy rejection', () => {
    const item = { dosageMode: MASS_PERCENTAGE_V1, unit: 'g', percentage: 100, quantityPerUnit: 1000 };
    expect(() => assertBomPercentageUnits({ outputUnit: 'kg', items: [item] })).not.toThrow();
    expect(() => assertMassSnapshotV1({ ...item, quantityPerUnit: 1 }, 'kg')).toThrow('MASS_SNAPSHOT_MISMATCH');
    expect(() => assertBomPercentageUnits({ outputUnit: 'kg', items: [{ ...item, dosageMode: 'mass_percentage_v2' }] })).toThrow('VERSION_UNSUPPORTED');
    expect(() => assertBomPercentageUnits({ outputUnit: 'kg', items: [{ ...item, dosageMode: 'percentage' }] })).toThrow('PERCENTAGE_BASIS_REQUIRED');
  });
  it('does not permit the legacy 0.001 tolerance floor to swallow micro-quantity errors', () => {
    const item = { materialId: 1, dosageMode: MASS_PERCENTAGE_V1, quantityPerUnit: 0.000001, unit: 'kg', allowedVarianceRate: 0 };
    const stock = { materialId: 1, unit: 'kg' };
    expect(() => assertBomConsumptionCoverage([item], [{ stock, quantity: 0.000001 }], 1)).not.toThrow();
    expect(() => assertBomConsumptionCoverage([item], [{ stock, quantity: 0.000002 }], 1)).toThrow('above expected');
  });
});
