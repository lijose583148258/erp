const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const REPORT_PATH = path.join(process.cwd(), 'output', 'playwright', 'unsaved-changes-browser-audit-v1.json');
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

async function seedLogin(page) {
  const response = await page.request.post(`${APP_URL}api/auth/login`, {
    data: { username: 'admin', password: 'admin123', role: 'super_admin' },
  });
  expect(response.ok(), `login failed: ${response.status()}`);
  const json = await response.json();
  const token = json?.data?.token;
  const user = json?.data?.user;
  expect(token && user, 'login response missing token or user');
  await page.addInitScript(({ token, user }) => {
    const appUser = {
      id: String(user.id),
      name: user.username,
      role: user.role,
      segment: user.segment || 'mixed',
      avatar: user.avatar || '',
    };
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(appUser));
    localStorage.setItem('ailao.language', 'zh');
    localStorage.removeItem('orderDraft');
  }, { token, user });
}

async function answerNextDialog(page, accept) {
  return new Promise((resolve) => {
    page.once('dialog', async (dialog) => {
      const message = dialog.message();
      if (accept) await dialog.accept();
      else await dialog.dismiss();
      resolve(message);
    });
  });
}

async function verifySalesOrder(page) {
  await page.goto(`${APP_URL}#orders`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('ailao.activeTab', 'orders');
    window.location.hash = '#orders';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await page.locator('[data-testid="sales-order-create-button"]').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('[data-testid="sales-order-create-button"]').click();
  const modal = page.locator('[data-testid="sales-order-editor-modal"]');
  await modal.waitFor({ state: 'visible', timeout: 10000 });
  await modal.locator('[data-testid="sales-order-notes"]').fill('UNSAVED-AUDIT');
  await page.waitForTimeout(300);

  const dismissDialog = answerNextDialog(page, false);
  await modal.locator('[data-testid="sales-order-editor-close"]').click();
  const dismissMessage = await dismissDialog;
  expect(dismissMessage.includes('未保存'), 'sales order close warning is unclear');
  expect(await modal.isVisible(), 'sales order modal closed after warning was dismissed');

  const draft = await page.evaluate(() => localStorage.getItem('orderDraft'));
  expect(Boolean(draft), 'sales order draft was not persisted');
  recordStep('sales-order-warning-and-draft');

  const acceptDialog = answerNextDialog(page, true);
  await modal.locator('[data-testid="sales-order-editor-close"]').click();
  await acceptDialog;
  await modal.waitFor({ state: 'hidden', timeout: 10000 });
  expect(Boolean(await page.evaluate(() => localStorage.getItem('orderDraft'))), 'sales order draft disappeared after close');
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
  expect(message.includes('未保存'), 'CRM close warning is unclear');
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

async function verifyProductionBom(page) {
  await openModule(page, 'production', 'production-desk-bom');
  await page.locator('[data-testid="production-bom-save"]').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="production-bom-save"]')?.hasAttribute('disabled'), null, { timeout: 20000 });
  await page.locator('[data-testid="production-bom-product-name"]').fill('UNSAVED-BOM-AUDIT');

  const dismissDialog = answerNextDialog(page, false);
  await page.evaluate(() => {
    window.location.hash = '#dashboard';
  });
  const dismissMessage = await dismissDialog;
  expect(dismissMessage.includes('未保存'), 'production BOM navigation warning is unclear');
  expect(await page.locator('[data-testid="production-bom-product-name"]').inputValue() === 'UNSAVED-BOM-AUDIT', 'production BOM draft disappeared after navigation was dismissed');
  recordStep('production-bom-navigation-warning');

  const acceptDialog = answerNextDialog(page, true);
  await page.evaluate(() => {
    window.location.hash = '#dashboard';
  });
  await acceptDialog;
  await page.waitForFunction(() => window.location.hash === '#dashboard', null, { timeout: 10000 });
  recordStep('production-bom-confirm-leave');
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
