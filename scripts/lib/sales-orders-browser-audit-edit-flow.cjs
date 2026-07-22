function buildEditedOrderExpectation(testData) {
  const updatedPackaging = String(testData.updatedPackaging || '').trim();
  const updatedQuantity = Number(testData.updatedQuantity);
  if (!updatedPackaging) throw new Error('updated sales order packaging fixture is required');
  if (!Number.isFinite(updatedQuantity) || updatedQuantity <= 0) {
    throw new Error('updated sales order quantity fixture must be positive');
  }
  return { ...testData, packaging: updatedPackaging, quantity: updatedQuantity };
}

function createSalesOrderEditFlow({
  testData,
  report,
  timeouts,
  apiFetch,
  assertCreatedOrderReadback,
  clickAndRemember,
  recordStep,
  safeScreenshot,
  waitForCreatedOrderRow,
  waitForInputValue,
  waitForModalClosedOrSaveError,
  withTimebox,
}) {
  async function editCreatedOrder(page, orderId) {
    return withTimebox(page, 'edit-sales-order-items', timeouts.save, async () => {
      const row = await waitForCreatedOrderRow(page, orderId);
      await row.hover();
      const editButton = row.locator('[data-testid="sales-order-edit-button"]').first();
      if (!(await editButton.count())) throw new Error('sales order edit button not found');
      await clickAndRemember(editButton, 'edit sales order');

      const modal = page.locator('[data-testid="sales-order-editor-modal"]').first();
      await modal.waitFor({ state: 'visible', timeout: timeouts.modal });
      const packagingInput = modal.locator('[data-testid="sales-order-line-0-packaging"]');
      const quantityInput = modal.locator('[data-testid="sales-order-line-0-quantity"]');
      await waitForInputValue(packagingInput, testData.packaging, 'persisted packaging before edit');
      await waitForInputValue(quantityInput, String(testData.quantity), 'persisted quantity before edit');
      await packagingInput.fill(testData.updatedPackaging);
      await quantityInput.fill(String(testData.updatedQuantity));
      await waitForInputValue(packagingInput, testData.updatedPackaging, 'updated packaging input');
      await waitForInputValue(quantityInput, String(testData.updatedQuantity), 'updated quantity input');

      const saveButton = modal.locator('[data-testid="sales-order-save-button"]').first();
      await clickAndRemember(saveButton, 'save edited sales order');
      await waitForModalClosedOrSaveError(page, modal);

      const response = await apiFetch(page, `/orders/${orderId}`);
      if (!response.ok) throw new Error(`edited order detail api failed: ${response.status}`);
      const expected = buildEditedOrderExpectation(testData);
      const detail = response.json?.data;
      const line = assertCreatedOrderReadback(detail, expected, report.seedCustomer);
      report.editedOrder = {
        id: detail.id,
        packaging: line.packagingSpec || line.specification,
        quantity: Number(line.quantity),
        totalAmount: Number(detail.totalAmount),
        finalAmount: Number(detail.finalAmount),
      };
      const evidence = await safeScreenshot(page, 'sales-order-edited-readback');
      recordStep({
        step: 'sales-order-edited-readback-evidence',
        result: 'passed',
        evidence,
        editedOrder: report.editedOrder,
      });
      return detail;
    });
  }

  return { editCreatedOrder };
}

module.exports = { buildEditedOrderExpectation, createSalesOrderEditFlow };
