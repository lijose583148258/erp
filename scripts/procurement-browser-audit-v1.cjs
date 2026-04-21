const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'procurement-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'procurement-audit-report-v1.json');

const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const DATA = {
  supplierName: `PO-SUP-${RUN_ID}`,
  supplierCategory: 'Cross Border Materials',
  supplierContact: `Buyer ${RUN_ID.slice(-4)}`,
  supplierPhone: `09${RUN_ID.slice(-8)}`,
  supplierEmail: `audit-${RUN_ID}@example.com`,
  customerName: `PO-CUS-${RUN_ID}`,
  aliasText: `Trade ${RUN_ID}`,
  purchaseItem: `PO-ITEM-${RUN_ID}`,
  purchaseQuantity: '18',
  purchasePrice: '3800',
};

const REQUIRED_ROUTE_COPY = ['\u91c7\u8d2d', '\u4f9b\u5e94\u5546', '\u91c7\u8d2d\u8ba2\u5355'];
const FORBIDDEN_MOJIBAKE = ['undefined', '\ufffd', '\u951f\u91d1\u62f7'];

const TIMEOUTS = {
  login: 15000,
  route: 20000,
  fill: 20000,
  save: 25000,
  api: 15000,
  readBack: 15000,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  data: DATA,
  steps: [],
  status: 'running',
};

let authToken = '';

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
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
    recordStep({ step, timeout, result: 'passed', durationMs: Date.now() - started });
    return result;
  } catch (error) {
    const entry = {
      step,
      timeout,
      result: 'failed',
      durationMs: Date.now() - started,
      error: String(error.message || error),
    };
    if (page) {
      try {
        entry.screenshot = await safeScreenshot(page, `fail-${step.replace(/[^a-z0-9-]/gi, '_')}`);
      } catch {}
    }
    recordStep(entry);
    throw error;
  }
}

async function seedLoginState(page) {
  return withTimebox(page, 'seed-login-state', TIMEOUTS.login, async () => {
    const loginResponse = await page.request.post(`${APP_URL}api/auth/login`, {
      data: { username: 'admin', password: 'admin123', role: 'super_admin' },
    });
    if (!loginResponse.ok()) throw new Error(`login api failed: ${loginResponse.status()}`);

    const loginJson = await loginResponse.json();
    const token = loginJson?.data?.token;
    const user = loginJson?.data?.user;
    if (!token || !user) throw new Error('login api returned empty token or user');
    authToken = token;

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
      window.localStorage.setItem('erp_current_role', savedUser.role || 'super_admin');
      window.localStorage.setItem('ailao.activeTab', 'procurement');
      window.localStorage.setItem('ailao.language', 'zh');
      window.localStorage.setItem('language', 'zh-CN');
      window.localStorage.setItem('currency', 'CNY');
    }, { savedToken: token, savedUser: user });
  });
}

async function apiFetch(page, endpoint, options = {}) {
  const method = options.method || 'GET';
  const response = await page.request.fetch(`${APP_URL}api${endpoint}`, {
    ...options,
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {}),
    },
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

function assertNoMojibake(text, scopeName) {
  for (const keyword of FORBIDDEN_MOJIBAKE) {
    if (text.includes(keyword)) {
      throw new Error(`${scopeName} contains mojibake: ${keyword}`);
    }
  }
  if (text.includes('undefined') || text.includes('\ufffd')) {
    throw new Error(`${scopeName} contains visible undefined or replacement char`);
  }
}

async function ensureLinkedSalesOrder(page) {
  return withTimebox(page, 'ensure-linked-sales-order', TIMEOUTS.api, async () => {
    const customerPayload = await apiFetch(page, '/customers', {
      method: 'POST',
      data: {
        nameZh: DATA.customerName,
        nameEn: `PO Customer ${RUN_ID}`,
        nameVi: `Khach PO ${RUN_ID}`,
        licenseNumber: `PO-LIC-${RUN_ID}`,
        creditLimit: 100000000,
        riskLevel: 'low',
        segment: 'mixed',
        poolState: 'internal',
        contactName: `PO Contact ${RUN_ID.slice(-4)}`,
        contactPhone: DATA.supplierPhone,
        contactEmail: `po-customer-${RUN_ID}@example.com`,
        addresses: [{
          id: `po-addr-${RUN_ID}`,
          type: 'legal',
          label: '注册地址',
          countryCode: 'VN',
          city: 'Ho Chi Minh',
          fullAddress: 'District 7, Ho Chi Minh City',
          isPrimary: true,
        }],
        contacts: [{
          name: `PO Contact ${RUN_ID.slice(-4)}`,
          phone: DATA.supplierPhone,
          email: `po-customer-${RUN_ID}@example.com`,
          language: 'zh',
          isPrimary: true,
        }],
        notes: `Created for procurement browser audit ${RUN_ID}`,
      },
    });
    if (!customerPayload.ok) throw new Error(`customer create failed: ${customerPayload.status}`);
    const customer = customerPayload.json?.data;
    if (!customer?.id) throw new Error('customer create returned empty id');
    report.customer = {
      id: String(customer.id),
      name: customer.name || DATA.customerName,
    };

    const createPayload = await apiFetch(page, '/orders', {
      method: 'POST',
      data: {
        customerId: Number(customer.id),
        items: [
          {
            productName: `B2B-SO-${RUN_ID}`,
            specification: 'AUTO-LINK',
            quantity: 3,
            unit: 'kg',
            unitPrice: 980,
          },
        ],
        paymentTerms: 30,
        notes: `Created for procurement audit ${RUN_ID}`,
      },
    });
    if (!createPayload.ok) throw new Error(`sales order create failed: ${createPayload.status}`);

    const created = createPayload.json?.data;
    report.salesOrder = {
      id: String(created.id),
      orderNo: created.orderNo || String(created.id),
      reused: false,
    };
    return report.salesOrder;
  });
}

async function openProcurement(page) {
  await withTimebox(page, 'open-procurement', TIMEOUTS.route, async () => {
    await page.goto(`${APP_URL}#procurement`, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.route });
    await page.evaluate(() => {
      window.localStorage.setItem('ailao.activeTab', 'procurement');
      window.location.hash = '#procurement';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    for (let index = 0; index < 30; index += 1) {
      const bodyText = await page.locator('body').innerText();
      const hasHeading = bodyText.includes(REQUIRED_ROUTE_COPY[0]);
      const hasTabs = bodyText.includes(REQUIRED_ROUTE_COPY[1]) && bodyText.includes(REQUIRED_ROUTE_COPY[2]);
      if (hasHeading && hasTabs) {
        assertNoMojibake(bodyText, 'procurement route');
        return;
      }
      await page.waitForTimeout(400);
    }
    throw new Error('procurement route not ready');
  });

  const shot = await safeScreenshot(page, 'procurement-route');
  recordStep({ step: 'procurement-route-evidence', result: 'passed', evidence: shot });
}

async function createSupplier(page) {
  return withTimebox(page, 'create-procurement-supplier', TIMEOUTS.save, async () => {
    await page.getByTestId('procurement-tab-suppliers').click();
    await page.getByTestId('supplier-name-input').fill(DATA.supplierName);
    await page.getByTestId('supplier-category-input').fill(DATA.supplierCategory);
    await page.getByTestId('supplier-contact-input').fill(DATA.supplierContact);
    await page.getByTestId('supplier-phone-input').fill(DATA.supplierPhone);
    await page.getByTestId('supplier-email-input').fill(DATA.supplierEmail);
    await page.getByTestId('supplier-address-label-input').fill('Legal');
    await page.getByTestId('supplier-country-code-input').fill('VN');
    await page.getByTestId('supplier-city-input').fill('Ho Chi Minh');
    await page.getByTestId('supplier-full-address-input').fill('District 7, Ho Chi Minh City');
    await page.getByTestId('save-supplier-button').click();

    let supplier = null;
    for (let index = 0; index < 20; index += 1) {
      const apiPayload = await apiFetch(page, `/procurement/suppliers?pageSize=20&search=${encodeURIComponent(DATA.supplierName)}`);
      if (!apiPayload.ok) throw new Error(`supplier readback failed: ${apiPayload.status}`);
      const suppliers = unwrapList(apiPayload);
      supplier = suppliers.find((item) => (item.name || '').includes(DATA.supplierName));
      if (supplier) break;
      await page.waitForTimeout(300);
    }
    if (!supplier) throw new Error('created supplier not found in API readback');

    report.supplier = { id: String(supplier.id), name: supplier.name };

    await page.getByTestId('procurement-supplier-search').fill(DATA.supplierName);
    await page.locator(`[data-testid="supplier-card-${supplier.id}"]`).waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
  });
}

async function selectOptionByValue(locator, value) {
  await locator.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
  await locator.selectOption(String(value));
}

async function createPurchaseOrder(page) {
  return withTimebox(page, 'create-procurement-order', TIMEOUTS.save, async () => {
    if (!report.supplier?.id) throw new Error('supplier id missing before purchase creation');
    if (!report.salesOrder?.id) throw new Error('sales order id missing before purchase creation');

    await page.getByTestId('procurement-tab-orders').click();
    await page.getByTestId('b2b-toggle').click();
    await selectOptionByValue(page.getByTestId('linked-sales-order-select'), report.salesOrder.id);
    await selectOptionByValue(page.getByTestId('purchase-supplier-select'), report.supplier.id);
    await page.getByTestId('purchase-item-input').fill(DATA.purchaseItem);
    await page.getByTestId('purchase-quantity-input').fill(DATA.purchaseQuantity);
    await page.getByTestId('purchase-price-input').fill(DATA.purchasePrice);
    await page.getByTestId('purchase-eta-input').fill('2026-04-30');
    await page.getByTestId('save-purchase-button').click();

    let order = null;
    for (let index = 0; index < 20; index += 1) {
      const apiPayload = await apiFetch(page, '/procurement/orders?pageSize=50');
      if (!apiPayload.ok) throw new Error(`purchase order readback failed: ${apiPayload.status}`);
      const orders = unwrapList(apiPayload);
      order = orders.find((item) => item.item === DATA.purchaseItem);
      if (order) break;
      await page.waitForTimeout(300);
    }
    if (!order) throw new Error('created purchase order not found in API readback');

    report.purchaseOrder = {
      id: String(order.id),
      status: order.status,
      salesOrderRef: order.salesOrderRef,
    };

    await page.locator(`[data-testid="purchase-order-card-${order.id}"]`).waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
  });
}

async function approvePurchaseOrder(page) {
  return withTimebox(page, 'approve-procurement-order', TIMEOUTS.save, async () => {
    const orderId = report.purchaseOrder?.id;
    if (!orderId) throw new Error('purchase order id missing before approve');

    await page.locator(`[data-testid="purchase-order-approve-${orderId}"]`).click();
    let order = null;
    for (let index = 0; index < 20; index += 1) {
      const apiPayload = await apiFetch(page, '/procurement/orders?pageSize=50');
      if (!apiPayload.ok) throw new Error(`purchase list after approve failed: ${apiPayload.status}`);
      const orders = unwrapList(apiPayload);
      order = orders.find((item) => String(item.id) === String(orderId));
      if (order && String(order.status) === 'approved') break;
      await page.waitForTimeout(300);
    }
    if (!order) throw new Error('approved order not found in API readback');
    if (String(order.status) !== 'approved') throw new Error(`expected approved, got ${order.status}`);
    report.purchaseOrder.status = order.status;
  });
}

async function dispatchPurchaseOrder(page) {
  return withTimebox(page, 'dispatch-procurement-order', TIMEOUTS.save, async () => {
    const orderId = report.purchaseOrder?.id;
    if (!orderId) throw new Error('purchase order id missing before dispatch');

    await page.locator(`[data-testid="purchase-order-dispatch-${orderId}"]`).click();
    let order = null;
    for (let index = 0; index < 20; index += 1) {
      const apiPayload = await apiFetch(page, '/procurement/orders?pageSize=50');
      if (!apiPayload.ok) throw new Error(`purchase list after dispatch failed: ${apiPayload.status}`);
      const orders = unwrapList(apiPayload);
      order = orders.find((item) => String(item.id) === String(orderId));
      if (order && String(order.status) === 'in_transit') break;
      await page.waitForTimeout(300);
    }
    if (!order) throw new Error('dispatched order not found in API readback');
    if (String(order.status) !== 'in_transit') throw new Error(`expected in_transit, got ${order.status}`);
    report.purchaseOrder.status = order.status;
  });
}

async function receivePurchaseOrder(page) {
  return withTimebox(page, 'receive-procurement-order', TIMEOUTS.save, async () => {
    const orderId = report.purchaseOrder?.id;
    if (!orderId) throw new Error('purchase order id missing before receive');

    await page.locator(`[data-testid="purchase-order-receipts-${orderId}"]`).click();
    await page.getByTestId('purchase-receipt-drawer').waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    await page.getByTestId('purchase-receipt-quantity-input').fill(DATA.purchaseQuantity);
    await page.getByTestId('purchase-receipt-accepted-input').fill(DATA.purchaseQuantity);
    await page.getByTestId('purchase-receipt-rejected-input').fill('0');
    await page.getByTestId('purchase-receipt-batch-input').fill(`PO-BATCH-${RUN_ID}`);
    await page.getByTestId('purchase-receipt-save-button').click();

    let bundle = null;
    for (let index = 0; index < 20; index += 1) {
      const apiPayload = await apiFetch(page, `/procurement/orders/${orderId}/receipts`);
      if (!apiPayload.ok) throw new Error(`purchase receipt readback failed: ${apiPayload.status}`);
      bundle = apiPayload.json?.data;
      if (
        bundle?.purchaseOrder
        && String(bundle.purchaseOrder.status) === 'received'
        && Number(bundle.receiptSummary?.receiptCount || 0) > 0
      ) break;
      await page.waitForTimeout(300);
    }
    if (!bundle?.purchaseOrder) throw new Error('received order not found in receipt readback');
    if (String(bundle.purchaseOrder.status) !== 'received') {
      throw new Error(`expected received, got ${bundle.purchaseOrder.status}`);
    }

    const receipt = Array.isArray(bundle.receipts)
      ? bundle.receipts.find((item) => Number(item.acceptedQuantity || 0) === Number(DATA.purchaseQuantity))
      : null;
    if (!receipt?.stockEntryRef || !receipt?.batchNo) {
      throw new Error(`receipt missing stock reference or batch number: ${JSON.stringify(bundle.receipts || [])}`);
    }

    report.purchaseOrder.status = bundle.purchaseOrder.status;
    report.purchaseReceipt = {
      receiptNo: receipt.receiptNo,
      stockEntryRef: receipt.stockEntryRef,
      batchNo: receipt.batchNo,
      acceptedQuantity: Number(receipt.acceptedQuantity || 0),
      rejectedQuantity: Number(receipt.rejectedQuantity || 0),
    };
  });
}

async function verifyProcurementReceipt(page) {
  return withTimebox(page, 'verify-procurement-receipt-stock', TIMEOUTS.readBack, async () => {
    const orderId = report.purchaseOrder?.id;
    if (!orderId) throw new Error('purchase order id missing before stock verification');
    const sourceRef = report.purchaseReceipt?.stockEntryRef;
    const batchNo = report.purchaseReceipt?.batchNo;
    if (!sourceRef || !batchNo) throw new Error('purchase receipt stock reference missing before stock verification');

    let lastEvidence = null;
    for (let index = 0; index < 20; index += 1) {
      const balancePayload = await apiFetch(
        page,
        `/warehouses/stock-balances?productName=${encodeURIComponent(DATA.purchaseItem)}&batchNo=${encodeURIComponent(batchNo)}&pageSize=100`,
      );
      if (!balancePayload.ok) throw new Error(`stock balance readback failed: ${balancePayload.status}`);
      const balances = unwrapList(balancePayload).filter((item) => (
        String(item.productName) === DATA.purchaseItem && String(item.batchNo) === batchNo
      ));
      const totalQuantity = balances.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const rawLocation = balances.find((item) => String(item.locationCode || '') === 'LOC-RAW');

      const entryPayload = await apiFetch(
        page,
        `/warehouses/stock-entries?sourceType=procurement_receipt&sourceRef=${encodeURIComponent(sourceRef)}&limit=200`,
      );
      if (!entryPayload.ok) throw new Error(`stock entry readback failed: ${entryPayload.status}`);
      const entries = unwrapList(entryPayload).filter((entry) => (
        String(entry.sourceType) === 'procurement_receipt' && String(entry.sourceRef) === sourceRef
      ));
      const entry = entries[0];
      const movement = Array.isArray(entry?.movements)
        ? entry.movements.find((item) => (
            String(item.productName) === DATA.purchaseItem
            && String(item.batchNo) === batchNo
            && Number(item.quantityDelta || 0) === Number(DATA.purchaseQuantity)
          ))
        : null;

      lastEvidence = {
        sourceRef,
        batchNo,
        entryCount: entries.length,
        totalQuantity,
        hasRawLocation: Boolean(rawLocation),
        hasMovement: Boolean(movement),
        entryNo: entry?.entryNo,
        locationCode: rawLocation?.locationCode,
        locationName: rawLocation?.locationName,
      };

      if (entries.length === 1 && totalQuantity >= Number(DATA.purchaseQuantity) && rawLocation && movement) {
        report.receiptEvidence = {
          sourceRef,
          batchNo,
          entryNo: entry.entryNo,
          totalQuantity,
          locationCode: rawLocation.locationCode,
          locationName: rawLocation.locationName,
        };
        return;
      }

      await page.waitForTimeout(300);
    }

    throw new Error(`receipt stock evidence not stable: ${JSON.stringify(lastEvidence)}`);
  });
}

async function run() {
  ensureDir(SHOT_DIR);
  let browser;
  let page = null;
  try {
    const launched = await launchBrowserWithGuard({
      recordStep,
      retryLimit: 1,
      waitMs: 800,
    });
    browser = launched.browser;
    report.launcher = launched.launcher;
    page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await seedLoginState(page);
    await ensureLinkedSalesOrder(page);
    await openProcurement(page);
    await createSupplier(page);
    await createPurchaseOrder(page);
    await approvePurchaseOrder(page);
    await dispatchPurchaseOrder(page);
    await receivePurchaseOrder(page);
    await verifyProcurementReceipt(page);
    recordStep({
      step: 'procurement-final-evidence',
      result: 'passed',
      evidence: await safeScreenshot(page, 'procurement-final'),
      supplierId: report.supplier?.id,
      purchaseOrderId: report.purchaseOrder?.id,
      salesOrderId: report.salesOrder?.id,
      receiptEvidence: report.receiptEvidence,
    });
    report.status = 'passed';
  } catch (error) {
    markReportFromLaunchError(report, error);
  } finally {
    report.finishedAt = new Date().toISOString();
    if (browser) await browser.close().catch(() => {});
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'procurement browser audit failed');
    if (report.status !== 'blocked_env') {
      process.exit(1);
    }
    console.warn(`Procurement browser audit blocked by environment. Report: ${REPORT_PATH}`);
    return;
  }

  console.log(`Procurement browser audit passed. Report: ${REPORT_PATH}`);
}

run();

