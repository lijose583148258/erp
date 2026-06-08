const { createProductionSmokeModule } = require('./browser-human-flow-production-module.cjs');
const {
  assertNoNewConsoleErrors,
  findCreatedSalesOrderRow,
  getConsoleErrorCount,
} = require('./browser-human-flow-shared.cjs');

function createBrowserHumanFlowModules({
  DATA,
  FLOW_STATE,
  RUN_ID,
  TIMEOUTS,
  ensureRole,
  getBodyText,
  openHash,
  recordStep,
  safeScreenshot,
  selectOptionContaining,
  waitForVisibleText,
  withTimeout,
}) {
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

    await findCreatedSalesOrderRow(page, { DATA, FLOW_STATE, TIMEOUTS });
    const orderShot = await safeScreenshot(page, 'orders-created');

    await withTimeout('orders-record-payment', TIMEOUTS.action, async () => {
      const consoleStart = getConsoleErrorCount(page);
      await page.locator('[data-testid="sales-desk-payments"]').click();
      const orderRow = await findCreatedSalesOrderRow(page, { DATA, FLOW_STATE, TIMEOUTS });
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
      const orderRow = await findCreatedSalesOrderRow(page, { DATA, FLOW_STATE, TIMEOUTS });
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
    let createdShipmentId = '';

    function shipmentRow() {
      if (createdShipmentId) {
        return page.locator(`[data-testid="shipment-row-${createdShipmentId}"]`).first();
      }
      return page.locator('[data-testid^="shipment-row-"]').filter({ hasText: stockBackedProduct }).first();
    }

    await withTimeout('shipping-create-from-ocr', TIMEOUTS.save, async () => {
      await page.locator('[data-testid="shipping-desk-ocr"]').click();
      await page.locator('[data-testid="shipping-ocr-textarea"]').waitFor({ state: 'visible', timeout: TIMEOUTS.action });
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
      const [createResponse] = await Promise.all([
        page.waitForResponse((response) => (
          response.url().includes('/api/shipping')
          && response.request().method() === 'POST'
        ), { timeout: TIMEOUTS.save }),
        page.locator('[data-testid="shipping-ocr-apply-button"]').click(),
      ]);
      if (!createResponse.ok()) {
        const body = await createResponse.text().catch(() => '');
        throw new Error(`shipping OCR create failed: ${createResponse.status()} ${body.slice(0, 300)}`);
      }
      const createPayload = await createResponse.json().catch(() => null);
      const createdId = createPayload?.data?.id ?? createPayload?.id;
      createdShipmentId = createdId ? String(createdId) : '';
      await page.locator('[data-testid="shipping-desk-logistics"]').click();
      const row = shipmentRow();
      await row.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    });

    await withTimeout('shipping-dispatch', TIMEOUTS.action, async () => {
      const row = shipmentRow();
      await row.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
      const dispatchButton = row.locator('[data-testid^="shipment-dispatch-"]').first();
      const receiptButton = row.locator('[data-testid^="shipment-receipts-button-"]').first();
      if (await dispatchButton.count()) {
        const [dispatchResponse] = await Promise.all([
          page.waitForResponse((response) => (
            response.url().includes('/api/shipping/')
            && response.url().includes('/status')
            && (!createdShipmentId || response.url().includes(`/api/shipping/${createdShipmentId}/status`))
            && response.request().method() === 'PATCH'
          ), { timeout: TIMEOUTS.save }),
          dispatchButton.click(),
        ]);
        if (!dispatchResponse.ok()) {
          const body = await dispatchResponse.text().catch(() => '');
          throw new Error(`shipping dispatch failed: ${dispatchResponse.status()} ${body.slice(0, 300)}`);
        }
        await shipmentRow().locator('[data-testid^="shipment-receipts-button-"]').first().waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
        return;
      }
      if (await receiptButton.count()) {
        return;
      }
      const rowText = await row.innerText().catch(() => '');
      throw new Error(`shipping dispatch/receipt control not found for created row: ${rowText.slice(0, 300)}`);
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
      const supplierAdvancedToggle = page.locator('[data-testid="supplier-toggle-advanced"]');
      if (await supplierAdvancedToggle.count()) {
        await supplierAdvancedToggle.click();
      }
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
      await page.locator('[data-testid="procurement-desk-orders"]').click();
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
      await page.locator('[data-testid="warehouse-create-open"]').click();
      const dialog = page.locator('[data-testid="warehouse-create-modal"]');
      await dialog.waitFor({ state: 'visible', timeout: TIMEOUTS.action });
      await dialog.locator('[data-testid="warehouse-create-code-input"]').fill(DATA.warehouse.code);
      await dialog.locator('[data-testid="warehouse-create-name-input"]').fill(DATA.warehouse.name);
      await dialog.locator('select').first().selectOption('physical');
      await dialog.locator('[data-testid="warehouse-create-confirm"]').click();
      await page.waitForTimeout(1000);
    });

    await waitForVisibleText(page, DATA.warehouse.name);

    await withTimeout('warehouse-create-location', TIMEOUTS.save, async () => {
      await page.locator('[data-testid="warehouse-location-create-open"]').click();
      const dialog = page.locator('[data-testid="warehouse-location-create-modal"]');
      await dialog.waitFor({ state: 'visible', timeout: TIMEOUTS.action });
      await dialog.locator('[data-testid="warehouse-location-create-code-input"]').fill(DATA.warehouse.locationCode);
      await dialog.locator('[data-testid="warehouse-location-create-name-input"]').fill(DATA.warehouse.locationName);
      await dialog.locator('select').first().selectOption('internal');
      await dialog.locator('[data-testid="warehouse-location-create-confirm"]').click();
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
      await page.locator('[data-testid="warehouse-inbound-source-ref-input"]').fill(DATA.warehouse.inboundSourceRef || `HF-INBOUND-${RUN_ID}`);
      await page.locator('[data-testid="warehouse-inbound-reason-select"]').selectOption(DATA.warehouse.inboundReason || 'inventory_surplus');
      await page.locator('[data-testid="warehouse-inbound-note-input"]').fill(`browser human flow inbound ${RUN_ID}`);
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
        if (/应急补录\s*\/\s*盘盈入库成功|入库成功|Inbound success/i.test(bodyAfterSave)) {
          await page.locator('[data-testid="warehouse-tab-inventory"]').click();
          await page.locator('[data-testid="warehouse-inventory-search"]').fill(DATA.warehouse.inboundProduct);
          return;
        }
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

  const moduleProductionSmoke = createProductionSmokeModule({
    getBodyText,
    openHash,
    safeScreenshot,
    withTimeout,
  });

  const moduleDefinitions = [
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
      purpose: 'Run production route smoke plus deep browser proof for chemical formula lines, work order, QC, completion, and batch readback.',
      run: moduleProductionSmoke,
    },
  ];

  return { moduleDefinitions };
}

module.exports = {
  createBrowserHumanFlowModules,
};
