const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { expect } = require('playwright/test');
const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');
const { restartIsolatedApps } = require('./enterprise-round2-app-restart.cjs');

async function paymentSubmitBrowser(ctx, order, snapshot, e, signal) {
  const { actors, request, dataOf, runId, urls, reportPath } = ctx, orderId = Number(order.id);
  const folder = path.join(path.dirname(reportPath), `${runId}-payment-submit`); fs.mkdirSync(folder, { recursive: true });
  const browser = (await launchBrowserWithGuard({ retryLimit: 1 })).browser;
  const abort = () => { void browser.close().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  e.browserErrors = []; e.screenshots = [];
  async function open(actor, instance, hash) {
    // Route faults must reach the network, not a cached service-worker response.
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await page.context().tracing.start({ screenshots: true, snapshots: true });
    page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000); page.on('pageerror', err => e.browserErrors.push(err.message));
    await page.addInitScript(({ token, user }) => {
      for (const k of ['token', 'auth_token', 'erp_auth_token']) localStorage.setItem(k, token);
      for (const k of ['user', 'currentUser', 'erp_current_user']) localStorage.setItem(k, JSON.stringify(user));
      localStorage.setItem('ailao.language', 'zh'); localStorage.setItem('language', 'zh-CN');
    }, { token: actor.token, user: { id: String(actor.id), name: actor.job, role: actor.role, segment: 'mixed' } });
    await page.goto(`${urls[instance]}/#${hash}`, { waitUntil: 'domcontentloaded' }); await page.locator('#loading').waitFor({ state: 'hidden' }); return page;
  }
  try {
    const sales = await open(actors.sales, 0, 'orders');
    const openRegistration = async () => {
      await sales.getByTestId('sales-desk-payments').click(); await sales.getByTestId('sales-order-search').fill(order.orderNo);
      await sales.getByTestId(`sales-order-row-${orderId}`).getByTestId('sales-order-payment-button').click();
      await expect(sales.getByTestId('sales-order-payment-modal')).toBeVisible();
    };
    await openRegistration(); const modal = sales.getByTestId('sales-order-payment-modal');
    await modal.getByTestId('sales-order-payment-amount').fill('300'); await modal.locator('input[type="text"]').last().fill(`${runId}-lost-ack`);
    e.browser = { actorId: actors.sales.id, role: 'sales', faultRequests: 0 };
    const pattern = `**/api/orders/${orderId}/payment`;
    await sales.route(pattern, async route => {
      e.browser.faultRequests++; e.browser.payload = route.request().postDataJSON();
      const res = await route.fetch({ timeout: 15000 }); e.browser.committedResponse = { status: res.status(), json: await res.json() };
      await route.abort('failed'); // Discard a real committed success, not a mocked business response.
    });
    await modal.getByTestId('sales-order-payment-confirm').click({ clickCount: 2 });
    await expect(modal.getByTestId('sales-order-payment-confirm')).toBeEnabled();
    await expect(sales.getByText('提交结果未确认。原请求身份已保留；请重试确认，不会另建一笔回款。', { exact: true })).toBeVisible();
    assert.equal(e.browser.faultRequests, 1); assert.equal(e.browser.committedResponse.status, 200);
    e.browser.originalReceipt = e.browser.committedResponse.json.paymentSubmission;
    e.browser.storageBefore = await sales.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('ailaoda.payment-intent/v1.'))));
    assert.equal(Object.keys(e.browser.storageBefore).length, 1);
    await expect(modal.getByTestId('sales-order-payment-amount')).toBeDisabled(); e.browser.lockedUnknownFacts = true;
    const unknown = path.join(folder, 'sales-unknown-ack.png'); await sales.screenshot({ path: unknown });
    e.screenshots.push({ kind: 'unknown-ack', path: unknown, font: await verifyRenderedCjk(sales, '[data-testid="sales-order-payment-modal"]') });
    await sales.unroute(pattern); e.beforeAppCrash = await snapshot();
    e.restart = await restartIsolatedApps(urls, signal, async () => { assert.deepEqual(await snapshot(), e.beforeAppCrash); });
    // Reproduce the cloud's failed optional chunk fetch after restart. It must
    // not unmount the sales page or discard the durable unacknowledged payment.
    const aiPattern = '**/assets/AIAssistant-*.js';
    e.optionalAiModuleFailure = { failedRequests: 0, startedAt: new Date().toISOString() };
    await sales.route(aiPattern, async route => { e.optionalAiModuleFailure.failedRequests++; await route.abort('failed'); });
    await sales.reload(); await sales.locator('#loading').waitFor({ state: 'hidden' });
    await expect(sales.getByTestId('ai-tools-unavailable')).toBeVisible();
    assert(e.optionalAiModuleFailure.failedRequests >= 1);
    e.optionalAiModuleFailure.issues = await sales.evaluate(() => window.__AILAODA_CLIENT_ISSUES__ || []);
    assert(e.optionalAiModuleFailure.issues.some(issue => issue.scope === 'page-error-boundary:ai-tools'));
    assert(!e.optionalAiModuleFailure.issues.some(issue => issue.scope === 'root-error-boundary'));
    e.optionalAiModuleFailure.screenshot = path.join(folder, 'sales-ai-unavailable-payment-preserved.png');
    await sales.screenshot({ path: e.optionalAiModuleFailure.screenshot });
    await openRegistration();
    const restored = sales.getByTestId('sales-order-payment-modal');
    await expect(restored.getByTestId('payment-submission-unconfirmed')).toBeVisible();
    await expect(restored.getByTestId('sales-order-payment-amount')).toHaveValue('300');
    const ack = sales.waitForResponse(res => new URL(res.url()).pathname === `/api/orders/${orderId}/payment` && res.request().method() === 'POST');
    await restored.getByTestId('sales-order-payment-confirm').click(); const recovered = await ack;
    e.browser.recoveredResponse = { status: recovered.status(), json: await recovered.json() };
    assert.equal(recovered.status(), 200); assert.equal(e.browser.recoveredResponse.json.replayed, true);
    assert.deepEqual(e.browser.recoveredResponse.json.paymentSubmission, e.browser.originalReceipt);
    await expect(restored).toBeHidden();
    e.browser.storageAfter = await sales.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('ailaoda.payment-intent/v1.')));
    assert.deepEqual(e.browser.storageAfter, []); assert.deepEqual(await snapshot(), e.beforeAppCrash);
    const id = e.browser.originalReceipt.paymentId;
    dataOf(await request(`/orders/${orderId}/payment/${id}/verify`, { actor: actors.finance2, instance: 1, method: 'POST', signal }));
    e.finalSnapshot = await snapshot(); assert.equal(e.finalSnapshot.payments.length, 3); assert.equal(e.finalSnapshot.submissions.length, 3);
    assert.equal(e.finalSnapshot.audits.length, 3); assert.equal(Number(e.finalSnapshot.order.paidAmount), 900);
    for (const index of [0,1]) {
      const replay = await request(`/orders/${orderId}/payment`, { actor: actors.sales, instance: index, method: 'POST', signal, data: e.browser.payload });
      assert.equal(replay.status, 200); assert.deepEqual(replay.json.paymentSubmission, e.browser.originalReceipt);
    }
    e.afterAllReplays = await snapshot(); assert.deepEqual(e.afterAllReplays, e.finalSnapshot);
    e.apiReadbacks = await Promise.all(urls.map(async (_, instance) => {
      const row = dataOf(await request(`/orders/${orderId}`, { actor: actors.finance1, instance, signal }));
      assert.equal(Number(row.paidAmount), 900); assert.equal(row.paymentRecords.length, 3);
      return { instance, orderId, paidAmount: row.paidAmount, paymentStatus: row.paymentStatus, count: row.paymentRecords.length };
    }));
    await sales.unroute(aiPattern);
    await sales.reload(); await expect(sales.getByTestId('ai-assistant-open')).toBeVisible();
    await expect(sales.getByTestId('sales-desk-payments')).toBeVisible();
    await expect(sales.getByTestId('ai-tools-unavailable')).toHaveCount(0);
    e.optionalAiModuleFailure.afterRecovery = await snapshot();
    assert.deepEqual(e.optionalAiModuleFailure.afterRecovery, e.finalSnapshot);
    e.optionalAiModuleFailure.recovered = true;
    e.optionalAiModuleFailure.finishedAt = new Date().toISOString();
    for (const [index, actor] of [actors.finance1, actors.finance2].entries()) {
      const page = await open(actor, index, 'collections'); await page.getByTestId('collection-tab-ledger').click();
      await page.getByTestId('collection-ledger-search').fill(order.orderNo);
      await page.getByRole('button', { name: '显示或隐藏表格列', exact: true }).first().click();
      const columns = page.getByRole('dialog', { name: '选择要显示的表格列' });
      for (const label of ['收款单', '金额', '状态']) await columns.getByRole('checkbox', { name: `显示列：${label}`, exact: true }).setChecked(true);
      for (const label of ['订单号', '客户', '方式', '录入时间']) await columns.getByRole('checkbox', { name: `显示列：${label}`, exact: true }).setChecked(false);
      await page.keyboard.press('Escape'); await page.getByTestId(`collection-ledger-row-${id}`).getByText(`#${id}`, { exact: true }).click();
      const card = page.getByTestId(`collection-payment-detail-${id}`); await card.scrollIntoViewIfNeeded();
      const status = card.getByText('已核销', { exact: true }), amount = card.getByText(/300\.00/).first();
      await expect(status).toBeVisible(); await expect(amount).toBeVisible();
      const hit = el => { const r=el.getBoundingClientRect(), top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return !!top&&(top===el||el.contains(top)); };
      const statusVisible = await status.evaluate(hit), amountVisible = await amount.evaluate(hit); assert(statusVisible && amountVisible);
      const file = path.join(folder, `finance-${index + 1}-registered-once.png`); await page.screenshot({ path: file });
      e.screenshots.push({ kind: 'finance-readback', actorId: actor.id, path: file, statusVisible, amountVisible, text: await card.innerText(),
        font: await verifyRenderedCjk(page, `[data-testid="collection-payment-detail-${id}"]`) });
    }
    assert.equal(e.browserErrors.length, 0);
  } catch (error) {
    // Keep the failing page and network evidence; a locator timeout alone cannot
    // distinguish authentication, lazy-module loading, and business UI failures.
    e.browserFailure = [];
    for (const [index, context] of browser.contexts().entries()) {
      const page = context.pages()[0], failure = { index };
      try {
        failure.page = await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 8000),
          issues: window.__AILAODA_CLIENT_ISSUES__ || [] }));
        failure.screenshot = path.join(folder, `failure-${index}.png`);
        await page.screenshot({ path: failure.screenshot, timeout: 5000 });
        failure.trace = path.join(folder, `failure-${index}.zip`);
        await context.tracing.stop({ path: failure.trace });
      } catch (captureError) { failure.captureError = captureError.message; }
      e.browserFailure.push(failure);
    }
    throw error;
  } finally {
    signal.removeEventListener('abort', abort); await browser.close(); fs.writeFileSync(path.join(folder, 'evidence.json'), JSON.stringify(e, null, 2));
  }
}
module.exports = { paymentSubmitBrowser };
