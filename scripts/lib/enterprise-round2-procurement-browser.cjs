const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ensureReleasedMaterial } = require('./material-audit-fixture.cjs');
const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');

async function purchaseRevisionBrowser({ request, dataOf, actors, prisma, runId, urls, reportPath }, signal) {
  const folder = path.join(path.dirname(reportPath), `${runId}-purchase-browser`);
  fs.mkdirSync(folder, { recursive: true });
  const material = await ensureReleasedMaterial({ request: (endpoint, options) => request(endpoint, { ...options, signal }),
    code: `${runId}-po-ui`, name: `${runId}-po-ui`, category: 'raw_material', unit: 'kg' });
  const supplier = dataOf(await request('/procurement/suppliers', { actor: actors.buyer1, method: 'POST', signal,
    data: { name: `${runId}-po-ui-supplier`, category: 'Raw Materials', contact: 'Synthetic' } }));
  const order = dataOf(await request('/procurement/orders', { actor: actors.buyer1, method: 'POST', signal,
    data: { supplierId: Number(supplier.id), materialId: material.id, item: material.nameZh, quantity: 100, price: 10,
      unit: 'kg', eta: '2026-10-01', status: 'approved' } }));
  const steps = [];
  const launched = await launchBrowserWithGuard({ recordStep: entry => steps.push(entry), retryLimit: 1 }).catch(error => {
    error.evidence = { folder, orderId: order.id, steps }; throw error;
  });
  const browser = launched.browser;
  const pages = [];
  const runtimeErrors = [];
  const fontEvidence = [];
  const abort = () => { void browser.close().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const read = async instance => dataOf(await request(`/procurement/orders/${order.id}/revisions`, { actor: actors.buyer1, instance, signal }));
  async function clickWrite(page, testId, suffix) {
    const response = page.waitForResponse(res => new URL(res.url()).pathname.endsWith(`/procurement/orders/${order.id}${suffix}`)
      && res.request().method() === 'PATCH');
    await page.getByTestId(testId).click();
    const result = await response;
    return { status: result.status(), body: await result.json() };
  }
  try {
    signal.throwIfAborted();
    for (const [index, actor] of [actors.buyer1, actors.buyer2].entries()) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
      page.on('pageerror', error => runtimeErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error' && !/409|Conflict/.test(message.text())) runtimeErrors.push(message.text()); });
      pages.push(page);
      await page.addInitScript(({ token, user }) => {
        for (const key of ['token', 'auth_token', 'erp_auth_token']) localStorage.setItem(key, token);
        for (const key of ['user', 'currentUser', 'erp_current_user']) localStorage.setItem(key, JSON.stringify(user));
        localStorage.setItem('erp_current_role', user.role); localStorage.setItem('ailao.activeTab', 'procurement');
        localStorage.setItem('ailao.language', 'zh'); localStorage.setItem('language', 'zh-CN');
      }, { token: actor.token, user: { id: String(actor.id), name: actor.job, role: actor.role, segment: 'mixed' } });
      await page.goto(`${urls[index]}/#procurement`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('procurement-desk-orders').click();
      await page.getByTestId(`purchase-order-revise-${order.id}`).click();
      await page.getByTestId('purchase-revision-dialog').waitFor();
      fontEvidence.push(await verifyRenderedCjk(page, '#purchase-revision-title'));
      await page.getByTestId('purchase-revision-quantity').fill(index ? '80' : '120');
      await page.getByTestId('purchase-revision-price').fill(index ? '9' : '11');
      await page.getByTestId('purchase-revision-reason').fill(index ? '采购员乙协商变更' : '采购员甲协商变更');
    }
    const first = await clickWrite(pages[0], 'purchase-revision-save', '');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    await pages[0].getByTestId('purchase-revision-saved').waitFor();
    const stale = await clickWrite(pages[1], 'purchase-revision-save', '');
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    await pages[1].getByTestId('purchase-revision-conflict').waitFor();
    assert.equal(await pages[1].getByTestId('purchase-revision-quantity').inputValue(), '80');
    assert(await pages[1].getByTestId('purchase-revision-save').isDisabled());
    const conflictText = await pages[1].getByTestId('purchase-revision-conflict').innerText();
    assert(conflictText.includes('120') && conflictText.includes('80') && conflictText.includes('未覆盖'));
    await pages[1].screenshot({ path: path.join(folder, 'conflict.png') });
    const afterConflict = await read(1);
    assert.equal(afterConflict.purchaseOrder.revision, 1);
    assert.equal(afterConflict.purchaseOrder.status, 'pending');
    await pages[1].getByTestId('purchase-revision-rebase').click();
    const rebased = await clickWrite(pages[1], 'purchase-revision-save', '');
    assert.equal(rebased.status, 200, JSON.stringify(rebased.body));
    await pages[1].getByTestId('purchase-revision-saved').waitFor();
    await pages[1].getByTestId('purchase-revision-close').click();
    const approval = await clickWrite(pages[1], `purchase-order-approve-${order.id}`, '/status');
    assert.equal(approval.status, 200, JSON.stringify(approval.body));
    await pages[1].getByTestId(`purchase-order-dispatch-${order.id}`).waitFor();
    await pages[1].getByTestId(`purchase-order-revise-${order.id}`).click();
    await pages[1].getByTestId('purchase-revision-history').getByText(/pending → approved/).waitFor();
    const historyText = await pages[1].getByTestId('purchase-revision-history').innerText();
    assert(historyText.includes('采购员甲协商变更') && historyText.includes('采购员乙协商变更') && historyText.includes('版本 2'));
    await pages[1].screenshot({ path: path.join(folder, 'reapproved.png') });
    const readbacks = await Promise.all([read(0), read(1)]);
    assert(readbacks.every(result => result.purchaseOrder.revision === 2 && result.purchaseOrder.quantity === 80
      && result.purchaseOrder.price === 9 && result.purchaseOrder.status === 'approved'));
    const persisted = await prisma.purchaseOrder.findUnique({ where: { id: Number(order.id) } });
    assert.equal(persisted.revision, 2); assert.equal(persisted.landedCostAmount, 720);
    assert.equal(readbacks[0].history.filter(entry => entry.action === 'REVISE').length, 2);
    assert.equal(readbacks[0].history.filter(entry => entry.action === 'STATUS_CHANGE').length, 1);
    assert.deepEqual(runtimeErrors, []);
    return { orderId: order.id, actorIds: [actors.buyer1.id, actors.buyer2.id], first, stale, rebased, approval,
      conflictText, historyText, readbacks, persisted, fontEvidence, screenshots: ['conflict.png', 'reapproved.png'].map(name => path.join(folder, name)), steps };
  } catch (error) {
    if (error.fontEvidence) fontEvidence.push(error.fontEvidence);
    for (let index = 0; index < pages.length; index++) await pages[index].screenshot({ path: path.join(folder, `failure-${index}.png`) }).catch(() => {});
    error.evidence = { folder, orderId: order.id, steps, runtimeErrors, fontEvidence };
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    await browser.close();
  }
}
module.exports = { purchaseRevisionBrowser };
