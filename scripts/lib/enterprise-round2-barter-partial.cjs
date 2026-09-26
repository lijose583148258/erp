const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('playwright/test');
const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');
const cents = value => Math.round(Number(value) * 100);
const total = (rows, key) => rows.reduce((sum, row) => sum + Number(row[key]), 0);

function assertPartialBarterStage(stage, expected) {
  const { label, readbacks, persisted, paid, ourStock, received } = stage;
  const { executed, remaining, outgoingStock, incomingStock, verifiedPayments, status } = expected;
  assert.equal(readbacks.length, 2, 'Both application instances must be read');
  for (const row of [...readbacks, persisted]) {
    assert.equal(row.status, status, `${label}: agreement status`);
    assert.equal(cents(row.executedOffsetAmount), cents(executed));
    assert.equal(cents(row.remainingOffsetAmount), cents(remaining));
    assert.equal(cents(row.agreedOffsetAmount), cents(2000));
  }
  assert.equal(cents(paid.paidAmount), cents(executed));
  assert.equal(paid.paymentStatus, remaining ? 'partial' : 'paid');
  const payments = paid.paymentRecords.filter(row => row.status === 'verified');
  assert.equal(payments.length, verifiedPayments);
  assert.equal(cents(total(payments, 'amount')), cents(executed));
  for (const [state, quantity] of [[ourStock, outgoingStock], [received, incomingStock]]) {
    assert(state.balances.length > 0 && state.costs.length > 0 && state.movements.length > 0, 'Missing inventory evidence');
    assert.equal(total(state.balances, 'quantity'), quantity);
    assert.equal(Number(state.batch?.stockQuantity), quantity);
    assert.equal(total(state.costs, 'quantityDelta'), quantity);
    assert.equal(cents(total(state.costs, 'costAmountDelta')), cents(quantity * 10));
    assert(state.balances.every(row => row.quantity >= 0));
    assert.equal(state.apiBalances.length, 2);
    assert(state.apiBalances.every(rows => rows.length > 0 && total(rows, 'quantity') === quantity));
    assert(state.balances.every(row => total(state.movements.filter(m => m.stockBalanceId === row.id), 'quantityDelta') === row.quantity));
  }
}

async function barterPartialFulfillmentProbe(ctx, signal) {
  const { request, dataOf, actors, prisma, runId, stockFixture, readStock, customer, verify, ensureReleasedMaterial } = ctx;
  const call = async (endpoint, method = 'GET', data, actor = actors.sales, instance = 0) =>
    dataOf(await request(endpoint, { method, data, actor, instance, signal }));
  const our = await stockFixture('barter-partial', signal);
  const incoming = await ensureReleasedMaterial({ request: (endpoint, options) => request(endpoint, { ...options, signal }),
    code: `${runId}-partial-raw`, name: `${runId}-partial-raw`, category: 'raw_material', unit: 'kg' });
  const warehouses = await call('/warehouses', 'GET', undefined, actors.admin);
  if (!warehouses.flatMap(row => row.locations || []).some(row => row.code === 'LOC-RAW')) {
    await call(`/warehouses/${our.destination.warehouseId}/locations`, 'POST',
      { code: 'LOC-RAW', name: 'Round2 raw material', type: 'internal' }, actors.admin);
  }
  const buyer = await customer(signal);
  const order = await call('/orders', 'POST', { customerId: buyer.id, paymentTerms: 30,
    items: [{ materialId: our.material.id, productName: our.material.nameZh, quantity: 100, unit: 'kg', unitPrice: 20 }] });
  const incomingBatch = `${runId}-partial-incoming`;
  const items = quantity => [
    { side: 'our', materialId: our.material.id, itemName: our.material.nameZh, quantity, unit: 'kg', unitPrice: 20, sourceDocument: our.batchNo },
    { side: 'counterparty', materialId: incoming.id, itemName: incoming.nameZh, quantity: quantity * 2, unit: 'kg', unitPrice: 10, sourceDocument: incomingBatch },
  ];
  const agreement = await call('/barter/agreements', 'POST', { customerId: buyer.id, orderId: order.id,
    counterpartyType: 'customer', counterpartyName: buyer.name, settlementMode: 'barter', currency: 'CNY',
    items: items(100), note: `${runId}-partial-agreement` });
  const batches = [];
  const evidence = { scope: 'Actual API agreement execution in 40/60 batches, reversal and replacement; browser writes and negative cash adjustment are separate obligations',
    agreementId: agreement.id, orderId: order.id, stages: [], replays: [] };
  let browser;
  let page;
  const abortBrowser = () => { void browser?.close().catch(() => {}); };
  signal.addEventListener('abort', abortBrowser, { once: true });
  async function browserReadback(label, executed, remaining, status) {
    if (process.env.ROUND2_BROWSER !== 'true') return;
    if (!browser) {
      browser = (await launchBrowserWithGuard({ launchTimeoutMs: 15000, totalTimeoutMs: 30000, maxAttemptsPerStrategy: 1 })).browser;
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      evidence.browserRequests = [];
      evidence.browserErrors = [];
      page.on('request', request => {
        if (new URL(request.url()).pathname.startsWith('/api/')) evidence.browserRequests.push(new URL(request.url()).pathname);
      });
      page.on('response', response => {
        if (response.status() >= 400) evidence.browserErrors.push({ url: new URL(response.url()).pathname, status: response.status() });
      });
      page.on('pageerror', error => evidence.browserErrors.push({ message: error.message }));
      page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
      await page.addInitScript(({ token, user }) => {
        for (const key of ['token', 'auth_token', 'erp_auth_token']) localStorage.setItem(key, token);
        for (const key of ['user', 'currentUser', 'erp_current_user']) localStorage.setItem(key, JSON.stringify(user));
        localStorage.setItem('erp_current_role', user.role); localStorage.setItem('ailao.activeTab', 'barter');
        localStorage.setItem('ailao.language', 'zh'); localStorage.setItem('language', 'zh-CN');
      }, { token: actors.finance1.token, user: { id: String(actors.finance1.id), name: actors.finance1.job, role: actors.finance1.role, segment: 'mixed' } });
      await page.goto(`${ctx.urls[1]}/#barter`);
    } else await page.reload();
    await page.locator('#loading').waitFor({ state: 'hidden' });
    const card = page.getByRole('button').filter({ hasText: agreement.agreementNo });
    await expect(card).toContainText(status === 'partial' ? '部分完成' : '已完成');
    await expect(page.getByRole('button', { name: '创建协议', exact: true })).toBeDisabled();
    await expect(page.getByLabel('货抵协议客户', { exact: true })).toBeDisabled();
    assert(!evidence.browserRequests.includes('/api/customers'), 'Finance must not request the unauthorized customer catalog');
    assert.deepEqual(evidence.browserErrors, [], 'Finance barter UI must not hide failed reads');
    const text = (await card.innerText()).replace(/[,\s]/g, '');
    assert(text.includes(`已抵¥${executed.toFixed(2)}`) || new RegExp(`已抵[^0-9]*${executed}(?:\\.00)?待抵`).test(text), text);
    assert(new RegExp(`待抵[^0-9]*${remaining}(?:\\.00)?批次`).test(text), text);
    await card.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
    const hit = await card.evaluate(element => { const r = element.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!top && element.contains(top); });
    assert(hit, 'Barter agreement readback is covered');
    const folder = path.join(path.dirname(ctx.reportPath), `${runId}-barter-partial`);
    fs.mkdirSync(folder, { recursive: true });
    const screenshot = path.join(folder, `${evidence.stages.length}-${status}.png`);
    const fonts = await verifyRenderedCjk(page, `button:has-text("${agreement.agreementNo}")`);
    await page.screenshot({ path: screenshot });
    (evidence.browser ||= []).push({ label, text, screenshot, fonts, scope: 'Real finance-role UI readback; mutations used API' });
  }
  async function snapshot(label, executed, remaining, outgoingStock, incomingStock, verifiedPayments, status) {
    const [readbacks, persisted, paid, ourStock, received] = await Promise.all([
      Promise.all([0, 1].map(instance => call(`/barter/agreements/${agreement.id}`, 'GET', undefined, actors.finance1, instance))),
      prisma.barterAgreement.findUnique({ where: { id: agreement.id }, include: { settlements: { include: { offsetPostings: true, reversalLogs: true } } } }),
      prisma.order.findUnique({ where: { id: order.id }, include: { paymentRecords: true } }),
      readStock(our, signal), readStock({ material: incoming, batchNo: incomingBatch }, signal),
    ]);
    const stage = { label, readbacks, persisted, paid, ourStock, received };
    evidence.stages.push(stage);
    try {
      assertPartialBarterStage(stage, { executed, remaining, outgoingStock, incomingStock, verifiedPayments, status });
    } catch (error) { error.evidence = evidence; throw error; }
    await browserReadback(label, executed, remaining, status);
    return stage;
  }
  async function postBatch(quantity, label) {
    const batch = await call(`/barter/agreements/${agreement.id}/batches`, 'POST', { items: items(quantity), note: `${runId}-${label}` });
    batches.push(batch);
    await call(`/barter/settlements/${batch.id}/approve`, 'PATCH', { note: label }, actors.admin);
    await call(`/barter/settlements/${batch.id}/post`, 'POST', { postingAmount: quantity * 20, note: label }, actors.finance1);
    const replay = await request(`/barter/settlements/${batch.id}/post`, { actor: actors.finance2, instance: 1, method: 'POST', signal,
      data: { postingAmount: quantity * 20, note: label } });
    evidence.replays.push({ batchId: batch.id, status: replay.status });
    assert.equal(replay.status, 409);
    return batch;
  }
  try {
  await postBatch(40, 'partial-first');
  await snapshot('40 percent posted', 800, 1200, 60, 80, 1, 'partial');
  const second = await postBatch(60, 'partial-second');
  await snapshot('all batches posted', 2000, 0, 0, 200, 2, 'completed');
  await call(`/barter/settlements/${second.id}/reverse`, 'POST', { reason: 'Round2 reverse second batch only' }, actors.finance2, 1);
  const reversed = await snapshot('second batch reversed, first preserved', 800, 1200, 60, 80, 1, 'partial');
  assert.equal(reversed.persisted.settlements.find(row => row.id === second.id).reversalLogs.length, 1);
  await postBatch(60, 'partial-replacement');
  const final = await snapshot('replacement closes remainder', 2000, 0, 0, 200, 2, 'completed');
  return verify({
    agreement_partial_then_complete: true, second_batch_reversal_reopens_remainder: true,
    earlier_batch_preserved: final.persisted.settlements.find(row => row.id === batches[0].id).status === 'posted',
    exactly_two_live_postings_and_one_retained_reversal: final.persisted.settlements.filter(row => row.status === 'posted').length === 2
      && final.persisted.settlements.filter(row => row.status === 'reversed').length === 1,
    quantities_and_carrying_costs_reconcile_at_all_four_stages: true,
    replay_does_not_duplicate_posting: final.persisted.settlements.every(row => row.offsetPostings.length === 1),
    exactly_three_goods_exchanges_and_one_reversal: final.ourStock.entries.filter(row => row.sourceType === 'barter_issue').length === 3
      && final.received.entries.filter(row => row.sourceType === 'barter_receipt').length === 3
      && final.ourStock.entries.filter(row => row.sourceType === 'barter_issue_reversal').length === 1
      && final.received.entries.filter(row => row.sourceType === 'barter_receipt_reversal').length === 1,
  }, evidence);
  } catch (error) {
    if (page) {
      const folder = path.join(path.dirname(ctx.reportPath), `${runId}-barter-partial`);
      fs.mkdirSync(folder, { recursive: true });
      evidence.failureScreenshot = path.join(folder, 'failure.png');
      await page.screenshot({ path: evidence.failureScreenshot }).catch(() => {});
    }
    error.evidence ||= evidence; throw error;
  }
  finally { signal.removeEventListener('abort', abortBrowser); await browser?.close(); }
}

module.exports = { barterPartialFulfillmentProbe, assertPartialBarterStage };
