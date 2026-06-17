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
import { writeRoleAuditLog } from './role-audit.service';

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
let authorizationSeeded = false;
let authorizationSeedPromise: Promise<void> | null = null;

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
         data_scopes_json = COALESCE(auth_roles.data_scopes_json, excluded.data_scopes_json),
         updated_at = CURRENT_TIMESTAMP`,
      role,
      role,
      `Built-in ${role} role`,
      JSON.stringify(policy.dataScopes),
    );

    const existingPermissions = await prisma.$queryRawUnsafe<Array<{ count: unknown }>>(
      'SELECT COUNT(*) AS count FROM auth_role_permissions WHERE role_code = ?',
      role,
    );
    if (Number(existingPermissions[0]?.count || 0) === 0) {
      await replaceRolePermissions(role, [...policy.permissions]);
    }
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

async function ensurePolicyMigrationTable() {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS auth_policy_migrations (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      description TEXT,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS auth_policy_migrations_code_key ON auth_policy_migrations(code)',
  );
}

async function hasPolicyMigration(code: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: unknown }>>(
    'SELECT COUNT(*) AS count FROM auth_policy_migrations WHERE code = ?',
    code,
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function markPolicyMigration(code: string, description: string) {
  await prisma.$executeRawUnsafe(
    `INSERT OR IGNORE INTO auth_policy_migrations (code, description, applied_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)`,
    code,
    description,
  );
}

async function grantMissingRolePermissions(roleCode: string, permissions: Permission[]) {
  for (const permission of permissions) {
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO auth_role_permissions (role_code, permission_code, created_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)`,
      roleCode,
      permission,
    );
  }
}

async function revokeRolePermissions(roleCode: string, permissions: Permission[]) {
  for (const permission of permissions) {
    await prisma.$executeRawUnsafe(
      'DELETE FROM auth_role_permissions WHERE role_code = ? AND permission_code = ?',
      roleCode,
      permission,
    );
  }
}

async function applyAuthorizationPolicyMigrations() {
  await ensurePolicyMigrationTable();

  const sensitiveSplitCode = '2026-04-23-sensitive-permission-split-v1';
  if (!(await hasPolicyMigration(sensitiveSplitCode))) {
    await grantMissingRolePermissions('admin', [
      'authorization.roles.manage',
      'warehouse.ledger.read',
      'production.cost.read',
    ]);
    await grantMissingRolePermissions('manager', [
      'warehouse.ledger.read',
      'production.cost.read',
    ]);
    await grantMissingRolePermissions('warehouse', [
      'warehouse.ledger.read',
    ]);
    await grantMissingRolePermissions('finance', [
      'production.cost.read',
    ]);
    await markPolicyMigration(
      sensitiveSplitCode,
      'Split role assignment, warehouse ledger, and production cost into explicit permissions without resetting user-managed role policies.',
    );
  }

  const salesSupplierSplitCode = '2026-04-28-sales-procurement-supplier-read-split-v1';
  if (!(await hasPolicyMigration(salesSupplierSplitCode))) {
    await revokeRolePermissions('sales', ['procurement.suppliers.read']);
    await grantMissingRolePermissions('sales', ['procurement.b2b.read']);
    await markPolicyMigration(
      salesSupplierSplitCode,
      'Keep sales access to B2B procurement status while removing direct supplier master-data list access from the built-in sales role.',
    );
  }

  const supplierReadBackfillCode = '2026-06-02-procurement-supplier-read-backfill-v1';
  if (!(await hasPolicyMigration(supplierReadBackfillCode))) {
    await grantMissingRolePermissions('admin', ['procurement.suppliers.read']);
    await grantMissingRolePermissions('manager', ['procurement.suppliers.read']);
    await grantMissingRolePermissions('warehouse', ['procurement.suppliers.read']);
    await grantMissingRolePermissions('finance', ['procurement.suppliers.read']);
    await revokeRolePermissions('sales', ['procurement.suppliers.read']);
    await grantMissingRolePermissions('sales', ['procurement.b2b.read']);
    await markPolicyMigration(
      supplierReadBackfillCode,
      'Backfill supplier master-data read permission for procurement, finance, warehouse, and manager roles while preserving sales redaction boundaries.',
    );
  }

  const commercialPermissionCode = '2026-06-03-commercial-platform-permissions-v1';
  if (!(await hasPolicyMigration(commercialPermissionCode))) {
    const commercialPermissions: Permission[] = [
      'commercial.read',
      'commercial.workflow.manage',
      'commercial.notification.write',
      'commercial.alert.run',
    ];
    await grantMissingRolePermissions('admin', commercialPermissions);
    await grantMissingRolePermissions('manager', commercialPermissions);
    await markPolicyMigration(
      commercialPermissionCode,
      'Replace fixed commercial platform role guards with explicit platform governance permissions for admin and manager roles.',
    );
  }
}

export async function ensureAuthorizationPolicySeed() {
  if (authorizationSeeded) return;

  if (!authorizationSeedPromise) {
    authorizationSeedPromise = (async () => {
      await upsertPermissionDefinitions();
      await upsertSystemRoles();
      await applyAuthorizationPolicyMigrations();
      resetAuthorizationEnforcer();
      authorizationSeeded = true;
    })().catch((error) => {
      authorizationSeeded = false;
      throw error;
    }).finally(() => {
      authorizationSeedPromise = null;
    });
  }

  await authorizationSeedPromise;
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
  try {
    await ensureAuthorizationPolicySeed();
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

  const rows = await prisma.$queryRawUnsafe<Array<{ permissionCode: string }>>(
    `SELECT rp.permission_code AS permissionCode
     FROM auth_role_permissions rp
     INNER JOIN auth_roles r ON r.code = rp.role_code
     WHERE r.code = ? AND r.is_active = 1
     ORDER BY rp.permission_code`,
     roleCode,
  );

  const permissions = rows
    .map((row) => row.permissionCode)
    .filter((permission): permission is Permission => (ALL_PERMISSION_CODES as readonly string[]).includes(permission));
  return permissions;
}

export async function getDataScopesForRole(roleCode: string): Promise<DataScope[]> {
  await ensureAuthorizationPolicySeed();

  const rows = await prisma.$queryRawUnsafe<Array<{ dataScopesJson: string | null }>>(
    `SELECT data_scopes_json AS dataScopesJson
     FROM auth_roles
     WHERE code = ? AND is_active = 1
     LIMIT 1`,
     roleCode,
  );

  const scopes = parseDataScopes(rows[0]?.dataScopesJson || null);
  return scopes;
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
  await writeRoleAuditLog({
    userId: operatorId,
    action: 'CREATE_ROLE',
    role,
    before: null,
    after: role,
  });
  return role;
}

export async function updateRole(roleCode: string, input: SaveRoleInput, operatorId?: number): Promise<AuthRoleView> {
  await ensureAuthorizationPolicySeed();
  assertRoleCode(roleCode);
  assertPermissionCodes(input.permissions);
  const before = (await listRoles()).find((item) => item.code === roleCode) || null;

  const existing = await prisma.$queryRawUnsafe<Array<{
    name: string;
    description: string | null;
    isSystem: unknown;
    isActive: unknown;
    dataScopesJson: string | null;
  }>>(
    `SELECT
       name,
       description,
       is_system AS isSystem,
       is_active AS isActive,
       data_scopes_json AS dataScopesJson
     FROM auth_roles
     WHERE code = ?
     LIMIT 1`,
    roleCode,
  );
  if (existing.length === 0) {
    throw new Error('Role not found.');
  }
  const current = existing[0];
  const isSystemRole = toBool(current.isSystem as number | boolean);
  const nextName = isSystemRole ? current.name : input.name;
  const nextDescription = isSystemRole ? current.description : input.description || null;
  const nextIsActive = isSystemRole ? 1 : input.isActive === false ? 0 : 1;
  const nextDataScopes = input.dataScopes ?? parseDataScopes(current.dataScopesJson || null);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `UPDATE auth_roles
       SET name = ?, description = ?, is_active = ?, data_scopes_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE code = ?`,
      nextName,
      nextDescription,
      nextIsActive,
      JSON.stringify(nextDataScopes),
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
  await writeRoleAuditLog({
    userId: operatorId,
    action: 'UPDATE_ROLE',
    role,
    before,
    after: role,
  });
  return role;
}
