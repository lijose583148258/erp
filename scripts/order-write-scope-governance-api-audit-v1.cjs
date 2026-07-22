const fs = require('fs');
const path = require('path');
const {
  createAuditPrismaClient,
  ensureUiAuditUser,
  resolveDefaultAccount,
} = require('./lib/ui-audit-user.cjs');

const baseUrl = String(process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/$/, '');
const reportPath = path.resolve(process.env.ORDER_WRITE_SCOPE_REPORT_PATH
  || path.join(process.cwd(), 'cloud-evidence', 'order-write-scope-governance-api-audit-v1.json'));
const runId = `${Date.now()}-${process.pid}`;
const adminAccount = resolveDefaultAccount();
const password = adminAccount.password;
const managerAccount = { username: `order_scope_manager_${runId}`, password, role: 'manager' };
const financeAccount = { username: `order_scope_finance_${runId}`, password, role: 'finance' };

const report = {
  name: 'Order Write Scope Governance API Audit',
  version: '1.0',
  status: 'failed',
  baseUrl,
  runId,
  startedAt: new Date().toISOString(),
  steps: [],
};
const record = (name, details = {}) => report.steps.push({ name, status: 'passed', ...details });
const expect = (condition, message, details) => {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
};

const request = async (endpoint, options = {}) => {
  const response = await fetch(`${baseUrl}/api/v1${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.data === undefined ? undefined : JSON.stringify(options.data),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 500) }; }
  return { status: response.status, json };
};

const expectStatus = (label, response, expected) => {
  expect(response.status === expected, `${label}: expected HTTP ${expected}, received ${response.status}`, response.json);
  record(label, { httpStatus: response.status });
  return response.json?.data;
};

const login = async (account, label) => {
  const response = await request('/auth/login', {
    method: 'POST',
    data: { username: account.username, password: account.password },
  });
  const data = expectStatus(`login-${label}`, response, 200);
  expect(Boolean(data?.token), `login-${label}: token missing`, response.json);
  return data;
};

const prepareAccount = async (account, segment) => {
  await ensureUiAuditUser(account);
  const prisma = createAuditPrismaClient();
  try {
    await prisma.user.update({
      where: { username: account.username },
      data: { segment, mustChangePassword: false, isActive: true },
    });
  } finally {
    await prisma.$disconnect();
  }
};

const createCustomer = async (token, suffix, segment) => {
  const response = await request('/customers', {
    method: 'POST',
    token,
    data: {
      name: `ORDER-SCOPE-${suffix}-${runId}`,
      creditLimit: 50_000,
      riskLevel: 'low',
      segment,
      poolState: 'internal',
      status: 'active',
    },
  });
  const customer = expectStatus(`create-${suffix}-customer`, response, 201);
  expect(Boolean(customer?.id), `create-${suffix}-customer: id missing`, customer);
  return customer;
};

const createOrder = async (token, customerId, suffix) => {
  const response = await request('/orders', {
    method: 'POST',
    token,
    data: {
      customerId: Number(customerId),
      paymentTerms: 30,
      notes: `seed-${suffix}-${runId}`,
      items: [{ productName: `ORDER-SCOPE-${suffix}-${runId}`, quantity: 2, unit: 'unit', unitPrice: 125 }],
    },
  });
  const order = expectStatus(`create-${suffix}-order`, response, 201);
  expect(Boolean(order?.id), `create-${suffix}-order: id missing`, order);
  return order;
};

const readOrder = async (orderId) => {
  const prisma = createAuditPrismaClient();
  try {
    return await prisma.order.findUnique({
      where: { id: Number(orderId) },
      include: { paymentRecords: true },
    });
  } finally {
    await prisma.$disconnect();
  }
};

const main = async () => {
  await ensureUiAuditUser(adminAccount);
  await prepareAccount(managerAccount, 'direct');
  await prepareAccount(financeAccount, 'mixed');
  const admin = await login(adminAccount, 'admin');
  const manager = await login(managerAccount, 'direct-manager');
  const finance = await login(financeAccount, 'finance');
  expect(manager.user?.segment === 'direct', 'manager segment mismatch', manager.user);

  const channelCustomer = await createCustomer(admin.token, 'CHANNEL', 'channel');
  const directCustomer = await createCustomer(admin.token, 'DIRECT', 'direct');
  const channelOrder = await createOrder(admin.token, channelCustomer.id, 'CHANNEL');
  const directOrder = await createOrder(admin.token, directCustomer.id, 'DIRECT');

  const directUpdate = await request(`/orders/${directOrder.id}`, {
    method: 'PUT', token: manager.token, data: { notes: `manager-direct-update-${runId}` },
  });
  expectStatus('allow-in-segment-order-update', directUpdate, 200);

  const deniedUpdate = await request(`/orders/${channelOrder.id}`, {
    method: 'PUT', token: manager.token, data: { notes: `forbidden-update-${runId}` },
  });
  expectStatus('reject-cross-segment-order-update', deniedUpdate, 403);
  const deniedStatus = await request(`/orders/${channelOrder.id}/status`, {
    method: 'PATCH', token: manager.token, data: { status: 'confirmed' },
  });
  expectStatus('reject-cross-segment-order-status', deniedStatus, 403);
  const deniedPayment = await request(`/orders/${channelOrder.id}/payment`, {
    method: 'POST', token: manager.token, data: { amount: 25, method: 'cash', note: `forbidden-${runId}` },
  });
  expectStatus('reject-cross-segment-payment', deniedPayment, 403);

  const deniedReadback = await readOrder(channelOrder.id);
  expect(deniedReadback?.status === 'pending', 'cross-segment status mutation persisted', deniedReadback);
  expect(deniedReadback?.notes === `seed-CHANNEL-${runId}`, 'cross-segment order update persisted', deniedReadback);
  expect(deniedReadback?.paymentRecords.length === 0, 'cross-segment payment persisted', deniedReadback);
  record('rejected-writes-database-readback', { paymentCount: 0, status: deniedReadback.status });

  const financePayment = await request(`/orders/${channelOrder.id}/payment`, {
    method: 'POST', token: finance.token, data: { amount: 25, method: 'cash', note: `finance-${runId}` },
  });
  expectStatus('allow-finance-cross-segment-payment', financePayment, 200);
  const financeReadback = await readOrder(channelOrder.id);
  expect(financeReadback?.paymentRecords.length === 1, 'finance payment database read-back mismatch', financeReadback);
  expect(financeReadback.paymentRecords[0].status === 'pending', 'finance payment state mismatch', financeReadback);
  record('finance-payment-database-readback', { paymentCount: 1, paymentStatus: 'pending' });

  report.status = 'passed';
};

main().catch((error) => {
  report.error = { name: error?.name || 'Error', message: error?.message || String(error), details: error?.details || null };
  process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Order Write Scope Governance API Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
