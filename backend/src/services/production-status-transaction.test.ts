jest.mock('../config/database', () => ({ __esModule: true, default: { $transaction: jest.fn() } }));
jest.mock('./stock-movement.service', () => ({ StockMovementService: { postStockEntry: jest.fn() } }));
jest.mock('./production-cost-ledger.service', () => ({ ProductionCostLedgerService: { recordWorkOrderCompletion: jest.fn() } }));
jest.mock('./production-quality.service', () => ({ assertLatestQualityRelease: jest.fn() }));
jest.mock('./batch-genealogy-write.service', () => ({ persistBatchGenealogyEdges: jest.fn() }));
import prisma from '../config/database';
import { ProductionMutationService } from './production-mutation.service';
import { StockMovementService } from './stock-movement.service';
import { ProductionCostLedgerService } from './production-cost-ledger.service';
import { StockMovementConflictError } from './stock-movement.errors';

describe('production completion transaction ownership', () => {
  const actor = { userId: 14, ipAddress: '127.0.0.1', userAgent: 'test' };
  beforeEach(() => jest.resetAllMocks());
  function fixture(status = 'qc_pending') {
    const wo: any = { id: 1, workOrderNo: 'WO-1', status, createdBy: 3, materialId: 2, batchId: 20, producedQuantity: 50, targetQuantity: 50,
      bom: { items: [], qualityCharacteristics: [], outputUnit: 'kg', shelfLifeDays: 365 } };
    const tx: any = {
      productionWorkOrder: { findUnique: jest.fn().mockResolvedValue(wo), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      stockBalance: { findUnique: jest.fn().mockResolvedValue({ id: 9, materialId: 1, locationId: 2, productName: 'RAW', batchNo: 'LOT', quantity: 50, unit: 'kg' }) },
      location: { findFirst: jest.fn().mockResolvedValue({ id: 3 }) },
      productBatch: {
        findUnique: jest.fn().mockResolvedValue({ id: 20, materialId: 2, batchNo: 'OUT', productName: 'FG', stockQuantity: 0, unit: 'kg' }),
        findFirst: jest.fn().mockResolvedValue({ id: 10, stockQuantity: 100 }),
        update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        // Another location's work order consumed 50 after the initial 100 read.
        findUniqueOrThrow: jest.fn().mockResolvedValue({ stockQuantity: 0 }),
      },
      auditLog: { create: jest.fn() },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(fn => fn(tx));
    (ProductionCostLedgerService.recordWorkOrderCompletion as jest.Mock).mockImplementation((_tx, input) => ({ costAmountDelta: input.quantityDelta * 10 }));
    return { tx, wo };
  }
  const complete = () => ProductionMutationService.updateWorkOrderStatus(1, 'completed', [{ stockBalanceId: 9, quantity: 50 }], actor);
  it('records the actual actor and audit inside the successful transaction', async () => {
    const { tx } = fixture(); await complete();
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ userId: 14, action: 'UPDATE_PRODUCTION_WORK_ORDER_STATUS', resourceId: 1 });
    expect(JSON.parse(tx.auditLog.create.mock.calls[0][0].data.details)).toEqual({ workOrderId: 1, fromStatus: 'qc_pending', status: 'completed' });
    expect(StockMovementService.postStockEntry).toHaveBeenCalledWith(expect.objectContaining({ createdBy: 14 }), tx);
  });
  it('uses persisted post-decrement batch quantity, not a stale other-location snapshot', async () => {
    const { tx } = fixture(); await complete();
    expect(tx.productBatch.updateMany).toHaveBeenCalledWith({ where: { id: 10, stockQuantity: { gte: 50 } }, data: { stockQuantity: { decrement: 50 } } });
    expect(ProductionCostLedgerService.recordWorkOrderCompletion).toHaveBeenCalledWith(tx, expect.objectContaining({ batchId: 10, quantityBefore: 50, quantityDelta: -50, requireReconciledQuantity: true, createdBy: 14 }));
  });
  it('fails closed on batch divergence without recording completion audit', async () => {
    const { tx } = fixture(); tx.productBatch.updateMany.mockResolvedValue({ count: 0 });
    await expect(complete()).rejects.toBeInstanceOf(StockMovementConflictError);
    expect(tx.auditLog.create).not.toHaveBeenCalled(); expect(ProductionCostLedgerService.recordWorkOrderCompletion).not.toHaveBeenCalled();
  });
  it('does not swallow an audit failure after stock and ledger writes', async () => {
    const { tx } = fixture(); tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(complete()).rejects.toThrow('audit unavailable');
    expect(tx.auditLog.create.mock.invocationCallOrder[0]).toBeGreaterThan((ProductionCostLedgerService.recordWorkOrderCompletion as jest.Mock).mock.invocationCallOrder[1]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it('replays a completed work order without another movement, cost or audit', async () => {
    const { tx } = fixture('completed'); await complete();
    expect(tx.productionWorkOrder.updateMany).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(StockMovementService.postStockEntry).not.toHaveBeenCalled();
  });
  it('a losing concurrent state claim does not manufacture a second audit', async () => {
    const { tx, wo } = fixture(); tx.productionWorkOrder.updateMany.mockResolvedValue({ count: 0 });
    tx.productionWorkOrder.findUnique.mockResolvedValueOnce(wo).mockResolvedValue({ ...wo, status: 'completed' });
    await complete(); expect(tx.auditLog.create).not.toHaveBeenCalled(); expect(StockMovementService.postStockEntry).not.toHaveBeenCalled();
  });
  it('retries only transient transaction failures before committing one audit', async () => {
    const { tx } = fixture(); tx.productionWorkOrder.updateMany.mockRejectedValueOnce(Object.assign(new Error('serialization conflict'), { code: 'P2034' }));
    await complete(); expect(prisma.$transaction).toHaveBeenCalledTimes(2); expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('rejects a missing accountable actor before starting a transaction', async () => {
    fixture(); await expect(ProductionMutationService.updateWorkOrderStatus(1, 'completed', [], { userId: 0 })).rejects.toThrow('WORK_ORDER_ACTOR_REQUIRED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
