const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');
const { apiFetch: fetchApi, loginApi: loginWithApi, unwrapList } = require('./lib/shipping-browser-api-helpers.cjs');
const {
  MOJIBAKE_MARKERS,
  REQUIRED_ROUTE_COPY,
  TIMEOUTS,
  createOcrText,
  createReceiptFixture,
  createShippingAuditData,
} = require('./lib/shipping-browser-audit-fixtures.cjs');
const {
  createConfirmedShippingOrder,
  createLinkedShipment,
  seedShipmentStock,
  verifyShippingIssue: verifyShippingIssueEntry,
} = require('./lib/shipping-browser-data-helpers.cjs');
const {
  assertNoMojibake: assertNoMojibakeText,
  compactText,
  createReportRecorder,
  createShippingReport,
  ensureDir,
  safeScreenshot: captureScreenshot,
  withTimebox: runTimedTask,
} = require('./lib/shipping-browser-report-helpers.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'shipping-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'shipping-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const DATA = createShippingAuditData(RUN_ID);

const report = createShippingReport({ appUrl: APP_URL, runId: RUN_ID, data: DATA });
const recordStep = createReportRecorder(report);

let managerAuth = null;
let salesAuth = null;

async function loginApi(page, username, password) {
  return loginWithApi(page, APP_URL, username, password);
}

async function safeScreenshot(page, name) {
  return captureScreenshot(page, SHOT_DIR, name);
}

async function withTimebox(page, step, timeout, task) {
  return runTimedTask({
    page,
    step,
    timeout,
    task,
    recordStep,
    shotDir: SHOT_DIR,
  });
}

async function apiFetch(page, endpoint, options = {}, token = managerAuth?.token) {
  return fetchApi(page, APP_URL, endpoint, options, token);
}

function assertNoMojibake(text, scopeName) {
  return assertNoMojibakeText(text, scopeName, MOJIBAKE_MARKERS);
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

async function ensureSalesAuth(page) {
  if (!salesAuth) {
    salesAuth = await loginApi(page, 'sales', 'sales123');
  }
  return salesAuth;
}

async function seedLinkedShipmentStock(page) {
  return seedShipmentStock({
    page,
    apiFetch,
    unwrapList,
    data: DATA,
    runId: RUN_ID,
    report,
    timebox: withTimebox,
    timeouts: TIMEOUTS,
  });
}

async function ensureConfirmedOrder(page) {
  return createConfirmedShippingOrder({
    page,
    apiFetch,
    data: DATA,
    runId: RUN_ID,
    report,
    managerAuth,
    getSalesAuth: () => ensureSalesAuth(page),
    timebox: withTimebox,
    timeouts: TIMEOUTS,
  });
}

async function createLinkedShipmentViaApi(page) {
  return createLinkedShipment({
    page,
    apiFetch,
    data: DATA,
    report,
    timebox: withTimebox,
    timeouts: TIMEOUTS,
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

    const ocrText = createOcrText(customerName, DATA);

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
  return verifyShippingIssueEntry({
    page,
    apiFetch,
    unwrapList,
    data: DATA,
    report,
    timebox: withTimebox,
    timeouts: TIMEOUTS,
  });
}

async function uploadReceiptViaUi(page) {
  return withTimebox(page, 'upload-linked-shipment-receipt', TIMEOUTS.save, async () => {
    if (!report.linkedShipment?.id) throw new Error('linked shipment id missing before receipt upload');
    const proofPath = createReceiptFixture(SHOT_DIR, RUN_ID);

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

