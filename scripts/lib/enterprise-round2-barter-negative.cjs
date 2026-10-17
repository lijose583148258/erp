const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { synchronizedBurst } = require('./enterprise-round2-runner.cjs');

async function barterNegativeCashProbe(ctx, signal) {
  const { request, dataOf, actors, prisma, barterFixture, readBarter, runId, urls, reportPath } = ctx;
  const evidence = { scope: 'Full original-currency external refund registration; no bank transfer, credit balance, partial refund or legacy reconciliation', cases: [] };
  let browser, page;
  const abort = () => { void browser?.close().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const call = async (url, method = 'GET', data, actor = actors.finance1, instance = 0) =>
    dataOf(await request(url, { method, data, actor, instance, signal }));
  const proof = suffix => ({ amount: 50, currency: 'CNY', requestKey: crypto.randomUUID(), paymentReference: `${runId}-${suffix}`,
    paymentDate: new Date().toISOString().slice(0, 10), note: '隔离测试退款凭证；没有实际银行付款' });
  async function fixture(label, agreement = false) {
    const f = await barterFixture(label, 'negative', signal, { agreement });
    await call(`/barter/settlements/${f.settlement.id}/post`, 'POST', { postingAmount: 200 });
    const row = await prisma.barterCashObligation.findUnique({ where: { settlementId: f.settlement.id } });
    assert.equal(row.amount, 50); assert.equal(row.currency, 'CNY'); assert.equal(row.status, 'open');
    assert.equal(row.ownerId, actors.finance1.id);
    return f;
  }
  async function snapshot(f) {
    return { business: await readBarter(f, signal),
      liability: await prisma.barterCashObligation.findUnique({ where: { settlementId: f.settlement.id } }),
      api: await Promise.all([0, 1].map(instance => call(`/barter/settlements/${f.settlement.id}`, 'GET', undefined, actors.finance1, instance))),
    };
  }
  const refund = (f, payload, actor = actors.finance1, instance = 0) => request(`/barter/settlements/${f.settlement.id}/refund`, { method: 'POST', data: payload, actor, instance, signal });
  const reverse = (f, actor = actors.finance2, instance = 1) => request(`/barter/settlements/${f.settlement.id}/reverse`, { method: 'POST', data: { reason: 'isolated negative-cash reversal' }, actor, instance, signal });
  function unchangedBusiness(before, after) {
    // The cash register must never change receipt amount, stock, batch or cost ledger.
    assert.deepEqual(after.business.order, before.business.order);
    assert.deepEqual(after.business.our, before.business.our);
    assert.deepEqual(after.business.incoming, before.business.incoming);
  }
  try {
    const a = await fixture('negative-ui', true);
    const before = await snapshot(a); const payment = proof('refund-ui');
    assert.equal(before.business.incoming.costs.reduce((sum, row) => sum + row.costAmountDelta, 0), 250);
    assert.equal(before.business.order.paidAmount, 200);
    assert.equal((await refund(a, payment, actors.sales)).status, 403);
    assert.equal((await refund(a, { ...payment, amount: 49 })).status, 409);
    assert.equal((await refund(a, { ...payment, currency: 'USD' })).status, 409);
    assert.equal((await refund(a, { ...payment, paymentReference: '' })).status, 400);
    if (process.env.ROUND2_BROWSER === 'true') {
      const { expect } = require('playwright/test');
      const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
      const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');
      browser = (await launchBrowserWithGuard({ launchTimeoutMs: 15000, totalTimeoutMs: 30000, maxAttemptsPerStrategy: 1 })).browser;
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
      await page.addInitScript(({ token, user }) => {
        for (const key of ['token', 'auth_token', 'erp_auth_token']) localStorage.setItem(key, token);
        for (const key of ['user', 'currentUser', 'erp_current_user']) localStorage.setItem(key, JSON.stringify(user));
      }, { token: actors.finance1.token, user: { id: String(actors.finance1.id), name: actors.finance1.job, role: 'finance', segment: 'mixed' } });
      await page.goto(`${urls[1]}/#barter`);
      await page.locator('#loading').waitFor({ state: 'hidden' });
      const card = page.getByRole('button').filter({ hasText: a.agreement.agreementNo });
      await expect(card).toContainText('差额待处理'); await card.click();
      await page.getByRole('tab', { name: /审批过账/ }).click();
      const cash = page.getByTestId(`barter-cash-${a.settlement.id}`);
      await expect(cash).toContainText('CNY 50.00');
      await cash.getByRole('button', { name: '登记已完成退款', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '登记已完成退款' });
      await dialog.getByLabel('退款凭证编号', { exact: true }).fill(payment.paymentReference);
      await dialog.getByLabel('实际退款日期', { exact: true }).fill(payment.paymentDate);
      await dialog.getByLabel('退款核对说明', { exact: true }).fill(payment.note);
      await dialog.getByRole('checkbox').check();
      const route = `**/api/barter/settlements/${a.settlement.id}/refund`;
      const submissions = [];
      await page.route(route, async r => {
        submissions.push(r.request().postDataJSON());
        if (submissions.length === 1) {
          const response = await r.fetch(); assert.equal(response.status(), 200);
          await r.abort('failed'); // Server committed, client lost its response.
        } else await r.continue();
      });
      await dialog.getByRole('button', { name: '确认登记退款', exact: true }).dblclick();
      await expect(dialog.getByRole('alert')).toBeVisible();
      assert.equal((await snapshot(a)).liability.status, 'settled');
      await expect(dialog.getByLabel('退款凭证编号', { exact: true })).toBeDisabled();
      await dialog.getByRole('button', { name: '按原凭证重试', exact: true }).click();
      await expect(dialog.getByRole('status')).toContainText('退款凭证已登记');
      assert.equal(submissions.length, 2); assert.deepEqual(submissions[0], submissions[1]);
      payment.requestKey = submissions[0].requestKey;
      await page.unroute(route);
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(cash).toContainText(`已登记退款 · ${payment.paymentReference}`);
      await cash.scrollIntoViewIfNeeded();
      const folder = path.join(path.dirname(reportPath), `${runId}-negative-cash`); fs.mkdirSync(folder, { recursive: true });
      evidence.screenshot = path.join(folder, 'refund-recorded.png');
      evidence.fonts = await verifyRenderedCjk(page, `[data-testid="barter-cash-${a.settlement.id}"]`);
      await page.screenshot({ path: evidence.screenshot });
      evidence.browser = { submissions: submissions.length, lostResponseReplayedWithSameKey: true };
    } else dataOf(await refund(a, payment));
    const after = await snapshot(a); unchangedBusiness(before, after);
    assert(after.api.every(row => row.cashObligation?.status === 'settled'));
    assert.equal((await call(`/barter/agreements/${a.agreement.id}`)).hasPendingRefund, false);
    assert.equal((await reverse(a)).status, 409);
    assert.equal((await refund(a, { ...payment, note: 'different proof' })).status, 409);
    const audits = await prisma.auditLog.findMany({ where: { resource: 'barter_cash_obligation', resourceId: after.liability.id } });
    assert.equal(audits.length, 1);
    evidence.cases.push({ name: 'UI response loss + exact replay', before, after, audits });

    const b = await fixture('negative-race'); const beforeB = await snapshot(b);
    // Reusing the first bank reference for a different obligation must roll back.
    assert.equal((await refund(b, { ...payment, requestKey: crypto.randomUUID() })).status, 409);
    assert.equal((await snapshot(b)).liability.status, 'open');
    const payments = [proof('buyer-a'), proof('buyer-b')];
    const race = await synchronizedBurst([actors.finance1, actors.finance2], async actor => {
      const index = actor.id === actors.finance1.id ? 0 : 1;
      return { index, status: (await refund(b, payments[index], actor, index)).status };
    }, signal);
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
    const afterB = await snapshot(b); unchangedBusiness(beforeB, afterB);
    assert.equal(afterB.liability.status, 'settled');
    assert.equal(await prisma.auditLog.count({ where: { resource: 'barter_cash_obligation', resourceId: afterB.liability.id } }), 1);
    evidence.cases.push({ name: 'two finance actors + duplicate reference', race, before: beforeB, after: afterB });

    const c = await fixture('negative-void'); dataOf(await reverse(c));
    const voided = await snapshot(c);
    assert.equal(voided.liability.status, 'void'); assert.equal(voided.business.order.paidAmount, 0);
    assert.equal(voided.business.our.balances.reduce((s, r) => s + r.quantity, 0), 100);
    assert.equal(voided.business.incoming.balances.reduce((s, r) => s + r.quantity, 0), 0);
    assert.equal(voided.business.our.costs.reduce((s, r) => s + r.costAmountDelta, 0), 1000);
    assert.equal(voided.business.incoming.costs.reduce((s, r) => s + r.costAmountDelta, 0), 0);
    assert.equal((await refund(c, proof('voided'))).status, 409);
    evidence.cases.push({ name: 'open responsibility reverses with goods', state: voided });

    const d = await fixture('negative-reverse-race');
    const collision = await synchronizedBurst([actors.finance1, actors.finance2], async actor => ({
      status: (await (actor.id === actors.finance1.id ? refund(d, proof('race-reverse')) : reverse(d))).status,
    }), signal);
    assert.deepEqual(collision.map(r => r.status).sort(), [200, 409]);
    const final = await snapshot(d);
    assert(['settled', 'void'].includes(final.liability.status));
    assert.equal(final.business.settlement.status, final.liability.status === 'void' ? 'reversed' : 'posted');
    assert.equal(final.business.order.paidAmount, final.liability.status === 'void' ? 0 : 200);
    assert(final.api.every(r => r.cashObligation.status === final.liability.status));
    const isVoid = final.liability.status === 'void';
    for (const [stock, quantity, value] of [[final.business.our, isVoid ? 100 : 90, isVoid ? 1000 : 900],
      [final.business.incoming, isVoid ? 0 : 20, isVoid ? 0 : 250]]) {
      assert.equal(stock.balances.reduce((s, r) => s + r.quantity, 0), quantity);
      assert.equal(stock.batch.stockQuantity, quantity);
      assert.equal(stock.costs.reduce((s, r) => s + r.costAmountDelta, 0), value);
      assert.equal(stock.apiBalances.length, 2);
      assert(stock.apiBalances.every(rows => rows.reduce((s, r) => s + r.quantity, 0) === quantity));
    }
    assert.equal(await prisma.auditLog.count({ where: { resource: 'barter_cash_obligation', resourceId: final.liability.id } }), isVoid ? 0 : 1);
    evidence.cases.push({ name: 'refund competes with reversal', collision, state: final });

    const fx = await barterFixture('negative-currency', 'negative', signal, { currency: 'USD' });
    const beforeFx = await snapshot(fx);
    assert.equal(beforeFx.business.order.currency, 'CNY');
    const rejected = await request(`/barter/settlements/${fx.settlement.id}/post`, {
      method: 'POST', data: { postingAmount: 200 }, actor: actors.finance1, signal,
    });
    assert.equal(rejected.status, 409);
    const afterFx = await snapshot(fx); unchangedBusiness(beforeFx, afterFx);
    assert.equal(afterFx.liability, null); assert.equal(afterFx.business.settlement.status, 'approved');
    assert.deepEqual(afterFx.business.settlement, beforeFx.business.settlement);
    evidence.cases.push({ name: 'cross-currency negative posting rejected without side effects', status: rejected.status, before: beforeFx, after: afterFx });
    return evidence;
  } catch (error) {
    if (page) { evidence.failureScreenshot = path.join(path.dirname(reportPath), 'negative-cash-failure.png'); await page.screenshot({ path: evidence.failureScreenshot }).catch(() => {}); }
    error.evidence ||= evidence; throw error;
  } finally { signal.removeEventListener('abort', abort); await browser?.close(); }
}
module.exports = { barterNegativeCashProbe };
