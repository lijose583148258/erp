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


test('explicit mass-v1 probes remain source-only loadable and cumulative', () => {
  const { massConversionProbe, massConversionBrowser } = require('./lib/enterprise-round2-mass-conversion.cjs');
  assert.equal(typeof massConversionProbe, 'function'); assert.equal(typeof massConversionBrowser, 'function');
  const bom = fs.readFileSync(path.join(__dirname, 'lib/enterprise-round2-bom-freeze.cjs'), 'utf8');
  assert.match(bom, /massConversionProbe\(ctx, signal\)/); assert.match(bom, /massConversionBrowser\(ctx, page, history.massV1.browserFixture/);
});
test('mass rule, form and execution changes trigger cloud regression', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/enterprise-cloud-sandbox.yml'), 'utf8');
  const paths = workflow.split('  pull_request:')[1].split('  push:')[0];
  for (const file of ['backend/src/domain/production-mass-basis*.ts', 'scripts/lib/enterprise-round2-mass-conversion.cjs', 'backend/src/services/production-completion.validation.ts', 'backend/src/validators/production.ts', 'pages/production/ProductionBomLineGrid.tsx', 'pages/production/ProductionBomMobileRows.tsx', 'pages/production/productionBomLineModel.ts', 'pages/ProductionWorkspaceV2.tsx']) assert(paths.includes("'" + file + "'"), file);
});

test('material unit governance probes are source-only and cumulatively wired', () => {
  const { materialUnitProbe, materialUnitBrowser } = require('./lib/enterprise-round2-material-unit.cjs');
  assert.equal(typeof materialUnitProbe,'function');assert.equal(typeof materialUnitBrowser,'function');
  const bom=fs.readFileSync(path.join(__dirname,'lib/enterprise-round2-bom-freeze.cjs'),'utf8');
  assert(bom.includes('materialUnitProbe(ctx'));assert(bom.includes('materialUnitBrowser(ctx'));
  const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/enterprise-cloud-sandbox.yml'),'utf8');
  for(const p of ['scripts/lib/enterprise-round2-material-unit.cjs','backend/src/domain/material-unit-governance.ts','backend/src/services/material-master.service.ts','backend/src/controllers/material.controller.ts','pages/MaterialMaster.tsx','services/material.service.ts'])assert(workflow.includes("'"+p+"'"),p);
});


test('approved packaging probes extend cumulative evidence without promoting full R2-06', () => {
  const {packagingProbe,packagingBrowser}=require('./lib/enterprise-round2-packaging.cjs');
  assert.equal(typeof packagingProbe,'function');assert.equal(typeof packagingBrowser,'function');
  const bom=fs.readFileSync(path.join(__dirname,'lib/enterprise-round2-bom-freeze.cjs'),'utf8');
  assert(bom.includes('packagingProbe(ctx, signal)'));assert(bom.includes('packagingBrowser(ctx, browser, history.packaging.browserFixture'));
  const baseline=fs.readFileSync(path.join(__dirname,'config/enterprise-regression-baseline-v1.json'),'utf8');assert(!baseline.includes('mass-packaging-density-conversion'));
});
