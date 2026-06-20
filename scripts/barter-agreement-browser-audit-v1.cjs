const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard } = require('./lib/browser-launch-guard.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'barter-agreement-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'barter-agreement-audit-report-v1.json');

const runId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const TEST = {
  customerName: `AGREEMENT-CUST-${runId}`,
  counterpartyName: `AGREEMENT-CP-${runId}`,
  agreementCounterpartyItem: `WOOD-TOTAL-${runId}`,
  agreementOurItem: `GLUE-TOTAL-${runId}`,
  batch1CounterpartyItem: `WOOD-B1-${runId}`,
  batch1OurItem: `GLUE-B1-${runId}`,
  batch2CounterpartyItem: `WOOD-B2-${runId}`,
  batch2OurItem: `GLUE-B2-${runId}`,
};

const report = { appUrl: APP_URL, startedAt: new Date().toISOString(), test: TEST, steps: [], status: 'running' };
let browser = null;

const ensureDir = (target) => fs.mkdirSync(target, { recursive: true });
const recordStep = (entry) => report.steps.push({ at: new Date().toISOString(), ...entry });

async function screenshot(page, name) {
  const filePath = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function withTimebox(page, step, timeout, task) {
  const started = Date.now();
  try {
    const result = await Promise.race([
      task(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${step} exceeded ${timeout}ms`)), timeout)),
    ]);
    recordStep({ step, result: 'passed', durationMs: Date.now() - started });
    return result;
  } catch (error) {
    recordStep({ step, result: 'failed', durationMs: Date.now() - started, error: String(error.message || error), screenshot: await screenshot(page, `fail-${step}`) });
    throw error;
  }
}

async function seedLogin(page) {
  const response = await page.request.post(`${APP_URL}api/auth/login`, { data: { username: 'admin', password: 'admin123', role: 'super_admin' } });
  const json = await response.json();
  const token = json?.data?.token;
  const user = json?.data?.user;
  if (!token || !user) throw new Error('login failed');

  await page.addInitScript(({ savedToken, savedUser }) => {
    window.localStorage.setItem('token', savedToken);
    window.localStorage.setItem('user', JSON.stringify(savedUser));
    window.localStorage.setItem('auth_token', savedToken);
    window.localStorage.setItem('ailao.activeTab', 'barter');
    window.localStorage.setItem('ailao.language', 'zh');
  }, { savedToken: token, savedUser: user });

  return { token, user };
}

async function seedCustomer(page, token) {
  const response = await page.request.post(`${APP_URL}api/customers`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: TEST.customerName,
      nameZh: TEST.customerName,
      nameEn: `Barter Agreement Customer ${runId}`,
      nameVi: `Khach hang bu tru ${runId}`,
      contactName: `Barter Contact ${runId.slice(-4)}`,
      contactPhone: `09${runId.slice(-8)}`,
      contactEmail: `barter-agreement-${runId}@example.com`,
      creditLimit: 1000000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'public',
    },
  });
  const json = await response.json();
  if (!response.ok()) {
    throw new Error(`seed customer failed: ${response.status()} ${JSON.stringify(json).slice(0, 300)}`);
  }
  report.customerId = json?.data?.id;
  return String(json?.data?.id || '');
}

async function apiFetch(page, endpoint) {
  return page.evaluate(async ({ target }) => {
    const token = window.localStorage.getItem('token');
    const response = await fetch(target, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return response.json();
  }, { target: `/api${endpoint}` });
}

async function requestJson(page, token, method, endpoint, data) {
  const response = await page.request.fetch(`${APP_URL}api${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok()) {
    throw new Error(`${method} ${endpoint} failed: ${response.status()} ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

async function resolveLocationId(page, token, code) {
  const json = await requestJson(page, token, 'GET', '/warehouses');
  const warehouses = Array.isArray(json?.data) ? json.data : [];
  for (const warehouse of warehouses) {
    const location = (warehouse.locations || []).find((item) => item.code === code);
    if (location?.id) {
      return location.id;
    }
  }
  throw new Error(`warehouse location ${code} not found`);
}

async function seedOurStockForSettlement(page, token, settlement, itemName) {
  const ourItem = (settlement.items || []).find((item) => item.side === 'our' && item.itemName === itemName);
  if (!ourItem) {
    throw new Error(`our barter item ${itemName} not found for stock seed`);
  }
  const locationId = await resolveLocationId(page, token, 'LOC-FG');
  const batchNo = ourItem.sourceDocument || `BARTER-${settlement.id}-OUR-${ourItem.id}`;
  const quantity = Math.max(Number(ourItem.quantity || 0) + 10, Number(ourItem.quantity || 0) * 2);
  await requestJson(page, token, 'POST', '/warehouses/stock-balances', {
    locationId,
    productName: ourItem.itemName,
    batchNo,
    quantity,
    unit: ourItem.unit || 'kg',
    sourceRef: `BARTER-AUDIT-STOCK-${settlement.id}-${ourItem.id}`,
    reason: '货抵浏览器审计前置库存补录，验证我方货物过账扣减闭环',
    note: `Seed barter browser audit stock for ${settlement.settlementNo}`,
  });
  return { locationId, productName: ourItem.itemName, batchNo, quantity };
}

async function fillItemCard(page, title, itemName, quantity, unit, unitPrice) {
  const card = page.getByText(title, { exact: true }).locator('xpath=..');
  const inputs = card.locator('input');
  await inputs.nth(0).fill(itemName);
  await inputs.nth(1).fill(`AUTO-${itemName}`);
  await inputs.nth(2).fill(String(quantity));
  await inputs.nth(3).fill(unit);
  await inputs.nth(4).fill(String(unitPrice));
}

async function waitForBatchPanelSelection(page, counterpartyName) {
  await page.getByText('登记执行批次', { exact: true }).waitFor({ state: 'visible', timeout: 12000 });
  await page.waitForFunction((targetName) => {
    const visibleSections = Array.from(document.querySelectorAll('section')).filter((node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
    return visibleSections.some((node) => node.textContent?.includes('登记执行批次') && node.textContent.includes(targetName));
  }, counterpartyName);
}

async function openDeskTab(page, label, expectedVisibleText) {
  const tabButton = page.locator('button').filter({ hasText: label }).first();
  await tabButton.waitFor({ state: 'visible', timeout: 12000 });
  await tabButton.click();
  await page.getByText(expectedVisibleText, { exact: true }).first().waitFor({ state: 'visible', timeout: 12000 });
}

async function clickVisibleAction(page, label) {
  const button = page.getByRole('button', { name: label, exact: true }).first();
  await button.waitFor({ state: 'visible', timeout: 12000 });
  await button.click();
}

async function main() {
  ensureDir(SHOT_DIR);
  const launched = await launchBrowserWithGuard({ recordStep, retryLimit: 1, waitMs: 800 });
  browser = launched.browser;
  report.launcher = launched.launcher;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  try {
    const auth = await seedLogin(page);
    const seededCustomerId = await seedCustomer(page, auth.token);

    await withTimebox(page, 'open-barter', 20000, async () => {
      await page.goto(`${APP_URL}#barter`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const text = document.body.innerText || '';
        return [
          '货抵支付 / 换货贸易',
          '货抵协议 / 分批执行',
          '新建货抵协议',
        ].some((label) => text.includes(label));
      });
      const bodyText = await page.locator('body').innerText();
      if (bodyText.includes('undefined') || bodyText.includes('\uFFFD')) throw new Error('visible undefined or mojibake found');
    });

    await withTimebox(page, 'create-agreement', 25000, async () => {
      const customerSelect = page.locator('select').nth(0);
      await page.waitForFunction((customerId) => {
        const select = document.querySelector('select');
        return Boolean(select && Array.from(select.options || []).some((option) => option.value === customerId));
      }, seededCustomerId);
      await customerSelect.selectOption(seededCustomerId);
      await page.locator('input[placeholder="对方名称"]').fill(TEST.counterpartyName);
      await fillItemCard(page, '协议对方总标的', TEST.agreementCounterpartyItem, 10, 'm3', 100);
      await fillItemCard(page, '协议我方总标的', TEST.agreementOurItem, 20, 'kg', 50);
      const responsePromise = page.waitForResponse((response) => response.url().includes('/api/barter/agreements') && response.request().method() === 'POST');
      await page.locator('button').filter({ hasText: '创建协议' }).click();
      const response = await responsePromise;
      if (!response.ok()) {
        throw new Error(`create agreement request failed: ${response.status()} ${await response.text()}`);
      }
    });

    const agreementList = await apiFetch(page, `/barter/agreements?search=${encodeURIComponent(TEST.counterpartyName)}`);
    const agreement = agreementList?.data?.items?.find((item) => item.counterpartyName === TEST.counterpartyName);
    if (!agreement) throw new Error('agreement not found in api');
    report.agreementId = agreement.id;

    await withTimebox(page, 'open-agreement', 15000, async () => {
      const agreementButton = page.locator('button').filter({ hasText: TEST.counterpartyName }).first();
      await agreementButton.waitFor({ state: 'visible', timeout: 12000 });
      await agreementButton.scrollIntoViewIfNeeded();
      await agreementButton.click();
      await openDeskTab(page, '执行批次', '登记执行批次');
      await waitForBatchPanelSelection(page, TEST.counterpartyName);
    });

    await withTimebox(page, 'create-batch-1', 25000, async () => {
      await fillItemCard(page, '本次对方交付', TEST.batch1CounterpartyItem, 4, 'm3', 100);
      await fillItemCard(page, '本次我方抵扣', TEST.batch1OurItem, 8, 'kg', 50);
      const responsePromise = page.waitForResponse((response) => response.url().includes(`/api/barter/agreements/${agreement.id}/batches`) && response.request().method() === 'POST');
      await page.locator('button').filter({ hasText: '创建批次' }).click();
      const response = await responsePromise;
      if (!response.ok()) {
        throw new Error(`create batch1 request failed: ${response.status()} ${await response.text()}`);
      }
    });

    let detail = await apiFetch(page, `/barter/agreements/${agreement.id}`);
    let batch1 = detail?.data?.settlements?.find((item) => item.batchIndex === 1);
    if (!batch1) throw new Error('batch1 not created');
    report.batch1StockSeed = await seedOurStockForSettlement(page, auth.token, batch1, TEST.batch1OurItem);
    await openDeskTab(page, '审批过账', '批次流水');

    await withTimebox(page, 'approve-post-batch-1', 25000, async () => {
      const approveResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/barter/settlements/${batch1.id}/approve`) && response.request().method() === 'PATCH');
      await clickVisibleAction(page, '审核');
      const approveResponse = await approveResponsePromise;
      if (!approveResponse.ok()) {
        throw new Error(`approve batch1 failed: ${approveResponse.status()} ${await approveResponse.text()}`);
      }

      await page.getByRole('button', { name: '过账', exact: true }).waitFor({ state: 'visible', timeout: 12000 });

      const postResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/barter/settlements/${batch1.id}/post`) && response.request().method() === 'POST');
      await clickVisibleAction(page, '过账');
      const postResponse = await postResponsePromise;
      if (!postResponse.ok()) {
        throw new Error(`post batch1 failed: ${postResponse.status()} ${await postResponse.text()}`);
      }
    });

    detail = await apiFetch(page, `/barter/agreements/${agreement.id}`);
    if (Number(detail?.data?.executedOffsetAmount || 0) !== 400 || Number(detail?.data?.remainingOffsetAmount || 0) !== 600) {
      throw new Error('agreement totals after batch1 are incorrect');
    }
    await openDeskTab(page, '执行批次', '登记执行批次');
    await waitForBatchPanelSelection(page, TEST.counterpartyName);

    await withTimebox(page, 'create-batch-2', 25000, async () => {
      await fillItemCard(page, '本次对方交付', TEST.batch2CounterpartyItem, 6, 'm3', 100);
      await fillItemCard(page, '本次我方抵扣', TEST.batch2OurItem, 12, 'kg', 50);
      const responsePromise = page.waitForResponse((response) => response.url().includes(`/api/barter/agreements/${agreement.id}/batches`) && response.request().method() === 'POST');
      await page.locator('button').filter({ hasText: '创建批次' }).click();
      const response = await responsePromise;
      if (!response.ok()) {
        throw new Error(`create batch2 request failed: ${response.status()} ${await response.text()}`);
      }
    });

    detail = await apiFetch(page, `/barter/agreements/${agreement.id}`);
    const batch2 = detail?.data?.settlements?.find((item) => item.batchIndex === 2);
    if (!batch2) throw new Error('batch2 not created');
    report.batch2StockSeed = await seedOurStockForSettlement(page, auth.token, batch2, TEST.batch2OurItem);
    await openDeskTab(page, '审批过账', '批次流水');

    await withTimebox(page, 'approve-post-batch-2', 25000, async () => {
      const approveResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/barter/settlements/${batch2.id}/approve`) && response.request().method() === 'PATCH');
      await clickVisibleAction(page, '审核');
      const approveResponse = await approveResponsePromise;
      if (!approveResponse.ok()) {
        throw new Error(`approve batch2 failed: ${approveResponse.status()} ${await approveResponse.text()}`);
      }

      await page.getByRole('button', { name: '过账', exact: true }).waitFor({ state: 'visible', timeout: 12000 });

      const postResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/barter/settlements/${batch2.id}/post`) && response.request().method() === 'POST');
      await clickVisibleAction(page, '过账');
      const postResponse = await postResponsePromise;
      if (!postResponse.ok()) {
        throw new Error(`post batch2 failed: ${postResponse.status()} ${await postResponse.text()}`);
      }
    });

    detail = await apiFetch(page, `/barter/agreements/${agreement.id}`);
    if (Number(detail?.data?.executedOffsetAmount || 0) !== 1000 || Number(detail?.data?.remainingOffsetAmount || 0) !== 0 || detail?.data?.status !== 'completed') {
      throw new Error('agreement totals after batch2 are incorrect');
    }

    recordStep({ step: 'final-screenshot', result: 'passed', screenshot: await screenshot(page, 'barter-agreement-finished') });
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
    throw error;
  } finally {
    if (report && report.status === 'blocked_env' && process && process.exitCode === 1) process.exitCode = 0;
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
