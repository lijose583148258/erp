const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('playwright/test');
const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
const { ensureUiAuditUser, loginUiAuditUser } = require('./ui-audit-user.cjs');

async function probeReservationWorkspace(ctx, evidence) {
  const { runId, password, urls, prisma, request, dataOf, order, original, material, batchNo, onLogin } = ctx;
  evidence.scope = 'Real warehouse order-bound draft, late batch, native recovery, reservation and sales readback; diagnostic setup, not original20/final37 acceptance';
  evidence.version = 'reservation-workspace-probe/v3';
  const account = { username: `${runId}-warehouse`, password, role: 'warehouse', segment: 'mixed' };
  await ensureUiAuditUser(account);
  const browser = (await launchBrowserWithGuard({ retryLimit: 1 })).browser;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' });
  const sales = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' });
  const folder = path.join(path.dirname(process.env.ROUND2_REPORT_PATH), 'reservation-workspace'); fs.mkdirSync(folder, { recursive: true });
  evidence.screenshots = [];
  evidence.reservationReads = [];
  evidence.browserDiagnostics = { pageErrors: [], navigations: [], lifecycle: [] };
  let closing = false;
  page.on('pageerror', error => {
    if (evidence.browserDiagnostics.pageErrors.length < 20) evidence.browserDiagnostics.pageErrors.push({ at: new Date().toISOString(),
      message: error.message.replace(/https?:\/\/[^\s)]+/g, value => { try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return '[unparsed-url]'; } }).slice(0, 1200) });
  });
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame() || evidence.browserDiagnostics.navigations.length >= 40) return;
    const url = new URL(frame.url()); evidence.browserDiagnostics.navigations.push({ at: new Date().toISOString(), path: `${url.origin}${url.pathname}${url.hash}` });
  });
  for (const event of ['crash', 'close']) page.on(event, () => evidence.browserDiagnostics.lifecycle.push({ at: new Date().toISOString(), event, intentional: closing }));
  const pendingReads = new Set();
  page.on('response', response => {
    const endpoint = new URL(response.url()).pathname;
    if (!/^\/api\/shipping\/\d+\/(reservation|reserve|release-reservation)$/.test(endpoint)) return;
    const entry = { at: new Date().toISOString(), path: endpoint, method: response.request().method(), status: response.status() };
    evidence.reservationReads.push(entry);
    const task = response.json().then(json => { entry.json = json; }, error => { entry.readError = String(error.message || error); });
    pendingReads.add(task); void task.finally(() => pendingReads.delete(task));
  });
  const visibleReservation = () => page.evaluate(() => {
    const modal = document.querySelector('[data-testid="shipment-reservation-modal"]');
    const reason = document.querySelector('[data-testid="shipment-reservation-reason"]');
    let user; try { user = JSON.parse(localStorage.getItem('erp_current_user') || 'null'); } catch { user = null; }
    return { url: `${location.origin}${location.pathname}${location.hash}`, modal: modal?.textContent || null, reason: reason instanceof HTMLTextAreaElement ? reason.value : null,
      controls: modal ? Array.from(modal.querySelectorAll('[data-testid]')).map(node => ({ id: node.getAttribute('data-testid'), disabled: node.hasAttribute('disabled') })) : [],
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).slice(0, 5).map(node => node.textContent?.slice(0, 800)),
      trace: window.__reservationWorkspaceTrace || null,
      localIdentityHint: user ? { id: user.id, role: user.role } : null };
  });
  let id, base;
  const snapshot = async () => ({ shipment: await prisma.shipment.findUnique({ where: { id } }),
    receipts: await prisma.shipmentReceipt.findMany({ where: { shipmentId: id }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { resource: 'shipment', resourceId: id }, orderBy: { id: 'asc' } }),
    balances: await prisma.stockBalance.findMany({ where: { materialId: material.id, batchNo }, orderBy: { id: 'asc' } }),
    batch: await prisma.productBatch.findUnique({ where: { batchNo } }),
    costs: await prisma.inventoryCostLedger.findMany({ where: { productBatch: { batchNo } }, orderBy: { id: 'asc' } }),
  });
  page.setDefaultTimeout(12000);
  try {
    const login = await loginUiAuditUser(page, `${urls[0]}/`, { account, storage: { 'ailao.language': 'zh', language: 'zh-CN' } });
    assert.equal(login.user.role, 'warehouse'); evidence.warehouseActor = { id: Number(login.user.id), role: login.user.role };
    await page.goto(`${urls[0]}/#shipping`, { waitUntil: 'domcontentloaded' });
    await require('./shipment-order-draft-workspace-probe.cjs').probeOrderDraftWorkspace({ ...ctx, page, login, folder }, evidence);
    id = Number(evidence.shipments[0].id); base = `/shipping/${id}`;
    await expect(page.getByTestId(`shipment-reservation-${id}`)).toBeVisible();
    const salesLogin = await loginUiAuditUser(sales, `${urls[1]}/`, { account: { username: `${runId}-sales`, password, role: 'sales', segment: 'direct' },
      storage: { 'ailao.language': 'zh', language: 'zh-CN' } });
    assert.equal(salesLogin.user.role, 'sales'); assert.notEqual(salesLogin.user.id, login.user.id);
    evidence.salesActor = { id: Number(salesLogin.user.id), role: salesLogin.user.role };
    const shot = async (target, name) => { const file = path.join(folder, `${name}.png`); await target.screenshot({ path: file }); evidence.screenshots.push(file); };
    const responseFor = (suffix, method) => page.waitForResponse(r => new URL(r.url()).pathname === `/api${base}/${suffix}` && r.request().method() === method);
    const salesRead = async (name, held, dispatched, accepted) => {
      onLogin(salesLogin.token);
      const detail = dataOf(await request(`/orders/${order.id}`, { instance: 1 }));
      const listed = dataOf(await request(`/orders?search=${encodeURIComponent(order.orderNo)}`, { instance: 0 })).find(o => Number(o.id) === Number(order.id));
      assert(listed); const expected = { reservedQuantity: held, reservationEvidenceState: 'verified', allocatedQuantity: 30, dispatchedQuantity: dispatched,
        acceptedQuantity: accepted, outstandingQuantity: 100 - accepted, unallocatedQuantity: 70, unit: 'kg' };
      for (const value of [detail, listed]) for (const [key, n] of Object.entries(expected)) assert.equal(value.fulfillment.lines[0][key], n, `${name}/${key}`);
      await sales.goto(`${urls[1]}/#orders`, { waitUntil: 'domcontentloaded' }); await sales.reload({ waitUntil: 'domcontentloaded' });
      await sales.locator('#loading').waitFor({ state: 'hidden' }); await sales.getByTestId('sales-desk-fulfillment').click(); await sales.getByTestId('sales-order-search').fill(order.orderNo);
      await expect(sales.getByTestId(`order-reserved-${order.id}-${original.items[0].id}`)).toContainText(new RegExp(`${held}\\s*kg`));
      const obligation = sales.getByTestId(`order-line-obligation-${order.id}-${original.items[0].id}`);
      await expect(obligation).toContainText(new RegExp(`已签收:\\s*${accepted}\\s*kg`));
      await expect(obligation).toContainText(new RegExp(`待交:\\s*${100 - accepted}\\s*kg`));
      const crop = path.join(folder, `${name}-quantities.png`); await obligation.screenshot({ path: crop }); evidence.screenshots.push(crop);
      await shot(sales, name); onLogin(login.token); return { detail, listed, expected };
    };
    evidence.before = await snapshot(); onLogin(login.token);
    await page.getByTestId(`shipment-reservation-${id}`).click();
    await expect(page.getByTestId('shipment-reservation-state')).toHaveText('未预留');
    let resolveAck; const lostAck = new Promise(resolve => { resolveAck = resolve; });
    await page.route(`**/api${base}/reserve`, async route => {
      try { const r = await route.fetch(); evidence.lostAck = { status: r.status(), json: await r.json(), sent: route.request().postDataJSON() }; await route.abort('failed'); }
      finally { resolveAck(); }
    });
    await page.getByTestId('shipment-reservation-reserve').click(); await lostAck;
    assert.equal(evidence.lostAck.status, 201); await expect(page.getByTestId('shipment-reservation-reserve')).toBeDisabled();
    await page.unroute(`**/api${base}/reserve`); evidence.beforeRecovery = await snapshot();
    const recovered = responseFor('reservation', 'GET'); await page.getByTestId('shipment-reservation-refresh').click(); await recovered;
    await expect(page.getByTestId('shipment-reservation-state')).toHaveText('已预留'); assert.deepEqual(await snapshot(), evidence.beforeRecovery);
    evidence.salesAfterReserve = await salesRead('sales-hold-not-delivery', 30, 0, 0);
    const deniedBefore = evidence.deniedBefore = await snapshot(); onLogin(salesLogin.token);
    evidence.deniedSalesReserve = await request(`${base}/reserve`, { method: 'POST', instance: 1, data: { expectedAuditId: null } });
    assert.equal(evidence.deniedSalesReserve.status, 403); evidence.deniedAfter = await snapshot(); assert.deepEqual(evidence.deniedAfter, deniedBefore); onLogin(login.token);
    await page.getByTestId('shipment-reservation-reason').fill('Documents delayed across countries; release this allocation');
    const release = responseFor('release-reservation', 'POST'); await page.getByTestId('shipment-reservation-release').click(); const released = await release;
    evidence.release = { status: released.status(), sent: released.request().postDataJSON(), json: await released.json() }; assert.equal(evidence.release.status, 201);
    await expect(page.getByTestId('shipment-reservation-state')).toHaveText('已释放'); evidence.salesAfterRelease = await salesRead('sales-released-hold', 0, 0, 0);
    // Fault injection only, not evidence that a QA-role workflow was exercised.
    await prisma.productBatch.update({ where: { batchNo }, data: { qualityStatus: 'hold' } }); const beforeQA = evidence.beforeQA = await snapshot();
    const blocked = responseFor('reserve', 'POST'); await page.getByTestId('shipment-reservation-reserve').click(); evidence.qaBlocked = { status: (await blocked).status(), json: await (await blocked).json() };
    assert.equal(evidence.qaBlocked.status, 409); await expect(page.getByTestId('shipment-reservation-reserve')).toBeDisabled(); evidence.afterQA = await snapshot(); assert.deepEqual(evidence.afterQA, beforeQA);
    await prisma.productBatch.update({ where: { batchNo }, data: { qualityStatus: 'not_required' } });
    await page.getByTestId('shipment-reservation-refresh').click(); await expect(page.getByTestId('shipment-reservation-reserve')).toBeEnabled();
    const second = responseFor('reserve', 'POST'); await page.getByTestId('shipment-reservation-reserve').click(); evidence.newGeneration = { status: (await second).status(), json: await (await second).json() };
    assert.equal(evidence.newGeneration.status, 201); await expect(page.getByTestId('shipment-reservation-state')).toHaveText('已预留');
    const afterNew = evidence.beforeStale = await snapshot(); evidence.staleRelease = await request(`${base}/release-reservation`, { method: 'POST', instance: 1, data: evidence.release.sent });
    assert.equal(evidence.staleRelease.status, 409); evidence.afterStale = await snapshot(); assert.deepEqual(evidence.afterStale, afterNew);
    evidence.salesAfterNew = await salesRead('sales-new-generation-hold', 30, 0, 0);
    for (const state of [evidence.beforeRecovery, afterNew]) { assert.deepEqual(state.balances, evidence.before.balances); assert.deepEqual(state.costs, evidence.before.costs); }
    await page.setViewportSize({ width: 390, height: 844 }); await shot(page, 'warehouse-mobile-hold');
    const bounds = await page.getByRole('dialog').boundingBox(); assert(bounds.x >= 0 && bounds.x + bounds.width <= 391);
    await page.getByTestId('shipment-reservation-close').click(); await page.setViewportSize({ width: 1440, height: 1000 });
    const dispatched = responseFor('status', 'PATCH'); await page.getByTestId(`shipment-dispatch-${id}`).click(); evidence.dispatch = { status: (await dispatched).status(), json: await (await dispatched).json() };
    assert.equal(evidence.dispatch.status, 200); await expect(page.getByTestId(`shipment-reserved-${id}`)).toContainText(/0\s*kg/);
    evidence.salesAfterDispatch = await salesRead('sales-dispatched-not-yet-accepted', 0, 30, 0);
    // Real native POD: audit failure rolls back the business write, and a lost
    // ACK survives a true reload without inventing another physical receipt.
    await page.getByTestId(`shipment-receipts-button-${id}`).click();
    const file = { name: 'isolated-pod.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') };
    const fillReceipt = async (quantity = '10') => {
      await page.getByTestId('shipping-receipt-quantity-input').fill(quantity);
      await page.getByTestId('shipping-receipt-accepted-input').fill(quantity);
      await page.getByTestId('shipping-receipt-rejected-input').fill('0');
      await page.getByTestId('shipping-receipt-file-input').setInputFiles(file);
    };
    await fillReceipt();
    const receiptRows = () => prisma.shipmentReceipt.findMany({ where: { shipmentId: id }, orderBy: { id: 'asc' } });
    const recovery = evidence.partialReceiptRecovery = { before: await snapshot(), browserRequests: [] };
    page.on('request', r => {
      const url = new URL(r.url());
      if (/^\/api\/shipping\/\d+\/receipt-events$/.test(url.pathname) || (/^\/api\/shipping\/\d+\/receipts$/.test(url.pathname) && url.searchParams.has('submissionKey')))
        recovery.browserRequests.push({ method: r.method(), path: url.pathname, key: r.headers()['idempotency-key'] || url.searchParams.get('submissionKey') });
    });
    const observed = async response => ({ method: response.request().method(), status: response.status(), body: await response.json(),
      key: response.request().headers()['idempotency-key'] || new URL(response.url()).searchParams.get('submissionKey'), sent: response.request().postDataJSON() });
    const originalRead = () => page.waitForResponse(r => new URL(r.url()).pathname === `/api${base}/receipts` && new URL(r.url()).searchParams.has('submissionKey'));
    const trigger = `receipt_audit_fault_${Date.now()}`, pg = process.env.AUDIT_PRISMA_PROVIDER === 'postgresql';
    try {
      if (pg) {
        await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic receipt audit failure'; END; $$`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.resource='shipment' AND NEW.action='CREATE_RECEIPT_EVENT' AND NEW.resource_id=${id}) EXECUTE FUNCTION ${trigger}()`);
      } else await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs WHEN NEW.resource='shipment' AND NEW.action='CREATE_RECEIPT_EVENT' AND NEW.resource_id=${id} BEGIN SELECT RAISE(ABORT,'Synthetic receipt audit failure'); END`);
      const failed = responseFor('receipt-events', 'POST'); await page.getByTestId('shipping-receipt-save-button').click();
      recovery.auditFailure = await observed(await failed); assert.equal(recovery.auditFailure.status, 500);
      await expect(page.getByTestId('shipping-receipt-save-button')).toHaveText('确认原签收');
    } finally {
      await prisma.$executeRawUnsafe(pg ? `DROP TRIGGER IF EXISTS ${trigger} ON audit_logs` : `DROP TRIGGER IF EXISTS ${trigger}`);
      if (pg) await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`);
    }
    recovery.afterAuditFailure = await snapshot(); assert.deepEqual(recovery.afterAuditFailure, recovery.before);
    await expect(page.getByTestId('shipping-receipt-quantity-input')).toBeDisabled();
    const missing = originalRead(); await page.getByTestId('shipping-receipt-save-button').click();
    recovery.notFound = await observed(await missing); assert.equal(recovery.notFound.status, 404);
    assert.equal(recovery.notFound.key, recovery.auditFailure.key);
    await expect(page.getByTestId('shipping-receipt-save-button')).toHaveText('重试原签收');
    await page.getByTestId('shipping-receipt-file-input').setInputFiles(file);
    let resolveReceiptAck;
    const receiptAck = new Promise(resolve => { resolveReceiptAck = resolve; });
    const receiptRoute = `**/api${base}/receipt-events`;
    await page.route(receiptRoute, async route => {
      try {
        const response = await route.fetch();
        recovery.owner = { status: response.status(), body: await response.json(), sent: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] };
        await route.abort('failed');
      } finally { resolveReceiptAck(); }
    }, { times: 1 });
    await page.getByTestId('shipping-receipt-save-button').click(); await receiptAck;
    assert.equal(recovery.owner.status, 201); await page.unroute(receiptRoute);
    assert.equal(recovery.owner.key, recovery.auditFailure.key);
    assert.match(recovery.owner.key, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/);
    await expect(page.getByTestId('shipping-receipt-save-button')).toHaveText('确认原签收');
    recovery.afterOwner = await receiptRows(); assert.equal(recovery.afterOwner.length, 1);
    const postsBeforeReload = recovery.browserRequests.filter(r => r.method === 'POST').length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    const confirmed = originalRead(); await page.getByTestId(`shipment-receipts-button-${id}`).click();
    recovery.confirmation = await observed(await confirmed);
    await expect(page.getByTestId('shipping-receipt-save-button')).toBeEnabled();
    await expect(page.getByTestId('shipping-receipt-pending')).toHaveCount(0);
    recovery.afterConfirmation = await receiptRows();
    await shot(page, 'warehouse-partial-receipt-recovery');
    assert.deepEqual(recovery.afterConfirmation, recovery.afterOwner, 'One actual 10 kg receipt was counted again after a lost acknowledgment');
    assert.equal(recovery.confirmation.method, 'GET', 'Committed receipt recovery must only read the original');
    assert.equal(recovery.browserRequests.filter(r => r.method === 'POST').length, postsBeforeReload);
    assert.deepEqual(recovery.confirmation.body.data.submission, recovery.owner.body.data.submission);
    // A second real warehouse colleague records another actual10kg while A's
    // form still says20. A's stale20 is sealed as rejected, not locked forever.
    await fillReceipt('20');
    const colleague = { username: `${runId}-warehouse-colleague`, password, role: 'warehouse', segment: 'mixed' };
    await ensureUiAuditUser(colleague);
    const other = dataOf(await request('/auth/login', { method: 'POST', data: { username: colleague.username, password } }));
    assert.equal(other.user.role, 'warehouse'); assert.notEqual(Number(other.user.id), Number(login.user.id));
    const receiptRequest = async (actorToken, key, data, instance = 1, shipmentId = id) => {
      const r = await fetch(`${urls[instance]}/api/shipping/${shipmentId}/receipt-events`, { method: 'POST', headers: { 'content-type': 'application/json',
        authorization: `Bearer ${actorToken}`, 'Idempotency-Key': key }, body: JSON.stringify(data), signal: AbortSignal.timeout(15000) });
      return { status: r.status, json: await r.json() };
    };
    const secondKey = `${runId}-second-actual10`;
    evidence.partialReceipt = await receiptRequest(other.token, secondKey, { quantity: 10, acceptedQuantity: 10, rejectedQuantity: 0 });
    assert.equal(evidence.partialReceipt.status, 201); assert.notEqual(secondKey, recovery.owner.key);
    const refusal = recovery.staleRefusal = { colleagueActor: { id: Number(other.user.id), role: other.user.role }, before: await snapshot() };
    const stale = responseFor('receipt-events', 'POST'); await page.getByTestId('shipping-receipt-save-button').click();
    refusal.response = await observed(await stale); assert.equal(refusal.response.status, 409);
    assert.equal(refusal.response.body.errorCode, 'SHIPMENT_RECEIPT_EXCEEDS_REMAINING');
    await expect(page.getByTestId('shipping-receipt-error')).toContainText('已读取最新剩余数量');
    await expect(page.getByTestId('shipping-receipt-pending')).toHaveCount(0);
    await expect(page.getByTestId('shipping-receipt-quantity-input')).toBeEnabled();
    await expect(page.getByTestId('shipping-receipt-quantity-input')).toHaveValue('10');
    refusal.after = await snapshot(); assert.deepEqual(refusal.after.receipts, refusal.before.receipts);
    for (const field of ['shipment', 'balances', 'batch', 'costs']) assert.deepEqual(refusal.after[field], refusal.before[field]);
    assert.equal(refusal.after.audits.length, refusal.before.audits.length + 1);
    assert.equal(refusal.after.audits.at(-1).action, 'REJECT_RECEIPT_EVENT');
    const proof = refusal.response.body.details.rejectedSubmission;
    refusal.replay = await receiptRequest(login.token, refusal.response.key, refusal.response.sent, 0);
    assert.equal(refusal.replay.status, 409); assert.deepEqual(refusal.replay.json.details.rejectedSubmission, proof);
    assert.deepEqual(await snapshot(), refusal.after);
    await shot(page, 'warehouse-stale-receipt-correctable');
    await page.getByTestId('shipping-receipt-drawer').getByRole('button', { name: '关闭', exact: true }).click();
    evidence.salesAfterPartialReceipt = await salesRead('sales-partial-receipt-owes80', 0, 30, 20);
    evidence.final = await snapshot(); assert.equal(evidence.final.shipment.status, 'in_transit'); assert.equal(evidence.final.shipment.reservationState, 'consumed');
    assert.equal(evidence.final.balances[0].quantity, 10); assert.equal(evidence.final.batch.stockQuantity, 10);
    assert.equal(evidence.final.costs.reduce((sum, row) => sum + row.costAmountDelta, 0), 100);
    assert.deepEqual(evidence.final.audits.filter(a => a.action === 'RESERVE_STOCK').map(a => a.userId), [Number(login.user.id), Number(login.user.id)]);
    // Completely delivered is not a reason to lose the original ACK. It must
    // still recover by GET and keep the final10 distinct from earlier events.
    await page.getByTestId(`shipment-receipts-button-${id}`).click(); await fillReceipt();
    let finalAck; const finalLost = new Promise(resolve => { finalAck = resolve; });
    await page.route(receiptRoute, async route => {
      try { const response = await route.fetch(); recovery.finalOwner = { status: response.status(), body: await response.json(),
        sent: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] }; await route.abort('failed'); }
      finally { finalAck(); }
    }, { times: 1 });
    await page.getByTestId('shipping-receipt-save-button').click(); await finalLost; await page.unroute(receiptRoute);
    assert.equal(recovery.finalOwner.status, 201); assert.notEqual(recovery.finalOwner.key, recovery.owner.key);
    assert.notEqual(recovery.finalOwner.key, refusal.response.key);
    assert.notEqual(recovery.finalOwner.key, secondKey);
    await expect(page.getByTestId('shipping-receipt-save-button')).toHaveText('确认原签收');
    recovery.afterFinalOwner = await snapshot(); assert.equal(recovery.afterFinalOwner.shipment.status, 'delivered');
    assert.equal(recovery.afterFinalOwner.receipts.length, 3);
    const finalPosts = recovery.browserRequests.filter(r => r.method === 'POST').length;
    await page.reload({ waitUntil: 'domcontentloaded' }); const finalRead = originalRead();
    await page.getByTestId(`shipment-receipts-button-${id}`).click(); recovery.finalConfirmation = await observed(await finalRead);
    await expect(page.getByTestId('shipping-receipt-pending')).toHaveCount(0);
    await expect(page.getByTestId('shipping-receipt-save-button')).toBeDisabled();
    assert.equal(recovery.finalConfirmation.status, 200);
    assert.deepEqual(recovery.finalConfirmation.body.data.submission, recovery.finalOwner.body.data.submission);
    // Current ledger readback is distinct from the frozen original request ACK.
    // The API returns chronological rows, so the visible latest receipt must
    // identify the final event, not silently keep displaying the first receipt.
    await expect(page.getByText('Latest POD', { exact: true }).locator('..')).toContainText(recovery.finalOwner.body.data.submission.receipt.receiptNo);
    assert.equal(recovery.browserRequests.filter(r => r.method === 'POST').length, finalPosts);
    assert.deepEqual(await snapshot(), recovery.afterFinalOwner);
    await shot(page, 'warehouse-delivered-original-receipt-recovered');
    recovery.twoNodeReplay = await Promise.all([0, 1].map(instance => receiptRequest(login.token, recovery.owner.key, recovery.owner.sent, instance)));
    for (const replay of recovery.twoNodeReplay) { assert.equal(replay.status, 201); assert.equal(replay.json.data.replayed, true);
      assert.deepEqual(replay.json.data.submission, recovery.owner.body.data.submission); assert.equal(replay.json.data.receiptSummary.processedQuantity, 30); }
    recovery.changedFacts = await receiptRequest(login.token, recovery.owner.key, { ...recovery.owner.sent, note: 'Changed after confirmation' });
    recovery.foreignActor = await receiptRequest(other.token, recovery.owner.key, recovery.owner.sent);
    assert.equal(recovery.changedFacts.status, 409); assert.equal(recovery.foreignActor.status, 409);
    assert(!recovery.changedFacts.json.details?.rejectedSubmission && !recovery.foreignActor.json.details?.rejectedSubmission);
    recovery.rejectedAfterDelivery = await receiptRequest(login.token, refusal.response.key, refusal.response.sent);
    assert.equal(recovery.rejectedAfterDelivery.status, 409); assert.deepEqual(recovery.rejectedAfterDelivery.json.details.rejectedSubmission, proof);
    assert.deepEqual(await snapshot(), recovery.afterFinalOwner);
    await page.getByTestId('shipping-receipt-drawer').getByRole('button', { name: '关闭', exact: true }).click();
    evidence.salesAfterFullReceipt = await salesRead('sales-full-shipment-receipt-owes70', 0, 30, 30);
    // A real six-place chemical hold must not disappear through display rounding.
    const target = evidence.shipments[1]; onLogin(login.token);
    const micro = dataOf(await request('/shipping', { method: 'POST', data: { customerId: target.customerId, orderId: target.orderId,
      orderItemId: target.orderItemId, materialId: material.id, productName: material.nameZh, batchNo, quantity: 0.000001, unit: 'kg',
      idempotencyKey: `${runId}-micro-display` } }));
    evidence.micro = { shipment: micro, before: await snapshot() };
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByTestId(`shipment-reservation-${micro.id}`).click();
    await expect(page.getByTestId('shipment-reservation-reserve')).toBeEnabled(); await page.getByTestId('shipment-reservation-reserve').click();
    await expect(page.getByTestId('shipment-reservation-state')).toHaveText('已预留');
    onLogin(salesLogin.token); evidence.micro.order = dataOf(await request(`/orders/${target.orderId}`, { instance: 1 }));
    assert.equal(evidence.micro.order.fulfillment.lines[0].reservedQuantity, 0.000001);
    await sales.reload({ waitUntil: 'domcontentloaded' }); await sales.getByTestId('sales-order-search').fill(target.orderNo);
    const microCell = sales.getByTestId(`order-reserved-${target.orderId}-${target.orderItemId}`);
    await expect(microCell).toContainText(/0\.000001\s*kg/); const microShot = path.join(folder, 'sales-micro-quantity.png');
    await microCell.screenshot({ path: microShot }); evidence.screenshots.push(microShot);
    // Passive, bounded trace: preserve the actual DOM transition instead of
    // guessing why a locator disappeared or extending the click timeout.
    await page.evaluate(() => {
      const trace = window.__reservationWorkspaceTrace = [];
      let previous;
      const capture = () => {
        const modal = document.querySelector('[data-testid="shipment-reservation-modal"]');
        const state = document.querySelector('[data-testid="shipment-reservation-state"]');
        const reason = document.querySelector('[data-testid="shipment-reservation-reason"]');
        const release = document.querySelector('[data-testid="shipment-reservation-release"]');
        const entry = { modal: Boolean(modal?.isConnected), state: state?.textContent || null,
          reasonLength: reason instanceof HTMLTextAreaElement ? reason.value.length : null,
          release: Boolean(release?.isConnected), disabled: release instanceof HTMLButtonElement ? release.disabled : null,
          focused: document.activeElement?.getAttribute('data-testid') || null,
          alerts: Array.from(document.querySelectorAll('[role="alert"]')).slice(0, 3).map(node => node.textContent?.slice(0, 500)) };
        const signature = JSON.stringify(entry);
        if (signature !== previous && trace.length < 80) { previous = signature; trace.push({ at: new Date().toISOString(), ...entry }); }
      };
      const observer = new MutationObserver(capture);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
      document.addEventListener('input', capture, true); document.addEventListener('focusin', capture, true);
      window.__stopReservationWorkspaceTrace = () => { observer.disconnect(); document.removeEventListener('input', capture, true); document.removeEventListener('focusin', capture, true); };
      capture();
    });
    await page.getByTestId('shipment-reservation-reason').fill('End isolated micro-quantity UI verification');
    evidence.micro.beforeReleaseUI = await visibleReservation();
    await page.getByTestId('shipment-reservation-release').click(); await expect(page.getByTestId('shipment-reservation-state')).toHaveText('已释放');
    evidence.micro.afterReleaseUI = await visibleReservation();
    await page.evaluate(() => window.__stopReservationWorkspaceTrace?.());
    onLogin(login.token); evidence.micro.after = await snapshot();
    for (const key of ['balances', 'batch', 'costs']) assert.deepEqual(evidence.micro.after[key], evidence.micro.before[key]);
    await page.getByTestId('shipment-reservation-close').click();
    const microDispatch = page.waitForResponse(r => new URL(r.url()).pathname === `/api/shipping/${micro.id}/status` && r.request().method() === 'PATCH');
    await page.getByTestId(`shipment-dispatch-${micro.id}`).click(); assert.equal((await microDispatch).status(), 200);
    await page.getByTestId(`shipment-receipts-button-${micro.id}`).click();
    await expect(page.getByTestId('shipping-receipt-quantity-input')).toHaveValue('0.000001');
    await page.getByTestId('shipping-receipt-accepted-input').fill('0');
    const postsBeforeInvalid = recovery.browserRequests.filter(r => r.method === 'POST').length;
    await page.getByTestId('shipping-receipt-save-button').click();
    await expect(page.getByTestId('shipping-receipt-error')).toContainText('原签收内容无效');
    await expect(page.getByTestId('shipping-receipt-pending')).toHaveCount(0);
    assert.equal(recovery.browserRequests.filter(r => r.method === 'POST').length, postsBeforeInvalid);
    assert.equal(await prisma.shipmentReceipt.count({ where: { shipmentId: micro.id } }), 0);
    const microKey = `${runId}-micro-receipt-race`, microFacts = { quantity: 0.000001, acceptedQuantity: 0.000001, rejectedQuantity: 0 };
    evidence.micro.receiptRace = await Promise.all([0, 1].map(instance => receiptRequest(login.token, microKey, microFacts, instance, micro.id)));
    for (const r of evidence.micro.receiptRace) assert.equal(r.status, 201, JSON.stringify(r));
    assert.deepEqual(evidence.micro.receiptRace.map(r => r.json.data.replayed).sort(), [false, true]);
    assert.deepEqual(evidence.micro.receiptRace[0].json.data.submission, evidence.micro.receiptRace[1].json.data.submission);
    evidence.micro.receipts = await prisma.shipmentReceipt.findMany({ where: { shipmentId: micro.id } });
    evidence.micro.receiptAudits = await prisma.auditLog.findMany({ where: { resource: 'shipment', resourceId: micro.id, action: 'CREATE_RECEIPT_EVENT' } });
    evidence.micro.delivered = await prisma.shipment.findUnique({ where: { id: micro.id } });
    assert.equal(evidence.micro.receipts.length, 1); assert.equal(evidence.micro.receipts[0].quantity, 0.000001);
    assert.equal(evidence.micro.receipts[0].acceptedQuantity, 0.000001); assert.equal(evidence.micro.receipts[0].rejectedQuantity, 0);
    assert.equal(evidence.micro.receipts[0].receivedBy, Number(login.user.id));
    assert.equal(evidence.micro.receiptAudits.length, 1); assert.equal(evidence.micro.delivered.status, 'delivered');
    const microAck = evidence.micro.receiptRace[0].json.data.submission;
    assert.equal(microAck.shipmentId, micro.id); assert.equal(microAck.key, microKey);
    assert.equal(microAck.facts.quantity, 0.000001); assert.equal(microAck.auditId, evidence.micro.receiptAudits[0].id);
    evidence.micro.afterReceiptRace = await snapshot();
    assert.equal(Math.round(evidence.micro.afterReceiptRace.balances[0].quantity * 1e6), 9999999);
    assert.equal(Math.round(evidence.micro.afterReceiptRace.batch.stockQuantity * 1e6), 9999999);
    // Quantity has six places; the existing ledger books money to two places.
    // This 0.00001 theoretical allocation rounds to0.00, not a missing row.
    const microCost = evidence.micro.afterReceiptRace.costs.at(-1);
    evidence.micro.costRoundingPolicy = { quantityPlaces: 6, moneyPlaces: 2, before: 100, quantityBefore: 10,
      quantityDelta: -0.000001, bookedCostDelta: 0, after: 100 };
    assert.equal(microCost.quantityDelta, -0.000001); assert.equal(microCost.costAmountDelta, 0);
    assert.equal(microCost.costBefore, 100); assert.equal(microCost.costAfter, 100);
    assert.equal(Math.round(evidence.micro.afterReceiptRace.costs.reduce((sum, row) => sum + row.quantityDelta, 0) * 1e6), 9999999);
    assert.equal(evidence.micro.afterReceiptRace.costs.reduce((sum, row) => sum + row.costAmountDelta, 0), 100);
  } catch (error) {
    evidence.failure = { message: String(error.message || error), warehouse: await visibleReservation().catch(() => null) };
    const file = path.join(folder, 'reservation-failure.png');
    await page.screenshot({ path: file, fullPage: true }).then(() => evidence.screenshots.push(file), () => {});
    throw error;
  } finally {
    closing = true;
    await sales.close().catch(() => {}); await page.close().catch(() => {}); await browser.close();
    await Promise.allSettled([...pendingReads]);
  }
}
module.exports = { probeReservationWorkspace };
