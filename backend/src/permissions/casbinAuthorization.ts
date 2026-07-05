import { Enforcer, newEnforcer, newModelFromString } from 'casbin';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { BuiltInRole, Permission, ROLE_POLICIES } from './permissionRegistry';

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

let enforcerPromise: Promise<Enforcer> | null = null;

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

async function buildEnforcer(): Promise<Enforcer> {
  const model = newModelFromString(MODEL);
  const enforcer = await newEnforcer(model);
  enforcer.enableAutoSave(false);

  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT rp.role_code AS roleCode, rp.permission_code AS permissionCode
       FROM auth_role_permissions rp
       INNER JOIN auth_roles r ON r.code = rp.role_code
       WHERE r.is_active = 1`,
    )) as RolePermissionRow[];

    if (rows.length === 0) {
      throw new Error('Dynamic RBAC table has no role permission rows.');
    }

    for (const row of rows) {
      const { object, action } = permissionToCasbinTuple(row.permissionCode);
      await enforcer.addPolicy(row.roleCode, object, action);
    }
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
    for (const [role, policy] of Object.entries(ROLE_POLICIES) as Array<[BuiltInRole, typeof ROLE_POLICIES[BuiltInRole]]>) {
      for (const permission of policy.permissions) {
        const { object, action } = permissionToCasbinTuple(permission);
        await enforcer.addPolicy(role, object, action);
      }
    }
  }

  return enforcer;
}

export function getAuthorizationEnforcer(): Promise<Enforcer> {
  if (!enforcerPromise) {
    enforcerPromise = buildEnforcer();
  }

  return enforcerPromise;
}

export function resetAuthorizationEnforcer() {
  enforcerPromise = null;
}

export async function casbinAllowsPermission(role: string, permission: Permission): Promise<boolean> {
  const enforcer = await getAuthorizationEnforcer();
  const { object, action } = permissionToCasbinTuple(permission);
  return enforcer.enforce(role, object, action);
}

export async function casbinAllowsAllPermissions(role: string, permissions: readonly Permission[]): Promise<boolean> {
  for (const permission of permissions) {
    const allowed = await casbinAllowsPermission(role, permission);
    if (!allowed) {
      return false;
    }
  }

  return true;
}
