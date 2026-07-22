const fs = require('fs');
const path = require('path');
const { loadMigrations, reconcile } = require('./postgres-schema-migrate-v1.cjs');

const root = process.cwd();
const findings = [];
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const requireTokens = (relativePath, tokens) => {
  const source = read(relativePath);
  for (const token of tokens) if (!source.includes(token)) findings.push(`${relativePath}: missing ${token}`);
  return source;
};

const runner = requireTokens('scripts/postgres-schema-migrate-v1.cjs', [
  'ailaoda_schema_migrations',
  'checksum_sha256',
  'pg_advisory_lock',
  "await client.query('BEGIN')",
  "await client.query('ROLLBACK')",
  "command === 'verify'",
  'unknown migration versions',
  'migration history has gaps',
]);
requireTokens('backend/prisma/postgres-migrations/202607220001_order-import-idempotency/migration.sql', [
  'CREATE TABLE IF NOT EXISTS "order_import_batches"',
  'ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "import_batch_id"',
  'orders_import_batch_id_import_row_number_key',
  'orders_import_batch_id_fkey',
  'ON DELETE SET NULL',
]);
requireTokens('backend/prisma/postgres-migrations/202607220002_order-import-retention/migration.sql', [
  'ADD COLUMN IF NOT EXISTS "completed_at"',
  'WHERE "status" = \'completed\' AND "completed_at" IS NULL',
  'order_import_batches_status_completed_at_idx',
  'order_import_batches_status_created_at_idx',
]);
requireTokens('scripts/run-postgres-import-rehearsal-v1.cjs', [
  'apply-versioned-postgres-migrations',
  'verify-versioned-postgres-migrations',
]);
requireTokens('package.json', [
  'db:pg:migrate',
  'audit:db:postgres-versioned-migrations',
]);
requireTokens('scripts/build-postgres-server-artifact-v1.cjs', [
  'copy-postgres-versioned-migrations',
  'copy-postgres-versioned-migrator',
  'postgres-schema-migrate-v1.cjs apply',
  'postgres-schema-migrate-v1.cjs verify',
]);

for (const migration of loadMigrations()) {
  if (/^\s*(DROP|TRUNCATE|DELETE)\b/im.test(migration.sql)) {
    findings.push(`${migration.id}/migration.sql: destructive statement is forbidden in an additive migration`);
  }
}
if (!runner.includes('application_name: \'ailaoda-schema-migrator\'')) findings.push('migrator: application_name is missing');

try {
  const migrations = loadMigrations();
  const clean = reconcile(migrations, migrations.map(item => ({ version: item.id, checksum_sha256: item.checksum })));
  if (clean.pending.length || clean.unknown.length || clean.modified.length) findings.push('migrator reconciliation rejected an exact applied ledger');
  const modified = reconcile(migrations, [{ version: migrations[0].id, checksum_sha256: '0'.repeat(64) }]);
  if (modified.modified.length !== 1) findings.push('migrator reconciliation did not detect checksum drift');
  const synthetic = [
    { id: '202607220001_first', checksum: 'a' },
    { id: '202607220002_second', checksum: 'b' },
  ];
  const gap = reconcile(synthetic, [{ version: synthetic[1].id, checksum_sha256: synthetic[1].checksum }]);
  if (gap.outOfOrder.length !== 1 || gap.outOfOrder[0].id !== synthetic[0].id) {
    findings.push('migrator reconciliation did not detect an out-of-order migration history gap');
  }
} catch (error) {
  findings.push(`migration discovery failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (findings.length) {
  console.error('PostgreSQL Versioned Migration Audit: FAIL');
  findings.forEach(finding => console.error(`- ${finding}`));
  process.exit(1);
}

console.log('PostgreSQL Versioned Migration Audit: PASS');
console.log('- Ordered additive migrations use a checksum ledger, advisory lock, and per-migration transaction.');
console.log('- Applied migration drift and unknown database versions fail closed.');
console.log('- Migration history gaps fail closed instead of applying an older migration out of order.');
console.log('- Order import idempotency and retention metadata have in-place PostgreSQL upgrade paths.');
