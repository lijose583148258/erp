const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'shipping-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'shipping-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const DATA = {
  ocrTrackingNo: `OCR-${RUN_ID}`,
  linkedTrackingNo: `LINK-${RUN_ID}`,
  ocrProduct: `SHIP-OCR-${RUN_ID}`,
  linkedProduct: `SHIP-LINK-${RUN_ID}`,
  customerName: `SHIP-BROWSER-CUS-${RUN_ID}`,
  batchNo: `SHIP-BROWSER-BATCH-${RUN_ID}`,
  stockQuantity: 24,
  carrier: `AUDIT-CARRIER-${RUN_ID.slice(-4)}`,
  quantity: 12,
};

const REQUIRED_ROUTE_COPY = ['\u53d1\u8d27', 'OCR', '\u8bc6\u522b\u9884\u89c8'];
// Keep the legacy corruption markers in one place so the shipping audit stays readable.
const MOJIBAKE_MARKERS = [
  'undefined',
  '\ufffd',
  '\u951f\u91d1\u62f7',
];

const TIMEOUTS = {
  login: 15000,
  route: 20000,
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

let managerAuth = null;
let salesAuth = null;

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

async function loginApi(page, username, password) {
  const response = await page.request.post(`${APP_URL}api/auth/login`, {
    data: { username, password },
  });
  if (!response.ok()) {
    throw new Error(`login failed for ${username}: ${response.status()}`);
  }
  const json = await response.json();
  const token = json?.data?.token;
  const user = json?.data?.user;
  if (!token || !user) {
    throw new Error(`empty login payload for ${username}`);
  }
  return { token, user };
}

async function seedManagerLoginState(page) {
  return withTimebox(page, 'seed-manager-login-state', TIMEOUTS.login, async () => {
    managerAuth = await loginApi(page, 'manager', 'manager123');
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
      window.localStorage.setItem('erp_current_role', savedUser.role || 'manager');
      window.localStorage.setItem('ailao.activeTab', 'shipping');
      window.localStorage.setItem('ailao.language', 'zh');
      window.localStorage.setItem('language', 'zh-CN');
      window.localStorage.setItem('currency', 'CNY');
    }, { savedToken: managerAuth.token, savedUser: managerAuth.user });
  });
}

async function apiFetch(page, endpoint, options = {}, token = managerAuth?.token) {
  const response = await page.request.fetch(`${APP_URL}api${endpoint}`, {
    ...options,
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  for (const keyword of MOJIBAKE_MARKERS) {
    if (text.includes(keyword)) {
      throw new Error(`${scopeName} contains mojibake: ${keyword}`);
    }
  }
}

const compactText = (value, limit = 800) => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, limit);

async function ensureSalesAuth(page) {
  if (!salesAuth) {
    salesAuth = await loginApi(page, 'sales', 'sales123');
  }
  return salesAuth;
}

async function createAuditCustomer(page, token) {
  const payload = await apiFetch(page, '/customers', {
    method: 'POST',
    data: {
      nameZh: DATA.customerName,
      nameEn: `Shipping Browser Customer ${RUN_ID}`,
      nameVi: `Khach Giao Hang Browser ${RUN_ID}`,
      licenseNumber: `SHIP-BROWSER-LIC-${RUN_ID}`,
      creditLimit: 100000000,
      riskLevel: 'low',
      segment: 'mixed',
      poolState: 'private',
      contactName: `Browser Ship Contact ${RUN_ID.slice(-4)}`,
      contactPhone: `09${RUN_ID.slice(-8)}`,
      contactEmail: `shipping-browser-${RUN_ID}@example.com`,
      addresses: [{
        id: `ship-browser-addr-${RUN_ID}`,
        type: 'shipping',
        label: '发货地址',
        countryCode: 'VN',
        city: 'Ho Chi Minh',
        fullAddress: 'Browser Audit Shipping Address, Ho Chi Minh City',
        isPrimary: true,
      }],
      contacts: [{
        name: `Browser Ship Contact ${RUN_ID.slice(-4)}`,
        phone: `09${RUN_ID.slice(-8)}`,
        email: `shipping-browser-${RUN_ID}@example.com`,
        language: 'zh',
        isPrimary: true,
      }],
      notes: `发货浏览器审计专用客户 ${RUN_ID}`,
    },
  }, token);
  if (!payload.ok) throw new Error(`create audit customer failed: ${payload.status}`);
  const customer = payload.json?.data;
  if (!customer?.id) throw new Error('create audit customer returned empty id');
  return customer;
}

async function resolveLocation(page, locationCode) {
  const payload = await apiFetch(page, '/warehouses');
  if (!payload.ok) throw new Error(`warehouse list failed: ${payload.status}`);
  const warehouses = unwrapList(payload);
  for (const warehouse of warehouses) {
    const locations = Array.isArray(warehouse.locations) ? warehouse.locations : [];
    const location = locations.find((item) => String(item.code) === locationCode);
    if (location) return location;
  }
  throw new Error(`location ${locationCode} not found`);
}

async function seedLinkedShipmentStock(page) {
  return withTimebox(page, 'seed-linked-shipment-stock', TIMEOUTS.api, async () => {
    const location = await resolveLocation(page, 'LOC-FG');
    const payload = await apiFetch(page, '/warehouses/stock-balances', {
      method: 'POST',
      data: {
        locationId: Number(location.id),
        productName: DATA.linkedProduct,
        batchNo: DATA.batchNo,
        quantity: DATA.stockQuantity,
        unit: 'kg',
        note: `Shipping browser audit seed ${RUN_ID}`,
      },
    });
    if (!payload.ok) throw new Error(`seed linked shipment stock failed: ${payload.status}`);
    report.seededStock = {
      locationId: String(location.id),
      locationCode: location.code,
      productName: DATA.linkedProduct,
      batchNo: DATA.batchNo,
      quantity: DATA.stockQuantity,
    };
  });
}

async function ensureConfirmedOrder(page) {
  return withTimebox(page, 'ensure-confirmed-shipping-order', TIMEOUTS.api, async () => {
    const sales = await ensureSalesAuth(page);
    const customer = await createAuditCustomer(page, sales.token);

    const createOrderPayload = await apiFetch(page, '/orders', {
      method: 'POST',
      data: {
        customerId: Number(customer.id),
        items: [
          {
            productName: DATA.linkedProduct,
            specification: 'AUTO-SHIPPING',
            quantity: DATA.quantity,
            unit: 'kg',
            unitPrice: 260,
          },
        ],
        paymentTerms: 30,
        notes: `Shipping audit ${RUN_ID}`,
      },
    }, sales.token);

    if (!createOrderPayload.ok) {
      throw new Error(`create shipping order failed: ${createOrderPayload.status}`);
    }

    const createdOrder = createOrderPayload.json?.data;
    if (!createdOrder?.id) throw new Error('shipping order create returned empty id');

    if (!managerAuth) throw new Error('manager auth missing');
    const confirmPayload = await apiFetch(page, `/orders/${createdOrder.id}/status`, {
      method: 'PATCH',
      data: { status: 'confirmed' },
    }, managerAuth.token);
    if (!confirmPayload.ok) {
      throw new Error(`confirm shipping order failed: ${confirmPayload.status}`);
    }

    report.order = {
      id: String(createdOrder.id),
        orderNo: createdOrder.orderNo || String(createdOrder.id),
        customerId: String(customer.id),
        customerName: customer.nameZh || customer.nameEn || customer.name,
    };
  });
}

async function createLinkedShipmentViaApi(page) {
  return withTimebox(page, 'create-linked-shipment-via-api', TIMEOUTS.api, async () => {
    if (!report.order?.id || !report.order?.customerId) {
      throw new Error('confirmed order missing before linked shipment creation');
    }
    const payload = await apiFetch(page, '/shipping', {
      method: 'POST',
      data: {
        customerId: Number(report.order.customerId),
        orderId: Number(report.order.id),
        productName: DATA.linkedProduct,
        quantity: DATA.quantity,
        unit: 'kg',
        batchNo: DATA.batchNo,
        carrier: DATA.carrier,
        trackingNo: DATA.linkedTrackingNo,
      },
    });
    if (!payload.ok) {
      throw new Error(`linked shipment create failed: ${payload.status}`);
    }
    const shipment = payload.json?.data;
    report.linkedShipment = {
      id: String(shipment.id),
      shipmentNo: shipment.shipmentNo,
      trackingNo: shipment.trackingNo,
      status: shipment.status,
      batchNo: shipment.batchNo || DATA.batchNo,
    };
  });
}

async function openShipping(page) {
  await withTimebox(page, 'open-shipping', TIMEOUTS.route, async () => {
    await page.goto(`${APP_URL}#shipping`, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.route });
    await page.evaluate(() => {
      window.localStorage.setItem('ailao.activeTab', 'shipping');
      window.location.hash = '#shipping';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    for (let index = 0; index < 30; index += 1) {
      const bodyText = await page.locator('body').innerText();
      const hasRequired = REQUIRED_ROUTE_COPY.every((item) => bodyText.includes(item));
      if (hasRequired) {
        assertNoMojibake(bodyText, 'shipping route');
        return;
      }
      await page.waitForTimeout(400);
    }
    throw new Error('shipping route not ready');
  });
  recordStep({ step: 'shipping-route-evidence', result: 'passed', evidence: await safeScreenshot(page, 'shipping-route') });
}

async function createShipmentViaOcr(page) {
  return withTimebox(page, 'create-shipment-via-ocr', TIMEOUTS.save, async () => {
    const customerName = report.order?.customerName;
    if (!customerName) throw new Error('customer name missing for OCR create');

    const ocrText = [
      `\u5ba2\u6237\u540d\u79f0: ${customerName}`,
      `\u4ea7\u54c1: ${DATA.ocrProduct}`,
      `\u6570\u91cf: ${DATA.quantity} \u4ef6`,
      `\u627f\u8fd0\u5546: ${DATA.carrier}`,
      `\u8ffd\u8e2a\u53f7: ${DATA.ocrTrackingNo}`,
    ].join('\n');

    await page.getByTestId('shipping-tab-logistics').click();
    await page.getByTestId('shipping-ocr-textarea').fill(ocrText);
    await page.getByTestId('shipping-ocr-parse-button').click();
    await page.waitForTimeout(1400);
    const applyButton = page.getByTestId('shipping-ocr-apply-button');
    await applyButton.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    await applyButton.scrollIntoViewIfNeeded();
    const previewText = await applyButton.locator('..').innerText().catch(() => '');
    const createResponsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/shipping') && response.request().method() === 'POST'
    ), { timeout: 8000 }).catch(() => null);
    await applyButton.click();
    const createResponse = await createResponsePromise;
    if (!createResponse) {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      recordStep({
        step: 'shipping-ocr-submit-request-evidence',
        result: 'failed',
        reason: 'no-post-after-apply',
        expectedTrackingNo: DATA.ocrTrackingNo,
        expectedCustomerName: customerName,
        previewText: compactText(previewText),
        bodyText: compactText(bodyText, 1200),
      });
      throw new Error('OCR apply did not submit POST /api/shipping; check customer matching, validation toast, or stale customer list');
    }
    if (createResponse && !createResponse.ok()) {
      throw new Error(`OCR shipment create failed: ${createResponse.status()}`);
    }
    recordStep({
      step: 'shipping-ocr-submit-request-evidence',
      result: 'passed',
      status: createResponse.status(),
      expectedTrackingNo: DATA.ocrTrackingNo,
      expectedCustomerName: customerName,
      previewText: compactText(previewText),
    });

    let shipment = null;
    for (let index = 0; index < 20; index += 1) {
      const payload = await apiFetch(page, '/shipping?pageSize=50');
      if (!payload.ok) throw new Error(`shipping readback after OCR failed: ${payload.status}`);
      const shipments = unwrapList(payload);
      shipment = shipments.find((item) => item.trackingNo === DATA.ocrTrackingNo);
      if (shipment) break;
      await page.waitForTimeout(400);
    }
    if (!shipment) throw new Error('OCR created shipment not found');
    report.ocrShipment = {
      id: String(shipment.id),
      trackingNo: shipment.trackingNo,
      status: shipment.status,
    };
  });
}

function createReceiptFixture() {
  const filePath = path.join(SHOT_DIR, `receipt-${RUN_ID}.png`);
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9qsKQAAAAASUVORK5CYII=';
  fs.writeFileSync(filePath, Buffer.from(pngBase64, 'base64'));
  return filePath;
}

async function dispatchLinkedShipment(page) {
  return withTimebox(page, 'dispatch-linked-shipment', TIMEOUTS.save, async () => {
    if (!report.linkedShipment?.id) throw new Error('linked shipment id missing');

    await page.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUTS.route });
    await page.locator(`[data-testid="shipment-dispatch-${report.linkedShipment.id}"]`).waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    await page.locator(`[data-testid="shipment-dispatch-${report.linkedShipment.id}"]`).click();

    let shipment = null;
    for (let index = 0; index < 20; index += 1) {
      const payload = await apiFetch(page, `/shipping?pageSize=50&orderId=${report.order.id}`);
      if (!payload.ok) throw new Error(`shipping readback after dispatch failed: ${payload.status}`);
      const shipments = unwrapList(payload);
      shipment = shipments.find((item) => String(item.id) === String(report.linkedShipment.id));
      if (shipment && shipment.status === 'in_transit') break;
      await page.waitForTimeout(400);
    }
    if (!shipment) throw new Error('linked shipment not found after dispatch');
    if (shipment.status !== 'in_transit') throw new Error(`expected in_transit, got ${shipment.status}`);
    report.linkedShipment.status = shipment.status;
    report.linkedShipment.batchNo = shipment.batchNo || DATA.batchNo;
  });
}

async function verifyShippingIssue(page) {
  return withTimebox(page, 'verify-linked-shipment-stock-issue', TIMEOUTS.readBack, async () => {
    const shipmentNo = report.linkedShipment?.shipmentNo;
    if (!shipmentNo) throw new Error('linked shipmentNo missing before stock issue verification');
    const expectedRemaining = DATA.stockQuantity - DATA.quantity;

    const balancePayload = await apiFetch(
      page,
      `/warehouses/stock-balances?productName=${encodeURIComponent(DATA.linkedProduct)}&batchNo=${encodeURIComponent(DATA.batchNo)}&pageSize=100`,
    );
    if (!balancePayload.ok) throw new Error(`stock balance readback failed: ${balancePayload.status}`);
    const balances = unwrapList(balancePayload).filter((item) => (
      String(item.productName) === DATA.linkedProduct && String(item.batchNo) === DATA.batchNo
    ));
    const fgBalance = balances.find((item) => String(item.locationCode || '') === 'LOC-FG');
    if (!fgBalance) throw new Error(`finished goods balance not found for ${DATA.linkedProduct}/${DATA.batchNo}`);
    const remainingQuantity = Number(fgBalance.quantity || 0);
    if (remainingQuantity !== expectedRemaining) {
      throw new Error(`expected remaining stock ${expectedRemaining}, got ${remainingQuantity}`);
    }

    const entryPayload = await apiFetch(
      page,
      `/warehouses/stock-entries?sourceType=shipping_issue&sourceRef=${encodeURIComponent(shipmentNo)}&limit=200`,
    );
    if (!entryPayload.ok) throw new Error(`stock entry readback failed: ${entryPayload.status}`);
    const entries = unwrapList(entryPayload).filter((entry) => (
      String(entry.sourceType) === 'shipping_issue' && String(entry.sourceRef) === String(shipmentNo)
    ));
    if (entries.length !== 1) {
      throw new Error(`expected exactly one shipping issue entry, got ${entries.length}`);
    }
    const movement = Array.isArray(entries[0].movements)
      ? entries[0].movements.find((item) => (
          String(item.productName) === DATA.linkedProduct
          && String(item.batchNo) === DATA.batchNo
          && Number(item.quantityDelta || 0) === -Number(DATA.quantity)
        ))
      : null;
    if (!movement) throw new Error(`shipping issue entry missing matching movement: ${shipmentNo}`);

    report.issueEvidence = {
      sourceRef: shipmentNo,
      entryNo: entries[0].entryNo,
      entryCount: entries.length,
      remainingQuantity,
      locationCode: fgBalance.locationCode,
    };
  });
}

async function uploadReceiptViaUi(page) {
  return withTimebox(page, 'upload-linked-shipment-receipt', TIMEOUTS.save, async () => {
    if (!report.linkedShipment?.id) throw new Error('linked shipment id missing before receipt upload');
    const proofPath = createReceiptFixture();

    await page.locator(`[data-testid="shipment-receipt-button-${report.linkedShipment.id}"]`).waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    await page.locator(`[data-testid="shipment-receipt-button-${report.linkedShipment.id}"]`).click();
    await page.getByTestId('shipment-receipt-input').setInputFiles(proofPath);

    let shipment = null;
    for (let index = 0; index < 20; index += 1) {
      const payload = await apiFetch(page, `/shipping?pageSize=50&orderId=${report.order.id}`);
      if (!payload.ok) throw new Error(`shipping readback after receipt failed: ${payload.status}`);
      const shipments = unwrapList(payload);
      shipment = shipments.find((item) => String(item.id) === String(report.linkedShipment.id));
      if (shipment && shipment.status === 'delivered' && shipment.signedReceiptUrl) break;
      await page.waitForTimeout(500);
    }
    if (!shipment) throw new Error('linked shipment not found after receipt upload');
    if (shipment.status !== 'delivered') throw new Error(`expected delivered, got ${shipment.status}`);
    if (!shipment.signedReceiptUrl) throw new Error('signedReceiptUrl missing after receipt upload');
    report.linkedShipment.status = shipment.status;
    report.linkedShipment.signedReceiptUrl = shipment.signedReceiptUrl;

    const orderPayload = await apiFetch(page, `/orders/${report.order.id}`);
    if (!orderPayload.ok) throw new Error(`order readback after delivery failed: ${orderPayload.status}`);
    const order = orderPayload.json?.data;
    if (!order) throw new Error('order readback empty');
    report.order.status = order.status;
    if (String(order.status) !== 'delivered') {
      throw new Error(`expected linked order delivered, got ${order.status}`);
    }
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
    report.spawnPolicyProbe = launched.spawnPolicyProbe || null;
    page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await seedManagerLoginState(page);
    await ensureConfirmedOrder(page);
    await seedLinkedShipmentStock(page);
    await createLinkedShipmentViaApi(page);
    await openShipping(page);
    await createShipmentViaOcr(page);
    await dispatchLinkedShipment(page);
    await verifyShippingIssue(page);
    await uploadReceiptViaUi(page);
    recordStep({
      step: 'shipping-final-evidence',
      result: 'passed',
      evidence: await safeScreenshot(page, 'shipping-final'),
      orderId: report.order?.id,
      linkedShipmentId: report.linkedShipment?.id,
      ocrShipmentId: report.ocrShipment?.id,
      issueEvidence: report.issueEvidence,
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
    console.error(report.error || 'shipping browser audit failed');
    if (report.status !== 'blocked_env') {
      process.exit(1);
    }
    console.warn(`Shipping browser audit blocked by environment. Report: ${REPORT_PATH}`);
    return;
  }

  console.log(`Shipping browser audit passed. Report: ${REPORT_PATH}`);
}

run();

