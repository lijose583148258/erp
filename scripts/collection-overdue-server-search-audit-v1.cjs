const fs = require('fs');
const path = require('path');
const { createAuditRuntime } = require('./lib/audit-runtime-utils.cjs');

const ROOT = process.cwd();
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const REPORT_PATH = path.join(OUTPUT_DIR, 'collection-overdue-server-search-audit-v1.json');
const STEP_TIMEOUT_MS = 30_000;
const ADMIN = { username: 'admin', password: 'admin123' };
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${process.pid}_${Math.random().toString(36).slice(2, 7)}`;
const runtimeDbPath = process.env.AILAODA_RUNTIME_DB_PATH || 'D:/AilaoDaRuntime/stable.db';
process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${runtimeDbPath.replace(/\\/g, '/')}`;
const { PrismaClient } = require(path.join(ROOT, 'backend', 'node_modules', '@prisma', 'client'));

const report = {
  name: 'collection-overdue-server-search-audit-v1',
  appUrl: APP_URL,
  runtimeDbPath,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  status: 'running',
  steps: [],
};

const runtime = createAuditRuntime({
  appUrl: APP_URL,
  outputDir: OUTPUT_DIR,
  report,
  reportPath: REPORT_PATH,
  requestTimeoutMs: 10_000,
});

async function loginAdmin() {
  return runtime.withTimeout('api-login-admin', STEP_TIMEOUT_MS, async () => {
    const response = await runtime.apiFetch('/auth/login', {
      method: 'POST',
      data: ADMIN,
    });
    runtime.expectStatus(response, [200], 'admin login');
    const data = runtime.dataOf(response);
    runtime.expect(Boolean(data?.token), 'admin login returned no token', response.json);
    return data.token;
  });
}

async function seedHiddenOverdueOrder(token, prisma) {
  return runtime.withTimeout('seed-hidden-overdue-order', STEP_TIMEOUT_MS * 2, async () => {
    const customerResponse = await runtime.apiFetch('/customers', {
      method: 'POST',
      data: {
        nameZh: `SRCH-${RUN_ID}-客户`,
        nameEn: `SRCH-${RUN_ID} Customer`,
        nameVi: `SRCH-${RUN_ID} Khach Hang`,
        licenseNumber: `LIC-SRCH-${RUN_ID}`.slice(0, 64),
        creditLimit: 50000,
        riskLevel: 'medium',
        segment: 'direct',
        contactName: `Search Contact ${RUN_ID}`,
        contactPhone: `090${String(Date.now()).slice(-7)}`,
        contactEmail: `search-${RUN_ID}@example.com`,
        address: `Search audit address ${RUN_ID}`,
        status: 'active',
      },
    }, token);
    runtime.expectStatus(customerResponse, [201], 'create search customer');
    const customer = runtime.dataOf(customerResponse);
    runtime.expect(Boolean(customer?.id), 'search customer create returned no id', customerResponse.json);

    const createOrder = async (lineName) => runtime.apiFetch('/orders', {
      method: 'POST',
      data: {
        customerId: Number(customer.id),
        items: [{
          productName: lineName,
          specification: 'server-search-audit',
          quantity: 12,
          unit: 'kg',
          unitPrice: 100,
        }],
        paymentTerms: 1,
        notes: `collection overdue server search audit ${RUN_ID}`,
      },
    }, token);

    const orderResponse = await createOrder(`SRCH-${RUN_ID}-胶水-A`);
    runtime.expectStatus(orderResponse, [201], 'create search order');
    const order = runtime.dataOf(orderResponse);
    runtime.expect(Boolean(order?.id), 'search order create returned no id', orderResponse.json);

    const secondOrderResponse = await createOrder(`SRCH-${RUN_ID}-胶水-B`);
    runtime.expectStatus(secondOrderResponse, [201], 'create second search order');
    const secondOrder = runtime.dataOf(secondOrderResponse);
    runtime.expect(Boolean(secondOrder?.id), 'second search order create returned no id', secondOrderResponse.json);

    await prisma.order.updateMany({
      where: { id: { in: [Number(order.id), Number(secondOrder.id)] } },
      data: {
        createdAt: new Date(Date.now() - 10 * 24 * 3600 * 1000),
        updatedAt: new Date(),
      },
    });

    const syncResponse = await runtime.apiFetch('/collections/sync-overdue', { method: 'POST' }, token);
    runtime.expectStatus(syncResponse, [200], 'sync overdue after server-search seed');

    report.seeded = {
      customerId: Number(customer.id),
      orderId: Number(order.id),
      secondOrderId: Number(secondOrder.id),
      orderNo: order.orderNo,
      customerNameEn: `SRCH-${RUN_ID} Customer`,
    };
    return report.seeded;
  });
}

async function assertServerSearch(token, seed) {
  return runtime.withTimeout('api-overdue-server-search-readback', STEP_TIMEOUT_MS, async () => {
    const byOrder = await runtime.apiFetch(`/collections/overdue?pageSize=1&search=${encodeURIComponent(seed.orderNo)}`, {}, token);
    runtime.expectStatus(byOrder, [200], 'overdue search by order no');
    const orderRows = runtime.listOf(byOrder);
    runtime.expect(orderRows.some((row) => Number(row.orderId) === Number(seed.orderId)), 'server search by orderNo did not find seeded overdue order', {
      orderId: seed.orderId,
      orderNo: seed.orderNo,
      rows: orderRows,
    });

    const byCustomer = await runtime.apiFetch(`/collections/overdue?pageSize=1&page=1&search=${encodeURIComponent(seed.customerNameEn)}`, {}, token);
    runtime.expectStatus(byCustomer, [200], 'overdue search by customer');
    const customerRows = runtime.listOf(byCustomer);
    const customerMeta = byCustomer.json?.meta || {};
    runtime.expect(Number(customerMeta.total) >= 2, 'server search by customer did not return paginated total for both seeded orders', {
      customerNameEn: seed.customerNameEn,
      meta: customerMeta,
      rows: customerRows,
    });

    const byCustomerPage2 = await runtime.apiFetch(`/collections/overdue?pageSize=1&page=2&search=${encodeURIComponent(seed.customerNameEn)}`, {}, token);
    runtime.expectStatus(byCustomerPage2, [200], 'overdue search by customer page 2');
    const customerRowsPage2 = runtime.listOf(byCustomerPage2);
    const foundIds = [...customerRows, ...customerRowsPage2].map((row) => Number(row.orderId));
    runtime.expect(foundIds.includes(Number(seed.orderId)) && foundIds.includes(Number(seed.secondOrderId)), 'server pagination did not expose both seeded overdue orders across pages', {
      orderId: seed.orderId,
      secondOrderId: seed.secondOrderId,
      customerNameEn: seed.customerNameEn,
      page1: customerRows,
      page2: customerRowsPage2,
      meta: customerMeta,
    });

    report.readback = {
      orderSearchCount: orderRows.length,
      customerSearchCount: customerRows.length,
      customerSearchPage2Count: customerRowsPage2.length,
      customerSearchMeta: customerMeta,
      foundOrderId: seed.orderId,
      foundIds,
    };
  });
}

async function main() {
  let prisma = null;
  try {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    prisma = new PrismaClient();
    const token = await loginAdmin();
    const seed = await seedHiddenOverdueOrder(token, prisma);
    await assertServerSearch(token, seed);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = {
      message: String(error?.message || error),
      details: error?.details || null,
      stack: error?.stack || null,
    };
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {});
    await runtime.saveReport();
  }

  console.log(`Collection overdue server-search audit ${report.status}. Report: ${REPORT_PATH}`);
  if (report.status !== 'passed') process.exitCode = 1;
}

main().catch((error) => {
  report.status = 'failed';
  report.failure = { message: String(error?.message || error), stack: error?.stack || null };
  runtime.saveReport().finally(() => {
    console.error(error);
    process.exit(1);
  });
});
