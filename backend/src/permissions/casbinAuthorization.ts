import { Enforcer, newEnforcer, newModelFromString } from 'casbin';
import prisma from '../config/database';
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

  for (const [role, policy] of Object.entries(ROLE_POLICIES) as Array<[BuiltInRole, typeof ROLE_POLICIES[BuiltInRole]]>) {
    for (const permission of policy.permissions) {
      const { object, action } = permissionToCasbinTuple(permission);
      await enforcer.addPolicy(role, object, action);
    }
  }

  try {
    const rows = await prisma.$queryRawUnsafe<RolePermissionRow[]>(
      `SELECT rp.role_code AS roleCode, rp.permission_code AS permissionCode
       FROM auth_role_permissions rp
       INNER JOIN auth_roles r ON r.code = rp.role_code
       WHERE r.is_active = 1`,
    );

    for (const row of rows) {
      const { object, action } = permissionToCasbinTuple(row.permissionCode);
      await enforcer.addPolicy(row.roleCode, object, action);
    }
  } catch {
    // First-run databases may not have dynamic RBAC tables before runtime repair.
    // Built-in role policies remain available as a safe fallback.
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
