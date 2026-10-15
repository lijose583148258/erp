const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { expect } = require('playwright/test');
const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
const { loginUiAuditUser } = require('./ui-audit-user.cjs');

// Real boundary reproduction, using the existing partial-delivery runtime and
// fixture. This admin diagnostic does not prove real sales roles/reservations.
async function probeShipmentSubmission(ctx, report) {
  const { prisma, request, dataOf, order, original, material, customer, batchNo, runId, password, urls, onLogin, salesToken, adminToken } = ctx;
  const folder = path.join(path.dirname(process.env.ROUND2_REPORT_PATH), 'shipment-submission');
  fs.mkdirSync(folder, { recursive: true });
  const e = report.shipmentSubmission = { version: 'shipment-submission-probe/v1', scope: 'Actual lost POST ACK + reload and audit rollback diagnostic; admin fixture, not full sales/reservation/workforce acceptance',
    failures: [], browserPosts: [], screenshots: [] };
  const state = async orderId => ({
    shipments: await prisma.shipment.findMany({ where: { orderId: Number(orderId) }, orderBy: { id: 'asc' } }),
    balances: await prisma.stockBalance.findMany({ where: { materialId: material.id, batchNo }, orderBy: { id: 'asc' } }),
    batch: await prisma.productBatch.findUnique({ where: { batchNo } }),
    costs: await prisma.inventoryCostLedger.findMany({ where: { productBatch: { batchNo } }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { resource: 'shipment', resourceId: { in: (await prisma.shipment.findMany({ where: { orderId: Number(orderId) }, select: { id: true } })).map(s => s.id) } }, orderBy: { id: 'asc' } }),
  });
  const payload = (orderId, orderItemId, quantity) => ({ customerId: Number(customer.id), orderId: Number(orderId), orderItemId: Number(orderItemId),
    materialId: material.id, productName: material.nameZh, quantity, unit: 'kg', batchNo });
  onLogin(salesToken);
  const faultOrder = dataOf(await request('/orders', { method: 'POST', data: { customerId: Number(customer.id),
    items: [{ materialId: material.id, productName: material.nameZh, quantity: 1, unit: 'kg', unitPrice: 10 }], paymentTerms: 30 } }));
  onLogin(adminToken);
  dataOf(await request(`/orders/${faultOrder.id}/status`, { method: 'PATCH', data: { status: 'confirmed' } }));
  const faultLine = dataOf(await request(`/orders/${faultOrder.id}`)).items[0];
  e.beforeAuditFault = await state(faultOrder.id);
  const trigger = `shipment_audit_fault_${Date.now()}`, pg = process.env.AUDIT_PRISMA_PROVIDER === 'postgresql';
  try {
    if (pg) {
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic shipment audit unavailable'; END; $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.resource='shipment' AND NEW.action='CREATE') EXECUTE FUNCTION ${trigger}()`);
    } else await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs WHEN NEW.resource='shipment' AND NEW.action='CREATE' BEGIN SELECT RAISE(ABORT,'Synthetic shipment audit unavailable'); END`);
    e.auditFaultResponse = await request('/shipping', { method: 'POST', data: payload(faultOrder.id, faultLine.id, 1) });
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
    const open = async () => {
      await page.locator('#loading').waitFor({ state: 'hidden' });
      await page.getByTestId('sales-desk-fulfillment').click(); await page.getByTestId('sales-order-search').fill(order.orderNo);
      await page.getByTestId(`sales-order-ship-${order.id}`).click();
      await expect(page.getByTestId('sales-order-shipment-modal')).toBeVisible();
      await page.getByTestId('sales-order-shipment-line').selectOption(String(original.items[0].id));
      await page.getByTestId('sales-order-shipment-quantity').fill('40'); await page.getByTestId('sales-order-shipment-batch').fill(batchNo);
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
    await page.reload({ waitUntil: 'domcontentloaded' }); await open();
    e.afterReloadForm = { submitEnabled: await page.getByTestId('sales-order-shipment-create').isEnabled(), text: await page.getByTestId('sales-order-shipment-modal').innerText() };
    const second = page.waitForResponse(response => new URL(response.url()).pathname === '/api/shipping' && response.request().method() === 'POST');
    await page.getByTestId('sales-order-shipment-create').click(); const response = await second;
    const repeated = { status: response.status(), json: await response.json(), sent: response.request().postDataJSON(),
      requestKeyHeader: response.request().headers()['idempotency-key'] || null }; e.browserPosts.push(repeated);
    assert([200, 201].includes(repeated.status), JSON.stringify(repeated)); assert(repeated.json.data?.id);
    e.after = await state(order.id); await shot('after-repeated-create');
    if (String(owner.json.data.id) !== String(repeated.json.data?.id) || e.after.shipments.length !== 1) e.failures.push('UNKNOWN_ACK_REFRESH_CREATED_ANOTHER_SHIPMENT');
    if (!owner.sent.idempotencyKey && !owner.requestKeyHeader) e.failures.push('SHIPMENT_UI_HAS_NO_DURABLE_REQUEST_IDENTITY');
    for (const key of ['balances', 'batch', 'costs']) assert.deepEqual(e.after[key], e.before[key], 'A draft must not consume stock or book cost');
    assert.equal(e.after.shipments.reduce((sum, row) => sum + Number(row.quantity), 0) <= 100, true, 'Reproduction must stay within the real100 order limit');
    assert.deepEqual(e.failures, [], 'Shipment submission must be durable and its CREATE audit atomic');
  } finally { await browser.close(); }
}
module.exports = { probeShipmentSubmission };
