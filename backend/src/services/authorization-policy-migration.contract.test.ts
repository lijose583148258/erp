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
