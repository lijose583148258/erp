const { chromium } = require('playwright');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 980 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);

  await page.addInitScript(() => {
    window.localStorage.setItem('ailao.language', 'zh');
    window.localStorage.setItem('language', 'zh');
    window.localStorage.setItem('currency', 'CNY');
  });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.locator('#login-username').fill('admin');
  await page.locator('#login-password').fill('admin123');
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.location.hash = '#crm';
  });
  await page.waitForTimeout(2500);

  const result = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    rows: Array.from(document.querySelectorAll('[data-testid^="crm-customer-row-"]')).map((element) => ({
      testId: element.getAttribute('data-testid'),
      text: (element.textContent || '').slice(0, 180),
    })),
    drawerCount: document.querySelectorAll('[data-testid="crm-customer-drawer"]').length,
    addButtonCount: document.querySelectorAll('[data-testid="crm-add-customer"]').length,
    searchCount: document.querySelectorAll('[data-testid="crm-search"]').length,
    bodySnippet: (document.body.innerText || '').slice(0, 800),
  }));

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
