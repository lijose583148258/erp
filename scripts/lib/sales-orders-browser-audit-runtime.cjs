const fs = require('fs');
const path = require('path');
const { loginUiAuditUser } = require('./ui-audit-user.cjs');

function createSalesOrdersBrowserAuditRuntime({ appUrl, auditAccount, testData, report, shotDir, timeouts }) {
  let authToken = '';

  function ensureDir(target) {
    fs.mkdirSync(target, { recursive: true });
  }

  function recordStep(entry) {
    report.steps.push({ at: new Date().toISOString(), ...entry });
  }

  async function safeScreenshot(page, name) {
    const filePath = path.join(shotDir, `${name}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  }

  async function withTimebox(page, step, timeout, task) {
    const started = Date.now();
    let timeoutId;
    try {
      const result = await Promise.race([
        task(),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`${step} exceeded ${timeout}ms`)), timeout);
        }),
      ]);
      recordStep({ step, timeout, result: 'passed', durationMs: Date.now() - started });
      return result;
    } catch (error) {
      let screenshot = null;
      let screenshotError = null;
      try {
        screenshot = await safeScreenshot(page, `fail-${step}`);
      } catch (captureError) {
        screenshotError = String(captureError.message || captureError);
      }
      recordStep({
        step,
        timeout,
        result: 'failed',
        durationMs: Date.now() - started,
        error: String(error.message || error),
        screenshot,
        screenshotError,
        pageHash: await page.evaluate(() => window.location.hash).catch(() => ''),
        lastClickText: report.lastClickText || null,
        lastApiRequestUrl: report.lastApiRequestUrl || null,
        lastApiResponseUrl: report.lastApiResponseUrl || null,
        lastApiResponseStatus: report.lastApiResponseStatus || null,
        consoleErrors: report.consoleErrors || [],
      });
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async function seedLoginState(page) {
    return withTimebox(page, 'seed-login-state', timeouts.login, async () => {
      const { token, user } = await loginUiAuditUser(page, appUrl, {
        account: auditAccount,
        defaultStorage: {
          'ailao.activeTab': 'orders',
          'ailao.language': 'zh',
          language: 'zh-CN',
          currency: 'CNY',
        },
      });
      authToken = token;

      await page.addInitScript(({ savedToken, savedUser }) => {
        const appUser = {
          id: String(savedUser.id),
          name: savedUser.username,
          role: savedUser.role,
          segment: savedUser.segment || 'mixed',
          avatar: savedUser.avatar || '',
        };
        window.localStorage.setItem('token', savedToken);
        window.localStorage.setItem('user', JSON.stringify(appUser));
        window.localStorage.setItem('auth_token', savedToken);
        window.localStorage.setItem('erp_auth_token', savedToken);
        window.localStorage.setItem('currentUser', JSON.stringify(savedUser));
        window.localStorage.setItem('erp_current_user', JSON.stringify(savedUser));
        window.localStorage.setItem('erp_current_role', savedUser.role || 'super_admin');
        window.localStorage.setItem('ailao.activeTab', 'orders');
        window.localStorage.setItem('ailao.language', 'zh');
        window.localStorage.setItem('language', 'zh-CN');
        window.localStorage.setItem('currency', 'CNY');
      }, { savedToken: token, savedUser: user });

      return { token, user };
    });
  }

  async function apiFetch(page, endpoint, options = {}) {
    const method = options.method || 'GET';
    const fetchWithToken = () => page.request.fetch(`${appUrl}api${endpoint}`, {
      ...options,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(options.headers || {}),
      },
    });
    let response = await fetchWithToken();
    if (response.status() === 401) {
      await seedLoginState(page);
      response = await fetchWithToken();
    }
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: response.ok(), status: response.status(), json };
  }

  async function seedAuditCustomer(page) {
    return withTimebox(page, 'seed-sales-order-customer', timeouts.api, async () => {
      const payload = {
        name: testData.customerName,
        nameZh: testData.customerName,
        creditLimit: 100000,
        usedCredit: 0,
        termsDays: 30,
        riskLevel: 'low',
        segment: 'direct',
        poolState: 'internal',
        contacts: [],
        addresses: [],
        status: 'active',
      };
      const response = await apiFetch(page, '/customers', { method: 'POST', data: payload });
      if (!response.ok) throw new Error(`seed customer failed: ${response.status} ${JSON.stringify(response.json || {})}`);
      const customer = response.json?.data;
      if (!customer?.id) throw new Error('seed customer response missing id');
      report.seedCustomer = {
        id: String(customer.id),
        label: customer.displayName || customer.nameZh || customer.name || testData.customerName,
      };
      return report.seedCustomer;
    });
  }

  async function clickAndRemember(locator, fallbackText = '') {
    report.lastClickText = fallbackText || (await locator.innerText().catch(() => ''));
    await locator.click();
  }

  async function waitForInputValue(locator, expected, label) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const actual = await locator.inputValue().catch(() => '');
      if (String(actual) === String(expected)) return;
      await locator.page().waitForTimeout(100);
    }
    const actual = await locator.inputValue().catch(() => '');
    throw new Error(`${label} did not settle: expected ${expected}, got ${actual}`);
  }

  async function waitForModalClosedOrSaveError(page, modal) {
    const started = Date.now();
    const errorSummary = modal.locator('[data-testid="sales-order-line-error-summary"]').first();
    const lineError = modal.locator('[data-testid="sales-order-line-0-errors"]').first();
    while (Date.now() - started < timeouts.save) {
      if (!(await modal.isVisible().catch(() => false))) return;
      if (await errorSummary.isVisible().catch(() => false)) {
        const summary = await errorSummary.innerText().catch(() => '');
        const line = await lineError.innerText().catch(() => '');
        throw new Error(`sales order save blocked by validation: ${summary} ${line}`.trim());
      }
      await page.waitForTimeout(300);
    }
    throw new Error('sales order editor did not close after save');
  }

  return {
    apiFetch,
    clickAndRemember,
    ensureDir,
    recordStep,
    safeScreenshot,
    seedAuditCustomer,
    seedLoginState,
    waitForInputValue,
    waitForModalClosedOrSaveError,
    withTimebox,
  };
}

module.exports = { createSalesOrdersBrowserAuditRuntime };
