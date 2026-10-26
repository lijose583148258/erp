import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import prisma from '../config/database';
import { OrderWorkspaceService } from './order-workspace.service';
import { buildOrderSearchWhereAsync } from './search.service';
import { OrderController } from '../controllers/order.controller';
import * as readRecovery from '../utils/readOnlyDbRetry';

jest.mock('../config/database', () => ({ __esModule: true, default: {
  order: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  customer: { create: jest.fn(), update: jest.fn() },
  auditLog: { findMany: jest.fn(), create: jest.fn() }, $transaction: jest.fn(), $disconnect: jest.fn(),
} }));
jest.mock('./search.service', () => ({ buildOrderSearchWhereAsync: jest.fn() }));
jest.mock('../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('./realtime-notification.service', () => ({ publishRealtimeNotification: jest.fn() }));
jest.mock('./webhook.service', () => ({ publishWebhookEvent: jest.fn() }));

// Exercise actual service/controller, scope building, commercial state and
// reservation proof readback. Substitute only external I/O; do not mock the service.
const db = prisma as any;
const search = buildOrderSearchWhereAsync as jest.Mock;
const query = { page: 2, pageSize: 10, search: 'ORD', status: 'confirmed', sortBy: 'finalAmount', sortOrder: 'asc' as const };
const searchWhere = { OR: [{ orderNo: { contains: 'ORD' } }] };
const filters = { ...searchWhere, status: 'confirmed' };
const salesScope = { OR: [{ createdBy: 7 }, { customer: { poolState: 'private', salespersonId: 7 } }] };
const request = (role = 'sales', dataScopes: string[] = [], segment = 'direct') => ({ query, params: { id: '9' },
  body: {}, user: { role, dataScopes, segment, userId: 7 } } as unknown as AuthRequest);
const order = {
  id: 9, orderNo: 'ORD-9', status: 'confirmed', totalAmount: 84, discountAmount: 0, finalAmount: 84,
  paidAmount: 10, receivableAdjustmentAmount: 4, paymentStatus: 'partial', currency: 'USD', paymentTerms: 30,
  createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
  commissionRate: null, commissionAmount: null, notes: null,
  customer: { id: 2, name: 'Fixture customer', nameZh: null, nameEn: null, nameVi: null, riskLevel: 'low' },
  creator: { id: 7, username: 'Fixture salesperson' }, contract: null,
  items: [{ id: 90, productName: 'Resin', quantity: 100, unit: 'kg' }], receivableAdjustments: [], paymentRecords: [],
  shipments: [{ id: 900, shipmentNo: 'SHP-9', orderId: 9, orderItemId: 90, materialId: 7, batchNo: 'LOT',
    quantity: 30, unit: 'kg', status: 'pending', reservationState: 'reserved', reservationBalanceId: 4,
    reservationQuantity: 30, reservationAuditId: 101, receipts: [], shippedAt: null, deliveredAt: null }],
  _count: { items: 1, shipments: 1 },
};
const audit = { id: 101, userId: 3, resource: 'shipment', resourceId: 900, action: 'RESERVE_STOCK',
  details: JSON.stringify({ schema: 'shipment-reservation/v1', action: 'reserve', shipmentId: 900, previousAuditId: null,
    actorId: 3, stockBalanceId: 4, locationId: 6, materialId: 7, batchNo: 'LOT', quantity: 30, unit: 'kg', reason: null }) };
const connectionError = (code = 'P1001') => Object.assign(new Error('Synthetic private database query failure'), { code });
function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res); res.json.mockReturnValue(res);
  return res;
}
const readAt = (point: string) => point === 'list' ? db.order.findMany : point === 'count' ? db.order.count : db.auditLog.findMany;
const assertScopedQueries = (scope: Record<string, unknown> = salesScope) => {
  const where = Object.keys(scope).length ? { AND: [filters, scope] } : filters;
  for (const [args] of db.order.findMany.mock.calls) expect(args).toMatchObject({ where, skip: 10, take: 10, orderBy: { finalAmount: 'asc' } });
  for (const [args] of db.order.count.mock.calls) expect(args.where).toEqual(where);
};
const assertRealValues = (result: Awaited<ReturnType<typeof OrderWorkspaceService.getOrders>>) => {
  expect(result.meta).toEqual({ page: 2, pageSize: 10, total: 21, totalPages: 3 });
  expect(result.data[0]).toMatchObject({ orderNo: 'ORD-9', paidAmount: 10, effectiveReceivableAmount: 80, outstandingAmount: 70,
    customerName: 'Fixture customer', fulfillment: { lines: [{ orderItemId: 90, reservationEvidenceState: 'verified', reservedQuantity: 30 }] } });
};

beforeEach(() => {
  jest.useFakeTimers(); jest.resetAllMocks();
  search.mockResolvedValue(searchWhere);
  db.order.findMany.mockResolvedValue([order]); db.order.count.mockResolvedValue(21);
  db.auditLog.findMany.mockResolvedValue([audit]);
});
afterEach(() => {
  for (const write of [db.order.create, db.order.update, db.customer.create, db.customer.update, db.auditLog.create, db.$disconnect]) {
    expect(write).not.toHaveBeenCalled();
  }
  jest.restoreAllMocks(); jest.useRealTimers();
});

describe('actual order list pure-read recovery', () => {
  afterEach(() => { expect(db.$transaction).not.toHaveBeenCalled(); });

  it('reads the healthy list and actual reservation evidence once with no wait', async () => {
    assertRealValues(await OrderWorkspaceService.getOrders(query, request()));
    assertScopedQueries();
    expect(db.order.findMany).toHaveBeenCalledTimes(1); expect(db.order.count).toHaveBeenCalledTimes(1);
    expect(db.auditLog.findMany).toHaveBeenCalledWith({ where: { id: { in: [101] } } });
    expect(search).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['P1001', 'P1017'].flatMap(code => ['list', 'count', 'reservation'].map(point => [code, point])))
  ('recovers one %s at %s without replaying search or retaining partial rows', async (code, point) => {
    readAt(point).mockRejectedValueOnce(connectionError(code));
    const pending = OrderWorkspaceService.getOrders(query, request());
    await jest.runAllTimersAsync(); assertRealValues(await pending);
    expect(db.order.findMany).toHaveBeenCalledTimes(2); expect(db.order.count).toHaveBeenCalledTimes(2);
    expect(readAt(point)).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledTimes(1); expect(search).toHaveBeenCalledWith('ORD');
    assertScopedQueries();
  });

  it.each(['P1001', 'P1017'].flatMap(code => ['list', 'count', 'reservation'].map(point => [code, point])))
  ('bounds persistent %s at %s to five full reads and the existing wait budget', async (code, point) => {
    const error = connectionError(code); readAt(point).mockRejectedValue(error);
    const pending = OrderWorkspaceService.getOrders(query, request()).catch(value => value);
    await jest.runAllTimersAsync(); expect(await pending).toBe(error);
    expect(db.order.findMany).toHaveBeenCalledTimes(5); expect(db.order.count).toHaveBeenCalledTimes(5);
    expect(readAt(point)).toHaveBeenCalledTimes(5); expect(performance.now()).toBe(600);
    expect(search).toHaveBeenCalledTimes(1); assertScopedQueries();
  });

  it('rereads scoped primary data after reservation failure and withholds an order no longer visible', async () => {
    db.order.findMany.mockResolvedValueOnce([order]).mockResolvedValue([]);
    db.order.count.mockResolvedValueOnce(21).mockResolvedValue(0);
    db.auditLog.findMany.mockRejectedValueOnce(connectionError());
    const pending = OrderWorkspaceService.getOrders(query, request());
    await jest.runAllTimersAsync();
    expect(await pending).toEqual({ data: [], meta: { page: 2, pageSize: 10, total: 0, totalPages: 0 } });
    expect(db.order.findMany).toHaveBeenCalledTimes(2); expect(db.auditLog.findMany).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1); assertScopedQueries();
  });

  it.each([
    ['sales', [], 'direct', salesScope],
    ['custom-owner', ['own_customers'], 'channel', salesScope],
    ['manager', [], 'direct', { customer: { segment: { in: ['direct', 'mixed'] } } }],
    ['custom-manager', ['team_customers'], 'channel', { customer: { segment: { in: ['channel', 'mixed'] } } }],
    ['finance', ['finance_visible'], 'direct', {}],
    ['custom-finance', ['finance_visible'], 'channel', {}],
    ['finance', [], 'direct', { id: -1 }],
    ['admin', [], 'mixed', {}],
  ] as const)('preserves %s scope %p on business line %s across recovery', async (role, scopes, segment, expected) => {
    db.auditLog.findMany.mockRejectedValueOnce(connectionError());
    const pending = OrderWorkspaceService.getOrders(query, request(role, [...scopes], segment));
    await jest.runAllTimersAsync(); await pending;
    assertScopedQueries(expected); expect(db.order.findMany).toHaveBeenCalledTimes(2);
  });

  it.each(['P1001', 'P1017'])('controller maps exhausted %s to one explicit 503 without leaking SQL/data', async code => {
    db.auditLog.findMany.mockRejectedValue(connectionError(code));
    const res = response(), pending = new OrderController().getOrders(request(), res as unknown as Response);
    await jest.runAllTimersAsync(); await pending;
    expect(res.status).toHaveBeenCalledWith(503); expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0]).toEqual({ success: false, message: '数据库暂时不可用，请稍后重试', errorCode: 'ORDER_DATABASE_UNAVAILABLE' });
    expect(db.order.findMany).toHaveBeenCalledTimes(5); expect(db.auditLog.findMany).toHaveBeenCalledTimes(5);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it.each([
    Object.assign(new Error('P1001 only in a schema error message'), { code: 'P2021' }),
    Object.assign(new Error('Business failure'), { code: 'BUSINESS_ERROR' }),
    Object.assign(new Error('Not an exact structured code'), { code: 'P1001 please retry' }),
    new Error('P1017 appears only in unstructured text'),
  ])('does not retry or mislabel non-connection error %p', async error => {
    db.order.findMany.mockRejectedValue(error);
    const res = response(); await new OrderController().getOrders(request(), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(500); expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0]).toEqual({ success: false, message: '服务器内部错误' });
    expect(db.order.findMany).toHaveBeenCalledTimes(1); expect(db.order.count).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
  });
});

describe('order write handlers remain outside read recovery', () => {
  it.each(['P1001', 'P1017'].flatMap(code => ['createOrder', 'updateOrder', 'updateOrderStatus'].map(method => [code, method])))
  ('never replays %s in %s or treats an uncertain write as the list 503', async (code, method) => {
    const readRetry = jest.spyOn(readRecovery, 'withReadOnlyDbRetry');
    const error = connectionError(code); db.$transaction.mockRejectedValue(error); db.order.findUnique.mockRejectedValue(error);
    const req = request('admin'), res = response();
    req.body = { customerId: 2, status: 'confirmed', items: [{ productName: 'Fixture material', quantity: 1, unitPrice: 84, unit: 'kg' }] };
    await new OrderController()[method as 'createOrder' | 'updateOrder' | 'updateOrderStatus'](req, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(500); expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('errorCode', 'ORDER_DATABASE_UNAVAILABLE');
    if (method === 'updateOrderStatus') { expect(db.order.findUnique).toHaveBeenCalledTimes(1); expect(db.$transaction).not.toHaveBeenCalled(); }
    else { expect(db.$transaction).toHaveBeenCalledTimes(1); expect(db.order.findUnique).not.toHaveBeenCalled(); }
    expect(readRetry).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
  });
});
