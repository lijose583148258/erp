const fs = require('fs');
const path = require('path');
const { ensureUiAuditAccounts } = require('./lib/ui-audit-user.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001';
const API_BASE = `${APP_URL.replace(/\/$/, '')}/api`;
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'receivable-adjustment-api-audit-report-v1.json');
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

function amount(value) {
  return Number(Number(value || 0).toFixed(2));
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
      nameZh: `应收调整客户-${RUN_ID}`,
      nameEn: `Receivable Adjustment Customer ${RUN_ID}`,
      nameVi: `Khach dieu chinh phai thu ${RUN_ID}`,
      licenseNumber: `RAR-${RUN_ID}`,
      creditLimit: 100000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'private',
      salespersonId: Number(sales.user.id),
      contactName: 'Receivable Tester',
      contactPhone: `09${RUN_ID.slice(-8)}`,
      contactEmail: `receivable-${RUN_ID}@example.com`,
    },
  }, sales.token);
  assert(response.ok && response.json?.data?.id, 'create customer failed', {
    status: response.status,
    body: response.json,
  });
  return response.json.data;
}

async function createOrder(sales, customerId, suffix, unitPrice = 100) {
  const response = await apiFetch('/orders', {
    method: 'POST',
    data: {
      customerId: Number(customerId),
      items: [{
        productName: `应收调整胶水-${suffix}-${RUN_ID}`,
        specification: `RAR-${suffix}`,
        quantity: 1,
        unit: 'kg',
        unitPrice,
      }],
      paymentTerms: 30,
      notes: `receivable-adjustment-${suffix}-${RUN_ID}`,
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

async function createReceivableAdjustment(token, payload) {
  return apiFetch('/finance/receivable-adjustments', { method: 'POST', data: payload }, token);
}

async function postReceivableAdjustment(token, adjustmentId) {
  return apiFetch(`/finance/receivable-adjustments/${adjustmentId}/post`, { method: 'POST' }, token);
}

async function reverseReceivableAdjustment(token, adjustmentId, note) {
  return apiFetch(`/finance/receivable-adjustments/${adjustmentId}/reverse`, {
    method: 'POST',
    data: { note },
  }, token);
}

async function recordPayment(token, orderId, paymentAmount, note) {
  return apiFetch(`/orders/${orderId}/payment`, {
    method: 'POST',
    data: {
      amount: paymentAmount,
      method: 'bank_transfer',
      payerName: `RAR Payer ${RUN_ID}`,
      note,
    },
  }, token);
}

async function verifyPayment(token, orderId, paymentId) {
  return apiFetch(`/orders/${orderId}/payment/${paymentId}/verify`, { method: 'POST' }, token);
}

async function auditReceivableAdjustmentMainFlow(tokens, customer) {
  const order = await createOrder(tokens.sales, customer.id, 'MAIN', 100);
  const before = await getOrder(tokens.manager.token, order.id);
  assert(amount(before.finalAmount) === 100, 'seed order final amount should be 100', { before });
  assert(amount(before.receivableAdjustmentAmount) === 0, 'new order should start with zero receivableAdjustmentAmount', { before });

  const created = await createReceivableAdjustment(tokens.finance.token, {
    orderId: Number(order.id),
    adjustmentType: 'credit_memo',
    amount: 40,
    reason: `客户贷项调整-${RUN_ID}`,
    evidenceJson: JSON.stringify({ source: 'receivable-adjustment-api-audit', runId: RUN_ID }),
    note: 'credit memo should reduce receivable, not paid amount',
  });
  assert(created.status === 201 && created.json?.data?.id, 'create receivable adjustment failed', {
    status: created.status,
    body: created.json,
  });

  const adjustmentId = Number(created.json.data.id);
  const posted = await postReceivableAdjustment(tokens.finance.token, adjustmentId);
  assert(posted.ok, 'post receivable adjustment failed', {
    status: posted.status,
    body: posted.json,
  });
  const afterPost = await getOrder(tokens.manager.token, order.id);
  assert(amount(afterPost.receivableAdjustmentAmount) === 40, 'posted receivable adjustment did not update order adjustment amount', {
    afterPost,
  });
  assert(amount(afterPost.paidAmount) === amount(before.paidAmount), 'posted receivable adjustment changed paidAmount', {
    before,
    afterPost,
  });
  assert(amount(afterPost.effectiveReceivableAmount) === 60, 'effective receivable should be finalAmount minus adjustment', {
    afterPost,
  });
  assert(amount(afterPost.outstandingAmount) === 60, 'outstanding should follow effective receivable', {
    afterPost,
  });

  const overPayment = await recordPayment(tokens.sales.token, order.id, 70, `over-effective-receivable-${RUN_ID}`);
  assert(overPayment.status === 400, 'payment above effective receivable must be rejected', {
    status: overPayment.status,
    body: overPayment.json,
  });

  const payment = await recordPayment(tokens.sales.token, order.id, 60, `exact-effective-receivable-${RUN_ID}`);
  assert(payment.ok && payment.json?.data?.paymentRecords?.length >= 1, 'record exact outstanding payment failed', {
    status: payment.status,
    body: payment.json,
  });
  const pendingPayment = [...payment.json.data.paymentRecords].reverse().find(item => item.status === 'pending' && amount(item.amount) === 60);
  assert(pendingPayment?.id, 'pending payment was not returned after recording exact outstanding amount', {
    paymentRecords: payment.json.data.paymentRecords,
  });

  const verified = await verifyPayment(tokens.manager.token, order.id, pendingPayment.id);
  assert(verified.ok, 'verify exact outstanding payment failed', {
    status: verified.status,
    body: verified.json,
  });
  const afterPayment = await getOrder(tokens.manager.token, order.id);
  assert(amount(afterPayment.paidAmount) === 60, 'verified payment should set paidAmount to 60', { afterPayment });
  assert(afterPayment.paymentStatus === 'paid', 'order should be paid after paying effective receivable', { afterPayment });

  const invalidExtra = await createReceivableAdjustment(tokens.finance.token, {
    orderId: Number(order.id),
    adjustmentType: 'bad_debt_writeoff',
    amount: 1,
    reason: `已结清后不应继续核销-${RUN_ID}`,
  });
  assert(invalidExtra.status === 409, 'additional receivable adjustment after effective paid must be rejected', {
    status: invalidExtra.status,
    body: invalidExtra.json,
  });

  const reversed = await reverseReceivableAdjustment(tokens.finance.token, adjustmentId, `reverse-main-${RUN_ID}`);
  assert(reversed.ok, 'reverse receivable adjustment failed', {
    status: reversed.status,
    body: reversed.json,
  });
  const afterReverse = await getOrder(tokens.manager.token, order.id);
  assert(amount(afterReverse.receivableAdjustmentAmount) === 0, 'reversal should restore receivableAdjustmentAmount to zero', {
    afterReverse,
  });
  assert(amount(afterReverse.paidAmount) === 60, 'reversal must not alter paidAmount', { afterReverse });
  assert(afterReverse.paymentStatus === 'partial', 'reversal should restore partial payment state', { afterReverse });
  assert(amount(afterReverse.outstandingAmount) === 40, 'reversal should restore outstanding amount', { afterReverse });

  recordStep({
    step: 'receivable-adjustment-main-flow',
    result: 'passed',
    orderId: order.id,
    adjustmentId,
    paidAmountAfterReverse: amount(afterReverse.paidAmount),
    outstandingAfterReverse: amount(afterReverse.outstandingAmount),
  });
}

async function auditConcurrentPosting(tokens, customer) {
  const order = await createOrder(tokens.sales, customer.id, 'CONCURRENT', 100);
  const payload = index => ({
    orderId: Number(order.id),
    adjustmentType: 'discount_allowance',
    amount: 60,
    reason: `并发折让-${index}-${RUN_ID}`,
    note: `concurrent-receivable-adjustment-${index}`,
  });
  const creates = await Promise.all([
    createReceivableAdjustment(tokens.finance.token, payload(1)),
    createReceivableAdjustment(tokens.finance.token, payload(2)),
  ]);
  assert(creates.every(item => item.status === 201), 'concurrent seed adjustments should be created as pending', {
    statuses: creates.map(item => item.status),
    bodies: creates.map(item => item.json),
  });

  const ids = creates.map(item => Number(item.json.data.id));
  const posts = await Promise.all(ids.map(id => postReceivableAdjustment(tokens.finance.token, id)));
  const statuses = posts.map(item => item.status);
  const after = await getOrder(tokens.manager.token, order.id);
  const successCount = statuses.filter(status => status >= 200 && status < 300).length;
  const conflictCount = statuses.filter(status => status === 409).length;
  assert(successCount === 1 && conflictCount === 1, 'concurrent receivable postings must accept exactly one and reject one', {
    statuses,
    bodies: posts.map(item => item.json),
  });
  assert(amount(after.receivableAdjustmentAmount) === 60, 'concurrent receivable postings produced adjustment drift', {
    after,
    statuses,
  });
  assert(amount(after.paidAmount) === 0, 'concurrent receivable postings changed paidAmount', { after });

  const postedId = ids[statuses.findIndex(status => status >= 200 && status < 300)];
  const reverse = await reverseReceivableAdjustment(tokens.finance.token, postedId, `cleanup-concurrent-${RUN_ID}`);
  assert(reverse.ok, 'cleanup reverse after concurrent audit failed', {
    status: reverse.status,
    body: reverse.json,
  });
  const afterCleanup = await getOrder(tokens.manager.token, order.id);
  assert(amount(afterCleanup.receivableAdjustmentAmount) === 0, 'cleanup reverse did not restore adjustment amount', {
    afterCleanup,
  });

  recordStep({
    step: 'receivable-adjustment-concurrent-posting',
    result: 'passed',
    orderId: order.id,
    adjustmentIds: ids,
    statuses,
  });
}

async function auditNoEffectiveOverpaid(tokens) {
  const response = await apiFetch('/orders?page=1&pageSize=100', {}, tokens.manager.token);
  assert(response.ok, 'orders list readback failed', { status: response.status, body: response.json });
  const rows = response.json?.data || [];
  const invalid = rows.filter(order => amount(order.paidAmount) - amount(order.effectiveReceivableAmount ?? order.finalAmount) > 0.01);
  assert(invalid.length === 0, 'visible order list contains paidAmount above effective receivable', {
    invalid: invalid.slice(0, 5),
  });
  recordStep({
    step: 'visible-orders-effective-overpaid-scan',
    result: 'passed',
    checked: rows.length,
  });
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  try {
    const tokens = await withTimeout('login-sales-manager-finance', 20000, async () => {
      const accounts = await ensureUiAuditAccounts('receivable_audit', ['sales', 'manager', 'finance'], {
        password: process.env.RECEIVABLE_AUDIT_PASSWORD,
      });
      const [sales, manager, finance] = await Promise.all([
        login(accounts.sales.username, accounts.sales.password),
        login(accounts.manager.username, accounts.manager.password),
        login(accounts.finance.username, accounts.finance.password),
      ]);
      return { sales, manager, finance };
    });
    const customer = await withTimeout('seed-receivable-adjustment-customer', 20000, async () => createCustomer(tokens.sales));
    await withTimeout('audit-receivable-adjustment-main-flow', 60000, async () => auditReceivableAdjustmentMainFlow(tokens, customer));
    await withTimeout('audit-receivable-adjustment-concurrent-posting', 60000, async () => auditConcurrentPosting(tokens, customer));
    await withTimeout('audit-visible-orders-effective-overpaid-scan', 20000, async () => auditNoEffectiveOverpaid(tokens));
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
