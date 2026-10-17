jest.mock('../config/database', () => ({ __esModule: true, default: {} }));
import { createPurchaseReceiptBatch, postProcurementReceiptIfMissing, readPostedPurchaseReceiptCost } from './procurement-receipt.service';
import type { TransactionClient } from './stock-movement.types';

const order = { id: 9, materialId: 7, item: 'Original label', unit: 'kg', quantity: 3 };
const row = (id = 1, cost = 0.17): Record<string, unknown> => ({
  receiptId: id, quantity: 0.5, accepted: 0.5, rejected: 0, unit: 'kg',
  receiptBatch: 'SUPPLIER-LOT', receiptRef: `PO-9-RCV-${id}`, receiptRefCount: 1,
  entryId: 10 + id, entryNo: `STK-${id}`, movementId: 20 + id,
  materialId: 7, productName: 'Renamed canonical label', batchNo: 'SUPPLIER-LOT', movementUnit: 'kg',
  movementBefore: 0, movementDelta: 0.5, movementAfter: 0.5,
  batchId: 31, batchMaterialId: 7, batchUnit: 'kg', ledgerId: 40 + id,
  ledgerBatchId: 31, ledgerSourceType: 'inventory_adjustment',
  ledgerBefore: 5, ledgerDelta: 0.5, ledgerAfter: 5.5,
  costBefore: 2, costDelta: cost, costAfter: Math.round((2 + cost) * 100) / 100,
});
function transaction(rows: Record<string, unknown>[], orphans: Array<{ id: number }> = []) {
  const query = jest.fn().mockResolvedValueOnce(orphans).mockResolvedValueOnce(rows);
  return { tx: { $queryRawUnsafe: query } as unknown as TransactionClient, query };
}

describe('immutable procurement receipt cost history', () => {
  it.each([0.0000001, 1.1234567, 1e15])('rejects quantities outside the six-decimal physical ledger before any write: %s', quantity => {
    return expect(createPurchaseReceiptBatch({} as TransactionClient, { purchaseOrderId: 9, quantity, createdBy: 7, idempotencyKey: 'receipt-precise-123' })).rejects.toThrow('INVALID_QUANTITY');
  });
  it.each([null, undefined, 0, -1, NaN, Infinity])('does not create unvalued physical history without an accountable actor: %s', async actor => {
    const untouched = {} as TransactionClient;
    await expect(createPurchaseReceiptBatch(untouched, { purchaseOrderId: 9, quantity: 1, createdBy: actor })).rejects.toThrow('ACTOR_REQUIRED');
    const tx = { stockEntry: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as TransactionClient;
    await expect(postProcurementReceiptIfMissing(tx, order, actor)).rejects.toThrow('ACTOR_REQUIRED');
  });

  it('retains a committed legacy full receipt replay without creating a new actorless posting', async () => {
    const tx = { stockEntry: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) } } as unknown as TransactionClient;
    expect(await postProcurementReceiptIfMissing(tx, order)).toEqual({ posted: false, sourceRef: 'PO-9' });
  });
  it('does not turn a full-status shortcut into a physical receipt even with an accountable actor', async () => {
    const tx = { stockEntry: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as TransactionClient;
    await expect(postProcurementReceiptIfMissing(tx, order, 7)).rejects.toThrow('ACTUAL_RECEIPT_REQUIRED');
  });

  it('reads actual historical cents across a shared batch, not current stock or an ideal fraction', async () => {
    const rows = [row(1, 33.33), row(2, 33.33)];
    rows.forEach(r => Object.assign(r, { quantity: 1, accepted: 1, movementDelta: 1, movementAfter: 1, ledgerDelta: 1, ledgerAfter: 6 }));
    const { tx, query } = transaction(rows);
    expect(await readPostedPurchaseReceiptCost(tx, order, 2)).toBe(66.66);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('l.source_ref = e.entry_no');
    expect(query.mock.calls[1][0]).not.toContain('l.batch_id = b.id');
    expect(query.mock.calls[1][1]).toBe(order.id);
  });

  it('does not require location movement boundaries to equal batch-global ledger boundaries', async () => {
    const { tx } = transaction([row()]);
    expect(await readPostedPurchaseReceiptCost(tx, order, 0.5)).toBe(0.17);
  });

  it('accepts empty history only when there is no orphan posted procurement voucher', async () => {
    expect(await readPostedPurchaseReceiptCost(transaction([]).tx, order, 0)).toBe(0);
    const { tx, query } = transaction([], [{ id: 1 }]);
    await expect(readPostedPurchaseReceiptCost(tx, order, 0)).rejects.toThrow('COST_RECONCILIATION_REQUIRED');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0].slice(1)).toEqual([9, 'PO-9', 'PO-9-RCV-%']);
  });

  it('excludes door-rejected quantities with no physical or financial posting', async () => {
    const rejected = { receiptId: 2, quantity: 1, accepted: 0, rejected: 1, unit: 'kg', receiptRef: null, entryId: null };
    expect(await readPostedPurchaseReceiptCost(transaction([row(), rejected]).tx, order, 0.5)).toBe(0.17);
    await expect(readPostedPurchaseReceiptCost(transaction([{ ...rejected, receiptRef: 'PO-9' }]).tx, order, 0)).rejects.toThrow('COST_RECONCILIATION_REQUIRED');
  });

  it.each([
    ['entryId', null], ['movementId', null], ['ledgerId', null], ['batchId', null],
    ['receiptRefCount', 2], ['receiptRef', 'PO-19-RCV-1'], ['receiptBatch', 'OTHER-LOT'],
    ['materialId', 8], ['batchMaterialId', 8], ['movementUnit', 'g'], ['batchUnit', 'g'],
    ['ledgerBatchId', 99], ['ledgerSourceType', 'shipping_issue'], ['quantity', 1],
    ['accepted', NaN], ['rejected', -1], ['movementDelta', 0.6], ['movementAfter', 0.6],
    ['ledgerDelta', 0.6], ['ledgerAfter', 5.6], ['costDelta', null], ['costDelta', NaN],
    ['costDelta', Infinity], ['costDelta', -0.01], ['costDelta', 0.001],
    ['costAfter', 2.18], ['costBefore', 2.001], ['ledgerId', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects missing, ambiguous or inconsistent %s=%s without guessing', async (key, value) => {
    const { tx } = transaction([{ ...row(), [key as string]: value }]);
    await expect(readPostedPurchaseReceiptCost(tx, order, 0.5)).rejects.toThrow('COST_RECONCILIATION_REQUIRED');
  });

  it.each(['receiptId', 'entryId', 'movementId', 'ledgerId'])('does not reuse the same %s across receipt evidence', async key => {
    const first = row(1), second = row(2); second[key] = first[key];
    await expect(readPostedPurchaseReceiptCost(transaction([first, second]).tx, order, 1)).rejects.toThrow('COST_RECONCILIATION_REQUIRED');
  });

  it('rejects a missing or stale accepted-quantity history instead of treating it as zero cost', async () => {
    await expect(readPostedPurchaseReceiptCost(transaction([]).tx, order, 0.5)).rejects.toThrow('COST_RECONCILIATION_REQUIRED');
    await expect(readPostedPurchaseReceiptCost(transaction([row()]).tx, order, 0)).rejects.toThrow('COST_RECONCILIATION_REQUIRED');
  });

  it('uses the frozen product label only for a legacy order without canonical material identity', async () => {
    const legacy = { ...order, materialId: null };
    expect(await readPostedPurchaseReceiptCost(transaction([{ ...row(), productName: order.item }]).tx, legacy, 0.5)).toBe(0.17);
    await expect(readPostedPurchaseReceiptCost(transaction([row()]).tx, legacy, 0.5)).rejects.toThrow('COST_RECONCILIATION_REQUIRED');
  });
});
