import { Enforcer, newEnforcer, newModelFromString } from 'casbin';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { Permission, ROLE_POLICIES, isBuiltInRole } from './permissionRegistry';

const MODEL = `
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = r.sub == p.sub && r.obj == p.obj && r.act == p.act
`;

type RolePermissionRow = {
  roleCode: string;
  permissionCode: Permission;
};

const isTruthy = (value?: string) =>
  ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

function allowsBuiltInRbacFallback() {
  return isTruthy(process.env.AILAODA_ALLOW_RBAC_FALLBACK);
}

export function permissionToCasbinTuple(permission: Permission): { object: string; action: string } {
  const parts = permission.split('.');
  const action = parts.pop();

  if (!action || parts.length === 0) {
    throw new Error(`Invalid permission format: ${permission}`);
  }

  return {
    object: parts.join('.'),
    action,
  };
}

async function buildEnforcer(role: string): Promise<Enforcer> {
  let rows: RolePermissionRow[];
  try {
    // Cache neither grants nor denials: another node may just have changed this
    // role. One authoritative snapshot is used for the entire decision.
    rows = (await prisma.authRolePermission.findMany({
      where: { roleCode: role, role: { isActive: true } },
      select: {
        roleCode: true,
        permissionCode: true,
      },
      orderBy: { permissionCode: 'asc' },
    })) as RolePermissionRow[];
  } catch (error) {
    if (!allowsBuiltInRbacFallback()) {
      logger.error('Dynamic RBAC policy load failed and built-in fallback is disabled.', error);
      throw error;
    }

    // First-run databases may not have dynamic RBAC tables before runtime repair.
    // Use built-in defaults only when explicitly allowed; normal runtime
    // decisions must come from auth_role_permissions so super-admin changes
    // survive restarts and table failures do not become false-green access.
    logger.warn('Dynamic RBAC policy load failed; using explicit built-in RBAC fallback.', error);
    rows = isBuiltInRole(role)
      ? ROLE_POLICIES[role].permissions.map(permissionCode => ({ roleCode: role, permissionCode }))
      : [];
  }

  // An empty policy is a denial (including inactive/deleted roles), never a
  // reason to restore built-in grants. Each decision owns its Casbin instance.
  const enforcer = await newEnforcer(newModelFromString(MODEL));
  enforcer.enableAutoSave(false);
  for (const row of rows) {
    const { object, action } = permissionToCasbinTuple(row.permissionCode);
    await enforcer.addPolicy(row.roleCode, object, action);
  }
  return enforcer;
}

export async function casbinAllowsPermission(role: string, permission: Permission): Promise<boolean> {
  return casbinAllowsAllPermissions(role, [permission]);
}

export async function casbinAllowsAllPermissions(role: string, permissions: readonly Permission[]): Promise<boolean> {
  if (permissions.length === 0) return true;
  const enforcer = await buildEnforcer(role);
  for (const permission of permissions) {
    const { object, action } = permissionToCasbinTuple(permission);
    const allowed = await enforcer.enforce(role, object, action);
    if (!allowed) {
      return false;
    }
  }

  return true;
}
