const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const number = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
const ids = rows => rows.map(row => Number(row.id)).sort((a, b) => a - b);
const publicProfile = profile => Object.fromEntries(['id', 'username', 'role', 'segment', 'isActive', 'mustChangePassword', 'permissions', 'dataScopes'].map(key => [key, profile[key]]));

function assertObserverProfile(actual, person) {
  assert(actual && person?.profile, 'Current observer profile is required');
  for (const key of ['id', 'username', 'role', 'segment']) assert.equal(actual[key], person.profile[key], `Observer profile ${key}`);
  assert.equal(actual.id, person.id); assert.equal(actual.role, person.role);
  assert.equal(actual.isActive, true); assert.equal(actual.mustChangePassword, false);
  for (const key of ['permissions', 'dataScopes']) {
    assert(Array.isArray(actual[key]) && actual[key].every(value => typeof value === 'string'));
    assert.equal(new Set(actual[key]).size, actual[key].length);
    assert.deepEqual([...actual[key]].sort(), [...person.profile[key]].sort(), `Observer ${key}`);
  }
  for (const permission of ['warehouse.read', 'warehouse.write', 'warehouse.ledger.read']) assert(actual.permissions.includes(permission));
  assert(!actual.permissions.includes('customers.read') && !actual.permissions.includes('*') && !actual.dataScopes.includes('all'));
  assert(actual.dataScopes.includes('warehouse_visible'));
}

async function observedBrowserGet(response, actor, instance, origin) {
  const request = response.request(), url = new URL(response.url());
  assert.equal(request.method(), 'GET'); assert.equal(url.origin, origin);
  // Never use equality assertions with private headers: their failure output
  // would serialize the token. Evidence contains only the comparison result.
  const authorizationMatched = await request.headerValue('authorization') === `Bearer ${actor.token}`;
  assert(authorizationMatched, 'Observer browser request used another authenticated session');
  assert.equal(response.status(), 200);
  const json = await response.json(); assert.equal(json.success, true);
  return { actorId: actor.id, instance, origin, method: 'GET', pathname: url.pathname,
    query: Object.fromEntries(url.searchParams), authorizationMatched, status: response.status(), json };
}

function verifyInventoryReadback(read, source) {
  const { state, persisted } = source;
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

// Two same20 warehouse observers read the existing stress writers' vouchers.
// Their read-only duties never replace the original winner/loser browser proof.
function verifyInventoryWorkforceReadbacks(proof, source) {
  assert(!source.persisted, 'Workforce stock observers belong to the stock20 race only');
  const cohort = source.workforce;
  assert(Array.isArray(cohort?.people) && cohort.people.length === 20, 'Original same20 people are required');
  assert(cohort.people.every(person => Number.isSafeInteger(person.id) && person.id > 0));
  assert.equal(new Set(cohort.people.map(person => person.id)).size, 20);
  assert(cohort.appUrls?.length === 2 && new Set(cohort.appUrls).size === 2, 'Both original application nodes are required');
  const observers = [1, 2].map(index => {
    const people = cohort.people.filter(person => person.job === 'warehouse' && person.index === index);
    assert.equal(people.length, 1, 'Expected the original warehouse duty');
    const person = people[0]; assertObserverProfile(person.profile, person);
    assert(!source.responses.some(row => row.actorId === person.id), 'Observer must not impersonate a pressure writer');
    return person;
  });
  assert(Array.isArray(proof.workforceReadbacks) && proof.workforceReadbacks.length === 2, 'Both same20 native observer pages are required');
  const sameRows = (actual, expected, fields) => {
    assert(Array.isArray(actual)); assert.deepEqual(ids(actual), ids(expected), 'Native API must contain every original row exactly once');
    for (const row of expected) for (const field of fields) {
      assert.deepEqual(actual.find(item => item.id === row.id)[field], row[field], `Native API ${row.id}/${field}`);
    }
  };
  for (const [instance, person] of observers.entries()) {
    const read = proof.workforceReadbacks[instance], origin = new URL(cohort.appUrls[instance]).origin;
    assert.equal(read.actorId, person.id); assert.equal(read.role, person.role); assert.equal(read.instance, instance);
    assert.equal(read.observerOnly, true); assert.equal(read.actualProfile?.endpoint, '/auth/me'); assert.equal(read.actualProfile.status, 200);
    assertObserverProfile(read.actualProfile, person);
    const responseData = (response, pathname) => {
      assert(response, 'Original native GET response is required');
      assert.equal(response.actorId, person.id); assert.equal(response.instance, instance); assert.equal(response.origin, origin);
      assert.equal(response.method, 'GET'); assert.equal(response.pathname, pathname); assert.equal(response.authorizationMatched, true);
      assert.equal(response.status, 200); assert.equal(response.json?.success, true);
      return response.json.data;
    };
    assertObserverProfile(responseData(read.nativeProfile, '/api/auth/me'), person);
    const balances = responseData(read.apiReadbacks?.balances, '/api/warehouses/stock-balances');
    const entries = responseData(read.apiReadbacks?.ledger, '/api/warehouses/stock-entries');
    assert.equal(read.apiReadbacks.balances.query.productName, source.state.balances[0].productName);
    assert.equal(read.apiReadbacks.ledger.query.batchNo, source.state.batch.batchNo); assert(!read.apiReadbacks.ledger.query.sourceType);
    sameRows(balances, source.state.balances, ['id', 'materialId', 'locationId', 'productName', 'batchNo', 'quantity', 'unit']);
    sameRows(balances, source.state.apiBalances[instance], ['warehouseName', 'locationName', 'warehouseCode', 'locationCode']);
    sameRows(entries, source.state.entries, ['id', 'entryNo', 'sourceType', 'sourceRef', 'direction', 'status', 'warehouseId', 'locationId', 'reason', 'note', 'createdBy']);
    for (const row of entries) {
      const movements = source.state.movements.filter(item => item.entryId === row.id);
      sameRows(row.movements, movements, ['id', 'entryId', 'stockBalanceId', 'locationId', 'materialId', 'productName', 'batchNo', 'unit', 'quantityBefore', 'quantityDelta', 'quantityAfter']);
      assert.equal(row.movementCount, movements.length);
      assert.equal(row.netQuantityDelta, movements.reduce((sum, item) => sum + item.quantityDelta, 0));
    }
    verifyInventoryReadback(read, source);
  }
  return { observers: observers.map(person => person.id), nodes: [0, 1] };
}

function raceBrowserActor(actors, workforce, actorId) {
  const current = workforce?.actors.find(person => person.id === actorId);
  const actor = current || Object.values(actors).find(person => person.id === actorId);
  const profile = current ? actor.profile : actor?.loginUser;
  assert(actor && profile, 'The real race participant and its authenticated profile are required');
  if (current) {
    assert.equal(actor.job, 'warehouse');
    assert(workforce.byJob.warehouse.includes(actor), 'Another job cannot impersonate a warehouse participant');
  } else assert.equal(actor.role, 'warehouse');
  assert.equal(Number(profile.id), actorId); assert.equal(profile.role, actor.role);
  for (const grant of ['warehouse.read', 'warehouse.write', 'warehouse.ledger.read']) assert(profile.permissions.includes(grant));
  assert(!profile.permissions.includes('customers.read') && !profile.permissions.includes('*'));
  assert(profile.dataScopes.includes('warehouse_visible') && !profile.dataScopes.includes('all'));
  return { actor, profile, current: Boolean(current) };
}

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
  for (const read of proof.readbacks) verifyInventoryReadback(read, source);
  if (source.workforce || proof.workforceReadbacks) verifyInventoryWorkforceReadbacks(proof, source);
  return { actors: proof.readbacks.map(row => row.actorId), balances: state.balances.length, entries: state.entries.length };
}

async function inventoryRaceBrowser({ actors, workforce, request, dataOf, urls, reportPath, runId }, source, signal) {
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
    const participants = [source.responses.find(row => [200, 201].includes(row.status)), source.responses.find(row => row.status === 409)]
      .map((participant, instance) => ({ participant, instance, observer: false }));
    if (!source.persisted && workforce) {
      assert(source.workforce?.people.length === 20, 'Stock workforce API proof must precede native observer readback');
      assert.deepEqual(source.workforce.appUrls, urls);
      proof.workforceReadbacks = [];
      proof.scope += '; two same20 warehouse observers read these vouchers, not pressure writers';
      for (const [instance, actor] of workforce.byJob.warehouse.slice(0, 2).entries()) {
        assert(workforce.actors.includes(actor) && actor.index === instance + 1 && actor.job === 'warehouse');
        const person = source.workforce.people.find(person => person.id === actor.id);
        assert(person?.job === 'warehouse' && person.index === actor.index); assertObserverProfile(actor.profile, person);
        participants.push({ participant: { actorId: actor.id }, instance, observer: true, person });
      }
    }
    for (const { instance, participant, observer, person } of participants) {
      signal.throwIfAborted();
      const selected = raceBrowserActor(actors, workforce, participant.actorId), { actor } = selected;
      let profile = selected.profile;
      let actualProfile;
      if (selected.current) {
        const response = await request('/auth/me', { actor, instance, signal });
        profile = dataOf(response);
        assert.equal(Number(profile.id), actor.id); assert.equal(profile.role, actor.role);
        assert.deepEqual([...profile.permissions].sort(), [...selected.profile.permissions].sort());
        assert.deepEqual([...profile.dataScopes].sort(), [...selected.profile.dataScopes].sort());
        if (observer) assertObserverProfile(profile, person);
        actualProfile = { endpoint: '/auth/me', status: response.status, ...publicProfile(profile) };
      }
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
      page.on('pageerror', error => proof.runtimeErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') proof.runtimeErrors.push(message.text()); });
      await page.addInitScript(({ token, user }) => {
        for (const key of ['token', 'auth_token', 'erp_auth_token']) localStorage.setItem(key, token);
        for (const key of ['user', 'currentUser', 'erp_current_user']) localStorage.setItem(key, JSON.stringify(user));
        localStorage.setItem('erp_current_role', user.role); localStorage.setItem('ailao.activeTab', 'warehouse');
        localStorage.setItem('ailao.language', 'zh'); localStorage.setItem('language', 'zh-CN');
      }, { token: actor.token, user: profile });
      const read = { actorId: actor.id, role: actor.role, ...(actualProfile ? { actualProfile } : {}),
        ...(observer ? { observerOnly: true, apiReadbacks: {} } : {}),
        instance, httpStatuses: [], balances: [], ledger: [], screenshots: [], customerCatalogRequests: 0 };
      page.on('request', req => { if (new URL(req.url()).pathname === '/api/customers') read.customerCatalogRequests++; });
      (observer ? proof.workforceReadbacks : proof.readbacks).push(read);
      const snapshot = async (label, target) => {
        const file = path.join(folder, `${instance}${observer ? '-workforce' : ''}-${label}.png`);
        await expect(page.locator('#loading')).toBeHidden();
        await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
        await target.screenshot({ path: file }); read.screenshots.push(file);
      };
      const productName = source.state.balances[0].productName, batchNo = source.state.batch.batchNo;
      const origin = new URL(urls[instance]).origin;
      const nativeProfile = observer ? page.waitForResponse(res => {
        const url = new URL(res.url());
        return url.origin === origin && url.pathname === '/api/auth/me' && res.request().method() === 'GET';
      }) : null;
      await page.goto(`${urls[instance]}/#warehouse`, { waitUntil: 'domcontentloaded' });
      if (observer) {
        read.nativeProfile = await observedBrowserGet(await nativeProfile, actor, instance, origin);
        assertObserverProfile(read.nativeProfile.json.data, person);
        read.nativeProfile.json = { success: true, data: publicProfile(read.nativeProfile.json.data) };
      }
      await page.getByTestId('warehouse-tab-inventory').click();
      await page.getByTestId('warehouse-inventory-search').fill(productName);
      let response = page.waitForResponse(res => {
        const url = new URL(res.url());
        return (!observer || url.origin === origin) && res.request().method() === 'GET' && url.pathname === '/api/warehouses/stock-balances' && url.searchParams.get('productName') === productName;
      });
      await page.getByTestId('warehouse-inventory-query-button').click();
      const balancesResponse = await response;
      read.httpStatuses.push(balancesResponse.status());
      if (observer) read.apiReadbacks.balances = await observedBrowserGet(balancesResponse, actor, instance, origin);
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
        return (!observer || url.origin === origin) && res.request().method() === 'GET' && url.pathname === '/api/warehouses/stock-entries' && url.searchParams.get('batchNo') === batchNo && !url.searchParams.get('sourceType');
      });
      await page.getByTestId('warehouse-ledger-query-button').click();
      const ledgerResponse = await response;
      read.httpStatuses.push(ledgerResponse.status());
      if (observer) read.apiReadbacks.ledger = await observedBrowserGet(ledgerResponse, actor, instance, origin);
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

module.exports = { inventoryRaceBrowser, verifyInventoryBrowser, verifyInventoryWorkforceReadbacks, raceBrowserActor };
