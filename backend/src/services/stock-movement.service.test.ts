import { StockMovementConflictError } from './stock-movement.errors';
import { assertIdempotentReplayMatches } from './stock-movement.helpers';
import { StockMovementService } from './stock-movement.service';

const existingResult = {
  entry: { id: 10, sourceType: 'warehouse_adjustment', sourceRef: 'warehouse_adjustment:req-1' },
  movements: [{
    id: 20,
    entryId: 10,
    stockBalanceId: 30,
    locationId: 1,
    materialId: 7,
    productName: 'Resin A',
    batchNo: 'B-1',
    unit: 'kg',
    quantityBefore: 100,
    quantityDelta: -20,
    quantityAfter: 80,
  }],
  balances: [{ id: 30, quantity: 80 }],
};

describe('stock movement concurrency and idempotency', () => {
  const activeMaterial = {
    id: 7,
    code: 'RM-0007',
    nameZh: 'Resin A',
    baseUnit: 'kg',
    status: 'active',
    isTemporary: false,
    shelfLifeDays: 365,
  };

  it('accepts only an exact replay for an existing requestId', () => {
    expect(() => assertIdempotentReplayMatches(existingResult, [{
      locationId: 1,
      materialId: 7,
      productName: 'Resin A',
      batchNo: 'B-1',
      unit: 'kg',
      quantityDelta: -20,
    }])).not.toThrow();

    expect(() => assertIdempotentReplayMatches(existingResult, [{
      locationId: 1,
      materialId: 7,
      productName: 'Resin A',
      batchNo: 'B-1',
      unit: 'kg',
      quantityDelta: -30,
    }])).toThrow(StockMovementConflictError);
  });

  it('treats material identity as part of the idempotency signature', () => {
    const governedResult = {
      ...existingResult,
      movements: [{ ...existingResult.movements[0], materialId: 7 }],
    };

    expect(() => assertIdempotentReplayMatches(governedResult, [{
      locationId: 1,
      materialId: 8,
      productName: 'Resin A',
      batchNo: 'B-1',
      unit: 'kg',
      quantityDelta: -20,
    }])).toThrow(StockMovementConflictError);
  });

  it('returns an exact replay without creating another voucher', async () => {
    const tx = {
      stockEntry: {
        findFirst: jest.fn(async () => ({
          id: 10,
          sourceType: 'warehouse_adjustment',
          sourceRef: 'warehouse_adjustment:req-1',
          status: 'posted',
        })),
        create: jest.fn(),
      },
      stockMovement: { findMany: jest.fn(async () => existingResult.movements) },
      stockBalance: { findMany: jest.fn(async () => existingResult.balances) },
      material: {
        findMany: jest.fn(async () => [activeMaterial]),
        findUnique: jest.fn(async () => activeMaterial),
      },
    } as any;

    await expect(StockMovementService.postStockEntry({
      sourceType: 'warehouse_adjustment',
      sourceRef: 'warehouse_adjustment:req-1',
      lines: [{
        locationId: 1,
        materialId: 7,
        productName: 'Resin A',
        batchNo: 'B-1',
        unit: 'kg',
        quantityDelta: -20,
        expectedQuantityBefore: 100,
      }],
    }, tx)).resolves.toMatchObject({ entry: { id: 10 } });
    expect(tx.stockEntry.create).not.toHaveBeenCalled();
  });

  it('keeps an exact posted replay idempotent after the material is archived', async () => {
    const archivedMaterial = { ...activeMaterial, status: 'inactive' };
    const tx = {
      stockEntry: {
        findFirst: jest.fn(async () => ({
          id: 10,
          sourceType: 'procurement_receipt',
          sourceRef: 'purchase_order:42',
          status: 'posted',
        })),
        create: jest.fn(),
      },
      stockMovement: { findMany: jest.fn(async () => existingResult.movements) },
      stockBalance: { findMany: jest.fn(async () => existingResult.balances) },
      material: {
        findMany: jest.fn(),
        findUnique: jest.fn(async () => archivedMaterial),
      },
    } as any;

    await expect(StockMovementService.postStockEntry({
      sourceType: 'procurement_receipt',
      sourceRef: 'purchase_order:42',
      lines: [{
        locationId: 1,
        materialId: 7,
        productName: 'Resin A',
        batchNo: 'B-1',
        unit: 'kg',
        quantityDelta: -20,
      }],
    }, tx)).resolves.toMatchObject({ entry: { id: 10 } });
    expect(tx.material.findMany).not.toHaveBeenCalled();
    expect(tx.stockEntry.create).not.toHaveBeenCalled();
  });

  it('rejects a stale absolute adjustment instead of applying a lost update', async () => {
    const tx = {
      stockEntry: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({
          id: 11,
          entryNo: 'STK-11',
          sourceType: 'warehouse_adjustment',
          sourceRef: 'warehouse_adjustment:req-2',
          status: 'posted',
        })),
      },
      location: { findUnique: jest.fn(async () => ({ id: 1, warehouseId: 1 })) },
      material: {
        findMany: jest.fn(async () => [activeMaterial]),
        findUnique: jest.fn(async () => activeMaterial),
      },
      stockBalance: {
        findUnique: jest.fn(async () => ({
          id: 30,
          locationId: 1,
          materialId: 7,
          productName: 'Resin A',
          batchNo: 'B-1',
          unit: 'kg',
          quantity: 90,
        })),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    } as any;

    await expect(StockMovementService.postStockEntry({
      sourceType: 'warehouse_adjustment',
      sourceRef: 'warehouse_adjustment:req-2',
      lines: [{
        locationId: 1,
        materialId: 7,
        productName: 'Resin A',
        batchNo: 'B-1',
        unit: 'kg',
        quantityDelta: -20,
        expectedQuantityBefore: 100,
      }],
    }, tx)).rejects.toMatchObject({
      name: 'StockMovementConflictError',
      code: 'STOCK_MOVEMENT_CONFLICT',
    });
    expect(tx.stockBalance.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        quantity: { gte: 99.999999, lte: 100.000001 },
      }),
    }));
  });
});
