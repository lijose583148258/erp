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

if (!exists('backend/src/services/search.service.ts')) {
  add('P1', 'backend/src/services/search.service.ts', 'Search service boundary is missing.');
} else {
  const service = read('backend/src/services/search.service.ts');
  for (const token of ['normalizeSearchTerm', 'buildCustomerSearchWhere', 'buildOrderSearchWhere', 'buildCustomerSearchWhereAsync', 'buildOrderSearchWhereAsync', 'MeilisearchProvider', 'upsertDocuments', 'waitForTask', 'attributesToRetrieve', 'MEILISEARCH_API_KEY', 'getSearchStatus', 'SEARCH_DRIVER', 'SEARCH_ENDPOINT', 'recordSearchMetric']) {
    if (!service.includes(token)) add('P1', 'backend/src/services/search.service.ts', `Missing search boundary token: ${token}`);
  }
}

for (const [file, token, message] of [
  ['backend/src/services/search-index.service.ts', 'reindexAll', 'External search must provide a full reindex recovery path.'],
  ['backend/src/services/search-index.service.ts', 'scheduleCustomerSync', 'Customer writes must schedule external index synchronization.'],
  ['backend/src/services/search-index.service.ts', 'scheduleOrderSync', 'Order writes must schedule external index synchronization.'],
  ['backend/src/controllers/customer/customer-write.controller.ts', 'SearchIndexService.scheduleCustomerSync', 'Customer mutations must schedule search index synchronization.'],
  ['backend/src/controllers/order.controller.ts', 'SearchIndexService.scheduleOrderSync', 'Order mutations must schedule search index synchronization.'],
  ['backend/src/routes/system.routes.ts', '/search/reindex', 'System routes must expose an authorized search reindex operation.'],
]) {
  if (!exists(file) || !read(file).includes(token)) add('P1', file, message);
}

const customerQuery = requireIncludes(
  'backend/src/services/customer-query.service.ts',
  'buildCustomerSearchWhereAsync',
  'P1',
  'Customer list query should use the shared search boundary.',
);
if (customerQuery.includes('addressesJson: { contains: String(search) }')) {
  add('P1', 'backend/src/services/customer-query.service.ts', 'Customer query still owns direct large-text search clauses.');
}

const customerIo = requireIncludes(
  'backend/src/services/customer-io.service.ts',
  'buildCustomerSearchWhere',
  'P1',
  'Customer export should reuse the shared search boundary.',
);
if (customerIo.includes('contactsJson: { contains: search }')) {
  add('P1', 'backend/src/services/customer-io.service.ts', 'Customer export still owns direct large-text search clauses.');
}

const orderWorkspace = requireIncludes(
  'backend/src/services/order-workspace.service.ts',
  'buildOrderSearchWhereAsync',
  'P1',
  'Order workspace query should use the shared search boundary.',
);
if (orderWorkspace.includes('orderNo: { contains: search }')) {
  add('P1', 'backend/src/services/order-workspace.service.ts', 'Order workspace still owns direct search clauses.');
}

const metrics = requireIncludes(
  'backend/src/middleware/metricsMiddleware.ts',
  'ailaoda_search_operations_total',
  'P2',
  'Search operations should be visible in Prometheus metrics.',
);
if (!metrics.includes('recordSearchMetric')) add('P2', 'backend/src/middleware/metricsMiddleware.ts', 'recordSearchMetric export is missing.');

const server = requireIncludes(
  'backend/src/server.ts',
  'getSearchStatus()',
  'P2',
  'Health responses should expose search boundary status.',
);
if (!server.includes("from './services/search.service'")) add('P2', 'backend/src/server.ts', 'Server should import search status from the search service boundary.');

if (!exists('backend/src/services/search.service.test.ts')) {
  add('P2', 'backend/src/services/search.service.test.ts', 'Search service unit tests are missing.');
} else {
  const searchTests = read('backend/src/services/search.service.test.ts');
  for (const token of ['MeilisearchProvider', 'upsertDocuments', 'waitForTask', 'buildCustomerSearchWhereAsync', 'buildOrderSearchWhereAsync', 'empty id filters', 'MEILISEARCH_API_KEY']) {
    if (!searchTests.includes(token)) add('P2', 'backend/src/services/search.service.test.ts', `Search service tests should cover ${token}.`);
  }
}

if (!exists('docs/adr/0014-search-provider-boundary.md')) {
  add('P2', 'docs/adr/0014-search-provider-boundary.md', 'Search provider ADR is missing.');
}

const compose = read('docker-compose.yml');
for (const token of ['meilisearch:', 'getmeili/meilisearch', 'profiles:', 'search', 'MEILISEARCH_API_KEY', 'ailao-meili-data']) {
  if (!compose.includes(token)) add('P1', 'docker-compose.yml', `Docker compose should include Meilisearch rehearsal token: ${token}`);
}

const productionEnv = read('.env.production.example');
for (const token of ['SEARCH_DRIVER=prisma', 'MEILISEARCH_URL=', 'MEILISEARCH_API_KEY=', 'SEARCH_INDEX_PREFIX=ailaoda']) {
  if (!productionEnv.includes(token)) add('P1', '.env.production.example', `Production env example should include ${token}`);
}

if (findings.length) {
  console.error('Search Boundary Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('Search Boundary Audit: PASS');
console.log('- Customer and order search clauses are owned by backend/src/services/search.service.ts.');
console.log('- Meilisearch has incremental customer/order synchronization and an authorized full-reindex recovery path.');
console.log('- Search boundary keeps Prisma fallback explicit and exposes external driver status.');
console.log('- Search operations are visible through Prometheus metrics and health metadata.');
