import prisma from '../config/database';
import {
  ALL_PERMISSION_CODES,
  BuiltInRole,
  DataScope,
  PERMISSION_DEFINITIONS,
  Permission,
  ROLE_POLICIES,
  isBuiltInRole,
} from '../permissions/permissionRegistry';
import { resetAuthorizationEnforcer } from '../permissions/casbinAuthorization';

export interface AuthRoleView {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  dataScopes: DataScope[];
  permissions: Permission[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveRoleInput {
  code?: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
  dataScopes?: DataScope[];
  permissions: Permission[];
}

type RoleRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isSystem: number | boolean;
  isActive: number | boolean;
  dataScopesJson: string | null;
  createdAt: string;
  updatedAt: string;
};

type RolePermissionRow = {
  roleCode: string;
  permissionCode: string;
};

const ROLE_CODE_PATTERN = /^[a-z][a-z0-9_:-]{1,49}$/;

const toBool = (value: number | boolean) => value === true || value === 1;

function parseDataScopes(value: string | null): DataScope[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((scope): scope is DataScope => typeof scope === 'string') : [];
  } catch {
    return [];
  }
}

function normalizeRole(row: RoleRow, permissions: Permission[]): AuthRoleView {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: toBool(row.isSystem),
    isActive: toBool(row.isActive),
    dataScopes: parseDataScopes(row.dataScopesJson),
    permissions,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function assertPermissionCodes(permissions: string[]): asserts permissions is Permission[] {
  const allowed = new Set<string>(ALL_PERMISSION_CODES);
  const invalid = permissions.filter((permission) => !allowed.has(permission));
  if (invalid.length > 0) {
    throw new Error(`Invalid permission code(s): ${invalid.join(', ')}`);
  }
}

function assertRoleCode(code: string) {
  if (!ROLE_CODE_PATTERN.test(code)) {
    throw new Error('Role code must start with a lowercase letter and contain only lowercase letters, numbers, underscore, colon, or dash.');
  }
}

async function upsertPermissionDefinitions() {
  for (const permission of PERMISSION_DEFINITIONS) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO auth_permissions (code, resource, action, label, description, "group", created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(code) DO UPDATE SET
         resource = excluded.resource,
         action = excluded.action,
         label = excluded.label,
         description = excluded.description,
         "group" = excluded."group"`,
      permission.code,
      permission.resource,
      permission.action,
      permission.label,
      permission.description || null,
      permission.group,
    );
  }
}

async function upsertSystemRoles() {
  for (const [role, policy] of Object.entries(ROLE_POLICIES) as Array<[BuiltInRole, typeof ROLE_POLICIES[BuiltInRole]]>) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO auth_roles (code, name, description, is_system, is_active, data_scopes_json, created_at, updated_at)
       VALUES (?, ?, ?, 1, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(code) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         is_system = 1,
         is_active = 1,
         data_scopes_json = excluded.data_scopes_json,
         updated_at = CURRENT_TIMESTAMP`,
      role,
      role,
      `Built-in ${role} role`,
      JSON.stringify(policy.dataScopes),
    );

    await replaceRolePermissions(role, [...policy.permissions]);
  }
}

async function replaceRolePermissions(roleCode: string, permissions: Permission[]) {
  await prisma.$executeRawUnsafe('DELETE FROM auth_role_permissions WHERE role_code = ?', roleCode);
  for (const permission of permissions) {
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO auth_role_permissions (role_code, permission_code, created_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)`,
      roleCode,
      permission,
    );
  }
}

export async function ensureAuthorizationPolicySeed() {
  await upsertPermissionDefinitions();
  await upsertSystemRoles();
  resetAuthorizationEnforcer();
}

export async function listPermissions() {
  await ensureAuthorizationPolicySeed();
  return prisma.$queryRawUnsafe(
    `SELECT code, resource, action, label, description, "group" AS permissionGroup
     FROM auth_permissions
     ORDER BY "group", resource, action`,
  );
}

export async function listRoles(): Promise<AuthRoleView[]> {
  await ensureAuthorizationPolicySeed();
  const roles = await prisma.$queryRawUnsafe<RoleRow[]>(
    `SELECT
       id,
       code,
       name,
       description,
       is_system AS isSystem,
       is_active AS isActive,
       data_scopes_json AS dataScopesJson,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM auth_roles
     ORDER BY is_system DESC, code ASC`,
  );
  const rolePermissions = await prisma.$queryRawUnsafe<RolePermissionRow[]>(
    `SELECT role_code AS roleCode, permission_code AS permissionCode
     FROM auth_role_permissions
     ORDER BY role_code, permission_code`,
  );
  const permissionMap = new Map<string, Permission[]>();
  for (const row of rolePermissions) {
    if (!permissionMap.has(row.roleCode)) {
      permissionMap.set(row.roleCode, []);
    }
    permissionMap.get(row.roleCode)!.push(row.permissionCode as Permission);
  }
  return roles.map((role) => normalizeRole(role, permissionMap.get(role.code) || []));
}

export async function roleExistsAndActive(roleCode: string): Promise<boolean> {
  if (isBuiltInRole(roleCode)) {
    return true;
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: unknown }>>(
      'SELECT COUNT(*) AS count FROM auth_roles WHERE code = ? AND is_active = 1',
      roleCode,
    );
    return Number(rows[0]?.count || 0) > 0;
  } catch {
    return false;
  }
}

export async function getPermissionsForRole(roleCode: string): Promise<Permission[]> {
  await ensureAuthorizationPolicySeed();

  if (isBuiltInRole(roleCode)) {
    return [...ROLE_POLICIES[roleCode].permissions];
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ permissionCode: string }>>(
    `SELECT rp.permission_code AS permissionCode
     FROM auth_role_permissions rp
     INNER JOIN auth_roles r ON r.code = rp.role_code
     WHERE r.code = ? AND r.is_active = 1
     ORDER BY rp.permission_code`,
    roleCode,
  );

  return rows
    .map((row) => row.permissionCode)
    .filter((permission): permission is Permission => (ALL_PERMISSION_CODES as readonly string[]).includes(permission));
}

export async function getDataScopesForRole(roleCode: string): Promise<DataScope[]> {
  await ensureAuthorizationPolicySeed();

  if (isBuiltInRole(roleCode)) {
    return [...ROLE_POLICIES[roleCode].dataScopes];
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ dataScopesJson: string | null }>>(
    `SELECT data_scopes_json AS dataScopesJson
     FROM auth_roles
     WHERE code = ? AND is_active = 1
     LIMIT 1`,
    roleCode,
  );

  return parseDataScopes(rows[0]?.dataScopesJson || null);
}

export async function createRole(input: SaveRoleInput, operatorId?: number): Promise<AuthRoleView> {
  await ensureAuthorizationPolicySeed();
  if (!input.code) {
    throw new Error('Role code is required.');
  }
  assertRoleCode(input.code);
  assertPermissionCodes(input.permissions);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO auth_roles (code, name, description, is_system, is_active, data_scopes_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      input.code,
      input.name,
      input.description || null,
      input.isActive === false ? 0 : 1,
      JSON.stringify(input.dataScopes || []),
      operatorId || null,
    );
    for (const permission of input.permissions) {
      await tx.$executeRawUnsafe(
        `INSERT INTO auth_role_permissions (role_code, permission_code, created_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)`,
        input.code,
        permission,
      );
    }
  });

  resetAuthorizationEnforcer();
  const role = (await listRoles()).find((item) => item.code === input.code);
  if (!role) throw new Error('Role was created but could not be read back.');
  return role;
}

export async function updateRole(roleCode: string, input: SaveRoleInput): Promise<AuthRoleView> {
  await ensureAuthorizationPolicySeed();
  assertRoleCode(roleCode);
  assertPermissionCodes(input.permissions);

  const existing = await prisma.$queryRawUnsafe<Array<{ isSystem: unknown }>>(
    'SELECT is_system AS isSystem FROM auth_roles WHERE code = ? LIMIT 1',
    roleCode,
  );
  if (existing.length === 0) {
    throw new Error('Role not found.');
  }
  if (toBool(existing[0].isSystem as number | boolean)) {
    throw new Error('Built-in roles cannot be edited from the dynamic role API.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `UPDATE auth_roles
       SET name = ?, description = ?, is_active = ?, data_scopes_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE code = ?`,
      input.name,
      input.description || null,
      input.isActive === false ? 0 : 1,
      JSON.stringify(input.dataScopes || []),
      roleCode,
    );
    await tx.$executeRawUnsafe('DELETE FROM auth_role_permissions WHERE role_code = ?', roleCode);
    for (const permission of input.permissions) {
      await tx.$executeRawUnsafe(
        `INSERT INTO auth_role_permissions (role_code, permission_code, created_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)`,
        roleCode,
        permission,
      );
    }
  });

  resetAuthorizationEnforcer();
  const role = (await listRoles()).find((item) => item.code === roleCode);
  if (!role) throw new Error('Role was updated but could not be read back.');
  return role;
}
