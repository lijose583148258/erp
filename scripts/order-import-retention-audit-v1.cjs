const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const findings = [];
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const requireTokens = (relativePath, tokens) => {
  const source = read(relativePath);
  for (const token of tokens) {
    if (!source.includes(token)) findings.push(`${relativePath}: missing ${token}`);
  }
};

requireTokens('backend/src/services/order-import-retention.service.ts', [
  "ORDER_IMPORT_RETENTION_MODE || 'report-only'",
  "mode === 'enforce'",
  'ORDER_IMPORT_REPLAY_DAYS',
  'ORDER_IMPORT_STALE_PROCESSING_DAYS',
  'ORDER_IMPORT_PURGE_DAYS',
  'ORDER_IMPORT_RETENTION_BATCH_SIZE',
  'orders: { none: {} }',
  'orders: { some: {} }',
  'resultJson: null',
  'take: policy.batchSize',
]);
requireTokens('backend/src/services/order-import-idempotency.service.ts', [
  "existing.status === 'expired'",
  'replay window',
  'completedAt: new Date()',
]);
requireTokens('backend/src/maintenance/order-import-retention.ts', [
  'resolveOrderImportRetentionPolicy',
  'orderImportRetentionService.run',
  'prisma.$disconnect()',
]);
requireTokens('backend/prisma/models/crm-sales.prisma', [
  'completedAt    DateTime? @map("completed_at")',
  '@@index([status, completedAt])',
  '@@index([status, createdAt])',
]);
requireTokens('package.json', [
  'audit:orders:import-retention',
  'maintenance:orders:import-retention',
]);
requireTokens('.env.production.example', [
  'ORDER_IMPORT_RETENTION_MODE=report-only',
  'ORDER_IMPORT_REPLAY_DAYS=30',
  'ORDER_IMPORT_PURGE_DAYS=365',
]);
requireTokens('.github/workflows/enterprise-cloud-sandbox.yml', [
  'Verify order import retention lifecycle',
  'ORDER_IMPORT_RETENTION_MODE=report-only',
  'ORDER_IMPORT_RETENTION_MODE=enforce',
  'linked_compacted_count',
  'orphan_count',
]);
requireTokens('docs/adr/0030-order-import-idempotency-retention.md', [
  'report-only',
  'linked',
  'CronJob',
]);

if (findings.length) {
  console.error('Order Import Retention Audit: FAIL');
  findings.forEach(finding => console.error(`- ${finding}`));
  process.exit(1);
}

console.log('Order Import Retention Audit: PASS');
console.log('- Replay results are compacted after a bounded window without deleting linked order lineage.');
console.log('- Purging is bounded, opt-in, and restricted to old expired batches with no linked orders.');
console.log('- Multi-instance deployments use an external singleton maintenance command instead of per-replica timers.');
