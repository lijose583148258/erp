async function findCreatedSalesOrderRow(page, { DATA, FLOW_STATE, TIMEOUTS }) {
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

module.exports = {
  assertNoNewConsoleErrors,
  findCreatedSalesOrderRow,
  getConsoleErrorCount,
};
