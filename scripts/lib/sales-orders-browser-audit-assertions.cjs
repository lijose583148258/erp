function asNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} is not a finite number: ${String(value)}`);
  return number;
}

function assertNumberEqual(actual, expected, label, tolerance = 0.000001) {
  const actualNumber = asNumber(actual, label);
  const expectedNumber = asNumber(expected, `${label} expected`);
  if (Math.abs(actualNumber - expectedNumber) > tolerance) {
    throw new Error(`${label} mismatch: expected ${expectedNumber}, got ${actualNumber}`);
  }
}

function assertCreatedOrderReadback(detail, expected, seedCustomer) {
  if (!detail?.id) throw new Error('created order detail is missing id');
  const customerId = detail.customerId ?? detail.customer?.id;
  if (String(customerId) !== String(seedCustomer.id)) {
    throw new Error(`created order customer mismatch: expected ${seedCustomer.id}, got ${String(customerId)}`);
  }
  const customerName = detail.customerName || detail.customerDisplayName || detail.customer?.nameZh || detail.customer?.name;
  if (String(customerName) !== String(seedCustomer.label)) {
    throw new Error(`created order customer name mismatch: expected ${seedCustomer.label}, got ${String(customerName)}`);
  }
  const line = Array.isArray(detail.items)
    ? detail.items.find((item) => item.productName === expected.productName)
    : null;
  if (!line) throw new Error('created order detail does not contain expected product');
  const specification = line.packagingSpec || line.specification || '';
  if (String(specification) !== String(expected.packaging)) {
    throw new Error(`created order packaging mismatch: expected ${expected.packaging}, got ${String(specification)}`);
  }
  assertNumberEqual(line.quantity, expected.quantity, 'created order quantity');
  assertNumberEqual(line.unitPrice, expected.unitPrice, 'created order unit price');
  assertNumberEqual(line.totalPrice ?? line.amount, expected.quantity * expected.unitPrice, 'created order line total');
  if (String(line.unit) !== String(expected.unit)) {
    throw new Error(`created order unit mismatch: expected ${expected.unit}, got ${String(line.unit)}`);
  }
  const expectedTotal = expected.quantity * expected.unitPrice;
  assertNumberEqual(detail.totalAmount, expectedTotal, 'created order total amount');
  assertNumberEqual(detail.finalAmount, expectedTotal, 'created order final amount');
  assertNumberEqual(detail.paidAmount, 0, 'created order initial paid amount');
  if (String(detail.status) !== 'pending') throw new Error(`created order status mismatch: ${String(detail.status)}`);
  if (String(detail.paymentStatus) !== 'unpaid') throw new Error(`created order payment status mismatch: ${String(detail.paymentStatus)}`);
  return line;
}

function assertPaymentReadback(order, payment, expected, baselinePaidAmount) {
  if (!payment?.id) throw new Error('payment readback is missing id');
  if (String(payment.note) !== String(expected.paymentNote)) {
    throw new Error(`payment note mismatch: expected ${expected.paymentNote}, got ${String(payment.note)}`);
  }
  assertNumberEqual(payment.amount, expected.paymentAmount, 'payment amount');
  if (String(payment.status) !== 'pending') {
    throw new Error(`new payment must remain pending before verification, got ${String(payment.status)}`);
  }
  assertNumberEqual(order.paidAmount, baselinePaidAmount, 'pending payment paid amount');
  if (String(order.paymentStatus) !== 'unpaid') {
    throw new Error(`pending payment must not change order paymentStatus, got ${String(order.paymentStatus)}`);
  }
}

function isIgnorableRequestFailure(url, failure) {
  const requestUrl = String(url || '');
  const wasIntentionallyAborted = String(failure || '').includes('ERR_ABORTED');
  if (!wasIntentionallyAborted) return false;
  return /\/api\/(?:v1\/)?rum\/vitals(?:\?|$)/.test(requestUrl)
    || /\/api\/(?:v1\/)?materials(?:\?|$)/.test(requestUrl);
}
function assertBrowserRuntimeClean(report) {
  const failures = [
    ...(report.consoleErrors || []).map((message) => `console: ${message}`),
    ...(report.pageErrors || []).map((message) => `page: ${message}`),
    ...(report.failedApiRequests || []).map((item) => `request: ${item.url} ${item.failure || ''}`.trim()),
    ...(report.serverApiFailures || []).map((item) => `response: ${item.status} ${item.url}`),
  ];
  if (failures.length) throw new Error(`sales order browser runtime errors: ${failures.slice(0, 8).join(' | ')}`);
}

function extractMarker(rowText) {
  const line = String(rowText || '').split('\n').find(Boolean) || '';
  const hashMatch = line.match(/#\d+/);
  if (hashMatch) return hashMatch[0];
  const orderMatch = String(rowText || '').match(/ORD-[A-Z0-9-]+/i);
  if (orderMatch) return orderMatch[0];
  return line.trim().slice(0, 32);
}

module.exports = { assertBrowserRuntimeClean, assertCreatedOrderReadback, assertPaymentReadback, extractMarker, isIgnorableRequestFailure };
