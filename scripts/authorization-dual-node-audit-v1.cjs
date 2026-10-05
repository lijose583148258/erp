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
