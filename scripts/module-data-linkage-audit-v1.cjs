const fs = require('fs');
const path = require('path');

const root = process.cwd();
const reportPath = path.join(root, 'output/audit/module-data-linkage-audit-v1.json');
const maxAgeHours = Number(process.env.MODULE_LINKAGE_MAX_AGE_HOURS || 24);
const findings = [];
const evidence = [];

const requirements = [
  {
    name: 'sales-order',
    file: 'output/playwright/orders-api-audit-report-v1.json',
    steps: ['login-users', 'create-owned-private-customer', 'verify-sales-cannot-order-public-customer', 'create-order', 'verify-order-readback', 'confirm-order', 'verify-confirmed-status'],
  },
  {
    name: 'procurement-stock-cost',
    file: 'output/playwright/procurement-api-audit-report-v1.json',
    steps: ['login-manager', 'block-invalid-purchase-order-create', 'create-purchase-order', 'approve-purchase-order', 'dispatch-purchase-order', 'receive-purchase-order', 'verify-procurement-receipt-stock', 'verify-procurement-receipt-cost', 'verify-receipt-idempotency', 'verify-concurrent-receive-idempotency', 'verify-concurrent-receive-cost', 'verify-final-status'],
  },
];

for (const requirement of requirements) {
  const absolute = path.join(root, requirement.file);
  try {
    const parsed = JSON.parse(fs.readFileSync(absolute, 'utf8').replace(/^\uFEFF/, ''));
    const finishedAt = new Date(parsed.finishedAt || parsed.startedAt || 0);
    const ageHours = (Date.now() - finishedAt.getTime()) / 3_600_000;
    const passedSteps = new Set((parsed.steps || []).filter(step => step.result === 'passed').map(step => step.step));
    const missingSteps = requirement.steps.filter(step => !passedSteps.has(step));
    if (parsed.status !== 'passed') findings.push({ level: 'P0', evidence: requirement.name, message: `Report status is ${parsed.status || 'missing'}.` });
    if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > maxAgeHours) findings.push({ level: 'P0', evidence: requirement.name, message: `Evidence is stale (${ageHours.toFixed(2)}h; limit ${maxAgeHours}h).` });
    if (!/^http:\/\/127\.0\.0\.1:5006\/$/.test(String(parsed.appUrl || ''))) findings.push({ level: 'P0', evidence: requirement.name, message: 'Evidence did not run against the governed PostgreSQL pilot instance on port 5006.' });
    if (missingSteps.length) findings.push({ level: 'P0', evidence: requirement.name, message: `Missing passed steps: ${missingSteps.join(', ')}` });
    evidence.push({ name: requirement.name, path: requirement.file, status: parsed.status, finishedAt: finishedAt.toISOString(), ageHours: Number(ageHours.toFixed(3)), requiredSteps: requirement.steps.length, missingSteps });
  } catch (error) {
    findings.push({ level: 'P0', evidence: requirement.name, message: `Evidence is missing or invalid JSON: ${String(error.message || error)}` });
  }
}

const report = {
  name: 'Core Module Data Linkage Audit',
  version: '1.0',
  status: findings.length === 0 ? 'passed' : 'failed',
  checkedAt: new Date().toISOString(),
  maxAgeHours,
  invariants: [
    'Module visibility is role governed; API authorization remains authoritative.',
    'A confirmed sales order is read back from the shared business database.',
    'Invalid procurement submissions are rejected before formal lifecycle transitions.',
    'A received purchase order produces one inventory receipt and matching cost-ledger evidence.',
    'Duplicate and concurrent receipt requests do not duplicate stock or cost effects.',
  ],
  evidence,
  findings,
  boundary: 'This gate covers sales-order and procurement-to-stock/cost linkage. It does not claim every ERP module has the same fresh end-to-end proof.',
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Core Module Data Linkage Audit: ${report.status.toUpperCase()}`);
console.log(`Report: ${reportPath}`);
if (findings.length) process.exit(1);
