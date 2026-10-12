import prisma from '../config/database';
import { SalesFulfillmentPlanService } from './sales-fulfillment-plan.service';
import type { AuthRequest } from '../middleware/auth';

jest.mock('../config/database', () => ({ __esModule: true, default: { $transaction: jest.fn() } }));
jest.mock('../utils/dbRetry', () => ({ withDbRetry: (action: () => unknown) => action() }));
jest.mock('../utils/recordAccess', () => ({ buildOrderDataScopeWhere: () => ({}), canUseOrderForBusinessWrite: () => true, mergeWhereAnd: (a: unknown) => a }));

const input = { idempotencyKey: 'cancel-plan-123', expectedUpdatedAt: '2026-10-01T00:00:00.000Z', expectedStatus: 'approved' as const, reason: 'Supplier revised this commitment' };
const req = { user: { userId: 2 } } as AuthRequest;
function fixture(status = 'approved') {
  const plan = { id: 3, orderId: 1, status, updatedAt: new Date(input.expectedUpdatedAt), sourceSnapshot: '{"id":7,"revision":0}', approvedBy: 4 };
  const tx = { order: { findFirst: jest.fn().mockResolvedValue({ id: 1, status: 'confirmed' }),
    findUnique: jest.fn().mockResolvedValue({ items: [{ id: 5, quantity: 100, unit: 'kg' }], shipments: [] }) },
    $executeRaw: jest.fn(), salesFulfillmentPlan: { findFirst: jest.fn().mockResolvedValue(plan), update: jest.fn(async ({ data }) => ({ ...plan, ...data })) },
    auditLog: { create: jest.fn() } };
  (prisma.$transaction as jest.Mock).mockImplementation(action => action(tx));
  return { tx, plan };
}

describe('cancel only the supply commitment', () => {
  it.each(['draft', 'approved'] as const)('retains %s source history and customer demand', async status => {
    const { tx } = fixture(status);
    const result = await SalesFulfillmentPlanService.cancel(1, 3, { ...input, expectedStatus: status }, req);
    expect(result.status).toBe('cancelled'); expect(result.sourceSnapshot).toEqual({ id: 7, revision: 0 });
    expect(result.approvedBy).toBe(4);
    expect(result.closeoutSnapshot).toMatchObject({ kind: 'cancellation', previousStatus: status, reason: input.reason,
      stockChanged: false, moneyChanged: false, fulfillment: { lines: [expect.objectContaining({ orderedQuantity: 100, outstandingQuantity: 100 })] } });
    expect(tx.salesFulfillmentPlan.update.mock.calls[0][0].data).not.toHaveProperty('sourceSnapshot');
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'CANCEL_SALES_FULFILLMENT_PLAN', resourceId: 3, userId: 2 }) });
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.salesFulfillmentPlan.update.mock.invocationCallOrder[0]);
  });
  it.each(['closed', 'unknown'])('does not cancel %s evidence', async status => {
    const { tx } = fixture(status);
    await expect(SalesFulfillmentPlanService.cancel(1, 3, input, req)).rejects.toMatchObject({ code: 'FULFILLMENT_PLAN_NOT_CANCELLABLE' });
    expect(tx.salesFulfillmentPlan.update).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('rejects stale reads without changing the plan', async () => {
    const { tx } = fixture();
    await expect(SalesFulfillmentPlanService.cancel(1, 3, { ...input, expectedUpdatedAt: '2026-10-02T00:00:00.000Z' }, req)).rejects.toMatchObject({ code: 'FULFILLMENT_PLAN_CHANGED' });
    expect(tx.salesFulfillmentPlan.update).not.toHaveBeenCalled();
  });
  it('rejects approval since the read even if its timestamp shares the same millisecond', async () => {
    const { tx } = fixture();
    await expect(SalesFulfillmentPlanService.cancel(1, 3, { ...input, expectedStatus: 'draft' }, req)).rejects.toMatchObject({ code: 'FULFILLMENT_PLAN_CHANGED' });
    expect(tx.salesFulfillmentPlan.update).not.toHaveBeenCalled();
  });
  it('replays the same persisted cancellation but rejects changed facts and actors', async () => {
    const { tx } = fixture(); const cancelled = await SalesFulfillmentPlanService.cancel(1, 3, input, req);
    tx.salesFulfillmentPlan.findFirst.mockResolvedValue({ ...cancelled, sourceSnapshot: JSON.stringify(cancelled.sourceSnapshot), closeoutSnapshot: JSON.stringify(cancelled.closeoutSnapshot) });
    tx.salesFulfillmentPlan.update.mockClear(); tx.auditLog.create.mockClear();
    expect((await SalesFulfillmentPlanService.cancel(1, 3, input, req)).status).toBe('cancelled');
    for (const patch of [{ reason: 'Different reason' }, { idempotencyKey: 'different-key' }, { expectedUpdatedAt: '2026-10-02T00:00:00.000Z' }]) {
      await expect(SalesFulfillmentPlanService.cancel(1, 3, { ...input, ...patch }, req)).rejects.toMatchObject({ code: 'FULFILLMENT_IDEMPOTENCY_CONFLICT' });
    }
    await expect(SalesFulfillmentPlanService.cancel(1, 3, input, { user: { userId: 9 } } as AuthRequest)).rejects.toMatchObject({ code: 'FULFILLMENT_IDEMPOTENCY_CONFLICT' });
    expect(tx.salesFulfillmentPlan.update).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
