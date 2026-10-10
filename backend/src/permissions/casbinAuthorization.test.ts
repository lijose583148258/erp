import { casbinAllowsAllPermissions, casbinAllowsPermission, permissionToCasbinTuple } from './casbinAuthorization';

jest.mock('../config/database', () => ({
  __esModule: true,
  default: { authRolePermission: { findMany: jest.fn() } },
}));
jest.mock('../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn() } }));

import prisma from '../config/database';
const findMany = prisma.authRolePermission.findMany as jest.Mock;
const rows = (...permissions: string[]) => permissions.map(permissionCode => ({ roleCode: 'warehouse', permissionCode }));
const fallback = process.env.AILAODA_ALLOW_RBAC_FALLBACK;

beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.AILAODA_ALLOW_RBAC_FALLBACK;
});
afterAll(() => {
  if (fallback === undefined) delete process.env.AILAODA_ALLOW_RBAC_FALLBACK;
  else process.env.AILAODA_ALLOW_RBAC_FALLBACK = fallback;
});

test('a grant, revoke and regrant are read without resetting the local process', async () => {
  findMany.mockResolvedValueOnce([])
    .mockResolvedValueOnce(rows('warehouse.write'))
    .mockResolvedValueOnce(rows('warehouse.read'))
    .mockResolvedValueOnce(rows('warehouse.write'));
  for (const expected of [false, true, false, true]) {
    expect(await casbinAllowsPermission('warehouse', 'warehouse.write')).toBe(expected);
  }
  expect(findMany).toHaveBeenCalledTimes(4);
  expect(findMany).toHaveBeenLastCalledWith({
    where: { roleCode: 'warehouse', role: { isActive: true } },
    select: { roleCode: true, permissionCode: true },
    orderBy: { permissionCode: 'asc' },
  });
});

test('one decision checks all required permissions against a single database snapshot', async () => {
  findMany.mockResolvedValueOnce(rows('warehouse.read', 'warehouse.write'))
    .mockResolvedValueOnce(rows('warehouse.read'));
  expect(await casbinAllowsAllPermissions('warehouse', ['warehouse.read', 'warehouse.write'])).toBe(true);
  expect(findMany).toHaveBeenCalledTimes(1);
  expect(await casbinAllowsAllPermissions('warehouse', ['warehouse.read', 'warehouse.write'])).toBe(false);
  expect(findMany).toHaveBeenCalledTimes(2);
});

test('an inactive, deleted or permissionless role stays denied even with explicit fallback enabled', async () => {
  process.env.AILAODA_ALLOW_RBAC_FALLBACK = 'true';
  findMany.mockResolvedValue([]);
  expect(await casbinAllowsPermission('warehouse', 'warehouse.write')).toBe(false);
  expect(await casbinAllowsPermission('admin', 'authorization.roles.manage')).toBe(false);
});

test('a failed policy read never uses an earlier grant and does not poison subsequent decisions', async () => {
  const unavailable = new Error('Database unavailable');
  findMany.mockResolvedValueOnce(rows('warehouse.write'))
    .mockRejectedValueOnce(unavailable)
    .mockResolvedValueOnce(rows('warehouse.read'));
  expect(await casbinAllowsPermission('warehouse', 'warehouse.write')).toBe(true);
  await expect(casbinAllowsPermission('warehouse', 'warehouse.write')).rejects.toBe(unavailable);
  expect(await casbinAllowsPermission('warehouse', 'warehouse.write')).toBe(false);
});

test('explicit database-error fallback is restricted to built-in roles', async () => {
  process.env.AILAODA_ALLOW_RBAC_FALLBACK = 'true';
  findMany.mockRejectedValue(new Error('Tables not yet available'));
  expect(await casbinAllowsPermission('warehouse', 'warehouse.write')).toBe(true);
  expect(await casbinAllowsPermission('custom_warehouse', 'warehouse.write')).toBe(false);
});

test('role and permission tuples are exact, not prefixes or another role policy', async () => {
  findMany.mockResolvedValue(rows('warehouse.write'));
  expect(await casbinAllowsPermission('custom_warehouse', 'warehouse.write')).toBe(false);
  expect(await casbinAllowsPermission('warehouse', 'warehouse.read')).toBe(false);
  expect(permissionToCasbinTuple('authorization.roles.manage')).toEqual({ object: 'authorization.roles', action: 'manage' });
});

test('overlapping old and fresh reads cannot overwrite another decision policy', async () => {
  let resolveOld!: (value: ReturnType<typeof rows>) => void;
  findMany.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValue(rows('warehouse.read'));
  const inFlightBeforeRevoke = casbinAllowsPermission('warehouse', 'warehouse.write');
  expect(await casbinAllowsPermission('warehouse', 'warehouse.write')).toBe(false);
  resolveOld(rows('warehouse.write'));
  // A request already authorized before revocation is not retroactively canceled.
  expect(await inFlightBeforeRevoke).toBe(true);
  expect(await casbinAllowsPermission('warehouse', 'warehouse.write')).toBe(false);
});

test('no required permissions is a no-op, not a policy query', async () => {
  expect(await casbinAllowsAllPermissions('warehouse', [])).toBe(true);
  expect(findMany).not.toHaveBeenCalled();
});

test('invalid database policy fails closed instead of partially authorizing or applying fallback', async () => {
  process.env.AILAODA_ALLOW_RBAC_FALLBACK = 'true';
  findMany.mockResolvedValue(rows('warehouse.write', 'invalid'));
  await expect(casbinAllowsPermission('warehouse', 'warehouse.write')).rejects.toThrow('Invalid permission format');
});

test.each(['production.bom.write', 'production.plan.write', 'production.execute'] as const)('a production responsibility does not imply the other responsibilities: %s', async permission => {
  findMany.mockResolvedValue([{ roleCode: 'custom_production', permissionCode: permission }]);
  for (const candidate of ['production.bom.write', 'production.plan.write', 'production.execute'] as const) {
    expect(await casbinAllowsPermission('custom_production', candidate)).toBe(candidate === permission);
  }
});
