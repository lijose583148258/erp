const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { expect } = require('playwright/test');
const { ensureReleasedMaterial } = require('./material-audit-fixture.cjs');
const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');
const { restartIsolatedApps } = require('./enterprise-round2-app-restart.cjs');
const { verifyPaymentEventProof } = require('./payment-event-proof.cjs');

async function paymentEventAuditProbe(ctx, signal) {
  const { request, dataOf, actors, prisma, runId, urls, reportPath } = ctx;
  const evidence = { scope: 'Real finance browser verification + signed HTTP consumer + actual dual-app process crash and expired-lease recovery; not DB-server restart',
    provider: process.env.AUDIT_PRISMA_PROVIDER || 'sqlite', browser: [], errors: [], screenshots: [] };
  const folder = path.join(path.dirname(reportPath), `${runId}-payment-event`); fs.mkdirSync(folder, { recursive: true });
  const receiverUrl = new URL(process.env.ROUND2_PAYMENT_RECEIVER_URL || '');
  assert.equal(receiverUrl.hostname, '127.0.0.1');
  const receiver = async (endpoint, data) => {
    const res = await fetch(`${receiverUrl.origin}${endpoint}`, { method: data === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${process.env.ROUND2_PAYMENT_RECEIVER_TOKEN}`, 'content-type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
    assert.equal(res.status, 200); return res.json();
  };
  const until = async (read, accepts, timeout = 45000) => {
    const end = Date.now() + timeout; let last;
    while (Date.now() < end) { signal.throwIfAborted(); last = await read(); if (accepts(last)) return last; await delay(100, undefined, { signal }); }
    const error = new Error('Payment event evidence deadline exceeded'); error.evidence = { ...evidence, last }; throw error;
  };
  const showLedgerColumns = async page => {
    await page.getByRole('button', { name: '显示或隐藏表格列', exact: true }).first().click();
    const columns = page.getByRole('dialog', { name: '选择要显示的表格列' });
    await columns.getByRole('checkbox', { name: '显示列：收款单', exact: true }).setChecked(true);
    await columns.getByRole('checkbox', { name: '显示列：金额', exact: true }).setChecked(true);
    await columns.getByRole('checkbox', { name: '显示列：状态', exact: true }).setChecked(true);
    for (const label of ['订单号', '客户', '方式', '录入时间']) await columns.getByRole('checkbox', { name: `显示列：${label}`, exact: true }).setChecked(false);
    await page.keyboard.press('Escape');
  };
  let browser; const pages = []; const frames = [[], []]; let paymentId, orderId;
  try {
    const customer = dataOf(await request('/customers', { method: 'POST', signal, data: {
      name: `${runId}-event-customer`, nameZh: `${runId}-event-customer`, creditLimit: 100000, termsDays: 30,
      segment: 'direct', poolState: 'private', salespersonId: actors.sales.id } }));
    const material = await ensureReleasedMaterial({ request: (endpoint, options) => request(endpoint, { ...options, signal }),
      code: `${runId}-event-material`, name: `${runId}-event-material`, category: 'finished_good', unit: 'kg' });
    const order = dataOf(await request('/orders', { actor: actors.sales, method: 'POST', signal, data: {
      customerId: Number(customer.id), items: [{ materialId: material.id, productName: material.nameZh, quantity: 10, unit: 'kg', unitPrice: 100 }], paymentTerms: 30 } }));
    orderId = Number(order.id);
    dataOf(await request(`/orders/${orderId}/payment`, { actor: actors.sales, method: 'POST', signal,
      data: { idempotencyKey: require('node:crypto').randomUUID(), amount: 300, method: 'bank_transfer', payerName: 'Event recovery fixture', note: runId } }));
    const pending = dataOf(await request(`/orders/${orderId}`, { actor: actors.finance1, signal }));
    paymentId = Number(pending.paymentRecords.find(p => p.status === 'pending').id);
    evidence.orderId = orderId; evidence.paymentId = paymentId;
    await receiver('/arm', { paymentId });
    browser = (await launchBrowserWithGuard({ retryLimit: 1 })).browser;
    const abort = () => { void browser.close().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
    evidence.abort = abort;
    for (const [index, actor] of [actors.finance1, actors.finance2].entries()) {
      assert.equal(actor.role, 'finance');
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); pages.push(page);
      page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
      page.on('pageerror', error => evidence.errors.push(error.message));
      page.on('websocket', socket => socket.on('framereceived', frame => {
        try { const event = JSON.parse(String(frame.payload)); if (event.type === 'payment.verified' && Number(event.resourceId) === paymentId) frames[index].push(event); } catch {}
      }));
      await page.addInitScript(({ token, user }) => {
        for (const key of ['token', 'auth_token', 'erp_auth_token']) localStorage.setItem(key, token);
        for (const key of ['user', 'currentUser', 'erp_current_user']) localStorage.setItem(key, JSON.stringify(user));
        localStorage.setItem('ailao.language', 'zh'); localStorage.setItem('language', 'zh-CN');
      }, { token: actor.token, user: { id: String(actor.id), name: actor.job, role: actor.role, segment: 'mixed' } });
      await page.goto(`${urls[index]}/#collections`, { waitUntil: 'domcontentloaded' });
      await page.locator('#loading').waitFor({ state: 'hidden' });
      await page.getByTestId('collection-tab-ledger').click();
      await page.getByTestId('collection-ledger-search').fill(order.orderNo);
      await showLedgerColumns(page);
      await page.getByTestId(`collection-ledger-row-${paymentId}`).getByText(`#${paymentId}`, { exact: true }).click();
      const pendingCard = page.getByTestId(`collection-payment-detail-${paymentId}`);
      await pendingCard.scrollIntoViewIfNeeded(); await expect(pendingCard).toContainText('待核销');
      await expect(page.getByTestId(`collection-ledger-verify-${paymentId}`)).toBeVisible();
      evidence.browser.push({ actorId: actor.id, role: actor.role, instance: index, pendingVisible: true });
    }
    const response = pages[0].waitForResponse(res => new URL(res.url()).pathname === `/api/collections/payments/${paymentId}/verify` && res.request().method() === 'POST');
    await pages[0].getByTestId(`collection-ledger-verify-${paymentId}`).click();
    const first = await response; assert.equal(first.status(), 200); evidence.browserVerification = { httpStatus: first.status(), entry: 'collections', actorId: actors.finance1.id };
    const replay = await request(`/orders/${orderId}/payment/${paymentId}/verify`, { actor: actors.finance2, instance: 1, method: 'POST', signal });
    assert.equal(replay.status, 200);
    const snapshot = async () => ({
      payment: await prisma.paymentRecord.findUnique({ where: { id: paymentId } }),
      order: await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, paidAmount: true, paymentStatus: true } }),
      audits: await prisma.auditLog.findMany({ where: { resource: 'payment', resourceId: paymentId, action: 'PAYMENT_VERIFIED' }, orderBy: { id: 'asc' } }),
      events: await prisma.businessEvent.findMany({ where: { eventKey: `payment.verified:${paymentId}` }, orderBy: { id: 'asc' } }),
    });
    const beforeCrash = await snapshot(); evidence.beforeSnapshot = beforeCrash;
    assert.equal(beforeCrash.events.length, 1); assert.equal(beforeCrash.audits.length, 1);
    const event = JSON.parse(beforeCrash.events[0].payloadJson);
    assert.equal(event.data.auditId, beforeCrash.audits[0].id); assert.equal(JSON.parse(beforeCrash.audits[0].details).eventId, event.id);
    const webhook = async () => prisma.businessEventDelivery.findFirst({ where: { eventId: beforeCrash.events[0].id, channel: 'webhook' } });
    evidence.acceptedBeforeCrash = await until(() => receiver('/state'), s => s.target?.phase === 'accepted-awaiting-ack');
    evidence.claimBeforeCrash = await webhook(); assert.equal(evidence.claimBeforeCrash.status, 'sending');
    assert(new Date(evidence.claimBeforeCrash.leaseExpiresAt).getTime() > Date.now());
    evidence.restart = await restartIsolatedApps(urls, signal, async () => {
      const afterKill = await webhook(); evidence.claimAfterKill = afterKill;
      assert.equal(afterKill.status, 'sending', 'No durable acknowledgement may be written before the forced crash');
      assert.equal(afterKill.leaseToken, evidence.claimBeforeCrash.leaseToken);
      await receiver('/release', {});
    });
    evidence.deliveryAfterRecovery = await until(webhook, row => row?.status === 'delivered', 60000);
    assert(evidence.deliveryAfterRecovery.attempts >= 3);
    evidence.receiver = await receiver('/state');
    const attempts = evidence.receiver.attempts;
    assert.equal(attempts[0].status, 503); assert(attempts.some(a => a.status === 'ack-withheld')); assert(attempts.some(a => a.status === 202));
    assert(attempts.every(a => a.eventId === event.id && a.digest === attempts[0].digest && a.signatureValid));
    assert.equal(evidence.receiver.accepted.length, 1); assert.equal(evidence.receiver.accepted[0].effects, 1); assert.equal(evidence.receiver.accepted[0].amount, 300);
    evidence.crossEntryReplays = [];
    for (let index = 0; index < 8; index++) {
      const endpoint = index % 2 ? `/collections/payments/${paymentId}/verify` : `/orders/${orderId}/payment/${paymentId}/verify`;
      const result = await request(endpoint, { actor: index % 2 ? actors.finance2 : actors.finance1, instance: index % 2, method: 'POST', signal });
      assert.equal(result.status, 200); evidence.crossEntryReplays.push({ entry: index % 2 ? 'collections' : 'orders', instance: index % 2, httpStatus: result.status });
    }
    const after = await snapshot(); assert.deepEqual(after, beforeCrash, 'Replays/recovery must not change financial facts or historical audit/payload');
    assert.equal(Number(after.order.paidAmount), 300); assert.equal(after.order.paymentStatus, 'partial'); assert.equal(after.payment.status, 'verified');
    evidence.finalSnapshot = after;
    evidence.apiReadbacks = await Promise.all(urls.map(async (_, instance) => {
      const row = dataOf(await request(`/orders/${orderId}`, { actor: actors.finance2, instance, signal }));
      assert.equal(Number(row.paidAmount), 300); assert.equal(row.paymentRecords.length, 1); assert.equal(row.paymentRecords[0].status, 'verified');
      return { instance, orderId, paidAmount: row.paidAmount, paymentStatus: row.paymentStatus, paymentCount: row.paymentRecords.length };
    }));
    for (const [index, page] of pages.entries()) {
      await page.reload(); await page.locator('#loading').waitFor({ state: 'hidden' });
      await page.getByTestId('collection-tab-ledger').click(); await page.getByTestId('collection-ledger-search').fill(order.orderNo);
      await showLedgerColumns(page);
      await page.getByTestId(`collection-ledger-row-${paymentId}`).getByText(`#${paymentId}`, { exact: true }).click();
      const row = page.getByTestId(`collection-payment-detail-${paymentId}`); await expect(row).toContainText('已核销');
      await expect(row).toContainText('300'); await expect(page.getByTestId(`collection-ledger-verify-${paymentId}`)).toHaveCount(0);
      await row.scrollIntoViewIfNeeded();
      const statusCell = row.getByText('已核销', { exact: true });
      const amountCell = row.getByText(/300\.00/).first();
      await expect(statusCell).toBeVisible(); await expect(amountCell).toBeVisible();
      const hit = el => { const r=el.getBoundingClientRect(), top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return !!top&&(top===el||el.contains(top)); };
      const statusVisible = await statusCell.evaluate(hit), amountVisible = await amountCell.evaluate(hit);
      assert(statusVisible && amountVisible, 'The actual amount/status cells must not be clipped or covered');
      const visible = await row.evaluate(el => { const r=el.getBoundingClientRect(), top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return !!top&&(top===el||el.contains(top)); });
      assert(visible); const font = await verifyRenderedCjk(page, `[data-testid="collection-payment-detail-${paymentId}"]`);
      const name = `finance-${index + 1}-recovered.png`; await page.screenshot({ path: path.join(folder, name) });
      evidence.screenshots.push({ path: path.join(folder, name), unobscured: visible, statusVisible, amountVisible, loadingHidden: true, font, text: await row.innerText(), actorId: evidence.browser[index].actorId });
    }
    evidence.frames = frames.map(items => items.map(e => ({ id: e.id, type: e.type, resourceId: e.resourceId })));
    if (evidence.provider === 'postgresql') assert(frames.every(items => items.length === 1 && items[0].id === event.id), 'Shared bus must notify both independent finance sessions exactly once');
    else assert.equal(frames.flat().filter(e => e.id === event.id).length, 1, 'Local memory bus scope is one instance, not a distributed bus claim');
    evidence.deliveryReceipts = await prisma.businessEventDelivery.findMany({ where: { eventId: beforeCrash.events[0].id }, orderBy: { id: 'asc' } });
    assert.equal(evidence.errors.length, 0); evidence.proof = verifyPaymentEventProof(evidence, evidence.provider); return evidence;
  } catch (error) { error.evidence ||= evidence; throw error; }
  finally {
    if (evidence.abort) { signal.removeEventListener('abort', evidence.abort); delete evidence.abort; }
    if (paymentId) await receiver('/release', {}).catch(() => {});
    if (browser) await browser.close();
    fs.writeFileSync(path.join(folder, 'evidence.json'), JSON.stringify(evidence, null, 2));
  }
}
module.exports = { paymentEventAuditProbe };
