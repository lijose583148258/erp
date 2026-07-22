const { scanText } = require('./effective-source-mojibake-gate-v1.cjs');
const { assertNoMojibake } = require('./lib/audit-utils.cjs');

const corrupted = [
  'label="\u93cd\u56e7\u566f\u93b5\u5f52\u567a"',
  'placeholder="\u6e1a\u5b2a\ue6e7 1000"',
  'label="\u93b5\u5f52\u567a\u9357\u66da\u7d85"',
];

for (const fixture of corrupted) {
  if (scanText('pages/fixture.tsx', fixture).length === 0) {
    throw new Error(`Source detector missed mojibake fixture: ${fixture}`);
  }
  let rejected = false;
  try {
    assertNoMojibake(fixture, 'browser detector fixture');
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`Browser detector missed mojibake fixture: ${fixture}`);
}

const valid = '标准批量；例如 1000；批量单位';
if (scanText('pages/fixture.tsx', valid).length) throw new Error('Source detector rejected valid Chinese copy.');
assertNoMojibake(valid, 'valid browser copy');

console.log('Mojibake Detector Contract: PASS');
console.log('- Source, full-codebase, and browser checks share coverage for the production BOM regression fixtures.');
