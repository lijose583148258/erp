const assert = require('node:assert/strict');
const { createSalesOrdersBrowserAuditRuntime } = require('./lib/sales-orders-browser-audit-runtime.cjs');
const { buildEditedOrderExpectation } = require('./lib/sales-orders-browser-audit-edit-flow.cjs');
const {
  assertBrowserRuntimeClean,
  assertCreatedOrderReadback,
  assertPaymentReadback,
} = require('./lib/sales-orders-browser-audit-assertions.cjs');

const expected = {
  productName: 'Resin A', packaging: '25kg/drum', quantity: 5, unit: 'kg', unitPrice: 99,
  paymentAmount: 128, paymentNote: 'PAY-1',
};
const detail = {
  id: 8, customerId: 7, customerName: 'Customer A', totalAmount: 495, finalAmount: 495,
  paidAmount: 0, status: 'pending', paymentStatus: 'unpaid',
  items: [{ id: 1, productName: 'Resin A', specification: '25kg/drum', quantity: 5, unit: 'kg', unitPrice: 99, totalPrice: 495 }],
};
assert.equal(assertCreatedOrderReadback(detail, expected, { id: 7, label: 'Customer A' }).specification, '25kg/drum');
assert.throws(
  () => assertCreatedOrderReadback({ ...detail, items: [{ ...detail.items[0], specification: null }] }, expected, { id: 7, label: 'Customer A' }),
  /packaging mismatch/,
);
assert.throws(
  () => assertCreatedOrderReadback({ ...detail, finalAmount: 494 }, expected, { id: 7, label: 'Customer A' }),
  /final amount mismatch/,
);

const payment = { id: 3, note: 'PAY-1', amount: 128, status: 'pending' };
assert.doesNotThrow(() => assertPaymentReadback(detail, payment, expected, 0));
assert.throws(() => assertPaymentReadback(detail, { ...payment, amount: 12 }, expected, 0), /payment amount mismatch/);
assert.throws(() => assertPaymentReadback(detail, { ...payment, status: 'verified' }, expected, 0), /must remain pending/);
assert.doesNotThrow(() => assertBrowserRuntimeClean({ consoleErrors: [], pageErrors: [], failedApiRequests: [], serverApiFailures: [] }));
assert.throws(() => assertBrowserRuntimeClean({ consoleErrors: ['boom'] }), /runtime errors/);
assert.deepEqual(
  buildEditedOrderExpectation({ ...expected, updatedPackaging: 'EDIT-BOX', updatedQuantity: 7 }),
  { ...expected, updatedPackaging: 'EDIT-BOX', updatedQuantity: 7, packaging: 'EDIT-BOX', quantity: 7 },
);
assert.throws(() => buildEditedOrderExpectation(expected), /packaging fixture is required/);

async function verifyRuntimeFailureEvidence() {
  const runtimeReport = { steps: [] };
  const runtime = createSalesOrdersBrowserAuditRuntime({
    appUrl: 'https://example.test/',
    auditAccount: { username: 'fixture', password: 'fixture', role: 'admin' },
    testData: {},
    report: runtimeReport,
    shotDir: 'output/contract-fixture',
    timeouts: { login: 100, api: 100, save: 100 },
  });
  const page = {
    screenshot: async () => { throw new Error('capture unavailable'); },
    evaluate: async () => '#orders',
  };
  await assert.rejects(
    runtime.withTimebox(page, 'fixture-failure', 100, async () => { throw new Error('original failure'); }),
    /original failure/,
  );
  assert.equal(runtimeReport.steps[0].error, 'original failure');
  assert.equal(runtimeReport.steps[0].screenshotError, 'capture unavailable');
  const fastResult = await runtime.withTimebox(page, 'fixture-success', 100, async () => 'ok');
  assert.equal(fastResult, 'ok');

  console.log('Sales Orders Browser Audit Contract: PASS');
  console.log('- order persistence, pending-payment invariants, runtime gates, and failure evidence verified');
}

verifyRuntimeFailureEvidence().catch((error) => {
  console.error(error);
  process.exit(1);
});
