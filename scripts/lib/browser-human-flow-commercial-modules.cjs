const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const {
  assertNoNewConsoleErrors,
  findCreatedSalesOrderRow,
  getConsoleErrorCount,
} = require('./browser-human-flow-shared.cjs');

function normalizeExcelValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in value) return String(value.text || '');
  if (typeof value === 'object' && 'result' in value) return String(value.result || '');
  return String(value);
}

function worksheetToObjects(worksheet) {
  if (!worksheet) return [];
  const headers = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    headers[column - 1] = normalizeExcelValue(cell.value).trim() || `Column ${column}`;
  });

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = {};
    headers.forEach((header, index) => {
      record[header] = normalizeExcelValue(row.getCell(index + 1).value);
    });
    rows.push(record);
  });
  return rows;
}

function createCommercialHumanFlowModules({
  DATA,
  FLOW_STATE,
  RUN_ID,
  TIMEOUTS,
  getBodyText,
  openHash,
  safeScreenshot,
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
      const dialog = modal.locator('[role="dialog"]').first();
      if (await dialog.getAttribute('aria-modal') !== 'true') {
        throw new Error('CRM create modal is missing modal dialog semantics');
      }
      await page.waitForTimeout(100);
      const activeTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      if (activeTestId !== 'crm-name') {
        throw new Error(`CRM create dialog initial focus is incorrect: ${activeTestId || 'none'}`);
      }
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
      const notes = modal.locator('[data-testid="crm-notes"]');
      await notes.fill('超'.repeat(1001));
      if (await notes.getAttribute('aria-invalid') !== 'true') {
        throw new Error('CRM notes did not expose the over-limit state');
      }
      await modal.locator('[data-testid="crm-create-submit"]').click();
      if (!(await modal.isVisible())) throw new Error('over-limit CRM notes did not block create');
      await notes.fill(DATA.crm.notes);
      await modal.locator('[data-testid="crm-create-submit"]').click();
    });

    await modal.waitFor({ state: 'hidden', timeout: TIMEOUTS.save });
    const returnedTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    if (returnedTestId !== 'crm-add-customer') {
      throw new Error(`CRM create dialog did not return focus to its trigger: ${returnedTestId || 'none'}`);
    }
    await waitForVisibleText(page, DATA.crm.nameZh);
    const createdShot = await safeScreenshot(page, 'crm-created');

    await withTimeout('crm-readback-row', TIMEOUTS.readBack, async () => {
      await page.locator('[data-testid="crm-search"]').fill(DATA.crm.nameZh);
      await page.waitForTimeout(500);
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: TIMEOUTS.readBack }),
        page.locator('[data-testid="crm-customers-export"]').click(),
      ]);
      const exportPath = path.join(process.cwd(), 'output', 'playwright', `crm-customers-${RUN_ID}.xlsx`);
      await download.saveAs(exportPath);
      const exportSize = fs.statSync(exportPath).size;
      if (exportSize < 1000) throw new Error(`CRM export file is unexpectedly small: ${exportSize} bytes`);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(exportPath);
      const exportedRows = worksheetToObjects(workbook.worksheets[0]);
      if (!exportedRows.some((row) => Object.values(row).some((value) => String(value).includes(DATA.crm.nameZh)))) {
        throw new Error('CRM filtered server export does not contain the searched customer');
      }
      await page.waitForTimeout(300);
      const urlBeforeReload = new URL(page.url());
      if (urlBeforeReload.searchParams.get('crmSearch') !== DATA.crm.nameZh) {
        throw new Error('CRM search state was not synchronized to the URL');
      }
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('[data-testid="crm-search"]').waitFor({ state: 'visible', timeout: TIMEOUTS.pageLoad });
      if (await page.locator('[data-testid="crm-search"]').inputValue() !== DATA.crm.nameZh) {
        throw new Error('CRM search state was not restored after reload');
      }
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
      evidence: [
        createdShot,
        readbackShot,
        path.join(process.cwd(), 'output', 'playwright', `crm-customers-${RUN_ID}.xlsx`),
      ].filter(Boolean),
      notes: '已验证客户主档、三语名称、主地址、主联系人、别名、筛选后服务端导出与刷新后回读。',
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
      await customerSelect.fill(DATA.crm.nameZh);
      const customerOption = modal.locator('[data-testid^="sales-order-customer-option-"]').first();
      await customerOption.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
      await customerOption.click();
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

    const stockBackedProduct = DATA.shipping.productName;
    let createdShipmentId = '';

    function shipmentRow() {
      if (createdShipmentId) {
        return page.locator(`[data-testid="shipment-row-${createdShipmentId}"]`).first();
      }
      return page.locator('[data-testid^="shipment-row-"]').filter({ hasText: stockBackedProduct }).first();
    }

    await withTimeout('shipping-seed-finished-goods', TIMEOUTS.save, async () => {
      const result = await page.evaluate(async (payload) => {
        const token = window.localStorage.getItem('token');
        const response = await fetch('/api/assets/batches', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        return { status: response.status, body: await response.text() };
      }, {
        productName: stockBackedProduct,
        batchNo: DATA.shipping.batchNo,
        productionDate: new Date().toISOString().slice(0, 10),
        expiryDate: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
        stockQuantity: DATA.shipping.quantity + 2,
        unit: 'kg',
        notes: `Human-flow shipping stock ${RUN_ID}`,
      });
      if (result.status !== 201) {
        throw new Error(`shipping finished-goods seed failed: ${result.status} ${result.body.slice(0, 300)}`);
      }
      recordStep({ step: 'shipping-seed-finished-goods', result: 'passed', productName: stockBackedProduct, batchNo: DATA.shipping.batchNo });
    });

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

  return { moduleCRM, moduleOrdersAndCollections, moduleShipping };
}

module.exports = { createCommercialHumanFlowModules };
