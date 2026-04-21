const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'partial-receipt-browser-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'partial-receipt-browser-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const DATA = {
  supplierName: `UI-PART-SUP-${RUN_ID}`,
  purchaseItem: `UI-PART-RAW-${RUN_ID}`,
  customerName: `UI-PART-CUS-${RUN_ID}`,
  shipmentProduct: `UI-PART-FG-${RUN_ID}`,
  shipmentBatchNo: `UI-PART-BATCH-${RUN_ID}`,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  steps: [],
  data: DATA,
  status: 'running',
};

let authToken = '';

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

async function safeScreenshot(page, name) {
  const filePath = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function withTimebox(page, step, timeout, task) {
  const started = Date.now();
  try {
    const result = await Promise.race([
      task(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${step} exceeded ${timeout}ms`)), timeout)),
    ]);
    recordStep({ step, result: 'passed', timeout, durationMs: Date.now() - started });
    return result;
  } catch (error) {
    const entry = { step, result: 'failed', timeout, durationMs: Date.now() - started, error: String(error.message || error) };
    if (page) {
      try {
        entry.screenshot = await safeScreenshot(page, `fail-${step.replace(/[^a-z0-9-]/gi, '_')}`);
      } catch {}
    }
    recordStep(entry);
    throw error;
  }
}

async function apiFetch(page, endpoint, options = {}) {
  const response = await page.request.fetch(`${APP_URL}api${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {}),
    },
    data: options.data,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: response.ok(), status: response.status(), json };
}

function unwrapList(payload) {
  const data = payload?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function expectOk(page, label, endpoint, options = {}) {
  const response = await apiFetch(page, endpoint, options);
  if (!response.ok) throw new Error(`${label} failed: ${response.status} ${JSON.stringify(response.json)}`);
  return response.json?.data;
}

async function seedLoginState(page) {
  await withTimebox(page, 'seed-login-state', 15000, async () => {
    const loginResponse = await page.request.post(`${APP_URL}api/auth/login`, {
      data: { username: 'admin', password: 'admin123' },
    });
    if (!loginResponse.ok()) throw new Error(`login failed: ${loginResponse.status()}`);
    const loginJson = await loginResponse.json();
    authToken = loginJson?.data?.token;
    const user = loginJson?.data?.user;
    if (!authToken || !user) throw new Error('login returned empty token or user');

    await page.addInitScript(({ savedToken, savedUser }) => {
      const appUser = {
        id: String(savedUser.id),
        name: savedUser.username,
        role: savedUser.role,
        segment: savedUser.segment || 'mixed',
        avatar: savedUser.avatar || '',
      };
      window.localStorage.setItem('token', savedToken);
      window.localStorage.setItem('user', JSON.stringify(appUser));
      window.localStorage.setItem('auth_token', savedToken);
      window.localStorage.setItem('erp_auth_token', savedToken);
      window.localStorage.setItem('currentUser', JSON.stringify(savedUser));
      window.localStorage.setItem('erp_current_user', JSON.stringify(savedUser));
      window.localStorage.setItem('erp_current_role', savedUser.role || 'admin');
      window.localStorage.setItem('ailao.language', 'zh');
      window.localStorage.setItem('language', 'zh-CN');
      window.localStorage.setItem('currency', 'CNY');
    }, { savedToken: authToken, savedUser: user });
  });
}

async function loginApiToken(page, username, password) {
  const response = await page.request.post(`${APP_URL}api/auth/login`, {
    data: { username, password },
  });
  if (!response.ok()) throw new Error(`login token failed for ${username}: ${response.status()}`);
  const json = await response.json();
  const token = json?.data?.token;
  if (!token) throw new Error(`login token empty for ${username}`);
  return token;
}

async function resolveLocation(page, locationCode) {
  const warehouses = unwrapList({ json: { data: await expectOk(page, 'list warehouses', '/warehouses') } });
  for (const warehouse of warehouses) {
    const location = (warehouse.locations || []).find((item) => String(item.code) === locationCode);
    if (location) return location;
  }
  throw new Error(`location ${locationCode} not found`);
}

async function seedBusinessData(page) {
  return withTimebox(page, 'seed-business-data', 30000, async () => {
    const managerToken = await loginApiToken(page, 'manager', 'manager123');
    const supplier = await expectOk(page, 'create supplier', '/procurement/suppliers', {
      method: 'POST',
      data: {
        name: DATA.supplierName,
        nameZh: DATA.supplierName,
        category: 'Raw Materials',
        contact: `UI Buyer ${RUN_ID.slice(-4)}`,
      },
    });

    const purchaseOrder = await expectOk(page, 'create purchase order', '/procurement/orders', {
      method: 'POST',
      data: {
        supplierId: Number(supplier.id),
        item: DATA.purchaseItem,
        quantity: 8,
        unit: 'kg',
        price: 12,
        eta: '2026-05-30',
      },
    });
    await expectOk(page, 'approve purchase order', `/procurement/orders/${purchaseOrder.id}/status`, {
      method: 'PATCH',
      data: { status: 'approved' },
    });

    const customer = await expectOk(page, 'create customer', '/customers', {
      method: 'POST',
      data: {
        nameZh: DATA.customerName,
        nameEn: `UI Customer ${RUN_ID}`,
        licenseNumber: `UI-LIC-${RUN_ID}`,
        creditLimit: 1000000,
        riskLevel: 'low',
        segment: 'direct',
        poolState: 'internal',
        contactName: `UI Contact ${RUN_ID.slice(-4)}`,
        contactPhone: `09${RUN_ID.slice(-8)}`,
        addresses: [{
          type: 'shipping',
          label: 'shipping',
          countryCode: 'VN',
          city: 'Ho Chi Minh',
          fullAddress: 'UI partial shipment address',
        }],
      },
    });

    const salesOrder = await expectOk(page, 'create sales order', '/orders', {
      method: 'POST',
      data: {
        customerId: Number(customer.id),
        items: [{ productName: DATA.shipmentProduct, quantity: 8, unit: 'kg', unitPrice: 100 }],
        paymentTerms: 30,
        notes: `partial receipt browser audit ${RUN_ID}`,
      },
    });
    await expectOk(page, 'confirm sales order', `/orders/${salesOrder.id}/status`, {
      method: 'PATCH',
      data: { status: 'confirmed' },
      headers: { Authorization: `Bearer ${managerToken}` },
    });

    const fgLocation = await resolveLocation(page, 'LOC-FG');
    await expectOk(page, 'seed stock', '/warehouses/stock-balances', {
      method: 'POST',
      data: {
        locationId: Number(fgLocation.id),
        productName: DATA.shipmentProduct,
        batchNo: DATA.shipmentBatchNo,
        quantity: 10,
        unit: 'kg',
        note: `partial receipt browser audit ${RUN_ID}`,
      },
    });

    const shipment = await expectOk(page, 'create shipment', '/shipping', {
      method: 'POST',
      data: {
        customerId: Number(customer.id),
        orderId: Number(salesOrder.id),
        productName: DATA.shipmentProduct,
        quantity: 8,
        unit: 'kg',
        batchNo: DATA.shipmentBatchNo,
        carrier: `UI Carrier ${RUN_ID.slice(-4)}`,
      },
    });
    await expectOk(page, 'dispatch shipment', `/shipping/${shipment.id}/status`, {
      method: 'PATCH',
      data: { status: 'in_transit' },
    });

    report.seeded = {
      supplierId: String(supplier.id),
      purchaseOrderId: String(purchaseOrder.id),
      customerId: String(customer.id),
      salesOrderId: String(salesOrder.id),
      shipmentId: String(shipment.id),
    };
    return report.seeded;
  });
}

async function openRoute(page, route, expectedText) {
  await withTimebox(page, `open-${route}`, 20000, async () => {
    await page.goto(`${APP_URL}#${route}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.evaluate((nextRoute) => {
      window.location.hash = `#${nextRoute}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }, route);
    await page.locator('body').filter({ hasText: expectedText }).waitFor({ timeout: 20000 });
  });
}

async function verifyProcurementDrawer(page, purchaseOrderId) {
  await openRoute(page, 'procurement', '采购');
  await withTimebox(page, 'open-procurement-receipt-drawer', 25000, async () => {
    await page.getByTestId('procurement-tab-orders').click();
    const button = page.getByTestId(`purchase-order-receipts-${purchaseOrderId}`);
    await button.waitFor({ timeout: 20000 });
    await button.click();
    await page.getByTestId('purchase-receipt-drawer').waitFor({ timeout: 15000 });
    await page.getByTestId('purchase-receipt-quantity-input').waitFor({ timeout: 15000 });
    await page.waitForTimeout(700);
    await page.getByTestId('purchase-receipt-quantity-input').fill('3');
    await page.getByTestId('purchase-receipt-accepted-input').fill('3');
    await page.getByTestId('purchase-receipt-rejected-input').fill('0');
    await page.getByTestId('purchase-receipt-batch-input').fill(`UI-RAW-BATCH-${RUN_ID}`);
    const [postResponse] = await Promise.all([
      page.waitForResponse((response) => (
        response.url().includes(`/api/procurement/orders/${purchaseOrderId}/receipts`)
        && response.request().method() === 'POST'
      ), { timeout: 20000 }),
      page.getByTestId('purchase-receipt-save-button').click(),
    ]);
    if (!postResponse.ok()) {
      throw new Error(`purchase receipt post failed: ${postResponse.status()} ${await postResponse.text()}`);
    }
    await page.locator('[data-testid=\"purchase-receipt-drawer\"]').filter({ hasText: 'PRC-' }).waitFor({ timeout: 20000 });
  });
  const data = await expectOk(page, 'verify purchase receipts', `/procurement/orders/${purchaseOrderId}/receipts`);
  if (Number(data?.receiptSummary?.processedQuantity || 0) < 3) {
    throw new Error(`purchase receipt UI save did not read back processed quantity: ${JSON.stringify(data?.receiptSummary)}`);
  }
  report.procurementScreenshot = await safeScreenshot(page, 'procurement-receipt-drawer');
}

async function verifyShippingDrawer(page, shipmentId) {
  await openRoute(page, 'shipping', '出货');
  await withTimebox(page, 'open-shipping-receipt-drawer', 25000, async () => {
    const button = page.getByTestId(`shipment-receipts-button-${shipmentId}`);
    await button.waitFor({ timeout: 20000 });
    await button.click();
    await page.getByTestId('shipping-receipt-drawer').waitFor({ timeout: 15000 });
    await page.getByTestId('shipping-receipt-quantity-input').waitFor({ timeout: 15000 });
    await page.waitForTimeout(700);
    await page.getByTestId('shipping-receipt-quantity-input').fill('3');
    await page.getByTestId('shipping-receipt-accepted-input').fill('3');
    await page.getByTestId('shipping-receipt-rejected-input').fill('0');
    const [postResponse] = await Promise.all([
      page.waitForResponse((response) => (
        response.url().includes(`/api/shipping/${shipmentId}/receipt-events`)
        && response.request().method() === 'POST'
      ), { timeout: 20000 }),
      page.getByTestId('shipping-receipt-save-button').click(),
    ]);
    if (!postResponse.ok()) {
      throw new Error(`shipment receipt post failed: ${postResponse.status()} ${await postResponse.text()}`);
    }
    await page.locator('[data-testid=\"shipping-receipt-drawer\"]').filter({ hasText: 'SPR-' }).waitFor({ timeout: 20000 });
  });
  const data = await expectOk(page, 'verify shipment receipts', `/shipping/${shipmentId}/receipts`);
  if (Number(data?.receiptSummary?.processedQuantity || 0) < 3) {
    throw new Error(`shipment receipt UI save did not read back processed quantity: ${JSON.stringify(data?.receiptSummary)}`);
  }
  report.shippingScreenshot = await safeScreenshot(page, 'shipping-receipt-drawer');
}

async function run() {
  ensureDir(SHOT_DIR);
  let browser;
  try {
    const launch = await launchBrowserWithGuard({ recordStep });
    browser = launch.browser;
    report.browserLauncher = launch.launcher;
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.setDefaultTimeout(20000);

    await seedLoginState(page);
    const seeded = await seedBusinessData(page);
    await verifyProcurementDrawer(page, seeded.purchaseOrderId);
    await verifyShippingDrawer(page, seeded.shipmentId);

    report.status = 'passed';
  } catch (error) {
    if (error?.auditKind) markReportFromLaunchError(report, error);
    else {
      report.status = 'failed';
      report.error = String(error.message || error);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  }

  if (report.status !== 'passed') {
    console.error(report.error || report.blockerCode || 'partial receipt browser audit failed');
    process.exit(report.status === 'blocked_env' ? 0 : 1);
  }

  console.log(`Partial receipt browser audit passed. Report: ${REPORT_PATH}`);
}

run();
