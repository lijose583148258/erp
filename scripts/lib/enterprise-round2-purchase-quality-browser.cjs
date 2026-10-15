const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');
const { ensureUiAuditUser } = require('./ui-audit-user.cjs');
const { definitions, deniedOperations, verifyPurchaseQualityBrowserProof } = require('./purchase-quality-payables-browser-proof.cjs');

// Seed is the still-held second receipt of the actual API package. No hidden
// stock adjustment, guessed AP, generic request injection, or QA bypass.
async function purchaseQualityPayablesBrowser({ request, dataOf, prisma, runId, urls, reportPath }, apiEvidence, signal) {
  const receipt = apiEvidence.receipt2.submission.receipt, receiptId = receipt.id;
  const e = { version: 'purchase-quality-payables-browser/v1', runId,
    scope: 'Four least-privilege supplier QC/QA/AP browser responsibilities; not full20 or full workforce acceptance', seed: { receipt },
    actors: [], browserProfiles: [], browserRequests: [], denied: [], screenshots: [], errors: [], expectedTransportErrors: [], cancelledRequests: [], recoveryCancelledTelemetry: [] };
  const folder = path.join(path.dirname(reportPath), `${runId}-purchase-quality-browser`); fs.mkdirSync(folder, { recursive: true });
  const people = {}, pages = {}, contexts = [], pendingResponseReads = new Set(); let browser, droppingOwner = false, reloadingRecorder = false;
  const password = crypto.randomBytes(24).toString('base64url') + '!Aa1';
  const abort = () => { if (browser) void browser.close().catch(() => {}); };
  const safeJson = async response => { try { return await response.json(); } catch { return null; } };
  const snap = async () => {
    const receipts = await prisma.purchaseReceipt.findMany({ where: { purchaseOrderId: receipt.purchaseOrderId }, orderBy: { id: 'asc' } });
    const batchIds = receipts.map(r => r.batchId).filter(Boolean), batchNos = receipts.map(r => r.batchNo).filter(Boolean);
    const qualityChecks = await prisma.incomingQualityCheck.findMany({ where: { purchaseReceiptId: receiptId }, orderBy: { id: 'asc' } });
    const payments = await prisma.supplierPayment.findMany({ where: { purchaseReceiptId: receiptId }, orderBy: { id: 'asc' } });
    return { order: await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: receipt.purchaseOrderId } }), receipts,
      batches: await prisma.productBatch.findMany({ where: { id: { in: batchIds } }, orderBy: { id: 'asc' } }),
      balances: await prisma.stockBalance.findMany({ where: { batchNo: { in: batchNos } }, orderBy: { id: 'asc' } }),
      entries: await prisma.stockEntry.findMany({ where: { sourceRef: { in: batchNos } }, orderBy: { id: 'asc' } }),
      movements: await prisma.stockMovement.findMany({ where: { batchNo: { in: batchNos } }, orderBy: { id: 'asc' } }),
      costs: await prisma.inventoryCostLedger.findMany({ where: { batchId: { in: batchIds } }, orderBy: { id: 'asc' } }), qualityChecks, payments,
      audits: await prisma.auditLog.findMany({ where: { OR: [{ resource: 'purchase_order', resourceId: receipt.purchaseOrderId },
        { resource: 'incoming_quality', resourceId: { in: qualityChecks.map(r => r.id) } }, { resource: 'supplier_payment', resourceId: { in: payments.map(r => r.id) } }] }, orderBy: { id: 'asc' } }),
      customerPayments: await prisma.paymentRecord.findMany({ orderBy: { id: 'asc' } }),
      receivableAdjustments: await prisma.receivableAdjustment.findMany({ orderBy: { id: 'asc' } }),
    };
  };
  const paymentInput = { amountNative: 2, currency: 'USD', method: 'bank_transfer', date: new Date().toISOString().slice(0, 10),
    paymentAccountRef: `${runId}-Browser-Account-MixedCase`, externalTransactionRef: `${runId}-Browser-Advice-MixedCase`,
    evidenceRef: `${runId}-browser-archived-bank-advice`, note: 'Actual isolated browser external payment registration; no bank execution' };
  const deny = async phase => {
    const checkId = e.qcWrite?.body.data.submission.inspection.id, paymentId = e.lostAck?.ownerResponse.body.data.payment.id;
    for (const operation of deniedOperations(receiptId, checkId, paymentId).filter(r => r.phase === phase)) {
      signal.throwIfAborted();
      const result = await request(operation.endpoint, { actor: people[operation.job], instance: operation.instance, method: operation.method,
        signal, headers: operation.operation === 'record-payment' ? { 'Idempotency-Key': `${runId}-forbidden-browser-payment-${operation.instance}` } : {},
        data: operation.method === 'POST' ? operation.operation === 'record-payment' ? paymentInput
          : operation.operation === 'submit-qc' ? { sampleNo: `${runId}-forbidden`, measurements: [{ code: 'PH', unit: null, measuredNumeric: '7.5', measuredText: null, instrumentNo: `${runId}-forbidden` }] }
            : operation.operation === 'review-qc' ? { expectedRevision: 1, decision: 'released', reason: 'Inspector lacks independent QA permission' } : {} : undefined });
      e.denied.push({ ...operation, actorId: people[operation.job].id, status: result.status, body: result.json });
      assert.equal(result.status, 403, `${operation.job} ${operation.operation}: ${JSON.stringify(result.json)}`);
    }
  };
  const profile = user => ({ id: Number(user.id), role: user.role, permissions: [...user.permissions].sort(), dataScopes: [...user.dataScopes].sort() });
  const load = async (job, reload = false) => {
    const page = pages[job], instance = ['qa', 'verifier'].includes(job) ? 1 : 0;
    const auth = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/me' && r.request().method() === 'GET');
    if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
    else await page.goto(`${urls[instance].replace(/\/$/, '')}/#${['qc', 'qa'].includes(job) ? 'procurement' : 'financeAnalytics'}`, { waitUntil: 'domcontentloaded' });
    const observed = await auth; assert.equal(observed.status(), 200);
    const user = (await observed.json()).data; assert.deepEqual(profile(user), profile(people[job].user));
    e.browserProfiles.push({ job, instance, endpoint: '/api/auth/me', url: observed.url(), status: observed.status(), actual: profile(user) });
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.getByTestId(['qc', 'qa'].includes(job) ? 'incoming-quality-workspace' : 'supplier-payables-panel').waitFor({ state: 'visible' });
    return page;
  };
  const clickWrite = async (job, testId, endpoint) => {
    const page = pages[job]; const response = page.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.request().method() === 'POST');
    await page.getByTestId(testId).click(); const observed = await response, req = observed.request();
    return { actorId: people[job].id, instance: ['qa', 'verifier'].includes(job) ? 1 : 0, endpoint, method: req.method(),
      request: req.postDataJSON(), requestKey: req.headers()['idempotency-key'] || null, status: observed.status(), body: await observed.json() };
  };
  const capture = async (job, name = job) => {
    const page = pages[job], selector = ['qc', 'qa'].includes(job) ? '[data-testid="incoming-quality-workspace"]' : '[data-testid="supplier-payment-detail"]';
    const panel = page.locator(selector); await panel.scrollIntoViewIfNeeded();
    const unobscured = await panel.evaluate(element => {
      const r = element.getBoundingClientRect(), x = Math.max(1, Math.min(innerWidth - 2, r.left + r.width / 2)), y = Math.max(1, Math.min(innerHeight - 2, r.top + 16));
      const hit = document.elementFromPoint(x, y); return Boolean(hit && (element.contains(hit) || hit.contains(element)));
    });
    const screenshot = path.join(folder, `${name}.png`), text = await panel.innerText();
    const font = await verifyRenderedCjk(page, selector), dialogCount = await page.locator('[aria-modal="true"]:visible').count();
    assert.equal(dialogCount, 0); assert(unobscured, `${job} panel is obscured`); await page.screenshot({ path: screenshot, fullPage: true });
    const amounts = ['recorder', 'verifier'].includes(job) ? await page.getByTestId('supplier-payment-amounts').locator(':scope > div').evaluateAll(rows =>
      rows.map(row => ({ label: row.querySelector('dt')?.innerText || '', text: (row.querySelector('dd')?.innerText || '').replace(/\s+/g, ' ').trim() }))) : null;
    const amountsScreenshot = amounts ? path.join(folder, `${name}-amounts.png`) : null;
    if (amountsScreenshot) await page.getByTestId('supplier-payment-amounts').screenshot({ path: amountsScreenshot });
    return { job, actorId: people[job].id, instance: ['qa', 'verifier'].includes(job) ? 1 : 0, text, amounts, amountsScreenshot, font, screenshot, dialogCount, unobscured };
  };
  try {
    for (const [job, definition] of Object.entries(definitions)) {
      const role = `${runId.replace(/-/g, '_')}_incoming_${job}`, username = `${runId}_incoming_${job}`;
      dataOf(await request('/roles', { method: 'POST', signal, data: { code: role, name: `Actual browser ${job}`, ...definition, isActive: true } }));
      await ensureUiAuditUser({ username, password, role, segment: 'mixed' });
      const login = dataOf(await request('/auth/login', { actor: null, method: 'POST', signal, data: { username, password } }));
      people[job] = { id: Number(login.user.id), token: login.token, role, user: login.user };
      e.actors.push({ job, ...profile(login.user) });
    }
    e.before = await snap(); await deny('before'); e.afterDenied = await snap();
    browser = (await launchBrowserWithGuard({ launchTimeoutMs: 15000, totalTimeoutMs: 30000, maxAttemptsPerStrategy: 1 })).browser;
    signal.addEventListener('abort', abort, { once: true });
    for (const [job, actor] of Object.entries(people)) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } }); contexts.push(context);
      const page = pages[job] = await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
      const instance = ['qa', 'verifier'].includes(job) ? 1 : 0;
      page.on('request', req => { const endpoint = new URL(req.url()).pathname; if (endpoint.startsWith('/api/')) e.browserRequests.push({ job, instance, method: req.method(), endpoint, url: req.url() }); });
      page.on('pageerror', error => e.errors.push({ job, kind: 'pageerror', message: error.message }));
      page.on('console', message => { if (message.type() !== 'error') return;
        const endpoint = `/api/procurement/receipts/${receiptId}/payments`;
        const locationUrl = message.location().url; let locationPath = null;
        try { locationPath = new URL(locationUrl).pathname; } catch { /* A missing location is not proof of our exact forced fault. */ }
        if (job === 'recorder' && droppingOwner && /net::ERR_(FAILED|CONNECTION_FAILED)/.test(message.text()) && locationPath === endpoint) {
          e.expectedTransportErrors.push({ job, kind: 'console', endpoint, locationUrl, message: message.text() });
        } else e.errors.push({ job, kind: 'console', locationUrl, message: message.text() });
      });
      page.on('requestfailed', req => {
        const endpoint = new URL(req.url()).pathname, error = req.failure()?.errorText || '';
        if (job === 'recorder' && droppingOwner && req.method() === 'POST' && endpoint === `/api/procurement/receipts/${receiptId}/payments`) {
          e.expectedTransportErrors.push({ job, kind: 'requestfailed', method: req.method(), endpoint, message: error });
        } else if (job === 'recorder' && reloadingRecorder && req.method() === 'POST' && endpoint === '/api/rum/vitals' && error === 'net::ERR_ABORTED') {
          e.recoveryCancelledTelemetry.push({ job, method: req.method(), endpoint, message: error, duringForcedReload: true, observedNs: process.hrtime.bigint().toString() });
        } else if (req.method() === 'GET' && /ERR_ABORTED/.test(error)) e.cancelledRequests.push({ job, endpoint, message: error });
        else e.errors.push({ job, kind: 'requestfailed', endpoint, message: error });
      });
      page.on('response', response => { const endpoint = new URL(response.url()).pathname; if (!endpoint.startsWith('/api/')) return;
        const task = (async () => { if (response.status() >= 400) e.errors.push({ job, kind: 'http', endpoint, status: response.status(), body: await safeJson(response) }); })();
        pendingResponseReads.add(task); void task.finally(() => pendingResponseReads.delete(task));
      });
      await page.addInitScript(({ token, user }) => {
        for (const key of ['token', 'auth_token', 'erp_auth_token']) localStorage.setItem(key, token);
        for (const key of ['user', 'currentUser', 'erp_current_user']) localStorage.setItem(key, JSON.stringify(user));
        localStorage.setItem('ailao.language', 'zh'); localStorage.setItem('language', 'zh-CN');
      }, { token: actor.token, user: { ...actor.user, id: String(actor.id), segment: 'mixed' } });
    }
    const qc = await load('qc'); await qc.getByTestId(`incoming-quality-select-${receiptId}`).click();
    const spec = JSON.parse(receipt.incomingQualityPlanJson).plan;
    const standard = qc.getByText(`冻结标准：${spec.specificationRef} / ${spec.specificationRevision}`, { exact: true });
    await standard.waitFor({ state: 'visible' }); e.frozenStandardText = await standard.innerText();
    assert.equal(await qc.getByTestId('incoming-quality-release').count(), 0);
    await qc.getByTestId('incoming-quality-sample').fill(`${runId}-browser-retained-sample`);
    await qc.getByTestId('incoming-quality-value-PH').fill('7.5'); await qc.getByTestId('incoming-quality-instrument-PH').fill(`${runId}-browser-PH-1`);
    await qc.getByTestId('incoming-quality-note').fill('Actual isolated browser measured retained sample');
    e.qcWrite = await clickWrite('qc', 'incoming-quality-submit', `/api/procurement/receipts/${receiptId}/quality-checks`);
    assert.equal(e.qcWrite.status, 201, JSON.stringify(e.qcWrite.body));
    const check = e.qcWrite.body.data.submission.inspection;
    await qc.getByTestId(`incoming-quality-check-${check.id}`).waitFor(); e.afterQC = await snap();
    await deny('qc'); e.afterQcDenied = await snap();
    const qa = await load('qa'); await qa.getByTestId(`incoming-quality-select-${receiptId}`).click();
    assert.equal(await qa.getByTestId('incoming-quality-submit').count(), 0);
    const reason = 'Independent least-privilege QA browser reviewed frozen pH specification and actual retained sample';
    await qa.getByTestId('incoming-quality-review-reason').fill(reason);
    e.qaWrite = await clickWrite('qa', 'incoming-quality-release', `/api/procurement/quality-checks/${check.id}/review`);
    assert.equal(e.qaWrite.status, 200, JSON.stringify(e.qaWrite.body));
    await qa.getByTestId('incoming-quality-notice').filter({ hasText: /核对|保存/ }).waitFor(); e.afterQA = await snap();
    const recorder = await load('recorder'); await recorder.getByTestId(`supplier-payable-open-${receiptId}`).click();
    await recorder.getByTestId('supplier-payment-amounts').waitFor();
    for (const [name, value] of [['amount', '2.00'], ['date', paymentInput.date], ['account', paymentInput.paymentAccountRef],
      ['transaction', paymentInput.externalTransactionRef], ['evidence', paymentInput.evidenceRef], ['note', paymentInput.note]]) {
      await recorder.getByTestId(`supplier-payment-${name}`).fill(value);
    }
    await recorder.getByTestId('supplier-payment-method').selectOption(paymentInput.method);
    e.lostAck = { transportOrderNs: [], realReload: false }; const recovery = e.lostAck;
    const paymentEndpoint = `/api/procurement/receipts/${receiptId}/payments`, routePattern = `**${paymentEndpoint}`;
    const slot = `ailaoda.supplier-payment-intent/v1.${people.recorder.id}.${receiptId}`;
    let resolveOwner, rejectOwner, ownerTimer;
    const ownerDone = new Promise((resolve, reject) => { resolveOwner = resolve; rejectOwner = reject; ownerTimer = setTimeout(() => reject(Error('Committed supplier payment ACK-drop probe exceeded 20 seconds')), 20000); });
    const dropAck = async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      try {
        const req = route.request(); recovery.firstRequest = { instance: 0, endpoint: paymentEndpoint, method: req.method(), requestKey: req.headers()['idempotency-key'], request: req.postDataJSON() };
        const response = await route.fetch({ timeout: 15000 }); recovery.transportOrderNs.push(process.hrtime.bigint().toString());
        recovery.ownerResponse = { status: response.status(), body: await response.json() }; assert.equal(response.status(), 201, JSON.stringify(recovery.ownerResponse.body));
        assert.equal(recovery.ownerResponse.body.data.replayed, false); assert.deepEqual(recovery.firstRequest.request, paymentInput);
        await route.abort('connectionfailed'); recovery.transportOrderNs.push(process.hrtime.bigint().toString()); resolveOwner();
      } catch (error) { await route.abort('failed').catch(() => {}); rejectOwner(error); }
    };
    droppingOwner = true; await recorder.route(routePattern, dropAck, { times: 1 });
    try { await Promise.all([recorder.getByTestId('supplier-payment-register').click(), ownerDone]); }
    finally { clearTimeout(ownerTimer); await recorder.unroute(routePattern, dropAck); }
    await recorder.getByTestId('supplier-payment-unconfirmed').waitFor({ state: 'visible' });
    recovery.beforeRefreshIntent = JSON.parse(await recorder.evaluate(key => localStorage.getItem(key), slot));
    const fields = ['amount', 'date', 'method', 'account', 'transaction', 'evidence', 'note']; recovery.fieldValues = [];
    for (const name of fields) { const field = recorder.getByTestId(`supplier-payment-${name}`); assert(await field.isDisabled()); recovery.fieldValues.push(await field.inputValue()); }
    recovery.disabledFieldCount = fields.length; e.afterOwner = await snap(); await deny('owner'); e.afterOwnerDenied = await snap();
    assert.equal(await recorder.getByTestId(`supplier-payment-verify-${recovery.ownerResponse.body.data.payment.id}`).count(), 0);
    recovery.unknownScreenshot = await capture('recorder', 'recorder-ack-unknown'); droppingOwner = false;
    let resolveRead, rejectRead, readTimer;
    const readDone = new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; readTimer = setTimeout(() => reject(Error('Supplier payment durable read-back exceeded 20 seconds')), 20000); });
    const holdReadback = async route => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      try {
        const response = await route.fetch({ timeout: 15000 }); recovery.independentReadback = { status: response.status(), body: await response.json() };
        recovery.intentAtReadbackDelivery = JSON.parse(await recorder.evaluate(key => localStorage.getItem(key), slot));
        recovery.editableFieldsBeforeReadback = await recorder.getByTestId('supplier-payment-detail').locator('input:enabled,textarea:enabled,select:enabled').count();
        recovery.transportOrderNs.push(process.hrtime.bigint().toString());
        await route.fulfill({ response }); resolveRead();
      } catch (error) { await route.abort('failed').catch(() => {}); rejectRead(error); }
    };
    await recorder.route(routePattern, holdReadback, { times: 1 });
    const dialogs = [], acceptReload = dialog => { dialogs.push(dialog.type()); void dialog.accept(); }; recorder.on('dialog', acceptReload);
    try {
      reloadingRecorder = true; recovery.reloadWindowStartNs = process.hrtime.bigint().toString();
      try { await load('recorder', true); recovery.realReload = true; }
      finally { recovery.reloadWindowEndNs = process.hrtime.bigint().toString(); reloadingRecorder = false; }
      await recorder.getByTestId(`supplier-payable-open-${receiptId}`).click(); await readDone;
    } finally { clearTimeout(readTimer); recorder.off('dialog', acceptReload); await recorder.unroute(routePattern, holdReadback); }
    recovery.refreshDialogs = dialogs; assert(dialogs.every(type => type === 'beforeunload'));
    const paymentId = recovery.ownerResponse.body.data.payment.id;
    await recorder.getByTestId(`supplier-payment-${paymentId}`).waitFor();
    await recorder.waitForFunction(key => localStorage.getItem(key) === null, slot);
    recovery.afterReadbackIntent = await recorder.evaluate(key => localStorage.getItem(key), slot); recovery.transportOrderNs.push(process.hrtime.bigint().toString());
    assert.equal(await recorder.getByTestId('supplier-payment-unconfirmed').count(), 0); e.afterReadback = await snap();
    const verifier = await load('verifier'); await verifier.getByTestId(`supplier-payable-open-${receiptId}`).click();
    await verifier.getByTestId(`supplier-payment-verify-${paymentId}`).waitFor(); assert.equal(await verifier.getByTestId('supplier-payment-register').count(), 0);
    e.verifyWrite = await clickWrite('verifier', `supplier-payment-verify-${paymentId}`, `/api/procurement/supplier-payments/${paymentId}/verify`);
    assert.equal(e.verifyWrite.status, 200, JSON.stringify(e.verifyWrite.body));
    await verifier.getByTestId(`supplier-payment-${paymentId}`).filter({ hasText: '已核实外部付款' }).waitFor();
    e.after = await snap(); e.readbacks = { quality: [], payments: [] };
    for (const instance of [0, 1]) {
      e.readbacks.quality.push({ instance, data: dataOf(await request(`/procurement/receipts/${receiptId}/quality`, { actor: people.qc, instance, signal })) });
      e.readbacks.payments.push({ instance, data: dataOf(await request(`/procurement/receipts/${receiptId}/payments`, { actor: people.recorder, instance, signal })) });
    }
    for (const job of ['qc', 'qa', 'recorder', 'verifier']) {
      if (['qc', 'qa'].includes(job)) { await pages[job].getByTestId('incoming-quality-refresh').click(); await pages[job].getByText('最新检验已独立 QA 放行', { exact: true }).waitFor(); }
      else { await pages[job].getByTestId('supplier-payables-refresh').click(); await pages[job].getByTestId(`supplier-payment-${paymentId}`).filter({ hasText: '已核实外部付款' }).waitFor(); }
      e.screenshots.push(await capture(job));
    }
    await Promise.all([...pendingResponseReads]); verifyPurchaseQualityBrowserProof(e); return e;
  } catch (error) {
    if (browser) for (const [job, page] of Object.entries(pages)) await page.screenshot({ path: path.join(folder, `failure-${job}.png`), fullPage: true }).catch(() => {});
    error.evidence = e; throw error;
  } finally { signal.removeEventListener('abort', abort); for (const context of contexts) await context.close().catch(() => {}); if (browser) await browser.close(); }
}
module.exports = { purchaseQualityPayablesBrowser, verifyPurchaseQualityBrowserProof };
