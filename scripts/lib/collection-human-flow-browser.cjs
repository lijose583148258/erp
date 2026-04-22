const fs = require('fs');
const path = require('path');
const { toDatetimeLocal } = require('./audit-runtime-utils.cjs');

async function setupBrowserContext(browser, admin, report) {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1600, height: 1200 },
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    report.consoleErrors.push({
      at: new Date().toISOString(),
      text: message.text(),
    });
  });
  page.on('pageerror', (error) => {
    report.pageErrors.push({
      at: new Date().toISOString(),
      message: String(error?.message || error),
    });
  });

  const currentUser = {
    id: String(admin.user.id),
    name: admin.user.username,
    role: admin.user.role || 'admin',
    segment: admin.user.segment || 'mixed',
    avatar: admin.user.avatar || '',
    permissions: Array.isArray(admin.user.permissions) ? admin.user.permissions : [],
  };

  await page.addInitScript(({ token, user }) => {
    window.localStorage.setItem('token', token);
    window.localStorage.setItem('user', JSON.stringify(user));
    window.localStorage.setItem('ailao.activeTab', 'collections');
    window.localStorage.setItem('ailao.language', 'zh');
    window.localStorage.setItem('currency', 'CNY');
  }, { token: admin.token, user: currentUser });

  return { context, page };
}

async function openCollectionsRoute(runtime, page, { appUrl, copy, forbiddenTokens, stepTimeoutMs }) {
  return runtime.withTimeout('browser-open-collections-route', stepTimeoutMs, async () => {
    await page.goto(`${appUrl}#collections`, { waitUntil: 'domcontentloaded', timeout: stepTimeoutMs });
    await page.waitForLoadState('networkidle', { timeout: stepTimeoutMs }).catch(() => {});
    await page.getByText(copy.workbench).first().waitFor({ state: 'visible', timeout: stepTimeoutMs });
    const bodyText = await runtime.assertBodyClean(page, 'collections route', forbiddenTokens);
    runtime.expect(bodyText.includes(copy.overdue), 'collections route missing overdue tab copy');
    runtime.expect(bodyText.includes(copy.promiseTable), 'collections route missing promise table copy');
    const screenshot = await runtime.saveScreenshot(page, '01-collections-route');
    runtime.recordStep({ step: 'browser-route-evidence', result: 'passed', screenshot, url: page.url() });
  });
}

async function clickTabsAndSelectOrder(runtime, page, seed, { copy, forbiddenTokens, stepTimeoutMs }) {
  return runtime.withTimeout('browser-tabs-and-overdue-selection', stepTimeoutMs, async () => {
    await page.getByTestId('collection-tab-ledger').click();
    await page.getByText(copy.ledger).first().waitFor({ state: 'visible', timeout: stepTimeoutMs });
    await runtime.assertBodyClean(page, 'ledger tab', forbiddenTokens);

    await page.getByTestId('collection-tab-milestones').click();
    await page.getByText(copy.milestone).first().waitFor({ state: 'visible', timeout: stepTimeoutMs });
    await runtime.assertBodyClean(page, 'milestone tab', forbiddenTokens);

    await page.getByTestId('collection-tab-overdue').click();
    await page.getByTestId('collection-overdue-search').fill(seed.order.orderNo);
    await page.waitForTimeout(250);
    const overdueRow = page.getByTestId(`collection-overdue-row-${seed.order.id}`);
    await overdueRow.waitFor({ state: 'visible', timeout: stepTimeoutMs });
    await overdueRow.click();
    await page.getByText(copy.currentTarget).first().waitFor({ state: 'visible', timeout: stepTimeoutMs });
    const bodyText = await runtime.assertBodyClean(page, 'selected overdue order', forbiddenTokens);
    runtime.expect(bodyText.includes(seed.order.orderNo), 'selected order number missing after row click', { orderNo: seed.order.orderNo });
    const screenshot = await runtime.saveScreenshot(page, '02-selected-overdue-order');
    runtime.recordStep({ step: 'browser-selected-order-evidence', result: 'passed', screenshot, orderId: seed.order.id, orderNo: seed.order.orderNo });
  });
}

async function submitPromiseByUi(runtime, page, seed, token, { testData, copy, forbiddenTokens, stepTimeoutMs }) {
  return runtime.withTimeout('browser-submit-promise-and-api-readback', stepTimeoutMs * 2, async () => {
    await page.getByTestId(`collection-overdue-promise-${seed.order.id}`).click();
    await page.getByTestId('collection-action-modal').waitFor({ state: 'visible', timeout: stepTimeoutMs });
    await page.getByTestId('collection-action-promised-amount').fill(String(testData.promiseAmount));
    await page.getByTestId('collection-action-promised-at').fill(toDatetimeLocal(new Date(Date.now() + 48 * 3600 * 1000)));
    await page.getByTestId('collection-action-note').fill(testData.promiseNote);
    await page.getByTestId('collection-action-submit').click();
    await page.getByTestId('collection-action-modal').waitFor({ state: 'hidden', timeout: stepTimeoutMs });

    const response = await runtime.apiFetch('/collections/promises', {}, token);
    runtime.expectStatus(response, [200], 'promise readback');
    const promise = runtime.listOf(response).find((row) => Number(row.orderId) === Number(seed.order.id) && String(row.note || '').includes(testData.promiseNote));
    runtime.expect(Boolean(promise?.id), 'UI-created promise missing from API readback', response.json);

    const bodyText = await runtime.assertBodyClean(page, 'promise submitted', forbiddenTokens);
    runtime.expect(bodyText.includes(testData.promiseNote) || bodyText.includes(copy.promiseTable), 'promise table did not remain visible after submit');
    const screenshot = await runtime.saveScreenshot(page, '03-promise-submitted');
    runtime.recordStep({ step: 'browser-promise-readback-evidence', result: 'passed', screenshot, promiseId: promise.id });
    return promise;
  });
}

async function submitDisputeByUi(runtime, page, seed, token, { testData, forbiddenTokens, stepTimeoutMs }) {
  return runtime.withTimeout('browser-submit-dispute-and-api-readback', stepTimeoutMs * 2, async () => {
    await page.getByTestId(`collection-overdue-dispute-${seed.order.id}`).click();
    await page.getByTestId('collection-action-modal').waitFor({ state: 'visible', timeout: stepTimeoutMs });
    await page.getByTestId('collection-action-dispute-reason').fill(testData.disputeReason);
    await page.getByTestId('collection-action-note').fill(testData.disputeNote);
    await page.getByTestId('collection-action-submit').click();
    await page.getByTestId('collection-action-modal').waitFor({ state: 'hidden', timeout: stepTimeoutMs });

    const response = await runtime.apiFetch('/collections/disputes', {}, token);
    runtime.expectStatus(response, [200], 'dispute readback');
    const dispute = runtime.listOf(response).find((row) => Number(row.orderId) === Number(seed.order.id) && String(row.note || '').includes(testData.disputeNote));
    runtime.expect(Boolean(dispute?.id), 'UI-created dispute missing from API readback', response.json);

    await runtime.assertBodyClean(page, 'dispute submitted', forbiddenTokens);
    const screenshot = await runtime.saveScreenshot(page, '04-dispute-submitted');
    runtime.recordStep({ step: 'browser-dispute-readback-evidence', result: 'passed', screenshot, disputeId: dispute.id });
    return dispute;
  });
}

async function exerciseFilters(runtime, page, { forbiddenTokens, stepTimeoutMs }) {
  return runtime.withTimeout('browser-filter-and-sort-controls', stepTimeoutMs, async () => {
    for (const testId of [
      'collection-promise-filter-all',
      'collection-promise-filter-open',
      'collection-promise-sort-amount_desc',
      'collection-promise-sort-promised_at_desc',
      'collection-dispute-filter-all',
      'collection-dispute-filter-active',
      'collection-hold-filter-active',
      'collection-hold-filter-all',
      'collection-hold-scope-order-shipment',
      'collection-hold-scope-all',
    ]) {
      const locator = page.getByTestId(testId);
      await locator.scrollIntoViewIfNeeded();
      await locator.click();
      await page.waitForTimeout(150);
      await runtime.assertBodyClean(page, `filter ${testId}`, forbiddenTokens);
    }
    const screenshot = await runtime.saveScreenshot(page, '05-filters-and-sorts');
    runtime.recordStep({ step: 'browser-filter-sort-evidence', result: 'passed', screenshot });
  });
}

async function downloadExport(runtime, page, { outputDir, report, testId, label, downloadTimeoutMs }) {
  return runtime.withTimeout(`browser-export-${label}`, downloadTimeoutMs, async () => {
    const button = page.getByTestId(testId);
    await button.scrollIntoViewIfNeeded();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: downloadTimeoutMs }),
      button.click(),
    ]);
    const suggested = download.suggestedFilename() || `${label}.xlsx`;
    const safeName = suggested.replace(/[\\/:*?"<>|]/g, '_');
    const savePath = path.join(outputDir, `${label}-${safeName}`);
    await download.saveAs(savePath);
    const size = fs.existsSync(savePath) ? fs.statSync(savePath).size : 0;
    runtime.expect(size > 0, `${label} export produced empty file`, { savePath, size });
    report.downloads.push({ label, testId, suggested, savePath, size });
    runtime.recordStep({ step: `browser-export-${label}-evidence`, result: 'passed', savePath, size });
  });
}

async function exerciseExports(runtime, page, options) {
  await downloadExport(runtime, page, { ...options, testId: 'collection-export-promises', label: 'promises' });
  await downloadExport(runtime, page, { ...options, testId: 'collection-export-disputes', label: 'disputes' });
  await downloadExport(runtime, page, { ...options, testId: 'collection-export-holds', label: 'holds' });
}

async function verifyLedgerPaymentByUi(runtime, page, seed, token, { forbiddenTokens, stepTimeoutMs }) {
  return runtime.withTimeout('browser-ledger-verify-payment-and-api-readback', stepTimeoutMs * 2, async () => {
    await page.getByTestId('collection-tab-ledger').click();
    await page.getByTestId(`collection-ledger-row-${seed.paymentId}`).waitFor({ state: 'visible', timeout: stepTimeoutMs });
    await page.getByTestId(`collection-ledger-verify-${seed.paymentId}`).click();
    await page.waitForTimeout(1200);

    const orderResponse = await runtime.apiFetch(`/orders/${seed.order.id}`, {}, token);
    runtime.expectStatus(orderResponse, [200], 'order readback after ledger verify');
    const order = runtime.dataOf(orderResponse);
    runtime.expect(Number(order?.paidAmount) >= 100, 'ledger verify did not update order paidAmount', order);
    runtime.expect(['partial', 'paid'].includes(String(order?.paymentStatus)), 'ledger verify did not update order paymentStatus', order);
    await runtime.assertBodyClean(page, 'ledger payment verification', forbiddenTokens);
    const screenshot = await runtime.saveScreenshot(page, '06-ledger-payment-verified');
    runtime.recordStep({
      step: 'browser-ledger-verify-evidence',
      result: 'passed',
      screenshot,
      paidAmount: order.paidAmount,
      paymentStatus: order.paymentStatus,
    });
  });
}

function assertNoBrowserRuntimeErrors(runtime, report) {
  const filteredConsoleErrors = report.consoleErrors.filter((entry) => {
    const text = String(entry.text || '');
    return !text.includes('favicon') && !text.includes('net::ERR_ABORTED');
  });
  runtime.expect(filteredConsoleErrors.length === 0, 'browser console errors were captured', filteredConsoleErrors);
  runtime.expect(report.pageErrors.length === 0, 'browser page errors were captured', report.pageErrors);
}

module.exports = {
  assertNoBrowserRuntimeErrors,
  clickTabsAndSelectOrder,
  exerciseExports,
  exerciseFilters,
  openCollectionsRoute,
  setupBrowserContext,
  submitDisputeByUi,
  submitPromiseByUi,
  verifyLedgerPaymentByUi,
};
