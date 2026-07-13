import bcrypt from 'bcryptjs';
import prisma from '../config/database';
import {
  addColumnIfMissing,
  createIndexIfMissing,
  createTableIfMissing,
  SchemaRepairReport,
} from './runtime-schema-repair-utils';
import { demoUsers } from './seed-fixtures';
import { shouldBlockDemoCredentials } from '../security/demo-credentials';

const requirePasswordChangeForDefaultDemoUsers = async (report: SchemaRepairReport) => {
  if (!shouldBlockDemoCredentials()) return;

  for (const account of demoUsers) {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: number; password_hash: string; must_change_password: number }>>(
      'SELECT id, password_hash, must_change_password FROM users WHERE username = ? LIMIT 1',
      account.username,
    );
    const user = rows[0];
    if (!user || user.must_change_password) continue;
    if (await bcrypt.compare(account.password, user.password_hash)) {
      await prisma.$executeRawUnsafe(
        'UPDATE users SET must_change_password = 1 WHERE id = ?',
        user.id,
      );
      report.entries.push({ kind: 'seed', target: `users.${account.username}.must_change_password`, action: 'updated' });
    }
  }
};

export const repairAuthSchema = async (report: SchemaRepairReport) => {
  await addColumnIfMissing(report, 'users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'users', 'password_changed_at', 'DATETIME');
  await requirePasswordChangeForDefaultDemoUsers(report);

  await createTableIfMissing(report, 'auth_roles', `
    CREATE TABLE "auth_roles" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "code" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "is_system" INTEGER NOT NULL DEFAULT 0,
      "is_active" INTEGER NOT NULL DEFAULT 1,
      "data_scopes_json" TEXT,
      "created_by" INTEGER,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "auth_roles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  await addColumnIfMissing(report, 'auth_roles', 'code', 'TEXT');
  await addColumnIfMissing(report, 'auth_roles', 'name', 'TEXT');
  await addColumnIfMissing(report, 'auth_roles', 'description', 'TEXT');
  await addColumnIfMissing(report, 'auth_roles', 'is_system', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'auth_roles', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  await addColumnIfMissing(report, 'auth_roles', 'data_scopes_json', 'TEXT');
  await addColumnIfMissing(report, 'auth_roles', 'created_by', 'INTEGER');
  await addColumnIfMissing(report, 'auth_roles', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await addColumnIfMissing(report, 'auth_roles', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await createIndexIfMissing(report, 'auth_roles_code_key', 'CREATE UNIQUE INDEX "auth_roles_code_key" ON "auth_roles"("code")');
  await createIndexIfMissing(report, 'auth_roles_is_active_idx', 'CREATE INDEX "auth_roles_is_active_idx" ON "auth_roles"("is_active")');

  await createTableIfMissing(report, 'auth_permissions', `
    CREATE TABLE "auth_permissions" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "code" TEXT NOT NULL,
      "resource" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "description" TEXT,
      "group" TEXT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await addColumnIfMissing(report, 'auth_permissions', 'code', 'TEXT');
  await addColumnIfMissing(report, 'auth_permissions', 'resource', 'TEXT');
  await addColumnIfMissing(report, 'auth_permissions', 'action', 'TEXT');
  await addColumnIfMissing(report, 'auth_permissions', 'label', 'TEXT');
  await addColumnIfMissing(report, 'auth_permissions', 'description', 'TEXT');
  await addColumnIfMissing(report, 'auth_permissions', 'group', 'TEXT');
  await addColumnIfMissing(report, 'auth_permissions', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await createIndexIfMissing(report, 'auth_permissions_code_key', 'CREATE UNIQUE INDEX "auth_permissions_code_key" ON "auth_permissions"("code")');
  await createIndexIfMissing(report, 'auth_permissions_resource_idx', 'CREATE INDEX "auth_permissions_resource_idx" ON "auth_permissions"("resource")');
  await createIndexIfMissing(report, 'auth_permissions_group_idx', 'CREATE INDEX "auth_permissions_group_idx" ON "auth_permissions"("group")');

  await createTableIfMissing(report, 'auth_role_permissions', `
    CREATE TABLE "auth_role_permissions" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "role_code" TEXT NOT NULL,
      "permission_code" TEXT NOT NULL,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "auth_role_permissions_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "auth_roles" ("code") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "auth_role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "auth_permissions" ("code") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await addColumnIfMissing(report, 'auth_role_permissions', 'role_code', 'TEXT');
  await addColumnIfMissing(report, 'auth_role_permissions', 'permission_code', 'TEXT');
  await addColumnIfMissing(report, 'auth_role_permissions', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await createIndexIfMissing(report, 'auth_role_permissions_role_permission_key', 'CREATE UNIQUE INDEX "auth_role_permissions_role_permission_key" ON "auth_role_permissions"("role_code", "permission_code")');
  await createIndexIfMissing(report, 'auth_role_permissions_permission_code_idx', 'CREATE INDEX "auth_role_permissions_permission_code_idx" ON "auth_role_permissions"("permission_code")');

  await createTableIfMissing(report, 'auth_policy_migrations', `
    CREATE TABLE "auth_policy_migrations" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "code" TEXT NOT NULL,
      "description" TEXT,
      "applied_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await addColumnIfMissing(report, 'auth_policy_migrations', 'code', 'TEXT');
  await addColumnIfMissing(report, 'auth_policy_migrations', 'description', 'TEXT');
  await addColumnIfMissing(report, 'auth_policy_migrations', 'applied_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await createIndexIfMissing(report, 'auth_policy_migrations_code_key', 'CREATE UNIQUE INDEX "auth_policy_migrations_code_key" ON "auth_policy_migrations"("code")');
};
