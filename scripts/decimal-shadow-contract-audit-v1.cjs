const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const contract = JSON.parse(read('backend/src/database/decimal-shadow-v1.json'));
const repairSource = read('backend/src/database/runtime-schema-decimal-repair.ts');
const repairOrchestrator = read('backend/src/database/runtime-schema-repair.ts');
const migration = read('backend/prisma/postgres-migrations/202608010004_receivables-decimal-shadow/migration.sql');
const reconcileAudit = read('scripts/decimal-shadow-reconcile-audit-v1.cjs');
const writePathAudit = read('scripts/decimal-shadow-write-path-audit-v1.cjs');
const releaseGate = read('scripts/run-release-verification-v1.cjs');
const enterpriseVerdict = read('scripts/enterprise-release-verdict-v1.cjs');
const enterpriseReleaseWorkflow = read('.github/workflows/enterprise-release-certification.yml');
const enterpriseCloudWorkflow = read('.github/workflows/enterprise-cloud-sandbox.yml');
const orderItemNormalization = read('backend/src/services/order-item-normalization.ts');
const orderImportService = read('backend/src/services/order-import.service.ts');
const orderUpdateService = read('backend/src/services/order-update.service.ts');
const orderController = read('backend/src/controllers/order.controller.ts');

assert.equal(contract.version, '2026-08-01-receivables-decimal-shadow-v1');
assert.deepEqual(contract.tables.map(table => table.table), [
  'orders',
  'payment_records',
  'receivable_adjustments',
]);

const fields = contract.tables.flatMap(table => table.fields.map(field => ({ table: table.table, ...field })));
assert.equal(fields.length, 9);
assert.equal(fields.filter(field => field.kind === 'money' && field.precision === 18 && field.scale === 2).length, 7);
assert.equal(fields.filter(field => field.kind === 'exchange_rate' && field.precision === 18 && field.scale === 8).length, 2);
assert.equal(new Set(fields.map(field => `${field.table}.${field.shadowColumn}`)).size, fields.length);

for (const table of contract.tables) {
  for (const field of table.fields) {
    assert.match(migration, new RegExp(`"${field.shadowColumn}" NUMERIC\\(${field.precision},${field.scale}\\)`));
    assert.match(migration, new RegExp(`ROUND\\("${field.legacyColumn}"::numeric, ${field.scale}\\)`));
  }
  assert.ok(migration.includes(`CREATE TRIGGER "${table.postgresTrigger}"`));
  assert.ok(repairSource.includes('ensureTriggerDefinition'));
}

assert.match(repairSource, /decimalShadowContract\.tables/);
assert.match(repairSource, /printf\('\$\{format\}'/);
assert.match(repairSource, /verifyDecimalShadowState/);
assert.match(repairSource, /Decimal shadow repair verification failed/);
assert.match(repairOrchestrator, /repairDecimalShadowSchema\(report\)/);
assert.match(migration, /ALTER COLUMN "final_amount_decimal" SET NOT NULL/);
assert.match(migration, /BEFORE INSERT OR UPDATE OF/);
assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE)\b/im);
assert.match(reconcileAudit, /nullShadowRows/);
assert.match(reconcileAudit, /decimal-shadow-v1\.json/);
assert.match(reconcileAudit, /DECIMAL_SHADOW_AUDIT_LABEL/);
assert.match(reconcileAudit, /mismatchRows/);
assert.match(reconcileAudit, /legacyRoundedSum/);
assert.match(reconcileAudit, /shadowSum/);
assert.match(writePathAudit, /mode: 'forced-rollback'/);
assert.match(writePathAudit, /shadowColumnsOmittedFromInsert/);
assert.match(writePathAudit, /corruptedShadowThenLegacyWrite/);
assert.match(writePathAudit, /DECIMAL_SHADOW_AUDIT_ROLLBACK/);
assert.match(releaseGate, /decimal-shadow-contract/);
assert.match(releaseGate, /decimal-shadow-reconcile/);
assert.match(releaseGate, /decimal-shadow-write-path/);
assert.equal((releaseGate.match(/decimal-shadow-reconcile-audit-v1\.cjs/g) || []).length, 2);
assert.match(enterpriseVerdict, /decimal-shadow-reconcile-v1-sqlite-source\.json/);
assert.match(enterpriseVerdict, /decimal-shadow-reconcile-v1-postgres-import\.json/);
assert.match(enterpriseVerdict, /decimal-shadow-reconcile-v1-sqlite-rollback\.json/);
assert.match(enterpriseVerdict, /decimal-shadow-contract-version/);
assert.match(
  enterpriseReleaseWorkflow,
  /DATABASE_URL="\$sqlite_url" AUDIT_DATABASE_URL="\$sqlite_url" AUDIT_PRISMA_PROVIDER=sqlite DECIMAL_SHADOW_AUDIT_LABEL=sqlite-source/,
);
assert.match(
  enterpriseReleaseWorkflow,
  /DATABASE_URL="\$ENTERPRISE_SQLITE_URL" AUDIT_DATABASE_URL="\$ENTERPRISE_SQLITE_URL" AUDIT_PRISMA_PROVIDER=sqlite DECIMAL_SHADOW_AUDIT_LABEL=sqlite-rollback/,
);
assert.match(
  enterpriseCloudWorkflow,
  /DATABASE_URL="\$\{sqlite_url\}" AUDIT_DATABASE_URL="\$\{sqlite_url\}" AUDIT_PRISMA_PROVIDER=sqlite DECIMAL_SHADOW_AUDIT_LABEL=cloud-sqlite-rollback/,
);
assert.match(orderItemNormalization, /multiplyMoney\(quantity, unitPrice\)/);
assert.match(orderItemNormalization, /totalAmount = addMoney\(totalAmount, totalPrice\)/);
assert.match(orderImportService, /multiplyMoney\(quantity, unitPrice\)/);
assert.match(orderImportService, /totalAmount = addMoney\(totalAmount, totalPrice\)/);
assert.match(orderUpdateService, /calculateOrderFinalAmount/);
assert.match(orderUpdateService, /calculateOrderOutstanding/);
assert.match(orderController, /calculateOrderFinalAmount/);
assert.doesNotMatch(orderItemNormalization, /quantity\s*\*\s*unitPrice|totalAmount\s*\+=/);
assert.doesNotMatch(orderImportService, /quantity\s*\*\s*unitPrice|totalAmount\s*\+=/);

console.log('Decimal Shadow Contract Audit: PASS');
console.log('- 7 money and 2 exchange-rate shadow fields have additive SQLite/PostgreSQL migration contracts.');
console.log('- Backfill, write synchronization, precision metadata, provider-isolated reconciliation, and non-cutover claims are gated.');
console.log('- Sales order create, import, and edit paths share decimal line, discount, and outstanding calculations.');
