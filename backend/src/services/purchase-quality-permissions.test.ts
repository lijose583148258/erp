import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const { DatabaseSync } = require('node:sqlite');
import { PERMISSION_DEFINITIONS, ROLE_POLICIES, type BuiltInRole } from '../permissions/permissionRegistry';

const migrationCode = '2026-10-14-procurement-quality-payables-separation-v1';
const capabilities = ['procurement.quality.inspect', 'procurement.quality.release', 'procurement.payment.record', 'procurement.payment.verify'];
const expectedGrants: Record<BuiltInRole, string[]> = {
  admin: capabilities, warehouse: [capabilities[0]], manager: [capabilities[1]],
  finance: [capabilities[2], capabilities[3]], sales: [],
};
const previousMigrations = [
  '2026-04-23-sensitive-permission-split-v1', '2026-04-28-sales-procurement-supplier-read-split-v1',
  '2026-06-02-procurement-supplier-read-backfill-v1', '2026-06-03-commercial-platform-permissions-v1',
  '2026-07-08-system-metrics-read-permission-v1', '2026-07-13-governed-ai-assistant-permission-v1',
  '2026-08-01-production-quality-separation-v1', '2026-08-01-material-master-permissions-v1',
  '2026-10-03-payment-reversal-separation-v1', '2026-10-05-procurement-responsibility-split-v1',
  '2026-10-05-production-responsibility-split-v1',
];
type SqliteDatabase = { exec(sql: string): void; close(): void; prepare(sql: string): {
  all(...args: unknown[]): Array<Record<string, unknown>>;
  get(...args: unknown[]): Record<string, unknown> | undefined;
  run(...args: unknown[]): { changes: number | bigint };
} };

describe('purchase quality/payables authorization (real SQLite SQL-adapter unit tests, not live Prisma/PostgreSQL)', () => {
  let database: SqliteDatabase;
  let failGrant: ((role: string, permission: string) => boolean) | null;
  const openFixture = (missingRole?: BuiltInRole, migrated = false) => {
    database = new DatabaseSync(':memory:');
    database.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE auth_permissions(id INTEGER PRIMARY KEY,code TEXT UNIQUE NOT NULL,resource TEXT NOT NULL,
        action TEXT NOT NULL,label TEXT NOT NULL,description TEXT,"group" TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE auth_roles(id INTEGER PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,description TEXT,
        is_system BOOLEAN NOT NULL,is_active BOOLEAN NOT NULL,data_scopes_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE auth_role_permissions(id INTEGER PRIMARY KEY,role_code TEXT NOT NULL REFERENCES auth_roles(code),
        permission_code TEXT NOT NULL REFERENCES auth_permissions(code),UNIQUE(role_code,permission_code));
      CREATE TABLE auth_policy_migrations(id INTEGER PRIMARY KEY,code TEXT UNIQUE NOT NULL,description TEXT,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    for (const role of Object.keys(ROLE_POLICIES)) if (role !== missingRole) {
      database.prepare(`INSERT INTO auth_roles(code,name,is_system,is_active,data_scopes_json,created_at,updated_at)
        VALUES(?,?,TRUE,TRUE,'[]','original','original')`).run(role, role);
    }
    for (const code of [...previousMigrations, ...(migrated ? [migrationCode] : [])]) {
      database.prepare('INSERT INTO auth_policy_migrations(code,description) VALUES(?,?)').run(code, 'prior policy intentionally retained');
    }
    database.prepare(`INSERT INTO auth_roles(code,name,is_system,is_active,data_scopes_json,created_at,updated_at)
      VALUES('custom_qc','QC only',FALSE,TRUE,'["procurement_visible"]','original','original')`).run();
    database.prepare(`INSERT INTO auth_permissions(code,resource,action,label) VALUES('procurement.write','procurement','write','buyer')`).run();
    database.prepare(`INSERT INTO auth_permissions(code,resource,action,label) VALUES('dashboard.read','dashboard','read','legacy read')`).run();
    database.prepare(`INSERT INTO auth_role_permissions(role_code,permission_code) VALUES('custom_qc','procurement.write')`).run();
    for (const role of Object.keys(ROLE_POLICIES)) if (role !== missingRole)
      database.prepare('INSERT INTO auth_role_permissions(role_code,permission_code) VALUES(?,?)').run(role, 'dashboard.read');
    failGrant = null;

    const dbPort = {
      authPermission: { upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => {
        database.prepare(`INSERT INTO auth_permissions(code,resource,action,label,description,"group") VALUES(?,?,?,?,?,?)
          ON CONFLICT(code) DO UPDATE SET resource=excluded.resource,action=excluded.action,label=excluded.label,
          description=excluded.description,"group"=excluded."group"`).run(create.code, create.resource, create.action, create.label, create.description, create.group);
        return {};
      }) },
      authRole: {
        findUnique: jest.fn(async ({ where }: { where: { code: string } }) => {
          const row = database.prepare('SELECT data_scopes_json AS dataScopesJson FROM auth_roles WHERE code=?').get(where.code);
          return row || null;
        }),
        upsert: jest.fn(async ({ where, update }: { where: { code: string }; update: Record<string, unknown> }) => {
          database.prepare('UPDATE auth_roles SET name=?,description=?,is_system=?,data_scopes_json=?,is_active=CASE WHEN ? THEN ? ELSE is_active END WHERE code=?')
            .run(update.name, update.description, update.isSystem ? 1 : 0, update.dataScopesJson,
              'isActive' in update ? 1 : 0, update.isActive ? 1 : 0, where.code);
          return {};
        }),
      },
      authRolePermission: {
        count: jest.fn(async ({ where }: { where: { roleCode: string } }) =>
          Number(database.prepare('SELECT COUNT(*) AS count FROM auth_role_permissions WHERE role_code=?').get(where.roleCode)?.count)),
        upsert: jest.fn(async ({ create }: { create: { roleCode: string; permissionCode: string } }) => {
        if (failGrant?.(create.roleCode, create.permissionCode)) throw new Error('injected permission grant failure');
        database.prepare('INSERT INTO auth_role_permissions(role_code,permission_code) VALUES(?,?) ON CONFLICT(role_code,permission_code) DO NOTHING')
          .run(create.roleCode, create.permissionCode);
        return {};
      }) },
      authPolicyMigration: { findUnique: jest.fn(async ({ where }: { where: { code: string } }) =>
        database.prepare('SELECT id FROM auth_policy_migrations WHERE code=?').get(where.code) || null) },
      $executeRawUnsafe: jest.fn(async (sql: string, ...args: unknown[]) => Number(database.prepare(sql).run(...args).changes)),
      $queryRawUnsafe: jest.fn(async (sql: string, ...args: unknown[]) => database.prepare(sql).all(...args)),
    };
    const port = { ...dbPort, $transaction: jest.fn(async (action: (tx: typeof dbPort) => Promise<unknown>) => {
      database.exec('BEGIN IMMEDIATE');
      try { const result = await action(dbPort); database.exec('COMMIT'); return result; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    }) };
    const loadService = () => {
      jest.doMock('../config/database', () => ({ __esModule: true, default: port }));
      jest.doMock('../config/runtime', () => ({ runtime: { databaseEngine: 'sqlite' } }));
      let service: typeof import('./authorization-policy.service');
      jest.isolateModules(() => { service = require('./authorization-policy.service'); });
      return service!;
    };
    return { port, loadService, seed: () => loadService().ensureAuthorizationPolicySeed() };
  };
  const grants = (role: string) => database.prepare('SELECT permission_code AS code FROM auth_role_permissions WHERE role_code=? ORDER BY permission_code')
    .all(role).map(row => row.code);
  afterEach(() => {
    database?.close(); jest.dontMock('../config/database'); jest.dontMock('../config/runtime');
  });

  it('declares only four bounded capabilities with exact built-in duties and no implicit procurement read grants', () => {
    for (const code of capabilities) expect(PERMISSION_DEFINITIONS.filter(definition => definition.code === code)).toHaveLength(1);
    for (const [role, expected] of Object.entries(expectedGrants))
      expect(ROLE_POLICIES[role as BuiltInRole].permissions.filter(code => capabilities.includes(code)).sort()).toEqual([...expected].sort());
    const f = openFixture();
    for (const values of Object.values(f.loadService().PURCHASE_QUALITY_PAYABLE_PERMISSION_BACKFILL.grants))
      expect(values).not.toContain('procurement.read');
  });

  it('adds the eight intended role grants and its marker in one transaction, preserving custom scopes and permissions', async () => {
    const f = openFixture(); await f.seed();
    expect(f.port.$transaction).toHaveBeenCalledTimes(1);
    for (const [role, expected] of Object.entries(expectedGrants)) expect(grants(role)).toEqual(['dashboard.read', ...expected].sort());
    expect(grants('custom_qc')).toEqual(['procurement.write']);
    expect(database.prepare("SELECT data_scopes_json FROM auth_roles WHERE code='custom_qc'").get())
      .toEqual({ data_scopes_json: '["procurement_visible"]' });
    expect(database.prepare('SELECT COUNT(*) AS count FROM auth_policy_migrations WHERE code=?').get(migrationCode)).toEqual({ count: 1 });
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('preserves an existing deny-all role even before this new migration has run', async () => {
    const f = openFixture();
    database.prepare('DELETE FROM auth_role_permissions WHERE role_code=?').run('warehouse');
    await f.seed();
    expect(grants('warehouse')).toEqual([]);
    expect(grants('manager')).toEqual(['dashboard.read', 'procurement.quality.release']);
    expect(database.prepare('SELECT COUNT(*) AS count FROM auth_policy_migrations WHERE code=?').get(migrationCode)).toEqual({ count: 1 });
    await f.seed(); expect(grants('warehouse')).toEqual([]);
  });

  it('does not restore any grants when existing roles are deliberately emptied and the process restarts twice', async () => {
    const f = openFixture(); await f.seed();
    database.exec('DELETE FROM auth_role_permissions');
    for (let restart = 0; restart < 2; restart += 1) {
      await f.seed();
      expect(database.prepare('SELECT COUNT(*) AS count FROM auth_role_permissions').get()).toEqual({ count: 0 });
      expect(grants('warehouse')).toEqual([]); expect(grants('admin')).toEqual([]);
    }
    expect(database.prepare('SELECT COUNT(*) AS count FROM auth_policy_migrations WHERE code=?').get(migrationCode)).toEqual({ count: 1 });
  });

  it('never reactivates an existing system role disabled by an administrator during startup metadata repair', async () => {
    const f = openFixture(undefined, true);
    database.exec("UPDATE auth_roles SET is_active=FALSE WHERE code='warehouse'");
    for (let restart = 0; restart < 2; restart += 1) await f.seed();
    expect(database.prepare("SELECT is_active FROM auth_roles WHERE code='warehouse'").get()).toEqual({ is_active: 0 });
    expect(grants('warehouse')).toEqual(['dashboard.read']);
  });

  it('rolls back all partial duty grants and marker on failure, then safely retries the same seed instance', async () => {
    const f = openFixture(); const service = f.loadService();
    failGrant = (role, code) => role === 'warehouse' && code === 'procurement.quality.inspect';
    await expect(service.ensureAuthorizationPolicySeed()).rejects.toThrow('injected permission grant failure');
    for (const role of Object.keys(expectedGrants)) expect(grants(role)).toEqual(['dashboard.read']);
    expect(database.prepare('SELECT COUNT(*) AS count FROM auth_policy_migrations WHERE code=?').get(migrationCode)).toEqual({ count: 0 });
    expect(grants('custom_qc')).toEqual(['procurement.write']);
    failGrant = null; await service.ensureAuthorizationPolicySeed();
    for (const [role, expected] of Object.entries(expectedGrants)) expect(grants(role)).toEqual(['dashboard.read', ...expected].sort());
    expect(database.prepare('SELECT COUNT(*) AS count FROM auth_policy_migrations WHERE code=?').get(migrationCode)).toEqual({ count: 1 });
  });

  it('creates a new built-in role and its defaults atomically instead of persisting a role with half its grants', async () => {
    const f = openFixture('admin', true); const service = f.loadService();
    failGrant = (role, code) => role === 'admin' && code === 'customers.read';
    await expect(service.ensureAuthorizationPolicySeed()).rejects.toThrow('injected permission grant failure');
    expect(database.prepare("SELECT id FROM auth_roles WHERE code='admin'").get()).toBeUndefined();
    expect(grants('admin')).toEqual([]);
    failGrant = null; await service.ensureAuthorizationPolicySeed();
    expect(grants('admin')).toEqual([...ROLE_POLICIES.admin.permissions].sort());
    expect(grants('warehouse')).toEqual(['dashboard.read']);
    expect(database.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });

  it('a migration claim lost to a competing node never regrants duties or rewrites an existing marker', async () => {
    const f = openFixture();
    const original = f.port.authPolicyMigration.findUnique.getMockImplementation()!;
    f.port.authPolicyMigration.findUnique.mockImplementation(async input => {
      if (input.where.code !== migrationCode) return original(input);
      database.prepare('INSERT INTO auth_policy_migrations(code,description) VALUES(?,?) ON CONFLICT(code) DO NOTHING')
        .run(migrationCode, 'other node committed; administrator revoked duties');
      return null; // Simulate the stale pre-transaction read, not an actual distributed acceptance test.
    });
    await f.seed();
    for (const role of Object.keys(expectedGrants)) expect(grants(role)).toEqual(['dashboard.read']);
    expect(database.prepare('SELECT description FROM auth_policy_migrations WHERE code=?').get(migrationCode))
      .toEqual({ description: 'other node committed; administrator revoked duties' });
  });

  it('mirrors actual frontend defaults and permits the redacted QC shell without priced or financial permissions', () => {
    openFixture();
    const source = fs.readFileSync(path.resolve(__dirname, '../../../app/permissions.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const exports: { FRONTEND_ROLE_PERMISSIONS?: Record<string, string[]>; can?: (user: unknown, permission: string) => boolean;
      canOpenModule?: (user: unknown, module: string) => boolean } = {};
    vm.runInNewContext(code, { exports }, { timeout: 1000 });
    for (const [role, expected] of Object.entries(expectedGrants))
      expect(exports.FRONTEND_ROLE_PERMISSIONS![role].filter(value => capabilities.includes(value)).sort()).toEqual([...expected].sort());
    for (const permission of capabilities.slice(0, 2)) {
      const user = { role: 'custom_qc', permissions: [permission], dataScopes: ['procurement_visible'] };
      expect(exports.canOpenModule!(user, 'procurement')).toBe(true);
      for (const forbidden of ['procurement.read', 'procurement.write', 'finance.read', ...capabilities.slice(2)])
        expect(exports.can!(user, forbidden)).toBe(false);
      expect(exports.canOpenModule!(user, 'financeAnalytics')).toBe(false);
    }
    expect(exports.canOpenModule!({ role: 'admin', permissions: [], dataScopes: ['all'] }, 'procurement')).toBe(false);
  });
});
