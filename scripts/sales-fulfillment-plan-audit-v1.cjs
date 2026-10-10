const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { readRegressionStamp } = require('./lib/enterprise-regression.cjs');
const { ensureUiAuditUser, createAuditPrismaClient, loginUiAuditUser } = require('./lib/ui-audit-user.cjs');
const { ensureReleasedMaterial } = require('./lib/material-audit-fixture.cjs');
const { launchBrowserWithGuard } = require('./lib/browser-launch-guard.cjs');
const { expect } = require('playwright/test');
const urls = [process.env.APP_URL, process.env.SECONDARY_APP_URL].map(url => String(url || '').replace(/\/$/, ''));
const file = process.env.ROUND2_REPORT_PATH || path.resolve('output/audit/sales-fulfillment-plan/report.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
const runId = `sfp-${Date.now()}`;
const report = { name: 'Linked purchase fulfillment plan', runId, startedAt: new Date().toISOString(),
  regression: readRegressionStamp(), provider: process.env.AUDIT_PRISMA_PROVIDER || 'sqlite',
  scope: 'linked_purchase_only; no physical reservation or mandatory presale gate; not complete R2-01',
  status: 'failed', summary: { passedChecks: 0, failedChecks: 1, remainingChecks: 0 }, checks: {} };
let prisma, browser, token;
async function request(endpoint, { method = 'GET', data, instance = 0, auth = token } = {}) {
  const r = await fetch(`${urls[instance]}/api${endpoint}`, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15000) });
  return { status: r.status, ok: r.ok, json: await r.json() };
}
function dataOf(r) { assert(r.ok, `HTTP ${r.status}: ${JSON.stringify(r.json)}`); assert(r.json.data); return r.json.data; }
function check(id, condition) { assert(condition, id); report.checks[id] = true; }
async function capture(page, name, target) {
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 10000 });
  await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
  await expect(target).toBeVisible();
  const unobscured = await target.evaluate(element => {
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return !!top && (top === element || element.contains(top));
  });
  await page.screenshot({ path: path.join(path.dirname(file), name) });
  assert(unobscured, `Screenshot target is covered: ${name}`);
  (report.screenshots ||= []).push({ name, loadingHidden: true, unobscured });
}
async function main() {
  assert.equal(process.env.ROUND2_ALLOW_MUTATIONS, 'true');
  assert(urls.every(url => new URL(url).hostname === '127.0.0.1'));
  if (report.provider === 'postgresql') assert.equal(new URL(process.env.AUDIT_DATABASE_URL).hostname, '127.0.0.1');
  else assert(process.env.DATABASE_URL && String(process.env.AILAODA_RUNTIME_DB_PATH).includes('output'));
  prisma = createAuditPrismaClient();
  const password = crypto.randomBytes(24).toString('base64url') + '!Aa1';
  const accounts = { admin: { username: `${runId}-admin`, password, role: 'admin', segment: 'mixed' },
    reviewer: { username: `${runId}-reviewer`, password, role: 'admin', segment: 'mixed' },
    sales: { username: `${runId}-sales`, password, role: 'sales', segment: 'direct' },
    peer: { username: `${runId}-peer`, password, role: 'sales', segment: 'direct' } };
  const actors = {};
  for (const [name, account] of Object.entries(accounts)) {
    await ensureUiAuditUser(account);
    actors[name] = dataOf(await request('/auth/login', { method: 'POST', data: { username: account.username, password }, auth: '' }));
  }
  token = actors.admin.token;
  const material = await ensureReleasedMaterial({ request, code: runId, name: runId, category: 'finished_good', unit: 'kg' });
  const customer = dataOf(await request('/customers', { method: 'POST', data: { name: runId, nameZh: runId, creditLimit: 100000, termsDays: 30,
    segment: 'direct', poolState: 'private', salespersonId: Number(actors.sales.user.id) } }));
  const order = dataOf(await request('/orders', { auth: actors.sales.token, method: 'POST', data: { customerId: Number(customer.id),
    items: [{ materialId: material.id, productName: material.nameZh, quantity: 100, unit: 'kg', unitPrice: 10 }], paymentTerms: 30 } }));
  const original = dataOf(await request(`/orders/${order.id}`));
  const lineId = Number(original.items[0].id);
  const supplier = dataOf(await request('/procurement/suppliers', { method: 'POST', data: { name: runId, category: 'Raw Materials', contact: 'Synthetic' } }));
  const eta = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const delivery = new Date(Date.now() + 4 * 86400000).toISOString();
  const purchase = async () => dataOf(await request('/procurement/orders', { method: 'POST', data: { supplierId: Number(supplier.id), materialId: material.id,
    salesOrderId: Number(order.id), item: material.nameZh, quantity: 100, price: 10, unit: 'kg', eta, currency: 'CNY', status: 'approved' } }));
  const po = await purchase();
  const endpoint = `/orders/${order.id}/fulfillment-plans`;
  const input = { idempotencyKey: `${runId}-first`, orderItemId: lineId, fulfillmentOption: 'linked_purchase', sourceDocumentId: Number(po.id), plannedQuantity: 100, expectedFulfillmentAt: delivery, note: 'Synthetic traceable purchase replenishment' };
  const financialStock = async () => ({ order: await prisma.order.findUnique({ where: { id: Number(order.id) }, include: { items: { orderBy: { id: 'asc' } } } }),
    balances: await prisma.stockBalance.findMany({ where: { materialId: material.id }, orderBy: { id: 'asc' } }),
    ledger: await prisma.inventoryCostLedger.findMany({ where: { productBatch: { materialId: material.id } }, orderBy: { id: 'asc' } }),
    payments: await prisma.paymentRecord.findMany({ where: { orderId: Number(order.id) }, orderBy: { id: 'asc' } }) });
  const snapshot = async () => ({ business: await financialStock(), plans: await prisma.salesFulfillmentPlan.findMany({ where: { orderId: Number(order.id) }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { resource: 'sales_fulfillment_plan', resourceId: { in: (await prisma.salesFulfillmentPlan.findMany({ where: { orderId: Number(order.id) }, select: { id: true } })).map(p => p.id) } }, orderBy: { id: 'asc' } }) });
  report.rejections = [];
  async function reject(name, target, options, status) {
    const before = await snapshot(); const response = await request(target, options);
    assert.equal(response.status, status, `${name}: ${JSON.stringify(response)}`);
    assert.deepEqual(await snapshot(), before, `${name}: rejected write changed persisted state`);
    report.rejections.push({ name, status: response.status, errorCode: response.json.errorCode, unchanged: true });
  }
  report.beforePlan = await financialStock();
  await reject('unsupported substitution option', endpoint, { method: 'POST', data: { ...input, fulfillmentOption: 'substitution' } }, 400);
  await reject('wrong order line', endpoint, { method: 'POST', data: { ...input, orderItemId: lineId + 1000000 } }, 409);
  await reject('missing purchase source', endpoint, { method: 'POST', data: { ...input, sourceDocumentId: Number(po.id) + 1000000 } }, 409);
  await reject('sales peer read scope', endpoint, { auth: actors.peer.token }, 404);
  await reject('sales peer write scope', endpoint, { auth: actors.peer.token, method: 'POST', data: input }, 404);

  ({ browser } = await launchBrowserWithGuard({ launchTimeoutMs: 15000, totalTimeoutMs: 45000, maxAttemptsPerStrategy: 1 }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000);
  const login = await loginUiAuditUser(page, `${urls[0]}/`, { account: accounts.sales, storage: { 'ailao.language': 'zh', language: 'zh-CN' } }); actors.sales.token = login.token;
  async function openPlan() { await page.goto(`${urls[0]}/#orders`); await page.getByTestId('sales-desk-fulfillment').click(); await page.getByTestId(`sales-order-plan-${order.id}`).click(); await expect(page.getByTestId('sales-plan-modal')).toBeVisible(); }
  await openPlan();
  await page.getByTestId('sales-plan-line').selectOption(String(lineId));
  await page.getByTestId('sales-plan-source').fill(String(po.id));
  await page.getByTestId('sales-plan-quantity').fill('100');
  await page.getByTestId('sales-plan-date').fill(delivery.slice(0, 16));
  await page.getByTestId('sales-plan-note').fill(input.note);
  await page.setViewportSize({ width: 390, height: 844 });
  report.mobileBounds = await page.getByRole('dialog').boundingBox();
  check('mobileDialogFits', report.mobileBounds.x >= 0 && report.mobileBounds.x + report.mobileBounds.width <= 391);
  await capture(page, 'sales-plan-mobile-draft.png', page.getByTestId('sales-plan-create'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  let injectedReadbacks = 0;
  await page.route(`**/api/orders/${order.id}/fulfillment-plans`, async route => {
    if (route.request().method() === 'GET' && injectedReadbacks === 0) { injectedReadbacks++; await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Synthetic readback failure after a committed POST' }) }); }
    else await route.continue();
  });
  const posted = page.waitForResponse(r => new URL(r.url()).pathname === `/api${endpoint}` && r.request().method() === 'POST');
  await page.getByTestId('sales-plan-create').dblclick();
  const post = await posted; assert(post.ok(), await post.text()); const plan = (await post.json()).data;
  await expect(page.getByTestId('sales-plan-error')).toBeVisible(); await expect(page.getByTestId('sales-plan-create')).toBeDisabled();
  await page.getByRole('button', { name: '只刷新读取', exact: true }).click();
  await expect(page.getByTestId(`sales-plan-${plan.id}`)).toContainText('草稿');
  await expect(page.getByTestId('sales-plan-error')).toHaveCount(0);
  await expect(page.getByTestId(`sales-plan-approve-${plan.id}`)).toHaveCount(0);
  report.browserCreate = { planId: plan.id, httpStatus: post.status(), injectedReadbacks, getOnlyRecovery: true };
  check('draftNoStockOrMoney', JSON.stringify(await financialStock()) === JSON.stringify(report.beforePlan));
  check('browserDoubleClickExactlyOnce', await prisma.salesFulfillmentPlan.count({ where: { orderId: Number(order.id) } }) === 1);
  const replayInput = { ...input, idempotencyKey: plan.idempotencyKey, expectedFulfillmentAt: plan.expectedFulfillmentAt };
  const beforeReplay = await snapshot();
  assert.equal(dataOf(await request(endpoint, { auth: actors.sales.token, method: 'POST', instance: 1, data: replayInput })).id, plan.id);
  check('createReplayNoDuplicate', JSON.stringify(await snapshot()) === JSON.stringify(beforeReplay));
  await reject('changed idempotency facts', endpoint, { auth: actors.sales.token, method: 'POST', data: { ...replayInput, plannedQuantity: 99 } }, 409);
  await reject('sales approval permission', `${endpoint}/${plan.id}/approve`, { auth: actors.sales.token, method: 'POST', data: { expectedUpdatedAt: plan.updatedAt, reason: 'Not authorized' } }, 403);
  await reject('immutable order line', `/orders/${order.id}`, { auth: actors.sales.token, method: 'PUT', data: { items: [{ materialId: material.id, productName: material.nameZh, quantity: 90, unit: 'kg', unitPrice: 10 }] } }, 409);
  const self = dataOf(await request(endpoint, { method: 'POST', data: { ...input, idempotencyKey: `${runId}-self`, plannedQuantity: 1 } }));
  await reject('admin self approval', `${endpoint}/${self.id}/approve`, { method: 'POST', data: { expectedUpdatedAt: self.updatedAt, reason: 'Cannot self approve' } }, 403);
  const stalePo = await purchase();
  const stale = dataOf(await request(endpoint, { method: 'POST', data: { ...input, idempotencyKey: `${runId}-stale`, sourceDocumentId: Number(stalePo.id) } }));
  dataOf(await request(`/procurement/orders/${stalePo.id}`, { method: 'PATCH', data: { expectedRevision: stalePo.revision, expectedUpdatedAt: stalePo.updatedAt, quantity: 100, price: 11, taxAmount: 0, eta, reason: 'Synthetic revision change' } }));
  dataOf(await request(`/procurement/orders/${stalePo.id}/status`, { method: 'PATCH', data: { status: 'approved', expectedRevision: stalePo.revision + 1 } }));
  await reject('purchase revision frozen', `${endpoint}/${stale.id}/approve`, { auth: actors.reviewer.token, method: 'POST', data: { expectedUpdatedAt: stale.updatedAt, reason: 'Reject stale source' } }, 409);

  await page.close();
  const reviewerPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); reviewerPage.setDefaultTimeout(15000);
  actors.reviewer.token = (await loginUiAuditUser(reviewerPage, `${urls[0]}/`, { account: accounts.reviewer, storage: { 'ailao.language': 'zh', language: 'zh-CN' } })).token;
  await reviewerPage.goto(`${urls[0]}/#orders`); await reviewerPage.getByTestId('sales-desk-fulfillment').click(); await reviewerPage.getByTestId(`sales-order-plan-${order.id}`).click();
  await reviewerPage.getByTestId('sales-plan-reason').fill('Independent approved supply commitment');
  const approval = reviewerPage.waitForResponse(r => new URL(r.url()).pathname === `/api${endpoint}/${plan.id}/approve` && r.request().method() === 'POST');
  await reviewerPage.getByTestId(`sales-plan-approve-${plan.id}`).click(); assert.equal((await approval).status(), 200);
  await expect(reviewerPage.getByTestId(`sales-plan-${plan.id}`)).toContainText('已批准');
  await capture(reviewerPage, 'sales-plan-independent-approval.png', reviewerPage.getByTestId(`sales-plan-${plan.id}`));
  report.browserApproval = { planId: plan.id, actor: actors.reviewer.user.id, status: 200 };
  check('approvalNoStockOrMoney', JSON.stringify(await financialStock()) === JSON.stringify(report.beforePlan));
  await reject('duplicate approval', `${endpoint}/${plan.id}/approve`, { auth: actors.reviewer.token, method: 'POST', data: { expectedUpdatedAt: plan.updatedAt, reason: 'Duplicate approval' } }, 409);
  await reject('purchase capacity overcommit', `${endpoint}/${self.id}/approve`, { auth: actors.reviewer.token, method: 'POST', data: { expectedUpdatedAt: self.updatedAt, reason: 'Reject excessive promise' } }, 409);
  const closeInput = { idempotencyKey: `sales-plan-close:${plan.id}`, reason: 'Verified source receipts and customer delivery' };
  await reject('early closeout', `${endpoint}/${plan.id}/close`, { auth: actors.reviewer.token, method: 'POST', data: closeInput }, 409);
  dataOf(await request(`/orders/${order.id}/status`, { method: 'PATCH', data: { status: 'confirmed' } }));
  const batchNo = `${runId}-purchased`;
  report.purchaseReceipt = dataOf(await request(`/procurement/orders/${po.id}/receipts`, { method: 'POST', data: { quantity: 100, acceptedQuantity: 100, rejectedQuantity: 0, batchNo, note: 'Synthetic actual purchase delivery' } }));
  // Procurement receives into LOC-RM; actual sales dispatch reads LOC-FG. Move
  // the real received lot through the governed transfer API, never seed another
  // stock row or rewrite locations to fabricate available supply.
  const receivedStock = await prisma.stockBalance.findFirst({ where: { materialId: material.id, batchNo, quantity: 100 } });
  const fg = dataOf(await request('/warehouses')).flatMap(w => w.locations || []).find(l => l.code === 'LOC-FG');
  assert(receivedStock && fg, 'Received lot and dispatch location must exist');
  report.sourceTransfer = dataOf(await request(`/warehouses/stock-balances/${receivedStock.id}/transfer`, { method: 'POST', data: {
    toLocationId: Number(fg.id), quantity: 100, requestId: `${runId}-source-transfer`, note: 'Purchased finished product moves to sales dispatch location',
  } }));
  const shipment = dataOf(await request('/shipping', { method: 'POST', data: { customerId: Number(customer.id), orderId: Number(order.id), orderItemId: lineId,
    materialId: material.id, productName: material.nameZh, quantity: 100, unit: 'kg', batchNo, carrier: 'Synthetic' } }));
  dataOf(await request(`/shipping/${shipment.id}/status`, { method: 'PATCH', data: { status: 'in_transit' } }));
  await reject('in-transit is not customer acceptance', `${endpoint}/${plan.id}/close`, { auth: actors.reviewer.token, method: 'POST', data: closeInput }, 409);
  report.customerReceipt = dataOf(await request(`/shipping/${shipment.id}/receipt-events`, { method: 'POST', data: { quantity: 100, acceptedQuantity: 100, rejectedQuantity: 0, note: 'Synthetic full customer acceptance' } }));
  report.beforeClose = await financialStock();
  await reviewerPage.getByTestId('sales-plan-reason').fill(closeInput.reason);
  const closed = reviewerPage.waitForResponse(r => new URL(r.url()).pathname === `/api${endpoint}/${plan.id}/close` && r.request().method() === 'POST');
  await reviewerPage.getByTestId(`sales-plan-close-${plan.id}`).dblclick(); assert.equal((await closed).status(), 200);
  await expect(reviewerPage.getByTestId(`sales-plan-${plan.id}`)).toContainText('已结案');
  await expect(reviewerPage.getByTestId(`sales-plan-${plan.id}`)).toContainText('来源批次已签收: 100 kg');
  await capture(reviewerPage, 'sales-plan-closed-readback.png', reviewerPage.getByTestId(`sales-plan-${plan.id}`));
  report.browserClose = { planId: plan.id, status: 200, text: await reviewerPage.getByTestId(`sales-plan-${plan.id}`).innerText() };
  check('closeNoStockOrMoney', JSON.stringify(await financialStock()) === JSON.stringify(report.beforeClose));
  const afterClose = await snapshot();
  dataOf(await request(`${endpoint}/${plan.id}/close`, { method: 'POST', auth: actors.reviewer.token, instance: 1, data: closeInput }));
  check('closeReplayNoDuplicate', JSON.stringify(await snapshot()) === JSON.stringify(afterClose));
  await reject('changed close reason', `${endpoint}/${plan.id}/close`, { method: 'POST', auth: actors.reviewer.token, data: { ...closeInput, reason: 'Different reason' } }, 409);
  report.finalReadbacks = await Promise.all([0, 1].map(instance => request(endpoint, { instance }).then(dataOf)));
  report.finalState = afterClose;
  check('bothInstancesClosed', report.finalReadbacks.every(r => r.plans.find(p => p.id === plan.id).status === 'closed' && r.fulfillment.fullyDelivered));
  check('exactlyThreePlanAudits', afterClose.audits.filter(a => a.resourceId === plan.id).length === 3);
  check('physicalInventoryNonnegative', afterClose.business.balances.every(b => b.quantity >= 0) && afterClose.business.balances.reduce((n, b) => n + b.quantity, 0) === 0);
  check('zeroInventoryCostRemainder', afterClose.business.ledger.length >= 2 && afterClose.business.ledger.reduce((n, row) => n + row.quantityDelta, 0) === 0 && afterClose.business.ledger.reduce((n, row) => n + row.costAmountDelta, 0) === 0);
  // A separate order keeps the competing promises independent from the browser
  // happy path. Two distinct approvers race on two lines against one 50 kg PO.
  const raceOrder = dataOf(await request('/orders', { auth: actors.sales.token, method: 'POST', data: { customerId: Number(customer.id),
    items: [1, 2].map(() => ({ materialId: material.id, productName: material.nameZh, quantity: 50, unit: 'kg', unitPrice: 10 })), paymentTerms: 30 } }));
  const raceRead = dataOf(await request(`/orders/${raceOrder.id}`));
  const racePo = dataOf(await request('/procurement/orders', { method: 'POST', data: { supplierId: Number(supplier.id), materialId: material.id, salesOrderId: Number(raceOrder.id),
    item: material.nameZh, quantity: 50, price: 10, unit: 'kg', eta, currency: 'CNY', status: 'approved' } }));
  const raceBase = `/orders/${raceOrder.id}/fulfillment-plans`;
  const contenders = [];
  for (const [index, item] of raceRead.items.entries()) contenders.push(dataOf(await request(raceBase, { auth: actors.sales.token, method: 'POST', data: {
    ...input, idempotencyKey: `${runId}-race-${index}`, orderItemId: Number(item.id), sourceDocumentId: Number(racePo.id), plannedQuantity: 50,
  } })));
  const { synchronizedBurst } = require('./lib/enterprise-round2-runner.cjs');
  const results = await synchronizedBurst([{ id: Number(actors.admin.user.id), token }, { id: Number(actors.reviewer.user.id), token: actors.reviewer.token }], async actor => {
    const index = actor.id === Number(actors.admin.user.id) ? 0 : 1;
    const candidate = contenders[index];
    const r = await request(`${raceBase}/${candidate.id}/approve`, { instance: index, auth: actor.token, method: 'POST', data: { expectedUpdatedAt: candidate.updatedAt, reason: 'Concurrent independent procurement commitment' } });
    return { planId: candidate.id, status: r.status, errorCode: r.json.errorCode };
  }, AbortSignal.timeout(30000));
  const raceReadbacks = await Promise.all([0, 1].map(instance => request(raceBase, { instance }).then(dataOf)));
  const raceAudits = await prisma.auditLog.findMany({ where: { resource: 'sales_fulfillment_plan', resourceId: { in: contenders.map(p => p.id) }, action: 'APPROVE_SALES_FULFILLMENT_PLAN' } });
  check('concurrentSourceCapacity', results.filter(r => r.status === 200).length === 1 && results.filter(r => r.status === 409).length === 1 && raceAudits.length === 1
    && raceReadbacks.every(r => r.plans.filter(p => p.status === 'approved').reduce((n, p) => n + p.plannedQuantity, 0) === 50));
  report.concurrency = { sourceQuantity: 50, contenders, results, readbacks: raceReadbacks, audits: raceAudits };
  // Keep the original 100 kg all-purchase proof above. This separate real chain
  // mixes existing stock with later procurement; it does not claim reservation,
  // mandatory confirmation gating or the complete 20-role workforce.
  const presaleMaterial = await ensureReleasedMaterial({ request, code: `${runId}-presale`, name: `${runId}-presale`, category: 'finished_good', unit: 'kg' });
  const existingBatch = `${runId}-existing`, replenishmentBatch = `${runId}-replenishment`;
  dataOf(await request('/warehouses/stock-balances', { method: 'POST', data: { locationId: Number(fg.id), materialId: presaleMaterial.id,
    productName: presaleMaterial.nameZh, batchNo: existingBatch, quantity: 100, unit: 'kg', unitCost: 10, sourceRef: `${runId}-opening`, reason: 'Isolated presale opening stock with actual cost' } }));
  const presaleOrder = dataOf(await request('/orders', { auth: actors.sales.token, method: 'POST', data: { customerId: Number(customer.id),
    items: [{ materialId: presaleMaterial.id, productName: presaleMaterial.nameZh, quantity: 150, unit: 'kg', unitPrice: 10 }], paymentTerms: 30 } }));
  const presaleOriginal = dataOf(await request(`/orders/${presaleOrder.id}`));
  const presaleLineId = Number(presaleOriginal.items[0].id), presaleBase = `/orders/${presaleOrder.id}/fulfillment-plans`;
  const state = async () => ({
    order: await prisma.order.findUnique({ where: { id: Number(presaleOrder.id) }, include: { items: true, shipments: { orderBy: { id: 'asc' }, include: { receipts: { orderBy: { id: 'asc' } } } } } }),
    balances: await prisma.stockBalance.findMany({ where: { materialId: presaleMaterial.id }, orderBy: { id: 'asc' } }),
    batches: await prisma.productBatch.findMany({ where: { materialId: presaleMaterial.id }, orderBy: { id: 'asc' } }),
    ledger: await prisma.inventoryCostLedger.findMany({ where: { productBatch: { materialId: presaleMaterial.id } }, orderBy: { id: 'asc' } }),
    entries: await prisma.stockEntry.findMany({ where: { movements: { some: { materialId: presaleMaterial.id } } }, orderBy: { id: 'asc' }, include: { movements: { orderBy: { id: 'asc' } } } }),
    payments: await prisma.paymentRecord.findMany({ where: { orderId: Number(presaleOrder.id) }, orderBy: { id: 'asc' } }),
  });
  report.presale = { scope: '100 existing + 50 linked purchase; no physical reservation/full workforce claim', materialId: presaleMaterial.id,
    orderId: Number(presaleOrder.id), orderItemId: presaleLineId, existingBatch, replenishmentBatch, original: await state() };
  const p = report.presale;
  const replenishment = dataOf(await request('/procurement/orders', { method: 'POST', data: { supplierId: Number(supplier.id), materialId: presaleMaterial.id,
    salesOrderId: Number(presaleOrder.id), item: presaleMaterial.nameZh, quantity: 50, price: 10, unit: 'kg', eta, currency: 'CNY', status: 'approved' } }));
  const presalePlan = dataOf(await request(presaleBase, { auth: actors.sales.token, method: 'POST', data: { ...input, idempotencyKey: `${runId}-presale-plan`,
    orderItemId: presaleLineId, sourceDocumentId: Number(replenishment.id), plannedQuantity: 50 } }));
  dataOf(await request(`${presaleBase}/${presalePlan.id}/approve`, { auth: actors.reviewer.token, method: 'POST', data: { expectedUpdatedAt: presalePlan.updatedAt, reason: 'Independent approval of remaining 50 kg supply' } }));
  assert.deepEqual(await state(), p.original, 'Presale plan must not change stock or receivables');
  dataOf(await request(`/orders/${presaleOrder.id}/status`, { method: 'PATCH', data: { status: 'confirmed' } }));
  const createPresaleShipment = async (quantity, batchNo) => dataOf(await request('/shipping', { method: 'POST', data: { customerId: Number(customer.id),
    orderId: Number(presaleOrder.id), orderItemId: presaleLineId, materialId: presaleMaterial.id, productName: presaleMaterial.nameZh, quantity, unit: 'kg', ...(batchNo ? { batchNo } : {}), carrier: 'Synthetic' } }));
  const dispatch = id => request(`/shipping/${id}/status`, { method: 'PATCH', data: { status: 'in_transit' } });
  const receive = async (id, quantity) => dataOf(await request(`/shipping/${id}/receipt-events`, { method: 'POST', data: { quantity, acceptedQuantity: quantity, rejectedQuantity: 0, note: 'Actual partial customer acceptance' } }));
  const first = await createPresaleShipment(100, existingBatch);
  dataOf(await dispatch(first.id)); await receive(first.id, 100);
  p.partial = await state();
  p.partialReadbacks = await Promise.all([0, 1].map(instance => request(`/orders/${presaleOrder.id}`, { instance }).then(dataOf)));
  assert(p.partialReadbacks.every(o => o.fulfillmentStatus === 'partially_delivered' && o.fulfillment.lines[0].outstandingQuantity === 50));
  await reviewerPage.goto(`${urls[0]}/#orders`);
  await reviewerPage.reload(); // Same hash navigation otherwise keeps the earlier modal and stale list.
  const presaleAxis = reviewerPage.getByTestId(`order-fulfillment-${presaleOrder.id}`);
  await expect(presaleAxis).toContainText('待交 50 kg');
  p.partialBrowserText = await presaleAxis.innerText();
  await capture(reviewerPage, 'sales-presale-partial-100-of-150.png', presaleAxis);
  // An unbound draft remains the same shipment across stock shortage/replenish.
  // Its failed dispatch must roll back status, cost and audit effects together.
  const second = await createPresaleShipment(50);
  p.beforeShortage = await state();
  p.shortageResponse = await dispatch(second.id);
  p.afterShortage = await state();
  assert.deepEqual(p.afterShortage, p.beforeShortage, 'Rejected presale dispatch changed persisted business state');
  assert.equal(p.shortageResponse.status, 409, JSON.stringify(p.shortageResponse));
  p.purchaseReceipt = dataOf(await request(`/procurement/orders/${replenishment.id}/receipts`, { method: 'POST', data: {
    quantity: 50, acceptedQuantity: 50, rejectedQuantity: 0, batchNo: replenishmentBatch, note: 'Only the original outstanding 50 kg is replenished' } }));
  const replenishedStock = await prisma.stockBalance.findFirst({ where: { materialId: presaleMaterial.id, batchNo: replenishmentBatch, quantity: 50 } });
  assert(replenishedStock);
  dataOf(await request(`/warehouses/stock-balances/${replenishedStock.id}/transfer`, { method: 'POST', data: { toLocationId: Number(fg.id), quantity: 50,
    requestId: `${runId}-presale-transfer`, note: 'Same purchased lot moves to dispatch' } }));
  dataOf(await dispatch(second.id)); await receive(second.id, 50);
  const presaleClose = { idempotencyKey: `${runId}-presale-close`, reason: '100 existing plus 50 purchased delivered; original obligation discharged' };
  dataOf(await request(`${presaleBase}/${presalePlan.id}/close`, { auth: actors.reviewer.token, method: 'POST', data: presaleClose }));
  p.final = await state();
  p.finalReadbacks = await Promise.all([0, 1].map(instance => request(`/orders/${presaleOrder.id}`, { instance }).then(dataOf)));
  p.planReadbacks = await Promise.all([0, 1].map(instance => request(presaleBase, { instance }).then(dataOf)));
  p.plan = await prisma.salesFulfillmentPlan.findUnique({ where: { id: presalePlan.id } });
  p.planAudits = await prisma.auditLog.findMany({ where: { resource: 'sales_fulfillment_plan', resourceId: presalePlan.id }, orderBy: { id: 'asc' } });
  p.purchase = await prisma.purchaseOrder.findUnique({ where: { id: Number(replenishment.id) }, include: { receipts: true } });
  dataOf(await request(`${presaleBase}/${presalePlan.id}/close`, { instance: 1, auth: actors.reviewer.token, method: 'POST', data: presaleClose }));
  assert.deepEqual(await state(), p.final);
  assert.deepEqual(await prisma.auditLog.findMany({ where: { resource: 'sales_fulfillment_plan', resourceId: presalePlan.id }, orderBy: { id: 'asc' } }), p.planAudits);
  await reviewerPage.reload();
  await expect(presaleAxis).toContainText('已交付'); await expect(presaleAxis).not.toContainText('待交');
  p.finalBrowserText = await presaleAxis.innerText();
  await capture(reviewerPage, 'sales-presale-complete-150-of-150.png', presaleAxis);
  assert.equal(p.final.order.items[0].quantity, 150); assert.equal(p.final.order.finalAmount, 1500); assert.equal(p.final.order.paidAmount, 0);
  assert.equal(p.final.order.shipments.length, 2); assert.deepEqual(p.final.order.shipments.map(s => s.quantity), [100, 50]);
  assert.equal(p.final.order.shipments.flatMap(s => s.receipts).reduce((n, r) => n + r.acceptedQuantity, 0), 150);
  assert(p.final.balances.every(b => b.quantity === 0));
  assert.equal(p.final.ledger.reduce((n, l) => n + l.quantityDelta, 0), 0); assert.equal(p.final.ledger.reduce((n, l) => n + l.costAmountDelta, 0), 0);
  assert(p.finalReadbacks.every(o => o.fulfillment.fullyDelivered && o.fulfillment.lines[0].outstandingQuantity === 0));
  check('presaleExistingThenPurchased150', true);
  report.status = 'passed'; report.summary = { passedChecks: Object.keys(report.checks).length, failedChecks: 0, remainingChecks: 0 };
}
main().catch(e => { report.error = e.stack || String(e); console.error(report.error); process.exitCode = 1; }).finally(async () => {
  await browser?.close().catch(() => {}); await prisma?.$disconnect(); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, summary: report.summary, reportPath: file }));
});
