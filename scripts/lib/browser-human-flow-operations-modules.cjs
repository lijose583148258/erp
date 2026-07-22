function createOperationsHumanFlowModules({
  DATA,
  FLOW_STATE,
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
    await ensureRole(page, 'admin');
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

  return { moduleProcurementAndWarehouse, moduleFinanceCollectionsAndAdjustment };
}

module.exports = { createOperationsHumanFlowModules };
