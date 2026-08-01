import { resolveShipmentIdentity } from './shipment-material-identity';

const activeMaterial = {
  id: 9, code: 'FG-0009', nameZh: '成品乳液', baseUnit: 'kg', status: 'active', isTemporary: false, shelfLifeDays: 365,
};

describe('shipment material identity', () => {
  it('inherits the order-line identity and binds the exact product batch', async () => {
    const tx = {
      orderItem: { findUnique: jest.fn().mockResolvedValue({ id: 3, orderId: 2, materialId: 9, productName: '旧名称', quantity: 20, unit: 'kg', order: { customerId: 1 } }) },
      shipment: { aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 5 } }) },
      material: {
        findMany: jest.fn().mockResolvedValue([activeMaterial]),
        findUnique: jest.fn().mockResolvedValue(activeMaterial),
      },
      productBatch: { findFirst: jest.fn().mockResolvedValue({ id: 11, materialId: 9, batchNo: 'FG-B-1', qualityStatus: 'released' }) },
    } as any;
    const result = await resolveShipmentIdentity(tx, { customerId: 1, orderId: 2, orderItemId: 3, productName: '任意文本', quantity: 10, unit: 'kg', batchNo: 'FG-B-1' });
    expect(result).toMatchObject({ orderItemId: 3, materialId: 9, productName: '成品乳液', productBatchId: 11 });
    expect(tx.productBatch.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { materialId: 9, batchNo: 'FG-B-1' } }));
  });

  it('rejects cross-order item substitution', async () => {
    const tx = {
      orderItem: { findUnique: jest.fn().mockResolvedValue({ id: 3, orderId: 99, materialId: 9, productName: '成品乳液', quantity: 20, unit: 'kg', order: { customerId: 1 } }) },
    } as any;
    await expect(resolveShipmentIdentity(tx, { customerId: 1, orderId: 2, orderItemId: 3, productName: '成品乳液', quantity: 10, unit: 'kg' }))
      .rejects.toThrow('SHIPMENT_ORDER_ITEM_ORDER_MISMATCH');
  });

  it('rejects aggregate shipment quantity above the linked order line', async () => {
    const tx = {
      orderItem: { findUnique: jest.fn().mockResolvedValue({ id: 3, orderId: 2, materialId: 9, productName: '成品乳液', quantity: 12.5, unit: 'kg', order: { customerId: 1 } }) },
      shipment: { aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 10 } }) },
    } as any;
    await expect(resolveShipmentIdentity(tx, { customerId: 1, orderId: 2, orderItemId: 3, productName: '成品乳液', quantity: 3, unit: 'kg' }))
      .rejects.toThrow('SHIPMENT_ORDER_ITEM_QUANTITY_EXCEEDED');
  });

  it('rejects a quarantined finished-goods batch before shipment persistence', async () => {
    const tx = {
      orderItem: { findUnique: jest.fn().mockResolvedValue({ id: 3, orderId: 2, materialId: 9, productName: '成品乳液', quantity: 20, unit: 'kg', order: { customerId: 1 } }) },
      shipment: { aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }) },
      material: {
        findMany: jest.fn().mockResolvedValue([activeMaterial]),
        findUnique: jest.fn().mockResolvedValue(activeMaterial),
      },
      productBatch: { findFirst: jest.fn().mockResolvedValue({ id: 11, materialId: 9, batchNo: 'FG-HOLD', qualityStatus: 'quarantine' }) },
    } as any;
    await expect(resolveShipmentIdentity(tx, { customerId: 1, orderId: 2, orderItemId: 3, productName: '成品乳液', quantity: 3, unit: 'kg', batchNo: 'FG-HOLD' }))
      .rejects.toThrow('SHIPMENT_PRODUCT_BATCH_NOT_RELEASED');
  });
});
