import { revisePurchaseOrder } from './procurement-revision.service';
import { changePurchaseOrderStatus } from './procurement-status.service';
import { revisePurchaseOrderSchema } from '../validators/procurement';

jest.mock('./material-release-readiness.service', () => ({ assertMaterialReleaseReadiness: jest.fn(async () => undefined) }));

const original = () => ({ id: 1, revision: 0, status: 'approved', quantity: 100, price: 10, taxAmount: 0,
  eta: new Date('2026-10-01'), updatedAt: new Date('2026-09-25T00:00:00Z'), supplierId: 1, currency: 'CNY',
  exchangeRate: 1, taxRate: 0, freightCost: 10, dutyCost: 0, insuranceCost: 0, otherCost: 0, supplier: {}, salesOrder: null });
const payload = () => ({ expectedRevision: 0, expectedUpdatedAt: original().updatedAt.toISOString(),
  quantity: 120, price: 11, taxAmount: 5, eta: '2026-10-02', reason: 'Supplier confirmed revised terms' });
function fixture() {
  const before = original();
  const after = { ...before, revision: 1, quantity: 120, price: 11, status: 'pending' };
  const tx = { purchaseOrder: { findUnique: jest.fn(async () => before), updateMany: jest.fn(async () => ({ count: 1 })),
    findUniqueOrThrow: jest.fn(async () => after) }, purchaseReceipt: { count: jest.fn(async () => 0) },
    auditLog: { create: jest.fn(async () => ({})) } };
  return { tx, before, after };
}

describe('purchase revisions', () => {
  it('atomically claims the client version, invalidates approval, recalculates cost and audits before/after', async () => {
    const { tx } = fixture();
    await revisePurchaseOrder(tx as any, 1, payload(), 9);
    expect(tx.purchaseOrder.updateMany).toHaveBeenCalledWith({ where: { id: 1, revision: 0, status: 'approved', updatedAt: original().updatedAt },
      data: expect.objectContaining({ status: 'pending', revision: { increment: 1 }, quantity: 120, price: 11,
        taxAmount: 5, landedCostAmount: 1335, landedUnitCost: 11.13 }) });
    const audit = (tx.auditLog.create.mock.calls as any)[0][0].data;
    expect(audit).toMatchObject({ userId: 9, action: 'REVISE', resourceId: 1 });
    expect(JSON.parse(audit.details)).toMatchObject({ before: { revision: 0 }, after: { revision: 1 }, requiresApproval: true });
  });
  it('rejects both stale revision and same-revision stale timestamp without a write', async () => {
    for (const input of [{ ...payload(), expectedRevision: 1 }, { ...payload(), expectedUpdatedAt: '2026-09-24T00:00:00Z' }]) {
      const { tx } = fixture();
      await expect(revisePurchaseOrder(tx as any, 1, input, 9)).rejects.toMatchObject({ statusCode: 409, details: { reason: 'PURCHASE_REVISION_CONFLICT' } });
      expect(tx.purchaseOrder.updateMany).not.toHaveBeenCalled();
    }
  });
  it('does not retry a lost CAS against someone else’s version', async () => {
    const { tx } = fixture(); tx.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(revisePurchaseOrder(tx as any, 1, payload(), 9)).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.purchaseOrder.updateMany).toHaveBeenCalledTimes(1); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('throws inside the transaction when any receipt exists, including rejected-only receipts', async () => {
    const { tx } = fixture(); tx.purchaseReceipt.count.mockResolvedValue(1);
    await expect(revisePurchaseOrder(tx as any, 1, payload(), 9)).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it.each(['in_transit', 'received', 'cancelled'])('forbids rewriting %s orders', async status => {
    const { tx, before } = fixture(); before.status = status;
    await expect(revisePurchaseOrder(tx as any, 1, payload(), 9)).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.purchaseOrder.updateMany).not.toHaveBeenCalled();
  });
  it('fails rather than silently discarding an audit failure', async () => {
    const { tx } = fixture(); tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(revisePurchaseOrder(tx as any, 1, payload(), 9)).rejects.toThrow('audit unavailable');
  });
  it('requires revision, reason, an actual calendar date and explicit tax; rejects extra business fields', () => {
    for (const patch of [{ expectedRevision: undefined }, { reason: ' ' }, { eta: '2026-02-30' },
      { taxAmount: undefined }, { quantity: 0 }, { status: 'approved' }, { currency: 'USD' }]) {
      expect(revisePurchaseOrderSchema.safeParse({ ...payload(), ...patch }).success).toBe(false);
    }
  });
  it('stale approval and automatic B2B approval cannot approve revised terms', async () => {
    for (const expectedRevision of [undefined, 0]) {
      const { tx, before } = fixture(); before.revision = 1; before.status = 'pending';
      await expect(changePurchaseOrderStatus(tx as any, { purchaseOrderId: 1, nextStatus: 'approved', expectedRevision, enforceTransition: false })).rejects.toMatchObject({ statusCode: 409 });
      expect(tx.purchaseOrder.updateMany).not.toHaveBeenCalled();
    }
  });
  it('approval losing its lock to an edit cannot retry against the new revision', async () => {
    const { tx, before } = fixture(); before.status = 'pending';
    tx.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });
    tx.purchaseOrder.findUnique.mockResolvedValueOnce(before).mockResolvedValueOnce({ ...before, revision: 1 });
    await expect(changePurchaseOrderStatus(tx as any, { purchaseOrderId: 1, nextStatus: 'approved', expectedRevision: 0 })).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.purchaseOrder.updateMany).toHaveBeenCalledTimes(1);
  });
  it('idempotent status requests do not generate extra audit rows', async () => {
    const { tx } = fixture();
    await changePurchaseOrderStatus(tx as any, { purchaseOrderId: 1, nextStatus: 'approved', expectedRevision: 0, createdBy: 9 });
    expect(tx.purchaseOrder.updateMany).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
