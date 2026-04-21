const fs = require('fs');
const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');

const APP_URL = 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'collections-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'collections-audit-report-v1.json');

const TIMEOUTS = {
  login: 15000,
  route: 20000,
  readBack: 15000,
  modal: 10000,
  save: 18000,
};

const runId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const TEST_DATA = {
  promiseAmount: 54321,
  promiseNote: `COLL-PROMISE-${runId}`,
  disputeReason: `COLL-DISPUTE-REASON-${runId}`,
  disputeNote: `COLL-DISPUTE-NOTE-${runId}`,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  testData: TEST_DATA,
  steps: [],
  status: 'running',
};

const REQUIRED_COPY = [
  '\u8ba2\u5355\u4e3b\u5355 / \u56de\u6b3e\u6d41\u6c34',
  '\u5f53\u524d\u8ba2\u5355\u8be6\u60c5',
  '\u627f\u8bfa\u4ed8\u6b3e\u6267\u884c\u8868',
  '\u4e89\u8bae\u5904\u7406\u8868',
  '\u8ffd\u6b3e\u62e6\u622a\u8868',
];

const FORBIDDEN_MOJIBAKE = ['undefined', '\ufffd', '\u951f\u91d1\u62f7'];

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
  await withTimebox(page, 'seed-login-state', TIMEOUTS.login, async () => {
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
      window.localStorage.setItem('ailao.activeTab', 'collections');
      window.localStorage.setItem('auth_token', savedToken);
      window.localStorage.setItem('erp_auth_token', savedToken);
      window.localStorage.setItem('currentUser', JSON.stringify(savedUser));
      window.localStorage.setItem('erp_current_user', JSON.stringify(savedUser));
      window.localStorage.setItem('erp_current_role', savedUser.role || 'super_admin');
      window.localStorage.setItem('ailao.language', 'zh');
      window.localStorage.setItem('language', 'zh-CN');
      window.localStorage.setItem('currency', 'CNY');
    }, { savedToken: token, savedUser: user });
  });
}

async function openCollections(page) {
  await withTimebox(page, 'open-collections', TIMEOUTS.route, async () => {
    await page.goto(`${APP_URL}#/collections`, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.route });
    await page.evaluate(() => {
      window.localStorage.setItem('ailao.activeTab', 'collections');
      window.location.hash = '#collections';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    for (let index = 0; index < 20; index += 1) {
      const bodyText = await page.locator('body').innerText();
      if (bodyText.includes('\u8ba2\u5355\u4e3b\u5355 / \u56de\u6b3e\u6d41\u6c34') || bodyText.includes('\u903e\u671f\u6e05\u5355') || bodyText.includes('\u6536\u6b3e\u53f0\u8d26')) {
        for (const required of REQUIRED_COPY) {
          if (!bodyText.includes(required)) {
            throw new Error(`required copy missing: ${required}`);
          }
        }
        for (const keyword of FORBIDDEN_MOJIBAKE) {
          if (bodyText.includes(keyword)) {
            throw new Error(`mojibake detected: ${keyword}`);
          }
        }
        return;
      }
      await page.waitForTimeout(500);
    }
    throw new Error('collections route not ready');
  });
  const shot = await safeScreenshot(page, 'collections-route');
  recordStep({ step: 'collections-route-evidence', result: 'passed', evidence: shot });
}

async function selectFirstOverdue(page) {
  return withTimebox(page, 'select-first-overdue', TIMEOUTS.readBack, async () => {
    const row = page.locator('tbody tr').first();
    await row.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    const rowText = await row.innerText();
    const orderNoMatch = rowText.match(/(ORD-[A-Z0-9-]+|SO-[A-Z0-9-]+)/i);
    await row.click();
    await page.waitForTimeout(800);
    const actionWorkspace = page.locator('text=\u8ba2\u5355\u4e3b\u5355 / \u56de\u6b3e\u6d41\u6c34').first();
    await actionWorkspace.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    const shot = await safeScreenshot(page, 'collections-selected-overdue');
    recordStep({ step: 'collections-selected-overdue-evidence', result: 'passed', evidence: shot, rowText });
    return { rowText, orderMarker: orderNoMatch ? orderNoMatch[1] : rowText };
  });
}

async function submitPromise(page, selected) {
  const promiseData = await withTimebox(page, 'submit-promise-action', TIMEOUTS.save, async () => {
    await page.locator('button').filter({ hasText: '\u627f\u8bfa\u4ed8\u6b3e' }).first().click();
    const modal = page.locator('div.fixed.inset-0').last();
    await modal.waitFor({ state: 'visible', timeout: TIMEOUTS.modal });

    await modal.locator('input[type="number"]').first().fill(String(TEST_DATA.promiseAmount));
    const dateInput = modal.locator('input[type="datetime-local"]').first();
    const futureDate = new Date(Date.now() + 48 * 3600 * 1000).toISOString().slice(0, 16);
    await dateInput.fill(futureDate);
    await modal.locator('input[placeholder*="\u5907\u6ce8"], input[placeholder*="Notes"]').first().fill(TEST_DATA.promiseNote);
    await modal.locator('button').filter({ hasText: /\u63d0\u4ea4\u627f\u8bfa|Submitting Promise|\u627f\u8bfa/ }).last().click();
    await page.waitForTimeout(1200);
    return { orderMarker: selected.orderMarker, futureDate };
  });

  const shot = await safeScreenshot(page, 'collections-promise-submitted');
  recordStep({ step: 'collections-promise-submitted-evidence', result: 'passed', evidence: shot, promiseNote: TEST_DATA.promiseNote });
  return promiseData;
}

async function submitDispute(page, selected) {
  const disputeData = await withTimebox(page, 'submit-dispute-action', TIMEOUTS.save, async () => {
    await page.locator('button').filter({ hasText: '\u53d1\u8d77\u4e89\u8bae' }).first().click();
    const modal = page.locator('div.fixed.inset-0').last();
    await modal.waitFor({ state: 'visible', timeout: TIMEOUTS.modal });

    await modal.locator('textarea').first().fill(TEST_DATA.disputeReason);
    await modal.locator('input[placeholder*="\u5907\u6ce8"], input[placeholder*="Notes"]').first().fill(TEST_DATA.disputeNote);
    await modal.locator('button').filter({ hasText: /\u63d0\u4ea4\u4e89\u8bae|Submitting Dispute|\u4e89\u8bae/ }).last().click();
    await page.waitForTimeout(1200);
    return { orderMarker: selected.orderMarker };
  });

  const shot = await safeScreenshot(page, 'collections-dispute-submitted');
  recordStep({ step: 'collections-dispute-submitted-evidence', result: 'passed', evidence: shot, disputeNote: TEST_DATA.disputeNote });
  return disputeData;
}

async function readCollectionsApi(page, endpoint) {
  return page.evaluate(async (target) => {
    const token = window.localStorage.getItem('token');
    const response = await fetch(target, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const json = await response.json();
    return json?.data || [];
  }, endpoint);
}

async function verifyPromiseReadback(page, promiseData) {
  await withTimebox(page, 'verify-promise-readback', TIMEOUTS.readBack, async () => {
    const promises = await readCollectionsApi(page, '/api/collections/promises');
    const hit = promises.find((item) => String(item.note || '').includes(TEST_DATA.promiseNote) && String(item.orderNo || '').includes(String(promiseData.orderMarker)));
    if (!hit) {
      throw new Error('promise readback not found in /api/collections/promises');
    }
  });
}

async function verifyDisputeReadback(page, disputeData) {
  await withTimebox(page, 'verify-dispute-readback', TIMEOUTS.readBack, async () => {
    const disputes = await readCollectionsApi(page, '/api/collections/disputes');
    const hit = disputes.find((item) => String(item.note || '').includes(TEST_DATA.disputeNote) && String(item.orderNo || '').includes(String(disputeData.orderMarker)));
    if (!hit) {
      throw new Error('dispute readback not found in /api/collections/disputes');
    }
  });
}

async function verifyLowerGridsVisible(page) {
  await withTimebox(page, 'verify-lower-grids-visible', TIMEOUTS.readBack, async () => {
    await page.locator('text=\u627f\u8bfa\u4ed8\u6b3e\u660e\u7ec6').first().scrollIntoViewIfNeeded();
    for (const required of [
      '\u627f\u8bfa\u4ed8\u6b3e\u660e\u7ec6',
      '\u4e89\u8bae\u5904\u7406\u660e\u7ec6',
      '\u8ffd\u6b3e\u62e6\u622a\u660e\u7ec6',
      '\u64cd\u4f5c',
    ]) {
      await page.locator(`text=${required}`).first().waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    }
    const bodyText = await page.locator('body').innerText();
    for (const keyword of FORBIDDEN_MOJIBAKE) {
      if (bodyText.includes(keyword)) {
        throw new Error(`mojibake detected in lower grids: ${keyword}`);
      }
    }
  });
  const shot = await safeScreenshot(page, 'collections-lower-grids');
  recordStep({ step: 'collections-lower-grids-evidence', result: 'passed', evidence: shot });
}

async function main() {
  ensureDir(OUTPUT_DIR);
  ensureDir(SHOT_DIR);
  let browser = null;

  try {
    const launched = await launchBrowserWithGuard({
      recordStep,
      retryLimit: 1,
      waitMs: 800,
    });
    browser = launched.browser;
    report.launcher = launched.launcher;
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await seedLoginState(page);
    await openCollections(page);
    const selected = await selectFirstOverdue(page);
    const promiseData = await submitPromise(page, selected);
    await verifyPromiseReadback(page, promiseData);
    const disputeData = await submitDispute(page, selected);
    await verifyDisputeReadback(page, disputeData);
    await verifyLowerGridsVisible(page);
    report.status = 'passed';
  } catch (error) {
    markReportFromLaunchError(report, error);
    if (report.status !== 'blocked_env') {
      process.exitCode = 1;
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    if (browser) await browser.close().catch(() => {});
  }
}

main();
