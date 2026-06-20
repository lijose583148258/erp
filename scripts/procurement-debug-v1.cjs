const { chromium } = require('playwright');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';

async function login(page) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  if (await page.locator('input[name="username"]').count()) {
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await Promise.all([page.waitForTimeout(1200), page.click('button[type="submit"]')]);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  try {
    await login(page);
    await page.evaluate(() => {
      window.location.hash = '#procurement';
    });
    await page.waitForTimeout(1800);

    const supplierNameInput = page.locator('input[placeholder="供应商名称"], input[placeholder="Supplier Name"]').first();
    await supplierNameInput.fill(`DEBUG-SUP-${Date.now()}`);
    await page.locator('input[placeholder="分类"], input[placeholder="Category"]').first().fill('Debug Category');
    await page.locator('input[placeholder="姓名"], input[placeholder="Contact Name"]').first().fill('Debug User');
    await page.locator('input[placeholder="电话"], input[placeholder="手机"], input[placeholder="手机号"], input[placeholder="Phone"]').first().fill('0912345678');
    await page.locator('textarea[placeholder*="别名"], textarea[placeholder*="Alias"]').first().fill('Debug Alias');

    const before = await supplierNameInput.evaluate((element) => {
      let current = element.parentElement;
      const chain = [];
      while (current) {
        const style = window.getComputedStyle(current);
        chain.push({
          tag: current.tagName,
          className: current.className,
          overflowY: style.overflowY,
          scrollHeight: current.scrollHeight,
          clientHeight: current.clientHeight,
          scrollTop: current.scrollTop,
        });
        current = current.parentElement;
      }
      return chain;
    });

    await supplierNameInput.evaluate((element) => {
      let current = element.parentElement;
      while (current) {
        const style = window.getComputedStyle(current);
        const scrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') && current.scrollHeight > current.clientHeight;
        if (scrollable) {
          current.scrollTop = current.scrollHeight;
          return true;
        }
        current = current.parentElement;
      }
      return false;
    });

    await page.waitForTimeout(800);

    const after = await supplierNameInput.evaluate((element) => {
      let current = element.parentElement;
      const chain = [];
      while (current) {
        const style = window.getComputedStyle(current);
        chain.push({
          tag: current.tagName,
          className: current.className,
          overflowY: style.overflowY,
          scrollHeight: current.scrollHeight,
          clientHeight: current.clientHeight,
          scrollTop: current.scrollTop,
        });
        current = current.parentElement;
      }
      return chain;
    });

    const buttons = await page.locator('button:visible').evaluateAll((elements) =>
      elements.map((element, index) => ({
        index,
        text: (element.textContent || '').trim(),
        title: element.getAttribute('title'),
        className: element.className,
      })),
    );

    console.log(JSON.stringify({ before, after, buttons }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
