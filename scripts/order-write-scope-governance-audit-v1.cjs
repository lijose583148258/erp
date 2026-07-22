const fs = require('fs');
const path = require('path');

const root = process.cwd();
const findings = [];
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const requireTokens = (relativePath, tokens) => {
  const source = read(relativePath);
  for (const token of tokens) {
    if (!source.includes(token)) findings.push(`${relativePath}: missing ${token}`);
  }
  return source;
};

const access = requireTokens('backend/src/utils/recordAccess.ts', [
  'export const canUseOrderForBusinessWrite',
  'export const canUseOrderForCollectionWrite',
  "req.user.role !== 'manager' && hasDataScope(req, 'finance_visible')",
]);
const businessWriteBody = access.split('export const canUseOrderForBusinessWrite')[1]
  ?.split('export const canUseOrderForCollectionWrite')[0] || '';
if (businessWriteBody.includes('finance_visible')) {
  findings.push('backend/src/utils/recordAccess.ts: core order writes still inherit finance_visible');
}

for (const relativePath of [
  'backend/src/controllers/order-payment.controller.ts',
  'backend/src/controllers/collection/collection-controller.helpers.ts',
  'backend/src/controllers/collection/collection-action.controller.ts',
  'backend/src/controllers/collection/collection-verification-hold.controller.ts',
]) {
  requireTokens(relativePath, ['canUseOrderForCollectionWrite']);
}
requireTokens('backend/src/controllers/order.controller.ts', ['canUseOrderForBusinessWrite']);
requireTokens('backend/src/services/order-import.service.ts', ['canUseCustomerForBusinessWrite']);
requireTokens('backend/src/utils/recordAccess.test.ts', [
  'segmented manager',
  'custom finance operators',
  'explicit all-scope access',
]);
requireTokens('scripts/order-write-scope-governance-api-audit-v1.cjs', [
  'reject-cross-segment-order-update',
  'reject-cross-segment-order-status',
  'reject-cross-segment-payment',
  'allow-finance-cross-segment-payment',
]);
requireTokens('.github/workflows/enterprise-cloud-sandbox.yml', [
  'Verify core order and finance collection write boundaries',
  'audit:orders:write-scope-api',
]);

if (findings.length) {
  console.error('Order Write Scope Governance Audit: FAIL');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log('Order Write Scope Governance Audit: PASS');
console.log('- Core order lifecycle writes no longer inherit finance visibility.');
console.log('- Finance collection writes retain their explicit wider boundary.');
console.log('- Segmented manager and finance-operator behavior has unit and cloud API evidence.');
