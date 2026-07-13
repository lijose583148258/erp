const { chromium } = require('playwright');
const assert = require('assert');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';

async function ensureLoggedIn(page) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  const hasLoginForm = await page.$('input[name="username"]');
  if (!hasLoginForm) return;

  await page.fill('input[name="username"]', 'admin');
  await page.fill('input[name="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
}

async function checkRoute(page, hash, expectedSnippets) {
  await page.evaluate((nextHash) => {
    window.location.hash = nextHash;
  }, hash);
  const text = await waitForExpectedText(page, hash, expectedSnippets, 9000);

  assert(!/(?:\uFFFD){3}/u.test(text), `Route ${hash} still has mojibake.`);
  assert(!text.includes('\uFFFD'), `Route ${hash} still has replacement chars.`);
  assert(!text.toLowerCase().includes('undefined undefined'), `Route ${hash} shows undefined labels.`);

  const hit = expectedSnippets.some((snippet) => text.includes(snippet));
  assert(hit, `Route ${hash} missing expected content: ${expectedSnippets.join(' | ')}`);
  console.log(`[PASS] ${hash}`);
}

async function waitForExpectedText(page, hash, expectedSnippets, timeoutMs) {
  const started = Date.now();
  let text = '';
  while (Date.now() - started < timeoutMs) {
    text = await page.evaluate(() => document.body.innerText || '');
    if (expectedSnippets.some((snippet) => text.includes(snippet))) return text;
    await page.waitForTimeout(250);
  }
  return text;
}

(async () => {
  let browser;
  try {
    console.log(`[START] Browser smoke test: ${APP_URL}`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await ensureLoggedIn(page);

    const shellText = await page.evaluate(() => document.body.innerText || '');
    assert(shellText.includes('ERP+CRM'), 'Shell did not load after login.');

    await checkRoute(page, '#collections', ['回款工作台', '收款台账', '承诺付款']);
    await checkRoute(page, '#financeAnalytics', ['财务经营', '营收与风险趋势', '财务台账']);
    await checkRoute(page, '#barter', ['货抵支付 / 换货贸易', '新建货抵结算单', '最新货抵单']);

    console.log('[DONE] Smoke test passed.');
  } catch (error) {
    console.error('[FAIL] Smoke test failed:', error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
