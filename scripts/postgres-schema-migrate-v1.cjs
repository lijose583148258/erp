const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, 'backend', 'prisma', 'postgres-migrations');
const REPORT_PATH = path.join(ROOT, 'output', 'audit', 'postgres-schema-migrate-v1.json');
const MIGRATION_ID_PATTERN = /^\d{12}_[a-z0-9][a-z0-9-]*$/;
const LOCK_NAME = 'ailaoda:postgres-schema-migrations:v1';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function loadMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) throw new Error(`Migration directory is missing: ${MIGRATIONS_DIR}`);
  const migrations = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
    .map((id) => {
      if (!MIGRATION_ID_PATTERN.test(id)) throw new Error(`Invalid PostgreSQL migration id: ${id}`);
      const filePath = path.join(MIGRATIONS_DIR, id, 'migration.sql');
      if (!fs.existsSync(filePath)) throw new Error(`Migration SQL is missing: ${filePath}`);
      const sql = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim();
      if (!sql) throw new Error(`Migration SQL is empty: ${filePath}`);
      return { id, filePath, sql, checksum: sha256(sql) };
    });
  if (migrations.length === 0) throw new Error('No versioned PostgreSQL migrations were found.');
  return migrations;
}

function resolvePostgresUrl() {
  const value = String(process.env.POSTGRES_URL || process.env.DATABASE_URL || '').trim();
  if (!/^postgres(?:ql)?:\/\//i.test(value)) {
    throw new Error('POSTGRES_URL or DATABASE_URL must be a PostgreSQL connection string.');
  }
  return value;
}

function loadPgClient() {
  const pgPath = path.join(ROOT, 'backend', 'node_modules', 'pg');
  return require(pgPath).Client;
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "ailaoda_schema_migrations" (
      "version" TEXT PRIMARY KEY,
      "checksum_sha256" CHAR(64) NOT NULL,
      "execution_ms" INTEGER NOT NULL,
      "applied_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function readApplied(client) {
  const result = await client.query(
    'SELECT "version", "checksum_sha256", "execution_ms", "applied_at" FROM "ailaoda_schema_migrations" ORDER BY "version"',
  );
  return result.rows;
}

function reconcile(migrations, appliedRows) {
  const available = new Map(migrations.map(item => [item.id, item]));
  const applied = new Map(appliedRows.map(item => [item.version, item]));
  const unknown = appliedRows.filter(item => !available.has(item.version));
  const modified = appliedRows.filter((item) => {
    const migration = available.get(item.version);
    return migration && migration.checksum !== String(item.checksum_sha256).trim();
  });
  const pending = migrations.filter(item => !applied.has(item.id));
  const latestApplied = appliedRows
    .map(item => item.version)
    .filter(version => available.has(version))
    .sort()
    .at(-1);
  const outOfOrder = latestApplied ? pending.filter(item => item.id < latestApplied) : [];
  return { pending, unknown, modified, outOfOrder };
}

async function applyPending(client, migrations, report) {
  const appliedRows = await readApplied(client);
  const state = reconcile(migrations, appliedRows);
  if (state.unknown.length) throw new Error(`Database contains unknown migration versions: ${state.unknown.map(item => item.version).join(', ')}`);
  if (state.modified.length) throw new Error(`Applied migration checksum mismatch: ${state.modified.map(item => item.version).join(', ')}`);
  if (state.outOfOrder.length) throw new Error(`Database migration history has gaps before an applied version: ${state.outOfOrder.map(item => item.id).join(', ')}`);

  for (const migration of state.pending) {
    const startedAt = Date.now();
    await client.query('BEGIN');
    try {
      await client.query(migration.sql);
      const executionMs = Date.now() - startedAt;
      await client.query(
        'INSERT INTO "ailaoda_schema_migrations" ("version", "checksum_sha256", "execution_ms") VALUES ($1, $2, $3)',
        [migration.id, migration.checksum, executionMs],
      );
      await client.query('COMMIT');
      report.applied.push({ version: migration.id, checksumSha256: migration.checksum, executionMs });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}

async function run(command = 'status') {
  const migrations = loadMigrations();
  const report = {
    name: 'PostgreSQL Versioned Schema Migration',
    version: 1,
    command,
    status: 'running',
    startedAt: new Date().toISOString(),
    available: migrations.map(item => ({ version: item.id, checksumSha256: item.checksum })),
    applied: [],
  };

  if (command === 'plan') {
    report.status = 'passed';
    report.finishedAt = new Date().toISOString();
    return report;
  }
  if (!['status', 'verify', 'apply'].includes(command)) throw new Error(`Unsupported migration command: ${command}`);

  const Client = loadPgClient();
  const client = new Client({ connectionString: resolvePostgresUrl(), application_name: 'ailaoda-schema-migrator' });
  await client.connect();
  try {
    await client.query("SET lock_timeout = '10s'");
    await client.query("SET statement_timeout = '120s'");
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_NAME]);
    try {
      await ensureLedger(client);
      if (command === 'apply') await applyPending(client, migrations, report);
      const appliedRows = await readApplied(client);
      const state = reconcile(migrations, appliedRows);
      if (state.unknown.length) throw new Error(`Database contains unknown migration versions: ${state.unknown.map(item => item.version).join(', ')}`);
      if (state.modified.length) throw new Error(`Applied migration checksum mismatch: ${state.modified.map(item => item.version).join(', ')}`);
      if (state.outOfOrder.length) throw new Error(`Database migration history has gaps before an applied version: ${state.outOfOrder.map(item => item.id).join(', ')}`);
      if (command === 'verify' && state.pending.length) throw new Error(`Pending PostgreSQL migrations: ${state.pending.map(item => item.id).join(', ')}`);
      report.databaseState = {
        applied: appliedRows.map(item => ({
          version: item.version,
          checksumSha256: String(item.checksum_sha256).trim(),
          executionMs: item.execution_ms,
          appliedAt: item.applied_at,
        })),
        pending: state.pending.map(item => item.id),
      };
      report.status = 'passed';
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_NAME]);
    }
  } finally {
    await client.end();
  }
  report.finishedAt = new Date().toISOString();
  return report;
}

async function main() {
  const command = String(process.argv[2] || 'status').toLowerCase();
  let report;
  try {
    report = await run(command);
  } catch (error) {
    report = {
      name: 'PostgreSQL Versioned Schema Migration',
      version: 1,
      command,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      finishedAt: new Date().toISOString(),
    };
    process.exitCode = 1;
  }
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main();

module.exports = { loadMigrations, reconcile, run };
