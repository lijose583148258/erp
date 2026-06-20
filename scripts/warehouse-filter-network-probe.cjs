const { chromium } = require('playwright');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
function readArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

const PRODUCT = readArg('product') || process.env.PROBE_PRODUCT || '';
const LOCATION = readArg('location') || process.env.PROBE_LOCATION || '';

async function run() {
  if (!PRODUCT) {
    throw new Error('Set PROBE_PRODUCT to the product text to search.');
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const stockCalls = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/api/warehouses/stock-balances')) return;
    let payload = '';
    try {
      payload = await response.text();
    } catch {
      payload = '<unreadable>';
    }
    stockCalls.push({
      url,
      status: response.status(),
      payload: payload.slice(0, 1000),
    });
  });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.locator('#login-username').fill('warehouse');
  await page.locator('#login-password').fill('warehouse123');
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => {
    return window.localStorage.getItem('token') && !document.querySelector('#login-username');
  }, { timeout: 20000 });

  await page.evaluate(() => {
    window.location.hash = '#warehouse';
  });
  await page.waitForTimeout(1200);
  await page.locator('[data-testid="warehouse-tab-inventory"]').click();
  await page.locator('[data-testid="warehouse-inventory-search"]').fill(PRODUCT);
  await page.locator('[data-testid="warehouse-inventory-query-button"]').click();
  await page.waitForTimeout(1200);

  let selectedLocationValue = '';
  if (LOCATION) {
    selectedLocationValue = await page.locator('[data-testid="warehouse-inventory-location-select"] option').evaluateAll((items, locationName) => {
      const match = items.find((item) => String(item.textContent || '').includes(String(locationName)));
      return match?.value || '';
    }, LOCATION);
    if (selectedLocationValue) {
      await page.locator('[data-testid="warehouse-inventory-location-select"]').selectOption(selectedLocationValue);
      await page.locator('[data-testid="warehouse-inventory-query-button"]').click();
      await page.waitForTimeout(1200);
    }
  }

  const body = await page.locator('body').innerText();
  await page.screenshot({ path: 'output/playwright/warehouse-filter-network-probe.png', fullPage: true });
  await browser.close();

  console.log(JSON.stringify({
    product: PRODUCT,
    location: LOCATION,
    selectedLocationValue,
    stockCalls,
    hasProduct: body.includes(PRODUCT),
    bodySnippet: body.slice(Math.max(0, body.indexOf('库存台账')), Math.max(0, body.indexOf('库存台账')) + 800),
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
