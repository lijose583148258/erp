import {
  calculateInventoryCostDelta,
  calculateInventoryUnitCost,
  calculateInventoryIssueCost,
  ProductionCostLedgerService,
} from './production-cost-ledger.service';

describe('production cost ledger decimal calculations', () => {
  it('refuses to turn unvalued opening stock into a negative ledger quantity', async () => {
    const tx = {
      productBatch: { findUnique: jest.fn(async () => ({ id: 1, batchNo: 'UNVALUED' })) },
      inventoryCostLedger: {
        aggregate: jest.fn(async () => ({ _sum: { quantityDelta: null, costAmountDelta: null } })),
        create: jest.fn(),
      },
    };
    await expect(ProductionCostLedgerService.recordInventoryMovement(tx, {
      batchId: 1, sourceRef: 'SHIP1', quantityBefore: 100, quantityDelta: -60, quantityAfter: 40,
      createdBy: 1, requireReconciledQuantity: true,
    })).rejects.toThrow('STOCK_COST_RECONCILIATION_REQUIRED:UNVALUED');
    expect(tx.inventoryCostLedger.create).not.toHaveBeenCalled();
  });
  it('depletes the exact remaining carrying cost without residual cents', () => {
    expect(calculateInventoryIssueCost(-3, 3, 100)).toBe(-100);
    expect(calculateInventoryIssueCost(-1, 3, 100)).toBe(-33.33);
    expect(calculateInventoryIssueCost(-2, 2, 66.67)).toBe(-66.67);
    expect(calculateInventoryIssueCost(-0.123456, 0.123456, 17.01)).toBe(-17.01);
  });
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
