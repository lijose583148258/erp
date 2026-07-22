const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');
const { loginUiAuditUser } = require('./lib/ui-audit-user.cjs');
const {
  ensureDir,
  safeScreenshot: captureScreenshot,
  withTimebox: runWithTimebox,
} = require('./lib/audit-utils.cjs');
const { createProcurementBrowserAuditHelpers } = require('./lib/procurement-browser-audit-helpers.cjs');

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

const REQUIRED_ROUTE_COPY = ['采购、供应商与收货', '供应商主数据入口', '采购职责分流'];
const FORBIDDEN_MOJIBAKE = ['undefined', '\ufffd', '\u951f\u91d1\u62f7'];

const TIMEOUTS = { login: 15000, route: 20000, fill: 20000, save: 25000, api: 15000, readBack: 15000 };


const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  data: DATA,
  steps: [],
  status: 'running',
};

let authToken = '';

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

const {
  answerNextDialog,
  apiFetch,
  assertNoMojibake,
  replaceInputValue,
  resolveForcePasswordChange,
  safeScreenshot,
  seedLoginState,
  selectOptionByValue,
  unwrapList,
  verifyNavigationWarning,
  withTimebox,
} = createProcurementBrowserAuditHelpers({
  appUrl: APP_URL,
  captureScreenshot,
  forbiddenMojibake: FORBIDDEN_MOJIBAKE,
  getAuthToken: () => authToken,
  loginUiAuditUser,
  readBackTimeout: TIMEOUTS.readBack,
  recordStep,
  runId: RUN_ID,
  runWithTimebox,
  setAuthToken: (token) => { authToken = token; },
  shotDir: SHOT_DIR,
  timeouts: TIMEOUTS,
});

async function ensureReceiptLocation(page) {
  return withTimebox(page, 'ensure-procurement-receipt-location', TIMEOUTS.api, async () => {
    const listPayload = await apiFetch(page, '/warehouses');
    if (!listPayload.ok) throw new Error(`warehouse fixture read failed: ${listPayload.status}`);
    const warehouses = unwrapList(listPayload);
    const existingLocation = warehouses
      .flatMap((warehouse) => Array.isArray(warehouse.locations) ? warehouse.locations : [])
      .find((location) => String(location.code) === 'LOC-RAW' && String(location.status || 'active') === 'active');
    if (existingLocation) return existingLocation;

    let warehouse = warehouses[0];
    if (!warehouse) {
      const warehousePayload = await apiFetch(page, '/warehouses', {
        method: 'POST',
        data: {
          code: `WH-PROC-${RUN_ID}`,
          name: `Procurement Audit Warehouse ${RUN_ID}`,
          type: 'physical',
        },
      });
      if (!warehousePayload.ok) throw new Error(`warehouse fixture create failed: ${warehousePayload.status}`);
      warehouse = warehousePayload.json?.data;
    }
    if (!warehouse?.id) throw new Error('warehouse fixture id missing');

    const locationPayload = await apiFetch(page, `/warehouses/${warehouse.id}/locations`, {
      method: 'POST',
      data: { code: 'LOC-RAW', name: 'Raw Material Receiving', type: 'internal' },
    });
    if (!locationPayload.ok) throw new Error(`receipt location fixture create failed: ${locationPayload.status}`);
    recordStep({ step: 'receipt-location-fixture-created', result: 'passed', warehouseId: String(warehouse.id) });
    return locationPayload.json?.data;
  });
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
    await resolveForcePasswordChange(page);

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
    await page.getByTestId('procurement-desk-suppliers').click();
    await page.getByTestId('save-supplier-button').click();
    const supplierErrorSummary = page.getByTestId('supplier-form-error-summary');
    await supplierErrorSummary.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    const supplierValidationText = await supplierErrorSummary.innerText();
    assertNoMojibake(supplierValidationText, 'supplier validation');
    if (!supplierValidationText.includes('供应商名称不能为空')) {
      throw new Error(`supplier validation did not explain missing name: ${supplierValidationText}`);
    }
    recordStep({
      step: 'supplier-form-validation-blocked',
      result: 'passed',
      evidence: supplierValidationText,
    });

    await page.getByTestId('supplier-name-input').fill(DATA.supplierName);
    await page.getByTestId('supplier-category-input').fill(DATA.supplierCategory);
    await page.getByTestId('supplier-contact-input').fill(DATA.supplierContact);
    await page.getByTestId('supplier-phone-input').fill(DATA.supplierPhone);
    await page.getByTestId('supplier-email-input').fill(DATA.supplierEmail);
    await verifyNavigationWarning(page, DATA.supplierName, 'supplier-unsaved-navigation-warning');
    const supplierAdvancedToggle = page.getByTestId('supplier-toggle-advanced');
    if (await supplierAdvancedToggle.count()) {
      const toggleText = await supplierAdvancedToggle.innerText();
      if (/展开/.test(toggleText)) {
        await supplierAdvancedToggle.click();
      }
    }
    await page.getByTestId('supplier-address-label-input').fill('Legal');
    await page.getByTestId('supplier-country-code-input').fill('VN');
    await page.getByTestId('supplier-city-input').fill('Ho Chi Minh');
    await page.getByTestId('supplier-full-address-input').fill('District 7, Ho Chi Minh City');
    recordStep({
      step: 'supplier-form-filled-evidence',
      result: 'passed',
      evidence: await safeScreenshot(page, 'supplier-form-filled'),
    });
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
    recordStep({
      step: 'supplier-list-readback-evidence',
      result: 'passed',
      evidence: await safeScreenshot(page, 'supplier-list-readback'),
      supplierId: String(supplier.id),
      supplierName: supplier.name,
    });
  });
}

async function createPurchaseOrder(page) {
  return withTimebox(page, 'create-procurement-order', TIMEOUTS.save, async () => {
    if (!report.supplier?.id) throw new Error('supplier id missing before purchase creation');
    if (!report.salesOrder?.id) throw new Error('sales order id missing before purchase creation');

    await page.getByTestId('procurement-desk-orders').click();
    await page.getByTestId('save-purchase-button').click();
    const purchaseErrorSummary = page.getByTestId('purchase-form-error-summary');
    await purchaseErrorSummary.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    const purchaseValidationText = await purchaseErrorSummary.innerText();
    assertNoMojibake(purchaseValidationText, 'purchase order validation');
    if (!purchaseValidationText.includes('请选择供应商')) {
      throw new Error(`purchase validation did not explain missing supplier: ${purchaseValidationText}`);
    }
    recordStep({
      step: 'purchase-form-validation-blocked',
      result: 'passed',
      evidence: purchaseValidationText,
    });

    const orderAdvancedToggle = page.getByTestId('purchase-toggle-advanced');
    if (await orderAdvancedToggle.count()) {
      const toggleText = await orderAdvancedToggle.innerText();
      if (/展开/.test(toggleText)) {
        await orderAdvancedToggle.click();
      }
    }
    await page.getByTestId('b2b-toggle').click();
    await selectOptionByValue(page.getByTestId('linked-sales-order-select'), report.salesOrder.id);
    await selectOptionByValue(page.getByTestId('purchase-supplier-select'), report.supplier.id);
    await page.getByTestId('purchase-item-input').fill(DATA.purchaseItem);
    await page.getByTestId('purchase-quantity-input').fill(DATA.purchaseQuantity);
    await page.getByTestId('purchase-price-input').fill(DATA.purchasePrice);
    await verifyNavigationWarning(page, DATA.purchaseItem, 'purchase-order-unsaved-navigation-warning');
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
    await replaceInputValue(page.getByTestId('purchase-receipt-batch-input'), `UNSAVED-${RUN_ID}`);

    const dismissDialog = answerNextDialog(page, false);
    await page.getByTestId('purchase-receipt-close').click();
    const dismissMessage = await dismissDialog;
    if (!dismissMessage.includes('未保存')) throw new Error(`receipt close warning is unclear: ${dismissMessage}`);
    await page.getByTestId('purchase-receipt-drawer').waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    recordStep({ step: 'purchase-receipt-unsaved-warning', result: 'passed' });

    const acceptDialog = answerNextDialog(page, true);
    await page.getByTestId('purchase-receipt-close').click();
    await acceptDialog;
    await page.getByTestId('purchase-receipt-drawer').waitFor({ state: 'hidden', timeout: TIMEOUTS.readBack });
    recordStep({ step: 'purchase-receipt-confirm-close', result: 'passed' });

    await page.locator(`[data-testid="purchase-order-receipts-${orderId}"]`).click();
    await page.getByTestId('purchase-receipt-drawer').waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });

    await replaceInputValue(page.getByTestId('purchase-receipt-quantity-input'), String(Number(DATA.purchaseQuantity) + 1));
    await replaceInputValue(page.getByTestId('purchase-receipt-accepted-input'), DATA.purchaseQuantity);
    await replaceInputValue(page.getByTestId('purchase-receipt-rejected-input'), '0');
    await page.getByTestId('purchase-receipt-save-button').click();
    const receiptErrorSummary = page.getByTestId('purchase-receipt-error-summary');
    await receiptErrorSummary.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    const receiptValidationText = await receiptErrorSummary.innerText();
    assertNoMojibake(receiptValidationText, 'purchase receipt validation');
    if (!receiptValidationText.includes('不能超过剩余') && !receiptValidationText.includes('必须等于')) {
      throw new Error(`receipt validation did not explain invalid quantity: ${receiptValidationText}`);
    }
    recordStep({
      step: 'purchase-receipt-validation-blocked',
      result: 'passed',
      evidence: receiptValidationText,
    });

    await replaceInputValue(page.getByTestId('purchase-receipt-quantity-input'), DATA.purchaseQuantity);
    await replaceInputValue(page.getByTestId('purchase-receipt-accepted-input'), DATA.purchaseQuantity);
    await replaceInputValue(page.getByTestId('purchase-receipt-rejected-input'), '0');
    await replaceInputValue(page.getByTestId('purchase-receipt-batch-input'), `PO-BATCH-${RUN_ID}`);
    const receiptResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes(`/procurement/orders/${orderId}/receipts`)
    ), { timeout: TIMEOUTS.save });
    await page.getByTestId('purchase-receipt-save-button').click();
    const receiptResponse = await receiptResponsePromise;
    if (!receiptResponse.ok()) {
      throw new Error(`purchase receipt create failed: ${receiptResponse.status()} ${await receiptResponse.text()}`);
    }

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
    await ensureReceiptLocation(page);
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

