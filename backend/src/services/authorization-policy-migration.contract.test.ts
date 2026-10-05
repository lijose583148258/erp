import { ROLE_POLICIES, type BuiltInRole, type Permission } from '../permissions/permissionRegistry';
import { MATERIAL_MASTER_PERMISSION_BACKFILL } from './authorization-policy.service';

describe('authorization policy migrations', () => {
  it('backfills every material-master permission declared for existing built-in roles', () => {
    const roles = Object.keys(ROLE_POLICIES) as BuiltInRole[];

    expect(MATERIAL_MASTER_PERMISSION_BACKFILL.code).toBe('2026-08-01-material-master-permissions-v1');
    expect(Object.keys(MATERIAL_MASTER_PERMISSION_BACKFILL.grants).sort()).toEqual([...roles].sort());

    for (const role of roles) {
      const expected = ROLE_POLICIES[role].permissions
        .filter((permission): permission is Permission => permission.startsWith('materials.'))
        .sort();
      const migrated = [...MATERIAL_MASTER_PERMISSION_BACKFILL.grants[role]].sort();
      expect(migrated).toEqual(expected);
    }
  });
});

describe('production responsibility cutover (mocked seed contract, not database acceptance)', () => {
  const code = '2026-10-05-production-responsibility-split-v1';
  const permissions = ['production.bom.write', 'production.plan.write', 'production.execute'];
  function fixture(legacy: string[], alreadyMigrated = false) {
    const tx = {
      authRolePermission: { findMany: jest.fn().mockResolvedValue(legacy.map(roleCode => ({ roleCode }))),
        upsert: jest.fn().mockResolvedValue({}), deleteMany: jest.fn().mockResolvedValue({ count: legacy.length }) },
      authPermission: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      authPolicyMigration: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const db = { authPermission: { upsert: jest.fn().mockResolvedValue({}) },
      authRole: { findUnique: jest.fn().mockResolvedValue({ dataScopesJson: '[]' }), upsert: jest.fn().mockResolvedValue({}) },
      authRolePermission: { count: jest.fn().mockResolvedValue(1) },
      authPolicyMigration: { findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve(where.code === code && !alreadyMigrated ? null : { id: 1 })) },
      $transaction: jest.fn(async action => action(tx)),
    };
    jest.doMock('../config/database', () => ({ __esModule: true, default: db }));
    let service: typeof import('./authorization-policy.service');
    jest.isolateModules(() => { service = require('./authorization-policy.service'); });
    return { db, tx, seed: () => service!.ensureAuthorizationPolicySeed() };
  }
  afterEach(() => { jest.dontMock('../config/database'); });
  it('replaces exactly existing built-in/custom umbrella grants and records completion in the same transaction', async () => {
    const f = fixture(['manager', 'custom_research_legacy']); await f.seed();
    expect(f.tx.authRolePermission.upsert.mock.calls.map(([arg]) => arg.create)).toEqual(
      ['manager', 'custom_research_legacy'].flatMap(roleCode => permissions.map(permissionCode => ({ roleCode, permissionCode }))),
    );
    expect(f.tx.authRolePermission.findMany).toHaveBeenCalledWith({ where: { permissionCode: 'production.write' }, select: { roleCode: true }, orderBy: { roleCode: 'asc' } });
    expect(f.tx.authRolePermission.deleteMany).toHaveBeenCalledWith({ where: { permissionCode: 'production.write' } });
    expect(f.tx.authPermission.deleteMany).toHaveBeenCalledWith({ where: { code: 'production.write' } });
    expect(f.tx.authPolicyMigration.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { code } }));
  });
  it('does not grant production writes to a role without an old umbrella grant', async () => {
    const f = fixture([]); await f.seed(); expect(f.tx.authRolePermission.upsert).not.toHaveBeenCalled();
  });
  it('an existing marker does not restore fine-grained grants revoked by an administrator', async () => {
    const f = fixture(['custom_research_legacy'], true); await f.seed(); expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it('shares one in-flight seed instead of racing two local migrations', async () => {
    const f = fixture(['manager']); await Promise.all([f.seed(), f.seed()]); expect(f.db.$transaction).toHaveBeenCalledTimes(1);
  });
  it('a grant failure cannot record completion and a fresh attempt is possible', async () => {
    const f = fixture(['manager']); f.tx.authRolePermission.upsert.mockRejectedValueOnce(new Error('cutover interrupted'));
    await expect(f.seed()).rejects.toThrow('cutover interrupted'); expect(f.tx.authPolicyMigration.upsert).not.toHaveBeenCalled();
    await f.seed(); expect(f.db.$transaction).toHaveBeenCalledTimes(2); expect(f.tx.authPolicyMigration.upsert).toHaveBeenCalledTimes(1);
  });
});
