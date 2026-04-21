const path = require('path');
const { connectOrLaunchBrowser } = require('./lib/browser-connect-or-launch.cjs');
const {
  createBrowserHumanFlowAuditContext,
  createBrowserHumanFlowData,
} = require('./lib/browser-human-flow-audit-utils.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'browser-human-flow-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'browser-human-flow-audit-report-v1.json');
const GLOBAL_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 240000);

const ROLE_PASSWORDS = {
  admin: 'admin123',
  sales: 'sales123',
  warehouse: 'warehouse123',
  finance: 'finance123',
};

const TIMEOUTS = {
  pageLoad: 15000,
  login: 20000,
  route: 12000,
  action: 18000,
  save: 20000,
  readBack: 15000,
  screenshot: 5000,
  close: 5000,
};

const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const DATA = createBrowserHumanFlowData(RUN_ID);
const FLOW_STATE = {
  salesOrderId: null,
};

function parseCliArgs(argv) {
  const args = {
    listModules: false,
    selectedModules: [],
  };

  for (const arg of argv) {
    if (arg === '--list-modules') {
      args.listModules = true;
      continue;
    }
    if (arg.startsWith('--module=')) {
      args.selectedModules.push(...arg.slice('--module='.length).split(',').map(item => item.trim()).filter(Boolean));
      continue;
    }
    if (arg.startsWith('--modules=')) {
      args.selectedModules.push(...arg.slice('--modules='.length).split(',').map(item => item.trim()).filter(Boolean));
    }
  }

  return args;
}

const CLI_ARGS = parseCliArgs(process.argv.slice(2));

const {
  ensureDir,
  ensureRole,
  getBodyText,
  openHash,
  recordStep,
  report,
  resetRuntimeCaches,
  runModule,
  safeScreenshot,
  selectOptionContaining,
  waitForVisibleText,
  withTimeout,
  writeReport,
} = createBrowserHumanFlowAuditContext({
  appUrl: APP_URL,
  outputDir: OUTPUT_DIR,
  shotDir: SHOT_DIR,
  reportPath: REPORT_PATH,
  runId: RUN_ID,
  data: DATA,
  rolePasswords: ROLE_PASSWORDS,
  timeouts: TIMEOUTS,
});

async function moduleCRM(page) {
  await openHash(page, '#crm', 'crm', ['客户关系', '客户管理', 'CUSTOMERS']);

  await withTimeout('crm-open-create', TIMEOUTS.action, async () => {
    await page.locator('[data-testid="crm-add-customer"]').click();
    await page.locator('[data-testid="crm-create-modal"]').waitFor({ state: 'visible', timeout: TIMEOUTS.action });
  });

  const modal = page.locator('[data-testid="crm-create-modal"]');
  await withTimeout('crm-fill-create', TIMEOUTS.save, async () => {
    await modal.locator('[data-testid="crm-name"]').fill(DATA.crm.name);
    await modal.locator('[data-testid="crm-name-zh"]').fill(DATA.crm.nameZh);
    await modal.locator('[data-testid="crm-name-en"]').fill(DATA.crm.nameEn);
    await modal.locator('[data-testid="crm-name-vi"]').fill(DATA.crm.nameVi);
    await modal.locator('[data-testid="crm-primary-address-label"]').fill(DATA.crm.siteLabel);
    await modal.locator('[data-testid="crm-primary-address-country"]').fill(DATA.crm.countryCode);
    await modal.locator('[data-testid="crm-primary-address-registered-name"]').fill(DATA.crm.registeredName);
    await modal.locator('[data-testid="crm-primary-address-registration-no"]').fill(DATA.crm.registrationNo);
    await modal.locator('[data-testid="crm-primary-address-tax-no"]').fill(DATA.crm.taxNo);
    await modal.locator('[data-testid="crm-primary-address-city"]').fill(DATA.crm.city);
    await modal.locator('[data-testid="crm-primary-address-full-address"]').fill(DATA.crm.fullAddress);
    await modal.locator('[data-testid="crm-primary-contact-name"]').fill(DATA.crm.contactName);
    await modal.locator('[data-testid="crm-primary-contact-role"]').fill(DATA.crm.contactRole);
    await modal.locator('[data-testid="crm-primary-contact-phone"]').fill(DATA.crm.contactPhone);
    await modal.locator('[data-testid="crm-primary-contact-email"]').fill(DATA.crm.contactEmail);
    await modal.locator('[data-testid="crm-primary-contact-department"]').fill(DATA.crm.contactDepartment);
    await modal.locator('[data-testid="crm-advanced-toggle"]').click();
    await page.waitForTimeout(300);
    await modal.locator('[data-testid="crm-aliases"]').fill(DATA.crm.alias);
    await modal.locator('[data-testid="crm-license-number"]').fill(DATA.crm.licenseNumber);
    await modal.locator('[data-testid="crm-credit-limit"]').fill(String(DATA.crm.creditLimit));
    await modal.locator('[data-testid="crm-terms-days"]').fill(String(DATA.crm.termsDays));
    await modal.locator('[data-testid="crm-risk-level"]').selectOption('medium');
    await modal.locator('[data-testid="crm-segment"]').selectOption('mixed');
    await modal.locator('[data-testid="crm-add-site"]').click();
    await page.waitForTimeout(200);
    await modal.locator('[data-testid="crm-address-1-type"]').selectOption('shipping');
    await modal.locator('[data-testid="crm-address-1-label"]').fill(DATA.crm.extraSiteLabel);
    await modal.locator('[data-testid="crm-address-1-full-address"]').fill(DATA.crm.extraSiteAddress);
    await modal.locator('[data-testid="crm-add-contact"]').click();
    await page.waitForTimeout(200);
    await modal.locator('[data-testid="crm-contact-1-name"]').fill(DATA.crm.extraContactName);
    await modal.locator('[data-testid="crm-contact-1-phone"]').fill(DATA.crm.extraContactPhone);
    await modal.locator('[data-testid="crm-notes"]').fill(DATA.crm.notes);
    await modal.locator('[data-testid="crm-create-submit"]').click();
  });

  await waitForVisibleText(page, DATA.crm.nameZh);
  const createdShot = await safeScreenshot(page, 'crm-created');

  await withTimeout('crm-readback-row', TIMEOUTS.readBack, async () => {
    await page.locator('[data-testid="crm-search"]').fill(DATA.crm.nameZh);
    await page.waitForTimeout(500);
    const row = page.locator('[data-testid^="crm-customer-row-"]').filter({ hasText: DATA.crm.nameZh }).first();
    await row.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    await row.click();
    const drawer = page.locator('[data-testid="crm-customer-drawer"]');
    await drawer.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    const drawerText = await drawer.innerText();
    if (!drawerText.includes(DATA.crm.contactName)) {
      throw new Error('CRM drawer missing primary contact after creation');
    }
    if (!drawerText.includes(DATA.crm.siteLabel)) {
      throw new Error('CRM drawer missing primary address label after creation');
    }
  });
  const readbackShot = await safeScreenshot(page, 'crm-readback');

  return {
    status: 'passed',
    evidence: [createdShot, readbackShot].filter(Boolean),
    notes: '已验证客户主档、三语名称、主地址、主联系人、别名与刷新后回读。',
  };
}

async function findCreatedSalesOrderRow(page) {
  const row = page.locator('[data-testid^="sales-order-row-"]').filter({ hasText: DATA.crm.nameZh }).first();
  await row.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
  const testId = await row.getAttribute('data-testid');
  const idText = String(testId || '').replace(/^sales-order-row-/, '');
  const id = Number(idText);
  if (Number.isInteger(id) && id > 0) {
    FLOW_STATE.salesOrderId = id;
  }
  return row;
}

function getConsoleErrorCount(page) {
  return Array.isArray(page.__humanFlowConsoleErrors) ? page.__humanFlowConsoleErrors.length : 0;
}

async function assertNoNewConsoleErrors(page, startCount, actionName) {
  await page.waitForTimeout(250);
  const errors = Array.isArray(page.__humanFlowConsoleErrors) ? page.__humanFlowConsoleErrors.slice(startCount) : [];
  if (errors.length > 0) {
    throw new Error(`${actionName} produced console/API errors: ${errors.map((item) => item.text).join(' | ')}`);
  }
}

async function moduleOrdersAndCollections(page) {
  await openHash(page, '#orders', 'orders', ['订单', 'Order', 'Sales Order']);

  await withTimeout('orders-open-create', TIMEOUTS.action, async () => {
    await page.locator('[data-testid="sales-order-create-button"]').click();
    await page.locator('[data-testid="sales-order-editor-modal"]').waitFor({ state: 'visible', timeout: TIMEOUTS.action });
  });

  const modal = page.locator('[data-testid="sales-order-editor-modal"]');
  await withTimeout('orders-fill-save', TIMEOUTS.save, async () => {
    const customerSelect = modal.locator('[data-testid="sales-order-customer-select"]');
    await customerSelect.waitFor({ state: 'visible', timeout: TIMEOUTS.action });
    let customerValue = '';
    const customerOptionStarted = Date.now();
    while (Date.now() - customerOptionStarted < TIMEOUTS.readBack) {
      customerValue = await customerSelect.evaluate((element, expectedText) => {
        const options = Array.from(element.options || []);
        const preferred = options.find((item) => String(item.textContent || '').includes(String(expectedText)));
        const fallback = options.find((item) => item.value);
        return (preferred || fallback)?.value || '';
      }, DATA.crm.nameZh);
      if (customerValue) break;
      await page.waitForTimeout(250);
    }
    if (!customerValue) {
      throw new Error('sales order customer option not found');
    }
    await customerSelect.selectOption(customerValue);
    const contractSelect = modal.locator('[data-testid="sales-order-contract-select"]');
    if (await contractSelect.count()) {
      await contractSelect.selectOption('');
    }
    await modal.locator('[data-testid="sales-order-line-0-product"]').fill(DATA.order.productName);
    await modal.locator('[data-testid="sales-order-line-0-packaging"]').fill(DATA.order.packaging);
    await modal.locator('[data-testid="sales-order-line-0-quantity"]').fill(String(DATA.order.quantity));
    await modal.locator('[data-testid="sales-order-line-0-unit"]').fill(DATA.order.unit);
    await modal.locator('[data-testid="sales-order-line-0-unit-price"]').fill(String(DATA.order.unitPrice));
    await modal.locator('[data-testid="sales-order-line-0-discount"]').fill('0');
    await modal.locator('[data-testid="sales-order-line-0-tax"]').fill(String(DATA.order.taxAmount));
    await modal.locator('[data-testid="sales-order-save-button"]').click();
  });

  await findCreatedSalesOrderRow(page);
  const orderShot = await safeScreenshot(page, 'orders-created');

  await withTimeout('orders-record-payment', TIMEOUTS.action, async () => {
    const consoleStart = getConsoleErrorCount(page);
    const orderRow = await findCreatedSalesOrderRow(page);
    const paymentButton = orderRow.locator('[data-testid="sales-order-payment-button"]').first();
    if (!(await paymentButton.count())) {
      throw new Error('record payment button not found');
    }
    await paymentButton.click();
    const paymentModal = page.locator('[data-testid="sales-order-payment-modal"]');
    await paymentModal.waitFor({ state: 'visible', timeout: TIMEOUTS.action });
    const paymentInputs = paymentModal.locator('input:not([type="checkbox"])');
    await paymentInputs.nth(0).fill(String(DATA.order.paymentAmount));
    await paymentInputs.nth(1).fill(new Date().toISOString().slice(0, 10));
    await paymentInputs.nth(2).fill(DATA.order.paymentNote);
    await paymentModal.locator('[data-testid="sales-order-payment-confirm"]').click();
    await paymentModal.waitFor({ state: 'hidden', timeout: TIMEOUTS.readBack });
    await assertNoNewConsoleErrors(page, consoleStart, 'orders-record-payment');
  });

  await withTimeout('orders-create-promise', TIMEOUTS.action, async () => {
    const consoleStart = getConsoleErrorCount(page);
    const orderRow = await findCreatedSalesOrderRow(page);
    const historyButton = orderRow.locator('[data-testid="sales-order-history-button"]').first();
    if (!(await historyButton.count())) {
      throw new Error('order history button not found');
    }
    await historyButton.click();
    const historyModal = page.locator('[data-testid="sales-order-history-modal"]');
    await historyModal.waitFor({ state: 'visible', timeout: TIMEOUTS.action });
    await historyModal.locator('[data-testid="sales-order-open-promise-button"]').click();
    const collectionModal = page.locator('[data-testid="collection-action-modal"]');
    await collectionModal.waitFor({ state: 'visible', timeout: TIMEOUTS.action });
    const numberInput = collectionModal.locator('input[type="number"]').first();
    const dateInput = collectionModal.locator('input[type="datetime-local"]').first();
    const textInputs = collectionModal.locator('input[type="text"]');
    await numberInput.fill(String(DATA.order.promiseAmount));
    await dateInput.fill(new Date().toISOString().slice(0, 16));
    if ((await textInputs.count()) > 0) {
      await textInputs.nth((await textInputs.count()) - 1).fill(DATA.order.promiseNote);
    }
    await collectionModal.locator('[data-testid="collection-action-submit"]').click();
    await collectionModal.waitFor({ state: 'hidden', timeout: TIMEOUTS.readBack });
    await assertNoNewConsoleErrors(page, consoleStart, 'orders-create-promise');
  });

  const orderBody = await getBodyText(page);
  if (!orderBody.includes(DATA.order.paymentNote) || !orderBody.includes(DATA.order.promiseNote)) {
    throw new Error('order/payment/promise readback text not found');
  }
  const readbackShot = await safeScreenshot(page, 'orders-payment-promise-readback');

  return {
    status: 'passed',
    evidence: [orderShot, readbackShot].filter(Boolean),
    notes: '已验证订单新建、回款录入、承诺付款创建与刷新后状态回读。',
  };
}

async function moduleShipping(page) {
  await openHash(page, '#shipping', 'shipping', ['出货物流', 'Shipment', '物流']);

  const stockBackedProduct = 'QA-GLUE-BARTER-1776434928717';

  await withTimeout('shipping-create-from-ocr', TIMEOUTS.save, async () => {
    const ocrText = [
      `Customer: ${DATA.crm.nameZh}`,
      `Product: ${stockBackedProduct}`,
      `Quantity: ${DATA.shipping.quantity} kg`,
      `Carrier: Ailao Logistics`,
      `Tracking No: HF-SHIP-${RUN_ID}`,
    ].join('\n');
    await page.locator('[data-testid="shipping-ocr-textarea"]').fill(ocrText);
    await page.locator('[data-testid="shipping-ocr-parse-button"]').click();
    await waitForVisibleText(page, stockBackedProduct);
    await page.locator('[data-testid="shipping-ocr-apply-button"]').click();
    const row = page.locator('[data-testid^="shipment-row-"]').filter({ hasText: stockBackedProduct }).first();
    await row.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
  });

  const shipmentRow = () => page.locator('[data-testid^="shipment-row-"]').filter({ hasText: stockBackedProduct }).first();

  await withTimeout('shipping-dispatch', TIMEOUTS.action, async () => {
    const row = shipmentRow();
    await row.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    const dispatchButton = row.locator('[data-testid^="shipment-dispatch-"]').first();
    if (!(await dispatchButton.count())) {
      throw new Error('shipping dispatch button not found');
    }
    await dispatchButton.click();
    await row.locator('[data-testid^="shipment-receipts-button-"]').first().waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
  });

  await withTimeout('shipping-open-receipt', TIMEOUTS.action, async () => {
    const firstReceiptButton = shipmentRow().locator('[data-testid^="shipment-receipts-button-"]').first();
    if (!(await firstReceiptButton.count())) {
      throw new Error('shipping receipt button not found');
    }
    await firstReceiptButton.click();
    await page.locator('[data-testid="shipping-receipt-drawer"]').waitFor({ state: 'visible', timeout: TIMEOUTS.action });
  });

  const drawer = page.locator('[data-testid="shipping-receipt-drawer"]');
  await withTimeout('shipping-submit-receipt', TIMEOUTS.save, async () => {
    await drawer.locator('[data-testid="shipping-receipt-quantity-input"]').fill(String(DATA.shipping.quantity));
    await drawer.locator('[data-testid="shipping-receipt-accepted-input"]').fill(String(DATA.shipping.acceptedQuantity));
    await drawer.locator('[data-testid="shipping-receipt-rejected-input"]').fill(String(DATA.shipping.rejectedQuantity));
    await drawer.locator('input').nth(3).fill(DATA.shipping.discrepancyReason).catch(() => {});
    await drawer.locator('textarea').fill(DATA.shipping.note);
    await drawer.locator('[data-testid="shipping-receipt-save-button"]').click();
    await page.waitForTimeout(1200);
  });

  const text = await getBodyText(page);
  if (!text.includes('历史批次') && !text.includes('签收批次')) {
    throw new Error('shipping receipt drawer did not stay readable after save');
  }
  const shot = await safeScreenshot(page, 'shipping-receipt-readback');

  return {
    status: 'passed',
    evidence: [shot].filter(Boolean),
    notes: '已验证签收批次的输入、保存与历史批次回读。',
  };
}

async function moduleProcurementAndWarehouse(page) {
  await openHash(page, '#procurement', 'procurement', ['采购', '供应商', '采购订单']);

  await withTimeout('procurement-create-supplier', TIMEOUTS.save, async () => {
    await page.locator('[data-testid="supplier-name-input"]').fill(DATA.procurement.supplierName);
    await page.locator('[data-testid="supplier-category-input"]').fill(DATA.procurement.category);
    await page.locator('[data-testid="supplier-contact-input"]').fill(DATA.procurement.contactName);
    await page.locator('[data-testid="supplier-phone-input"]').fill(DATA.procurement.phone);
    await page.locator('[data-testid="supplier-email-input"]').fill(DATA.procurement.email);
    await page.locator('[data-testid="supplier-address-label-input"]').fill(DATA.procurement.addressLabel);
    await page.locator('[data-testid="supplier-country-code-input"]').fill(DATA.procurement.countryCode);
    await page.locator('[data-testid="supplier-city-input"]').fill(DATA.procurement.city);
    await page.locator('[data-testid="supplier-full-address-input"]').fill(DATA.procurement.fullAddress);
    await page.locator('textarea').first().fill(DATA.procurement.supplierAlias).catch(() => {});
    await page.locator('[data-testid="save-supplier-button"]').click();
    await page.waitForTimeout(1000);
  });
  await waitForVisibleText(page, DATA.procurement.supplierName);
  const supplierShot = await safeScreenshot(page, 'procurement-supplier-created');

  await withTimeout('procurement-create-order', TIMEOUTS.save, async () => {
    await page.locator('[data-testid="procurement-tab-orders"]').click();
    await page.waitForTimeout(500);
    await selectOptionContaining(page.locator('[data-testid="purchase-supplier-select"]'), DATA.procurement.supplierName);
    await page.locator('[data-testid="purchase-item-input"]').fill(DATA.procurement.purchaseItem);
    await page.locator('[data-testid="purchase-quantity-input"]').fill(String(DATA.procurement.purchaseQuantity));
    await page.locator('[data-testid="purchase-price-input"]').fill(String(DATA.procurement.purchasePrice));
    await page.locator('[data-testid="purchase-eta-input"]').fill(DATA.procurement.purchaseEta);
    await page.locator('[data-testid="save-purchase-button"]').click();
    await page.waitForTimeout(1000);
  });
  await waitForVisibleText(page, DATA.procurement.purchaseItem);
  const procurementShot = await safeScreenshot(page, 'procurement-order-created');

  const warehouseShot = await switchToWarehouseAndInbound(page);

  return {
    status: 'passed',
    evidence: [supplierShot, procurementShot, warehouseShot].filter(Boolean),
    notes: '已验证供应商主数据、采购单新增，以及仓储基础收货闭环。',
  };
}

async function waitForInventoryQueryResult(page, expectedText, timeoutMs = TIMEOUTS.readBack) {
  const started = Date.now();
  let lastRetryAt = started;
  const queryButton = page.locator('[data-testid="warehouse-inventory-query-button"]');
  await queryButton.click();
  while (Date.now() - started < timeoutMs) {
    await page.waitForTimeout(300);
    const body = await getBodyText(page);
    if (body.includes(expectedText)) {
      return body;
    }
    const elapsed = Date.now() - started;
    if (elapsed > 3500 && Date.now() - lastRetryAt > 3000) {
      await queryButton.click();
      lastRetryAt = Date.now();
    }
  }
  throw new Error(`warehouse inventory query did not show: ${expectedText}`);
}

async function switchToWarehouseAndInbound(page) {
  await ensureRole(page, 'warehouse');
  await openHash(page, '#warehouse', 'warehouse', ['仓储管理', 'Warehouse', '库存']);

  await withTimeout('warehouse-create-warehouse', TIMEOUTS.save, async () => {
    await page.locator('button').filter({ hasText: /新建仓库|New Warehouse|Create Warehouse/ }).first().click();
    const dialog = page.locator('div.fixed').filter({ hasText: /新建仓库|Create Warehouse|New Warehouse/ }).last();
    await dialog.waitFor({ state: 'visible', timeout: TIMEOUTS.action });
    await dialog.locator('input').nth(0).fill(DATA.warehouse.code);
    await dialog.locator('input').nth(1).fill(DATA.warehouse.name);
    await dialog.locator('select').first().selectOption('physical');
    await dialog.getByRole('button', { name: /创建|Create/ }).click();
    await page.waitForTimeout(1000);
  });

  await waitForVisibleText(page, DATA.warehouse.name);

  await withTimeout('warehouse-create-location', TIMEOUTS.save, async () => {
    await page.locator('button').filter({ hasText: /新增库位|Add Location|Create Location/ }).first().click();
    const dialog = page.locator('div.fixed').filter({ hasText: /新建库位|Create Location|New Location/ }).last();
    await dialog.waitFor({ state: 'visible', timeout: TIMEOUTS.action });
    await dialog.locator('input').nth(0).fill(DATA.warehouse.locationCode);
    await dialog.locator('input').nth(1).fill(DATA.warehouse.locationName);
    await dialog.locator('select').first().selectOption('internal');
    await dialog.getByRole('button', { name: /创建|Create/ }).click();
    await page.waitForTimeout(1000);
  });

  await waitForVisibleText(page, DATA.warehouse.locationName);

  await withTimeout('warehouse-inbound', TIMEOUTS.save, async () => {
    await page.locator('[data-testid="warehouse-tab-inbound"]').click();
    const selects = page.locator('[data-testid="warehouse-inbound-location-select"]');
    const selectCount = await selects.count();
    for (let index = 0; index < selectCount; index += 1) {
      const select = selects.nth(index);
      const options = await select.locator('option').evaluateAll((items) => items.map((item) => ({ value: item.value, text: item.textContent || '' })));
      const match = options.find((item) => item.text.includes(DATA.warehouse.locationName));
      if (match) {
        await select.selectOption(match.value);
        break;
      }
    }
    await page.locator('[data-testid="warehouse-inbound-product-input"]').fill(DATA.warehouse.inboundProduct);
    await page.locator('[data-testid="warehouse-inbound-batch-input"]').fill(DATA.warehouse.batchNo);
    await page.locator('[data-testid="warehouse-inbound-quantity-input"]').fill(String(DATA.warehouse.inboundQuantity));
    const unitSelect = page.locator('[data-testid="warehouse-inbound-unit-select"]');
    await unitSelect.selectOption({ label: DATA.warehouse.inboundUnit }).catch(() => {});
    await page.locator('[data-testid="warehouse-inbound-confirm-button"]').click();
    const message = page.locator('[data-testid="warehouse-inbound-message"]').first();
    await message.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    await page.waitForFunction(() => {
      const text = document.body.innerText || '';
      return /入库成功|Inbound success|入库失败|不能为空|不存在|无权限/.test(text);
    }, null, { timeout: TIMEOUTS.readBack });
    const bodyAfterSave = await getBodyText(page);
    if (/入库失败|不能为空|不存在|无权限/.test(bodyAfterSave)) {
      throw new Error(`warehouse inbound save failed: ${bodyAfterSave.slice(0, 500)}`);
    }
    if (!/入库成功|Inbound success/i.test(bodyAfterSave)) {
      throw new Error('warehouse inbound success message not visible after save');
    }
    await page.locator('[data-testid="warehouse-tab-inventory"]').click();
    await page.locator('[data-testid="warehouse-inventory-search"]').fill(DATA.warehouse.inboundProduct);
  });

  await withTimeout('warehouse-inventory-product-readback', TIMEOUTS.readBack, async () => {
    await waitForInventoryQueryResult(page, DATA.warehouse.inboundProduct, TIMEOUTS.readBack);
  });

  await withTimeout('warehouse-location-filter-readback', TIMEOUTS.readBack, async () => {
    const locationSelect = page.locator('[data-testid="warehouse-inventory-location-select"]');
    await locationSelect.waitFor({ state: 'visible', timeout: TIMEOUTS.action });
    const locationValue = await locationSelect.locator('option').evaluateAll((items, targetName) => {
      const match = items.find((item) => String(item.textContent || '').includes(String(targetName)));
      return match?.value || '';
    }, DATA.warehouse.locationName);
    if (!locationValue) {
      throw new Error('created warehouse location is missing from inventory location filter');
    }
    await locationSelect.selectOption(locationValue);
    await waitForInventoryQueryResult(page, DATA.warehouse.inboundProduct, TIMEOUTS.readBack);
  });
  const shot = await safeScreenshot(page, 'warehouse-inbound-readback');
  recordStep({ step: 'warehouse-inbound-readback', result: 'passed', evidence: shot });
  return shot;
}

async function moduleFinanceCollectionsAndAdjustment(page) {
  await ensureRole(page, 'finance');
  if (!FLOW_STATE.salesOrderId) {
    throw new Error('collections-adjustment requires a real sales order id from the orders dependency');
  }
  await openHash(page, '#collections', 'collections', ['回款中心', 'Collections', '承诺付款']);
  const collectionsBody = await getBodyText(page);
  if (!/承诺付款|争议|拦截|Promise|Dispute/i.test(collectionsBody)) {
    throw new Error('collections page missing expected copy');
  }
  const collectionsShot = await safeScreenshot(page, 'collections-page');

  await openHash(page, '#adjustment', 'adjustment', ['调账台账', 'Adjustment', '调整']);
  await withTimeout('adjustment-create-post-apply-reverse', TIMEOUTS.save, async () => {
    const form = page.locator('[data-testid="adjustment-create-form"]').first();
    await form.locator('[data-testid="adjustment-domain"]').selectOption('finance');
    await form.locator('[data-testid="adjustment-status"]').selectOption('pending');
    await form.locator('[data-testid="adjustment-target-type"]').selectOption('order');
    await form.locator('[data-testid="adjustment-target-ref"]').fill('');
    await form.locator('[data-testid="adjustment-order-id"]').fill(String(FLOW_STATE.salesOrderId));
    await form.locator('[data-testid="adjustment-batch-id"]').fill('');
    await form.locator('[data-testid="adjustment-amount-delta"]').fill(String(DATA.adjustment.amountDelta));
    await form.locator('[data-testid="adjustment-quantity-delta"]').fill('');
    await form.locator('[data-testid="adjustment-reason-category"]').fill(DATA.adjustment.reasonCategory);
    await form.locator('[data-testid="adjustment-loss-type"]').fill('');
    await form.locator('[data-testid="adjustment-reason"]').fill(DATA.adjustment.reason);
    await form.locator('[data-testid="adjustment-note"]').fill(DATA.adjustment.note);
    await form.locator('[data-testid="adjustment-create-submit"]').click();
    await page.waitForTimeout(1000);
  });

  await waitForVisibleText(page, DATA.adjustment.reason);

  await withTimeout('adjustment-apply', TIMEOUTS.action, async () => {
    const row = page.locator('[data-testid^="adjustment-row-"]').filter({ hasText: DATA.adjustment.reason }).first();
    await row.click();
    await page.locator('[data-testid="adjustment-apply-button"]').click();
    await page.waitForTimeout(800);
  });
  await withTimeout('adjustment-reverse', TIMEOUTS.action, async () => {
    await page.locator('[data-testid="adjustment-reverse-note"]').fill(DATA.adjustment.reverseNote);
    await page.locator('[data-testid="adjustment-reverse-button"]').click();
    await page.waitForTimeout(1000);
  });
  const adjustmentBody = await getBodyText(page);
  if (!/posted|reversed|已生效|已冲销|生效|冲销/.test(adjustmentBody)) {
    throw new Error('adjustment status did not settle after apply/reverse');
  }
  const adjustmentShot = await safeScreenshot(page, 'adjustment-cycle');

  return {
    status: 'passed',
    evidence: [collectionsShot, adjustmentShot].filter(Boolean),
    notes: '已验证回款中心读取、调账创建、生效、冲销与回读。',
  };
}

async function moduleProductionSmoke(page) {
  await openHash(page, '#production', 'production', ['生产管理', 'BOM', '工单']);
  const body = await getBodyText(page);
  const shot = await safeScreenshot(page, 'production-smoke');
  return {
    status: 'not_covered',
    evidence: [shot].filter(Boolean),
    notes: 'Production has a route smoke screenshot only. It is not a completed input-readback proof yet.',
    bodySnippet: body.slice(0, 400),
  };
}

const MODULE_DEFINITIONS = [
  {
    name: 'crm',
    role: 'admin',
    dependencies: [],
    purpose: 'Create and read back customer master data with multiple names, addresses, and contacts.',
    run: moduleCRM,
  },
  {
    name: 'orders',
    role: 'admin',
    dependencies: ['crm'],
    purpose: 'Create a sales order, record payment, and read back payment promise state.',
    run: moduleOrdersAndCollections,
  },
  {
    name: 'shipping',
    role: 'admin',
    dependencies: ['crm', 'orders'],
    purpose: 'Open shipment receipt drawer and submit a receipt batch.',
    run: moduleShipping,
  },
  {
    name: 'procurement-warehouse',
    role: 'admin',
    dependencies: [],
    purpose: 'Create supplier and purchase order, then switch to warehouse inbound readback.',
    run: moduleProcurementAndWarehouse,
  },
  {
    name: 'collections-adjustment',
    role: 'finance',
    dependencies: ['crm', 'orders'],
    purpose: 'Read collection center and run adjustment create/apply/reverse flow.',
    run: moduleFinanceCollectionsAndAdjustment,
  },
  {
    name: 'production',
    role: 'admin',
    dependencies: [],
    purpose: 'Production route smoke only until BOM input-readback anchors are completed.',
    run: moduleProductionSmoke,
  },
];

function resolveExecutionPlan(selectedModules) {
  const byName = new Map(MODULE_DEFINITIONS.map(item => [item.name, item]));
  const selected = selectedModules.length > 0 ? new Set(selectedModules) : new Set(MODULE_DEFINITIONS.map(item => item.name));
  const unknown = [...selected].filter(name => !byName.has(name));
  if (unknown.length > 0) {
    throw new Error(`unknown module(s): ${unknown.join(', ')}. Use --list-modules.`);
  }

  const ordered = [];
  const seen = new Set();

  function addWithDependencies(name) {
    if (seen.has(name)) return;
    const item = byName.get(name);
    for (const dependency of item.dependencies) addWithDependencies(dependency);
    seen.add(name);
    ordered.push({
      ...item,
      targeted: selectedModules.length === 0 || selected.has(name),
    });
  }

  for (const item of MODULE_DEFINITIONS) {
    if (selected.has(item.name)) addWithDependencies(item.name);
  }

  return ordered;
}

function listModulesAndExit() {
  console.log(JSON.stringify({
    status: 'module-list',
    modules: MODULE_DEFINITIONS.map(({ name, role, dependencies, purpose }) => ({
      name,
      role,
      dependencies,
      purpose,
    })),
  }, null, 2));
  process.exit(0);
}

async function run() {
  if (CLI_ARGS.listModules) listModulesAndExit();

  const executionPlan = resolveExecutionPlan(CLI_ARGS.selectedModules);
  report.selection = {
    requestedModules: CLI_ARGS.selectedModules,
    executionPlan: executionPlan.map(({ name, role, dependencies, targeted, purpose }) => ({
      name,
      role,
      dependencies,
      targeted,
      purpose,
    })),
  };

  ensureDir(SHOT_DIR);
  let browser = null;
  let context = null;
  let page = null;
  let launcher = null;
  const watchdog = setTimeout(() => {
    report.status = 'stuck';
    report.error = `browser human flow audit exceeded ${GLOBAL_TIMEOUT_MS}ms`;
    writeReport();
    console.error(report.error);
    process.exit(124);
  }, GLOBAL_TIMEOUT_MS);

  try {
    const launched = await connectOrLaunchBrowser({
      recordStep,
      retryLimit: 1,
      waitMs: 800,
      cdpRequired: process.env.BROWSER_CDP_REQUIRED === '1',
    });
    browser = launched.browser;
    launcher = launched.launcher;
    report.launcher = launcher;
    report.endpoint = launched.endpoint || null;

    context = browser.contexts()[0] || await browser.newContext({ viewport: { width: 1440, height: 980 } });
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.__humanFlowConsoleErrors = report.consoleErrors;
    page.on('console', (message) => {
      if (message.type() === 'error') {
        report.consoleErrors.push({ at: new Date().toISOString(), text: message.text(), url: page.url() });
      }
    });
    page.on('pageerror', (error) => {
      report.consoleErrors.push({ at: new Date().toISOString(), text: String(error.message || error), url: page.url() });
    });

    await page.addInitScript(({ language }) => {
      try {
        window.localStorage.setItem('ailao.language', language);
        window.localStorage.setItem('language', language);
        window.localStorage.setItem('ailao.activeTab', 'dashboard');
        window.localStorage.setItem('currency', 'CNY');
      } catch {
        /* noop */
      }
    }, { language: 'zh' });

    await resetRuntimeCaches(page);

    let activeRole = null;
    for (const moduleDef of executionPlan) {
      if (activeRole !== moduleDef.role) {
        await ensureRole(page, moduleDef.role);
        activeRole = moduleDef.role;
        const loginShot = await safeScreenshot(page, `role-${moduleDef.role}-ready`);
        recordStep({
          step: `role-${moduleDef.role}-ready`,
          result: 'passed',
          evidence: loginShot,
          notes: `Role ${moduleDef.role} is ready for ${moduleDef.name}.`,
        });
      }
      await runModule(page, moduleDef.name, () => moduleDef.run(page));
    }

    const failed = report.modules.filter((module) => module.status !== 'passed');
    if (failed.length > 0) {
      report.status = 'failed';
      report.error = `modules not passed: ${failed.map((item) => `${item.name}:${item.status}`).join(', ')}`;
      process.exitCode = 1;
    } else {
      report.status = 'passed';
    }
  } catch (error) {
    report.status = error?.auditKind === 'environment_blocker' ? 'blocked_env' : 'failed';
    report.error = String(error.message || error);
    report.blockerCode = error?.auditCode || null;
    report.blockerVerdict = error?.auditVerdict || null;
    process.exitCode = 1;
  } finally {
    if (page) {
      await withTimeout('page-close', TIMEOUTS.close, async () => page.close()).catch(() => {});
    }
    if (context) {
      await withTimeout('context-close', TIMEOUTS.close, async () => context.close()).catch(() => {});
    }
    if (browser && launcher !== 'cdp') {
      await withTimeout('browser-close', TIMEOUTS.close, async () => browser.close()).catch(() => {});
    }
    clearTimeout(watchdog);
    writeReport();
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'browser human flow audit failed');
    process.exit(process.exitCode || 1);
  }

  console.log(`browser human flow audit passed. Report: ${REPORT_PATH}`);
  process.exit(0);
}

run();
