import { syncProductBatchForOperationalStock } from './stock-movement.product-batch-sync';

describe('governed product batch synchronization', () => {
  it('uses the material shelf life instead of the legacy one-year default', async () => {
    const create = jest.fn(async ({ data }) => ({ id: 11, stockQuantity: data.stockQuantity }));
    const tx = {
      productBatch: {
        findUnique: jest.fn(async () => null),
        create,
      },
    } as any;
    const before = Date.now();

    await syncProductBatchForOperationalStock(tx, 'procurement_receipt', {
      locationId: 1,
      materialId: 7,
      shelfLifeDays: 180,
      productName: '水性树脂 A',
      batchNo: 'RAW-001',
      quantityDelta: 25,
      unit: 'kg',
    });

    const createdData = create.mock.calls[0][0].data;
    const actualDays = (createdData.expiryDate.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(actualDays).toBeGreaterThanOrEqual(179.99);
    expect(actualDays).toBeLessThanOrEqual(180.01);
    expect(createdData.materialId).toBe(7);
  });

  it('rejects a governed inbound batch when shelf life is missing', async () => {
    const tx = {
      productBatch: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(),
      },
    } as any;

    await expect(syncProductBatchForOperationalStock(tx, 'procurement_receipt', {
      locationId: 1,
      materialId: 7,
      shelfLifeDays: null,
      productName: '水性树脂 A',
      batchNo: 'RAW-001',
      quantityDelta: 25,
      unit: 'kg',
    })).rejects.toThrow('STOCK_MATERIAL_SHELF_LIFE_REQUIRED:7');
    expect(tx.productBatch.create).not.toHaveBeenCalled();
  });
});
