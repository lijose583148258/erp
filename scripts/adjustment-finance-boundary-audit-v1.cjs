const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001';
const API_BASE = `${APP_URL.replace(/\/$/, '')}/api`;
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'adjustment-finance-boundary-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  status: 'running',
  steps: [],
  findings: [],
};

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function addFinding(entry) {
  report.findings.push({ at: new Date().toISOString(), ...entry });
}

async function withTimeout(name, timeoutMs, action) {
  const started = Date.now();
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    recordStep({ step: name, result: 'passed', durationMs: Date.now() - started, timeoutMs });
    return result;
  } catch (error) {
    recordStep({
      step: name,
      result: 'failed',
      durationMs: Date.now() - started,
      timeoutMs,
      error: String(error.message || error),
    });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function apiFetch(endpoint, options = {}, token = '') {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
      body: options.data ? JSON.stringify(options.data) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: response.ok, status: response.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function assert(condition, message, evidence = {}) {
  if (!condition) {
    addFinding({ status: 'finding', message, evidence });
    throw new Error(message);
  }
}

async function login(username, password) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
    timeoutMs: 10000,
  });
  assert(response.ok && response.json?.data?.token, `login failed for ${username}`, {
    status: response.status,
    body: response.json,
  });
  return response.json.data;
}

async function createCustomer(sales) {
  const response = await apiFetch('/customers', {
    method: 'POST',
    data: {
      nameZh: `调账边界客户-${RUN_ID}`,
      nameEn: `Adjustment Boundary Customer ${RUN_ID}`,
      nameVi: `Khach dieu chinh ${RUN_ID}`,
      licenseNumber: `ADJ-BD-${RUN_ID}`,
      creditLimit: 100000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'private',
      salespersonId: Number(sales.user.id),
      contactName: 'Adjustment Boundary Tester',
      contactPhone: `09${RUN_ID.slice(-8)}`,
      contactEmail: `adj-boundary-${RUN_ID}@example.com`,
    },
  }, sales.token);
  assert(response.ok && response.json?.data?.id, 'create customer failed', {
    status: response.status,
    body: response.json,
  });
  return response.json.data;
}

async function createOrder(sales, customerId, suffix) {
  const response = await apiFetch('/orders', {
    method: 'POST',
    data: {
      customerId: Number(customerId),
      items: [{
        productName: `调账边界胶水-${suffix}-${RUN_ID}`,
        specification: `ADJ-${suffix}`,
        quantity: 1,
        unit: 'kg',
        unitPrice: 100,
      }],
      paymentTerms: 30,
      notes: `adjustment-boundary-${suffix}-${RUN_ID}`,
    },
  }, sales.token);
  assert(response.ok && response.json?.data?.id, `create order ${suffix} failed`, {
    status: response.status,
    body: response.json,
  });
  return response.json.data;
}

async function getOrder(token, orderId) {
  const response = await apiFetch(`/orders/${orderId}`, {}, token);
  assert(response.ok && response.json?.data, `get order ${orderId} failed`, {
    status: response.status,
    body: response.json,
  });
  return response.json.data;
}

async function createAdjustment(token, payload) {
  return apiFetch('/adjustments', { method: 'POST', data: payload }, token);
}

async function applyAdjustment(token, adjustmentId) {
  return apiFetch(`/adjustments/${adjustmentId}/apply`, { method: 'POST' }, token);
}

async function reverseAdjustment(token, adjustmentId, note) {
  return apiFetch(`/adjustments/${adjustmentId}/reverse`, {
    method: 'POST',
    data: { note },
  }, token);
}

function amount(value) {
  return Number(Number(value || 0).toFixed(2));
}

async function auditOverAmountRejected(tokens, customer) {
  const order = await createOrder(tokens.sales, customer.id, 'OVER');
  const before = await getOrder(tokens.manager.token, order.id);
  const finalAmount = amount(before.finalAmount);
  const response = await createAdjustment(tokens.manager.token, {
    domain: 'finance',
    targetType: 'order',
    orderId: Number(order.id),
    amountDelta: finalAmount + 50,
    reason: `ADJ-OVER-${RUN_ID}`,
    reasonCategory: 'manual_reconciliation',
    status: 'posted',
    note: 'boundary-over-test',
  });
  const after = await getOrder(tokens.manager.token, order.id);
  assert(response.status === 409, 'over-amount finance adjustment must return 409', {
    responseStatus: response.status,
    body: response.json,
  });
  assert(amount(after.paidAmount) === amount(before.paidAmount), 'over-amount finance adjustment changed paidAmount', {
    beforePaidAmount: before.paidAmount,
    afterPaidAmount: after.paidAmount,
  });
  recordStep({
    step: 'over-amount-finance-adjustment-rejected',
    result: 'passed',
    orderId: order.id,
    responseStatus: response.status,
    paidAmount: amount(after.paidAmount),
  });
}

async function auditNegativeBelowZeroRejected(tokens, customer) {
  const order = await createOrder(tokens.sales, customer.id, 'NEG');
  const positive = await createAdjustment(tokens.manager.token, {
    domain: 'finance',
    targetType: 'order',
    orderId: Number(order.id),
    amountDelta: 20,
    reason: `ADJ-POS-${RUN_ID}`,
    reasonCategory: 'manual_reconciliation',
    status: 'posted',
    note: 'boundary-positive-test',
  });
  assert(positive.status === 201, 'positive finance adjustment should be accepted before negative guard test', {
    responseStatus: positive.status,
    body: positive.json,
  });
  const afterPositive = await getOrder(tokens.manager.token, order.id);
  assert(amount(afterPositive.paidAmount) === 20, 'positive finance adjustment did not update paidAmount to 20', {
    paidAmount: afterPositive.paidAmount,
  });

  const invalidNegative = await createAdjustment(tokens.manager.token, {
    domain: 'finance',
    targetType: 'order',
    orderId: Number(order.id),
    amountDelta: -40,
    reason: `ADJ-NEG-INVALID-${RUN_ID}`,
    reasonCategory: 'manual_reconciliation',
    status: 'posted',
    note: 'boundary-negative-invalid-test',
  });
  const afterInvalidNegative = await getOrder(tokens.manager.token, order.id);
  assert(invalidNegative.status === 409, 'negative finance adjustment below zero must return 409', {
    responseStatus: invalidNegative.status,
    body: invalidNegative.json,
  });
  assert(amount(afterInvalidNegative.paidAmount) === 20, 'invalid negative finance adjustment changed paidAmount', {
    paidAmount: afterInvalidNegative.paidAmount,
  });

  const validNegative = await createAdjustment(tokens.manager.token, {
    domain: 'finance',
    targetType: 'order',
    orderId: Number(order.id),
    amountDelta: -10,
    reason: `ADJ-NEG-VALID-${RUN_ID}`,
    reasonCategory: 'manual_reconciliation',
    status: 'posted',
    note: 'boundary-negative-valid-test',
  });
  const afterValidNegative = await getOrder(tokens.manager.token, order.id);
  assert(validNegative.status === 201, 'valid negative finance adjustment should be accepted', {
    responseStatus: validNegative.status,
    body: validNegative.json,
  });
  assert(amount(afterValidNegative.paidAmount) === 10, 'valid negative finance adjustment did not reduce paidAmount correctly', {
    paidAmount: afterValidNegative.paidAmount,
  });
  recordStep({
    step: 'negative-boundary-finance-adjustment-guarded',
    result: 'passed',
    orderId: order.id,
    invalidStatus: invalidNegative.status,
    validStatus: validNegative.status,
    paidAmount: amount(afterValidNegative.paidAmount),
  });
}

async function auditPendingApplyRejected(tokens, customer) {
  const order = await createOrder(tokens.sales, customer.id, 'PENDING');
  const before = await getOrder(tokens.manager.token, order.id);
  const finalAmount = amount(before.finalAmount);
  const pending = await createAdjustment(tokens.manager.token, {
    domain: 'finance',
    targetType: 'order',
    orderId: Number(order.id),
    amountDelta: finalAmount + 30,
    reason: `ADJ-PENDING-OVER-${RUN_ID}`,
    reasonCategory: 'manual_reconciliation',
    status: 'pending',
    note: 'boundary-pending-over-test',
  });
  assert(pending.status === 201 && pending.json?.data?.adjustment?.id, 'pending over-amount adjustment should be recordable', {
    responseStatus: pending.status,
    body: pending.json,
  });

  const adjustmentId = Number(pending.json.data.adjustment.id);
  const apply = await applyAdjustment(tokens.manager.token, adjustmentId);
  const afterApply = await getOrder(tokens.manager.token, order.id);
  assert(apply.status === 409, 'applying pending over-amount adjustment must return 409', {
    responseStatus: apply.status,
    body: apply.json,
  });
  assert(amount(afterApply.paidAmount) === amount(before.paidAmount), 'failed pending apply changed paidAmount', {
    beforePaidAmount: before.paidAmount,
    afterPaidAmount: afterApply.paidAmount,
  });

  const reverse = await reverseAdjustment(tokens.manager.token, adjustmentId, `cleanup pending over ${RUN_ID}`);
  assert(reverse.ok, 'pending over-amount cleanup reverse failed', {
    responseStatus: reverse.status,
    body: reverse.json,
  });
  recordStep({
    step: 'pending-over-amount-apply-rejected-and-cleaned',
    result: 'passed',
    orderId: order.id,
    adjustmentId,
    applyStatus: apply.status,
    cleanupStatus: reverse.status,
  });
}

async function auditReceivableOnlyCategoriesRejected(tokens, customer) {
  const order = await createOrder(tokens.sales, customer.id, 'AR-SEMANTIC');
  const before = await getOrder(tokens.manager.token, order.id);
  const blockedCategories = [
    {
      category: 'bad_debt_writeoff',
      status: 'posted',
      reason: `ADJ-BAD-DEBT-${RUN_ID}`,
      note: 'bad-debt-must-not-change-paid-amount',
    },
    {
      category: 'credit_memo',
      status: 'pending',
      reason: `ADJ-CREDIT-MEMO-${RUN_ID}`,
      note: 'credit-memo-must-use-receivable-module',
    },
  ];

  const results = [];
  for (const item of blockedCategories) {
    const response = await createAdjustment(tokens.manager.token, {
      domain: 'finance',
      targetType: 'order',
      orderId: Number(order.id),
      amountDelta: 10,
      reason: item.reason,
      reasonCategory: item.category,
      status: item.status,
      note: item.note,
    });
    results.push({ category: item.category, status: response.status, body: response.json });
  }

  const after = await getOrder(tokens.manager.token, order.id);
  assert(
    results.every(item => item.status === 409),
    'receivable-only finance categories must be rejected by paidAmount adjustment endpoint',
    { results },
  );
  assert(
    results.every(item => String(item.body?.message || '').includes('应收')),
    'receivable-only rejection message must explain the receivable-adjustment boundary',
    { results },
  );
  assert(amount(after.paidAmount) === amount(before.paidAmount), 'receivable-only category rejection changed paidAmount', {
    beforePaidAmount: before.paidAmount,
    afterPaidAmount: after.paidAmount,
    results,
  });
  recordStep({
    step: 'receivable-only-finance-categories-rejected',
    result: 'passed',
    orderId: order.id,
    results,
    paidAmount: amount(after.paidAmount),
  });
}

async function auditConcurrentAdjustments(tokens, customer) {
  const order = await createOrder(tokens.sales, customer.id, 'CONCURRENT');
  const payload = (index) => ({
    domain: 'finance',
    targetType: 'order',
    orderId: Number(order.id),
    amountDelta: 60,
    reason: `ADJ-CONCURRENT-${index}-${RUN_ID}`,
    reasonCategory: 'manual_reconciliation',
    status: 'posted',
    note: `boundary-concurrent-${index}`,
  });
  const results = await Promise.all([
    createAdjustment(tokens.manager.token, payload(1)),
    createAdjustment(tokens.manager.token, payload(2)),
  ]);
  const statuses = results.map(item => item.status);
  const after = await getOrder(tokens.manager.token, order.id);
  const successCount = statuses.filter(status => status >= 200 && status < 300).length;
  const conflictCount = statuses.filter(status => status === 409).length;
  assert(successCount === 1 && conflictCount === 1, 'concurrent finance adjustments must accept exactly one and reject one', {
    statuses,
    bodies: results.map(item => item.json),
  });
  assert(amount(after.paidAmount) === 60, 'concurrent finance adjustments produced paidAmount drift', {
    statuses,
    paidAmount: after.paidAmount,
  });
  recordStep({
    step: 'concurrent-finance-adjustments-serialized',
    result: 'passed',
    orderId: order.id,
    statuses,
    paidAmount: amount(after.paidAmount),
  });
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  try {
    const tokens = await withTimeout('login-sales-manager', 20000, async () => {
      const [sales, manager] = await Promise.all([
        login('sales', 'sales123'),
        login('manager', 'manager123'),
      ]);
      return { sales, manager };
    });
    const customer = await withTimeout('seed-adjustment-boundary-customer', 20000, async () => createCustomer(tokens.sales));
    await withTimeout('audit-over-amount-rejected', 30000, async () => auditOverAmountRejected(tokens, customer));
    await withTimeout('audit-negative-below-zero-rejected', 30000, async () => auditNegativeBelowZeroRejected(tokens, customer));
    await withTimeout('audit-pending-apply-rejected', 30000, async () => auditPendingApplyRejected(tokens, customer));
    await withTimeout('audit-receivable-only-categories-rejected', 30000, async () => auditReceivableOnlyCategoriesRejected(tokens, customer));
    await withTimeout('audit-concurrent-adjustments', 30000, async () => auditConcurrentAdjustments(tokens, customer));
    report.status = report.findings.length === 0 ? 'passed' : 'failed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({
      status: report.status,
      runId: RUN_ID,
      steps: report.steps.length,
      findings: report.findings.length,
      reportPath: REPORT_PATH,
      error: report.error || null,
    }, null, 2));
  }
}

main();
