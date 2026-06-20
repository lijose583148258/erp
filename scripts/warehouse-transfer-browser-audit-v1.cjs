const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'warehouse-transfer-browser-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const AUDIT_USER = {
  username: process.env.WAREHOUSE_BROWSER_AUDIT_USER || 'audit_warehouse',
  password: process.env.WAREHOUSE_BROWSER_AUDIT_PASSWORD || 'AuditWarehouse123!',
  tempPassword: process.env.WAREHOUSE_BROWSER_AUDIT_TEMP_PASSWORD || 'AuditWarehouseTemp123!',
};

const DATA = {
  productName: `WH-XFER-UI-RESIN-${RUN_ID}`,
  batchNo: `WH-XFER-UI-BATCH-${RUN_ID}`,
  initialQuantity: 42,
  transferQuantity: 12,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  data: DATA,
  steps: [],
  status: 'running',
};

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

async function apiFetch(endpoint, options = {}, token = '') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timeout after 15000ms for ${endpoint}`)), 15000);
  try {
    const response = await fetch(`${APP_URL}api${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.data ? JSON.stringify(options.data) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: response.ok, status: response.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

function unwrapData(response) {
  return response?.json?.data ?? null;
}

function unwrapList(response) {
  const data = unwrapData(response);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function expectOk(label, promise) {
  const response = await promise;
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response;
}

async function loginApi(username, password) {
  const response = await expectOk(`login ${username}`, apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  }));
  const data = unwrapData(response);
  if (!data?.token) throw new Error(`login ${username} returned no token`);
  return data;
}

async function ensureWarehouseAuditUser() {
  const existing = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username: AUDIT_USER.username, password: AUDIT_USER.password },
  });
  const existingData = unwrapData(existing);
  if (existing.ok && existingData?.token && existingData.user?.mustChangePassword === false) {
    recordStep({ step: 'audit-warehouse-user-ready', result: 'passed', mode: 'existing' });
    return existingData;
  }

  const admin = await loginApi('admin', 'admin123');
  const register = await apiFetch('/auth/register', {
    method: 'POST',
    data: {
      username: AUDIT_USER.username,
      password: AUDIT_USER.tempPassword,
      email: `${AUDIT_USER.username}@local.test`,
      role: 'warehouse',
      segment: 'mixed',
    },
  }, admin.token);
  if (![201, 400].includes(register.status)) {
    throw new Error(`audit warehouse user register failed: ${register.status} ${JSON.stringify(register.json)}`);
  }

  const tempLogin = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username: AUDIT_USER.username, password: AUDIT_USER.tempPassword },
  });
  const tempData = unwrapData(tempLogin);
  if (tempLogin.ok && tempData?.token) {
    const change = await apiFetch('/auth/password', {
      method: 'PUT',
      data: { oldPassword: AUDIT_USER.tempPassword, newPassword: AUDIT_USER.password },
    }, tempData.token);
    if (!change.ok) {
      throw new Error(`audit warehouse user password change failed: ${change.status} ${JSON.stringify(change.json)}`);
    }
  }

  const ready = await expectOk('login ready audit warehouse user', apiFetch('/auth/login', {
    method: 'POST',
    data: { username: AUDIT_USER.username, password: AUDIT_USER.password },
  }));
  const readyData = unwrapData(ready);
  if (!readyData?.token || readyData.user?.mustChangePassword) {
    throw new Error('audit warehouse user is not ready after setup');
  }
  recordStep({ step: 'audit-warehouse-user-ready', result: 'passed', mode: register.status === 201 ? 'created' : 'reused' });
  return readyData;
}

async function getDefaultLocations(token) {
  const response = await expectOk('list warehouses', apiFetch('/warehouses', {}, token));
  const warehouses = unwrapList(response);
  const main = warehouses.find(item => String(item.code) === 'WH-MAIN');
  if (!main) throw new Error('WH-MAIN warehouse not found');
  const raw = (main.locations || []).find(item => String(item.code) === 'LOC-RAW');
  const wip = (main.locations || []).find(item => String(item.code) === 'LOC-WIP');
  if (!raw) throw new Error('LOC-RAW location not found');
  if (!wip) throw new Error('LOC-WIP location not found');
  return { raw, wip };
}

async function getBalances(token) {
  const response = await expectOk(
    'list stock balances after browser transfer',
    apiFetch(`/warehouses/stock-balances?productName=${encodeURIComponent(DATA.productName)}&pageSize=100`, {}, token),
  );
  return unwrapList(response).filter(item => String(item.batchNo) === DATA.batchNo);
}

function findBalance(rows, locationId) {
  return rows.find(item => Number(item.locationId) === Number(locationId));
}

async function loginBrowser(page) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.locator('#login-username').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#login-username').fill(AUDIT_USER.username);
  await page.locator('#login-password').fill(AUDIT_USER.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => {
    return window.localStorage.getItem('token') && !document.querySelector('#login-username');
  }, null, { timeout: 20000 });
}

async function selectLocation(page, testId, locationName) {
  const select = page.locator(`[data-testid="${testId}"]`);
  await select.waitFor({ state: 'visible', timeout: 10000 });
  const value = await select.locator('option').evaluateAll((items, targetName) => {
    const match = items.find(item => String(item.textContent || '').includes(String(targetName)));
    return match?.value || '';
  }, locationName);
  if (!value) throw new Error(`location option not found: ${locationName}`);
  await select.selectOption(value);
  return value;
}

async function expectTransferMessage(page, expectedText) {
  const message = page.locator('[data-testid="warehouse-transfer-message"]');
  await message.waitFor({ state: 'visible', timeout: 10000 });
  const text = await message.innerText();
  if (!text.includes(expectedText)) {
    throw new Error(`warehouse transfer message mismatch: expected ${expectedText}, got ${text}`);
  }
  return text;
}

function answerNextDialog(page, accept) {
  page.once('dialog', async dialog => {
    if (!dialog.message().includes('未保存')) {
      throw new Error(`unexpected dialog message: ${dialog.message()}`);
    }
    if (accept) await dialog.accept();
    else await dialog.dismiss();
  });
}

async function run() {
  let browser = null;
  try {
    const warehouseUser = await ensureWarehouseAuditUser();

    const { raw, wip } = await getDefaultLocations(warehouseUser.token);
    report.locations = { raw: raw.id, wip: wip.id };
    recordStep({ step: 'api-load-default-locations', result: 'passed', raw: raw.code, wip: wip.code });

    const seed = await expectOk('seed raw stock for browser transfer', apiFetch('/warehouses/stock-balances', {
      method: 'POST',
      data: {
        locationId: Number(raw.id),
        productName: DATA.productName,
        batchNo: DATA.batchNo,
        quantity: DATA.initialQuantity,
        unit: 'kg',
        sourceRef: `WH-XFER-UI-SEED-${RUN_ID}`,
        reason: '仓储调拨浏览器审计前置库存补录，验证调拨出入库闭环',
        note: `warehouse transfer browser audit ${RUN_ID}`,
      },
    }, warehouseUser.token));
    const sourceBalance = unwrapData(seed);
    if (!sourceBalance?.id) throw new Error('seed stock returned no source balance id');
    recordStep({ step: 'api-seed-source-stock', result: 'passed', stockBalanceId: sourceBalance.id });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
    const stockResponses = [];
    page.on('response', async response => {
      const url = response.url();
      if (!url.includes('/api/warehouses/stock-balances')) return;
      stockResponses.push({ url, status: response.status() });
    });

    await loginBrowser(page);
    recordStep({ step: 'browser-login-warehouse', result: 'passed' });

    await page.evaluate(() => { window.location.hash = '#warehouse'; });
    await page.locator('[data-testid="warehouse-tab-inventory"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-testid="warehouse-tab-inventory"]').click();
    await page.locator('[data-testid="warehouse-inventory-search"]').fill(DATA.productName);
    await page.locator('[data-testid="warehouse-inventory-query-button"]').click();
    await page.locator(`[data-testid="warehouse-transfer-open-button-${sourceBalance.id}"]`).waitFor({ state: 'visible', timeout: 15000 });
    recordStep({ step: 'browser-search-source-stock', result: 'passed' });

    await page.locator(`[data-testid="warehouse-transfer-open-button-${sourceBalance.id}"]`).click();
    await page.locator('[data-testid="warehouse-transfer-modal"]').waitFor({ state: 'visible', timeout: 10000 });
    await selectLocation(page, 'warehouse-transfer-destination-select', wip.name);

    await page.locator('[data-testid="warehouse-transfer-note-input"]').fill(`未保存关闭验证 ${RUN_ID}`);
    answerNextDialog(page, false);
    await page.locator('[data-testid="warehouse-transfer-close"]').click();
    await page.locator('[data-testid="warehouse-transfer-modal"]').waitFor({ state: 'visible', timeout: 10000 });
    recordStep({ step: 'browser-keep-unsaved-transfer-after-dismiss', result: 'passed' });

    answerNextDialog(page, true);
    await page.locator('[data-testid="warehouse-transfer-close"]').click();
    await page.locator('[data-testid="warehouse-transfer-modal"]').waitFor({ state: 'detached', timeout: 10000 });
    recordStep({ step: 'browser-confirm-discard-transfer', result: 'passed' });

    await page.locator(`[data-testid="warehouse-transfer-open-button-${sourceBalance.id}"]`).click();
    await page.locator('[data-testid="warehouse-transfer-modal"]').waitFor({ state: 'visible', timeout: 10000 });
    await selectLocation(page, 'warehouse-transfer-destination-select', wip.name);

    await page.locator('[data-testid="warehouse-transfer-quantity-input"]').fill(String(DATA.initialQuantity + 1));
    await page.locator('[data-testid="warehouse-transfer-submit-button"]').click();
    const overTransferMessage = await expectTransferMessage(page, '调拨数量不能超过当前库存');
    await page.locator('[data-testid="warehouse-transfer-modal"]').waitFor({ state: 'visible', timeout: 10000 });
    recordStep({ step: 'browser-block-over-transfer-before-submit', result: 'passed', message: overTransferMessage });

    await page.locator('[data-testid="warehouse-transfer-quantity-input"]').fill('0');
    await page.locator('[data-testid="warehouse-transfer-submit-button"]').click();
    const zeroTransferMessage = await expectTransferMessage(page, '调拨数量必须大于 0');
    await page.locator('[data-testid="warehouse-transfer-modal"]').waitFor({ state: 'visible', timeout: 10000 });
    recordStep({ step: 'browser-block-zero-transfer-before-submit', result: 'passed', message: zeroTransferMessage });

    await page.locator('[data-testid="warehouse-transfer-quantity-input"]').fill(String(DATA.transferQuantity));
    await page.locator('[data-testid="warehouse-transfer-note-input"]').fill(`UI 调拨验收 ${RUN_ID}`);
    await page.locator('[data-testid="warehouse-transfer-submit-button"]').click();
    await page.locator('[data-testid="warehouse-transfer-modal"]').waitFor({ state: 'detached', timeout: 20000 });
    recordStep({ step: 'browser-submit-transfer', result: 'passed' });

    await selectLocation(page, 'warehouse-inventory-location-select', wip.name);
    await page.locator('[data-testid="warehouse-inventory-query-button"]').click();
    await page.waitForFunction((productName) => {
      return (document.body.innerText || '').includes(productName);
    }, DATA.productName, { timeout: 15000 });
    const uiBody = await page.locator('body').innerText();
    if (!uiBody.includes(DATA.productName)) {
      throw new Error('transferred product missing from WIP UI readback');
    }
    if (!uiBody.includes(String(DATA.transferQuantity))) {
      throw new Error(`transferred quantity missing from WIP UI readback: ${DATA.transferQuantity}`);
    }
    const screenshotPath = path.join(OUTPUT_DIR, `warehouse-transfer-browser-${RUN_ID}.png`);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    recordStep({ step: 'browser-wip-readback', result: 'passed', evidence: screenshotPath });

    await page.locator('[data-testid="warehouse-tab-ledger"]').click({ force: true });
    const ledgerPanel = page.locator('[data-testid="warehouse-ledger-panel"]').last();
    await ledgerPanel.waitFor({ state: 'visible', timeout: 10000 });
    await ledgerPanel.locator('[data-testid="warehouse-ledger-source-type-select"]').selectOption('warehouse_transfer');
    await ledgerPanel.locator('[data-testid="warehouse-ledger-product-search"]').fill(DATA.productName);
    await ledgerPanel.locator('[data-testid="warehouse-ledger-batch-search"]').fill(DATA.batchNo);
    await ledgerPanel.locator('[data-testid="warehouse-ledger-query-button"]').click();
    await page.waitForFunction((payload) => {
      const text = document.body.innerText || '';
      return text.includes(payload.productName)
        && text.includes(payload.batchNo)
        && text.includes(String(payload.transferQuantity));
    }, DATA, { timeout: 15000 });
    const ledgerBody = await page.locator('body').innerText();
    if (!ledgerBody.includes(DATA.productName) || !ledgerBody.includes(DATA.batchNo)) {
      throw new Error('transfer ledger row missing from browser readback');
    }
    const ledgerScreenshotPath = path.join(OUTPUT_DIR, `warehouse-transfer-ledger-browser-${RUN_ID}.png`);
    await page.screenshot({ path: ledgerScreenshotPath, fullPage: true });
    recordStep({ step: 'browser-ledger-readback', result: 'passed', evidence: ledgerScreenshotPath });

    const balances = await getBalances(warehouseUser.token);
    const rawBalance = findBalance(balances, raw.id);
    const wipBalance = findBalance(balances, wip.id);
    const expectedRaw = DATA.initialQuantity - DATA.transferQuantity;
    if (!rawBalance || Math.abs(Number(rawBalance.quantity || 0) - expectedRaw) > 0.000001) {
      throw new Error(`raw API readback mismatch: ${JSON.stringify({ rawBalance, expectedRaw, balances })}`);
    }
    if (!wipBalance || Math.abs(Number(wipBalance.quantity || 0) - DATA.transferQuantity) > 0.000001) {
      throw new Error(`wip API readback mismatch: ${JSON.stringify({ wipBalance, expected: DATA.transferQuantity, balances })}`);
    }
    recordStep({ step: 'api-readback-after-browser-transfer', result: 'passed', rawQuantity: rawBalance.quantity, wipQuantity: wipBalance.quantity });

    report.stockResponses = stockResponses;
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    };
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  console.log(JSON.stringify({
    status: report.status,
    steps: report.steps.length,
    reportPath: REPORT_PATH,
    failure: report.failure || null,
  }, null, 2));
}

run();
