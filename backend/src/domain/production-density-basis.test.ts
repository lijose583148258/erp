import { densityPercentageQuantityV1 } from './production-mass-basis';
import { DENSITY_PERCENTAGE_V1, parseWorkOrderDensityBases } from './production-density-basis';
import { assertBomConsumptionCoverage } from '../services/production-completion.validation';

describe('exact approved batch density v1 conversion', () => {
  it.each([
    ['mL', 'kg', '1.25', 800], ['L', 'kg', '1.25', 0.8],
    ['m3', 'kg', '1.25', 0.0008], ['m³', 't', '1.25', 0.8],
    ['立方米', '吨', '1.25', 0.8], ['毫升', '克', '1.25', 0.8],
    ['升', 'g', '1.25', 0.0008], ['mL', 'mg', '1.25', 0.0008],
  ])('converts %s/%s at %s kg/L without unit-scale drift', (input, output, density, expected) => {
    expect(densityPercentageQuantityV1(100, String(input), String(output), density)).toBe(expected);
  });
  it.each(['constructor', '__proto__', '桶', 'kg'])('never invents a volume for %s', input => {
    expect(() => densityPercentageQuantityV1(100, input, 'kg', '1.25')).toThrow('DENSITY_BASIS_REQUIRED');
  });
  it('refuses unrepresentable results and invalid density', () => {
    expect(() => densityPercentageQuantityV1(100, 'L', 'kg', '3')).toThrow('PRECISION_UNSUPPORTED');
    expect(() => densityPercentageQuantityV1(100, 'm3', 'mg', '1.25')).toThrow('PRECISION_UNSUPPORTED');
    expect(() => densityPercentageQuantityV1(100, 'L', 'kg', '0')).toThrow('PERCENTAGE_INVALID');
  });
  it('does not allow legacy millilitre tolerance to hide density over/under issue', () => {
    const item = { materialId: 1, dosageMode: DENSITY_PERCENTAGE_V1, quantityPerUnit: 0.8, unit: 'L', allowedVarianceRate: 0 };
    const stock = { materialId: 1, unit: 'L' };
    expect(() => assertBomConsumptionCoverage([item], [{ stock, quantity: 8 }], 10)).not.toThrow();
    expect(() => assertBomConsumptionCoverage([item], [{ stock, quantity: 8.000001 }], 10)).toThrow('above expected');
    expect(() => assertBomConsumptionCoverage([item], [{ stock, quantity: 7.999999 }], 10)).toThrow('below expected');
  });
  it('rejects corrupt work-order density snapshots', () => {
    for (const json of ['[]', '{}', 'null', '[{}]', 'broken']) {
      expect(() => parseWorkOrderDensityBases(json)).toThrow('DENSITY_SNAPSHOT_INVALID');
    }
  });
});
