jest.mock('../config/database', () => ({ __esModule: true, default: {
  $transaction: jest.fn(), materialGovernanceRun: { findFirst: jest.fn() },
} }));
import prisma from '../config/database';
import { lockBomRevisions, assertBomRevisionsUnused } from './production-bom-freeze.service';
import { MaterialGovernanceService, buildBomBackfillFingerprint } from './material-governance.service';
import { ProductionMutationService } from './production-mutation.service';

describe('BOM reference freeze', () => {
  beforeEach(() => jest.resetAllMocks());
  const source = { materialName: 'Legacy resin', materialCode: null, unit: 'kg' };
  const mapping = { source, materialId: 5, expectedCount: 1, expectedFingerprint: buildBomBackfillFingerprint(source, [9]) };
  function transaction(referenced = 1) {
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      productionWorkOrder: { count: jest.fn().mockResolvedValue(referenced), create: jest.fn().mockResolvedValue({ id: 21 }), findUnique: jest.fn().mockResolvedValue({ id: 21 }) },
      productionBom: { findUnique: jest.fn().mockResolvedValue({ id: 7, productName: 'FG', outputUnit: 'kg' }) },
      productionBomItem: { findMany: jest.fn().mockResolvedValue([{ id: 9, bomId: 7 }]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      material: { findMany: jest.fn().mockResolvedValue([{ id: 5, baseUnit: 'kg', status: 'active', isTemporary: false }]) },
      materialGovernanceRun: { create: jest.fn().mockResolvedValue({ id: 1 }), findUnique: jest.fn().mockResolvedValue({ id: 1, runType: 'bom_backfill', status: 'applied', changes: [{ entityId: 9, afterValue: '5' }] }), update: jest.fn() },
      materialGovernanceChange: { createMany: jest.fn() }, auditLog: { create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(fn => fn(tx));
    return tx;
  }
  it('locks distinct parents in ascending order without changing business fields or timestamps', async () => {
    const tx = transaction(); await lockBomRevisions(tx, [7, 2, 7]);
    expect(tx.$executeRaw.mock.calls.map((call: any[]) => call[1])).toEqual([2, 7]);
    expect(tx.$executeRaw.mock.calls[0][0].join('?')).toBe('UPDATE "production_boms" SET "version" = "version" WHERE "id" = ?');
  });
  it('checks all historical references only after acquiring the parent lock', async () => {
    const tx = transaction(); await expect(assertBomRevisionsUnused(tx, [7])).rejects.toThrow('MATERIAL_BOM_REVISION_FROZEN');
    expect(tx.productionWorkOrder.count).toHaveBeenCalledWith({ where: { bomId: { in: [7] } } });
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.productionWorkOrder.count.mock.invocationCallOrder[0]);
  });
  it('allows unused revisions but rejects invalid identities', async () => {
    const tx = transaction(0); await assertBomRevisionsUnused(tx, [7]);
    await expect(lockBomRevisions(tx, [0])).rejects.toThrow('WORK_ORDER_BOM_ID_INVALID');
  });
  it('locks the BOM before reading it and inserting the first work order', async () => {
    const tx = transaction(); await ProductionMutationService.createWorkOrder({ bomId: 7, productName: 'FG', targetQuantity: 10 }, 1);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.productionBom.findUnique.mock.invocationCallOrder[0]);
    expect(tx.productionBom.findUnique.mock.invocationCallOrder[0]).toBeLessThan(tx.productionWorkOrder.create.mock.invocationCallOrder[0]);
  });
  it('rejects backfill before any run, item or audit write if a BOM has a work order', async () => {
    const tx = transaction(); await expect(MaterialGovernanceService.applyBomBackfill([mapping], { userId: 1 })).rejects.toThrow('MATERIAL_BOM_REVISION_FROZEN');
    expect(tx.materialGovernanceRun.create).not.toHaveBeenCalled(); expect(tx.productionBomItem.updateMany).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('rejects rollback before any item, run or audit mutation', async () => {
    const tx = transaction(); await expect(MaterialGovernanceService.rollbackRun(1, { userId: 1 })).rejects.toThrow('MATERIAL_BOM_REVISION_FROZEN');
    expect(tx.productionBomItem.updateMany).not.toHaveBeenCalled(); expect(tx.materialGovernanceRun.update).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('preserves unused BOM backfill and rollback functionality', async () => {
    const tx = transaction(0); await MaterialGovernanceService.applyBomBackfill([mapping], { userId: 1 });
    expect(tx.productionBomItem.updateMany).toHaveBeenCalledWith({ where: { id: { in: [9] }, materialId: null }, data: { materialId: 5 } });
    await MaterialGovernanceService.rollbackRun(1, { userId: 1 });
    expect(tx.productionBomItem.updateMany).toHaveBeenLastCalledWith({ where: { id: { in: [9] }, materialId: 5 }, data: { materialId: null } });
  });
  it('retries transient lock failures, never retries a frozen business conflict', async () => {
    const tx = transaction(); tx.$executeRaw.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'P2034' }));
    await expect(MaterialGovernanceService.rollbackRun(1, { userId: 1 })).rejects.toThrow('MATERIAL_BOM_REVISION_FROZEN');
    expect(prisma.$transaction).toHaveBeenCalledTimes(2); expect(tx.productionBomItem.updateMany).not.toHaveBeenCalled();
  });
});
