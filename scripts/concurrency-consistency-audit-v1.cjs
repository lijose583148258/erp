const fs = require('fs');
const path = require('path');
const { ensureUiAuditAccounts } = require('./lib/ui-audit-user.cjs');
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const API_BASE = `${APP_URL.replace(/\/$/, '')}/api`;
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.resolve(process.env.CONCURRENCY_AUDIT_REPORT_PATH || path.join(OUTPUT_DIR, 'concurrency-consistency-audit-report-v1.json'));
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const report = {
  name: 'Concurrency Consistency Audit',
  version: '2.0',
  environment: String(process.env.ENTERPRISE_EVIDENCE_ENVIRONMENT || '').trim(),
  evidenceId: String(process.env.ENTERPRISE_EVIDENCE_ID || '').trim(),
  commitSha: String(process.env.ENTERPRISE_EVIDENCE_COMMIT_SHA || process.env.GITHUB_SHA || '').trim(),
  imageDigest: String(process.env.ENTERPRISE_EVIDENCE_IMAGE_DIGEST || '').trim(),
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  expectedPaidAmount: 300,
  steps: [],
  status: 'running',
};

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

async function withTimeout(name, timeoutMs, action) {
  const started = Date.now();
  try {
    const result = await Promise.race([
      action(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} exceeded ${timeoutMs}ms`)), timeoutMs)),
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
  }
}

async function apiFetch(endpoint, options = {}, token = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
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
    return { ok: response.ok, status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function login(username, password) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
    timeoutMs: 10000,
  });
  if (!response.ok) {
    throw new Error(`login failed for ${username}: ${response.status} ${response.json?.message || ''}`);
  }
  return response.json.data;
}

function unwrapData(response, label) {
  const data = response.json?.data;
  if (!response.ok || !data) {
    throw new Error(`${label} failed: ${response.status} ${response.json?.message || ''}`);
  }
  return data;
}

function findPaymentByNote(order, note) {
  return (order.paymentRecords || []).find((record) => String(record.note || '').includes(note));
}

async function run() {
  try {
    const roleAccounts = await ensureUiAuditAccounts(
      'concurrency_consistency',
      ['admin', 'sales', 'finance', 'manager'],
      { segmentByRole: { sales: 'direct' } },
    );
    const users = await withTimeout('login-required-roles', 20000, async () => {
      const [admin, sales, finance, manager] = await Promise.all(
        ['admin', 'sales', 'finance', 'manager'].map(async role => {
          const account = roleAccounts[role];
          return login(account.username, account.password);
        }),
      );
      return { admin, sales, finance, manager };
    });
    recordStep({
      step: 'role-token-captured',
      result: 'passed',
      roles: Object.fromEntries(Object.entries(users).map(([role, value]) => [role, value.user?.id])),
    });

    const customerPayload = {
      nameZh: `并发一致性客户-${RUN_ID}`,
      nameEn: `Concurrency Customer ${RUN_ID}`,
      nameVi: `Khach hang dong thoi ${RUN_ID}`,
      creditLimit: 5000,
      termsDays: 30,
      segment: 'direct',
      contacts: [{ name: `联系人-${RUN_ID}`, phone: `090${RUN_ID.slice(-7)}`, isPrimary: true }],
      addresses: [{ type: 'legal', fullAddress: `Consistency Address ${RUN_ID}`, isPrimary: true }],
    };

    const customer = await withTimeout('create-sales-owned-customer', 15000, async () => {
      const response = await apiFetch('/customers', {
        method: 'POST',
        data: customerPayload,
      }, users.sales.token);
      return unwrapData(response, 'create customer');
    });

    if (!customer.id) throw new Error('customer create returned no id');
    report.customer = { id: customer.id, nameZh: customer.nameZh };

    await withTimeout('readback-customer-no-loss', 12000, async () => {
      const response = await apiFetch(`/customers/${customer.id}`, {}, users.sales.token);
      const data = unwrapData(response, 'readback customer');
      if (data.nameZh !== customerPayload.nameZh) throw new Error(`nameZh lost: ${data.nameZh}`);
      if (!Array.isArray(data.contacts) || !data.contacts.length) throw new Error('contacts lost');
      if (!Array.isArray(data.addresses) || !data.addresses.length) throw new Error('addresses lost');
      return data;
    });

    const order = await withTimeout('create-order-for-concurrency', 15000, async () => {
      const response = await apiFetch('/orders', {
        method: 'POST',
        data: {
          customerId: Number(customer.id),
          items: [{
            productName: `Consistency Resin ${RUN_ID}`,
            specification: 'API-CONCURRENCY',
            quantity: 10,
            unit: 'kg',
            unitPrice: 100,
          }],
          paymentTerms: 30,
          notes: `concurrency-audit-${RUN_ID}`,
        },
      }, users.sales.token);
      return unwrapData(response, 'create order');
    });

    if (!order.id) throw new Error('order create returned no id');
    report.order = { id: order.id, orderNo: order.orderNo, finalAmount: order.finalAmount || order.totalAmount };

    const paymentNotes = [`PAY-A-${RUN_ID}`, `PAY-B-${RUN_ID}`];
    await withTimeout('submit-two-payments-concurrently', 20000, async () => {
      const results = await Promise.all(paymentNotes.map((note, index) => apiFetch(`/orders/${order.id}/payment`, {
        method: 'POST',
        data: {
          amount: index === 0 ? 100 : 200,
          method: 'bank_transfer',
          payerName: `payer-${RUN_ID}`,
          note,
          isProxy: false,
        },
      }, users.sales.token)));
      const failed = results.find((item) => !item.ok);
      if (failed) throw new Error(`payment submit failed: ${failed.status} ${failed.json?.message || ''}`);
      return results;
    });

    const afterPaymentSubmit = await withTimeout('readback-pending-payments', 12000, async () => {
      const response = await apiFetch(`/orders/${order.id}`, {}, users.finance.token);
      const data = unwrapData(response, 'readback pending payments');
      for (const note of paymentNotes) {
        const payment = findPaymentByNote(data, note);
        if (!payment) throw new Error(`pending payment missing: ${note}`);
        if (payment.status !== 'pending') throw new Error(`payment ${note} expected pending, got ${payment.status}`);
      }
      return data;
    });

    const targetPayments = paymentNotes.map((note) => findPaymentByNote(afterPaymentSubmit, note));

    await withTimeout('verify-two-payments-concurrently', 25000, async () => {
      const results = await Promise.all(targetPayments.map((payment) => apiFetch(`/orders/${order.id}/payment/${payment.id}/verify`, {
        method: 'POST',
      }, users.finance.token)));
      const failed = results.find((item) => !item.ok);
      if (failed) throw new Error(`payment verify failed: ${failed.status} ${failed.json?.message || ''}`);
      return results;
    });

    const finalOrder = await withTimeout('final-readback-consistency', 12000, async () => {
      const response = await apiFetch(`/orders/${order.id}`, {}, users.manager.token);
      const data = unwrapData(response, 'final order readback');
      const expectedPaid = 300;
      const actualPaid = Number(data.paidAmount || 0);
      if (Math.abs(actualPaid - expectedPaid) > 0.01) {
        throw new Error(`paidAmount drift: expected ${expectedPaid}, got ${actualPaid}`);
      }
      for (const note of paymentNotes) {
        const payment = findPaymentByNote(data, note);
        if (!payment) throw new Error(`verified payment missing: ${note}`);
        if (payment.status !== 'verified') throw new Error(`payment ${note} expected verified, got ${payment.status}`);
      }
      if (!['partial', 'paid'].includes(String(data.paymentStatus))) {
        throw new Error(`unexpected paymentStatus: ${data.paymentStatus}`);
      }
      return data;
    });
    report.finalOrder = {
      id: finalOrder.id,
      paidAmount: finalOrder.paidAmount,
      paymentStatus: finalOrder.paymentStatus,
      paymentCount: finalOrder.paymentRecords?.length || 0,
    };

    await withTimeout('long-read-loop-no-drift', 45000, async () => {
      for (let i = 0; i < 20; i += 1) {
        const [orderResponse, customerResponse, listResponse] = await Promise.all([
          apiFetch(`/orders/${order.id}`, {}, users.sales.token),
          apiFetch(`/customers/${customer.id}`, {}, users.sales.token),
          apiFetch('/orders?pageSize=20', {}, users.manager.token),
        ]);
        const orderData = unwrapData(orderResponse, `loop order ${i}`);
        const customerData = unwrapData(customerResponse, `loop customer ${i}`);
        unwrapData(listResponse, `loop list ${i}`);
        if (String(orderData.customerId) !== String(customer.id)) throw new Error(`loop ${i} customerId drift`);
        if (customerData.nameZh !== customerPayload.nameZh) throw new Error(`loop ${i} customer name drift`);
        if (Math.abs(Number(orderData.paidAmount || 0) - 300) > 0.01) throw new Error(`loop ${i} paidAmount drift`);
      }
    });

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'concurrency consistency audit failed');
    process.exit(1);
  }

  console.log(`Concurrency consistency audit passed. Report: ${REPORT_PATH}`);
}

run();
