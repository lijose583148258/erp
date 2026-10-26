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

test('unit safety remains cumulative BOM coverage after separately reviewed R2-06 promotion', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const bom = read('scripts/lib/enterprise-round2-bom-freeze.cjs');
  assert.match(bom, /unitSafetyProbe\(ctx, signal\)/);
  assert.match(bom, /unitSafetyBrowser\(ctx, page, history.unitSafety.browserFixture/);
  const baseline = JSON.parse(read('scripts/config/enterprise-regression-baseline-v1.json'));
  assert(baseline.revisions.at(-1).round2Checks.includes('mass-packaging-density-conversion'));
  assert(baseline.revisions.at(-1).round2Checks.includes('conversion-cost-conservation'));
});


test('explicit mass-v1 probes remain source-only loadable and cumulative', () => {
  const { massConversionProbe, massConversionBrowser } = require('./lib/enterprise-round2-mass-conversion.cjs');
  assert.equal(typeof massConversionProbe, 'function'); assert.equal(typeof massConversionBrowser, 'function');
  const bom = fs.readFileSync(path.join(__dirname, 'lib/enterprise-round2-bom-freeze.cjs'), 'utf8');
  assert.match(bom, /massConversionProbe\(ctx, signal\)/); assert.match(bom, /massConversionBrowser\(ctx, page, history.massV1.browserFixture/);
});
test('material unit governance probes are source-only and cumulatively wired', () => {
  const { materialUnitProbe, materialUnitBrowser } = require('./lib/enterprise-round2-material-unit.cjs');
  assert.equal(typeof materialUnitProbe,'function');assert.equal(typeof materialUnitBrowser,'function');
  const bom=fs.readFileSync(path.join(__dirname,'lib/enterprise-round2-bom-freeze.cjs'),'utf8');
  assert(bom.includes('materialUnitProbe(ctx'));assert(bom.includes('materialUnitBrowser(ctx'));
});


test('approved packaging probes remain cumulative after separately reviewed R2-06 promotion', () => {
  const {packagingProbe,packagingBrowser}=require('./lib/enterprise-round2-packaging.cjs');
  assert.equal(typeof packagingProbe,'function');assert.equal(typeof packagingBrowser,'function');
  const bom=fs.readFileSync(path.join(__dirname,'lib/enterprise-round2-bom-freeze.cjs'),'utf8');
  assert(bom.includes('packagingProbe(ctx, signal)'));assert(bom.includes('packagingBrowser(ctx, browser, history.packaging.browserFixture'));
  const baseline=fs.readFileSync(path.join(__dirname,'config/enterprise-regression-baseline-v1.json'),'utf8');assert(baseline.includes('mass-packaging-density-conversion'));assert(baseline.includes('conversion-cost-conservation'));
});


test('approved density evidence remains independent, while the actual conversion probe closes the named R2-06 checks',()=>{
  const density=require('./lib/enterprise-round2-density.cjs');assert.equal(typeof density.densityProbe,'function');assert.equal(typeof density.densityBrowser,'function');
  const conversion=require('./lib/enterprise-round2-density-conversion.cjs');assert.equal(typeof conversion.densityConversionProbe,'function');assert.equal(typeof conversion.assertDensityCostConservation,'function');
  assert.equal(typeof require('./lib/enterprise-round2-density-conversion-browser.cjs').densityConversionBrowser,'function');
  const probe=fs.readFileSync(path.join(__dirname,'lib/enterprise-round2-density-conversion.cjs'),'utf8');assert(probe.includes('densityConversionBrowser(ctx'));assert(probe.includes('8.0000001'));
  const api=fs.readFileSync(path.join(__dirname,'lib/enterprise-round2-qc-isolation.cjs'),'utf8'),ui=fs.readFileSync(path.join(__dirname,'lib/enterprise-round2-qc-browser.cjs'),'utf8');assert(api.includes('densityProbe(ctx, signal'));assert(ui.includes('densityBrowser(ctx, browser'));
  const audit=fs.readFileSync(path.join(__dirname,'enterprise-round2-audit-v1.cjs'),'utf8');assert(audit.includes("runner.run('mass-packaging-density-conversion'"));assert(audit.includes("runner.run('conversion-cost-conservation'"));
  const baseline=fs.readFileSync(path.join(__dirname,'config/enterprise-regression-baseline-v1.json'),'utf8');assert(baseline.includes('mass-packaging-density-conversion'));assert(baseline.includes('conversion-cost-conservation'));
});
