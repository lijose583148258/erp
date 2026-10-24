import express from 'express';
import request from 'supertest';
import prisma from '../config/database';
import router from './dashboard.routes';

jest.mock('../config/database', () => ({ __esModule: true, default: {
  customer: { groupBy: jest.fn(), count: jest.fn(), aggregate: jest.fn(), update: jest.fn() },
  order: { groupBy: jest.fn(), aggregate: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
  shipment: { count: jest.fn() }, rma: { count: jest.fn() }, stockBalance: { findMany: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(), $disconnect: jest.fn(),
} }));
jest.mock('../utils/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: unknown, next: () => void) => { req.user = { userId: 7, role: req.get('x-test-role') || 'admin' }; next(); },
  authorizePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  authRoute: (handler: unknown) => handler,
}));

const db = prisma as any;
const app = express(); app.use('/api/dashboard', router);
const connectionError = (code = 'P1001') => Object.assign(new Error('Synthetic database connection failure'), { code });
beforeEach(() => {
  jest.resetAllMocks();
  db.customer.groupBy.mockResolvedValue([{ status: 'active', _count: 3 }]);
  db.customer.count.mockResolvedValue(7);
  db.customer.aggregate.mockResolvedValue({ _sum: { overdueAmount: 11 } });
  db.order.groupBy.mockResolvedValue([{ status: 'confirmed', _count: 2, _sum: { finalAmount: 84 } }]);
  db.order.aggregate.mockResolvedValue({ _count: 2, _sum: { finalAmount: 84 } });
  db.order.findMany.mockResolvedValue([]); db.order.count.mockResolvedValue(5);
  db.shipment.count.mockResolvedValue(2); db.rma.count.mockResolvedValue(1);
  db.stockBalance.findMany.mockResolvedValue([]);
});
afterEach(() => {
  for (const mutation of [db.customer.update, db.order.update, db.stockBalance.update, db.$transaction, db.$disconnect]) {
    expect(mutation).not.toHaveBeenCalled();
  }
});

it.each(['P1001', 'P1017'])('recovers dashboard %s reads with real nonzero values', async code => {
  db.customer.count.mockRejectedValueOnce(connectionError(code));
  const response = await request(app).get('/api/dashboard');
  expect(response.status).toBe(200);
  expect(response.body.data.overview).toEqual(expect.objectContaining({ totalCustomers: 3, totalOrders: 2,
    totalRevenue: 84, riskCustomers: 7, overdueAmount: 11 }));
  expect(db.customer.count).toHaveBeenCalledTimes(2);
});

it('keeps sales ownership filters and skips global inventory during read recovery', async () => {
  db.customer.count.mockRejectedValueOnce(connectionError());
  const response = await request(app).get('/api/dashboard').set('x-test-role', 'sales');
  expect(response.status).toBe(200);
  expect(db.stockBalance.findMany).not.toHaveBeenCalled();
  for (const [query] of db.customer.groupBy.mock.calls) expect(query.where).toEqual({ salespersonId: 7 });
  for (const [query] of db.order.groupBy.mock.calls) expect(query.where).toEqual({ createdBy: 7 });
  for (const [query] of db.customer.count.mock.calls) expect(query.where.salespersonId).toBe(7);
});

it('recovers the trends read without replacing the real amount with zero', async () => {
  db.order.findMany.mockRejectedValueOnce(connectionError()).mockResolvedValue([{ createdAt: new Date('2026-10-24T00:00:00Z'), finalAmount: 84 }]);
  const response = await request(app).get('/api/dashboard/trends').set('x-test-role', 'sales');
  expect(response.status).toBe(200);
  expect(response.body.data).toEqual([{ date: '2026-10-24', count: 1, amount: 84, risk: 0 }]);
  expect(db.order.findMany).toHaveBeenCalledTimes(2);
  for (const [query] of db.order.findMany.mock.calls) expect(query.where.createdBy).toBe(7);
});

it.each(['/', '/trends'])('bounds persistent connection failure on %s and returns an explicit 503', async route => {
  const read = route === '/' ? db.customer.count : db.order.findMany;
  read.mockRejectedValue(connectionError());
  const response = await request(app).get('/api/dashboard' + route);
  expect(response.status).toBe(503);
  expect(response.body).toEqual(expect.objectContaining({ success: false, errorCode: 'DASHBOARD_DATABASE_UNAVAILABLE' }));
  expect(read).toHaveBeenCalledTimes(5);
  expect(response.body.data).toBeUndefined();
});

it('does not retry a schema/business error or mislabel it as a transient outage', async () => {
  db.customer.count.mockRejectedValue(connectionError('P2021'));
  const response = await request(app).get('/api/dashboard');
  expect(response.status).toBe(500);
  expect(db.customer.count).toHaveBeenCalledTimes(1);
});
