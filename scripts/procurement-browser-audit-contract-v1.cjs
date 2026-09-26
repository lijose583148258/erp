const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { createProcurementBrowserAuditHelpers } = require('./lib/procurement-browser-audit-helpers.cjs');

const helpers = createProcurementBrowserAuditHelpers({
  appUrl: 'http://example.invalid/',
  captureScreenshot: async () => '',
  forbiddenMojibake: ['\ufffd'],
  getAuthToken: () => 'contract-token',
  loginUiAuditUser: async () => ({ token: 'contract-token' }),
  readBackTimeout: 100,
  recordStep: () => {},
  runId: '20260722000000',
  runWithTimebox: async (_page, _recordStep, _step, _timeout, task) => task(),
  setAuthToken: () => {},
  shotDir: path.join(process.cwd(), 'output', 'contract'),
  timeouts: { login: 100, route: 100 },
});

const requiredHelpers = [
  'answerNextDialog',
  'apiFetch',
  'assertNoMojibake',
  'replaceInputValue',
  'resolveForcePasswordChange',
  'safeScreenshot',
  'seedLoginState',
  'selectOptionByValue',
  'unwrapList',
  'verifyNavigationWarning',
  'withTimebox',
];
for (const name of requiredHelpers) {
  assert.strictEqual(typeof helpers[name], 'function', `procurement helper missing: ${name}`);
}
assert.deepStrictEqual(helpers.unwrapList({ json: { data: { items: [{ id: 1 }] } } }), [{ id: 1 }]);
assert.throws(() => helpers.assertNoMojibake('bad \ufffd text', 'contract'), /mojibake/);

const entrySource = fs.readFileSync(path.join(__dirname, 'procurement-browser-audit-v1.cjs'), 'utf8');
const binding = entrySource.match(/const\s*\{([\s\S]*?)\}\s*=\s*createProcurementBrowserAuditHelpers\(/);
assert.ok(binding, 'procurement helper binding is missing from the browser audit entrypoint');
for (const name of requiredHelpers) {
  assert.match(binding[1], new RegExp(`\\b${name}\\b`), `entrypoint did not bind helper: ${name}`);
}

const workspaceSource = fs.readFileSync(
  path.join(__dirname, '..', 'pages', 'procurement', 'PurchaseOrderWorkspace.tsx'),
  'utf8',
);
const materialComboboxSource = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'materials', 'MaterialMasterCombobox.tsx'),
  'utf8',
);

for (const token of [
  '<fieldset',
  '1. 采购对象',
  '2. 数量、价格与到货',
  'label="供应商"',
  'label="采购数量"',
  'label="计量单位"',
  'label="预计到货日期"',
  '保存后生成采购承诺；不会立即增加库存',
  'aria-expanded={showAdvancedOrderFields}',
  'aria-controls="purchase-advanced-fields"',
  'role="switch"',
  'aria-checked={isB2B}',
  'motion-reduce:transition-none',
]) {
  assert.ok(workspaceSource.includes(token), `procurement hierarchy/motion contract missing: ${token}`);
}

for (const token of [
  "createPortal",
  "className=\"fixed z-[100]",
  "role=\"combobox\"",
  "role=\"listbox\"",
  "aria-busy={loading}",
  "aria-live=\"polite\"",
  "queryFailed",
  "motion-reduce:animate-none",
]) {
  assert.ok(materialComboboxSource.includes(token), `material combobox interaction contract missing: ${token}`);
}

console.log('Procurement Browser Audit Contract: PASS');
