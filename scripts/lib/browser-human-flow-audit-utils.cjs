const fs = require('fs');
const path = require('path');
const { loginUiAuditUser } = require('./ui-audit-user.cjs');

function createBrowserHumanFlowData(runId) {
  const suffix = runId.slice(-6);

  return {
    crm: {
      name: `HF-CRM-${runId}`,
      nameZh: `护风 CRM ${suffix}`,
      nameEn: `HF CRM ${suffix}`,
      nameVi: `HF CRM VN ${suffix}`,
      alias: `HF-CRM-ALIAS-${suffix}\nHF-CUSTOMER-${suffix}`,
      licenseNumber: `LIC-${runId}`,
      creditLimit: 880000,
      termsDays: 60,
      notes: `浏览器人工流客户 ${runId}`,
      siteLabel: `主站点-${suffix}`,
      registeredName: `护风化工有限公司 ${suffix}`,
      registrationNo: `REG-${runId}`,
      taxNo: `TAX-${runId}`,
      city: '胡志明市',
      countryCode: 'VN',
      fullAddress: `No. ${suffix}, Industrial Zone, Ho Chi Minh City`,
      contactName: `Nguyen ${suffix}`,
      contactRole: 'Purchasing Manager',
      contactPhone: `09${suffix}`,
      contactEmail: `crm${suffix}@ailao.test`,
      contactDepartment: '采购',
      extraSiteLabel: `发货站点-${suffix}`,
      extraSiteAddress: `Shipping yard ${suffix}`,
      extraContactName: `Mai-${suffix}`,
      extraContactPhone: `08${suffix}`,
    },
    order: {
      productName: `HF-ORDER-${runId}`,
      packaging: `25kg/桶 ${suffix}`,
      quantity: 12,
      unit: 'kg',
      unitPrice: 188.8,
      taxAmount: 0,
      paymentAmount: 800,
      paymentNote: `HF-PAY-${runId}`,
      promiseAmount: 600,
      promiseNote: `HF-PROMISE-${runId}`,
    },
    procurement: {
      supplierName: `HF-SUP-${runId}`,
      supplierNameZh: `护风供应商 ${suffix}`,
      supplierNameEn: `HF Supplier ${suffix}`,
      supplierNameVi: `HF Nhà cung cấp ${suffix}`,
      supplierAlias: `HF-SUP-ALIAS-${suffix}\nHF-VENDOR-${suffix}`,
      category: 'Chemical Raw Material',
      contactName: `Nguyen ${suffix}`,
      phone: `09${suffix}`,
      email: `supplier${suffix}@ailao.test`,
      addressLabel: `主地址-${suffix}`,
      countryCode: 'VN',
      city: 'Binh Duong',
      fullAddress: `Lot ${suffix}, Binh Duong Industrial Park`,
      purchaseItem: `胶水树脂-${runId}`,
      purchaseQuantity: 25,
      purchaseUnit: 'kg',
      purchasePrice: 7200,
      purchaseEta: new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10),
    },
    warehouse: {
      code: `WH-MAIN-${suffix}`,
      name: `主仓库 WH-MAIN ${suffix}`,
      locationCode: `LOC-RAW-${suffix}`,
      locationName: `原料区 LOC-RAW ${suffix}`,
      inboundProduct: `胶水原料-${runId}`,
      batchNo: `BATCH-${runId}`,
      inboundQuantity: 30,
      inboundUnit: 'kg',
      inboundSourceRef: `HF-INBOUND-${runId}`,
      inboundReason: 'inventory_surplus',
    },
    adjustment: {
      targetRef: `HF-ADJ-${runId}`,
      reasonCategory: 'payment',
      reason: `回款差额人工调整 ${runId}`,
      note: `浏览器人工流调账 ${runId}`,
      amountDelta: 128.88,
      reverseNote: `人工冲销 ${runId}`,
    },
    shipping: {
      quantity: 3,
      acceptedQuantity: 2,
      rejectedQuantity: 1,
      discrepancyReason: `签收差异 ${runId}`,
      note: `人工签收批次 ${runId}`,
    },
  };
}

function createBrowserHumanFlowAuditContext({
  appUrl,
  outputDir,
  shotDir,
  reportPath,
  runId,
  data,
  rolePasswords,
  timeouts,
}) {
  const report = {
    appUrl,
    startedAt: new Date().toISOString(),
    runId,
    data,
    modules: [],
    steps: [],
    consoleErrors: [],
    status: 'running',
  };

  function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
  }

  function recordStep(entry) {
    report.steps.push({ at: new Date().toISOString(), ...entry });
  }

  function writeReport() {
    report.finishedAt = report.finishedAt || new Date().toISOString();
    ensureDir(outputDir);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  }

  async function withTimeout(name, timeoutMs, action) {
    const started = Date.now();
    try {
      const result = await Promise.race([
        action(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} exceeded ${timeoutMs}ms`)), timeoutMs)),
      ]);
      recordStep({ step: name, result: 'passed', durationMs: Date.now() - started, timeoutMs });
      return result;
    } catch (error) {
      recordStep({ step: name, result: 'failed', durationMs: Date.now() - started, timeoutMs, error: String(error.message || error) });
      throw error;
    }
  }

  async function screenshot(page, name) {
    ensureDir(shotDir);
    const filePath = path.join(shotDir, `${name}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  }

  async function safeScreenshot(page, name) {
    try {
      return await withTimeout(`screenshot-${name}`, timeouts.screenshot, async () => screenshot(page, name));
    } catch {
      return null;
    }
  }

  async function getBodyText(page) {
    return page.locator('body').innerText().catch(() => '');
  }

  const mojibakeTokens = [
    '\u93b6',
    '\u5a34',
    '\u934f',
    '\u9416',
    '\u7481',
    '\u7eef',
    '\u7039',
    '\u9358',
    '\u93c2',
    '\u95b2',
    '\u6d60\u6493',
    '\u6434\u6493',
    '\u6748',
    '\u7b5b',
    '\u6fb6\u8f81\u89e6',
    '\u4e36\u74c5',
    '\u5cb7',
  ];

  function hasCorruption(text) {
    return /undefined\s+undefined/i.test(text)
      || /\ufffd+/u.test(text)
      || mojibakeTokens.some((token) => text.includes(token));
  }

  async function assertRouteText(page, moduleName, expectedTexts) {
    const text = await getBodyText(page);
    if (hasCorruption(text)) {
      throw new Error(`${moduleName} visible text has corruption signal`);
    }
    const matched = expectedTexts.find((item) => text.includes(item));
    if (!matched) {
      throw new Error(`${moduleName} missing expected text: ${expectedTexts.join(' | ')}`);
    }
    return text;
  }

  async function waitForRouteReady(page, moduleName, expectedTexts) {
    const started = Date.now();
    let lastText = '';
    let lastState = 'not checked';
    while (Date.now() - started < timeouts.route) {
      lastText = await getBodyText(page);
      if (hasCorruption(lastText)) {
        throw new Error(`${moduleName} visible text has corruption signal`);
      }
      const matched = expectedTexts.find((item) => lastText.includes(item));
      const isStillLoading = /LOADING\.\.\.|加载中|正在加载|Đang tải/i.test(lastText);
      if (matched && !isStillLoading) {
        return lastText;
      }
      lastState = matched ? 'matched expected text but content stayed loading' : `missing expected text: ${expectedTexts.join(' | ')}`;
      await page.waitForTimeout(300);
    }
    throw new Error(`${moduleName} ${lastState}; last text: ${lastText.slice(0, 500)}`);
  }

  async function openHash(page, hash, moduleName, expectedTexts) {
    await withTimeout(`route-${moduleName}`, timeouts.route, async () => {
      await page.evaluate((nextHash) => {
        window.location.hash = nextHash;
      }, hash);
      await waitForRouteReady(page, moduleName, expectedTexts);
    });
    return safeScreenshot(page, `route-${moduleName}`);
  }

  async function resetRuntimeCaches(page) {
    await withTimeout('browser-runtime-cache-reset', timeouts.action, async () => {
      await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: timeouts.pageLoad });
      await page.evaluate(async () => {
        const registrations = navigator.serviceWorker?.getRegistrations
          ? await navigator.serviceWorker.getRegistrations()
          : [];
        await Promise.all(registrations.map((registration) => registration.unregister()));

        if (window.caches?.keys) {
          const cacheNames = await window.caches.keys();
          await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
        }
      });
    });
  }

  async function clickByText(scope, regex) {
    const button = scope.locator('button').filter({ hasText: regex }).first();
    if (!(await button.count())) {
      throw new Error(`button not found: ${regex}`);
    }
    await button.click();
  }

  async function selectOptionContaining(selectLocator, text) {
    const value = await selectLocator.evaluate((element, expectedText) => {
      const options = Array.from(element.options || []);
      const option = options.find((item) => String(item.textContent || '').includes(String(expectedText)));
      return option ? option.value : '';
    }, text);
    if (!value) {
      throw new Error(`select option not found: ${text}`);
    }
    await selectLocator.selectOption(value);
    return value;
  }

  async function logoutIfNeeded(page) {
    const logoutButton = page.locator('button').filter({ hasText: /安全退出系统|Secure Sign Out|退出|Logout/i }).first();
    if (await logoutButton.count()) {
      await logoutButton.click().catch(() => {});
      await page.waitForTimeout(800);
      return;
    }
    const loginInput = page.locator('#login-username');
    if (await loginInput.count()) return;
    await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: timeouts.pageLoad }).catch(() => {});
  }

  async function loginRole(page, role) {
    await withTimeout(`login-${role}`, timeouts.login, async () => {
      if (role === 'admin') {
        await loginUiAuditUser(page, appUrl, {
          storage: {
            'ailao.language': 'zh',
            language: 'zh',
            'ailao.theme': 'light',
            currency: 'CNY',
            'ailao.activeTab': 'dashboard',
          },
        });
        await page.goto(`${appUrl}#dashboard`, { waitUntil: 'domcontentloaded', timeout: timeouts.pageLoad });
        await page.reload({ waitUntil: 'domcontentloaded', timeout: timeouts.pageLoad });
        await page.getByTestId('theme-toggle').waitFor({ state: 'visible', timeout: timeouts.login });
        return;
      }

      await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: timeouts.pageLoad });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

      if (!(await page.locator('#login-username').count())) {
        await logoutIfNeeded(page);
        await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: timeouts.pageLoad });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      }

      await page.locator('#login-username').fill(role);
      await page.locator('#login-password').fill(rolePasswords[role]);
      const roleSelect = page.locator('select').first();
      if (await roleSelect.count()) {
        await roleSelect.selectOption(role);
      }
      await page.locator('button[type="submit"]').click();
      const started = Date.now();
      while (Date.now() - started < timeouts.login) {
        const body = await getBodyText(page);
        if (/登录失败|Invalid credentials|用户名或密码错误/i.test(body)) {
          throw new Error(`login-${role} rejected`);
        }

        const token = await page.evaluate(() => window.localStorage.getItem('token')).catch(() => null);
        const loginInputCount = await page.locator('#login-username').count().catch(() => 1);
        if (token && loginInputCount === 0) {
          return;
        }

        await page.waitForTimeout(250);
      }

      throw new Error(`login-${role} did not reach authenticated shell`);
    });
    if (role === 'admin') {
      return safeScreenshot(page, `login-${role}`);
    }
    await assertRouteText(page, `login-${role}`, ['Dashboard', '工作台', '安全退出系统', '仓储 / 物流']).catch(async () => {
      const body = await getBodyText(page);
      if (/登录失败|Invalid credentials|用户名或密码错误/i.test(body)) {
        throw new Error(`login-${role} rejected`);
      }
      throw new Error(`login-${role} shell text not visible after authentication`);
    });
    return safeScreenshot(page, `login-${role}`);
  }

  async function ensureRole(page, role) {
    await logoutIfNeeded(page);
    await loginRole(page, role);
  }

  async function waitForVisibleText(page, text, timeoutMs = timeouts.readBack) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const body = await getBodyText(page);
      if (body.includes(text)) return body;
      await page.waitForTimeout(250);
    }
    throw new Error(`text not visible within ${timeoutMs}ms: ${text}`);
  }

  async function waitForRowContaining(page, text, timeoutMs = timeouts.readBack) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const rows = page.locator('tbody tr');
      const count = await rows.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const row = rows.nth(index);
        const rowText = await row.innerText().catch(() => '');
        if (rowText.includes(text)) return row;
      }
      await page.waitForTimeout(250);
    }
    throw new Error(`row not found within ${timeoutMs}ms: ${text}`);
  }

  async function runModule(page, name, fn) {
    const started = Date.now();
    const moduleRecord = {
      name,
      startedAt: new Date().toISOString(),
      status: 'running',
      evidence: [],
      consoleErrorsBefore: report.consoleErrors.length,
    };
    report.modules.push(moduleRecord);

    try {
      const result = await fn();
      moduleRecord.status = result?.status || 'passed';
      if (result?.evidence) {
        moduleRecord.evidence = Array.isArray(result.evidence) ? result.evidence : [result.evidence];
      }
      if (result?.notes) {
        moduleRecord.notes = result.notes;
      }
    } catch (error) {
      moduleRecord.status = 'failed';
      moduleRecord.error = String(error.message || error);
      const failShot = await safeScreenshot(page, `fail-${name.replace(/[^a-z0-9-]/gi, '_')}`);
      if (failShot) moduleRecord.evidence.push(failShot);
      recordStep({ step: `module-${name}`, result: 'failed', error: moduleRecord.error });
    } finally {
      moduleRecord.consoleErrorsAfter = report.consoleErrors.length;
      moduleRecord.consoleErrorsDelta = moduleRecord.consoleErrorsAfter - moduleRecord.consoleErrorsBefore;
      moduleRecord.durationMs = Date.now() - started;
      moduleRecord.finishedAt = new Date().toISOString();
    }

    return moduleRecord;
  }

  return {
    assertRouteText,
    clickByText,
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
    waitForRowContaining,
    waitForVisibleText,
    withTimeout,
    writeReport,
  };
}

module.exports = {
  createBrowserHumanFlowData,
  createBrowserHumanFlowAuditContext,
};
