import { assertStockQualityForIssue } from './stock-quality-issue.service';
import { StockMovementConflictError } from './stock-movement.errors';
import type { StockSourceType } from './stock-movement.types';
import { assertLatestIncomingQualityRelease } from './incoming-quality.service';

jest.mock('./incoming-quality.service', () => ({ assertLatestIncomingQualityRelease: jest.fn() }));

describe('transactional batch quality issue guard', () => {
  const line = { batchNo: 'LOT', materialId: 7, productName: 'Resin', locationId: 1, quantityDelta: -10 };
  const fixture = (qualityStatus: string) => ({ $executeRaw: jest.fn(),
    purchaseReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
    stockMovement: { findFirst: jest.fn().mockResolvedValue(null) },
    productBatch: { findUnique: jest.fn().mockResolvedValue({ id: 4, materialId: 7, productName: 'Resin', qualityStatus }) } }) as any;
  beforeEach(() => jest.clearAllMocks());
  for (const source of ['production_consumption', 'shipping_issue', 'barter_issue'] as StockSourceType[]) {
    for (const quality of ['hold', 'quarantine', 'pending_qc', 'unknown', '']) it(`blocks ${source} from ${quality || 'empty'} quality`, async () => {
      const tx = fixture(quality);
      await expect(assertStockQualityForIssue(tx, source, line)).rejects.toBeInstanceOf(StockMovementConflictError);
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.productBatch.findUnique.mock.invocationCallOrder[0]);
    });
  }
  for (const quality of ['released', 'not_required']) it(`allows the explicit ${quality} disposition without changing state/timestamps`, async () => {
    const tx = fixture(quality); await assertStockQualityForIssue(tx, 'production_consumption', line);
    expect(tx.$executeRaw.mock.calls[0][0].join('?')).toContain('SET "quality_status" = "quality_status"');
    expect(tx.$executeRaw.mock.calls[0][1]).toBe('LOT');
  });
  for (const batch of [null, { materialId: 8, productName: 'Resin', qualityStatus: 'released' }, { materialId: null, productName: 'Resin', qualityStatus: 'released' }]) it('fails closed on absent or mismatched authoritative batch identity', async () => {
    const tx = fixture('released'); tx.productBatch.findUnique.mockResolvedValue(batch);
    await expect(assertStockQualityForIssue(tx, 'production_consumption', line)).rejects.toThrow('STOCK_QC_BATCH_IDENTITY_REQUIRED');
  });
  it('does not repurpose authorized transfers, adjustments, reversal or inbound as ordinary issue', async () => {
    const tx = fixture('quarantine');
    for (const source of ['warehouse_transfer', 'warehouse_adjustment', 'barter_issue_reversal', 'barter_receipt_reversal'] as StockSourceType[]) await assertStockQualityForIssue(tx, source, line);
    await assertStockQualityForIssue(tx, 'production_consumption', { ...line, quantityDelta: 10 });
    expect(tx.$executeRaw).not.toHaveBeenCalled(); expect(tx.productBatch.findUnique).not.toHaveBeenCalled();
  });
  it.each(['released', 'not_required'])('cannot bypass actual incoming QA by changing the batch flag to %s', async quality => {
    const tx = fixture(quality); tx.purchaseReceipt.findFirst.mockResolvedValue({ id: 41 });
    (assertLatestIncomingQualityRelease as jest.Mock).mockRejectedValueOnce(new Error('INCOMING_QA_RELEASE_REQUIRED'));
    await expect(assertStockQualityForIssue(tx, 'shipping_issue', line)).rejects.toThrow('INCOMING_QA_RELEASE_REQUIRED');
    expect(tx.purchaseReceipt.findFirst).toHaveBeenCalledWith({ where: { OR: [{ batchId: 4 }, { batchNo: 'LOT' }] }, select: { id: true } });
    expect(assertLatestIncomingQualityRelease).toHaveBeenCalledWith(tx, 4);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1); // No reverse PO lock is added by the stock guard.
  });
  it('does not invent QA evidence for a legacy incoming receipt with an unknown batch binding', async () => {
    const tx = fixture('released'); tx.purchaseReceipt.findFirst.mockResolvedValue({ id: 1 });
    (assertLatestIncomingQualityRelease as jest.Mock).mockRejectedValueOnce(new Error('INCOMING_HISTORY_UNRECONCILED'));
    await expect(assertStockQualityForIssue(tx, 'production_consumption', line)).rejects.toThrow('HISTORY_UNRECONCILED');
  });
  it.each(['released', 'not_required'])('does not exempt posted procurement stock without a Receipt through %s', async quality => {
    const tx = fixture(quality); tx.stockMovement.findFirst.mockResolvedValue({ id: 61 });
    await expect(assertStockQualityForIssue(tx, 'shipping_issue', line)).rejects.toThrow('INCOMING_HISTORY_UNRECONCILED');
    expect(tx.stockMovement.findFirst).toHaveBeenCalledWith({ where: { batchNo: 'LOT',
      entry: { is: { sourceType: 'procurement_receipt', status: 'posted' } } }, select: { id: true } });
    expect(assertLatestIncomingQualityRelease).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
