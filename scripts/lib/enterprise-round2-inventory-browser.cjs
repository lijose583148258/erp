const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const number = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
const ids = rows => rows.map(row => Number(row.id)).sort((a, b) => a - b);

// Compare browser observations against the existing race's database evidence,
// not another fixture or a second stock-writing implementation.
function verifyInventoryBrowser(proof, source) {
  assert.equal(proof.version, 'inventory-race-browser/v1');
  const { state, responses, persisted } = source;
  if (persisted) assert(['pending', 'in_transit'].includes(persisted.status));
  assert.deepEqual(proof.runtimeErrors, []);
  assert.equal(proof.readbacks.length, 2);
  assert.deepEqual(proof.readbacks.map(row => row.instance), [0, 1]);
  assert.equal(new Set(proof.readbacks.map(row => row.actorId)).size, 2);
  assert(responses.some(row => row.actorId === proof.readbacks[0].actorId && [200, 201].includes(row.status)));
  assert(responses.some(row => row.actorId === proof.readbacks[1].actorId && row.status === 409));
  assert(state.balances.length > 0 && state.entries.length > 0 && state.costs.length > 0);
  const quantity = state.balances.reduce((sum, row) => sum + Number(row.quantity), 0);
  assert(state.balances.every(row => Number(row.quantity) >= 0));
  assert.equal(Number(state.batch.stockQuantity), quantity);
  assert.equal(state.costs.reduce((sum, row) => sum + Number(row.quantityDelta), 0), quantity);
  assert.equal(state.costs.reduce((sum, row) => sum + Math.round(Number(row.costAmountDelta) * 100), 0), quantity * 1000);
  for (const read of proof.readbacks) {
    assert.equal(read.customerCatalogRequests, 0, 'Warehouse browser must not request the unauthorized customer catalog');
    assert.deepEqual(read.httpStatuses, persisted ? [200, 200, 200] : [200, 200]);
    assert.deepEqual(ids(read.balances), ids(state.balances));
    assert.deepEqual(ids(read.ledger), ids(state.entries));
    assert.equal(read.screenshots.length, persisted ? 3 : 2);
    assert(read.screenshots.every(file => typeof file === 'string' && file.endsWith('.png')));
    for (const balance of state.balances) {
      const row = read.balances.find(item => item.id === balance.id);
      const api = state.apiBalances[read.instance].find(item => Number(item.id) === balance.id);
      assert.deepEqual(row.cells, [balance.productName, balance.batchNo, String(balance.quantity), balance.unit, api.warehouseName || '-', api.locationName || '-']);
      assert.equal(row.transferDisabled, Number(balance.quantity) <= 0);
    }
    for (const entry of state.entries) {
      const row = read.ledger.find(item => item.id === entry.id);
      const movements = state.movements.filter(item => item.entryId === entry.id);
      assert(movements.length > 0);
      const net = movements.reduce((sum, item) => sum + Number(item.quantityDelta), 0);
      for (const text of [entry.entryNo, entry.sourceRef, entry.status, `${movements.length} 行 / ${number(net)}`]) assert(row.text.includes(text), `Missing ledger fact: ${text}`);
      for (const movement of movements) {
        for (const text of [movement.productName, movement.batchNo, `${number(Math.abs(movement.quantityDelta))} ${movement.unit}`]) assert(row.text.includes(text), `Missing movement fact: ${text}`);
      }
    }
    if (persisted) {
      assert.equal(read.shipment.id, persisted.id);
      assert.equal(read.shipment.statusUnobscured, true, 'Shipment status is covered by a sticky column');
      assert.equal(read.shipment.status, persisted.status === 'in_transit' ? '在途运输' : '待发货');
      assert(read.shipment.rowText.includes(persisted.shipmentNo));
    } else assert.equal(read.shipment, undefined);
  }
  return { actors: proof.readbacks.map(row => row.actorId), balances: state.balances.length, entries: state.entries.length };
}

async function inventoryRaceBrowser({ actors, urls, reportPath, runId }, source, signal) {
  const { expect } = require('playwright/test');
  const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
  const folder = path.join(path.dirname(reportPath), `${runId}-${source.persisted ? 'transfer-shipping' : 'stock-contention'}-browser`);
  fs.mkdirSync(folder, { recursive: true });
  const proof = { version: 'inventory-race-browser/v1', scope: 'Winner and loser browser readbacks of the real warehouse cohort; not full workforce acceptance', readbacks: [], runtimeErrors: [] };
  const { browser } = await launchBrowserWithGuard({ retryLimit: 1 });
  const abort = () => { void browser.close().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  let page;
  try {
    const participants = [source.responses.find(row => [200, 201].includes(row.status)), source.responses.find(row => row.status === 409)];
    for (const [instance, participant] of participants.entries()) {
      signal.throwIfAborted();
      const actor = Object.values(actors).find(row => row.id === participant.actorId);
      assert(actor?.loginUser && actor.role === 'warehouse');
      assert(!actor.loginUser.permissions.includes('customers.read'));
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
      page.on('pageerror', error => proof.runtimeErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') proof.runtimeErrors.push(message.text()); });
      await page.addInitScript(({ token, user }) => {
        for (const key of ['token', 'auth_token', 'erp_auth_token']) localStorage.setItem(key, token);
        for (const key of ['user', 'currentUser', 'erp_current_user']) localStorage.setItem(key, JSON.stringify(user));
        localStorage.setItem('erp_current_role', user.role); localStorage.setItem('ailao.activeTab', 'warehouse');
        localStorage.setItem('ailao.language', 'zh'); localStorage.setItem('language', 'zh-CN');
      }, { token: actor.token, user: actor.loginUser });
      const read = { actorId: actor.id, instance, httpStatuses: [], balances: [], ledger: [], screenshots: [], customerCatalogRequests: 0 };
      page.on('request', req => { if (new URL(req.url()).pathname === '/api/customers') read.customerCatalogRequests++; });
      proof.readbacks.push(read);
      const snapshot = async (label, target) => {
        const file = path.join(folder, `${instance}-${label}.png`);
        await expect(page.locator('#loading')).toBeHidden();
        await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
        await target.screenshot({ path: file }); read.screenshots.push(file);
      };
      const productName = source.state.balances[0].productName, batchNo = source.state.batch.batchNo;
      await page.goto(`${urls[instance]}/#warehouse`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('warehouse-tab-inventory').click();
      await page.getByTestId('warehouse-inventory-search').fill(productName);
      let response = page.waitForResponse(res => {
        const url = new URL(res.url());
        return res.request().method() === 'GET' && url.pathname === '/api/warehouses/stock-balances' && url.searchParams.get('productName') === productName;
      });
      await page.getByTestId('warehouse-inventory-query-button').click();
      read.httpStatuses.push((await response).status());
      await expect(page.locator('[data-testid^="warehouse-transfer-open-button-"]')).toHaveCount(source.state.balances.length);
      for (const balance of source.state.balances) {
        const button = page.getByTestId(`warehouse-transfer-open-button-${balance.id}`);
        const cells = page.locator('tr').filter({ has: button }).locator('td');
        await expect(cells).toContainText([balance.productName, balance.batchNo, String(balance.quantity), balance.unit]);
        if (Number(balance.quantity) <= 0) await expect(button).toBeDisabled();
        else await expect(button).toBeEnabled();
        read.balances.push({ id: balance.id, cells: (await cells.allTextContents()).slice(0, 6).map(text => text.trim()), transferDisabled: await button.isDisabled() });
      }
      await snapshot('balances', page.locator('table').filter({ has: page.getByTestId(`warehouse-transfer-open-button-${source.state.balances[0].id}`) }));
      await page.getByTestId('warehouse-tab-ledger').click();
      await page.getByTestId('warehouse-ledger-source-type-select').selectOption('');
      await page.getByTestId('warehouse-ledger-batch-search').fill(batchNo);
      response = page.waitForResponse(res => {
        const url = new URL(res.url());
        return res.request().method() === 'GET' && url.pathname === '/api/warehouses/stock-entries' && url.searchParams.get('batchNo') === batchNo && !url.searchParams.get('sourceType');
      });
      await page.getByTestId('warehouse-ledger-query-button').click();
      read.httpStatuses.push((await response).status());
      await expect(page.locator('[data-testid^="warehouse-ledger-row-"]')).toHaveCount(source.state.entries.length);
      for (const entry of source.state.entries) {
        const row = page.getByTestId(`warehouse-ledger-row-${entry.id}`);
        await expect(row).toContainText(entry.entryNo);
        read.ledger.push({ id: entry.id, text: await row.innerText() });
      }
      // Every row is asserted above; capture a real posted race voucher, not
      // the page's explanatory header (the app uses an inner scroll container).
      await snapshot('ledger', page.getByTestId(`warehouse-ledger-row-${source.state.entries.at(-1).id}`));
      if (source.persisted) {
        response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/shipping' && res.request().method() === 'GET');
        await page.goto(`${urls[instance]}/#shipping`, { waitUntil: 'domcontentloaded' });
        read.httpStatuses.push((await response).status());
        await page.getByTestId('shipping-grid-search-input').fill(source.persisted.shipmentNo);
        const status = page.getByTestId(`shipment-status-${source.persisted.id}`);
        await expect(status).toHaveText(source.persisted.status === 'in_transit' ? '在途运输' : '待发货');
        read.shipment = { id: source.persisted.id, status: await status.innerText(), rowText: await page.locator('tr').filter({ has: status }).innerText() };
        await snapshot('shipment', status);
        read.shipment.statusUnobscured = await status.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        });
      }
      await page.close(); page = null;
    }
    verifyInventoryBrowser(proof, source);
    return proof;
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(folder, 'failure.png'), fullPage: true }).catch(() => {});
    error.evidence = { ...proof, folder }; throw error;
  } finally {
    signal.removeEventListener('abort', abort); await browser.close();
  }
}

module.exports = { inventoryRaceBrowser, verifyInventoryBrowser };
