const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { expect } = require('playwright/test');
const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
const { loginUiAuditUser, ensureUiAuditUser } = require('./ui-audit-user.cjs');
const { selectMaterialCombobox } = require('./material-audit-fixture.cjs');

// Real boundary reproduction, using the existing partial-delivery runtime and
// fixture. This admin diagnostic does not prove real sales roles/reservations.
async function probeShipmentSubmission(ctx, report) {
  const { prisma, request, dataOf, order, original, material, customer, batchNo, runId, password, urls, onLogin, salesToken, adminToken } = ctx;
  const folder = path.join(path.dirname(process.env.ROUND2_REPORT_PATH), 'shipment-submission');
  fs.mkdirSync(folder, { recursive: true });
  const e = report.shipmentSubmission = { version: 'shipment-submission-probe/v2', scope: 'Actual lost POST ACK + reload, original request recovery, two-node replay and audit rollback; admin fixture, not full sales/reservation/workforce acceptance',
    failures: [], browserPosts: [], screenshots: [] };
  const state = async orderId => ({
    shipments: await prisma.shipment.findMany({ where: { orderId: orderId === null ? null : Number(orderId) }, orderBy: { id: 'asc' } }),
    balances: await prisma.stockBalance.findMany({ where: { materialId: material.id, batchNo }, orderBy: { id: 'asc' } }),
    batch: await prisma.productBatch.findUnique({ where: { batchNo } }),
    costs: await prisma.inventoryCostLedger.findMany({ where: { productBatch: { batchNo } }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { resource: 'shipment', resourceId: { in: (await prisma.shipment.findMany({ where: { orderId: orderId === null ? null : Number(orderId) }, select: { id: true } })).map(s => s.id) } }, orderBy: { id: 'asc' } }),
  });
  const payload = (orderId, orderItemId, quantity) => ({ customerId: Number(customer.id), orderId: Number(orderId), orderItemId: Number(orderItemId),
    materialId: material.id, productName: material.nameZh, quantity, unit: 'kg', batchNo });
  onLogin(salesToken);
  const faultOrder = dataOf(await request('/orders', { method: 'POST', data: { customerId: Number(customer.id),
    items: [{ materialId: material.id, productName: material.nameZh, quantity: 1, unit: 'kg', unitPrice: 10 }], paymentTerms: 30 } }));
  onLogin(adminToken);
  dataOf(await request(`/orders/${faultOrder.id}/status`, { method: 'PATCH', data: { status: 'confirmed' } }));
  const faultLine = dataOf(await request(`/orders/${faultOrder.id}`)).items[0];
  const faultPayload = { ...payload(faultOrder.id, faultLine.id, 1), idempotencyKey: `${runId}-audit-fault` };
  e.beforeAuditFault = await state(faultOrder.id);
  const trigger = `shipment_audit_fault_${Date.now()}`, pg = process.env.AUDIT_PRISMA_PROVIDER === 'postgresql';
  try {
    if (pg) {
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic shipment audit unavailable'; END; $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.resource='shipment' AND NEW.action='CREATE') EXECUTE FUNCTION ${trigger}()`);
    } else await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs WHEN NEW.resource='shipment' AND NEW.action='CREATE' BEGIN SELECT RAISE(ABORT,'Synthetic shipment audit unavailable'); END`);
    e.auditFaultResponse = await request('/shipping', { method: 'POST', data: faultPayload });
    assert.equal(e.auditFaultResponse.status, 500, JSON.stringify(e.auditFaultResponse));
  } finally {
    await prisma.$executeRawUnsafe(pg ? `DROP TRIGGER IF EXISTS ${trigger} ON audit_logs` : `DROP TRIGGER IF EXISTS ${trigger}`);
    if (pg) await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`);
  }
  e.afterAuditFault = await state(faultOrder.id);
  if (e.afterAuditFault.shipments.length !== e.beforeAuditFault.shipments.length) e.failures.push('SHIPMENT_COMMITTED_WITHOUT_CREATION_AUDIT');

  const browser = (await launchBrowserWithGuard({ retryLimit: 1 })).browser;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
  try {
    const login = await loginUiAuditUser(page, `${urls[0]}/`, { account: { username: runId, password, role: 'admin', segment: 'mixed' },
      storage: { 'ailao.language': 'zh', language: 'zh-CN' } });
    onLogin(login.token); e.actor = { id: Number(login.user.id), role: login.user.role };
    const open = async (fill = true, target = order, line = original.items[0]) => {
      await page.locator('#loading').waitFor({ state: 'hidden' });
      await page.getByTestId('sales-desk-fulfillment').click(); await page.getByTestId('sales-order-search').fill(target.orderNo);
      await page.getByTestId(`sales-order-ship-${target.id}`).click();
      await expect(page.getByTestId('sales-order-shipment-modal')).toBeVisible();
      if (fill) {
        await page.getByTestId('sales-order-shipment-line').selectOption(String(line.id));
        await page.getByTestId('sales-order-shipment-quantity').fill('40'); await page.getByTestId('sales-order-shipment-batch').fill(batchNo);
      }
    };
    await page.goto(`${urls[0]}/#orders`, { waitUntil: 'domcontentloaded' }); await open(); e.before = await state(order.id);
    let release; const intercepted = new Promise(resolve => { release = resolve; }); let owner;
    const failed = page.waitForEvent('requestfailed', { predicate: req => new URL(req.url()).pathname === '/api/shipping' && req.method() === 'POST' });
    await page.route('**/api/shipping', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      try {
        const response = await route.fetch(); owner = { status: response.status(), json: await response.json(), sent: route.request().postDataJSON(),
          requestKeyHeader: route.request().headers()['idempotency-key'] || null };
        e.browserPosts.push(owner); await route.abort('failed');
      } finally { release(); }
    });
    await page.getByTestId('sales-order-shipment-create').click(); await intercepted; await failed;
    assert.equal(owner.status, 201, JSON.stringify(owner));
    await expect(page.getByTestId('sales-order-shipment-create')).toBeDisabled(); e.afterOwner = await state(order.id);
    const shot = async name => { const file = path.join(folder, `${name}.png`); await page.screenshot({ path: file }); e.screenshots.push(file); };
    await shot('unknown-ack'); await page.unroute('**/api/shipping');
    await page.reload({ waitUntil: 'domcontentloaded' }); await open(false);
    e.afterReloadForm = { submitEnabled: await page.getByTestId('sales-order-shipment-create').isEnabled(), text: await page.getByTestId('sales-order-shipment-modal').innerText() };
    await expect(page.getByTestId('sales-order-shipment-create')).toBeDisabled();
    await expect(page.getByTestId('sales-order-shipment-quantity')).toHaveValue('40');
    await expect(page.getByTestId('sales-order-shipment-quantity')).toBeDisabled();
    const key = owner.requestKeyHeader; assert(key, 'Native creation must carry a durable request identity');
    const second = page.waitForResponse(response => new URL(response.url()).pathname === `/api/shipping/submissions/${key}` && response.request().method() === 'GET');
    await page.getByTestId('sales-order-shipment-recover').click(); const response = await second;
    const repeated = { status: response.status(), json: await response.json() }; e.browserRecovery = repeated;
    assert.equal(repeated.status, 200, JSON.stringify(repeated));
    assert.deepEqual(repeated.json.submission, owner.json.submission);
    await expect(page.getByTestId('sales-order-shipment-success')).toContainText(owner.json.data.shipmentNo);
    e.after = await state(order.id); await shot('after-repeated-create');
    if (String(owner.json.data.id) !== String(repeated.json.data?.id) || e.after.shipments.length !== 1) e.failures.push('UNKNOWN_ACK_REFRESH_CREATED_ANOTHER_SHIPMENT');
    if (!owner.sent.idempotencyKey && !owner.requestKeyHeader) e.failures.push('SHIPMENT_UI_HAS_NO_DURABLE_REQUEST_IDENTITY');
    for (const key of ['balances', 'batch', 'costs']) assert.deepEqual(e.after[key], e.before[key], 'A draft must not consume stock or book cost');
    assert.deepEqual(e.after, e.afterOwner, 'Native recovery must not write anything again');
    e.apiReplay = await request('/shipping', { method: 'POST', instance: 1, data: { ...owner.sent, idempotencyKey: key } });
    assert.equal(e.apiReplay.status, 200); assert.deepEqual(e.apiReplay.json.submission, owner.json.submission);
    e.alteredReplay = await request('/shipping', { method: 'POST', instance: 1, data: { ...owner.sent, quantity: 39, idempotencyKey: key } });
    assert.equal(e.alteredReplay.status, 409); assert.equal(e.alteredReplay.json.errorCode, 'SHIPMENT_SUBMISSION_CONFLICT');
    await ensureUiAuditUser({ username: `${runId}-other-shipper`, password, role: 'admin', segment: 'mixed' });
    const other = dataOf(await request('/auth/login', { method: 'POST', data: { username: `${runId}-other-shipper`, password } }));
    e.otherActor = { id: Number(other.user.id), role: other.user.role }; assert.notEqual(e.otherActor.id, e.actor.id);
    onLogin(other.token);
    e.foreignLookup = await request(`/shipping/submissions/${key}`, { instance: 1 });
    assert.equal(e.foreignLookup.status, 404, JSON.stringify(e.foreignLookup));
    e.foreignReplay = await request('/shipping', { method: 'POST', instance: 1, data: { ...owner.sent, idempotencyKey: key } });
    assert.equal(e.foreignReplay.status, 409); assert.equal(e.foreignReplay.json.errorCode, 'SHIPMENT_SUBMISSION_CONFLICT'); onLogin(login.token);
    assert.deepEqual(await state(order.id), e.afterOwner, 'Replay, changed content and foreign lookup cannot write stock, audit or a second shipment');
    e.concurrentReplays = await Promise.all(Array.from({ length: 8 }, (_, n) => request('/shipping', { method: 'POST', instance: n % 2, data: { ...owner.sent, idempotencyKey: key } })));
    for (const replay of e.concurrentReplays) { assert.equal(replay.status, 200); assert.deepEqual(replay.json.submission, owner.json.submission); }
    assert.deepEqual(await state(order.id), e.afterOwner);
    // The first attempt was rolled back before commit: race both nodes on that same original key.
    e.beforeCommitRecovery = await Promise.all([0, 1].map(instance => request('/shipping', { method: 'POST', instance, data: faultPayload })));
    assert.deepEqual(e.beforeCommitRecovery.map(r => r.status).sort(), [200, 201]);
    assert.deepEqual(e.beforeCommitRecovery[0].json.submission, e.beforeCommitRecovery[1].json.submission);
    e.recoveredFault = await state(faultOrder.id); assert.equal(e.recoveredFault.shipments.length, 1); assert.equal(e.recoveredFault.audits.length, 1);
    dataOf(await request(`/shipping/${owner.json.data.id}/status`, { method: 'PATCH', data: { status: 'in_transit' } }));
    e.afterDispatch = await state(order.id);
    assert.equal(e.afterDispatch.balances.reduce((sum, row) => sum + Number(row.quantity), 0), 0);
    e.postDispatchReplay = await request('/shipping', { method: 'POST', instance: 1, data: { ...owner.sent, idempotencyKey: key } });
    assert.equal(e.postDispatchReplay.status, 200); assert.deepEqual(e.postDispatchReplay.json.submission, owner.json.submission);
    e.postDispatchLookup = await request(`/shipping/submissions/${key}`, { instance: 1 });
    assert.equal(e.postDispatchLookup.status, 200); assert.deepEqual(e.postDispatchLookup.json.submission, owner.json.submission);
    assert.deepEqual(await state(order.id), e.afterDispatch, 'An old creation ACK cannot dispatch, rebook cost or mutate later shipment status');
    // A fully allocated line has no "create" eligibility, but must retain its original recovery entry.
    onLogin(salesToken);
    const fullOrder = dataOf(await request('/orders', { method: 'POST', data: { customerId: Number(customer.id),
      items: [{ materialId: material.id, productName: material.nameZh, quantity: 40, unit: 'kg', unitPrice: 10 }], paymentTerms: 30 } }));
    onLogin(login.token); dataOf(await request(`/orders/${fullOrder.id}/status`, { method: 'PATCH', data: { status: 'confirmed' } }));
    const fullLine = dataOf(await request(`/orders/${fullOrder.id}`)).items[0];
    await page.reload({ waitUntil: 'domcontentloaded' }); await open(true, fullOrder, fullLine);
    let fullOwner, resolveFull; const fullIntercepted = new Promise(resolve => { resolveFull = resolve; });
    const fullFailed = page.waitForEvent('requestfailed', { predicate: req => new URL(req.url()).pathname === '/api/shipping' && req.method() === 'POST' });
    await page.route('**/api/shipping', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      try { const response = await route.fetch(); fullOwner = { status: response.status(), json: await response.json(), key: route.request().headers()['idempotency-key'] };
        await route.abort('failed'); } finally { resolveFull(); }
    });
    await page.getByTestId('sales-order-shipment-create').click(); await fullIntercepted; await fullFailed;
    assert.equal(fullOwner.status, 201); await expect(page.getByTestId('sales-order-shipment-recover')).toBeEnabled();
    await page.unroute('**/api/shipping'); await page.reload({ waitUntil: 'domcontentloaded' }); await open(false, fullOrder, fullLine);
    await expect(page.getByTestId('sales-order-shipment-create')).toBeDisabled();
    await page.getByTestId('sales-order-shipment-recover').click();
    await expect(page.getByTestId('sales-order-shipment-success')).toContainText(fullOwner.json.data.shipmentNo);
    e.fullAllocationRecovery = { owner: fullOwner, state: await state(fullOrder.id),
      order: dataOf(await request(`/orders/${fullOrder.id}`)), text: await page.getByTestId('sales-order-shipment-modal').innerText() };
    assert.equal(e.fullAllocationRecovery.state.shipments.length, 1);
    assert.equal(e.fullAllocationRecovery.order.fulfillment.lines[0].unallocatedQuantity, 0);
    await shot('full-allocation-recovered');
    // Exercise the second live create caller instead of leaving OCR as an ungoverned bypass.
    await page.goto(`${urls[0]}/#shipping`, { waitUntil: 'domcontentloaded' }); await page.getByTestId('shipping-desk-ocr').click();
    await page.getByTestId('shipping-ocr-textarea').fill(`客户名称: ${runId}\n产品: ${material.nameZh}\n数量: 1\n单位: kg\n批号: ${batchNo}`);
    await page.getByTestId('shipping-ocr-parse-button').click();
    await selectMaterialCombobox(page, 'shipping-ocr-material-input', material.code, material.nameZh);
    let ocrOwner, resolveOcr; const ocrIntercepted = new Promise(resolve => { resolveOcr = resolve; });
    const ocrFailed = page.waitForEvent('requestfailed', { predicate: req => new URL(req.url()).pathname === '/api/shipping' && req.method() === 'POST' });
    await page.route('**/api/shipping', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      try { const response = await route.fetch(); ocrOwner = { status: response.status(), json: await response.json(), key: route.request().headers()['idempotency-key'] };
        await route.abort('failed'); } finally { resolveOcr(); }
    });
    e.beforeOcr = await state(null);
    await page.getByTestId('shipping-ocr-apply-button').click(); await ocrIntercepted; await ocrFailed; assert.equal(ocrOwner.status, 201);
    await expect(page.getByTestId('shipping-ocr-recover')).toBeEnabled(); await page.unroute('**/api/shipping');
    const beforeOcrReload = await state(null);
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByTestId('shipping-desk-ocr').click();
    await expect(page.getByTestId('shipping-ocr-original-request')).toContainText(material.nameZh);
    const ocrRead = page.waitForResponse(response => new URL(response.url()).pathname === `/api/shipping/submissions/${ocrOwner.key}`);
    await page.getByTestId('shipping-ocr-recover').click(); const ocrResponse = await ocrRead;
    e.ocrRecovery = { owner: ocrOwner, recovered: { status: ocrResponse.status(), json: await ocrResponse.json() }, after: await state(null) };
    assert.equal(e.ocrRecovery.recovered.status, 200); assert.deepEqual(e.ocrRecovery.recovered.json.submission, ocrOwner.json.submission);
    await expect(page.getByTestId('shipping-ocr-original-request')).toHaveCount(0);
    assert.deepEqual(e.ocrRecovery.after, beforeOcrReload);
    assert.equal(e.ocrRecovery.after.shipments.length, e.beforeOcr.shipments.length + 1);
    await shot('ocr-original-recovered');
    assert.equal(e.after.shipments.reduce((sum, row) => sum + Number(row.quantity), 0) <= 100, true, 'Reproduction must stay within the real100 order limit');
    assert.deepEqual(e.failures, [], 'Shipment submission must be durable and its CREATE audit atomic');
  } finally { await browser.close(); }
}
module.exports = { probeShipmentSubmission };
