jest.mock('../config/database', () => ({ __esModule: true, default: { $transaction: jest.fn(), productionWorkOrder: { findUnique: jest.fn() }, stockBalance: { findMany: jest.fn() } } }));
import prisma from '../config/database';
import { assertBomOutputUnit, assertBomPercentageUnits } from './production-unit-safety.service';
import { ProductionMutationService } from './production-mutation.service';
import { ProductionQueryService } from './production-query.service';

describe('BOM dimensional safety, not automatic conversion', () => {
  beforeEach(() => jest.resetAllMocks());
  it.each(['kg', 'g', 'mg', 't', '公斤'])('accepts same mass unit %s without changing quantities', unit => {
    expect(() => assertBomPercentageUnits({ outputUnit: unit, items: [{ unit, dosageMode: 'percentage' }] })).not.toThrow();
  });
  it.each([['g', 'kg'], ['L', 'kg'], ['kg', '桶'], ['桶', '桶'], ['L', 'L'], ['unknown', 'unknown']])('rejects ungoverned percentage %s / %s', (unit, outputUnit) => {
    expect(() => assertBomPercentageUnits({ outputUnit, items: [{ unit, dosageMode: 'percentage' }] })).toThrow('BOM_UNIT_PERCENTAGE_BASIS_REQUIRED');
  });
  it('preserves explicit fixed kg/drum dosage and normalizes case/whitespace only', () => {
    expect(() => assertBomPercentageUnits({ outputUnit: '桶', items: [{ unit: 'kg', dosageMode: 'fixed' }] })).not.toThrow();
    expect(() => assertBomOutputUnit(' KG ', 'kg')).not.toThrow();
    expect(() => assertBomOutputUnit('g', 'kg')).toThrow('BOM_UNIT_OUTPUT_MISMATCH');
    expect(() => assertBomOutputUnit('', '')).toThrow('BOM_UNIT_OUTPUT_MISMATCH');
  });
  const unsafeBom = { id: 2, outputUnit: 'kg', items: [{ unit: 'g', dosageMode: 'percentage', quantityPerUnit: 1, percentage: 100 }] };
  function transaction(bom: any = unsafeBom) {
    const tx: any = {
      $executeRaw: jest.fn(),
      material: { findUnique: jest.fn().mockResolvedValue({ id: 1, code: 'FG', baseUnit: 'kg', category: 'finished_good', status: 'active', shelfLifeDays: 365 }), findMany: jest.fn() },
      productionBom: { findUnique: jest.fn().mockResolvedValue(bom), create: jest.fn() },
      productionWorkOrder: { create: jest.fn(), findUnique: jest.fn().mockResolvedValue({ id: 3, status: 'qc_pending', bom }), updateMany: jest.fn() },
      productBatch: { findUnique: jest.fn().mockResolvedValue({ id: 4, unit: 'g' }) },
      stockBalance: { findUnique: jest.fn() }, auditLog: { create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(fn => fn(tx));
    return tx;
  }
  it('rejects output mismatch before creating a BOM instead of relabelling its denominator', async () => {
    const tx = transaction();
    await expect(ProductionMutationService.createBom({ materialId: 1, productName: 'FG', outputUnit: 'g', shelfLifeDays: 365, items: [] }, 1)).rejects.toThrow('BOM_UNIT_OUTPUT_MISMATCH');
    expect(tx.productionBom.create).not.toHaveBeenCalled();
  });
  it('blocks unsafe historical percentage BOM at new work order creation', async () => {
    const tx = transaction();
    await expect(ProductionMutationService.createWorkOrder({ bomId: 2, productName: 'FG', targetQuantity: 10 }, 1)).rejects.toThrow('BOM_UNIT_PERCENTAGE_BASIS_REQUIRED');
    expect(tx.productionWorkOrder.create).not.toHaveBeenCalled();
  });
  it('does not allow linking an output batch with another unit', async () => {
    const tx = transaction({ ...unsafeBom, items: [] });
    await expect(ProductionMutationService.createWorkOrder({ bomId: 2, batchId: 4, productName: 'FG', targetQuantity: 10 }, 1)).rejects.toThrow('BOM_UNIT_OUTPUT_MISMATCH');
    expect(tx.productionWorkOrder.create).not.toHaveBeenCalled();
  });
  it('blocks misleading previews of existing unsafe BOMs before allocating stock', async () => {
    (prisma.productionWorkOrder.findUnique as jest.Mock).mockResolvedValue({ bom: unsafeBom, targetQuantity: 10 });
    await expect(ProductionQueryService.previewWorkOrderConsumption(3)).rejects.toThrow('BOM_UNIT_PERCENTAGE_BASIS_REQUIRED');
    expect(prisma.stockBalance.findMany).not.toHaveBeenCalled();
  });
  it('blocks existing unsafe work orders before any inventory, status or audit mutation', async () => {
    const tx = transaction();
    await expect(ProductionMutationService.updateWorkOrderStatus(3, 'completed', [], { userId: 1 })).rejects.toThrow('BOM_UNIT_PERCENTAGE_BASIS_REQUIRED');
    expect(tx.stockBalance.findUnique).not.toHaveBeenCalled();
    expect(tx.productionWorkOrder.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('does not rewrite completed historical work orders during a replay', async () => {
    const tx = transaction(); const wo = { id: 3, status: 'completed', bom: unsafeBom };
    tx.productionWorkOrder.findUnique.mockResolvedValue(wo);
    await expect(ProductionMutationService.updateWorkOrderStatus(3, 'completed', [], { userId: 1 })).resolves.toEqual(wo);
    expect(tx.productionWorkOrder.updateMany).not.toHaveBeenCalled();
  });
});
