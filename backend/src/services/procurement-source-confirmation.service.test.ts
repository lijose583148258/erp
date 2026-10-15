import { purchaseGovernanceSnapshots } from '../domain/purchase-governance';
import { buildPurchaseReceiptPayable } from '../domain/purchase-payable';
import { mapPurchaseOrder } from './procurement-domain.service';
import { changePurchaseOrderStatus } from './procurement-status.service';
import { assertFrozenPurchaseSourceEvidence, confirmPurchaseSources, getPurchaseSourceState, purchaseOrderBinding,
  purchaseSourceMetadata, resolveApprovedPurchaseSources, resolvePurchaseSourceWriter, resolveReceiptApprovedSources } from './procurement-source-confirmation.service';

jest.mock('./material-release-readiness.service', () => ({ assertMaterialReleaseReadiness: jest.fn(async () => undefined) }));

const terms = { taxTreatment: 'additional_supplier_tax' as const, supplierTaxAmount: 10, supplierChargesAmount: 5, evidenceRef: 'Supplier signed quote Q-1' };
const plan = { specificationRef: 'Signed incoming specification', specificationRevision: 'R1', characteristics: [{
  code: 'PH', name: 'pH', valueType: 'numeric' as const, unit: 'pH', lowerLimit: '6.5', upperLimit: '7.5',
  targetText: null, testMethod: 'Calibrated pH meter', required: true, sortOrder: 0,
}] };
type Audit = { id: number; userId: number; action: string; resource: string; resourceId: number; details: string };
function fixture(status = 'pending', restore: 'in_transit' | null = null) {
  const order = { id: 41, revision: 2, supplierId: 3, materialId: 7, item: 'Resin', unit: 'kg', quantity: 10, price: 20,
    currency: 'USD', exchangeRate: 0.14, status, updatedAt: new Date('2026-10-14T00:00:00Z'), eta: new Date('2026-10-15'),
    taxAmount: 0, landedCostAmount: 1520, landedUnitCost: 152, supplier: { name: 'Supplier' }, salesOrder: null,
    ...purchaseGovernanceSnapshots({ revision: 2, supplierId: 3, materialId: 7, unit: 'kg', quantity: 10, price: 20, currency: 'USD', exchangeRate: 0.14 }, terms, plan) };
  const writer: Audit = { id: 10, userId: 5, action: 'CONFIRM_SOURCES', resource: 'purchase_order', resourceId: order.id,
    details: JSON.stringify({ schema: 'purchase-source-confirmation/v1', after: mapPurchaseOrder({ ...order, status: 'pending' }), source: purchaseSourceMetadata(order, restore) }) };
  const approval: Audit = { id: 11, userId: 6, action: 'STATUS_CHANGE', resource: 'purchase_order', resourceId: order.id,
    details: JSON.stringify({ schema: 'purchase-status/v2', from: 'pending', to: restore || 'approved', isSourceApproval: true,
      revision: order.revision, sourceAuditId: writer.id, supplierPayableHash: purchaseSourceMetadata(order).supplierPayableHash,
      incomingQualityHash: purchaseSourceMetadata(order).incomingQualityHash }) };
  const audits: Audit[] = [writer, ...(status === 'pending' ? [] : [approval])];
  const tx = {
    $executeRawUnsafe: jest.fn(async () => 1),
    purchaseOrder: { findUnique: jest.fn(async () => ({ ...order })), updateMany: jest.fn(async (args: any) => {
      Object.assign(order, args.data); return { count: 1 };
    }), update: jest.fn(async (args: any) => { const { revision, ...data } = args.data;
      Object.assign(order, data, { revision: order.revision + revision.increment }); return { ...order };
    }) },
    purchaseReceipt: { count: jest.fn(async () => 0) }, stockEntry: { findFirst: jest.fn(async (): Promise<any> => null) },
    auditLog: { findMany: jest.fn(async (args: any) => {
      const allowed = args.where.action.in || [args.where.action];
      return audits.filter(row => allowed.includes(row.action) && row.resource === args.where.resource && row.resourceId === args.where.resourceId)
        .sort((a, b) => b.id - a.id).slice(0, args.take);
    }), findUnique: jest.fn(async (args: any) => audits.find(row => row.id === args.where.id) || null),
    create: jest.fn(async (args: any) => { const row: Audit = { id: 20 + audits.length, ...args.data }; audits.push(row); return row; }) },
  };
  const frozen = { purchaseOrderId: order.id, binding: purchaseOrderBinding(order), supplierPayableBasisJson: order.supplierPayableBasisJson!,
    incomingQualityPlanJson: order.incomingQualityPlanJson!, sourceAuditId: writer.id, approvalAuditId: approval.id };
  return { order, writer, approval, audits, tx, frozen };
}

describe('purchase sources retain independent and revision-bound provenance', () => {
  test('read-back validates both exact source JSONs, their commercial binding and another actor’s approval', async () => {
    const { tx, order } = fixture('approved');
    expect(await resolveApprovedPurchaseSources(tx as any, order)).toMatchObject({ sourceUserId: 5, approverUserId: 6,
      sourceAuditId: 10, approvalAuditId: 11, basis: { amountNative: 215, amountBase: 1535.71 } });
    expect(tx.purchaseOrder.updateMany).not.toHaveBeenCalled();
  });
  test.each(['revision', 'quantity', 'price', 'supplierId', 'materialId', 'unit', 'currency', 'exchangeRate', 'sourceJson'])('rejects altered writer %s', async field => {
    const f = fixture('approved'), details = JSON.parse(f.writer.details);
    if (field === 'sourceJson') details.after.incomingQualityPlanJson = '{}';
    else details.after[field] = field === 'currency' ? 'EUR' : field === 'unit' ? 'g' : Number(details.after[field]) + 1;
    f.writer.details = JSON.stringify(details);
    await expect(resolveApprovedPurchaseSources(f.tx as any, f.order)).rejects.toThrow('SOURCE_CONFIRMATION_REQUIRED');
  });
  test.each(['creator', 'missing', 'wrong-order', 'wrong-source', 'dispatch-not-approval', 'old-schema', 'wrong-revision', 'wrong-to', 'approval-before-source'])('rejects invalid approval %s', async change => {
    const f = fixture('approved'), details = JSON.parse(f.approval.details);
    if (change === 'creator') f.approval.userId = f.writer.userId;
    if (change === 'missing') f.audits.pop();
    if (change === 'wrong-order') f.approval.resourceId++;
    if (change === 'wrong-source') details.sourceAuditId++;
    if (change === 'dispatch-not-approval') details.isSourceApproval = false;
    if (change === 'old-schema') details.schema = 'purchase-status/v1';
    if (change === 'wrong-revision') details.revision++;
    if (change === 'wrong-to') details.to = 'in_transit';
    if (change === 'approval-before-source') f.approval.id = 9;
    f.approval.details = JSON.stringify(details);
    await expect(resolveApprovedPurchaseSources(f.tx as any, f.order)).rejects.toThrow('INDEPENDENT_APPROVAL_REQUIRED');
  });
  test('a frozen receipt resolves original audit IDs without reading or trusting a later live PO', async () => {
    const f = fixture('approved');
    f.order.status = 'cancelled'; f.order.revision = 3; f.order.price = 999;
    expect(await assertFrozenPurchaseSourceEvidence(f.tx as any, f.frozen)).toMatchObject({ binding: { revision: 2, price: 20 }, approvalAuditId: 11 });
    expect(f.tx.auditLog.findMany).not.toHaveBeenCalled(); expect(f.tx.purchaseOrder.findUnique).not.toHaveBeenCalled();
    const p = buildPurchaseReceiptPayable({ ...f.frozen, receiptNo: 'PRC-42', supplierBatchNo: 'ACTUAL-SUPPLIER-LOT', batchNo: 'INTERNAL-42',
      receivedBy: 8, receivedQuantity: 2, receivedQuantityBefore: 0, postedAmountNativeBefore: 0, postedAmountBaseBefore: 0 });
    expect(await resolveReceiptApprovedSources(f.tx as any, { purchaseOrderId: 41, receiptNo: 'PRC-42', supplierBatchNo: 'ACTUAL-SUPPLIER-LOT', batchNo: 'INTERNAL-42',
      receivedBy: 8, acceptedQuantity: 2, ...p, incomingQualityPlanJson: f.frozen.incomingQualityPlanJson })).toMatchObject({ binding: { revision: 2 }, approvalAuditId: 11 });
  });
  test('simultaneously rewritten frozen plan and receipt JSON cannot contradict the original source audit', async () => {
    const f = fixture('approved');
    const changed = purchaseGovernanceSnapshots(f.frozen.binding, terms, { ...plan, specificationRevision: 'UNAPPROVED' });
    await expect(assertFrozenPurchaseSourceEvidence(f.tx as any, { ...f.frozen, incomingQualityPlanJson: changed.incomingQualityPlanJson! }))
      .rejects.toThrow('SOURCE_CONFIRMATION_REQUIRED');
  });
  test('a later source writer invalidates live approval but cannot erase the original receipt’s provenance', async () => {
    const f = fixture('approved');
    f.audits.push({ ...f.writer, id: 12 });
    await expect(resolveApprovedPurchaseSources(f.tx as any, f.order)).rejects.toThrow('INDEPENDENT_APPROVAL_REQUIRED');
    expect(await assertFrozenPurchaseSourceEvidence(f.tx as any, f.frozen)).toMatchObject({ sourceAuditId: 10 });
  });
});

describe('legacy transit source confirmation cannot become a commercial rewrite', () => {
  const input = (f: ReturnType<typeof fixture>) => ({ expectedRevision: f.order.revision, expectedUpdatedAt: f.order.updatedAt.toISOString(),
    supplierPayableTerms: terms, incomingQualityPlan: plan, reason: 'Confirm real supplier quote and specification' });
  test('creates a pending revision, preserves transit/cost/quantity and restores transit only after independent approval', async () => {
    const f = fixture('in_transit'), before = { ...f.order };
    f.audits.length = 0; // Historical transit row has terms, but no proven independent source approval.
    const after = await confirmPurchaseSources(f.tx as any, f.order.id, input(f), 7);
    expect(after).toMatchObject({ status: 'pending', revision: 3, quantity: before.quantity, price: before.price,
      taxAmount: before.taxAmount, landedCostAmount: before.landedCostAmount, landedUnitCost: before.landedUnitCost });
    expect(f.tx.purchaseOrder.update.mock.calls[0][0].data).not.toHaveProperty('quantity');
    expect(await resolvePurchaseSourceWriter(f.tx as any, after)).toMatchObject({ sourceUserId: 7, restoreOperationalStatus: 'in_transit' });
    await expect(changePurchaseOrderStatus(f.tx as any, { purchaseOrderId: 41, nextStatus: 'approved', expectedRevision: 3, createdBy: 7 }))
      .rejects.toThrow('INDEPENDENT_APPROVAL_REQUIRED');
    expect(await changePurchaseOrderStatus(f.tx as any, { purchaseOrderId: 41, nextStatus: 'approved', expectedRevision: 3, createdBy: 6 }))
      .toMatchObject({ status: 'in_transit', revision: 3 });
    const auditsBeforeReplay = f.audits.length;
    expect(await changePurchaseOrderStatus(f.tx as any, { purchaseOrderId: 41, nextStatus: 'approved', expectedRevision: 3, createdBy: 6 }))
      .toMatchObject({ status: 'in_transit', revision: 3 });
    expect(f.audits).toHaveLength(auditsBeforeReplay);
  });
  test.each(['receipt', 'orphan-stock'])('blocks confirmation of unreconciled history %s', async history => {
    const f = fixture('in_transit');
    if (history === 'receipt') f.tx.purchaseReceipt.count.mockResolvedValue(1); else f.tx.stockEntry.findFirst.mockResolvedValue({ id: 99 });
    await expect(confirmPurchaseSources(f.tx as any, 41, input(f), 7)).rejects.toThrow('HISTORY_UNRECONCILED');
    expect(f.tx.purchaseOrder.update).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });
  test('uses the client revision and timestamp; rejects extra commercial fields without writing', async () => {
    const f = fixture('in_transit');
    for (const patch of [{ expectedRevision: 1 }, { expectedUpdatedAt: '2026-10-13T00:00:00Z' }, { quantity: 999 }]) {
      await expect(confirmPurchaseSources(f.tx as any, 41, { ...input(f), ...patch }, 7)).rejects.toThrow();
    }
    expect(f.tx.purchaseOrder.update).not.toHaveBeenCalled();
  });
  test('reports orphan posted stock as history_unreconciled, not an empty-history source form', async () => {
    const f = fixture('in_transit'); f.audits.length = 0; f.tx.stockEntry.findFirst.mockResolvedValue({ id: 99 });
    expect(await getPurchaseSourceState(f.tx as any, f.order)).toEqual({ state: 'history_unreconciled', restoreOperationalStatus: 'in_transit' });
  });
  test.each(['pending', 'approved', 'in_transit'])('does not generate a redundant revision for already confirmed unchanged %s sources', async status => {
    const f = fixture(status);
    await expect(confirmPurchaseSources(f.tx as any, 41, input(f), 7)).rejects.toThrow('SOURCES_UNCHANGED');
    expect(f.tx.purchaseOrder.update).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('status commands cannot synthesize physical receipts or bypass approval', () => {
  test('requires an explicit reviewed revision even for revision zero approval', async () => {
    const f = fixture(); f.order.revision = 0;
    await expect(changePurchaseOrderStatus(f.tx as any, { purchaseOrderId: 41, nextStatus: 'approved', createdBy: 6, enforceTransition: false }))
      .rejects.toMatchObject({ statusCode: 409, details: { reason: 'PURCHASE_REVISION_CONFLICT' } });
    expect(f.tx.purchaseOrder.updateMany).not.toHaveBeenCalled();
  });
  test('same-status approved replay is read-only only when its independent source approval is proven', async () => {
    const f = fixture('approved');
    await changePurchaseOrderStatus(f.tx as any, { purchaseOrderId: 41, nextStatus: 'approved', expectedRevision: 2, createdBy: 6 });
    expect(f.tx.purchaseOrder.updateMany).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    f.audits.pop();
    await expect(changePurchaseOrderStatus(f.tx as any, { purchaseOrderId: 41, nextStatus: 'approved', expectedRevision: 2, createdBy: 6 }))
      .rejects.toThrow('INDEPENDENT_APPROVAL_REQUIRED');
  });
  test('ordinary dispatch retains approval evidence but cannot masquerade as an approval audit', async () => {
    const f = fixture('approved');
    await changePurchaseOrderStatus(f.tx as any, { purchaseOrderId: 41, nextStatus: 'in_transit', expectedRevision: 2, createdBy: 5 });
    expect(JSON.parse(f.audits[f.audits.length - 1].details)).toMatchObject({ from: 'approved', to: 'in_transit', isSourceApproval: false });
    expect(await resolveApprovedPurchaseSources(f.tx as any, f.order)).toMatchObject({ approvalAuditId: 11 });
  });
  test('blocks both status receive and B2B bypass without any inventory/audit write', async () => {
    const f = fixture('in_transit');
    await expect(changePurchaseOrderStatus(f.tx as any, { purchaseOrderId: 41, nextStatus: 'received', expectedRevision: 2, createdBy: 6, enforceTransition: false }))
      .rejects.toThrow('ACTUAL_RECEIPT_REQUIRED');
    expect(f.tx.purchaseOrder.updateMany).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });
  test('a received legacy row remains read-only and does not infer historical AP', async () => {
    const f = fixture('received'); f.order.supplierPayableBasisJson = null;
    expect(await changePurchaseOrderStatus(f.tx as any, { purchaseOrderId: 41, nextStatus: 'received', expectedRevision: 2, createdBy: 6 }))
      .toMatchObject({ status: 'received', supplierPayableBasisJson: null });
    expect(f.tx.auditLog.findMany).not.toHaveBeenCalled(); expect(f.tx.purchaseOrder.updateMany).not.toHaveBeenCalled();
  });
});
