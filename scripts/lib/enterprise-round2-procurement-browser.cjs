const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ensureReleasedMaterial } = require('./material-audit-fixture.cjs');
const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');
const { verifyProcurementToolbarLayouts } = require('./procurement-toolbar-layout-audit.cjs');
const { explicitPurchaseSources, createApprovedPurchaseFixture, fillPurchaseSourceFields } = require('./purchase-quality-audit-fixture.cjs');

async function purchaseRevisionBrowser({ request, dataOf, actors, prisma, runId, urls, reportPath }, signal) {
  const folder = path.join(path.dirname(reportPath), `${runId}-purchase-browser`);
  fs.mkdirSync(folder, { recursive: true });
  const material = await ensureReleasedMaterial({ request: (endpoint, options) => request(endpoint, { ...options, signal }),
    code: `${runId}-po-ui`, name: `${runId}-po-ui`, category: 'raw_material', unit: 'kg' });
  const supplier = dataOf(await request('/procurement/suppliers', { actor: actors.buyer1, method: 'POST', signal,
    data: { name: `${runId}-po-ui-supplier`, category: 'Raw Materials', contact: 'Synthetic' } }));
  const sources = explicitPurchaseSources({ quoteRef: `${runId}-browser-quote`, specificationRef: `${runId}-browser-spec`, specificationRevision: 'R1',
    taxTreatment: 'none_or_third_party', supplierTaxAmount: 0, supplierChargesAmount: 0, characteristics: [
      { code: 'PH', name: 'pH', valueType: 'numeric', unit: null, lowerLimit: '7', upperLimit: '8', testMethod: 'Synthetic calibrated pH meter', required: true },
    ] });
  const setup = await createApprovedPurchaseFixture({ request, dataOf, signal }, { buyer: actors.buyer1, approver: actors.buyer2, sources,
    payload: { supplierId: Number(supplier.id), materialId: material.id, item: material.nameZh, quantity: 100, price: 10, unit: 'kg', eta: '2026-10-01' } });
  const order = setup.approved;
  const steps = [];
  const launched = await launchBrowserWithGuard({ recordStep: entry => steps.push(entry), retryLimit: 1 }).catch(error => {
    error.evidence = { folder, orderId: order.id, steps }; throw error;
  });
  const browser = launched.browser;
  const pages = [];
  const runtimeErrors = [];
  const fontEvidence = [];
  const layoutEvidence = [];
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
      if (index === 0) layoutEvidence.push(...await verifyProcurementToolbarLayouts(page, folder));
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
    const confirmedSources = { ...sources, supplierPayableTerms: { ...sources.supplierPayableTerms, evidenceRef: `${runId}-buyer-B-80kg-quote` } };
    await fillPurchaseSourceFields(pages[1], confirmedSources);
    await pages[1].getByTestId('purchase-source-reason').fill('采购员乙明确八十公斤供货报价和来料规范，等待其他人审批');
    const sourceResponse = pages[1].waitForResponse(res => new URL(res.url()).pathname.endsWith(`/procurement/orders/${order.id}/confirm-sources`)
      && res.request().method() === 'POST');
    await pages[1].getByTestId('purchase-source-confirm').click();
    const confirmedResponse = await sourceResponse;
    const sourceConfirmation = { status: confirmedResponse.status(), body: await confirmedResponse.json(), request: confirmedResponse.request().postDataJSON(), actorId: actors.buyer2.id };
    assert.equal(sourceConfirmation.status, 200, JSON.stringify(sourceConfirmation.body));
    assert.equal(sourceConfirmation.body.data.revision, 3);
    await pages[1].getByTestId('purchase-source-state').filter({ hasText: /等待另一位审批人/ }).waitFor();
    await pages[1].getByTestId('purchase-revision-close').click();
    // The buyer who rebased and confirmed the quote cannot approve themselves.
    await pages[0].getByTestId('purchase-revision-close').click();
    await pages[0].reload({ waitUntil: 'domcontentloaded' });
    await pages[0].getByTestId('procurement-desk-orders').click();
    const approval = await clickWrite(pages[0], `purchase-order-approve-${order.id}`, '/status');
    assert.equal(approval.status, 200, JSON.stringify(approval.body));
    await pages[0].getByTestId(`purchase-order-dispatch-${order.id}`).waitFor();
    await pages[0].getByTestId(`purchase-order-revise-${order.id}`).click();
    await pages[0].getByTestId('purchase-revision-history').getByText(/pending → approved/).first().waitFor();
    const historyText = await pages[0].getByTestId('purchase-revision-history').innerText();
    assert(historyText.includes('采购员甲协商变更') && historyText.includes('采购员乙协商变更') && historyText.includes('版本 3'));
    await pages[0].screenshot({ path: path.join(folder, 'reapproved.png') });
    const readbacks = await Promise.all([read(0), read(1)]);
    assert(readbacks.every(result => result.purchaseOrder.revision === 3 && result.purchaseOrder.quantity === 80
      && result.purchaseOrder.price === 9 && result.purchaseOrder.status === 'approved'));
    const persisted = await prisma.purchaseOrder.findUnique({ where: { id: Number(order.id) } });
    assert.equal(persisted.revision, 3); assert.equal(persisted.landedCostAmount, 720);
    assert.equal(readbacks[0].history.filter(entry => entry.action === 'REVISE').length, 2);
    assert.equal(readbacks[0].history.filter(entry => entry.action === 'STATUS_CHANGE').length, 2);
    assert.equal(readbacks[0].history.filter(entry => entry.action === 'CONFIRM_SOURCES').length, 1);
    assert.deepEqual(runtimeErrors, []);
    return { orderId: order.id, setup, actorIds: [actors.buyer1.id, actors.buyer2.id], first, stale, rebased, sourceConfirmation, approval, approvalActorId: actors.buyer1.id,
      conflictText, historyText, readbacks, persisted, fontEvidence, layoutEvidence, screenshots: ['conflict.png', 'reapproved.png'].map(name => path.join(folder, name)), steps };
  } catch (error) {
    if (error.fontEvidence) fontEvidence.push(error.fontEvidence);
    if (error.layoutEvidence) layoutEvidence.push(...error.layoutEvidence);
    for (let index = 0; index < pages.length; index++) await pages[index].screenshot({ path: path.join(folder, `failure-${index}.png`) }).catch(() => {});
    error.evidence = { folder, orderId: order.id, steps, runtimeErrors, fontEvidence, layoutEvidence };
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    await browser.close();
  }
}
// Reuse the existing PO screen and audit database; no separate role runner.
async function purchaseRoleBrowser({ request, dataOf, prisma, runId, urls, reportPath }, signal) {
  const { ensureUiAuditUser } = require('./ui-audit-user.cjs');
  const { expect } = require('playwright/test');
  const jobs = { buyer: 'procurement.write', approver: 'procurement.approve', receiver: 'procurement.receive' };
  const password = require('node:crypto').randomBytes(24).toString('base64url') + '!Aa1';
  const people = {}, evidence = { version: 'purchase-role-browser/v1', controlledVersion: 2, scope: 'Three least-privilege purchasing responsibilities, actual source confirmation and controlled hold receipt; not full20/QC/payables acceptance', actors: [], denied: [], browser: [], writes: [] };
  for (const [job, permission] of Object.entries(jobs)) {
    const role = `${runId.replace(/-/g, '_')}_po_${job}`;
    const permissions = ['dashboard.read', 'procurement.read', 'procurement.suppliers.read', 'materials.read', permission];
    dataOf(await request('/roles', { method: 'POST', data: { code: role, name: job, permissions, dataScopes: ['procurement_visible'], isActive: true }, signal }));
    const username = `${runId}_po_${job}`;
    await ensureUiAuditUser({ username, password, role, segment: 'mixed' });
    const login = dataOf(await request('/auth/login', { actor: null, method: 'POST', data: { username, password }, signal }));
    people[job] = { id: login.user.id, role, token: login.token, user: login.user };
    evidence.actors.push({ job, id: login.user.id, role, permissions: login.user.permissions, dataScopes: login.user.dataScopes });
  }
  const material = await ensureReleasedMaterial({ request: (endpoint, options) => request(endpoint, { ...options, signal }), code: `${runId}-po-roles`, name: `${runId}-po-roles`, category: 'raw_material', unit: 'kg' });
  const supplier = dataOf(await request('/procurement/suppliers', { actor: people.buyer, method: 'POST', data: { name: `${runId}-po-roles`, category: 'Raw Materials', contact: 'Isolated test' }, signal }));
  const sources = explicitPurchaseSources({ quoteRef: `${runId}-role-10kg-quote`, specificationRef: `${runId}-role-spec`, specificationRevision: 'R1',
    taxTreatment: 'none_or_third_party', supplierTaxAmount: 0, supplierChargesAmount: 0, characteristics: [
      { code: 'PH', name: 'pH', valueType: 'numeric', unit: null, lowerLimit: '7', upperLimit: '8', testMethod: 'Synthetic calibrated pH meter', required: true },
    ] });
  const payload = { supplierId: Number(supplier.id), materialId: material.id, item: material.nameZh, quantity: 10, price: 10, unit: 'kg', eta: '2026-10-06', currency: 'CNY', status: 'pending', ...sources };
  const original = dataOf(await request('/procurement/orders', { actor: people.buyer, method: 'POST', data: payload, signal }));
  const id = Number(original.id), batchNo = `${runId}-po-role-batch`;
  Object.assign(evidence, { orderId: id, materialId: material.id, batchNo, original });
  const snapshot = async () => ({
    orders: await prisma.purchaseOrder.findMany({ where: { materialId: material.id }, orderBy: { id: 'asc' } }),
    receipts: await prisma.purchaseReceipt.findMany({ where: { purchaseOrderId: id }, orderBy: { id: 'asc' } }),
    balances: await prisma.stockBalance.findMany({ where: { materialId: material.id }, orderBy: { id: 'asc' } }),
    movements: await prisma.stockMovement.findMany({ where: { materialId: material.id }, orderBy: { id: 'asc' } }),
    entries: await prisma.stockEntry.findMany({ where: { movements: { some: { materialId: material.id } } }, orderBy: { id: 'asc' } }),
    batches: await prisma.productBatch.findMany({ where: { materialId: material.id }, orderBy: { id: 'asc' } }),
    costs: await prisma.inventoryCostLedger.findMany({ where: { productBatch: { materialId: material.id } }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { resource: 'purchase_order', resourceId: id }, orderBy: { id: 'asc' } }),
  });
  evidence.before = await snapshot();
  for (const instance of [0, 1]) for (const [job, operation, endpoint, method, data] of [
    ['buyer', 'approve', `/procurement/orders/${id}/status`, 'PATCH', { status: 'approved' }],
    ['buyer', 'approve-alias', `/procurement/orders/${id}/status`, 'PATCH', { status: 'confirmed' }],
    ['buyer', 'receive', `/procurement/orders/${id}/receipts`, 'POST', { quantity: 1 }],
    ['buyer', 'receive-alias', `/procurement/orders/${id}/status`, 'PATCH', { status: 'delivered' }],
    ['buyer', 'create-approved', '/procurement/orders', 'POST', { ...payload, status: 'approved' }],
    ['buyer', 'create-transit-alias', '/procurement/orders', 'POST', { ...payload, status: 'shipped' }],
    ['approver', 'create', '/procurement/orders', 'POST', payload],
    ['approver', 'receive', `/procurement/orders/${id}/receipts`, 'POST', { quantity: 1 }],
    ['receiver', 'approve-alias', `/procurement/orders/${id}/status`, 'PATCH', { status: 'confirmed' }],
    ['receiver', 'revise', `/procurement/orders/${id}`, 'PATCH', { expectedRevision: 0, expectedUpdatedAt: original.updatedAt, quantity: 12, price: 10, taxAmount: 0, eta: '2026-10-06', reason: 'Forbidden terms edit' }],
    ...Object.keys(jobs).map(job => [job, 'sync-bypass', `/procurement/sync-b2b/1`, 'POST', { salesStatus: 'delivered' }]),
  ]) {
    const result = await request(endpoint, { actor: people[job], instance, method, data, signal });
    evidence.denied.push({ job, operation, instance, status: result.status, response: result.json });
    assert.equal(result.status, 403, `${job} ${operation} ${JSON.stringify(result.json)}`);
  }
  evidence.afterDenied = await snapshot(); assert.deepEqual(evidence.afterDenied, evidence.before, 'Denied procurement operations changed business rows');
  for (let attempt = 0; attempt < 10; attempt++) {
    evidence.denialAudits = await prisma.auditLog.findMany({ where: { userId: { in: evidence.actors.map(a => a.id) }, resource: { startsWith: '/api/procurement/' }, details: { startsWith: 'Status: 403,' } }, orderBy: { id: 'asc' } });
    if (evidence.denialAudits.length === evidence.denied.length) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const browser = (await launchBrowserWithGuard({ launchTimeoutMs: 15000, totalTimeoutMs: 30000, maxAttemptsPerStrategy: 1 })).browser;
  const abort = () => { void browser.close().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  const folder = path.join(path.dirname(reportPath), `${runId}-purchase-roles`); fs.mkdirSync(folder, { recursive: true });
  const pages = {}, contexts = [];
  async function load(job) {
    const page = pages[job], url = `${urls[1]}/#procurement`;
    if (page.url() === url) await page.reload({ waitUntil: 'domcontentloaded' });
    else await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.getByTestId('procurement-desk-orders').click();
    await expect(page.getByTestId(`purchase-order-revise-${id}`)).toBeVisible();
    return page;
  }
  async function write(job, testId, suffix, method) {
    const page = pages[job]; const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith(`/procurement/orders/${id}${suffix}`) && r.request().method() === method);
    await page.getByTestId(testId).click(); const r = await response; const body = await r.json();
    assert([200, 201].includes(r.status()), JSON.stringify(body));
    const row = { job, operation: suffix || 'revise', instance: 1, status: r.status(), request: r.request().postDataJSON(), response: body,
      ...(suffix === '/receipts' ? { requestKey: r.request().headers()['idempotency-key'] } : {}) };
    evidence.writes.push(row); return row;
  }
  try {
    const errors = {};
    for (const [job, actor] of Object.entries(people)) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(context);
      const page = pages[job] = await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000); errors[job] = [];
      page.on('pageerror', e => errors[job].push(e.message));
      page.on('response', r => { if (r.status() >= 400 && r.url().includes('/api/')) errors[job].push(`${r.status()} ${new URL(r.url()).pathname}`); });
      await page.addInitScript(({ token, user }) => {
        for (const key of ['token', 'auth_token', 'erp_auth_token']) localStorage.setItem(key, token);
        for (const key of ['user', 'currentUser', 'erp_current_user']) localStorage.setItem(key, JSON.stringify(user));
        localStorage.setItem('ailao.language', 'zh'); localStorage.setItem('language', 'zh-CN');
      }, { token: actor.token, user: { ...actor.user, id: String(actor.id), segment: 'mixed' } });
      await load(job);
      await expect(page.getByTestId(`purchase-order-approve-${id}`)).toHaveCount(job === 'approver' ? 1 : 0);
      const purchaseNotice = job === 'buyer' ? null : '当前角色不能新增或修改采购单；审批与收货按对应操作权限控制。';
      if (purchaseNotice) await expect(page.getByText(purchaseNotice, { exact: true })).toBeVisible();
      const permissionScreenshot = path.join(folder, `${job}-pending.png`); await page.screenshot({ path: permissionScreenshot });
      evidence.browser.push({ job, actorId: actor.id, role: actor.role, instance: 1, orderId: id, approveVisible: job === 'approver', purchaseNotice, permissionScreenshot });
    }
    const buyer = pages.buyer; await buyer.getByTestId(`purchase-order-revise-${id}`).click();
    await buyer.getByTestId('purchase-revision-quantity').fill('12'); await buyer.getByTestId('purchase-revision-reason').fill('采购员确认十二公斤供货，等待独立审批');
    await write('buyer', 'purchase-revision-save', '', 'PATCH'); await buyer.getByTestId('purchase-revision-saved').waitFor(); await buyer.getByTestId('purchase-revision-close').click();
    await buyer.getByTestId(`purchase-order-revise-${id}`).click();
    await fillPurchaseSourceFields(buyer, { ...sources, supplierPayableTerms: { ...sources.supplierPayableTerms, evidenceRef: `${runId}-role-12kg-confirmed-quote` } });
    await buyer.getByTestId('purchase-source-reason').fill('明确确认十二公斤供应商报价与来料规范，不沿用未确认金额');
    await write('buyer', 'purchase-source-confirm', '/confirm-sources', 'POST');
    await buyer.getByTestId('purchase-source-state').filter({ hasText: /等待另一位审批人/ }).waitFor();
    await buyer.getByTestId('purchase-revision-close').click();
    await load('approver'); await expect(pages.approver.getByTestId(`purchase-order-revise-${id}`)).toHaveText('版本 2');
    await write('approver', `purchase-order-approve-${id}`, '/status', 'PATCH');
    await expect(pages.approver.getByTestId(`purchase-order-dispatch-${id}`)).toHaveCount(0);
    await load('buyer'); await write('buyer', `purchase-order-dispatch-${id}`, '/status', 'PATCH');
    const receiver = await load('receiver');
    // Hold the real receipt read until the loading UI is checked. No sleep or
    // mocked response: a slow backend must not overwrite editable user input.
    let releaseReceipt;
    const receiptGate = new Promise(resolve => { releaseReceipt = resolve; });
    await receiver.route(`**/api/procurement/orders/${id}/receipts`, async route => { await receiptGate; await route.continue(); }, { times: 1 });
    try {
      await receiver.getByTestId(`purchase-order-receipts-${id}`).click();
      await expect(receiver.getByTestId('purchase-receipt-save-button')).toHaveText('加载中...');
      const inputs = receiver.getByTestId('purchase-receipt-drawer').locator('input, textarea');
      assert.equal(await inputs.count(), 6);
      for (const input of await inputs.all()) await expect(input).toBeDisabled();
      await expect(receiver.getByTestId('purchase-receipt-save-button')).toBeDisabled();
      evidence.receiptLoadingGuard = { inputsDisabled: 6, saveDisabled: true };
    } finally { releaseReceipt(); }
    await receiver.getByTestId('purchase-receipt-quantity-input').fill('5'); await receiver.getByTestId('purchase-receipt-accepted-input').fill('5');
    await receiver.getByTestId('purchase-receipt-rejected-input').fill('0'); await receiver.getByTestId('purchase-receipt-batch-input').fill(batchNo);
    // The owner request really commits once; only its browser acknowledgment is
    // dropped. Refresh must restore that intent, never invent another receipt.
    const storageSlot = `ailaoda.purchase-receipt-intent/v1.${encodeURIComponent(String(people.receiver.id))}.${encodeURIComponent(String(id))}`;
    const recovery = evidence.receiptRecovery = { version: 'purchase-receipt-browser-recovery/v1', actorId: people.receiver.id, orderId: id,
      storageSlot, scope: 'Lost HTTP acknowledgment and browser refresh; one 5 kg receipt only, not database restart or full-received remaining-zero recovery',
      beforeOwner: await snapshot() };
    const receiptRoute = `**/api/procurement/orders/${id}/receipts`;
    let ownerTimer, resolveOwner, rejectOwner;
    const ownerResult = new Promise((resolve, reject) => {
      resolveOwner = resolve; rejectOwner = reject;
      ownerTimer = setTimeout(() => reject(Error('Committed receipt acknowledgment-drop probe timed out after 20 seconds')), 20000);
    });
    const dropOwnerAck = async route => {
      try {
        assert.equal(route.request().method(), 'POST', 'Acknowledgment-drop route must intercept the actual receipt POST');
        recovery.firstRequest = { instance: 1, method: route.request().method(), requestKey: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() };
        assert.match(recovery.firstRequest.requestKey || '', /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/);
        assert.deepEqual(recovery.firstRequest.body, { expectedRevision: 2, quantity: 5, acceptedQuantity: 5, rejectedQuantity: 0, batchNo });
        const response = await route.fetch({ timeout: 15000 });
        recovery.ownerResponse = { status: response.status(), body: await response.json() };
        assert.equal(recovery.ownerResponse.status, 201, JSON.stringify(recovery.ownerResponse.body));
        assert.equal(recovery.ownerResponse.body.success, true);
        assert.equal(recovery.ownerResponse.body.data.replayed, false);
        assert.equal(recovery.ownerResponse.body.data.submission.key, recovery.firstRequest.requestKey);
        await route.abort('failed'); resolveOwner();
      } catch (error) { await route.abort('failed').catch(() => {}); rejectOwner(error); }
    };
    await receiver.route(receiptRoute, dropOwnerAck, { times: 1 });
    try { await Promise.all([receiver.getByTestId('purchase-receipt-save-button').click(), ownerResult]); }
    finally { clearTimeout(ownerTimer); await receiver.unroute(receiptRoute, dropOwnerAck); }
    await expect(receiver.getByTestId('purchase-receipt-unconfirmed')).toBeVisible({ timeout: 15000 });
    await expect(receiver.getByTestId('purchase-receipt-save-button')).toHaveText('确认原收货请求');
    await expect(receiver.getByTestId('purchase-receipt-save-button')).toBeEnabled();
    recovery.persistedBeforeRefresh = await receiver.evaluate(slot => localStorage.getItem(slot), storageSlot);
    assert(recovery.persistedBeforeRefresh, 'Unknown receipt acknowledgment must retain the original durable browser intent');
    recovery.intent = JSON.parse(recovery.persistedBeforeRefresh);
    assert.equal(recovery.intent.key, recovery.firstRequest.requestKey); assert.equal(recovery.intent.userId, String(people.receiver.id));
    assert.equal(recovery.intent.orderId, String(id));
    assert.deepEqual(recovery.intent.facts, { expectedRevision: 2, quantity: 5, acceptedQuantity: 5, rejectedQuantity: 0, batchNo, discrepancyReason: '', note: '' });
    recovery.afterOwner = await snapshot();
    assert.equal(recovery.afterOwner.receipts.length, 1); assert.equal(recovery.afterOwner.movements.length, 1);
    assert.equal(recovery.afterOwner.entries.length, 1); assert.equal(recovery.afterOwner.costs.length, 1);
    assert.equal(recovery.afterOwner.balances.reduce((sum, row) => sum + Number(row.quantity), 0), 5);
    assert.equal(recovery.afterOwner.costs[0].costAmountDelta, 50);
    recovery.unknownScreenshot = path.join(folder, 'receiver-receipt-ack-unknown.png'); await receiver.screenshot({ path: recovery.unknownScreenshot });
    recovery.refreshDialogs = [];
    const acceptRefresh = dialog => {
      const accepted = dialog.type() === 'beforeunload'; recovery.refreshDialogs.push({ type: dialog.type(), accepted });
      void (accepted ? dialog.accept() : dialog.dismiss()).catch(error => { recovery.refreshDialogError = error.message; });
    };
    assert.equal(receiver.url(), `${urls[1]}/#procurement`, 'Recovery must perform a real reload of the original receiver page');
    receiver.on('dialog', acceptRefresh);
    try { await load('receiver'); }
    finally { receiver.off('dialog', acceptRefresh); }
    assert(!recovery.refreshDialogError, recovery.refreshDialogError);
    assert(recovery.refreshDialogs.every(dialog => dialog.type === 'beforeunload' && dialog.accepted), 'Unexpected dialog occurred while refreshing the unconfirmed receipt');
    recovery.refreshed = true;
    await receiver.getByTestId(`purchase-order-receipts-${id}`).click();
    await expect(receiver.getByTestId('purchase-receipt-unconfirmed')).toBeVisible({ timeout: 15000 });
    await expect(receiver.getByTestId('purchase-receipt-save-button')).toHaveText('确认原收货请求');
    await expect(receiver.getByTestId('purchase-receipt-save-button')).toBeEnabled();
    recovery.persistedAfterRefresh = await receiver.evaluate(slot => localStorage.getItem(slot), storageSlot);
    assert.equal(recovery.persistedAfterRefresh, recovery.persistedBeforeRefresh);
    const restoredInputs = receiver.getByTestId('purchase-receipt-drawer').locator('input, textarea');
    assert.equal(await restoredInputs.count(), 6);
    for (const input of await restoredInputs.all()) await expect(input).toBeDisabled();
    recovery.restoredValues = await restoredInputs.evaluateAll(inputs => inputs.map(input => input.value));
    assert.deepEqual(recovery.restoredValues, ['5', '5', '0', batchNo, '', '']);
    recovery.refreshGuard = { inputsDisabled: 6, retryEnabled: true };
    recovery.refreshedScreenshot = path.join(folder, 'receiver-receipt-ack-restored.png'); await receiver.screenshot({ path: recovery.refreshedScreenshot });
    recovery.beforeReplay = await snapshot(); assert.deepEqual(recovery.beforeReplay, recovery.afterOwner);
    const replay = await write('receiver', 'purchase-receipt-save-button', '/receipts', 'POST');
    recovery.replayRequest = { instance: replay.instance, method: 'POST', requestKey: replay.requestKey, body: replay.request };
    recovery.replayResponse = { status: replay.status, body: replay.response };
    assert.deepEqual(recovery.replayRequest, recovery.firstRequest);
    assert.equal(replay.response.data.replayed, true);
    assert.deepEqual(replay.response.data.submission, recovery.ownerResponse.body.data.submission);
    await expect(receiver.getByTestId('purchase-receipt-unconfirmed')).toHaveCount(0);
    await expect(receiver.getByTestId('purchase-receipt-save-button')).toHaveText('保存收货批次');
    await expect(receiver.getByTestId('purchase-receipt-save-button')).toBeEnabled();
    recovery.storageAfterReplay = await receiver.evaluate(slot => localStorage.getItem(slot), storageSlot);
    assert.equal(recovery.storageAfterReplay, null, 'Only the validated original submission may clear its browser intent');
    recovery.afterReplay = await snapshot(); assert.deepEqual(recovery.afterReplay, recovery.beforeReplay, 'Same-key confirmation changed stock, cost, receipt, PO timestamp or audit facts');
    recovery.mutableRemainingQuantity = replay.response.data.receiptSummary.remainingQuantity; assert.equal(recovery.mutableRemainingQuantity, 7);
    recovery.confirmedScreenshot = path.join(folder, 'receiver-receipt-ack-confirmed.png'); await receiver.screenshot({ path: recovery.confirmedScreenshot });
    recovery.status = 'passed';
    assert.deepEqual(evidence.writes.at(-1).request, { expectedRevision: 2, quantity: 5, acceptedQuantity: 5, rejectedQuantity: 0, batchNo });
    await expect(receiver.getByTestId('purchase-receipt-drawer')).toContainText(batchNo);
    for (const row of evidence.browser) {
      const page = await load(row.job); await page.getByTestId(`purchase-order-receipts-${id}`).click();
      const drawer = page.getByTestId('purchase-receipt-drawer'); await expect(drawer).toContainText(batchNo); await expect(drawer).toContainText('实收入库 5kg');
      row.receiveEnabled = await page.getByTestId('purchase-receipt-save-button').isEnabled();
      assert.equal(row.receiveEnabled, row.job === 'receiver'); row.batchReadback = batchNo; row.acceptedReadback = '实收入库 5kg';
      row.receiptNotice = row.job === 'receiver' ? null : '当前角色只能查看收货批次，保存收货需要采购收货登记权限。';
      if (row.receiptNotice) await expect(drawer.getByText(row.receiptNotice, { exact: true })).toBeVisible();
      row.errors = errors[row.job]; assert.deepEqual(row.errors, []);
      row.receiptScreenshot = path.join(folder, `${row.job}-receipt.png`); await page.screenshot({ path: row.receiptScreenshot });
    }
    evidence.readbacks = await Promise.all([0, 1].map(async instance => ({ instance, ...dataOf(await request(`/procurement/orders/${id}/receipts`, { actor: people.buyer, instance, signal })) })));
    evidence.final = await snapshot();
    assert.equal(evidence.final.orders[0].revision, 2); assert.equal(evidence.final.orders[0].quantity, 12); assert.equal(evidence.final.orders[0].status, 'in_transit');
    assert.equal(evidence.final.receipts.length, 1); assert.equal(evidence.final.receipts[0].receivedBy, people.receiver.id);
    assert.equal(evidence.final.balances.reduce((sum, row) => sum + Number(row.quantity), 0), 5);
    assert.equal(evidence.final.movements.length, 1); assert.equal(evidence.final.entries.length, 1); assert.equal(evidence.final.costs.length, 1);
    evidence.status = 'passed'; require('./enterprise-round2-procurement.cjs').verifyPurchaseRoleProof(evidence);
    require('./enterprise-round2-purchase-receipt-proof.cjs').verifyPurchaseReceiptRecoveryProof(evidence);
    return evidence;
  } catch (error) { error.evidence = evidence; throw error; }
  finally { signal.removeEventListener('abort', abort); for (const c of contexts) await c.close().catch(() => {}); await browser.close(); }
}
module.exports = { purchaseRevisionBrowser, purchaseRoleBrowser };
