const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');
const { loginUiAuditUser } = require('./lib/ui-audit-user.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const REPORT_PATH = path.join(process.cwd(), 'output', 'playwright', 'unsaved-changes-browser-audit-v1.json');
const UNSAVED_TEXT = '\u672a\u4fdd\u5b58';
const report = { startedAt: new Date().toISOString(), status: 'running', steps: [] };

function recordStep(step, details = {}) {
  if (typeof step === 'object' && step !== null) {
    report.steps.push({ at: new Date().toISOString(), ...step });
    return;
  }
  report.steps.push({ at: new Date().toISOString(), step, result: 'passed', ...details });
}

function expect(value, message) {
  if (!value) throw new Error(message);
}

async function readUnsavedState(page) {
  await page.waitForFunction(() => Boolean(window.__AILAODA_UNSAVED_STATE__), null, { timeout: 5000 }).catch(() => {});
  return page.evaluate(() => {
    const state = window.__AILAODA_UNSAVED_STATE__;
    if (!state || typeof state !== 'object') {
      return { dirtySourceIds: [], dirtyLabels: [], count: 0, missing: true };
    }
    return {
      dirtySourceIds: Array.isArray(state.dirtySourceIds) ? state.dirtySourceIds : [],
      dirtyLabels: Array.isArray(state.dirtyLabels) ? state.dirtyLabels : [],
      count: Number(state.count || 0),
      missing: false,
    };
  });
}

async function expectCleanUnsavedState(page, context, disallowedSourceIds = []) {
  const state = await readUnsavedState(page);
  expect(!state.missing, `${context}: __AILAODA_UNSAVED_STATE__ missing`);
  expect(state.count === 0, `${context}: expected clean unsaved state, got ${JSON.stringify(state)}`);
  disallowedSourceIds.forEach((sourceId) => {
    expect(!state.dirtySourceIds.includes(sourceId), `${context}: unexpected dirty source ${sourceId}`);
  });
  return state;
}

async function expectDirtyUnsavedState(page, context, sourceId) {
  const state = await readUnsavedState(page);
  expect(!state.missing, `${context}: __AILAODA_UNSAVED_STATE__ missing`);
  expect(state.dirtySourceIds.includes(sourceId), `${context}: expected dirty source ${sourceId}, got ${JSON.stringify(state)}`);
  return state;
}

async function clickWhenStable(locator, attempts = 5) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      await locator.waitFor({ state: 'visible', timeout: 10000 });
      await locator.click({ timeout: 10000 });
      return;
    } catch (error) {
      lastError = error;
      await locator.page().waitForTimeout(250);
    }
  }
  throw lastError;
}

async function seedLogin(page) {
  await loginUiAuditUser(page, APP_URL, {
    account: {
      username: 'ui_unsaved_admin',
      password: 'AuditSmoke12345!',
      role: 'admin',
    },
    storage: {
      'ailao.language': 'zh',
    },
  });
  await page.addInitScript(() => {
    Object.keys(localStorage)
      .filter((key) => key.startsWith('ailao.salesOrderDraft.'))
      .forEach((key) => localStorage.removeItem(key));
  });
}

async function answerNextDialog(page, accept) {
  return new Promise((resolve, reject) => {
    const onDialog = async (dialog) => {
      clearTimeout(timeout);
      page.off('dialog', onDialog);
      const message = dialog.message();
      if (accept) await dialog.accept();
      else await dialog.dismiss();
      resolve(message);
    };
    const timeout = setTimeout(() => {
      page.off('dialog', onDialog);
      reject(new Error('expected unsaved-changes dialog did not appear within 10000ms'));
    }, 10000);
    timeout.unref?.();
    page.once('dialog', onDialog);
  });
}

async function verifySalesOrder(page) {
  await openModule(page, 'orders', 'sales-order-create-button');
  await clickWhenStable(page.locator('[data-testid="sales-order-create-button"]'));
  const modal = page.locator('[data-testid="sales-order-editor-modal"]');
  await modal.waitFor({ state: 'visible', timeout: 10000 });
  await modal.locator('[data-testid="sales-order-notes"]').fill('UNSAVED-AUDIT');
  await page.waitForTimeout(1000);

  const dismissDialog = answerNextDialog(page, false);
  await modal.locator('[data-testid="sales-order-editor-close"]').click();
  const dismissMessage = await dismissDialog;
  expect(dismissMessage.includes(UNSAVED_TEXT), 'sales order close warning is unclear');
  expect(await modal.isVisible(), 'sales order modal closed after warning was dismissed');

  const draftState = await page.evaluate(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const expectedKey = user.id ? `ailao.salesOrderDraft.${user.id}.create` : '';
    return {
      userId: user.id,
      expectedKey,
      draft: expectedKey ? localStorage.getItem(expectedKey) : null,
      legacyDraft: localStorage.getItem('orderDraft'),
    };
  });
  expect(Boolean(draftState.userId), 'logged-in user id is missing');
  expect(Boolean(draftState.draft), 'user-scoped sales order draft was not persisted');
  expect(draftState.legacyDraft === null, 'legacy global orderDraft key should not be used');
  recordStep('sales-order-warning-and-draft');

  const acceptDialog = answerNextDialog(page, true);
  await modal.locator('[data-testid="sales-order-editor-close"]').click();
  await acceptDialog;
  await modal.waitFor({ state: 'hidden', timeout: 10000 });
  expect(Boolean(await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('ailao.salesOrderDraft.'))
    .some((key) => Boolean(localStorage.getItem(key))))), 'sales order draft disappeared after close');
  recordStep('sales-order-confirm-close');
}

async function verifyCrmCreate(page) {
  await page.goto(`${APP_URL}#crm`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('ailao.activeTab', 'crm'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  try {
    await page.locator('[data-testid="crm-add-customer"]').waitFor({ state: 'visible', timeout: 20000 });
  } catch {
    const state = await page.evaluate(() => ({
      hash: window.location.hash,
      activeTab: localStorage.getItem('ailao.activeTab'),
      hasToken: Boolean(localStorage.getItem('token')),
      body: document.body.innerText.slice(0, 1000),
    }));
    throw new Error(`CRM route not ready: ${JSON.stringify(state)}`);
  }
  await page.locator('[data-testid="crm-add-customer"]').click();
  const modal = page.locator('[data-testid="crm-create-modal"]');
  await modal.waitFor({ state: 'visible', timeout: 10000 });
  await modal.locator('[data-testid="crm-name"]').fill('UNSAVED-AUDIT');

  const dismissDialog = answerNextDialog(page, false);
  await modal.locator('[data-testid="crm-create-close"]').click();
  const message = await dismissDialog;
  expect(message.includes(UNSAVED_TEXT), 'CRM close warning is unclear');
  expect(await modal.isVisible(), 'CRM modal closed after warning was dismissed');
  recordStep('crm-create-warning');

  const acceptDialog = answerNextDialog(page, true);
  await modal.locator('[data-testid="crm-create-close"]').click();
  await acceptDialog;
  await modal.waitFor({ state: 'hidden', timeout: 10000 });
  recordStep('crm-create-confirm-close');
}

async function openModule(page, moduleId, readyTestId) {
  await page.goto(`${APP_URL}#${moduleId}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((nextModuleId) => localStorage.setItem('ailao.activeTab', nextModuleId), moduleId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator(`[data-testid="${readyTestId}"]`).waitFor({ state: 'visible', timeout: 20000 });
}

async function verifyCleanNavigation(page, moduleId, readyTestId) {
  await openModule(page, moduleId, readyTestId);
  await page.waitForTimeout(500);
  await expectCleanUnsavedState(page, `${moduleId} clean navigation before leave`);
  let unexpectedDialog = '';
  page.once('dialog', async (dialog) => {
    unexpectedDialog = dialog.message();
    await dialog.accept();
  });
  await page.evaluate(() => {
    window.location.hash = '#dashboard';
  });
  await page.waitForFunction(() => window.location.hash === '#dashboard', null, { timeout: 10000 });
  expect(!unexpectedDialog, `${moduleId} clean navigation showed an unsaved warning: ${unexpectedDialog}`);
  await expectCleanUnsavedState(page, `${moduleId} clean navigation after leave`);
  recordStep(`${moduleId}-clean-navigation`);
}

async function verifyProductionBom(page) {
  await openModule(page, 'production', 'production-desk-bom');
  await page.locator('[data-testid="production-bom-save"]').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="production-bom-save"]')?.hasAttribute('disabled'), null, { timeout: 20000 });
  await expectCleanUnsavedState(page, 'production bom initial state', [
    'production-bom-form',
    'production-work-order-form',
    'production-quality-form',
    'production-batch-adjustment-form',
  ]);
  await page.locator('[data-testid="production-bom-product-name"]').fill('UNSAVED-BOM-AUDIT');
  await expectDirtyUnsavedState(page, 'production bom after manual input', 'production-bom-form');

  const dismissDialog = answerNextDialog(page, false);
  await page.evaluate(() => {
    window.location.hash = '#dashboard';
  });
  const dismissMessage = await dismissDialog;
  expect(dismissMessage.includes(UNSAVED_TEXT), 'production BOM navigation warning is unclear');
  expect(await page.locator('[data-testid="production-bom-product-name"]').inputValue() === 'UNSAVED-BOM-AUDIT', 'production BOM draft disappeared after navigation was dismissed');
  await expectDirtyUnsavedState(page, 'production bom after dismiss navigation', 'production-bom-form');
  recordStep('production-bom-navigation-warning');

  const acceptDialog = answerNextDialog(page, true);
  await page.evaluate(() => {
    window.location.hash = '#dashboard';
  });
  await acceptDialog;
  await page.waitForFunction(() => window.location.hash === '#dashboard', null, { timeout: 10000 });
  recordStep('production-bom-confirm-leave');
}

async function verifyProductionWorkOrder(page) {
  await openModule(page, 'production', 'production-desk-work-orders');
  await page.locator('[data-testid="production-desk-work-orders"]').click();
  await page.locator('[data-testid="production-work-order-target-quantity"]').waitFor({ state: 'visible', timeout: 20000 });
  await expectCleanUnsavedState(page, 'production work order initial state', [
    'production-work-order-form',
    'production-quality-form',
    'production-bom-form',
    'production-batch-adjustment-form',
  ]);
  await page.locator('[data-testid="production-work-order-target-quantity"]').fill('25');
  await page.waitForTimeout(200);
  await expectDirtyUnsavedState(page, 'production work order after manual input', 'production-work-order-form');

  const dismissDialog = answerNextDialog(page, false);
  await page.evaluate(() => {
    window.location.hash = '#dashboard';
  });
  const message = await dismissDialog;
  expect(message.includes(UNSAVED_TEXT), 'production work order navigation warning is unclear');
  expect(await page.locator('[data-testid="production-work-order-target-quantity"]').inputValue() === '25', 'production work order draft disappeared after navigation was dismissed');
  await expectDirtyUnsavedState(page, 'production work order after dismiss navigation', 'production-work-order-form');
  recordStep('production-work-order-navigation-warning');

  const acceptDialog = answerNextDialog(page, true);
  await page.evaluate(() => {
    window.location.hash = '#dashboard';
  });
  await acceptDialog;
  await page.waitForFunction(() => window.location.hash === '#dashboard', null, { timeout: 10000 });
  recordStep('production-work-order-confirm-leave');
}

async function verifyProductionBatchSubTabClean(page) {
  await openModule(page, 'production', 'production-desk-batches');
  await page.locator('[data-testid="production-desk-batches"]').click();
  await page.locator('[data-testid="production-batch-search-input"]').waitFor({ state: 'visible', timeout: 20000 });
  await expectCleanUnsavedState(page, 'production batches initial state', [
    'production-batch-adjustment-form',
    'production-bom-form',
    'production-work-order-form',
    'production-quality-form',
  ]);
  recordStep('production-batches-clean-state');
}

async function verifyAdjustment(page) {
  await openModule(page, 'adjustment', 'adjustment-create-form');
  await page.locator('[data-testid="adjustment-reason"]').fill('UNSAVED-ADJUSTMENT-AUDIT');

  const dismissDialog = answerNextDialog(page, false);
  await page.evaluate(() => {
    window.location.hash = '#dashboard';
  });
  const message = await dismissDialog;
  expect(message.includes(UNSAVED_TEXT), 'adjustment navigation warning is unclear');
  expect(await page.locator('[data-testid="adjustment-reason"]').inputValue() === 'UNSAVED-ADJUSTMENT-AUDIT', 'adjustment draft disappeared after navigation was dismissed');
  recordStep('adjustment-navigation-warning');

  const acceptDialog = answerNextDialog(page, true);
  await page.evaluate(() => {
    window.location.hash = '#dashboard';
  });
  await acceptDialog;
  await page.waitForFunction(() => window.location.hash === '#dashboard', null, { timeout: 10000 });
  recordStep('adjustment-confirm-leave');
}

async function verifyWarehouseForms(page) {
  await openModule(page, 'warehouse', 'warehouse-tab-overview');
  await page.locator('[data-testid="warehouse-create-open"]').click();
  const warehouseModal = page.locator('[data-testid="warehouse-create-modal"]');
  await warehouseModal.waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-testid="warehouse-create-name-input"]').fill('UNSAVED-WAREHOUSE-AUDIT');

  const dismissDialog = answerNextDialog(page, false);
  await page.locator('[data-testid="warehouse-create-cancel"]').click();
  const dismissMessage = await dismissDialog;
  expect(dismissMessage.includes(UNSAVED_TEXT), 'warehouse create warning is unclear');
  expect(await warehouseModal.isVisible(), 'warehouse create modal closed after warning was dismissed');
  recordStep('warehouse-create-warning');

  const acceptDialog = answerNextDialog(page, true);
  await page.locator('[data-testid="warehouse-create-cancel"]').click();
  await acceptDialog;
  await warehouseModal.waitFor({ state: 'hidden', timeout: 10000 });
  recordStep('warehouse-create-confirm-close');

  await page.locator('[data-testid="warehouse-location-create-open"]').click();
  const locationModal = page.locator('[data-testid="warehouse-location-create-modal"]');
  await locationModal.waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-testid="warehouse-location-create-name-input"]').fill('UNSAVED-LOCATION-AUDIT');
  const locationDismissDialog = answerNextDialog(page, false);
  await page.locator('[data-testid="warehouse-location-create-cancel"]').click();
  const locationMessage = await locationDismissDialog;
  expect(locationMessage.includes(UNSAVED_TEXT), 'warehouse location warning is unclear');
  expect(await locationModal.isVisible(), 'warehouse location modal closed after warning was dismissed');
  recordStep('warehouse-location-create-warning');

  const locationAcceptDialog = answerNextDialog(page, true);
  await page.locator('[data-testid="warehouse-location-create-cancel"]').click();
  await locationAcceptDialog;
  await locationModal.waitFor({ state: 'hidden', timeout: 10000 });
  recordStep('warehouse-location-create-confirm-close');

  await page.locator('[data-testid="warehouse-tab-inbound"]').click();
  await page.locator('[data-testid="warehouse-inbound-product-input"]').fill('UNSAVED-INBOUND-AUDIT');
  await page.waitForTimeout(200);
  const inboundDismissDialog = answerNextDialog(page, false);
  await page.evaluate(() => {
    window.location.hash = '#dashboard';
  });
  const inboundMessage = await inboundDismissDialog;
  expect(inboundMessage.includes(UNSAVED_TEXT), 'warehouse inbound navigation warning is unclear');
  expect(await page.locator('[data-testid="warehouse-inbound-product-input"]').inputValue() === 'UNSAVED-INBOUND-AUDIT', 'warehouse inbound draft disappeared after navigation was dismissed');
  recordStep('warehouse-inbound-navigation-warning');

  const inboundAcceptDialog = answerNextDialog(page, true);
  await page.evaluate(() => {
    window.location.hash = '#dashboard';
  });
  await inboundAcceptDialog;
  await page.waitForFunction(() => window.location.hash === '#dashboard', null, { timeout: 10000 });
  recordStep('warehouse-inbound-confirm-leave');
}

async function main() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  let browser;
  try {
    const launched = await launchBrowserWithGuard({ recordStep, retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    report.launcher = launched.launcher;
    const salesPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await seedLogin(salesPage);
    await verifySalesOrder(salesPage);
    await salesPage.close();

    const crmPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await seedLogin(crmPage);
    await verifyCrmCreate(crmPage);
    await crmPage.close();

    const productionPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await seedLogin(productionPage);
    await verifyProductionBom(productionPage);
    await productionPage.close();

    const workOrderPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await seedLogin(workOrderPage);
    await verifyProductionWorkOrder(workOrderPage);
    await workOrderPage.close();

    const productionBatchesPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await seedLogin(productionBatchesPage);
    await verifyProductionBatchSubTabClean(productionBatchesPage);
    await productionBatchesPage.close();

    const adjustmentPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await seedLogin(adjustmentPage);
    await verifyAdjustment(adjustmentPage);
    await adjustmentPage.close();

    const warehousePage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await seedLogin(warehousePage);
    await verifyWarehouseForms(warehousePage);
    await warehousePage.close();

    for (const [moduleId, readyTestId] of [
      ['production', 'production-desk-bom'],
      ['procurement', 'procurement-input-guide'],
      ['adjustment', 'adjustment-create-form'],
      ['warehouse', 'warehouse-tab-overview'],
    ]) {
      const cleanPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await seedLogin(cleanPage);
      await verifyCleanNavigation(cleanPage, moduleId, readyTestId);
      await cleanPage.close();
    }

    report.status = 'passed';
  } catch (error) {
    report.error = String(error?.message || error);
    markReportFromLaunchError(report, error);
    if (report.status !== 'blocked_env') process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (browser) await browser.close();
  }
}

main();
