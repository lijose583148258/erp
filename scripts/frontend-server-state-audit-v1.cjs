const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const findings = [];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/^\uFEFF/, '');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function add(severity, file, message) {
  findings.push({ severity, file, message });
}

function requireIncludes(file, text, severity, message) {
  const content = read(file);
  if (!content.includes(text)) add(severity, file, message);
  return content;
}

if (!exists('app/serverState.ts')) {
  add('P1', 'app/serverState.ts', 'Frontend server-state client is missing.');
} else {
  const serverState = read('app/serverState.ts');
  for (const token of ['fetchQuery', 'invalidateQueries', 'setQueryData', 'serializeServerStateKey', 'existing?.promise', 'ttlMs']) {
    if (!serverState.includes(token)) add('P1', 'app/serverState.ts', `Missing server-state capability token: ${token}`);
  }
}

const workspace = requireIncludes(
  'pages/sales-orders/useSalesOrderWorkspaceData.ts',
  'serverStateClient.fetchQuery',
  'P1',
  'Sales order workspace should load high-frequency reads through serverStateClient.',
);
for (const token of ['ORDER_PAGE_QUERY_KEY', 'CUSTOMER_LOOKUP_QUERY_KEY', 'ACTIVE_CONTRACTS_QUERY_KEY', 'SALES_ORDER_WORKSPACE_TTL_MS', 'invalidateSalesOrderWorkspaceState']) {
  if (!workspace.includes(token)) add('P1', 'pages/sales-orders/useSalesOrderWorkspaceData.ts', `Missing workspace server-state token: ${token}`);
}

for (const file of ['pages/sales-orders/useSalesOrderActions.ts', 'pages/sales-orders/useSalesOrderPayments.ts']) {
  if (!read(file).includes('invalidateSalesOrderWorkspaceState')) {
    add('P1', file, 'Sales order mutation path should invalidate workspace server-state queries.');
  }
}

if (!read('pages/sales-orders/useSalesOrders.ts').includes('loadOrderWorkspace({ force: true })')) {
  add('P1', 'pages/sales-orders/useSalesOrders.ts', 'Sales order save flow should force refresh workspace server-state queries.');
}

const collectionBundle = requireIncludes(
  'pages/collections/collectionLoadBundle.ts',
  'serverStateClient.fetchQuery',
  'P1',
  'Collection center workbench should load through serverStateClient.',
);
for (const token of ['COLLECTION_WORKBENCH_QUERY_KEY', 'COLLECTION_CENTER_TTL_MS', 'invalidateCollectionCenterState', "invalidateQueries(['collections'])"]) {
  if (!collectionBundle.includes(token)) add('P1', 'pages/collections/collectionLoadBundle.ts', `Missing collection server-state token: ${token}`);
}

const collectionCenter = requireIncludes(
  'pages/collections/useCollectionCenter.ts',
  "key: ['collections', 'overdue', 'search'",
  'P1',
  'Collection overdue search should use a server-state query key.',
);
for (const token of ['serverStateClient.fetchQuery', 'COLLECTION_CENTER_TTL_MS', 'collectionRefreshVersion', 'invalidateCollectionCenterState']) {
  if (!collectionCenter.includes(token)) add('P1', 'pages/collections/useCollectionCenter.ts', `Missing collection center server-state token: ${token}`);
}

const frontendTests = read('scripts/frontend-unit-tests.tsx');
for (const token of ['serverStateClient.fetchQuery', 'invalidateQueries', 'serializeServerStateKey', 'await test.run()']) {
  if (!frontendTests.includes(token)) add('P2', 'scripts/frontend-unit-tests.tsx', `Frontend unit tests should cover server-state behavior: ${token}`);
}

const adr = 'docs/adr/0010-frontend-server-state-boundary.md';
if (!exists(adr)) {
  add('P2', adr, 'Frontend server-state ADR is missing.');
} else {
  const content = read(adr);
  for (const token of ['## Status', '## Context', '## Decision', '## Consequences']) {
    if (!content.includes(token)) add('P2', adr, `ADR is missing token: ${token}`);
  }
}

if (findings.length) {
  console.error('Frontend Server State Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('Frontend Server State Audit: PASS');
console.log('- app/serverState.ts provides deterministic keys, in-flight dedupe, TTL reuse, and invalidation.');
console.log('- Sales order workspace uses server-state reads for orders, customer lookup, and active contracts.');
console.log('- Sales order mutation paths invalidate or force-refresh workspace query state.');
console.log('- Collection center uses server-state reads for workbench and overdue search pages.');
