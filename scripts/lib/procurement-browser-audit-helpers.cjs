function createProcurementBrowserAuditHelpers({
  appUrl,
  captureScreenshot,
  forbiddenMojibake,
  getAuditAccount,
  getAuthToken,
  loginUiAuditUser,
  readBackTimeout,
  recordStep,
  runId,
  runWithTimebox,
  setAuthToken,
  shotDir,
  timeouts,
}) {
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

  async function selectOptionByValue(locator, value) {
    await locator.waitFor({ state: 'visible', timeout: readBackTimeout });
    await locator.selectOption(String(value));
  }

  async function replaceInputValue(locator, value) {
    await locator.waitFor({ state: 'visible', timeout: readBackTimeout });
    await locator.click();
    await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await locator.type(String(value));
  }

  function unwrapList(payload) {
    const data = payload?.json?.data;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  }

  function assertNoMojibake(text, scopeName) {
    for (const keyword of forbiddenMojibake) {
      if (text.includes(keyword)) throw new Error(`${scopeName} contains mojibake: ${keyword}`);
    }
    if (text.includes('undefined') || text.includes('\ufffd')) {
      throw new Error(`${scopeName} contains visible undefined or replacement char`);
    }
  }

  async function apiFetch(page, endpoint, options = {}) {
    const method = options.method || 'GET';
    const token = getAuthToken();
    const response = await page.request.fetch(`${appUrl}api${endpoint}`, {
      ...options,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { ok: response.ok(), status: response.status(), json };
  }

  async function verifyNavigationWarning(page, expectedValue, step) {
    await page.waitForTimeout(100);
    const dialogPromise = answerNextDialog(page, false);
    await page.evaluate(() => { window.location.hash = '#dashboard'; });
    const message = await dialogPromise;
    if (!message.includes('未保存')) throw new Error(`${step} warning is unclear: ${message}`);
    const currentHash = await page.evaluate(() => window.location.hash);
    if (currentHash === '#dashboard') throw new Error(`${step} navigation was not cancelled`);
    recordStep({ step, result: 'passed', evidence: expectedValue });
  }

  async function safeScreenshot(page, name) {
    return captureScreenshot(page, shotDir, name);
  }

  async function withTimebox(page, step, timeout, task) {
    return runWithTimebox(page, recordStep, step, timeout, task, shotDir);
  }

  async function seedLoginState(page) {
    return withTimebox(page, 'seed-login-state', timeouts.login, async () => {
      const { token } = await loginUiAuditUser(page, appUrl, {
        account: getAuditAccount(),
        defaultStorage: {
          'ailao.activeTab': 'procurement',
          'ailao.language': 'zh',
          language: 'zh-CN',
          currency: 'CNY',
        },
      });
      setAuthToken(token);
    });
  }

  async function resolveForcePasswordChange(page) {
    const card = page.locator('[data-testid="force-password-change"]');
    if (!(await card.count())) return;
    await card.waitFor({ state: 'visible', timeout: timeouts.route });
    const fields = await card.locator('input[type="password"]').all();
    if (fields.length < 3) throw new Error(`force password change inputs missing: ${fields.length}`);
    const account = getAuditAccount();
    if (!account?.password) throw new Error('procurement audit account is unavailable');
    const nextPassword = `ProcurementAudit${runId.slice(-6)}!`;
    await fields[0].fill(account.password);
    await fields[1].fill(nextPassword);
    await fields[2].fill(nextPassword);
    await page.getByTestId('force-password-change-submit').click();
    await card.waitFor({ state: 'detached', timeout: timeouts.route });
  }

  return {
    answerNextDialog,
    apiFetch,
    assertNoMojibake,
    replaceInputValue,
    resolveForcePasswordChange,
    safeScreenshot,
    seedLoginState,
    selectOptionByValue,
    unwrapList,
    verifyNavigationWarning,
    withTimebox,
  };
}

module.exports = { createProcurementBrowserAuditHelpers };
