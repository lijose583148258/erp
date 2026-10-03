const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { expect } = require('playwright/test');
const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');

async function paymentAdjustmentBrowser(ctx, order, originalPaymentId, evidence, signal) {
  const { actors, urls, runId } = ctx;
  const folder = path.join(path.dirname(ctx.reportPath || process.env.ROUND2_REPORT_PATH), `${runId}-payment-adjustment`);
  fs.mkdirSync(folder, { recursive: true });
  const browser = (await launchBrowserWithGuard({ retryLimit: 1 })).browser;
  const abort = () => { void browser.close().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  evidence.browserReadbacks = []; evidence.browserErrors = [];
  try {
    for (const [instance, actor] of [actors.finance1, actors.finance2].entries()) {
      signal.throwIfAborted();
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
      page.on('pageerror', err => evidence.browserErrors.push(err.message));
      await page.addInitScript(({ token, user }) => {
        for (const k of ['token','auth_token','erp_auth_token']) localStorage.setItem(k, token);
        for (const k of ['user','currentUser','erp_current_user']) localStorage.setItem(k, JSON.stringify(user));
        localStorage.setItem('ailao.language', 'zh'); localStorage.setItem('language', 'zh-CN');
      }, { token: actor.token, user: { id: String(actor.id), name: actor.job || actor.role, role: actor.role, segment: 'mixed' } });
      await page.goto(`${urls[instance]}/#collections`, { waitUntil: 'domcontentloaded' });
      await page.locator('#loading').waitFor({ state: 'hidden' });
      await page.getByTestId('collection-tab-ledger').click(); await page.getByTestId('collection-ledger-search').fill(order.orderNo);
      await page.getByRole('button', { name: '显示或隐藏表格列', exact: true }).first().click();
      const columns = page.getByRole('dialog', { name: '选择要显示的表格列' });
      for (const label of ['收款单','金额','状态']) await columns.getByRole('checkbox', { name: `显示列：${label}`, exact: true }).setChecked(true);
      for (const label of ['订单号','客户','方式','录入时间']) await columns.getByRole('checkbox', { name: `显示列：${label}`, exact: true }).setChecked(false);
      await page.keyboard.press('Escape');
      await page.getByTestId(`collection-ledger-row-${originalPaymentId}`).getByText(`#${originalPaymentId}`, { exact: true }).click();
      const summary = page.getByTestId('collection-order-summary');
      const metric = summary.getByText('累计已收', { exact: true }).locator('..');
      const value = metric.getByText(/450\.00/); await expect(value).toBeVisible(); await metric.scrollIntoViewIfNeeded();
      const amountVisible = await value.evaluate(el => {
        const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
        return !!top && (top === el || el.contains(top));
      });
      assert(amountVisible, 'Correct canonical paid amount must be unobscured, not merely in hidden DOM');
      const file = path.join(folder, `finance-${instance + 1}-paid-450.png`); await page.screenshot({ path: file });
      evidence.browserReadbacks.push({ actorId: actor.id, instance, role: actor.role, orderId: order.id, paidAmount: 450,
        amountVisible, text: await metric.innerText(), path: file, font: await verifyRenderedCjk(page, '[data-testid="collection-order-summary"]') });
      await page.close();
    }
    assert.deepEqual(evidence.browserErrors, []);
  } finally { signal.removeEventListener('abort', abort); await browser.close(); }
}
module.exports = { paymentAdjustmentBrowser };
