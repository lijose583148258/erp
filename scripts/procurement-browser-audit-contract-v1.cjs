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

console.log('Procurement Browser Audit Contract: PASS');