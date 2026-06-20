import prisma from '../config/database';
import type { AuthRoleView } from './authorization-policy.service';

type RoleAuditAction = 'CREATE_ROLE' | 'UPDATE_ROLE';

export async function writeRoleAuditLog(params: {
  userId?: number;
  action: RoleAuditAction;
  role: AuthRoleView;
  before: AuthRoleView | null;
  after: AuthRoleView;
}) {
  if (!params.userId) return;

  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      resource: 'authorization.role',
      resourceId: params.role.id,
      details: JSON.stringify({
        roleCode: params.role.code,
        before: snapshotRole(params.before),
        after: snapshotRole(params.after),
        changed: diffRole(params.before, params.after),
      }),
    },
  });
}

function snapshotRole(role: AuthRoleView | null) {
  if (!role) return null;
  return {
    code: role.code,
    name: role.name,
    description: role.description,
    isActive: role.isActive,
    dataScopes: [...role.dataScopes].sort(),
    permissions: [...role.permissions].sort(),
  };
}

function diffRole(before: AuthRoleView | null, after: AuthRoleView) {
  if (!before) {
    return {
      created: true,
      addedPermissions: [...after.permissions].sort(),
      removedPermissions: [],
      addedDataScopes: [...after.dataScopes].sort(),
      removedDataScopes: [],
    };
  }

  return {
    nameChanged: before.name !== after.name,
    descriptionChanged: (before.description || '') !== (after.description || ''),
    activeChanged: before.isActive !== after.isActive,
    addedPermissions: after.permissions.filter((item) => !before.permissions.includes(item)).sort(),
    removedPermissions: before.permissions.filter((item) => !after.permissions.includes(item)).sort(),
    addedDataScopes: after.dataScopes.filter((item) => !before.dataScopes.includes(item)).sort(),
    removedDataScopes: before.dataScopes.filter((item) => !after.dataScopes.includes(item)).sort(),
  };
}
