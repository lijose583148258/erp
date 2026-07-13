const fs = require('fs');
const path = require('path');

const root = process.cwd();
const findings = [];
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const add = (severity, file, message) => findings.push({ severity, file, message });
const requireIncludes = (file, text, severity, message) => {
  const content = read(file);
  if (!content.includes(text)) add(severity, file, message);
  return content;
};

const rootFilesToScan = ['services', 'pages', 'components', 'backend/src'];
const bannedPageSizePattern = /pageSize=1000|pageSize:\s*1000|pageSize:[^\n]+max\(1000\)|MAX_CUSTOMER_PAGE_SIZE\s*=\s*1000/;

const scanDir = (relativeDir) => {
  for (const entry of fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'output') continue;
    const relativePath = path.join(relativeDir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      scanDir(relativePath);
      continue;
    }
    if (!/\.(ts|tsx|js|cjs)$/.test(entry.name)) continue;
    const content = read(relativePath);
    if (bannedPageSizePattern.test(content)) {
      add('P0', relativePath, 'High-frequency customer/order list code must not request or allow pageSize=1000.');
    }
  }
};
rootFilesToScan.forEach(scanDir);

const customerTypes = requireIncludes(
  'backend/src/controllers/customer/customer.types.ts',
  'MAX_CUSTOMER_PAGE_SIZE = 100',
  'P0',
  'Customer list backend max page size must be 100.'
);
if (!customerTypes.includes('DEFAULT_CUSTOMER_PAGE_SIZE = 30')) {
  add('P1', 'backend/src/controllers/customer/customer.types.ts', 'Customer list default page size should be explicit.');
}

requireIncludes(
  'backend/src/validators/core.ts',
  'pageSize: z.coerce.number().int().positive().max(100).optional()',
  'P0',
  'Customer query schema must reject pageSize above 100.'
);
requireIncludes(
  'backend/src/validators/orders.ts',
  'pageSize: z.coerce.number().int().positive().max(100).optional()',
  'P0',
  'Order query schema must reject pageSize above 100.'
);

const orderWorkspace = requireIncludes(
  'backend/src/services/order-workspace.service.ts',
  'ORDER_SORT_KEY_MAP',
  'P1',
  'Order list sorting should be whitelisted.'
);
if (!orderWorkspace.includes('resolvedPage') || !orderWorkspace.includes('MAX_PAGE_SIZE = 100')) {
  add('P1', 'backend/src/services/order-workspace.service.ts', 'Order list should normalize page and clamp pageSize to 100.');
}

const customerService = requireIncludes(
  'services/customer.service.ts',
  'async getPage',
  'P0',
  'Frontend customer service must expose paged list contract.'
);
if (!customerService.includes('this.getPage({ page: 1, pageSize: 100 }')) {
  add('P1', 'services/customer.service.ts', 'Legacy customer getAll should be a limited first-page snapshot.');
}

const orderService = requireIncludes(
  'services/order.service.ts',
  'async getPage',
  'P0',
  'Frontend order service must expose paged list contract.'
);
if (!orderService.includes('export type OrderPage') || !orderService.includes('response.meta')) {
  add('P1', 'services/order.service.ts', 'Order getPage should preserve pagination metadata.');
}
if (!orderService.includes('this.getPage({ page: 1, pageSize: 100 }')) {
  add('P1', 'services/order.service.ts', 'Legacy order getAll should be a limited first-page snapshot.');
}

const salesWorkspace = requireIncludes(
  'pages/sales-orders/useSalesOrderWorkspaceData.ts',
  'orderPageMeta',
  'P1',
  'Sales order workspace should preserve server pagination metadata.'
);
if (!salesWorkspace.includes('orderService.getPage({ page: 1, pageSize: 30 })')) {
  add('P1', 'pages/sales-orders/useSalesOrderWorkspaceData.ts', 'Sales order workspace should load an explicit server page, not a hidden getAll snapshot.');
}

requireIncludes(
  'pages/SalesOrders.tsx',
  'Showing server page',
  'P2',
  'Sales order table should disclose loaded server-page scope.'
);

if (findings.length) {
  console.error('High Frequency List Query Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('High Frequency List Query Audit: PASS');
console.log('- Customer/order list pageSize is capped at 100.');
console.log('- Frontend services expose explicit paged contracts.');
console.log('- Legacy getAll calls are limited first-page snapshots.');
console.log('- Sales order workspace preserves server pagination metadata.');
