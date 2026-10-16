const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('playwright/test');
const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
const { loginUiAuditUser } = require('./ui-audit-user.cjs');
const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');

// Narrow steps for the caller's ONE shared sales manifest. No fixture seeding,
// API-side business mutation, role substitution, recovery retry, or new runner.
async function createSharedSalesBrowser({ urls, actors, runId, folder, signal }) {
  assert(urls?.length && actors?.warehouse && actors?.sales && runId && folder);
  fs.mkdirSync(folder, { recursive: true });
  const e = { runId, actors: [], actions: [], screenshots: [], readbacks: [] };
  const states = {}, pending = new Set();
  const secrets = Object.values(actors).flatMap(a => [a.token, a.account?.password]).filter(Boolean);
  const safe = value => {
    if (typeof value === 'string') return secrets.reduce((s, secret) => s.split(secret).join('[redacted]'), value);
    if (Array.isArray(value)) return value.map(safe);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([k]) => !/password|token|authorization|cookie|secret/i.test(k)).map(([k, v]) => [k, safe(v)]));
  };
  const profile = user => ({ id: Number(user.id), role: user.role,
    permissions: [...(user.permissions || [])].sort(), dataScopes: [...(user.dataScopes || [])].sort() });
  let browser, shotIndex = 0;
  const abort = () => { if (browser) void browser.close().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  const shot = async (s, name, locator) => {
    const file = path.join(folder, `${String(++shotIndex).padStart(3, '0')}-${name}.png`);
    const cropped = Boolean(locator), diagnostic = name.endsWith('-FAILED');
    let target = locator, selector, fontSelector, verification;
    try {
      if (target) s.lastShotTarget = target;
      if (!target && s.job === 'sales') target = s.lastShotTarget;
      if (target) {
        const anchor = await target.locator('[data-testid^="order-reserved-"]').getAttribute('data-testid');
        assert(anchor, 'Provided fulfillment screenshot target lacks a stable testId anchor');
        selector = `parent fulfillment line containing [data-testid=${JSON.stringify(anchor)}]`;
        fontSelector = `[data-testid=${JSON.stringify(anchor)}]`;
      } else if (/^(draft|reserve|release|supplement)-/.test(s.phase)) {
        selector = '[role="dialog"][aria-modal="true"]:visible';
      } else if (s.phase.startsWith('receive-')) {
        // The overlay's empty backdrop is NOT the business POD panel.
        selector = '[data-testid="shipping-receipt-drawer"] > aside';
      } else {
        const shipmentId = /^dispatch-(\d+)$/.exec(s.phase)?.[1];
        if (shipmentId) selector = `[data-testid="shipment-reserved-${shipmentId}"]`;
      }
      assert(target || selector, `No business screenshot target for ${s.phase}`);
      target ||= s.page.locator(selector); fontSelector ||= selector;
      await expect(target).toBeVisible(); await target.scrollIntoViewIfNeeded();
      // A cell can intersect the viewport yet sit under sticky action columns.
      // Use normal scroll alignment, never hide the overlay or weaken hit-test.
      await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
      verification = await target.evaluate(element => {
        const r = element.getBoundingClientRect(), style = getComputedStyle(element);
        const left = Math.max(0, r.left), right = Math.min(innerWidth, r.right);
        const top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
        const visible = right > left && bottom > top && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
        const point = { x: left + (right - left) / 2, y: top + Math.min(16, (bottom - top) / 2) };
        const hit = visible ? document.elementFromPoint(point.x, point.y) : null;
        return { visible, unobscured: Boolean(visible && hit && element.contains(hit)), point,
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          hit: hit ? { tag: hit.tagName, testId: hit.getAttribute('data-testid'), role: hit.getAttribute('role') } : null };
      });
      assert(verification.visible && verification.unobscured, `${name}: business screenshot target is not visible/unobscured`);
      const font = await verifyRenderedCjk(s.page, fontSelector);
      if (cropped) await target.screenshot({ path: file }); else await s.page.screenshot({ path: file, fullPage: true });
      e.screenshots.push({ job: s.job, actorId: s.actorId, name, path: file, selector, fontSelector,
        diagnostic, unverified: false, ...verification, font });
    } catch (error) {
      if (!diagnostic) throw error;
      await s.page.screenshot({ path: file, fullPage: true });
      e.screenshots.push({ job: s.job, actorId: s.actorId, name, path: file, selector: selector || null, ...verification,
        diagnostic, unverified: true, visible: verification?.visible ?? null,
        unobscured: verification?.unobscured ?? null, verificationError: String(error.message || error) });
    }
    return file;
  };
  const observe = async (s, response) => {
    const req = response.request(), url = new URL(response.url()), phase = s.phase;
    let body = null, json = null;
    try { body = req.postDataJSON(); } catch { /* Non-JSON telemetry is not business evidence. */ }
    try { json = await response.json(); } catch { /* Preserve status for non-JSON failures. */ }
    return safe({ job: s.job, actorId: s.actorId, phase, instance: s.instance,
      method: req.method(), path: url.pathname + url.search, body, sent: body,
      key: req.headers()['idempotency-key'] || url.searchParams.get('submissionKey') || null,
      status: response.status(), json });
  };
  const open = async job => {
    signal?.throwIfAborted();
    if (states[job]) return states[job];
    const actor = actors[job], instance = job === 'sales' && urls[1] ? 1 : 0;
    assert(actor?.account?.role === actor.role, `${job}: dynamic account role must be preserved`);
    if (!browser) browser = (await launchBrowserWithGuard({ retryLimit: 1 })).browser;
    if (signal?.aborted) { abort(); signal.throwIfAborted(); }
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, locale: 'en-US', serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
    const s = states[job] = { job, instance, context, page, actorId: Number(actor.profile?.id), phase: 'login' };
    const login = await loginUiAuditUser(page, `${urls[instance].replace(/\/$/, '')}/`, {
      account: actor.account, storage: { 'ailao.language': 'zh', language: 'zh-CN' } });
    assert.equal(login.user.role, actor.role, `${job}: actual login role`);
    assert.equal(Number(login.user.id), s.actorId, `${job}: actual login actor`);
    // The fixture login helper reasserts account credentials; keep subsequent
    // API checks on this exact actor's new session, not its invalidated token.
    actor.token = login.token;
    // Attach only AFTER login. Tokens/passwords are never network artifacts.
    page.on('response', response => {
      const endpoint = new URL(response.url()).pathname;
      if (!endpoint.startsWith('/api/') || endpoint === '/api/auth/login') return;
      const task = observe(s, response).then(row => { e.actions.push(row); });
      pending.add(task); void task.finally(() => pending.delete(task)).catch(() => {});
    });
    return s;
  };
  const load = async (s, hash) => {
    await s.page.goto(`${urls[s.instance].replace(/\/$/, '')}/#${hash}`, { waitUntil: 'domcontentloaded' });
    await s.page.locator('#loading').waitFor({ state: 'hidden' });
    // Match a newly started request, not an earlier hash-navigation response.
    const auth = s.page.waitForRequest(r => new URL(r.url()).pathname === '/api/auth/me' && r.method() === 'GET');
    void auth.catch(() => {});
    await s.page.reload({ waitUntil: 'domcontentloaded' });
    const observed = await (await auth).response(); assert(observed, 'Fresh auth/me request failed'); assert.equal(observed.status(), 200);
    const actual = profile((await observed.json()).data), expected = profile(actors[s.job].profile);
    assert.deepEqual(actual, expected, `${s.job}: fresh auth/me profile differs from fixture actor`);
    if (!e.actors.some(a => a.job === s.job)) e.actors.push({ job: s.job, index: actors[s.job].index, instance: s.instance, ...actual });
    await s.page.locator('#loading').waitFor({ state: 'hidden' });
    return s.page;
  };
  const perform = async (job, phase, fn) => {
    let s;
    try { s = await open(job); s.phase = phase; return await fn(s); }
    catch (error) {
      s ||= states[job];
      if (s && !s.page.isClosed()) await shot(s, `${phase}-FAILED`).catch(() => {});
      throw error;
    }
  };
  const write = async (s, testId, endpoint, method, status) => {
    const waiting = s.page.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.request().method() === method);
    void waiting.catch(() => {});
    await s.page.getByTestId(testId).click();
    const http = await observe(s, await waiting);
    assert.equal(http.status, status, `${s.phase}: ${JSON.stringify(http)}`);
    return { json: http.json, http, actorId: s.actorId };
  };
  const reservation = (action, { shipmentId, reason }) => perform('warehouse', `${action}-${shipmentId}`, async s => {
    const page = await load(s, 'shipping');
    await page.getByTestId(`shipment-reservation-${shipmentId}`).click();
    await expect(page.getByTestId('shipment-reservation-state')).toBeVisible();
    if (action === 'release') {
      assert(String(reason || '').trim().length >= 3, 'Real release reason is required');
      await page.getByTestId('shipment-reservation-reason').fill(reason);
    }
    const result = await write(s, `shipment-reservation-${action}`, `/api/shipping/${shipmentId}/${action === 'reserve' ? 'reserve' : 'release-reservation'}`, 'POST', 201);
    await expect(page.getByTestId('shipment-reservation-state')).toHaveText(action === 'reserve' ? '已预留' : '已释放');
    await expect(page.getByTestId('shipment-reservation-saved')).toBeVisible();
    await shot(s, s.phase); await page.getByTestId('shipment-reservation-close').click();
    await expect(page.getByTestId('shipment-reservation-modal')).toHaveCount(0);
    return result;
  });
  return {
    draft: input => perform('warehouse', `draft-${input.orderId}`, async s => {
      const { orderId, lineId, quantity, batchNo } = input, page = await load(s, 'shipping');
      await page.getByTestId('shipping-order-draft-open').click();
      await page.getByTestId('shipping-order-draft-order').selectOption(String(orderId));
      await page.getByTestId('shipping-order-shipment-line').selectOption(String(lineId));
      await page.getByTestId('shipping-order-shipment-quantity').fill(String(quantity));
      await expect(page.getByTestId('shipping-order-shipment-batch')).toHaveValue('');
      if (batchNo) await page.getByTestId('shipping-order-shipment-batch').fill(batchNo);
      const result = await write(s, 'shipping-order-shipment-create', '/api/shipping', 'POST', 201);
      const shipment = result.json.data;
      assert.equal(Number(shipment.orderId), Number(orderId)); assert.equal(Number(shipment.orderItemId), Number(lineId));
      assert.equal(shipment.quantity, quantity); assert.equal(Number(shipment.createdBy), s.actorId);
      assert.equal(shipment.batchNo, batchNo || null); assert.equal(shipment.status, 'pending');
      await expect(page.getByTestId('shipping-order-shipment-success')).toContainText(shipment.shipmentNo);
      await expect(page.getByTestId('shipping-order-shipment-close')).toBeEnabled();
      await expect(page.getByTestId('shipping-order-shipment-error')).toHaveCount(0);
      await shot(s, `${s.phase}-${shipment.id}`); await page.getByTestId('shipping-order-shipment-close').click();
      await expect(page.getByTestId('shipping-order-shipment-close')).toHaveCount(0);
      return { ...result, shipment, submission: result.json.submission };
    }),
    reserve: input => reservation('reserve', input),
    release: input => reservation('release', input),
    supplement: input => perform('warehouse', `supplement-${input.shipmentId}`, async s => {
      const { shipmentId, batchNo } = input, page = await load(s, 'shipping');
      assert(batchNo, 'A real received internal batch is required');
      await page.getByTestId(`shipment-supplement-${shipmentId}`).click();
      await page.getByTestId('shipment-supplement-batch').fill(batchNo);
      const result = await write(s, 'shipment-supplement-save', `/api/shipping/${shipmentId}/supplement`, 'PATCH', 200);
      await expect(page.getByTestId('shipment-supplement-batch')).toBeDisabled();
      await shot(s, s.phase); await page.getByTestId('shipment-supplement-close').click();
      await expect(page.getByTestId('shipment-supplement-close')).toHaveCount(0); return result;
    }),
    dispatch: input => perform('warehouse', `dispatch-${input.shipmentId}`, async s => {
      const page = await load(s, 'shipping'), shipmentId = input.shipmentId;
      await expect(page.getByTestId(`shipment-dispatch-${shipmentId}`)).toBeVisible();
      await shot(s, `${s.phase}-before`);
      const result = await write(s, `shipment-dispatch-${shipmentId}`, `/api/shipping/${shipmentId}/status`, 'PATCH', 200);
      await load(s, 'shipping');
      await expect(page.getByTestId(`shipment-reserved-${shipmentId}`)).toContainText(/(?:^|\D)0\s*kg/);
      await shot(s, `${s.phase}-after`); return result;
    }),
    receive: input => perform('warehouse', `receive-${input.shipmentId}`, async s => {
      const { shipmentId, quantity, acceptedQuantity, note } = input, page = await load(s, 'shipping');
      assert(quantity > 0 && acceptedQuantity >= 0 && acceptedQuantity <= quantity);
      await page.getByTestId(`shipment-receipts-button-${shipmentId}`).click();
      const drawer = page.getByTestId('shipping-receipt-drawer');
      await page.getByTestId('shipping-receipt-quantity-input').fill(String(quantity));
      await page.getByTestId('shipping-receipt-accepted-input').fill(String(acceptedQuantity));
      await page.getByTestId('shipping-receipt-rejected-input').fill(String(quantity - acceptedQuantity));
      if (acceptedQuantity !== quantity) await drawer.locator('label').filter({ hasText: '异常原因' }).locator('input').fill(note || 'Isolated shared-order receipt discrepancy');
      if (note) await drawer.locator('textarea').fill(note);
      // The native POD permits no attachment; never fabricate a customer signature.
      const result = await write(s, 'shipping-receipt-save-button', `/api/shipping/${shipmentId}/receipt-events`, 'POST', 201);
      const ack = result.json.data?.submission;
      assert.equal(Number(ack?.shipmentId), Number(shipmentId)); assert.equal(Number(ack?.actorId), s.actorId);
      assert.equal(ack.facts.quantity, quantity); assert.equal(ack.facts.acceptedQuantity, acceptedQuantity);
      await expect(page.getByTestId('shipping-receipt-pending')).toHaveCount(0);
      await expect(page.getByTestId('shipping-receipt-error')).toHaveCount(0);
      await shot(s, s.phase); await drawer.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(drawer).toHaveCount(0); return result;
    }),
    salesRead: input => perform('sales', `sales-${input.orderId}-${e.readbacks.length + 1}`, async s => {
      const { orderId, lineId, orderNo, expected } = input, page = await load(s, 'orders');
      for (const key of ['reservedQuantity', 'dispatchedQuantity', 'acceptedQuantity', 'outstandingQuantity', 'orderedQuantity']) assert(Number.isFinite(expected[key]), key);
      await page.getByTestId('sales-desk-fulfillment').click();
      await page.getByTestId('sales-order-search').fill(orderNo);
      const reservedId = `order-reserved-${orderId}-${lineId}`, obligationId = `order-line-obligation-${orderId}-${lineId}`;
      const reserved = page.getByTestId(reservedId), obligation = page.getByTestId(obligationId), line = reserved.locator('..');
      const qty = n => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*kg`;
      await expect(reserved).toBeVisible(); await expect(reserved).toContainText(new RegExp(`:\\s*${qty(expected.reservedQuantity)}(?:$|\\s)`));
      await expect(obligation).toContainText(new RegExp(`已签收:\\s*${qty(expected.acceptedQuantity)}`));
      await expect(obligation).toContainText(new RegExp(`待交:\\s*${qty(expected.outstandingQuantity)}`));
      await expect(line).toContainText(new RegExp(`${qty(expected.dispatchedQuantity)}\\s*/\\s*${qty(expected.orderedQuantity)}`));
      await expect(page.getByText(/订单工作台部分数据加载失败/)).toHaveCount(0);
      await line.scrollIntoViewIfNeeded();
      const unobscured = await line.evaluate(element => {
        const r = element.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        const hit = document.elementFromPoint(x, y); return Boolean(hit && (element.contains(hit) || hit.contains(element)));
      });
      assert(unobscured, 'Shared order fulfillment line is obscured');
      assert.equal(await page.locator('[aria-modal="true"]:visible').count(), 0);
      const font = await verifyRenderedCjk(page, `[data-testid="${reservedId}"]`);
      const readback = { runId, actorId: s.actorId, job: 'sales', instance: s.instance, orderId, lineId, orderNo,
        expected: { ...expected }, testIds: { reserved: reservedId, obligation: obligationId }, unobscured, font, noPartialLoadWarning: true,
        texts: { line: await line.innerText(), reserved: await reserved.innerText(), obligation: await obligation.innerText() },
        crop: await shot(s, `${s.phase}-quantities`, line), screenshot: await shot(s, s.phase) };
      e.readbacks.push(readback); return readback;
    }),
    evidence: () => safe(e),
    close: async () => {
      signal?.removeEventListener('abort', abort);
      await Promise.allSettled([...pending]);
      await Promise.all(Object.values(states).map(s => s.context.close().catch(() => {})));
      if (browser) await browser.close();
      await Promise.allSettled([...pending]);
    },
  };
}

module.exports = { createSharedSalesBrowser };
