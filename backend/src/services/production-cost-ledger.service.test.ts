import {
  calculateInventoryCostDelta,
  calculateInventoryUnitCost,
} from './production-cost-ledger.service';

describe('production cost ledger decimal calculations', () => {
  it('derives a precise inventory cost delta from quantity and unit cost', () => {
    expect(calculateInventoryCostDelta(3, null, 0.1)).toBe(0.3);
  });

  it('preserves an explicit cost delta at the money boundary', () => {
    expect(calculateInventoryCostDelta(99, 10.005, 7)).toBe(10.01);
  });

  it('derives unit cost without native floating-point division', () => {
    expect(calculateInventoryUnitCost(100, 3)).toBe(33.33);
    expect(calculateInventoryUnitCost(-100, -3)).toBe(33.33);
  });

  it('keeps the prior unit cost for zero-quantity valuation rows', () => {
    expect(calculateInventoryUnitCost(0, 0, 12.34)).toBe(12.34);
    expect(calculateInventoryUnitCost(0, 0)).toBeNull();
  });
});
