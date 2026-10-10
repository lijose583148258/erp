import type { Response } from 'express';
import prisma from '../config/database';
import { authenticate, authorizePermission, type AuthRequest } from './auth';
import { ensureAuthorizationPolicySeed, getPermissionsForRole, roleExistsAndActive } from '../services/authorization-policy.service';

jest.mock('../config/database', () => ({ __esModule: true, default: {
  user: { findUnique: jest.fn(), update: jest.fn() },
  authRole: { findUnique: jest.fn().mockResolvedValue({ dataScopesJson: '[]' }),
    upsert: jest.fn(), findFirst: jest.fn() },
  authPermission: { upsert: jest.fn() },
  authRolePermission: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn() },
  authPolicyMigration: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
  $transaction: jest.fn(),
} }));
jest.mock('../utils/jwt', () => ({ verifyToken: () => ({ userId: 7, authAt: 2000 }) }));
jest.mock('../services/auth-token-store.service', () => ({
  isTokenBlacklisted: jest.fn().mockResolvedValue(false), AuthTokenStoreUnavailableError: class extends Error {},
}));
jest.mock('../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn() } }));

const db = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock };
  authRole: { findFirst: jest.Mock; upsert: jest.Mock };
  authPermission: { upsert: jest.Mock };
  authRolePermission: { findMany: jest.Mock };
  $transaction: jest.Mock;
};
const closed = () => Object.assign(new Error('Server has closed the connection.'), { code: 'P1017' });
const scopes = JSON.stringify(['customers.all']);
const role = { id: 1, dataScopesJson: scopes };
const grant = [{ roleCode: 'sales', permissionCode: 'customers.read' }];
const fallback = process.env.AILAODA_ALLOW_RBAC_FALLBACK;
beforeAll(async () => { await ensureAuthorizationPolicySeed(); });
beforeEach(() => {
  jest.clearAllMocks(); delete process.env.AILAODA_ALLOW_RBAC_FALLBACK;
  db.user.findUnique.mockReset().mockResolvedValue({ id: 7, username: 'recovery', role: 'sales',
    segment: 'direct', isActive: true, updatedAt: new Date(1000), mustChangePassword: false });
  db.authRole.findFirst.mockReset().mockResolvedValue(role);
  db.authRolePermission.findMany.mockReset().mockResolvedValue(grant);
});
afterEach(() => {
  for (const write of [db.user.update, db.authRole.upsert, db.authPermission.upsert, db.$transaction]) expect(write).not.toHaveBeenCalled();
});
afterAll(() => {
  if (fallback === undefined) delete process.env.AILAODA_ALLOW_RBAC_FALLBACK;
  else process.env.AILAODA_ALLOW_RBAC_FALLBACK = fallback;
});
async function request() {
  const req = { headers: { authorization: 'Bearer fixture' }, method: 'POST', originalUrl: '/api/customers' } as AuthRequest;
  const res = { status: jest.fn(), json: jest.fn() }; res.status.mockReturnValue(res); res.json.mockReturnValue(res);
  const next = jest.fn(), authenticated = jest.fn();
  await authenticate(req, res as unknown as Response, authenticated);
  if (authenticated.mock.calls.length) await authorizePermission('customers.read')(req, res as unknown as Response, next);
  return { req, res, next };
}
function failRead(point: string, persistent = false) {
  const read = point === 'user' ? db.user.findUnique : point === 'policy' ? db.authRolePermission.findMany : db.authRole.findFirst;
  if (point === 'scope') read.mockResolvedValueOnce(role);
  if (persistent) read.mockRejectedValue(closed()); else read.mockRejectedValueOnce(closed());
  return read;
}
it.each(['user', 'role', 'scope', 'policy'])('recovers a stale %s read before calling a business handler exactly once', async point => {
  failRead(point); const { req, res, next } = await request();
  expect(next).toHaveBeenCalledTimes(1); expect(res.status).not.toHaveBeenCalled();
  expect(req.user?.dataScopes).toEqual(['customers.all']);
});
it.each(['user', 'role', 'scope', 'policy'])('bounds persistent %s failure and returns 503, not an invalid credential/role', async point => {
  const read = failRead(point, true), { res, next } = await request();
  expect(read).toHaveBeenCalledTimes(point === 'scope' ? 4 : 3);
  expect(next).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'AUTH_DATABASE_UNAVAILABLE' }));
});
it('an actually disabled role remains forbidden after reconnection', async () => {
  db.authRole.findFirst.mockRejectedValueOnce(closed()).mockResolvedValue(null);
  const { res, next } = await request(); expect(res.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
});
it('revoked permissions remain forbidden after reconnection, including explicit legacy fallback mode', async () => {
  process.env.AILAODA_ALLOW_RBAC_FALLBACK = 'true';
  db.authRolePermission.findMany.mockRejectedValueOnce(closed()).mockResolvedValue([]);
  const { res, next } = await request(); expect(res.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
});
it('persistent closed connections never enable built-in permission fallback', async () => {
  process.env.AILAODA_ALLOW_RBAC_FALLBACK = 'true'; failRead('policy', true);
  const { res, next } = await request(); expect(res.status).toHaveBeenCalledWith(503); expect(next).not.toHaveBeenCalled();
});
it('permission readback recovers without inventing grants', async () => {
  db.authRolePermission.findMany.mockRejectedValueOnce(closed()).mockResolvedValue([]);
  await expect(getPermissionsForRole('sales')).resolves.toEqual([]);
  expect(db.authRolePermission.findMany).toHaveBeenCalledTimes(2);
});
it('role lookup propagates unrelated database errors instead of declaring the role disabled', async () => {
  const error = Object.assign(new Error('P1017 is only text'), { code: 'P2021' });
  db.authRole.findFirst.mockRejectedValue(error);
  await expect(roleExistsAndActive('sales')).rejects.toBe(error); expect(db.authRole.findFirst).toHaveBeenCalledTimes(1);
});
