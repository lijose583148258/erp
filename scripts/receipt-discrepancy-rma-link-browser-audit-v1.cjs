const { connectOrLaunchBrowser } = require('./lib/browser-connect-or-launch.cjs');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'receipt-discrepancy-rma-link-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'receipt-discrepancy-rma-link-browser-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9qsKQAAAAASUVORK5CYII=';
const GLOBAL_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 120000);

const STEP_TIMEOUT_MS = {
  api: 25000,
  pageLoad: 15000,
  login: 20000,
  nav: 15000,
  action: 20000,
  readBack: 20000,
};

const data = {
  customerName: `DCA-UI-CUS-${RUN_ID}`,
  productName: `DCA-UI-FG-${RUN_ID}`,
  batchNo: `DCA-UI-FG-BATCH-${RUN_ID}`,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  data,
  steps: [],
  consoleErrors: [],
  pageErrors: [],
  status: 'running',
};

const MOJIBAKE_CODE_POINTS = [
  0x7039,
  0x7481,
  0x93c0,
  0x95b2,
  0x9351,
  0x74a7,
  0x748b,
  0x7490,
  0x93b9,
  0x7edb,
  0x9417,
  0x7db7,
  0x951b,
  0x697c,
];
const mojibakeTokenPattern = new RegExp(MOJIBAKE_CODE_POINTS.map((code) => String.fromCodePoint(code)).join('|'), 'u');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function writeReport() {
  report.finishedAt = report.finishedAt || new Date().toISOString();
  ensureDir(OUTPUT_DIR);
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function withTimeout(name, timeoutMs, action) {
  const started = Date.now();
  try {
    const result = await Promise.race([
      action(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} exceeded ${timeoutMs}ms`)), timeoutMs)),
    ]);
    recordStep({ step: name, result: 'passed', timeoutMs, durationMs: Date.now() - started });
    return result;
  } catch (error) {
    recordStep({ step: name, result: 'failed', timeoutMs, durationMs: Date.now() - started, error: String(error.message || error) });
    throw error;
  }
}

async function withPageTimeout(page, name, timeoutMs, action) {
  try {
    return await withTimeout(name, timeoutMs, action);
  } catch (error) {
    try {
      const screenshot = await safeScreenshot(page, `fail-${name.replace(/[^a-z0-9-]/gi, '_')}`);
      report.lastFailureScreenshot = screenshot;
    } catch {}
    throw error;
  }
}

async function apiFetch(endpoint, options = {}, token = '') {
  const response = await fetch(`${APP_URL}api${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.data ? JSON.stringify(options.data) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: response.ok, status: response.status, json };
}

function unwrapList(payload) {
  const dataValue = payload?.json?.data;
  if (Array.isArray(dataValue)) return dataValue;
  if (Array.isArray(dataValue?.items)) return dataValue.items;
  return [];
}

async function expectOk(label, promise) {
  const response = await promise;
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response;
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? ` ${JSON.stringify(details)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

async function loginApi(username, password) {
  const response = await expectOk(`login ${username}`, apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  }));
  return response.json.data;
}

function toStoredUser(loginData) {
  const user = loginData.user || {};
  return {
    id: String(user.id),
    name: user.username || user.name || '',
    role: user.role || 'sales',
    segment: user.segment || (user.role === 'sales' ? 'direct' : 'mixed'),
    avatar: user.avatar || '',
    permissions: user.permissions || [],
  };
}

async function createCustomer(token) {
  const response = await expectOk('create customer for UI discrepancy action', apiFetch('/customers', {
    method: 'POST',
    data: {
      nameZh: data.customerName,
      nameEn: `Customer ${RUN_ID}`,
      nameVi: `Khach hang ${RUN_ID}`,
      licenseNumber: `DCA-UI-LIC-${RUN_ID}`,
      creditLimit: 1000000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'private',
      contactName: `Contact ${RUN_ID.slice(-4)}`,
      contactPhone: `09${RUN_ID.slice(-8)}`,
      addresses: [{
        type: 'shipping',
        countryCode: 'VN',
        city: 'Ho Chi Minh',
        fullAddress: 'Discrepancy action browser customer address',
      }],
      contacts: [{
        name: `Contact ${RUN_ID.slice(-4)}`,
        phone: `09${RUN_ID.slice(-8)}`,
        language: 'zh',
        isPrimary: true,
      }],
    },
  }, token));
  return response.json.data;
}

async function resolveLocation(token, locationCode) {
  const response = await expectOk('list warehouses', apiFetch('/warehouses', {}, token));
  for (const warehouse of unwrapList(response)) {
    const location = (warehouse.locations || []).find((item) => String(item.code) === locationCode);
    if (location) return location;
  }
  throw new Error(`location ${locationCode} not found`);
}

async function seedStock(token, seedTag) {
  const location = await resolveLocation(token, 'LOC-FG');
  const response = await expectOk('seed UI action audit stock', apiFetch('/warehouses/stock-balances', {
    method: 'POST',
    data: {
      locationId: Number(location.id),
      productName: data.productName,
      batchNo: data.batchNo,
      quantity: 8,
      unit: 'kg',
      sourceRef: `DCA-UI-SEED-${RUN_ID}-${seedTag}`,
      reason: 'browser_audit_seed_stock',
      note: `discrepancy UI action audit ${RUN_ID}`,
    },
  }, token));
  return response.json.data;
}

async function createShipmentDiscrepancy(manager, sales, seedTag) {
  const customer = await createCustomer(sales.token);
  await seedStock(manager.token, seedTag);

  const orderResponse = await expectOk('create sales order for UI action audit', apiFetch('/orders', {
    method: 'POST',
    data: {
      customerId: Number(customer.id),
      items: [{
        productName: data.productName,
        quantity: 5,
        unit: 'kg',
        unitPrice: 88,
      }],
      paymentTerms: 30,
      notes: `discrepancy UI action audit ${RUN_ID}`,
    },
  }, sales.token));
  const order = orderResponse.json.data;

  await expectOk('confirm sales order for UI action audit', apiFetch(`/orders/${order.id}/status`, {
    method: 'PATCH',
    data: { status: 'confirmed' },
  }, manager.token));

  const shipmentResponse = await expectOk('create shipment for UI action audit', apiFetch('/shipping', {
    method: 'POST',
    data: {
      customerId: Number(customer.id),
      orderId: Number(order.id),
      productName: data.productName,
      quantity: 5,
      unit: 'kg',
      batchNo: data.batchNo,
      carrier: `DCA-UI-CARRIER-${RUN_ID.slice(-4)}`,
      trackingNo: `DCA-UI-${RUN_ID}`,
    },
  }, manager.token));
  const shipment = shipmentResponse.json.data;

  await expectOk('dispatch shipment for UI action audit', apiFetch(`/shipping/${shipment.id}/status`, {
    method: 'PATCH',
    data: { status: 'in_transit' },
  }, manager.token));

  const receipt = await expectOk('create shipment receipt discrepancy for UI action audit', apiFetch(`/shipping/${shipment.id}/receipt-events`, {
    method: 'POST',
    data: {
      quantity: 5,
      acceptedQuantity: 3,
      rejectedQuantity: 2,
      fileName: `dca-ui-receipt-${RUN_ID}.png`,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${PNG_1X1}`,
      discrepancyReason: '客户签收短少，需要从差异工作台点击转RMA',
      note: 'receipt discrepancy rma link browser audit',
    },
  }, manager.token));

  const discrepancyCase = receipt.json.data.discrepancyCase;
  assert(discrepancyCase?.id, 'shipment discrepancy case missing');
  return { customer, order, shipment, discrepancyCase };
}

async function safeScreenshot(page, name) {
  ensureDir(SHOT_DIR);
  const filePath = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function closeBrowserSafely(browser) {
  if (!browser) return;
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('browser close exceeded 5000ms')), 5000)),
    ]);
    recordStep({ step: 'browser-close', result: 'passed' });
  } catch (error) {
    recordStep({ step: 'browser-close', result: 'skipped', error: String(error.message || error) });
  }
}

async function loginBrowser(page) {
  await withPageTimeout(page, 'open-login', STEP_TIMEOUT_MS.pageLoad, async () => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS.pageLoad });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  });

  const loginInput = page.locator('input[name="username"]');
  if (!(await loginInput.count())) {
    recordStep({ step: 'login-form-detection', result: 'skipped', reason: 'login form not found, assuming existing session' });
    return;
  }

  await withPageTimeout(page, 'submit-login', STEP_TIMEOUT_MS.login, async () => {
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForTimeout(1200),
    ]);
  });
}

async function readBodyText(page) {
  return page.locator('body').innerText({ timeout: 5000 });
}

async function checkNoVisibleCorruption(page, routeName) {
  const text = await readBodyText(page);
  const corruptionSignals = [
    /undefined\s+undefined/i,
    /\ufffd+/,
    mojibakeTokenPattern,
  ];
  const hit = corruptionSignals.find((signal) => signal.test(text));
  if (hit) throw new Error(`${routeName} shows corruption signal: ${String(hit)}`);
}

async function openWorkbenchAndClickRma(page, setup) {
  await withPageTimeout(page, 'route-discrepancy-workbench', STEP_TIMEOUT_MS.nav, async () => {
    await page.goto(`${APP_URL}#discrepancies`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS.pageLoad });
    await page.getByTestId('receipt-discrepancy-case-search').waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS.nav });
    await page.getByTestId('receipt-discrepancy-case-search').fill(String(setup.discrepancyCase.caseNo));
    await page.getByTestId(`receipt-discrepancy-case-${setup.discrepancyCase.id}`).waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS.nav });
  });

  await checkNoVisibleCorruption(page, 'receipt-discrepancy-before-rma-click');
  report.beforeClickScreenshot = await safeScreenshot(page, 'before-rma-click');

  await withPageTimeout(page, 'click-customer-rma-action', STEP_TIMEOUT_MS.action, async () => {
    const button = page.getByTestId(`receipt-discrepancy-customer-rma-${setup.discrepancyCase.id}`);
    assert(!(await button.isDisabled()), 'customer RMA action button should be enabled before click');
    await button.click({ timeout: STEP_TIMEOUT_MS.action });
  });
}

async function setBrowserSession(page, loginData) {
  await page.evaluate(({ token, user }) => {
    window.localStorage.setItem('token', token);
    window.localStorage.setItem('user', JSON.stringify(user));
    window.localStorage.setItem('ailao.activeTab', 'discrepancies');
  }, {
    token: loginData.token,
    user: toStoredUser(loginData),
  });
}

async function verifyWarehouseCannotClickCustomerRma(page, warehouse, setup) {
  await withPageTimeout(page, 'warehouse-route-discrepancy-workbench', STEP_TIMEOUT_MS.nav, async () => {
    await setBrowserSession(page, warehouse);
    await page.goto(`${APP_URL}?auditWarehouse=${RUN_ID}#discrepancies`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS.pageLoad });
    await page.getByTestId('receipt-discrepancy-case-search').waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS.nav });
    await page.getByTestId('receipt-discrepancy-case-search').fill(String(setup.discrepancyCase.caseNo));
    await page.getByTestId(`receipt-discrepancy-case-${setup.discrepancyCase.id}`).waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS.nav });
  });

  await withPageTimeout(page, 'warehouse-customer-rma-button-disabled', STEP_TIMEOUT_MS.action, async () => {
    const button = page.getByTestId(`receipt-discrepancy-customer-rma-${setup.discrepancyCase.id}`);
    assert(await button.isDisabled(), 'warehouse user should not see an enabled customer RMA button before backend 403');
  });

  await checkNoVisibleCorruption(page, 'receipt-discrepancy-warehouse-permission');
  report.warehouseDeniedScreenshot = await safeScreenshot(page, 'warehouse-rma-disabled');
  report.warehouseDenied = {
    caseNo: setup.discrepancyCase.caseNo,
    caseId: setup.discrepancyCase.id,
    userRole: warehouse.user?.role || 'warehouse',
  };
  recordStep({ step: 'warehouse-rma-button-disabled-readback', result: 'passed', ...report.warehouseDenied });
}

async function pollActionReadback(token, caseId) {
  const started = Date.now();
  let lastPayload = null;
  while (Date.now() - started < STEP_TIMEOUT_MS.readBack) {
    const response = await apiFetch(`/receipt-discrepancies/${caseId}/actions`, {}, token);
    lastPayload = response.json;
    if (response.ok) {
      const action = unwrapList(response).find((item) => item.actionType === 'customer_rma' && item.status !== 'cancelled');
      if (action?.targetModule === 'rma' && action?.targetId && action?.targetRef) return action;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(`customer_rma action did not read back with RMA link: ${JSON.stringify(lastPayload)}`);
}

async function verifyApiAndUiReadback(page, manager, setup) {
  const action = await withTimeout('api-readback-rma-linked-action', STEP_TIMEOUT_MS.readBack, async () => (
    pollActionReadback(manager.token, setup.discrepancyCase.id)
  ));

  const cases = await expectOk('readback discrepancy case after UI action', apiFetch(
    `/receipt-discrepancies?sourceType=shipment_receipt&sourceRef=${encodeURIComponent(setup.discrepancyCase.sourceRef)}`,
    {},
    manager.token,
  ));
  const caseAfterAction = unwrapList(cases)[0];
  assert(caseAfterAction, 'case readback missing after UI action');
  assert(String(caseAfterAction.actionRef) === String(action.actionNo), 'case actionRef should point to action number', {
    actionRef: caseAfterAction.actionRef,
    actionNo: action.actionNo,
  });
  assert(caseAfterAction.status === 'in_review', 'case should move to in_review after UI RMA action', { status: caseAfterAction.status });

  const rmas = await expectOk('readback target RMA after UI action', apiFetch(`/rma?customerId=${setup.customer.id}&pageSize=20`, {}, manager.token));
  const foundRma = unwrapList(rmas).find((item) => String(item.rmaNo) === String(action.targetRef));
  assert(foundRma, 'target RMA not found after UI discrepancy action', { targetRef: action.targetRef });
  assert(String(foundRma.productName) === String(data.productName), 'target RMA productName mismatch', {
    expected: data.productName,
    actual: foundRma?.productName,
  });

  await withPageTimeout(page, 'ui-readback-action-ref', STEP_TIMEOUT_MS.readBack, async () => {
    await page.waitForFunction((needle) => document.body.innerText.includes(needle), action.actionNo, { timeout: STEP_TIMEOUT_MS.readBack });
    const button = page.getByTestId(`receipt-discrepancy-customer-rma-${setup.discrepancyCase.id}`);
    assert(await button.isDisabled(), 'customer RMA action button should be disabled after linked action');
  });
  await checkNoVisibleCorruption(page, 'receipt-discrepancy-after-rma-click');

  report.afterClickScreenshot = await safeScreenshot(page, 'after-rma-click');
  report.action = {
    actionNo: action.actionNo,
    targetModule: action.targetModule,
    targetId: action.targetId,
    targetRef: action.targetRef,
    caseNo: setup.discrepancyCase.caseNo,
    rmaId: foundRma.id,
    rmaNo: foundRma.rmaNo,
  };
  recordStep({ step: 'receipt-discrepancy-rma-link-readback', result: 'passed', ...report.action });
}

async function run() {
  ensureDir(SHOT_DIR);
  let browser;
  const watchdog = setTimeout(() => {
    report.status = 'stuck';
    report.error = `receipt discrepancy RMA link browser audit exceeded ${GLOBAL_TIMEOUT_MS}ms`;
    report.blockerCode = 'BROWSER_AUDIT_TIMEOUT';
    report.blockerVerdict = 'script_stuck';
    writeReport();
    console.error(report.error);
    process.exit(124);
  }, GLOBAL_TIMEOUT_MS);

  try {
    const [manager, sales, warehouse] = await withTimeout('api-login-users', STEP_TIMEOUT_MS.api, async () => Promise.all([
      loginApi('manager', 'manager123'),
      loginApi('sales', 'sales123'),
      loginApi('warehouse', 'warehouse123'),
    ]));
    const setup = await withTimeout('api-seed-shipment-discrepancy', STEP_TIMEOUT_MS.api, async () => createShipmentDiscrepancy(manager, sales, 'main'));
    const warehouseSetup = await withTimeout('api-seed-warehouse-permission-discrepancy', STEP_TIMEOUT_MS.api, async () => createShipmentDiscrepancy(manager, sales, 'warehouse-denied'));
    report.seeded = {
      customerId: setup.customer.id,
      orderId: setup.order.id,
      shipmentId: setup.shipment.id,
      discrepancyCaseId: setup.discrepancyCase.id,
      discrepancyCaseNo: setup.discrepancyCase.caseNo,
      warehouseDeniedCaseId: warehouseSetup.discrepancyCase.id,
      warehouseDeniedCaseNo: warehouseSetup.discrepancyCase.caseNo,
    };

    const launched = await connectOrLaunchBrowser({ recordStep, retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    report.launcher = launched.launcher;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('console', (message) => {
      if (message.type() === 'error') report.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => {
      report.pageErrors.push(String(error.message || error));
    });

    await loginBrowser(page);
    await openWorkbenchAndClickRma(page, setup);
    await verifyApiAndUiReadback(page, manager, setup);
    await verifyWarehouseCannotClickCustomerRma(page, warehouse, warehouseSetup);

    const fatalConsoleErrors = report.consoleErrors.filter((message) => !/favicon|Failed to load resource/i.test(message));
    assert(fatalConsoleErrors.length === 0, 'console errors appeared during receipt discrepancy RMA link audit', { fatalConsoleErrors });
    assert(report.pageErrors.length === 0, 'page errors appeared during receipt discrepancy RMA link audit', { pageErrors: report.pageErrors });
    report.status = 'passed';
  } catch (error) {
    report.status = error?.auditKind === 'environment_blocker' ? 'blocked_env' : 'failed';
    report.error = String(error.message || error);
    report.blockerCode = error?.auditCode || null;
    report.blockerVerdict = error?.auditVerdict || null;
    if (Array.isArray(error?.launchFailures)) report.launchFailures = error.launchFailures;
    process.exitCode = 1;
  } finally {
    await closeBrowserSafely(browser);
    clearTimeout(watchdog);
    writeReport();
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'receipt discrepancy RMA link browser audit failed');
    process.exit(1);
  }

  console.log(`Receipt discrepancy RMA link browser audit passed. Report: ${REPORT_PATH}`);
  process.exit(0);
}

run();
