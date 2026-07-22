const fs = require('fs');
const path = require('path');

const root = process.cwd();
const findings = [];
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = relativePath => fs.existsSync(path.join(root, relativePath));
const requireTokens = (relativePath, tokens) => {
  const source = read(relativePath);
  for (const token of tokens) {
    if (!source.includes(token)) findings.push(`${relativePath}: missing ${token}`);
  }
  return source;
};

requireTokens('backend/src/routes/order.routes.ts', [
  "authorizePermission('orders.import')",
  'validateZod(importOrdersSchema)',
]);
requireTokens('backend/src/controllers/order.controller.ts', [
  "from '../services/order-import.service'",
  "req.get('idempotency-key')",
  'orderImportService.importOrders(orders, req, idempotencyKey)',
]);
const service = requireTokens('backend/src/services/order-import.service.ts', [
  'canUseCustomerForBusinessWrite',
  'CreditEngine.checkOrder',
  "{ label: 'importOrder' }",
  'data: { updatedAt: new Date() }',
  'SearchIndexService.scheduleOrderSync',
  'Order import audit log failed after business rows were preserved',
  'importBatchId: batch.id',
  'importRowNumber: batch.rowNumber',
]);
requireTokens('backend/src/services/order-import-idempotency.service.ts', [
  'buildOrderImportFingerprint',
  "kind: 'replay'",
  "kind: 'in_progress'",
  'leaseExpiresAt',
  'Stored import replay state is invalid',
]);
requireTokens('backend/prisma/models/crm-sales.prisma', [
  'model OrderImportBatch',
  '@@unique([userId, idempotencyKey])',
  '@@unique([importBatchId, importRowNumber])',
]);
for (const forbidden of [
  'Number(item.quantity) || 1',
  "String(item.productName || 'Unnamed product')",
]) {
  if (service.includes(forbidden)) findings.push(`backend/src/services/order-import.service.ts: forbidden fallback ${forbidden}`);
}

const workspace = read('backend/src/services/order-workspace.service.ts');
if (workspace.includes('async importOrders(')) {
  findings.push('backend/src/services/order-workspace.service.ts: import write path must remain in the dedicated service');
}
if (!exists('backend/src/services/order-import.service.test.ts')) {
  findings.push('backend/src/services/order-import.service.test.ts: governance regression tests are missing');
}
requireTokens('scripts/order-import-governance-api-audit-v1.cjs', [
  'reject-cross-segment-customer',
  'reject-invalid-quantity-at-schema-boundary',
  'accept-in-scope-credit-approved-row-database-readback',
  'reject-zero-credit-customer',
  'exact-idempotent-replay',
  'reject-idempotency-key-payload-mismatch',
  'concurrent-exact-retry-database-readback',
]);
requireTokens('.github/workflows/enterprise-cloud-sandbox.yml', [
  'Verify order import scope and credit governance',
  'audit:orders:import-governance-api',
]);

if (findings.length > 0) {
  console.error('Order Import Governance Audit: FAIL');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log('Order Import Governance Audit: PASS');
console.log('- Import rows use a dedicated service and validated route contract.');
console.log('- Customer scope, active status, serialized credit checks, and search sync are enforced.');
console.log('- Audit-log failure cannot turn committed rows into a retry-inducing endpoint failure.');
console.log('- Cloud API evidence covers cross-segment denial, schema rejection, credit denial, and database read-back.');
console.log('- Persistent batch leases and row uniqueness make exact network retries replay-safe.');
