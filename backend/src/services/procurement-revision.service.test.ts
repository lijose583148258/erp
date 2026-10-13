import { revisePurchaseOrder } from './procurement-revision.service';
import { changePurchaseOrderStatus } from './procurement-status.service';
import { revisePurchaseOrderSchema } from '../validators/procurement';
import { purchaseGovernanceSnapshots } from '../domain/purchase-governance';

jest.mock('./material-release-readiness.service', () => ({ assertMaterialReleaseReadiness: jest.fn(async () => undefined) }));

const original = () => ({ id: 1, revision: 0, status: 'approved', quantity: 100, price: 10, taxAmount: 0,
  eta: new Date('2026-10-01'), updatedAt: new Date('2026-09-25T00:00:00Z'), supplierId: 1, currency: 'CNY',
  exchangeRate: 1, materialId: 7, unit: 'kg', taxRate: 0, freightCost: 10, dutyCost: 0, insuranceCost: 0, otherCost: 0,
  supplierPayableBasisJson: null as string | null, incomingQualityPlanJson: null as string | null, supplier: {}, salesOrder: null });
const payload = () => ({ expectedRevision: 0, expectedUpdatedAt: original().updatedAt.toISOString(),
  quantity: 120, price: 11, taxAmount: 5, eta: '2026-10-02', reason: 'Supplier confirmed revised terms' });
function fixture() {
  const before = original();
  const after = { ...before };
  const tx = { purchaseOrder: { findUnique: jest.fn(async () => before), updateMany: jest.fn(async (input: any) => {
      const { revision, ...data } = input.data;
      Object.assign(after, data, revision ? { revision: before.revision + revision.increment } : {});
      return { count: 1 };
    }),
    findUniqueOrThrow: jest.fn(async () => after) }, purchaseReceipt: { count: jest.fn(async () => 0) },
    auditLog: { create: jest.fn(async () => ({})) } };
  return { tx, before, after };
}

const payableTerms = () => ({ taxTreatment: 'additional_supplier_tax' as const,
  supplierTaxAmount: 10, supplierChargesAmount: 5, evidenceRef: 'Supplier confirmed quotation Q-100' });
const qualityPlan = () => ({ specificationRef: 'Supplier incoming specification', specificationRevision: 'R1', characteristics: [{
  code: 'PH', name: 'pH', valueType: 'numeric' as const, unit: 'pH', lowerLimit: '6.5', upperLimit: '7.5',
  targetText: null, testMethod: 'Calibrated meter', required: true, sortOrder: 0,
}] });
const orderBinding = (order: ReturnType<typeof original>) => ({ revision: order.revision, supplierId: order.supplierId,
  materialId: order.materialId, unit: order.unit, quantity: order.quantity, price: order.price,
  currency: order.currency, exchangeRate: order.exchangeRate });
const unchangedCommercialInput = () => ({ ...payload(), quantity: original().quantity, price: original().price,
  taxAmount: original().taxAmount, eta: original().eta.toISOString().slice(0, 10) });
function governedFixture() {
  const f = fixture();
  Object.assign(f.before, purchaseGovernanceSnapshots(orderBinding(f.before), payableTerms(), qualityPlan()));
  Object.assign(f.after, f.before);
  return f;
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

  it('revises governance alone, freezes the new revision and audits both unchanged commercial and changed governance values', async () => {
    const { tx, before, after } = governedFixture();
    const prior = { ...before };
    const terms = { ...payableTerms(), supplierTaxAmount: 20, evidenceRef: 'Supplier corrected tax Q-101' };
    const plan = { ...qualityPlan(), specificationRevision: 'R2' };
    const expected = purchaseGovernanceSnapshots({ ...orderBinding(before), revision: 1 }, terms, plan);
    await revisePurchaseOrder(tx as any, 1, { ...unchangedCommercialInput(), supplierPayableTerms: terms, incomingQualityPlan: plan }, 9);
    expect(tx.purchaseOrder.updateMany).toHaveBeenCalledWith({ where: { id: 1, revision: 0, status: 'approved', updatedAt: prior.updatedAt },
      data: expect.objectContaining({ ...expected, quantity: 100, price: 10, status: 'pending', revision: { increment: 1 } }) });
    expect(after).toMatchObject({ ...expected, revision: 1, status: 'pending', quantity: 100, price: 10 });
    const audit = (tx.auditLog.create.mock.calls as any)[0][0].data;
    expect(audit).toMatchObject({ userId: 9, action: 'REVISE', resourceId: 1 });
    expect(JSON.parse(audit.details)).toMatchObject({ requiresApproval: true,
      before: { revision: 0, quantity: 100, price: 10, supplierPayableBasisJson: prior.supplierPayableBasisJson, incomingQualityPlanJson: prior.incomingQualityPlanJson },
      after: { revision: 1, quantity: 100, price: 10, ...expected } });
    expect(before).toEqual(prior);
  });

  it('clears both old snapshots on commercial revision unless explicitly reconfirmed', async () => {
    const { tx, before, after } = governedFixture();
    const prior = { ...before };
    await revisePurchaseOrder(tx as any, 1, payload(), 9);
    expect(after).toMatchObject({ revision: 1, quantity: 120, price: 11, supplierPayableBasisJson: null, incomingQualityPlanJson: null });
    expect(tx.purchaseOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      supplierPayableBasisJson: null, incomingQualityPlanJson: null,
    }) }));
    expect(JSON.parse((tx.auditLog.create.mock.calls as any)[0][0].data.details)).toMatchObject({
      before: { supplierPayableBasisJson: prior.supplierPayableBasisJson, incomingQualityPlanJson: prior.incomingQualityPlanJson },
      after: { supplierPayableBasisJson: null, incomingQualityPlanJson: null },
    });
    expect(before).toEqual(prior);
  });

  it.each(['payable', 'quality'])('does not carry unconfirmed old governance when only %s is supplied', async confirmed => {
    const { tx, before, after } = governedFixture();
    const terms = confirmed === 'payable' ? { ...payableTerms(), supplierTaxAmount: 20 } : undefined;
    const plan = confirmed === 'quality' ? { ...qualityPlan(), specificationRevision: 'R2' } : undefined;
    const expected = purchaseGovernanceSnapshots({ ...orderBinding(before), revision: 1 }, terms, plan);
    await revisePurchaseOrder(tx as any, 1, { ...unchangedCommercialInput(),
      ...(terms ? { supplierPayableTerms: terms } : {}), ...(plan ? { incomingQualityPlan: plan } : {}) }, 9);
    expect(after).toMatchObject({ ...expected, revision: 1, status: 'pending' });
    expect(confirmed === 'payable' ? after.incomingQualityPlanJson : after.supplierPayableBasisJson).toBeNull();
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('rejects unchanged commercial and governance content without a revision (explicit=%s)', async explicit => {
    const { tx, before } = governedFixture();
    const prior = { ...before };
    await expect(revisePurchaseOrder(tx as any, 1, { ...unchangedCommercialInput(),
      ...(explicit ? { supplierPayableTerms: payableTerms(), incomingQualityPlan: qualityPlan() } : {}) }, 9))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(tx.purchaseOrder.updateMany).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(before).toEqual(prior);
  });

  it('rejects governance-only edits after any receipt through the existing PO claim boundary', async () => {
    const { tx, before } = governedFixture();
    const prior = { ...before }; tx.purchaseReceipt.count.mockResolvedValue(1);
    await expect(revisePurchaseOrder(tx as any, 1, { ...unchangedCommercialInput(),
      supplierPayableTerms: { ...payableTerms(), supplierTaxAmount: 20 }, incomingQualityPlan: qualityPlan() }, 9))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(tx.purchaseOrder.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.purchaseOrder.updateMany.mock.invocationCallOrder[0]).toBeLessThan(tx.purchaseReceipt.count.mock.invocationCallOrder[0]);
    expect(tx.auditLog.create).not.toHaveBeenCalled(); expect(before).toEqual(prior);
    // This unit proves rejection inside the caller's transaction, not database rollback by a mocked client.
  });

  it('cannot overwrite governance after losing its revision claim to another purchaser', async () => {
    const { tx, before } = governedFixture();
    const prior = { ...before };
    tx.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });
    tx.purchaseOrder.findUnique.mockResolvedValueOnce(before).mockResolvedValueOnce({ ...before, revision: 1, status: 'pending' });
    await expect(revisePurchaseOrder(tx as any, 1, { ...unchangedCommercialInput(),
      supplierPayableTerms: { ...payableTerms(), supplierTaxAmount: 20 }, incomingQualityPlan: qualityPlan() }, 9))
      .rejects.toMatchObject({ statusCode: 409, details: { reason: 'PURCHASE_REVISION_CONFLICT' } });
    expect(tx.purchaseOrder.updateMany).toHaveBeenCalledTimes(1); expect(tx.purchaseReceipt.count).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled(); expect(before).toEqual(prior);
  });
});
