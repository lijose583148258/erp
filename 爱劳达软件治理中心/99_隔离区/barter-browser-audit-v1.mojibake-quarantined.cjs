const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const APP_URL = 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'barter-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'barter-audit-report-v1.json');

const TIMEOUTS = {
  login: 15000,
  route: 20000,
  fill: 20000,
  save: 25000,
  readBack: 15000,
  stateChange: 15000,
};

const runId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const TEST_DATA = {
  counterpartyName: `货抵测试对手方-${runId}`,
  note: `BARTER-AUDIT-${runId}`,
  counterpartyItemName: `板材-${runId}`,
  counterpartySpec: '600 方 x 380 元',
  counterpartyQuantity: 600,
  counterpartyUnit: '方',
  counterpartyUnitPrice: 380,
  ourItemName: `胶水-${runId}`,
  ourSpec: '1085.71 公斤 x 210 元',
  ourQuantity: 1085.71,
  ourUnit: '公斤',
  ourUnitPrice: 210,
};

const EXPECTED = {
  counterpartyValue: 228000,
  ourValue: 227999.1,
  cashDifference: -0.9,
  offsetAmount: 227999.1,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  testData: TEST_DATA,
  expected: EXPECTED,
  steps: [],
  status: 'running',
};

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function recordStep(entry) {
  report.steps.push({
    at: new Date().toISOString(),
    ...entry,
  });
}

async function safeScreenshot(page, name) {
  const filePath = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function withTimebox(page, step, timeout, task) {
  const started = Date.now();
  try {
    const result = await Promise.race([
      task(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${step} exceeded ${timeout}ms`)), timeout);
      }),
    ]);
    recordStep({ step, timeout, result: 'passed', durationMs: Date.now() - started });
    return result;
  } catch (error) {
    const screenshot = await safeScreenshot(page, `fail-${step}`);
    recordStep({
      step,
      timeout,
      result: 'failed',
      durationMs: Date.now() - started,
      error: String(error.message || error),
      screenshot,
    });
    throw error;
  }
}

async function seedLoginState(page) {
  return withTimebox(page, 'seed-login-state', TIMEOUTS.login, async () => {
    const loginResponse = await page.request.post(`${APP_URL}api/auth/login`, {
      data: { username: 'admin', password: 'admin123', role: 'super_admin' },
    });
    if (!loginResponse.ok()) {
      throw new Error(`login api failed: ${loginResponse.status()}`);
    }

    const loginJson = await loginResponse.json();
    const token = loginJson?.data?.token;
    const user = loginJson?.data?.user;
    if (!token || !user) {
      throw new Error('login api returned empty token or user');
    }

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
      window.localStorage.setItem('ailao.activeTab', 'barter');
      window.localStorage.setItem('ailao.language', 'zh');
      window.localStorage.setItem('language', 'zh-CN');
      window.localStorage.setItem('currency', 'CNY');
    }, { savedToken: token, savedUser: user });

    return { token, user };
  });
}

async function apiFetch(page, endpoint, options = {}) {
  return page.evaluate(async ({ target, init }) => {
    const token = window.localStorage.getItem('token');
    const response = await fetch(target, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: response.ok, status: response.status, json };
  }, { target: `/api${endpoint}`, init: options });
}

function unwrapList(payload) {
  const data = payload?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function openBarter(page) {
  await withTimebox(page, 'open-barter-route', TIMEOUTS.route, async () => {
    await page.goto(`${APP_URL}#/barter`, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.route });
    await page.evaluate(() => {
      window.localStorage.setItem('ailao.activeTab', 'barter');
      window.location.hash = '#/barter';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    for (let index = 0; index < 30; index += 1) {
      const bodyText = await page.locator('body').innerText();
      if (bodyText.includes('货抵支付') && bodyText.includes('新建货抵结算单')) {
        if (bodyText.includes('undefined') || bodyText.includes('���') || bodyText.includes('锟')) {
          throw new Error('barter page contains visible undefined or mojibake');
        }
        return;
      }
      await page.waitForTimeout(500);
    }
    throw new Error('barter route not ready');
  });
  const shot = await safeScreenshot(page, 'barter-route');
  recordStep({ step: 'barter-route-evidence', result: 'passed', evidence: shot });
}

async function selectFirstNonEmptyOption(selectLocator, label) {
  const value = await selectLocator.evaluate((select) => {
    const options = Array.from(select.options || []);
    const option = options.find((item) => item.value);
    return option?.value || '';
  });
  if (!value) {
    throw new Error(`${label} has no selectable option`);
  }
  await selectLocator.selectOption(value);
  return value;
}

async function fillBarterForm(page) {
  return withTimebox(page, 'fill-barter-form', TIMEOUTS.fill, async () => {
    const customerSelect = page.locator('label').filter({ hasText: '客户' }).locator('select').first();
    await customerSelect.waitFor({ state: 'visible', timeout: TIMEOUTS.fill });
    const customerId = await selectFirstNonEmptyOption(customerSelect, 'customer select');

    await page.locator('label').filter({ hasText: '对方名称' }).locator('input').first().fill(TEST_DATA.counterpartyName);
    await page.locator('label').filter({ hasText: '结算模式' }).locator('select').first().selectOption('mixed');
    await page.locator('label').filter({ hasText: '币种' }).locator('select').first().selectOption('CNY');
    await page.locator('label').filter({ hasText: '备注' }).locator('input').first().fill(TEST_DATA.note);

    await page.locator('input[placeholder="品名"]').nth(0).fill(TEST_DATA.counterpartyItemName);
    await page.locator('input[placeholder="规格"]').nth(0).fill(TEST_DATA.counterpartySpec);
    await page.locator('input[placeholder="数量"]').nth(0).fill(String(TEST_DATA.counterpartyQuantity));
    await page.locator('input[placeholder="单位"]').nth(0).fill(TEST_DATA.counterpartyUnit);
    await page.locator('input[placeholder="单价"]').nth(0).fill(String(TEST_DATA.counterpartyUnitPrice));

    await page.locator('input[placeholder="品名"]').nth(1).fill(TEST_DATA.ourItemName);
    await page.locator('input[placeholder="规格"]').nth(1).fill(TEST_DATA.ourSpec);
    await page.locator('input[placeholder="数量"]').nth(1).fill(String(TEST_DATA.ourQuantity));
    await page.locator('input[placeholder="单位"]').nth(1).fill(TEST_DATA.ourUnit);
    await page.locator('input[placeholder="单价"]').nth(1).fill(String(TEST_DATA.ourUnitPrice));

    const bodyText = await page.locator('body').innerText();
    if (!bodyText.includes('差额（我方 - 对方）')) {
      throw new Error('barter preview does not show canonical cash difference label');
    }
    return { customerId };
  });
}

async function submitBarterForm(page) {
  await withTimebox(page, 'submit-barter-form', TIMEOUTS.save, async () => {
    await page.locator('button').filter({ hasText: '创建货抵结算单' }).first().click();
    for (let index = 0; index < 30; index += 1) {
      const bodyText = await page.locator('body').innerText();
      if (bodyText.includes(TEST_DATA.counterpartyName) && bodyText.includes('待审核')) {
        return;
      }
      await page.waitForTimeout(500);
    }
    throw new Error('created barter settlement was not visible in latest list');
  });
  const shot = await safeScreenshot(page, 'barter-created');
  recordStep({ step: 'barter-created-evidence', result: 'passed', evidence: shot });
}

function assertNear(actual, expected, tolerance, label) {
  if (Math.abs(Number(actual) - Number(expected)) > tolerance) {
    throw new Error(`${label} expected ${expected}, got ${actual}`);
  }
}

async function verifyCreatedReadback(page) {
  return withTimebox(page, 'verify-created-readback', TIMEOUTS.readBack, async () => {
    const response = await apiFetch(page, `/barter/settlements?pageSize=20&search=${encodeURIComponent(TEST_DATA.counterpartyName)}`);
    if (!response.ok) {
      throw new Error(`barter list readback failed: ${response.status}`);
    }
    const items = unwrapList(response);
    const settlement = items.find((item) => String(item.counterpartyName || '').includes(TEST_DATA.counterpartyName));
    if (!settlement) {
      throw new Error('created barter settlement not found by search');
    }
    if (settlement.status !== 'quoted') {
      throw new Error(`created barter status expected quoted, got ${settlement.status}`);
    }
    assertNear(settlement.totalPartyAValue, EXPECTED.ourValue, 0.01, 'totalPartyAValue/ourValue');
    assertNear(settlement.totalPartyBValue, EXPECTED.counterpartyValue, 0.01, 'totalPartyBValue/counterpartyValue');
    assertNear(settlement.cashDifference, EXPECTED.cashDifference, 0.01, 'cashDifference');
    return { settlementId: settlement.id, settlementNo: settlement.settlementNo };
  });
}

async function approveSettlement(page, settlementId) {
  return withTimebox(page, 'approve-barter-settlement', TIMEOUTS.stateChange, async () => {
    const response = await apiFetch(page, `/barter/settlements/${settlementId}/approve`, {
      method: 'PATCH',
      body: JSON.stringify({ note: `${TEST_DATA.note}-APPROVED` }),
    });
    if (!response.ok) {
      throw new Error(`approve barter failed: ${response.status} ${response.json?.message || ''}`);
    }
    if (response.json?.data?.status !== 'approved') {
      throw new Error(`approved barter status mismatch: ${response.json?.data?.status}`);
    }
    return response.json.data;
  });
}

async function postSettlement(page, settlementId) {
  return withTimebox(page, 'post-barter-settlement', TIMEOUTS.stateChange, async () => {
    const response = await apiFetch(page, `/barter/settlements/${settlementId}/post`, {
      method: 'POST',
      body: JSON.stringify({
        postingAmount: EXPECTED.offsetAmount,
        offsetType: 'barter_offset',
        note: `${TEST_DATA.note}-POSTED`,
      }),
    });
    if (!response.ok) {
      throw new Error(`post barter failed: ${response.status} ${response.json?.message || ''}`);
    }
    if (response.json?.data?.status !== 'posted') {
      throw new Error(`posted barter status mismatch: ${response.json?.data?.status}`);
    }
    return response.json.data;
  });
}

async function verifyPostedReadback(page, settlementId) {
  await withTimebox(page, 'verify-posted-readback', TIMEOUTS.readBack, async () => {
    const response = await apiFetch(page, `/barter/settlements/${settlementId}`);
    if (!response.ok) {
      throw new Error(`barter detail readback failed: ${response.status}`);
    }
    const settlement = response.json?.data;
    if (settlement?.status !== 'posted') {
      throw new Error(`detail status expected posted, got ${settlement?.status}`);
    }
    if (!Array.isArray(settlement.items) || settlement.items.length < 2) {
      throw new Error('detail items were lost after posting');
    }
    if (!Array.isArray(settlement.valuationSnapshots) || settlement.valuationSnapshots.length < 2) {
      throw new Error('valuation snapshots were lost after posting');
    }
    if (!Array.isArray(settlement.offsetPostings) || settlement.offsetPostings.length < 1) {
      throw new Error('offset posting was not created');
    }
    assertNear(settlement.offsetPostings[0].offsetAmount, EXPECTED.offsetAmount, 0.01, 'offset posting amount');
    assertNear(settlement.totalPartyAValue, EXPECTED.ourValue, 0.01, 'detail totalPartyAValue/ourValue');
    assertNear(settlement.totalPartyBValue, EXPECTED.counterpartyValue, 0.01, 'detail totalPartyBValue/counterpartyValue');
    assertNear(settlement.cashDifference, EXPECTED.cashDifference, 0.01, 'detail cashDifference');
  });
}

async function main() {
  ensureDir(OUTPUT_DIR);
  ensureDir(SHOT_DIR);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

  try {
    await seedLoginState(page);
    await openBarter(page);
    await fillBarterForm(page);
    await submitBarterForm(page);
    const created = await verifyCreatedReadback(page);
    report.created = created;
    await approveSettlement(page, created.settlementId);
    await postSettlement(page, created.settlementId);
    await verifyPostedReadback(page, created.settlementId);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    await browser.close();
  }
}

main();
