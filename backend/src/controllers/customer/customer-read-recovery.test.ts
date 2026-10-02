import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { getCustomerById } from './customer-query.controller';
import { logger } from '../../utils/logger';

jest.mock('../../config/database', () => ({ __esModule: true, default: {
  customer: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  order: { findMany: jest.fn(), update: jest.fn() },
  auditLog: { create: jest.fn() },
} }));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn() } }));
jest.mock('../../services/customer-query.service', () => ({ CustomerQueryService: {} }));
jest.mock('../../services/authorization-policy.service', () => ({}));

const db = prisma as unknown as {
  customer: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
  order: { findMany: jest.Mock; update: jest.Mock };
  auditLog: { create: jest.Mock };
};
const customer = { id: 50, name: 'Recovery fixture', poolState: 'private', salespersonId: 7, segment: 'direct', address: 'Fixture address' };
const closed = () => Object.assign(new Error('Server has closed the connection.'), { code: 'P1017' });
const request = () => ({ params: { id: '50' }, user: { role: 'sales', userId: 7, segment: 'direct' } } as unknown as AuthRequest);
function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res); res.json.mockReturnValue(res);
  return res;
}
const scopedWhere = { AND: [{ OR: [
  { poolState: 'private', salespersonId: 7 },
  { poolState: 'public', segment: { in: ['direct', 'mixed'] } },
] }, { id: 50 }] };

beforeEach(() => {
  jest.resetAllMocks();
  db.customer.findFirst.mockResolvedValue(customer);
  db.customer.findMany.mockResolvedValue([{ ...customer, addressesJson: null, contactsJson: null }]);
  db.order.findMany.mockResolvedValue([]);
});
afterEach(() => {
  for (const mutation of [db.customer.create, db.customer.update, db.order.update, db.auditLog.create]) {
    expect(mutation).not.toHaveBeenCalled();
  }
});

it('reads a healthy customer once without retry', async () => {
  const res = response(); await getCustomerById(request(), res as unknown as Response);
  expect(res.status).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledTimes(1);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  expect(db.customer.findFirst).toHaveBeenCalledTimes(1);
});

it.each(['customer', 'address', 'contact', 'stats'])('recovers one P1017 at %s without replaying a write', async point => {
  if (point === 'customer') db.customer.findFirst.mockRejectedValueOnce(closed());
  else if (point === 'stats') db.order.findMany.mockRejectedValueOnce(closed());
  else {
    let injected = false;
    db.customer.findMany.mockImplementation(async args => {
      const target = point === 'address' ? args.select.address : args.select.contactsJson;
      if (target && !injected) { injected = true; throw closed(); }
      return [{ ...customer, addressesJson: null, contactsJson: null }];
    });
  }
  const res = response(); await getCustomerById(request(), res as unknown as Response);
  expect(res.status).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledTimes(1);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  expect(db.customer.findFirst).toHaveBeenCalledTimes(2);
  for (const [args] of db.customer.findFirst.mock.calls) expect(args.where).toEqual(scopedWhere);
});

it('bounds consecutive stale-connection attempts and returns 500 rather than partial data', async () => {
  const error = closed(); db.customer.findMany.mockRejectedValue(error);
  const res = response(); await getCustomerById(request(), res as unknown as Response);
  expect(db.customer.findFirst).toHaveBeenCalledTimes(3);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledTimes(1);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  expect(logger.error).toHaveBeenCalledWith(expect.any(String), error);
});

it('recovers two stale connections within the fixed three-attempt budget', async () => {
  db.customer.findFirst.mockRejectedValueOnce(closed()).mockRejectedValueOnce(closed());
  const res = response(); await getCustomerById(request(), res as unknown as Response);
  expect(db.customer.findFirst).toHaveBeenCalledTimes(3);
  expect(res.status).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledTimes(1);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});

it.each([
  Object.assign(new Error('invalid query'), { code: 'P2009' }),
  Object.assign(new Error('P1017 Server has closed the connection.'), { code: 'BUSINESS_ERROR' }),
  new Error('P1017'),
])('does not retry non-connection errors or infer an error code from text', async error => {
  db.customer.findFirst.mockRejectedValue(error);
  const res = response(); await getCustomerById(request(), res as unknown as Response);
  expect(db.customer.findFirst).toHaveBeenCalledTimes(1);
  expect(res.status).toHaveBeenCalledWith(500);
});

it('preserves a scoped 404 without retry or relationship reads', async () => {
  db.customer.findFirst.mockResolvedValue(null);
  const res = response(); await getCustomerById(request(), res as unknown as Response);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(db.customer.findFirst).toHaveBeenCalledTimes(1);
  expect(db.customer.findMany).not.toHaveBeenCalled(); expect(db.order.findMany).not.toHaveBeenCalled();
});

it('reruns the permission-filtered lookup and withholds previous partial data if access disappears', async () => {
  db.customer.findFirst.mockResolvedValueOnce(customer).mockResolvedValue(null);
  db.order.findMany.mockRejectedValueOnce(closed());
  const res = response(); await getCustomerById(request(), res as unknown as Response);
  expect(db.customer.findFirst).toHaveBeenCalledTimes(2);
  for (const [args] of db.customer.findFirst.mock.calls) expect(args.where).toEqual(scopedWhere);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledTimes(1);
  expect(res.json.mock.calls[0][0]).not.toHaveProperty('data');
});
