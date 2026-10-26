import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import prisma from '../config/database';
import { CustomerQueryService } from './customer-query.service';
import { buildCustomerSearchWhereAsync } from './search.service';
import { getCustomerById, getCustomers, getCustomerStats } from '../controllers/customer/customer-query.controller';

jest.mock('../config/database', () => ({ __esModule: true, default: {
  customer: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
  order: { findMany: jest.fn(), update: jest.fn() },
  auditLog: { create: jest.fn() }, $transaction: jest.fn(), $disconnect: jest.fn(),
} }));
jest.mock('./search.service', () => ({ buildCustomerSearchWhereAsync: jest.fn() }));
jest.mock('../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn() } }));

// Keep the actual query service, access predicates, relation loaders and payload
// builders in this test. Only database/search I/O and logging are substituted.
const db = prisma as any;
const search = buildCustomerSearchWhereAsync as jest.Mock;
const customer = {
  id: 50, name: 'Recovery fixture', poolState: 'private', salespersonId: 7,
  segment: 'direct', status: 'active', address: 'Fixture address', overdueAmount: 11,
  riskLevel: 'high', creditHold: true, shipmentHold: false,
};
const query = { search: 'Recovery', page: '2', pageSize: '10', status: 'active', sortBy: 'name', sortOrder: 'asc' };
const searchWhere = { OR: [{ name: { contains: 'Recovery' } }] };
const scope = { OR: [
  { poolState: 'private', salespersonId: 7 },
  { poolState: 'public', segment: { in: ['direct', 'mixed'] } },
] };
const request = () => ({ query, params: { id: '50' }, user: { role: 'sales', userId: 7, segment: 'direct' } } as unknown as AuthRequest);
const connectionError = (code = 'P1001') => Object.assign(new Error('Synthetic connection failure; private SQL must not escape'), { code });
const listCalls = () => db.customer.findMany.mock.calls.filter(([args]: any[]) => args.include);
const listRows = async (args: any) => {
  if (args.include || args.select?.riskLevel) return [customer];
  return [{ ...customer, addressesJson: null, contactsJson: JSON.stringify([{ name: 'Fixture contact', phone: '123' }]) }];
};
function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res); res.json.mockReturnValue(res);
  return res;
}
beforeEach(() => {
  jest.useFakeTimers(); jest.resetAllMocks();
  search.mockResolvedValue(searchWhere);
  db.customer.findMany.mockImplementation(listRows);
  db.customer.findFirst.mockResolvedValue(customer);
  db.customer.count.mockResolvedValue(21);
  db.order.findMany.mockResolvedValue([{ customerId: 50, createdAt: new Date('2026-01-01T00:00:00Z'), paymentTerms: 30, finalAmount: 84, paidAmount: 10 }]);
});
afterEach(() => {
  for (const mutation of [db.customer.create, db.customer.update, db.order.update, db.auditLog.create, db.$transaction, db.$disconnect]) {
    expect(mutation).not.toHaveBeenCalled();
  }
  jest.useRealTimers();
});

it('reads a healthy complete list once with unchanged paging, sorting and sales scope', async () => {
  const result = await CustomerQueryService.listCustomers(query, request());
  expect(result.meta).toEqual({ page: 2, pageSize: 10, total: 21, totalPages: 3 });
  expect(result.data[0]).toMatchObject({ id: '50', name: customer.name, address: customer.address,
    contacts: [expect.objectContaining({ name: 'Fixture contact' })], statistics: { totalOrders: 1, totalAmount: 84 } });
  expect(listCalls()).toHaveLength(1);
  expect(listCalls()[0][0]).toMatchObject({ where: { AND: [scope, { ...searchWhere, status: 'active' }] }, skip: 10, take: 10, orderBy: { name: 'asc' } });
  expect(search).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it.each(['P1001', 'P1017'].flatMap(code => ['list', 'count', 'address', 'contact', 'orders'].map(point => [code, point])))
('recovers %s at %s through the actual service without replaying search', async (code, point) => {
  let injected = false;
  db.customer.findMany.mockImplementation(async (args: any) => {
    const target = point === 'list' ? args.include : point === 'address' ? args.select?.address : point === 'contact' ? args.select?.contactsJson : false;
    if (target && !injected) { injected = true; throw connectionError(code); }
    return listRows(args);
  });
  if (point === 'count') db.customer.count.mockRejectedValueOnce(connectionError(code));
  if (point === 'orders') db.order.findMany.mockRejectedValueOnce(connectionError(code));
  const pending = CustomerQueryService.listCustomers(query, request());
  await jest.runAllTimersAsync();
  const result = await pending;
  expect(result.data[0]).toMatchObject({ name: customer.name, statistics: { totalOrders: 1, totalAmount: 84 } });
  expect(listCalls()).toHaveLength(2);
  expect(db.customer.count).toHaveBeenCalledTimes(2);
  for (const [args] of listCalls()) expect(args.where).toEqual({ AND: [scope, { ...searchWhere, status: 'active' }] });
  for (const [args] of db.customer.count.mock.calls) expect(args.where).toEqual({ AND: [scope, { ...searchWhere, status: 'active' }] });
  expect(search).toHaveBeenCalledTimes(1);
  expect(search).toHaveBeenCalledWith('Recovery');
});

it('discards the previous customer and count after relation failure instead of joining stale partial rows', async () => {
  let mainReads = 0;
  db.customer.findMany.mockImplementation(async (args: any) => {
    if (args.include) return ++mainReads === 1 ? [customer] : [];
    return listRows(args);
  });
  db.customer.count.mockResolvedValueOnce(21).mockResolvedValue(0);
  db.order.findMany.mockRejectedValueOnce(connectionError());
  const pending = CustomerQueryService.listCustomers(query, request());
  await jest.runAllTimersAsync();
  expect(await pending).toEqual({ data: [], meta: { page: 2, pageSize: 10, total: 0, totalPages: 0 } });
  expect(mainReads).toBe(2);
  expect(db.order.findMany).toHaveBeenCalledTimes(1);
  expect(search).toHaveBeenCalledTimes(1);
});

it.each(['P1001', 'P1017'])('bounds persistent list %s failure without adding nested retries', async code => {
  const error = connectionError(code);
  db.customer.findMany.mockRejectedValue(error);
  const pending = CustomerQueryService.listCustomers(query, request()).catch(value => value);
  await jest.runAllTimersAsync();
  expect(await pending).toBe(error);
  expect(listCalls()).toHaveLength(5);
  expect(db.customer.count).toHaveBeenCalledTimes(5);
  expect(search).toHaveBeenCalledTimes(1);
  expect(performance.now()).toBe(600);
});

it.each(['P1001', 'P1017'])('recovers scoped customer stats after %s with real amounts', async code => {
  db.customer.findMany.mockRejectedValueOnce(connectionError(code));
  const pending = CustomerQueryService.getCustomerStats(request());
  await jest.runAllTimersAsync();
  expect(await pending).toMatchObject({ totalCustomers: 1, activeCustomers: 1, privatePoolCustomers: 1, overdueAmount: 11, creditHoldCustomers: 1 });
  expect(db.customer.findMany).toHaveBeenCalledTimes(2);
  for (const [args] of db.customer.findMany.mock.calls) expect(args.where).toEqual(scope);
  expect(search).not.toHaveBeenCalled();
});

it.each(['P1001', 'P1017'])('bounds persistent stats %s failure with the existing helper', async code => {
  const error = connectionError(code); db.customer.findMany.mockRejectedValue(error);
  const pending = CustomerQueryService.getCustomerStats(request()).catch(value => value);
  await jest.runAllTimersAsync();
  expect(await pending).toBe(error);
  expect(db.customer.findMany).toHaveBeenCalledTimes(5);
  expect(performance.now()).toBe(600);
});

const handlers = [getCustomers, getCustomerStats, getCustomerById];
it.each(handlers.flatMap(handler => ['P1001', 'P1017'].map(code => [handler, code] as const)))
('%p returns one explicit 503 after persistent %s and leaks no query/partial data', async (handler, code) => {
  db.customer.findMany.mockRejectedValue(connectionError(code));
  db.customer.findFirst.mockRejectedValue(connectionError(code));
  const res = response(), pending = handler(request(), res as unknown as Response);
  await jest.runAllTimersAsync(); await pending;
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledTimes(1);
  expect(res.json.mock.calls[0][0]).toEqual({ success: false, message: '数据库暂时不可用，请稍后重试', errorCode: 'CUSTOMER_DATABASE_UNAVAILABLE' });
  const read = handler === getCustomerById ? db.customer.findFirst : db.customer.findMany;
  expect(read).toHaveBeenCalledTimes(5);
});

it.each(handlers.flatMap(handler => [
  Object.assign(new Error('invalid schema'), { code: 'P2021' }),
  Object.assign(new Error('invalid business input'), { code: 'BUSINESS_ERROR' }),
  new Error('P1001 appears only in unstructured text'),
].map(error => [handler, error] as const)))
('%p preserves non-connection %p as 500 without retry', async (handler, error) => {
  db.customer.findMany.mockRejectedValue(error); db.customer.findFirst.mockRejectedValue(error);
  const res = response(); await handler(request(), res as unknown as Response);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledTimes(1);
  expect(res.json.mock.calls[0][0]).toEqual({ success: false, message: '服务器内部错误' });
  const read = handler === getCustomerById ? db.customer.findFirst : db.customer.findMany;
  expect(read).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
