const assert = require('assert');

const { createBrowserHumanFlowModules } = require('./lib/browser-human-flow-modules.cjs');

const noop = async () => {};
const { moduleDefinitions } = createBrowserHumanFlowModules({
  DATA: {},
  FLOW_STATE: {},
  RUN_ID: 'contract',
  TIMEOUTS: {},
  ensureRole: noop,
  getBodyText: noop,
  openHash: noop,
  recordStep: noop,
  safeScreenshot: noop,
  selectOptionContaining: noop,
  waitForVisibleText: noop,
  withTimeout: noop,
});

const expected = [
  ['crm', []],
  ['orders', ['crm']],
  ['shipping', ['crm', 'orders']],
  ['procurement-warehouse', []],
  ['collections-adjustment', ['crm', 'orders']],
  ['production', []],
];

assert.deepStrictEqual(
  moduleDefinitions.map(({ name, dependencies }) => [name, dependencies]),
  expected,
  'human-flow module names, ordering, or dependencies changed',
);
assert.strictEqual(new Set(moduleDefinitions.map(({ name }) => name)).size, expected.length);
for (const definition of moduleDefinitions) {
  assert.strictEqual(typeof definition.run, 'function', `${definition.name} is missing its runner`);
  assert.ok(definition.role, `${definition.name} is missing its role`);
  assert.ok(definition.purpose, `${definition.name} is missing its purpose`);
}

console.log('Browser Human Flow Modules Contract: PASS');