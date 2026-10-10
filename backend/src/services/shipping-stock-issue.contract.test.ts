import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { postShippingIssueIfMissing } from './shipping-stock-issue.service';
import { StockMovementService } from './stock-movement.service';

jest.mock('../config/database', () => ({ __esModule: true, default: {} }));
jest.mock('./stock-movement.service', () => ({ StockMovementService: { postStockEntry: jest.fn() } }));

describe('shipping stock issue identity contract', () => {
  it('uses materialId as the exact inventory key before legacy productName', () => {
    const source = readFileSync(join(__dirname, 'shipping-stock-issue.service.ts'), 'utf8');
    expect(source).toContain('if (shipment.materialId) where.materialId = shipment.materialId');
    expect(source).toContain('else where.productName = shipment.productName');
    expect(source).toContain('materialId: issueStock.materialId');
  });
});

describe('presale dispatch shortage', () => {
  beforeEach(() => jest.clearAllMocks());
  const shipment = { shipmentNo: 'PRESALE-50', productName: 'Resin', materialId: 7, quantity: 50, unit: 'kg' };
  const client = () => ({ stockEntry: { findFirst: jest.fn().mockResolvedValue(null) },
    location: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) }, stockBalance: { findFirst: jest.fn().mockResolvedValue(null) },
    productBatch: { findFirst: jest.fn().mockResolvedValue({ qualityStatus: 'released' }) } });

  it('rejects unavailable stock before any posting; the controller maps this shortage to 409', async () => {
    const tx = client();
    await expect(postShippingIssueIfMissing(tx as never, shipment, 3)).rejects.toThrow('No available stock for shipment PRESALE-50');
    expect(StockMovementService.postStockEntry).not.toHaveBeenCalled();
  });
  it('does not relabel a database error as stock shortage', async () => {
    const tx = client(); const error = Object.assign(new Error('connection closed'), { code: 'P1017' });
    tx.stockBalance.findFirst.mockRejectedValue(error);
    await expect(postShippingIssueIfMissing(tx as never, shipment, 3)).rejects.toBe(error);
    expect(StockMovementService.postStockEntry).not.toHaveBeenCalled();
  });
  it('dispatches the same remaining 50 kg after real stock becomes available', async () => {
    const tx = client();
    tx.stockBalance.findFirst.mockResolvedValue({ locationId: 1, materialId: 7, productName: 'Resin', batchNo: 'PURCHASE-50', unit: 'kg', quantity: 50 });
    await expect(postShippingIssueIfMissing(tx as never, shipment, 3)).resolves.toMatchObject({ posted: true });
    expect(StockMovementService.postStockEntry).toHaveBeenCalledTimes(1);
    expect(StockMovementService.postStockEntry).toHaveBeenCalledWith(expect.objectContaining({ sourceRef: shipment.shipmentNo,
      lines: [expect.objectContaining({ quantityDelta: -50, materialId: 7, batchNo: 'PURCHASE-50' })] }), tx);
  });
  it('reads an existing posting without checking or consuming stock again', async () => {
    const tx = client(); tx.stockEntry.findFirst.mockResolvedValue({ id: 8 });
    await expect(postShippingIssueIfMissing(tx as never, shipment, 3)).resolves.toEqual({ posted: false, issueStock: null });
    expect(tx.stockBalance.findFirst).not.toHaveBeenCalled(); expect(StockMovementService.postStockEntry).not.toHaveBeenCalled();
  });
});
