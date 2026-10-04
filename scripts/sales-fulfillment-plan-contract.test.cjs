const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { verifySalesPlanProof } = require('./lib/sales-fulfillment-plan-proof.cjs');
const { salesPlanFixture } = require('./lib/sales-fulfillment-plan-test-fixture.cjs');
const read = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
test('independent supply-plan verifier accepts its synthetic contract fixture', () => { verifySalesPlanProof(salesPlanFixture()); });
for (const [name, mutate] of [
  ['flags without records', r => { r.finalState = {}; }],
  ['loading overlay hiding browser', r => { r.screenshots[0].loadingHidden = false; }],
  ['self approval', r => { r.finalState.plans[0].approvedBy = 1; }],
  ['no source receipt', r => { const s = JSON.parse(r.finalState.plans[0].closeoutSnapshot); s.purchaseReceiptIds = []; r.finalState.plans[0].closeoutSnapshot = JSON.stringify(s); }],
  ['no customer acceptance', r => { r.finalReadbacks[0].fulfillment.fullyDelivered = false; }],
  ['one stale instance', r => { r.finalReadbacks[1].plans[0].status = 'approved'; }],
  ['duplicate audit', r => { r.finalState.audits.push(r.finalState.audits[0]); }],
  ['negative physical inventory', r => { r.finalState.business.balances[0].quantity = -1; }],
  ['plan added money', r => { r.finalState.business.order.paidAmount = 1000; }],
  ['cost drift', r => { r.finalState.business.ledger[1].costAmountDelta = -900; }],
  ['UI-only creation', r => { r.browserCreate.httpStatus = 0; }],
  ['both competing promises approved', r => { r.concurrency.results[1].status = 200; }],
  ['rejected request mutated data', r => { r.rejections[0].unchanged = false; }],
]) test(`supply-plan verifier rejects ${name}`, () => { const r = salesPlanFixture(); mutate(r); assert.throws(() => verifySalesPlanProof(r)); });
test('cloud and local cumulative runners never truncate this independent package', () => {
  const workflow = read('.github/workflows/enterprise-cloud-sandbox.yml');
  assert.match(workflow, /id: sales_fulfillment_plan\s+if:.*always\(\).*\s+continue-on-error: true/);
  assert.match(read('scripts/enterprise-round2-local-v1.cjs'), /\['sales-plan', 'scripts\/sales-fulfillment-plan-audit-v1.cjs'/);
  assert.match(read('scripts/lib/enterprise-regression.cjs'), /verifySalesPlanProof\(r\)/);
});
test('routes are authenticated, permission-bound and mounted in the active order router', () => {
  const routes = read('backend/src/routes/order.routes.ts');
  assert(routes.indexOf('router.use(authenticate)') < routes.indexOf("router.use('/:id/fulfillment-plans'"));
  const planRoutes = read('backend/src/routes/sales-fulfillment.routes.ts');
  for (const p of ['orders.read', 'orders.update', 'orders.status.manage']) assert(planRoutes.includes(`authorizePermission('${p}')`));
  assert(read('pages/SalesOrders.tsx').includes('<SalesFulfillmentPlanModal'));
});
