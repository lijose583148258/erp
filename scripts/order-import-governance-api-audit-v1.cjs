const fs = require('fs');
const path = require('path');
const {
  createAuditPrismaClient,
  ensureUiAuditUser,
  resolveDefaultAccount,
} = require('./lib/ui-audit-user.cjs');

const baseUrl = String(process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/$/, '');
const reportPath = path.resolve(
  process.env.ORDER_IMPORT_GOVERNANCE_REPORT_PATH
    || path.join(process.cwd(), 'cloud-evidence', 'order-import-governance-api-audit-v1.json'),
);
const runId = `${Date.now()}-${process.pid}`;
const adminAccount = resolveDefaultAccount();
const managerAccount = {
  username: `order_import_manager_${runId}`,
  password: adminAccount.password,
  role: 'manager',
};

const report = {
  name: 'Order Import Governance API Audit',
  version: '1.0',
  status: 'failed',
  baseUrl,
  runId,
  startedAt: new Date().toISOString(),
  steps: [],
};

const record = (name, details = {}) => report.steps.push({ name, status: 'passed', ...details });

const request = async (endpoint, options = {}) => {
  const response = await fetch(`${baseUrl}/api/v1${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.data === undefined ? undefined : JSON.stringify(options.data),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 500) }; }
  return { status: response.status, ok: response.ok, json };
};

const expect = (condition, message, details) => {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
};

const expectStatus = (label, response, expected) => {
  expect(
    response.status === expected,
    `${label}: expected HTTP ${expected}, received ${response.status}`,
    response.json,
  );
  record(label, { httpStatus: response.status });
  return response.json?.data;
};

const login = async (account, label) => {
  const response = await request('/auth/login', {
    method: 'POST',
    data: { username: account.username, password: account.password },
  });
  const data = expectStatus(`login-${label}`, response, 200);
  const token = data?.accessToken || data?.token || response.json?.accessToken || response.json?.token;
  expect(Boolean(token), `login-${label}: token missing`, response.json);
  return { token, user: data?.user };
};

const createCustomer = async (token, suffix, overrides = {}) => {
  const response = await request('/customers', {
    method: 'POST',
    token,
    data: {
      name: `IMPORT-GOV-${suffix}-${runId}`,
      creditLimit: 50_000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'internal',
      status: 'active',
      ...overrides,
    },
  });
  const customer = expectStatus(`create-customer-${suffix}`, response, 201);
  expect(Number.isInteger(Number(customer?.id)), `create-customer-${suffix}: id missing`, customer);
  return customer;
};

const importOne = (token, customerId, productName, overrides = {}, idempotencyKey = `import-${productName}`) => request('/orders/import', {
  method: 'POST',
  token,
  headers: { 'idempotency-key': idempotencyKey.slice(0, 80) },
  data: {
    orders: [{
      customerId: Number(customerId),
      paymentTerms: 30,
      items: [{ productName, quantity: 2, unit: 'unit', unitPrice: 125, ...overrides }],
    }],
  },
});

const readOrderItems = async (productName) => {
  const prisma = createAuditPrismaClient();
  try {
    return await prisma.orderItem.findMany({
      where: { productName },
      include: { order: true },
    });
  } finally {
    await prisma.$disconnect();
  }
};

const expectNoOrder = async (label, productName) => {
  const rows = await readOrderItems(productName);
  expect(rows.length === 0, `${label}: rejected import persisted an order`, { count: rows.length });
  record(`${label}-database-readback`, { persistedRows: 0 });
};

const expectRowFailure = (label, response, messagePattern) => {
  const result = expectStatus(label, response, 200);
  expect(
    result?.success === 0 && result?.failed === 1 && result?.errors?.length === 1,
    `${label}: row result mismatch`,
    result,
  );
  expect(messagePattern.test(String(result.errors[0]?.message || '')), `${label}: error reason mismatch`, result);
};

const prepareManager = async () => {
  await ensureUiAuditUser(managerAccount);
  const prisma = createAuditPrismaClient();
  try {
    await prisma.user.update({
      where: { username: managerAccount.username },
      data: { segment: 'direct', mustChangePassword: false, isActive: true },
    });
  } finally {
    await prisma.$disconnect();
  }
};

const main = async () => {
  await ensureUiAuditUser(adminAccount);
  await prepareManager();

  const admin = await login(adminAccount, 'admin');
  const manager = await login(managerAccount, 'direct-manager');
  expect(manager.user?.role === 'manager', 'manager role mismatch', manager.user);
  expect(manager.user?.segment === 'direct', 'manager segment mismatch', manager.user);
  expect(manager.user?.permissions?.includes('orders.import'), 'manager missing orders.import', manager.user);
  record('verify-manager-import-capability', { role: manager.user.role, segment: manager.user.segment });

  const channelCustomer = await createCustomer(admin.token, 'CHANNEL', { segment: 'channel' });
  const directCustomer = await createCustomer(admin.token, 'DIRECT');
  const zeroCreditCustomer = await createCustomer(admin.token, 'ZERO-CREDIT', { creditLimit: 0 });

  const deniedProduct = `IMPORT-GOV-DENIED-${runId}`;
  const denied = await importOne(manager.token, channelCustomer.id, deniedProduct);
  expectRowFailure('reject-cross-segment-customer', denied, /outside your data scope/i);
  await expectNoOrder('reject-cross-segment-customer', deniedProduct);

  const invalidProduct = `IMPORT-GOV-INVALID-${runId}`;
  const invalid = await importOne(manager.token, directCustomer.id, invalidProduct, { quantity: -1 });
  expectStatus('reject-invalid-quantity-at-schema-boundary', invalid, 400);
  await expectNoOrder('reject-invalid-quantity-at-schema-boundary', invalidProduct);

  const acceptedProduct = `IMPORT-GOV-ACCEPTED-${runId}`;
  const accepted = await importOne(manager.token, directCustomer.id, acceptedProduct);
  const acceptedResult = expectStatus('accept-in-scope-credit-approved-row', accepted, 200);
  expect(
    acceptedResult?.success === 1 && acceptedResult?.failed === 0,
    'accepted import result mismatch',
    acceptedResult,
  );
  const acceptedRows = await readOrderItems(acceptedProduct);
  expect(acceptedRows.length === 1, 'accepted import database read-back mismatch', { count: acceptedRows.length });
  expect(Number(acceptedRows[0].order.customerId) === Number(directCustomer.id), 'accepted customer mismatch');
  expect(Number(acceptedRows[0].order.createdBy) === Number(manager.user.id), 'accepted creator mismatch');
  expect(Number(acceptedRows[0].order.finalAmount) === 250, 'accepted total mismatch');
  record('accept-in-scope-credit-approved-row-database-readback', {
    persistedRows: 1,
    orderId: acceptedRows[0].order.id,
    finalAmount: Number(acceptedRows[0].order.finalAmount),
  });

  const replayKey = `import-replay-${runId}`;
  const replayProduct = `IMPORT-GOV-REPLAY-${runId}`;
  const firstReplay = await importOne(manager.token, directCustomer.id, replayProduct, {}, replayKey);
  expectStatus('create-idempotent-import', firstReplay, 200);
  const exactReplay = await importOne(manager.token, directCustomer.id, replayProduct, {}, replayKey);
  expectStatus('exact-idempotent-replay', exactReplay, 200);
  const replayRows = await readOrderItems(replayProduct);
  expect(replayRows.length === 1, 'exact replay duplicated an order', { count: replayRows.length });
  record('exact-replay-database-readback', { persistedRows: 1, orderId: replayRows[0].order.id });

  const mismatchedReplay = await importOne(
    manager.token,
    directCustomer.id,
    replayProduct,
    { unitPrice: 126 },
    replayKey,
  );
  expectStatus('reject-idempotency-key-payload-mismatch', mismatchedReplay, 409);
  const mismatchRows = await readOrderItems(replayProduct);
  expect(mismatchRows.length === 1, 'payload mismatch created another order', { count: mismatchRows.length });
  record('payload-mismatch-database-readback', { persistedRows: 1 });

  const concurrentKey = `import-concurrent-${runId}`;
  const concurrentProduct = `IMPORT-GOV-CONCURRENT-${runId}`;
  const concurrentResponses = await Promise.all([
    importOne(manager.token, directCustomer.id, concurrentProduct, {}, concurrentKey),
    importOne(manager.token, directCustomer.id, concurrentProduct, {}, concurrentKey),
  ]);
  const concurrentStatuses = concurrentResponses.map(response => response.status).sort();
  expect(
    concurrentStatuses.every(status => status === 200 || status === 409)
      && concurrentStatuses.includes(200),
    'concurrent exact retries returned an unexpected status combination',
    concurrentResponses.map(response => ({ status: response.status, body: response.json })),
  );
  const concurrentRows = await readOrderItems(concurrentProduct);
  expect(concurrentRows.length === 1, 'concurrent exact retries duplicated an order', {
    count: concurrentRows.length,
    statuses: concurrentStatuses,
  });
  record('concurrent-exact-retry-database-readback', {
    httpStatuses: concurrentStatuses,
    persistedRows: 1,
    orderId: concurrentRows[0].order.id,
  });

  const creditDeniedProduct = `IMPORT-GOV-CREDIT-DENIED-${runId}`;
  const creditDenied = await importOne(manager.token, zeroCreditCustomer.id, creditDeniedProduct);
  expectRowFailure('reject-zero-credit-customer', creditDenied, /credit|信用额度/i);
  await expectNoOrder('reject-zero-credit-customer', creditDeniedProduct);

  report.status = 'passed';
};

main().catch((error) => {
  report.error = {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    details: error?.details || null,
  };
  process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Order Import Governance API Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
