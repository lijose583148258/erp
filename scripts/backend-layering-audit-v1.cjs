const fs = require('fs');
const path = require('path');

const root = process.cwd();
const findings = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, '');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function add(severity, file, message) {
  findings.push({ severity, file, message });
}

function requireIncludes(file, text, severity, message) {
  const content = read(file);
  if (!content.includes(text)) add(severity, file, message);
  return content;
}

if (!exists('backend/src/services/customer-query.service.ts')) {
  add('P1', 'backend/src/services/customer-query.service.ts', 'Customer query service boundary is missing.');
} else {
  const service = read('backend/src/services/customer-query.service.ts');
  for (const token of ['CustomerQueryService', 'listCustomers', 'getCustomerStats', 'buildCustomerWhere', 'buildCustomerSearchWhere', 'loadOrderStats']) {
    if (!service.includes(token)) add('P1', 'backend/src/services/customer-query.service.ts', `Missing service token: ${token}`);
  }
}

const controller = requireIncludes(
  'backend/src/controllers/customer/customer-query.controller.ts',
  'CustomerQueryService.listCustomers',
  'P1',
  'Customer query controller should delegate list reads to CustomerQueryService.',
);
if (!controller.includes('CustomerQueryService.getCustomerStats')) {
  add('P1', 'backend/src/controllers/customer/customer-query.controller.ts', 'Customer stats controller should delegate stats reads to CustomerQueryService.');
}
if (controller.includes("from '../../config/database'") || controller.includes('prisma.customer.findMany')) {
  add('P1', 'backend/src/controllers/customer/customer-query.controller.ts', 'Customer query controller should not directly use Prisma for list/stat reads.');
}

if (!exists('backend/src/services/customer-query.service.test.ts')) {
  add('P2', 'backend/src/services/customer-query.service.test.ts', 'Customer query service helper tests are missing.');
}

if (!exists('docs/adr/0016-backend-read-service-layering.md')) {
  add('P2', 'docs/adr/0016-backend-read-service-layering.md', 'Backend service layering ADR is missing.');
}

const commercialAudit = requireIncludes(
  'scripts/commercial-erp-crm-ui-ux-audit-v1.cjs',
  'backend layering',
  'P2',
  'Commercial audit should mention backend layering evidence.',
);
if (!commercialAudit.includes('audit:backend:layering')) {
  add('P2', 'scripts/commercial-erp-crm-ui-ux-audit-v1.cjs', 'Commercial audit should reference the backend layering audit command.');
}

if (findings.length) {
  console.error('Backend Layering Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('Backend Layering Audit: PASS');
console.log('- Customer list/stat read logic is owned by CustomerQueryService.');
console.log('- Customer query controller no longer directly owns Prisma list/stat reads.');
console.log('- Query helper tests and ADR evidence are present.');
