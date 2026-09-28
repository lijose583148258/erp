const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { unitSafetyProbe, unitSafetyBrowser, assertRejectedUnitCase } = require('./lib/enterprise-round2-unit-safety.cjs');

test('unit probes load without runtime/browser dependencies', () => {
  assert.equal(typeof unitSafetyProbe, 'function'); assert.equal(typeof unitSafetyBrowser, 'function');
});
const valid = () => ({ name: 'wrong unit', code: 'BOM_UNIT_OUTPUT_MISMATCH', response: { status: 409, json: { message: 'BOM_UNIT_OUTPUT_MISMATCH:kg/g' } }, before: { boms: [], audits: [] }, after: { boms: [], audits: [] }, readbacks: [[],[]] });
test('unit rejection requires both instances, no persisted BOM and no creation audit', () => assertRejectedUnitCase(valid()));
for (const [name, corrupt] of [
  ['success response', c => { c.response.status = 201; }],
  ['wrong rejection reason', c => { c.response.json.message = 'permission error'; }],
  ['persisted unsafe recipe', c => { c.after.boms.push({ id: 1 }); }],
  ['spurious audit', c => { c.after.audits.push({ id: 1 }); }],
  ['missing instance', c => { c.readbacks.pop(); }],
  ['stale instance', c => { c.readbacks[1].push({ id: 1 }); }],
]) test(`unit verifier rejects false green: ${name}`, () => { const c = valid(); corrupt(c); assert.throws(() => assertRejectedUnitCase(c)); });

test('unit safety is cumulative BOM coverage, not a false promotion of conversion obligations', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const bom = read('scripts/lib/enterprise-round2-bom-freeze.cjs');
  assert.match(bom, /unitSafetyProbe\(ctx, signal\)/);
  assert.match(bom, /unitSafetyBrowser\(ctx, page, history.unitSafety.browserFixture/);
  const paths = read('.github/workflows/enterprise-cloud-sandbox.yml').split('  pull_request:')[1].split('  push:')[0];
  for (const file of ['scripts/lib/enterprise-round2-unit-safety.cjs', 'backend/src/services/production-unit-safety*.ts', 'backend/src/services/production-query.service.ts', 'pages/production/ProductionBomSection.tsx']) assert(paths.includes(`'${file}'`));
  const baseline = JSON.parse(read('scripts/config/enterprise-regression-baseline-v1.json'));
  assert(!JSON.stringify(baseline).includes('mass-packaging-density-conversion'));
});
