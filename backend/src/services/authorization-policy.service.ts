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
  createdAt: string | Date;
  updatedAt: string | Date;
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
    await prisma.authPermission.upsert({
      where: { code: permission.code },
      create: {
        code: permission.code,
        resource: permission.resource,
        action: permission.action,
        label: permission.label,
        description: permission.description || null,
        group: permission.group,
      },
      update: {
        resource: permission.resource,
        action: permission.action,
        label: permission.label,
        description: permission.description || null,
        group: permission.group,
      },
    });
  }
}

async function upsertSystemRoles() {
  for (const [role, policy] of Object.entries(ROLE_POLICIES) as Array<[BuiltInRole, typeof ROLE_POLICIES[BuiltInRole]]>) {
    const existingRole = await prisma.authRole.findUnique({
      where: { code: role },
      select: { dataScopesJson: true },
    });
    await prisma.authRole.upsert({
      where: { code: role },
      create: {
        code: role,
        name: role,
        description: `Built-in ${role} role`,
        isSystem: true,
        isActive: true,
        dataScopesJson: JSON.stringify(policy.dataScopes),
      },
      update: {
        name: role,
        description: `Built-in ${role} role`,
        isSystem: true,
        isActive: true,
        dataScopesJson: existingRole?.dataScopesJson || JSON.stringify(policy.dataScopes),
      },
    });

    const existingPermissions = await prisma.authRolePermission.count({
      where: { roleCode: role },
    });
    if (existingPermissions === 0) {
      await replaceRolePermissions(role, [...policy.permissions]);
    }
  }
}

async function replaceRolePermissions(roleCode: string, permissions: Permission[]) {
  await prisma.authRolePermission.deleteMany({ where: { roleCode } });
  for (const permission of permissions) {
    await prisma.authRolePermission.upsert({
      where: { roleCode_permissionCode: { roleCode, permissionCode: permission } },
      create: { roleCode, permissionCode: permission },
      update: {},
    });
  }
}

async function ensurePolicyMigrationTable() {
  // The runtime schema repair owns table creation for SQLite. PostgreSQL artifacts
  // get this table from the Prisma model, so the seed path only reads/writes rows.
}

async function hasPolicyMigration(code: string): Promise<boolean> {
  const migration = await prisma.authPolicyMigration.findUnique({
    where: { code },
    select: { id: true },
  });
  return migration !== null;
}

async function markPolicyMigration(code: string, description: string) {
  await prisma.authPolicyMigration.upsert({
    where: { code },
    create: { code, description },
    update: {},
  });
}

async function grantMissingRolePermissions(roleCode: string, permissions: Permission[]) {
  for (const permission of permissions) {
    await prisma.authRolePermission.upsert({
      where: { roleCode_permissionCode: { roleCode, permissionCode: permission } },
      create: { roleCode, permissionCode: permission },
      update: {},
    });
  }
}

async function revokeRolePermissions(roleCode: string, permissions: Permission[]) {
  for (const permission of permissions) {
    await prisma.authRolePermission.deleteMany({
      where: { roleCode, permissionCode: permission },
    });
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

  const metricsPermissionCode = '2026-07-08-system-metrics-read-permission-v1';
  if (!(await hasPolicyMigration(metricsPermissionCode))) {
    await grantMissingRolePermissions('admin', ['system.metrics.read']);
    await markPolicyMigration(
      metricsPermissionCode,
      'Protect Prometheus metrics behind an explicit admin-only system.metrics.read permission.',
    );
  }

  const governedAIPermissionCode = '2026-07-13-governed-ai-assistant-permission-v1';
  if (!(await hasPolicyMigration(governedAIPermissionCode))) {
    for (const role of ['admin', 'manager', 'sales', 'warehouse', 'finance'] as BuiltInRole[]) {
      await grantMissingRolePermissions(role, ['ai.assistant.use']);
    }
    await markPolicyMigration(
      governedAIPermissionCode,
      'Grant the governed aggregate-only AI assistant boundary to built-in roles without granting access to protected business records.',
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
  const permissions = await prisma.authPermission.findMany({
    orderBy: [
      { group: 'asc' },
      { resource: 'asc' },
      { action: 'asc' },
    ],
  });
  return permissions.map(permission => ({
    code: permission.code,
    resource: permission.resource,
    action: permission.action,
    label: permission.label,
    description: permission.description,
    permissionGroup: permission.group,
  }));
}

export async function listRoles(): Promise<AuthRoleView[]> {
  await ensureAuthorizationPolicySeed();
  const roles = await prisma.authRole.findMany({
    include: {
      permissions: {
        select: { permissionCode: true },
        orderBy: { permissionCode: 'asc' },
      },
    },
    orderBy: [
      { isSystem: 'desc' },
      { code: 'asc' },
    ],
  });
  return roles.map((role) => normalizeRole({
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    isActive: role.isActive,
    dataScopesJson: role.dataScopesJson,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  }, role.permissions.map(row => row.permissionCode as Permission)));
}

export async function roleExistsAndActive(roleCode: string): Promise<boolean> {
  try {
    await ensureAuthorizationPolicySeed();
    const role = await prisma.authRole.findFirst({
      where: { code: roleCode, isActive: true },
      select: { id: true },
    });
    return role !== null;
  } catch {
    return false;
  }
}

export async function getPermissionsForRole(roleCode: string): Promise<Permission[]> {
  await ensureAuthorizationPolicySeed();

  const rows = await prisma.authRolePermission.findMany({
    where: {
      roleCode,
      role: { isActive: true },
    },
    select: { permissionCode: true },
    orderBy: { permissionCode: 'asc' },
  });

  const permissions = rows
    .map((row) => row.permissionCode)
    .filter((permission): permission is Permission => (ALL_PERMISSION_CODES as readonly string[]).includes(permission));
  return permissions;
}

export async function getDataScopesForRole(roleCode: string): Promise<DataScope[]> {
  await ensureAuthorizationPolicySeed();

  const role = await prisma.authRole.findFirst({
    where: { code: roleCode, isActive: true },
    select: { dataScopesJson: true },
  });

  const scopes = parseDataScopes(role?.dataScopesJson || null);
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
    await tx.authRole.create({
      data: {
        code: input.code!,
        name: input.name,
        description: input.description || null,
        isSystem: false,
        isActive: input.isActive !== false,
        dataScopesJson: JSON.stringify(input.dataScopes || []),
        createdBy: operatorId || null,
      },
    });
    for (const permission of input.permissions) {
      await tx.authRolePermission.create({
        data: { roleCode: input.code!, permissionCode: permission },
      });
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

  const existing = await prisma.authRole.findUnique({
    where: { code: roleCode },
    select: {
      name: true,
      description: true,
      isSystem: true,
      isActive: true,
      dataScopesJson: true,
    },
  });
  if (!existing) {
    throw new Error('Role not found.');
  }
  const isSystemRole = existing.isSystem;
  const nextName = isSystemRole ? existing.name : input.name;
  const nextDescription = isSystemRole ? existing.description : input.description || null;
  const nextIsActive = isSystemRole ? true : input.isActive !== false;
  const nextDataScopes = input.dataScopes ?? parseDataScopes(existing.dataScopesJson || null);

  await prisma.$transaction(async (tx) => {
    await tx.authRole.update({
      where: { code: roleCode },
      data: {
        name: nextName,
        description: nextDescription,
        isActive: nextIsActive,
        dataScopesJson: JSON.stringify(nextDataScopes),
      },
    });
    await tx.authRolePermission.deleteMany({ where: { roleCode } });
    for (const permission of input.permissions) {
      await tx.authRolePermission.create({
        data: { roleCode, permissionCode: permission },
      });
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
