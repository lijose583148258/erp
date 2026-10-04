const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { productionDispositionProbe, assertProductionDispositionCostReconciliation } = require('./lib/enterprise-round2-production-disposition.cjs');

test('production disposition probe remains loadable without a runtime', () => {
  assert.equal(typeof productionDispositionProbe, 'function');
  assert.equal(typeof assertProductionDispositionCostReconciliation, 'function');
});

const evidence = () => ({ case: {
  before: { batch: { stockQuantity: 10 }, stock: { quantity: 10 }, costs: [{ id: 1, quantityBefore: 0, quantityDelta: 10, quantityAfter: 10, costBefore: 0, costAmountDelta: 100, costAfter: 100 }] },
  afterScrap: { batch: { stockQuantity: 7 }, stock: { quantity: 7 }, costs: [
    { id: 1, quantityBefore: 0, quantityDelta: 10, quantityAfter: 10, costBefore: 0, costAmountDelta: 100, costAfter: 100 },
    { id: 2, quantityBefore: 10, quantityDelta: -3, quantityAfter: 7, costBefore: 100, costAmountDelta: -30, costAfter: 70 },
  ], disposition: { id: 2, costAmount: 30 } },
  afterScrapReplay: { batch: { stockQuantity: 7 }, stock: { quantity: 7 }, costs: [
    { id: 1, quantityBefore: 0, quantityDelta: 10, quantityAfter: 10, costBefore: 0, costAmountDelta: 100, costAfter: 100 },
    { id: 2, quantityBefore: 10, quantityDelta: -3, quantityAfter: 7, costBefore: 100, costAmountDelta: -30, costAfter: 70 },
  ], disposition: { id: 2, costAmount: 30 } },
  afterReworkSnapshot: { source: { reworkedQuantity: 2, reworkedCostAmount: 20 }, reworkBatch: { stockQuantity: 2, qualityStatus: 'quarantined' }, reworkStock: { quantity: 2 }, reworkCosts: [{ id: 3, quantityBefore: 0, quantityDelta: 2, quantityAfter: 2, costBefore: 0, costAmountDelta: 20, costAfter: 20 }], audits: [{ action: 'POST_PRODUCTION_SCRAP_DISPOSITION' }, { action: 'POST_PRODUCTION_REWORK_RETURN' }], entries: [{ sourceType: 'production_scrap' }, { sourceType: 'production_rework_return' }] },
  afterReworkReplay: { source: { reworkedQuantity: 2, reworkedCostAmount: 20 }, reworkBatch: { stockQuantity: 2, qualityStatus: 'quarantined' }, reworkStock: { quantity: 2 }, reworkCosts: [{ id: 3, quantityBefore: 0, quantityDelta: 2, quantityAfter: 2, costBefore: 0, costAmountDelta: 20, costAfter: 20 }], audits: [{ action: 'POST_PRODUCTION_SCRAP_DISPOSITION' }, { action: 'POST_PRODUCTION_REWORK_RETURN' }], entries: [{ sourceType: 'production_scrap' }, { sourceType: 'production_rework_return' }] },
  afterRework: {
    source: { reworkedQuantity: 2, reworkedCostAmount: 20 }, reworkDisposition: { id: 3 }, reworkBatch: { stockQuantity: 2, qualityStatus: 'quarantined' }, reworkStock: { quantity: 2 },
    reworkCosts: [{ id: 3, quantityBefore: 0, quantityDelta: 2, quantityAfter: 2, costBefore: 0, costAmountDelta: 20, costAfter: 20 }],
    audits: [{ action: 'POST_PRODUCTION_SCRAP_DISPOSITION' }, { action: 'POST_PRODUCTION_REWORK_RETURN' }], entries: [{ sourceType: 'production_scrap' }, { sourceType: 'production_rework_return' }],
    inventoryCost: 90, inventoryQuantity: 9, netLossCost: 10, netLossQuantity: 1, quarantinedIssue: { status: 409 },
    readbacks: [{ dispositions: [{ id: 2 }, { id: 3 }], originalBatch: { stockQuantity: 7 }, originalStock: { quantity: 7 }, reworkBatch: { stockQuantity: 2, qualityStatus: 'quarantined' }, reworkStock: { quantity: 2 } }, { dispositions: [{ id: 2 }, { id: 3 }], originalBatch: { stockQuantity: 7 }, originalStock: { quantity: 7 }, reworkBatch: { stockQuantity: 2, qualityStatus: 'quarantined' }, reworkStock: { quantity: 2 } }],
  },
} });

test('loss/rework verifier rejects false green conservation evidence', () => {
  assert.doesNotThrow(() => assertProductionDispositionCostReconciliation(evidence()));
  for (const [name, mutate] of [
    ['stock drift', value => { value.case.afterScrap.stock.quantity = 8; }],
    ['released rework', value => { value.case.afterRework.reworkBatch.qualityStatus = 'released'; }],
    ['cost drift', value => { value.case.afterRework.inventoryCost = 100; }],
    ['missing audit', value => { value.case.afterRework.audits.pop(); }],
    ['QC bypass', value => { value.case.afterRework.quarantinedIssue.status = 200; }],
    ['missing readback', value => { value.case.afterRework.readbacks.pop(); }],
  ]) {
    const broken = evidence(); mutate(broken);
    assert.throws(() => assertProductionDispositionCostReconciliation(broken), name);
  }
});

test('production disposition changes are cumulative cloud Round2 inputs', () => {
  const root = path.join(__dirname, '..');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/enterprise-cloud-sandbox.yml'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, 'enterprise-round2-audit-v1.cjs'), 'utf8');
  for (const item of ['loss-return-scrap-rework', 'production-cost-reconciliation']) assert(source.includes(`'${item}'`));
  for (const file of ['scripts/lib/enterprise-round2-production-disposition.cjs', 'scripts/lib/enterprise-round2-production-disposition-browser.cjs', 'backend/src/services/production-disposition.service.ts', 'backend/src/database/runtime-schema-production-disposition-repair.ts']) assert(workflow.includes(`'${file}'`), file);
});
