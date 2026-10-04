import { allocateBarterReversalCosts, postBarterStockEntries, postBarterStockReversalEntries } from './barter.stock';
import { StockMovementService } from '../stock-movement.service';

describe('barter inventory valuation and exact reversal', () => {
  afterEach(() => jest.restoreAllMocks());

  it('allocates the original carrying amount, including final rounding remainder', () => {
    expect(allocateBarterReversalCosts([-1, -1, -1], -100)).toEqual([33.33, 33.33, 33.34]);
    expect(allocateBarterReversalCosts([1, 1, 1], 100)).toEqual([-33.33, -33.33, -33.34]);
    expect(allocateBarterReversalCosts([1], 0)).toEqual([0]);
  });

  it('values receipts using the approved amount but issues at carrying cost', async () => {
    const post = jest.spyOn(StockMovementService, 'postStockEntry').mockResolvedValue({ entry: {}, movements: [], balances: [] });
    const tx = { location: { findFirst: jest.fn(async () => ({ id: 1 })) } } as any;
    await postBarterStockEntries({ id: 4, settlementNo: 'BT4', items: [
      { id: 1, side: 'our', materialId: 7, itemName: 'FG', quantity: 10, unit: 'kg', marketValue: 200 },
      { id: 2, side: 'counterparty', materialId: 8, itemName: 'RM', quantity: 20, unit: 'kg', marketValue: 150 },
    ] }, tx, 3);
    expect(post.mock.calls[0][0].lines[0].costAmountDelta).toBeUndefined();
    expect(post.mock.calls[1][0].lines[0].costAmountDelta).toBe(150);
  });

  it('reverses original valuation instead of revaluing at a changed current price', async () => {
    const post = jest.spyOn(StockMovementService, 'postStockEntry').mockResolvedValue({ entry: {}, movements: [], balances: [] });
    const tx = {
      stockEntry: { findMany: jest.fn(async () => [{ entryNo: 'STK1', sourceType: 'barter_issue', movements: [
        { locationId: 1, materialId: 7, productName: 'FG', batchNo: 'B1', unit: 'kg', quantityDelta: -10 },
      ] }]) },
      productBatch: { findUnique: jest.fn(async () => ({ id: 1 })) },
      inventoryCostLedger: { findMany: jest.fn(async () => [{ quantityDelta: -10, costAmountDelta: -100 }]) },
    } as any;
    await postBarterStockReversalEntries({ id: 4, settlementNo: 'BT4' }, tx, 3, 'return');
    expect(post.mock.calls[0][0]).toMatchObject({ sourceType: 'barter_issue_reversal', lines: [{ quantityDelta: 10, costAmountDelta: 100 }] });
    expect(tx.inventoryCostLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { batchId: 1, sourceRef: 'STK1' } }));
  });

  it('blocks legacy missing-cost reversals instead of inventing financial history', async () => {
    const post = jest.spyOn(StockMovementService, 'postStockEntry').mockResolvedValue({ entry: {}, movements: [], balances: [] });
    const tx = {
      stockEntry: { findMany: jest.fn(async () => [{ entryNo: 'LEGACY', sourceType: 'barter_issue', movements: [
        { locationId: 1, materialId: 7, productName: 'FG', batchNo: 'B1', unit: 'kg', quantityDelta: -10 },
      ] }]) },
      productBatch: { findUnique: jest.fn(async () => ({ id: 1 })) },
      inventoryCostLedger: { findMany: jest.fn(async () => []) },
    } as any;
    await expect(postBarterStockReversalEntries({ id: 4, settlementNo: 'BT4' }, tx, 3, 'return')).rejects.toThrow('REQUIRES_RECONCILIATION');
    expect(post).not.toHaveBeenCalled();
  });
});
