// Real HTTP + database prerequisite for workforce acceptance; not a 20-role pass.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { ensureUiAuditUser, createAuditPrismaClient } = require('./lib/ui-audit-user.cjs');
const { ensureReleasedMaterial } = require('./lib/material-audit-fixture.cjs');
const { sourceFingerprint, headCommit, readRegressionStamp } = require('./lib/enterprise-regression.cjs');
const urls = [process.env.APP_URL, process.env.SECONDARY_APP_URL].map(v => String(v || '').replace(/\/$/, ''));
const root = path.resolve(__dirname, '..'), reportPath = path.resolve(process.env.ROUND2_REPORT_PATH || 'output/audit/authorization-dual-node-v1.json');
const runId = `acl-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const report = { version: 'authorization-dual-node/v1', status: 'running', startedAt: new Date().toISOString(),
  scope: 'Actual grant/revoke/read/write cross-node coherence prerequisite, not full workforce/37-check acceptance',
  provider: process.env.AUDIT_PRISMA_PROVIDER || 'sqlite', runId, observations: {}, checks: [], regression: readRegressionStamp() };
let prisma, admin;
const signal = AbortSignal.timeout(120000);
async function request(endpoint, { actor = admin, instance = 0, method = 'GET', data } = {}) {
  const response = await fetch(`${urls[instance]}/api${endpoint}`, { method,
    headers: { 'content-type': 'application/json', ...(actor?.token ? { authorization: `Bearer ${actor.token}` } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
  return { status: response.status, ok: response.ok, json: await response.json() };
}
function dataOf(result) { assert([200, 201].includes(result.status), `HTTP ${result.status}: ${JSON.stringify(result.json)}`); assert(result.json?.data); return result.json.data; }
async function account(job, role, password) {
  const username = `${runId}_${job}`;
  await ensureUiAuditUser({ username, password, role, segment: 'mixed' });
  const login = dataOf(await request('/auth/login', { actor: null, method: 'POST', data: { username, password } }));
  assert(login.token && login.user?.id);
  return { token: login.token, id: login.user.id, role, profile: { id: login.user.id, role: login.user.role, permissions: login.user.permissions, dataScopes: login.user.dataScopes } };
}
function check(id, value) { report.checks.push({ id, status: value ? 'passed' : 'failed' }); }
async function productionResponsibilities(password) {
  const e = report.production = { scope: 'Three real production responsibilities, not the full20 workforce', actors: [], allowed: [], denied: [], browser: [] };
  const permissions = { research: 'production.bom.write', planner: 'production.plan.write', operator: 'production.execute' };
  const actors = {};
  for (const [job, permission] of Object.entries(permissions)) {
    const role = `${runId.replace(/-/g, '_')}_${job}`;
    dataOf(await request('/roles', { method: 'POST', data: { code: role, name: job, dataScopes: ['warehouse_visible'],
      permissions: ['dashboard.read', 'production.read', 'materials.read', permission], isActive: true } }));
    actors[job] = await account(job, role, password); e.actors.push({ job, ...actors[job].profile });
  }
  const raw = await ensureReleasedMaterial({ request, code: `${runId}-raw`, name: `${runId}-raw`, category: 'raw_material' });
  const fg = await ensureReleasedMaterial({ request, code: `${runId}-fg`, name: `${runId}-fg`, category: 'finished_good' });
  const bomPayload = instance => ({ materialId: fg.id, productName: fg.nameZh, version: `roles-${instance}`, status: 'active',
    outputUnit: 'kg', shelfLifeDays: 365, items: [{ materialId: raw.id, quantityPerUnit: 1, unit: 'kg' }] });
  const orderPayload = bomId => ({ bomId, productName: fg.nameZh, targetQuantity: 1, steps: [{ title: 'Production role boundary' }] });
  const orders = [], boms = [];
  for (const instance of [0, 1]) {
    const bom = await request('/production/boms', { actor: actors.research, instance, method: 'POST', data: bomPayload(instance) });
    boms.push(dataOf(bom)); e.allowed.push({ job: 'research', instance, operation: 'bom', ...bom });
    const order = await request('/production/work-orders', { actor: actors.planner, instance, method: 'POST', data: orderPayload(boms[instance].id) });
    orders.push(dataOf(order)); e.allowed.push({ job: 'planner', instance, operation: 'plan', ...order });
    const started = await request(`/production/work-orders/${orders[instance].id}/status`, { actor: actors.operator, instance, method: 'PATCH', data: { status: 'in_progress' } });
    dataOf(started); e.allowed.push({ job: 'operator', instance, operation: 'start', ...started });
    const step = await request(`/production/work-orders/${orders[instance].id}/steps/${orders[instance].steps[0].id}`, { actor: actors.operator, instance, method: 'PATCH', data: { status: 'in_progress' } });
    dataOf(step); e.allowed.push({ job: 'operator', instance, operation: 'step', ...step });
  }
  const snapshot = async () => ({
    boms: await prisma.productionBom.findMany({ where: { materialId: fg.id }, include: { items: true }, orderBy: { id: 'asc' } }),
    orders: await prisma.productionWorkOrder.findMany({ where: { id: { in: orders.map(o => o.id) } }, include: { steps: true }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { resource: 'production', userId: { in: e.actors.map(a => a.id) } }, orderBy: { id: 'asc' } }),
    balances: await prisma.stockBalance.findMany({ where: { materialId: { in: [raw.id, fg.id] } }, orderBy: { id: 'asc' } }),
    costs: await prisma.inventoryCostLedger.findMany({ where: { workOrderId: { in: orders.map(o => o.id) } }, orderBy: { id: 'asc' } }),
  });
  e.before = await snapshot();
  for (const instance of [0, 1]) {
    for (const [job, operation, endpoint, method, data] of [
      ['planner', 'bom', '/production/boms', 'POST', bomPayload(instance + 2)],
      ['operator', 'bom', '/production/boms', 'POST', bomPayload(instance + 2)],
      ['research', 'plan', '/production/work-orders', 'POST', orderPayload(boms[0].id)],
      ['operator', 'plan', '/production/work-orders', 'POST', orderPayload(boms[0].id)],
      ['research', 'execute', `/production/work-orders/${orders[0].id}/status`, 'PATCH', { status: 'qc_pending' }],
      ['planner', 'execute', `/production/work-orders/${orders[0].id}/status`, 'PATCH', { status: 'qc_pending' }],
      ['research', 'cancel', `/production/work-orders/${orders[0].id}/status`, 'PATCH', { status: 'cancelled' }],
      ['operator', 'cancel', `/production/work-orders/${orders[0].id}/status`, 'PATCH', { status: 'cancelled' }],
    ]) e.denied.push({ job, instance, operation, ...(await request(endpoint, { actor: actors[job], instance, method, data })) });
  }
  e.after = await snapshot(); assert.deepEqual(e.after, e.before, 'Forbidden production actions changed business facts or audits');
  assert(e.denied.every(r => r.status === 403));
  // Rejected-request security logs are required, not forbidden business effects.
  for (let attempt = 0; attempt < 10; attempt++) {
    e.denialAudits = await prisma.auditLog.findMany({ where: { userId: { in: e.actors.map(a => a.id) },
      resource: { startsWith: '/api/production/' }, details: { startsWith: 'Status: 403,' } }, orderBy: { id: 'asc' } });
    if (e.denialAudits.length === e.denied.length) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(e.denialAudits.length, 16);
  const { expect } = require('playwright/test');
  const { launchBrowserWithGuard } = require('./lib/browser-launch-guard.cjs');
  const browser = (await launchBrowserWithGuard({ launchTimeoutMs: 15000, totalTimeoutMs: 30000, maxAttemptsPerStrategy: 1 })).browser;
  const abort = () => { void browser.close().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  const folder = path.join(path.dirname(reportPath), `${runId}-production-roles`); fs.mkdirSync(folder, { recursive: true });
  try {
    for (const [job, actor] of Object.entries(actors)) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage(); page.setDefaultTimeout(10000); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.status() >= 400 && response.url().includes('/api/')) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
      await page.addInitScript(({ token, user }) => {
        for (const key of ['token','auth_token','erp_auth_token']) localStorage.setItem(key, token);
        for (const key of ['user','currentUser','erp_current_user']) localStorage.setItem(key, JSON.stringify(user));
        localStorage.setItem('ailao.language', 'zh'); localStorage.setItem('language', 'zh-CN');
      }, { token: actor.token, user: { ...actor.profile, id: String(actor.id), name: job, segment: 'mixed' } });
      await page.goto(`${urls[1]}/#production`); await page.locator('#loading').waitFor({ state: 'hidden' });
      await expect(page.getByText('已保存配方版本（只读回读）', { exact: true })).toBeVisible();
      await expect(page.getByText('未授权', { exact: true })).toBeVisible();
      if (job === 'research') await expect(page.getByTestId('production-bom-save')).toBeVisible();
      else await expect(page.getByTestId('production-bom-save')).toHaveCount(0);
      const bomScreenshot = path.join(folder, `${job}-bom.png`); await page.screenshot({ path: bomScreenshot });
      await page.getByTestId('production-desk-work-orders').click();
      if (job === 'planner') await expect(page.getByTestId('production-work-order-save')).toBeVisible();
      else await expect(page.getByTestId('production-work-order-save')).toHaveCount(0);
      await page.getByPlaceholder('搜索工单').fill(orders[0].workOrderNo);
      const row = page.getByTestId(`production-work-order-row-${orders[0].id}`); await expect(row).toBeVisible(); await row.click();
      await expect(page.getByTestId(`production-work-order-bom-${orders[0].id}`)).toContainText(boms[0].version);
      await expect(row.getByRole('button', { name: '取消', exact: true })).toHaveCount(job === 'planner' ? 1 : 0);
      await expect(row.getByRole('button', { name: '送检', exact: true })).toHaveCount(job === 'operator' ? 1 : 0);
      const workOrderScreenshot = path.join(folder, `${job}-work-order.png`); await page.screenshot({ path: workOrderScreenshot });
      assert.deepEqual(errors, []); e.browser.push({ job, actorId: actor.id, role: actor.role, instance: 1, boundBomId: boms[0].id,
        workOrderId: orders[0].id, inventoryReadback: '未授权', bomSaveVisible: job === 'research', planSaveVisible: job === 'planner', executeVisible: job === 'operator', cancelVisible: job === 'planner', errors, bomScreenshot, workOrderScreenshot });
      await context.close();
    }
  } finally { signal.removeEventListener('abort', abort); await browser.close(); }
  const cancelled = await request(`/production/work-orders/${orders[1].id}/status`, { actor: actors.planner, instance: 1, method: 'PATCH', data: { status: 'cancelled' } });
  assert.equal(dataOf(cancelled).status, 'cancelled'); e.allowed.push({ job: 'planner', instance: 1, operation: 'cancel', ...cancelled });
  e.final = await snapshot(); e.status = 'passed';
}
async function main() {
  assert.equal(process.env.ROUND2_ALLOW_MUTATIONS, 'true'); assert(process.env.DATABASE_URL || process.env.AUDIT_DATABASE_URL);
  assert(urls[0] && urls[1] && urls[0] !== urls[1]); for (const url of urls) assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname));
  report.commit = headCommit(root); report.sourceHash = sourceFingerprint(root);
  prisma = createAuditPrismaClient();
  const password = crypto.randomBytes(24).toString('base64url') + '!Aa1';
  admin = await account('admin', 'admin', password);
  report.adminId = admin.id;
  // Both independent process caches are genuinely exercised before role creation.
  for (const instance of [0, 1]) dataOf(await request('/warehouses', { instance }));
  const roleCode = `${runId.replace(/-/g, '_')}_worker`;
  const permissions = ['dashboard.read', 'warehouse.read', 'warehouse.write', 'warehouse.ledger.read'];
  const policy = { code: roleCode, name: 'Dual-node warehouse operator', dataScopes: ['warehouse_visible'], permissions, isActive: true };
  const createdRole = dataOf(await request('/roles', { method: 'POST', data: policy }));
  const operator = await account('worker', roleCode, password);
  report.actor = operator.profile; report.roleId = createdRole.id;
  const newRoleReads = await Promise.all([0, 1].map(instance => request('/warehouses', { actor: operator, instance })));
  report.observations.newRoleReads = newRoleReads.map((r, instance) => ({ instance, status: r.status }));
  check('new-grant-visible-on-both-nodes', newRoleReads.every(r => r.status === 200));

  // An authorized same-policy PUT on node 2 lets the old implementation reach
  // the revoke case too; it is recorded, never hidden as a recovery workaround.
  report.observations.secondaryPolicyWarm = dataOf(await request(`/roles/${roleCode}`, { instance: 1, method: 'PUT', data: policy }));
  for (const instance of [0, 1]) dataOf(await request('/warehouses', { actor: operator, instance }));
  const material = await ensureReleasedMaterial({ request, code: runId, name: runId, category: 'finished_good' });
  const warehouse = dataOf(await request('/warehouses', { method: 'POST', data: { code: runId, name: runId, type: 'physical' } }));
  const locations = [];
  for (const name of ['from', 'to']) locations.push(dataOf(await request(`/warehouses/${warehouse.id}/locations`, { method: 'POST', data: { code: `${runId}-${name}`, name, type: 'internal' } })));
  const stock = dataOf(await request('/warehouses/stock-balances', { method: 'POST', data: { locationId: locations[0].id, materialId: material.id,
    productName: material.nameZh, batchNo: runId, quantity: 100, unit: 'kg', unitCost: 10, sourceRef: runId, reason: 'Owned authorization revocation fixture' } }));
  report.observations.authorizedTransfers = [];
  for (const instance of [0, 1]) {
    const r = await request(`/warehouses/stock-balances/${stock.id}/transfer`, { actor: operator, instance, method: 'POST',
      data: { toLocationId: locations[1].id, quantity: 1, requestId: `${runId}-allowed-${instance}` } });
    report.observations.authorizedTransfers.push({ instance, status: r.status, response: r.json });
  }
  check('granted-role-can-really-write-on-both-nodes', report.observations.authorizedTransfers.every(r => r.status === 201));
  const snapshot = async () => ({
    balances: await prisma.stockBalance.findMany({ where: { materialId: material.id, batchNo: runId }, orderBy: { id: 'asc' } }),
    movements: await prisma.stockMovement.findMany({ where: { materialId: material.id, batchNo: runId }, orderBy: { id: 'asc' } }),
    entries: await prisma.stockEntry.findMany({ where: { movements: { some: { materialId: material.id, batchNo: runId } } }, orderBy: { id: 'asc' } }),
    batches: await prisma.productBatch.findMany({ where: { materialId: material.id, batchNo: runId }, orderBy: { id: 'asc' } }),
    costs: await prisma.inventoryCostLedger.findMany({ where: { productBatch: { materialId: material.id, batchNo: runId } }, orderBy: { id: 'asc' } }),
  });
  report.before = await snapshot();
  assert.deepEqual(report.before.balances.map(row => row.quantity).sort((a, b) => a - b), [2, 98]);
  assert.equal(report.before.movements.length, 5); assert.equal(report.before.entries.length, 3);
  report.observations.revokedAt = new Date().toISOString();
  report.observations.revokedRole = dataOf(await request(`/roles/${roleCode}`, { method: 'PUT', data: { ...policy, permissions: permissions.filter(p => p !== 'warehouse.write') } }));
  report.observations.revokeAcknowledgedAt = new Date().toISOString();
  report.observations.profilesAfterRevoke = await Promise.all([0, 1].map(async instance => ({ instance, profile: dataOf(await request('/auth/me', { actor: operator, instance })) })));
  report.observations.revokedTransfers = [];
  for (const instance of [0, 1]) {
    const attemptedAt = new Date().toISOString();
    const r = await request(`/warehouses/stock-balances/${stock.id}/transfer`, { actor: operator, instance, method: 'POST',
      data: { toLocationId: locations[1].id, quantity: 1, requestId: `${runId}-denied-${instance}` } });
    report.observations.revokedTransfers.push({ instance, attemptedAt, status: r.status, response: r.json });
  }
  report.after = await snapshot();
  check('revoke-denies-real-write-on-both-nodes', report.observations.revokedTransfers.every(r => r.status === 403));
  check('revoked-write-has-zero-stock-or-ledger-effect', JSON.stringify(report.before) === JSON.stringify(report.after));
  check('auth-me-and-enforcement-agree', report.observations.profilesAfterRevoke.every(r => !r.profile.permissions.includes('warehouse.write'))
    && report.observations.revokedTransfers.every(r => r.status === 403));
  report.roleAudits = await prisma.auditLog.findMany({ where: { resource: 'authorization.role', resourceId: createdRole.id }, orderBy: { id: 'asc' } });
  check('policy-changes-have-actor-audit', report.roleAudits.length === 3 && report.roleAudits.every(a => a.userId === admin.id));
  await productionResponsibilities(password);
  report.commitAfter = headCommit(root); report.sourceHashAfter = sourceFingerprint(root);
  check('source-unchanged', report.commitAfter === report.commit && report.sourceHashAfter === report.sourceHash);
  report.status = report.checks.every(c => c.status === 'passed') ? 'passed' : 'failed';
  if (report.status === 'failed') process.exitCode = 1;
}
main().catch(error => { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }).finally(async () => {
  if (prisma) await prisma.$disconnect(); report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks, reportPath }));
});
