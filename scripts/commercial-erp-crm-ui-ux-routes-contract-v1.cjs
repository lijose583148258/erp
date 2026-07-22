const assert = require('node:assert/strict');
const routeModule = require('./audit-routes/commercial-erp-crm-ui-ux-routes.cjs');

const routes = Array.isArray(routeModule) ? routeModule : routeModule.routes;
const criteria = routeModule.productReadinessCriteria;
const config = routeModule.commercialAuditConfig;

assert.equal(routes.length, 45, '15 modules x 3 viewports must stay covered');
assert.equal(new Set(routes.map((route) => route.id)).size, routes.length, 'route ids must stay unique');
assert.deepEqual(config.viewports, ['desktop', 'mobile-390', 'mobile-375']);
assert.equal(criteria.length, 33, 'commercial readiness criterion count drifted');
assert.equal(new Set(criteria.map((criterion) => criterion.id)).size, criteria.length, 'criterion ids must stay unique');
assert.deepEqual(
  criteria.find((criterion) => criterion.id === 'DASH-01').appliesTo.viewports,
  config.viewports,
  'criteria factory must use the route viewport source of truth',
);
for (const route of routes) {
  assert.ok(route.commercial?.criteriaIds?.length, `route ${route.id} is missing criteria`);
  assert.ok(route.commercial?.evidenceRequired?.length, `route ${route.id} is missing evidence requirements`);
}

console.log('Commercial ERP/CRM Route Contract: PASS');
console.log('- route matrix, criterion catalog, applicability, and evidence mapping preserved');
