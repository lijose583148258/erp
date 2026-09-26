const path = require('path');
const { createAuditRuntime, ensureDir } = require('./lib/audit-runtime-utils.cjs');
const { applyAuditDatabaseContext } = require('./lib/audit-runtime-context.cjs');
const { ensureUiAuditAccounts } = require('./lib/ui-audit-user.cjs');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'order-payment-verification-concurrency-audit-report-v1.json');
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${process.pid}_${Math.random().toString(36).slice(2, 7)}`;
const STEP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 20_000;
let ADMIN;
applyAuditDatabaseContext(process.env);
const { PrismaClient } = require(path.join(process.cwd(), 'backend', 'node_modules', '@prisma', 'client'));

const report = {
  name: 'order-payment-verification-concurrency-audit-v1',
  appUrl: APP_URL,
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  status: 'running',
  steps: [],
  findings: [],
};

const runtime = createAuditRuntime({
  appUrl: APP_URL,
  outputDir: OUTPUT_DIR,
  report,
  reportPath: REPORT_PATH,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
});

function statusCounts(results) {
  return results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function loginAdmin() {
  return runtime.withTimeout('payment-audit-login-admin', STEP_TIMEOUT_MS, async () => {
    const response = await runtime.apiFetch('/auth/login', {
      method: 'POST',
      data: ADMIN,
    });
    runtime.expectStatus(response, [200], 'admin login');
    const data = runtime.dataOf(response);
    runtime.expect(Boolean(data?.token), 'admin login returned no token', response.json);
    runtime.expect(Boolean(data?.user?.id), 'admin login returned no user id', response.json);
    return data;
  });
}

async function ensureAlternateCreator(prisma, account) {
  const existing = await prisma.user.findUnique({
    where: { username: account.username },
    select: { id: true, username: true },
  });
  runtime.expect(Boolean(existing?.id), 'isolated alternate creator was not persisted', { username: account.username });
  return existing;
}

async function createOrderFixture({ prisma, token, alternateCreator, label, finalAmount }) {
  return runtime.withTimeout(`seed-payment-order-${label}`, STEP_TIMEOUT_MS, async () => {
    const customerResponse = await runtime.apiFetch('/customers', {
      method: 'POST',
      data: {
        name: `PAY-${label}-${RUN_ID}`,
        nameZh: `PAY-${label}-${RUN_ID}`,
        nameEn: `Payment Audit ${label} ${RUN_ID}`,
        nameVi: `Payment Audit ${label} ${RUN_ID}`,
        licenseNumber: `LIC-PAY-${label}-${RUN_ID}`.slice(0, 64),
        creditLimit: 100000,
        riskLevel: 'low',
        segment: 'direct',
        poolState: 'private',
        salespersonId: Number(alternateCreator.id),
        contactName: `Payment Contact ${RUN_ID}`,
        contactPhone: `09${RUN_ID.replace(/\D/g, '').slice(-8).padStart(8, '0')}`,
        contactEmail: `payment-${label}-${RUN_ID}@example.com`,
        status: 'active',
      },
    }, token);
    runtime.expectStatus(customerResponse, [201], `create customer for ${label}`);
    const customer = runtime.dataOf(customerResponse);
    runtime.expect(Boolean(customer?.id), `customer ${label} create returned no id`, customerResponse.json);

    const orderResponse = await runtime.apiFetch('/orders', {
      method: 'POST',
      data: {
        customerId: Number(customer.id),
        items: [{
          productName: `Payment Audit Product ${label} ${RUN_ID}`,
          specification: 'payment-concurrency-audit',
          quantity: 1,
          unit: 'kg',
          unitPrice: finalAmount,
        }],
        paymentTerms: 30,
        notes: `payment verification concurrency audit ${label} ${RUN_ID}`,
      },
    }, token);
    runtime.expectStatus(orderResponse, [201], `create order for ${label}`);
    const order = runtime.dataOf(orderResponse);
    runtime.expect(Boolean(order?.id), `order ${label} create returned no id`, orderResponse.json);

    await prisma.order.update({
      where: { id: Number(order.id) },
      data: {
        createdBy: Number(alternateCreator.id),
        updatedAt: new Date(),
      },
    });

    return {
      customerId: Number(customer.id),
      orderId: Number(order.id),
      finalAmount,
    };
  });
}

async function recordPayment({ prisma, token, orderId, amount, note }) {
  const response = await runtime.apiFetch(`/orders/${orderId}/payment`, {
    method: 'POST',
    data: {
      amount,
      method: 'bank_transfer',
      payerName: `Payment Payer ${RUN_ID}`,
      note,
    },
  }, token);
  runtime.expectStatus(response, [200], `record payment ${note}`);

  const payment = await prisma.paymentRecord.findFirst({
    where: {
      orderId: Number(orderId),
      note,
    },
    select: {
      id: true,
      amount: true,
      status: true,
      note: true,
    },
    orderBy: { id: 'desc' },
  });
  runtime.expect(Boolean(payment?.id), `recorded payment ${note} not found in database`, { orderId, note });
  runtime.expect(payment.status === 'pending', `recorded payment ${note} should start pending`, payment);
  return { ...payment, id: Number(payment.id) };
}

async function forceCreatePendingPayment({ prisma, orderId, amount, note }) {
  const payment = await prisma.paymentRecord.create({
    data: {
      orderId: Number(orderId),
      amount,
      method: 'bank_transfer',
      payerName: `Forced Pending Payer ${RUN_ID}`,
      note,
      status: 'pending',
    },
    select: {
      id: true,
      amount: true,
      status: true,
      note: true,
    },
  });
  runtime.expect(payment.status === 'pending', `forced pending payment ${note} should be pending`, payment);
  return { ...payment, id: Number(payment.id) };
}

async function verifyPayment(token, orderId, paymentId) {
  return runtime.apiFetch(`/orders/${orderId}/payment/${paymentId}/verify`, {
    method: 'POST',
  }, token);
}

async function readOrder(prisma, orderId) {
  const order = await prisma.order.findUnique({
    where: { id: Number(orderId) },
    select: {
      id: true,
      finalAmount: true,
      paidAmount: true,
      paymentStatus: true,
      paymentRecords: {
        select: {
          id: true,
          amount: true,
          status: true,
          note: true,
        },
        orderBy: { id: 'asc' },
      },
    },
  });
  runtime.expect(Boolean(order), `order ${orderId} not found for readback`, { orderId });
  return order;
}

async function auditBalancedConcurrentVerification({ prisma, token, alternateCreator }) {
  await runtime.withTimeout('balanced-two-payments-concurrent-verify', STEP_TIMEOUT_MS, async () => {
    const fixture = await createOrderFixture({ prisma, token, alternateCreator, label: 'balanced', finalAmount: 1000 });
    const first = await recordPayment({
      prisma,
      token,
      orderId: fixture.orderId,
      amount: 400,
      note: `PAY-BAL-A-${RUN_ID}`,
    });
    const second = await recordPayment({
      prisma,
      token,
      orderId: fixture.orderId,
      amount: 600,
      note: `PAY-BAL-B-${RUN_ID}`,
    });

    const results = await Promise.all([
      verifyPayment(token, fixture.orderId, first.id),
      verifyPayment(token, fixture.orderId, second.id),
    ]);
    const counts = statusCounts(results);
    runtime.expect(counts[200] === 2, 'balanced concurrent verification did not accept both valid payments', {
      counts,
      results: results.map((item) => item.json),
    });

    const order = await readOrder(prisma, fixture.orderId);
    const matching = order.paymentRecords.filter((record) => String(record.note || '').includes('PAY-BAL-'));
    runtime.expect(matching.length === 2, 'balanced payment record count drift', matching);
    runtime.expect(matching.every((record) => record.status === 'verified'), 'balanced payments not all verified', matching);
    runtime.expect(roundMoney(order.paidAmount) === 1000, 'balanced paidAmount mismatch', order);
    runtime.expect(order.paymentStatus === 'paid', 'balanced paymentStatus mismatch', order);

    report.steps.push({
      at: new Date().toISOString(),
      step: 'balanced-two-payments-concurrent-verify-evidence',
      result: 'passed',
      orderId: fixture.orderId,
      paymentIds: [first.id, second.id],
      statuses: counts,
      paidAmount: order.paidAmount,
      paymentStatus: order.paymentStatus,
    });
  });
}

async function auditSamePaymentDuplicateVerification({ prisma, token, alternateCreator }) {
  await runtime.withTimeout('same-payment-duplicate-verify-idempotent', STEP_TIMEOUT_MS, async () => {
    const fixture = await createOrderFixture({ prisma, token, alternateCreator, label: 'duplicate', finalAmount: 1000 });
    const payment = await recordPayment({
      prisma,
      token,
      orderId: fixture.orderId,
      amount: 300,
      note: `PAY-DUP-${RUN_ID}`,
    });

    const results = await Promise.all(Array.from({ length: 5 }, () => verifyPayment(token, fixture.orderId, payment.id)));
    const counts = statusCounts(results);
    runtime.expect(counts[200] === 5, 'same payment duplicate verification should be idempotent 200 responses', {
      counts,
      results: results.map((item) => item.json),
    });

    const order = await readOrder(prisma, fixture.orderId);
    const matching = order.paymentRecords.filter((record) => String(record.note || '').includes('PAY-DUP-'));
    runtime.expect(matching.length === 1, 'duplicate verification created extra payment records', matching);
    runtime.expect(matching[0].status === 'verified', 'duplicate verification did not verify the payment', matching[0]);
    runtime.expect(roundMoney(order.paidAmount) === 300, 'duplicate verification paidAmount drift', order);
    runtime.expect(order.paymentStatus === 'partial', 'duplicate verification paymentStatus drift', order);

    report.steps.push({
      at: new Date().toISOString(),
      step: 'same-payment-duplicate-verify-idempotent-evidence',
      result: 'passed',
      orderId: fixture.orderId,
      paymentId: payment.id,
      statuses: counts,
      paidAmount: order.paidAmount,
      paymentStatus: order.paymentStatus,
    });
  });
}

async function auditPendingReservationBlocksOverEntry({ prisma, token, alternateCreator }) {
  await runtime.withTimeout('pending-reservation-blocks-over-entry', STEP_TIMEOUT_MS, async () => {
    const fixture = await createOrderFixture({ prisma, token, alternateCreator, label: 'reservation', finalAmount: 1000 });
    const first = await recordPayment({
      prisma,
      token,
      orderId: fixture.orderId,
      amount: 700,
      note: `PAY-RES-A-${RUN_ID}`,
    });

    const second = await runtime.apiFetch(`/orders/${fixture.orderId}/payment`, {
      method: 'POST',
      data: {
        amount: 700,
        method: 'bank_transfer',
        payerName: `Payment Payer ${RUN_ID}`,
        note: `PAY-RES-B-${RUN_ID}`,
      },
    }, token);
    runtime.expect(second.status === 409, 'pending reservation should block a second over-entry payment', {
      status: second.status,
      json: second.json,
    });

    const order = await readOrder(prisma, fixture.orderId);
    const matching = order.paymentRecords.filter((record) => String(record.note || '').includes('PAY-RES-'));
    const pending = matching.filter((record) => record.status === 'pending');
    runtime.expect(matching.length === 1, 'pending reservation guard created an extra payment record', matching);
    runtime.expect(pending.length === 1 && Number(pending[0].id) === Number(first.id), 'first pending payment was not preserved cleanly', matching);
    runtime.expect(roundMoney(order.paidAmount) === 0, 'pending reservation should not change paidAmount', order);
    runtime.expect(order.paymentStatus === 'unpaid', 'pending reservation should not change paymentStatus before verification', order);

    report.steps.push({
      at: new Date().toISOString(),
      step: 'pending-reservation-blocks-over-entry-evidence',
      result: 'passed',
      orderId: fixture.orderId,
      firstPaymentId: first.id,
      secondStatus: second.status,
      pendingAmount: pending.reduce((sum, record) => sum + Number(record.amount), 0),
      paidAmount: order.paidAmount,
      paymentStatus: order.paymentStatus,
    });
  });
}

async function auditOverOutstandingConcurrentVerification({ prisma, token, alternateCreator }) {
  await runtime.withTimeout('over-outstanding-concurrent-verify-blocks-second', STEP_TIMEOUT_MS, async () => {
    const fixture = await createOrderFixture({ prisma, token, alternateCreator, label: 'overpay', finalAmount: 1000 });
    const first = await recordPayment({
      prisma,
      token,
      orderId: fixture.orderId,
      amount: 700,
      note: `PAY-OVER-A-${RUN_ID}`,
    });
    const second = await forceCreatePendingPayment({
      prisma,
      orderId: fixture.orderId,
      amount: 700,
      note: `PAY-OVER-B-${RUN_ID}`,
    });

    const results = await Promise.all([
      verifyPayment(token, fixture.orderId, first.id),
      verifyPayment(token, fixture.orderId, second.id),
    ]);
    const counts = statusCounts(results);
    runtime.expect(counts[200] === 1 && counts[409] === 1, 'over-outstanding verification must accept exactly one and reject one', {
      counts,
      results: results.map((item) => item.json),
    });

    const order = await readOrder(prisma, fixture.orderId);
    const matching = order.paymentRecords.filter((record) => String(record.note || '').includes('PAY-OVER-'));
    const verified = matching.filter((record) => record.status === 'verified');
    const pending = matching.filter((record) => record.status === 'pending');
    runtime.expect(matching.length === 2, 'overpay payment record count drift', matching);
    runtime.expect(verified.length === 1 && pending.length === 1, 'overpay verification should leave one verified and one pending', matching);
    runtime.expect(roundMoney(order.paidAmount) === 700, 'overpay guard paidAmount mismatch', order);
    runtime.expect(order.paymentStatus === 'partial', 'overpay guard paymentStatus mismatch', order);
    runtime.expect(roundMoney(order.paidAmount) <= roundMoney(order.finalAmount), 'overpay guard allowed paidAmount above finalAmount', order);

    report.steps.push({
      at: new Date().toISOString(),
      step: 'over-outstanding-concurrent-verify-blocks-second-evidence',
      result: 'passed',
      orderId: fixture.orderId,
      paymentIds: [first.id, second.id],
      statuses: counts,
      paidAmount: order.paidAmount,
      paymentStatus: order.paymentStatus,
      verifiedPaymentIds: verified.map((record) => record.id),
      pendingPaymentIds: pending.map((record) => record.id),
    });
  });
}

async function main() {
  ensureDir(OUTPUT_DIR);
  const prisma = new PrismaClient();
  try {
    const accounts = await ensureUiAuditAccounts('payment_verification', ['admin', 'sales']);
    ADMIN = accounts.admin;
    const admin = await loginAdmin();
    const alternateCreator = await ensureAlternateCreator(prisma, accounts.sales);
    report.seed = {
      verifierUserId: Number(admin.user.id),
      alternateCreatorId: Number(alternateCreator.id),
    };

    await auditBalancedConcurrentVerification({ prisma, token: admin.token, alternateCreator });
    await auditSamePaymentDuplicateVerification({ prisma, token: admin.token, alternateCreator });
    await auditPendingReservationBlocksOverEntry({ prisma, token: admin.token, alternateCreator });
    await auditOverOutstandingConcurrentVerification({ prisma, token: admin.token, alternateCreator });

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error?.message || error);
    report.details = error?.details || null;
    report.stack = error?.stack || null;
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
    await runtime.saveReport();
    console.log(JSON.stringify({ status: report.status, reportPath: REPORT_PATH, error: report.error || null }, null, 2));
  }
}

main();
