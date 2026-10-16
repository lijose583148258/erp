const assert = require('node:assert/strict');
const path = require('node:path');
const { expect } = require('playwright/test');
const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
const { loginUiAuditUser } = require('./ui-audit-user.cjs');
const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');

// Concrete QC/QA/AP steps for the same receipt of the shared sales chain.
// No new fixture, hidden quality update, or fixed2kg report substitution.
async function createSharedQualityBrowser({ urls, actors, runId, folder, signal }) {
  const e = { runId, actors: [], browserProfiles: [], actions: [], readbacks: [], screenshots: [] }, pages = {};
  let browser;
  const abort = () => { if (browser) void browser.close().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  const load = async (job, receiptId) => {
    signal?.throwIfAborted();
    const actor = actors[job], instance = job === 'qa' ? 1 : 0;
    assert(actor?.id && actor.role === actor.account.role);
    if (!browser) browser = (await launchBrowserWithGuard({ retryLimit: 1 })).browser;
    if (signal?.aborted) { abort(); signal.throwIfAborted(); }
    if (!pages[job]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, locale: 'en-US', serviceWorkers: 'block' });
      page.setDefaultTimeout(12000);
      const login = await loginUiAuditUser(page, `${urls[instance]}/`, { account: actor.account, storage: { 'ailao.language': 'zh', language: 'zh-CN' } });
      assert.equal(Number(login.user.id), actor.id); assert.equal(login.user.role, actor.role);
      actor.token = login.token;
      pages[job] = page; e.actors.push({ job, actorId: actor.id, instance, role: actor.role, profile: actor.profile });
    }
    const page = pages[job], hash = job === 'payables' ? 'financeAnalytics' : 'procurement';
    const auth = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/me' && r.request().method() === 'GET');
    await page.goto(`${urls[instance]}/#${hash}`, { waitUntil: 'domcontentloaded' }); await page.reload({ waitUntil: 'domcontentloaded' });
    const response = await auth; assert.equal(response.status(), 200); const actual = (await response.json()).data;
    const profile = user => ({ id: Number(user.id), role: user.role, permissions: [...user.permissions].sort(), dataScopes: [...user.dataScopes].sort() });
    assert.deepEqual(profile(actual), profile(actor.profile));
    e.browserProfiles.push({ job, actorId: actor.id, instance, path: '/api/auth/me', status: response.status(), actual: profile(actual) });
    await page.locator('#loading').waitFor({ state: 'hidden' });
    const selector = job === 'payables' ? `supplier-payable-open-${receiptId}` : `incoming-quality-select-${receiptId}`;
    await page.getByTestId(selector).click();
    return { page, actor, instance };
  };
  const shot = async (job, name, selector) => {
    const page = pages[job], target = page.getByTestId(selector);
    await target.scrollIntoViewIfNeeded(); await expect(target).toBeVisible();
    await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
    const visibility = await target.evaluate(element => {
      const r = element.getBoundingClientRect(), style = getComputedStyle(element);
      const left = Math.max(0, r.left), right = Math.min(innerWidth, r.right), top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
      const visible = right > left && bottom > top && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
      const point = { x: left + (right - left) / 2, y: top + Math.min(16, (bottom - top) / 2) };
      const hit = visible ? document.elementFromPoint(point.x, point.y) : null;
      return { visible, unobscured: Boolean(hit && element.contains(hit)), point,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height }, hit: hit ? { tag: hit.tagName, testId: hit.getAttribute('data-testid') } : null };
    });
    if (!visibility.visible || !visibility.unobscured) {
      const file = path.join(folder, `${job}-${name}-FAILED.png`); await page.screenshot({ path: file, fullPage: true });
      e.screenshots.push({ job, actorId: actors[job].id, selector, path: file, ...visibility, diagnostic: true, unverified: true });
      assert.fail(`${job}/${name}: evidence hidden/covered ${JSON.stringify(visibility)}`);
    }
    const font = await verifyRenderedCjk(page, `[data-testid="${selector}"]`);
    const file = path.join(folder, `${job}-${name}.png`); await page.screenshot({ path: file, fullPage: true });
    const image = { job, actorId: actors[job].id, selector, path: file, ...visibility, font, text: await target.innerText() };
    e.screenshots.push(image); return image;
  };
  const write = async (job, state, selector, endpoint, status) => {
    const wait = state.page.waitForResponse(r => new URL(r.url()).pathname === `/api${endpoint}` && r.request().method() === 'POST');
    await state.page.getByTestId(selector).click(); const response = await wait, req = response.request(), json = await response.json();
    const http = { job, actorId: state.actor.id, role: state.actor.role, instance: state.instance, method: 'POST', path: `/api${endpoint}`,
      sent: req.postDataJSON(), key: req.headers()['idempotency-key'] || null, status: response.status(), json };
    e.actions.push(http); assert.equal(http.status, status, JSON.stringify(http)); return { json, http, actorId: state.actor.id };
  };
  return {
    payable: async ({ receiptId, amountNative, eligible }) => {
      const { page } = await load('payables', receiptId);
      const eligibility = page.getByTestId('supplier-payment-eligibility');
      await expect(page.getByTestId('supplier-payment-amounts')).toContainText(`${amountNative} CNY`);
      await expect(eligibility).toContainText(eligible ? '最新独立QA放行证据已确认' : '付款核验冻结');
      const readback = { receiptId, amountNative, eligible, actorId: actors.payables.id,
        screenshot: await shot('payables', `${receiptId}-${eligible ? 'released' : 'frozen'}`, 'supplier-payment-detail') };
      e.readbacks.push(readback); return readback;
    },
    registerPayment: async ({ receiptId, input }) => {
      const s = await load('payables', receiptId);
      for (const [name, value] of [['amount', input.amountNative], ['date', input.date], ['account', input.paymentAccountRef],
        ['transaction', input.externalTransactionRef], ['evidence', input.evidenceRef], ['note', input.note]]) await s.page.getByTestId(`supplier-payment-${name}`).fill(String(value));
      await s.page.getByTestId('supplier-payment-method').selectOption(input.method);
      const result = await write('payables', s, 'supplier-payment-register', `/procurement/receipts/${receiptId}/payments`, 201);
      assert.deepEqual(result.http.sent, input);
      await expect(s.page.getByTestId(`supplier-payment-${result.json.data.submission.payment.id}`)).toBeVisible();
      await shot('payables', `${receiptId}-actual-proposal`, 'supplier-payment-detail'); return result;
    },
    inspect: async ({ receiptId }) => {
      const s = await load('qc', receiptId);
      await expect(s.page.getByTestId('incoming-quality-release')).toHaveCount(0);
      await s.page.getByTestId('incoming-quality-sample').fill(`${runId}-same50-retained-sample`);
      await s.page.getByTestId('incoming-quality-value-PH').fill('7.5');
      await s.page.getByTestId('incoming-quality-instrument-PH').fill(`${runId}-calibrated-PH`);
      await s.page.getByTestId('incoming-quality-note').fill('Declared actual isolated retained-sample reading; not inferred from receiving');
      const result = await write('qc', s, 'incoming-quality-submit', `/procurement/receipts/${receiptId}/quality-checks`, 201);
      const inspection = result.json.data.submission.inspection; assert.equal(inspection.result, 'pass');
      await expect(s.page.getByTestId(`incoming-quality-check-${inspection.id}`)).toBeVisible();
      await shot('qc', `${receiptId}-measured`, 'incoming-quality-workspace'); return result;
    },
    release: async ({ receiptId, checkId }) => {
      const s = await load('qa', receiptId);
      await expect(s.page.getByTestId('incoming-quality-submit')).toHaveCount(0);
      await s.page.getByTestId('incoming-quality-review-reason').fill('Independent QA reviewed this same50 receipt, frozen standard and actual retained sample');
      const result = await write('qa', s, 'incoming-quality-release', `/procurement/quality-checks/${checkId}/review`, 200);
      await expect(s.page.getByTestId('incoming-quality-review-state')).toContainText('已独立 QA 放行');
      // Inspect the actual QA decision, not the top of a taller-than-viewport
      // workspace which can legitimately scroll beneath the sticky app header.
      await shot('qa', `${receiptId}-independently-released`, 'incoming-quality-review-state'); return result;
    },
    evidence: () => e,
    close: async () => { signal?.removeEventListener('abort', abort); if (browser) { await browser.close(); browser = null; } },
  };
}
module.exports = { createSharedQualityBrowser };
