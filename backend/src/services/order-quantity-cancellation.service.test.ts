import prisma from '../config/database';
import { ReceivableAdjustmentService as service } from './receivable-adjustment.service';
import type { AuthRequest } from '../middleware/auth';
import { CollectionStateService } from './collection-state.service';
import { createReceivableAdjustmentSchema } from '../validators/receivable-adjustment';

jest.mock('../config/database', () => ({ __esModule: true, default: { $transaction: jest.fn(), receivableAdjustment: { findUnique: jest.fn() } } }));
jest.mock('./collection-state.service', () => ({ CollectionStateService: { syncCustomerOverdueAmountTx: jest.fn() } }));
const date = new Date('2026-10-12T00:00:00.000Z');
const request = { orderItemId: 3, quantity: 60, expectedUpdatedAt: date.toISOString(), idempotencyKey: 'cancel-request-1', reason: 'Customer cancelled remainder' };
const actor = { user: { userId: 10, role: 'sales', segment: 'direct' } } as AuthRequest;

function fixture() {
  const order = { id: 2, customerId: 1, createdBy: 10, customer: { salespersonId: 10, poolState: 'private', segment: 'direct' },
    status: 'shipped', updatedAt: date, currency: 'CNY', lockedExchangeRate: 1,
    totalAmount: 1000, discountAmount: 0, finalAmount: 1000, paidAmount: 400, receivableAdjustmentAmount: 0, paymentStatus: 'partial',
    items: [{ id: 3, quantity: 100, unit: 'kg', totalPrice: 1000 }],
    shipments: [{ orderItemId: 3, quantity: 40, unit: 'kg', status: 'delivered', receipts: [{ acceptedQuantity: 40, rejectedQuantity: 0, unit: 'kg' }] }],
    receivableAdjustments: [] as Array<Record<string, unknown>> };
  const record = { id: 7, orderId: 2, customerId: 1, orderItemId: 3, cancelledQuantity: 60, amount: 600, currency: 'CNY',
    exchangeRate: 1, baseAmount: 600, adjustmentType: 'order_quantity_cancellation', status: 'pending', createdBy: 10,
    reason: request.reason, requestKey: request.idempotencyKey, requestFingerprint: '', beforeSnapshot: null, afterSnapshot: null };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1), auditLog: { create: jest.fn().mockResolvedValue({}) },
    order: { findFirst: jest.fn().mockResolvedValue(order), findUniqueOrThrow: jest.fn().mockResolvedValue(order), findUnique: jest.fn().mockResolvedValue(order),
      update: jest.fn().mockResolvedValue(order), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    receivableAdjustment: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => where.requestKey ? null : record),
      create: jest.fn().mockImplementation(async ({ data }) => ({ ...record, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockImplementation(async ({ data }) => ({ ...record, ...data })),
    },
  };
  (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(tx));
  (prisma.receivableAdjustment.findUnique as jest.Mock).mockResolvedValue(record);
  return { order, record, tx };
}
beforeEach(() => jest.clearAllMocks());

describe('typed order quantity cancellation', () => {
  it('conserves original-currency and base-currency cents across repeated partial cancellations', async () => {
    const { order, tx } = fixture();
    Object.assign(order, { currency: 'USD', lockedExchangeRate: 2 / 3, baseAmount: 1.5, totalAmount: 1, finalAmount: 1, paidAmount: 0,
      shipments: [], items: [{ id: 3, quantity: 3, unit: 'kg', totalPrice: 1 }] });
    const credits: number[] = [];
    for (let i = 0; i < 3; i++) {
      await service.createOrderQuantityCancellation(2, { ...request, quantity: 1, idempotencyKey: `foreign-cancel-${i}` }, actor);
      const data = tx.receivableAdjustment.create.mock.calls[i][0].data;
      credits.push(data.baseAmount); order.receivableAdjustments.push({ ...data, id: i + 10, status: 'posted' });
      order.receivableAdjustmentAmount = Math.round((order.receivableAdjustmentAmount + data.amount) * 100) / 100;
    }
    expect(order.receivableAdjustmentAmount).toBe(1);
    expect(credits).toEqual([0.5, 0.5, 0.5]);
  });

  it('requests a server-priced pending credit after claiming and rechecking the scoped order', async () => {
    const { tx } = fixture(); const result = await service.createOrderQuantityCancellation(2, request, actor);
    expect(result).toMatchObject({ adjustmentType: 'order_quantity_cancellation', amount: 600, cancelledQuantity: 60, status: 'pending' });
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.order.findFirst.mock.invocationCallOrder[1]);
    expect(tx.receivableAdjustment.create.mock.calls[0][0].data).toMatchObject({ createdBy: 10, requestKey: request.idempotencyKey, requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'REQUEST_ORDER_QUANTITY_CANCELLATION' }) });
  });
  it('replays the original request even after status/version changes, without another audit', async () => {
    const { tx, order } = fixture(); await service.createOrderQuantityCancellation(2, request, actor);
    const persisted = { id: 7, ...tx.receivableAdjustment.create.mock.calls[0][0].data };
    tx.receivableAdjustment.findUnique.mockResolvedValue(persisted); order.status = 'completed'; order.updatedAt = new Date();
    await expect(service.createOrderQuantityCancellation(2, request, actor)).resolves.toMatchObject({ id: 7 });
    expect(tx.receivableAdjustment.create).toHaveBeenCalledTimes(1); expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    await expect(service.createOrderQuantityCancellation(2, { ...request, quantity: 1 }, actor)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('rechecks ownership inside the row lock', async () => {
    const { tx } = fixture(); tx.order.findFirst.mockResolvedValueOnce(await tx.order.findFirst()).mockResolvedValue(null);
    await expect(service.createOrderQuantityCancellation(2, request, actor)).rejects.toThrow('NOT_FOUND');
    expect(tx.receivableAdjustment.create).not.toHaveBeenCalled();
  });
  it('does not let ordinary finance creation forge a quantity cancellation', () => {
    expect(createReceivableAdjustmentSchema.safeParse({ orderId: 2, adjustmentType: 'order_quantity_cancellation', amount: 600, reason: 'test' }).success).toBe(false);
  });
  it('requires an independent posting actor, including replay', async () => {
    const { record, tx } = fixture();
    for (const status of ['pending', 'posted']) {
      record.status = status;
      await expect(service.postAdjustment(7, 10)).rejects.toThrow('INDEPENDENT_REVIEW_REQUIRED');
    }
    expect(tx.order.update).not.toHaveBeenCalled();
  });
  it('posts the quantity and AR through one transaction without rewriting original amounts or paid cash', async () => {
    const { tx } = fixture(); await service.postAdjustment(7, 20);
    expect(tx.order.update.mock.invocationCallOrder[0]).toBeLessThan(tx.order.findUniqueOrThrow.mock.invocationCallOrder[0]);
    expect(tx.order.findUniqueOrThrow.mock.calls[0][0].include.receivableAdjustments.where).toEqual({ id: { not: 7 } });
    expect(tx.order.updateMany.mock.calls[0][0].data).toEqual({ receivableAdjustmentAmount: 600, paymentStatus: 'paid' });
    expect(tx.receivableAdjustment.update.mock.calls[0][0].data).toMatchObject({ status: 'posted', postedBy: 20 });
    expect(CollectionStateService.syncCustomerOverdueAmountTx).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create.mock.calls[0][0].data.action).toBe('POST_ORDER_QUANTITY_CANCELLATION');
  });
  it.each(['allocation', 'payment', 'price', 'currency', 'closed', 'cancelled'])('rejects a stale request after %s changed', async kind => {
    const { order, tx } = fixture();
    if (kind === 'allocation') order.shipments.push({ orderItemId: 3, quantity: 1, unit: 'kg', status: 'pending', receipts: [] });
    if (kind === 'payment') order.paidAmount = 500;
    if (kind === 'price') { order.totalAmount = 1200; order.finalAmount = 1200; order.items[0].totalPrice = 1200; }
    if (kind === 'currency') order.currency = 'USD';
    if (kind === 'closed') order.status = 'completed';
    if (kind === 'cancelled') order.status = 'cancelled';
    await expect(service.postAdjustment(7, 20)).rejects.toThrow('ORDER_CANCELLATION_');
    expect(tx.order.updateMany).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('does not repost or reaudit an already posted voucher', async () => {
    const { record, tx } = fixture(); record.status = 'posted';
    await expect(service.postAdjustment(7, 20)).resolves.toMatchObject({ changed: false });
    expect(tx.order.update).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('restores AR and demand with the original cancellation kept as reversed history', async () => {
    const { record, order, tx } = fixture(); record.status = 'posted'; order.receivableAdjustmentAmount = 600;
    await expect(service.reverseAdjustment(7, 20, 'Customer changed instruction')).resolves.toMatchObject({ changed: true });
    expect(tx.order.updateMany.mock.calls[0][0].data).toEqual({ receivableAdjustmentAmount: 0, paymentStatus: 'partial' });
    expect(tx.receivableAdjustment.update.mock.calls[0][0].data).toMatchObject({ status: 'reversed', reversedBy: 20 });
    expect(tx.auditLog.create.mock.calls[0][0].data.action).toBe('REVERSE_ORDER_QUANTITY_CANCELLATION');
  });
  it('requires a recorded reason before reversing quantity cancellation', async () => {
    const { record, tx } = fixture(); record.status = 'posted';
    await expect(service.reverseAdjustment(7, 20)).rejects.toThrow('ORDER_CANCELLATION_REVERSAL_REASON_REQUIRED');
    expect(tx.receivableAdjustment.updateMany).not.toHaveBeenCalled();
  });
  it.each(['completed', 'cancelled'])('prevents reversal reopening a %s order', async status => {
    const { record, order, tx } = fixture(); record.status = 'posted'; order.status = status;
    await expect(service.reverseAdjustment(7, 20, 'test reversal')).rejects.toThrow('ORDER_CANCELLATION_CLOSED');
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });
  it('prevents an out-of-order reversal corrupting cumulative cent allocation', async () => {
    const { order, record, tx } = fixture();
    Object.assign(order, { totalAmount: 1, finalAmount: 1, paidAmount: 0, receivableAdjustmentAmount: 0.67, shipments: [], items: [{ id: 3, quantity: 3, unit: 'kg', totalPrice: 1 }],
      receivableAdjustments: [{ id: 8, orderItemId: 3, cancelledQuantity: 1, amount: 0.34, adjustmentType: 'order_quantity_cancellation', status: 'posted' }] });
    Object.assign(record, { status: 'posted', cancelledQuantity: 1, amount: 0.33 });
    await expect(service.reverseAdjustment(7, 20, 'wrong reversal order')).rejects.toThrow('ORDER_CANCELLATION_REVERSAL_ORDER_REQUIRED');
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });
});
