const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const catalog = require('./config/enterprise-round2-v1.json');
const { createRound2Runner } = require('./lib/enterprise-round2-runner.cjs');
const { raceBrowserActor } = require('./lib/enterprise-round2-inventory-browser.cjs');

// Exercise the real producer up to its first fixture boundary. This proves
// cohort ownership, not a successful business chain or workforce acceptance.
function cohort() {
  let id = 100;
  const actors = [], byJob = {};
  for (const { job, count } of catalog.roles) {
    byJob[job] = [];
    for (let index = 1; index <= count; index++) {
      const actor = { id: ++id, job, index, role: `fixture_${job}`, token: `private-${id}`,
        account: { username: `actor_${id}`, password: `private-password-${id}` },
        profile: { id, role: `fixture_${job}`, permissions: [], dataScopes: [] }, profilesByInstance: {} };
      actors.push(actor); byJob[job].push(actor);
    }
  }
  return { version: 'enterprise-round2-workforce/v1', actors, byJob };
}

function warehouseBrowserContext() {
  const shared = cohort(), actor = shared.byJob.warehouse[1];
  actor.profile = { id: actor.id, role: actor.role, permissions: ['warehouse.read', 'warehouse.write', 'warehouse.ledger.read'], dataScopes: ['warehouse_visible'] };
  return { shared, actor };
}

test('inventory browser resolves the actual dynamic warehouse winner/loser without a built-in role alias', () => {
  const { shared, actor } = warehouseBrowserContext(), selected = raceBrowserActor({}, shared, actor.id);
  assert.equal(selected.actor, actor); assert.equal(selected.profile, actor.profile); assert.equal(selected.current, true);
  assert.equal(actor.role, 'fixture_warehouse'); assert(!actor.profile.permissions.includes('customers.read'));
});

test('inventory browser retains the original pressure-cohort warehouse identity path', () => {
  const { actor } = warehouseBrowserContext(); actor.role = 'warehouse'; actor.profile.role = 'warehouse';
  const legacy = { ...actor, loginUser: actor.profile }; delete legacy.profile;
  const selected = raceBrowserActor({ stock0: legacy }, undefined, actor.id);
  assert.equal(selected.actor, legacy); assert.equal(selected.profile, legacy.loginUser); assert.equal(selected.current, false);
});

for (const [name, mutate] of [
  ['another job', c => { c.actor.job = 'sales'; }],
  ['not in warehouse cohort', c => { c.shared.byJob.warehouse = []; }],
  ['borrowed profile', c => { c.actor.profile.id++; }],
  ['role drift', c => { c.actor.profile.role = 'admin'; }],
  ['missing stock grant', c => { c.actor.profile.permissions = ['warehouse.read']; }],
  ['customer catalog grant', c => { c.actor.profile.permissions.push('customers.read'); }],
  ['global data scope', c => { c.actor.profile.dataScopes.push('all'); }],
]) test(`inventory dynamic-role resolution rejects ${name}`, () => {
  const c = warehouseBrowserContext(); mutate(c);
  assert.throws(() => raceBrowserActor({}, c.shared, c.actor.id));
});

function harness() {
  const file = path.join(__dirname, 'lib/enterprise-round2-sales.cjs');
  const module = { exports: {} }, calls = [], legacy = cohort();
  const context = vm.createContext({ module, exports: module.exports, process: { env: {} },
    require(name) {
      if (name === 'node:fs') return { mkdirSync() {} };
      if (name === './enterprise-round2-workforce.cjs') return { createWorkforce: async () => { calls.push('create'); return legacy; } };
      if (name === './purchase-quality-audit-fixture.cjs') return {};
      if (name.startsWith('node:')) return require(name);
      assert.fail(`Unexpected dependency before first fixture: ${name}`);
    },
  });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  const run = async workforce => {
    let captured;
    await assert.rejects(module.exports.sharedSalesChain({
      runId: 'shared-workforce-context', reportPath: '/unused/context/report.json', urls: ['http://127.0.0.1:5006'],
      bootstrap: { id: 1, token: 'private-bootstrap' }, catalog, ...(workforce ? { workforce } : {}),
      request: async () => { assert.fail('No HTTP request is expected before the fixture sentinel'); },
      dataOf: value => value,
      ensureReleasedMaterial: async () => { throw new Error('FIRST_FIXTURE_SENTINEL'); },
    }, AbortSignal.timeout(1000)), error => {
      assert.equal(error.message, 'FIRST_FIXTURE_SENTINEL'); captured = error.evidence; return true;
    });
    return JSON.parse(JSON.stringify(captured));
  };
  return { run, calls, legacy };
}

test('shared sales reuses the run-owned twenty actors instead of creating a second cohort', async () => {
  const h = harness(), shared = cohort();
  shared.actors.forEach(actor => { actor.id += 1000; actor.profile.id = actor.id; });
  const e = await h.run(shared);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(e.workforce.actors.map(actor => actor.id), shared.actors.map(actor => actor.id));
  assert.equal(e.workforce.actors.length, 20);
  assert.equal(e.workforce.configurationOnly, true);
  assert.equal(e.workforce.participationNotYetProven, true);
  assert(!/private-|password|"token"/.test(JSON.stringify(e)), 'Private execution state must not enter evidence');
});

test('standalone shared-sales callers retain their original independent fixture setup', async () => {
  const h = harness(), e = await h.run();
  assert.deepEqual(h.calls, ['create']);
  assert.deepEqual(e.workforce.actors.map(actor => actor.id), h.legacy.actors.map(actor => actor.id));
  assert.equal(e.status, 'failed');
  assert(!Object.hasOwn(e, 'passed'), 'A fixture-boundary contract is not business acceptance');
});

function mainHarness({ respond, auditRunner, verifyWorkforceParticipation, env = {} } = {}) {
  const file = path.join(__dirname, 'enterprise-round2-audit-v1.cjs'), module = { exports: {} };
  const source = fs.readFileSync(file, 'utf8'), marker = '\nmain().catch';
  assert.equal(source.split(marker).length, 2, 'Select the sole entry invocation, never skip a business helper');
  const http = [];
  const context = vm.createContext({ module, exports: module.exports, AbortSignal, URL, Buffer,
    process: { env: { APP_URL: 'http://127.0.0.1:5006', SECONDARY_APP_URL: 'http://127.0.0.1:5008', ...env } },
    console: { log() {} },
    async fetch(url, options) {
      const sent = options.body ? JSON.parse(options.body) : null;
      http.push({ url, authorization: options.headers.authorization, method: options.method, sent });
      if (respond) {
        const reply = await respond(url, options, sent);
        return { ok: reply.status >= 200 && reply.status < 300, status: reply.status,
          async text() { return JSON.stringify(reply.json); } };
      }
      return { ok: true, status: 201, async text() { return JSON.stringify({ success: true, data: { id: 900, ...sent } }); } };
    },
    require(name) {
      if (name.startsWith('node:')) return require(name);
      if (name === './config/enterprise-round2-v1.json') return catalog;
      if (name === './lib/enterprise-round2-runner.cjs') return { createRound2Runner: () => auditRunner || ({ report: {} }) };
      if (name === './lib/enterprise-regression.cjs') return { readRegressionStamp: () => null };
      if (name === './lib/enterprise-round2-workforce-proof.cjs') return { verifyWorkforceParticipation };
      if (name.startsWith('./lib/')) return {};
      assert.fail(`Unexpected setup dependency: ${name}`);
    },
  });
  vm.runInContext(source.slice(0, source.indexOf(marker)) + `\nmodule.exports = {
    request, customer, shipment, purchaseRevisionContext, readWorkforceOperations, actions: workforceActions,
    attachWorkforcePreparation, readCurrentWorkforceProfiles, finalizeWorkforceParticipation,
    operations() { return workforceOperations; },
    setOperationsState(db, checks) { prisma = db; runner.report.checks = checks; },
    setState(people, cohort) { Object.assign(actors, people); workforce = cohort; },
    replaceMain(action) { main = action; }
  };`, context, { filename: file });
  const shared = cohort(), admin = { id: 1, role: 'admin', token: 'private-bootstrap' };
  module.exports.setState({ admin, sales: shared.byJob.sales[0], stock0: shared.byJob.warehouse[0] }, shared);
  return { ...module.exports, shared, admin, http, async finishEntry(action = async () => {}) {
    module.exports.replaceMain(action);
    await vm.runInContext(source.slice(source.indexOf(marker)), context, { filename: file });
    return context.process.exitCode;
  } };
}

function operationsHarness({ mutate, profileMutate, positiveMutate, replyStatus = 403, required = ['orders.create'] } = {}) {
  let h;
  const clone = value => JSON.parse(JSON.stringify(value));
  const tables = { order: [{ id: 301, customerId: 201, createdBy: 0 }],
    orderItem: [{ id: 401, orderId: 301, materialId: 501, quantity: 150, unitPrice: 10 }],
    customer: [{ id: 201, status: 'active', updatedAt: '2026-10-21T00:00:00.000Z' }],
    auditLog: [{ id: 601, resource: 'order', resourceId: 301, action: 'CREATE', userId: 0 }] };
  h = mainHarness({ respond: async (url, options) => {
    if (url.endsWith('/api/auth/me')) {
      const profile = clone(h.shared.byJob.system_admin[0].profile); profileMutate?.(profile);
      return { status: 200, json: { success: true, data: profile } };
    }
    if (url.endsWith('/api/orders') && options.method === 'POST') {
      mutate?.(tables);
      return { status: replyStatus, json: { success: false, requiredPermissions: required } };
    }
    return { status: 200, json: { success: true, data: url.endsWith('/system/status') ? { database: { databaseType: 'sqlite-file' } } : [] } };
  } });
  const actor = h.shared.byJob.system_admin[0], sales = h.shared.byJob.sales[0];
  Object.assign(actor.profile, { username: actor.account.username, segment: 'mixed', isActive: true, mustChangePassword: false,
    permissions: ['system.read', 'system.metrics.read', 'system.backup.manage', 'settings.read', 'audit.read'] });
  tables.order[0].createdBy = sales.id; tables.auditLog[0].userId = sales.id;
  const positive = { job: 'sales', actorId: sales.id, role: sales.role, instance: 0, method: 'POST', path: '/orders', status: 201,
    sent: { customerId: 201, items: [{ materialId: 501, productName: 'Existing material', quantity: 150, unit: 'kg', unitPrice: 10 }], paymentTerms: 30 },
    json: { success: true, data: { id: 301, customerId: 201, createdBy: sales.id } } };
  positiveMutate?.(positive);
  const queries = [];
  const db = Object.fromEntries(Object.keys(tables).map(name => [name, { async findMany(options) { queries.push({ name, options }); return clone(tables[name]); } }]));
  const checks = [{ id: 'sales-reservation-partial-fulfillment', evidence: { manifest: { orderId: 301, customerId: 201 }, actions: [positive] } }];
  h.setOperationsState(db, checks);
  return { ...h, tables, positive, queries };
}

test('system administrator denial reuses a successful same-run sales body and snapshots every order-create business write', async () => {
  const h = operationsHarness(); await h.readWorkforceOperations(AbortSignal.timeout(1000));
  const proof = JSON.parse(JSON.stringify(h.operations())), denied = proof.denial;
  assert.deepEqual(denied.sent, h.positive.sent); assert.deepEqual(denied.positiveControl, h.positive);
  assert.equal(denied.actorId, h.shared.byJob.system_admin[0].id); assert.equal(denied.instance, 1);
  assert.equal(denied.method, 'POST'); assert.equal(denied.path, '/orders'); assert.equal(denied.profile.isActive, true);
  assert.deepEqual(Object.keys(denied.before).sort(), ['auditLog', 'customer', 'order', 'orderItem']);
  assert.deepEqual(denied.before, h.tables); assert.deepEqual(denied.after, denied.before);
  assert.equal(h.queries.length, 8);
  assert(h.queries.filter(q => q.name === 'auditLog').every(q => q.options.where.resource === 'order' && q.options.where.action === 'CREATE'));
  assert.equal(h.http.filter(r => r.method === 'POST').length, 1, 'Reuse the existing positive control, do not create another order');
  assert(!/private-|password|Bearer|"token"/.test(JSON.stringify(proof)));
});

for (const table of ['order', 'orderItem', 'customer', 'auditLog']) test(`system administrator denial rejects a side effect in ${table}`, async () => {
  const h = operationsHarness({ mutate: tables => { tables[table][0].unexpectedMutation = true; } });
  await assert.rejects(h.readWorkforceOperations(AbortSignal.timeout(1000)), /business facts/);
});

for (const [name, profileMutate] of [
  ['borrowed identity', p => { p.id++; }], ['role drift', p => { p.role = 'admin'; }],
  ['inactive', p => { p.isActive = false; }], ['password reset', p => { p.mustChangePassword = true; }],
  ['extra grant', p => { p.permissions.push('orders.create'); }], ['global scope', p => { p.dataScopes.push('all'); }],
]) test(`system administrator denial rejects current-profile ${name} before the business POST`, async () => {
  const h = operationsHarness({ profileMutate });
  await assert.rejects(h.readWorkforceOperations(AbortSignal.timeout(1000)));
  assert.equal(h.http.filter(r => r.method === 'POST').length, 0);
});

for (const [name, positiveMutate] of [
  ['failed positive control', p => { p.status = 400; }], ['foreign order', p => { p.json.data.id++; }],
  ['foreign customer', p => { p.sent.customerId++; }], ['borrowed sales actor', p => { p.actorId = 1; }],
]) test(`system administrator denial rejects ${name} instead of inventing a fallback customer`, async () => {
  const h = operationsHarness({ positiveMutate });
  await assert.rejects(h.readWorkforceOperations(AbortSignal.timeout(1000)));
  assert.equal(h.http.filter(r => r.method === 'POST').length, 0);
});

test('system administrator denial requires the exact permission error, not an arbitrary 403 or validation error', async () => {
  for (const options of [{ required: ['customers.write'] }, { replyStatus: 400 }]) {
    const h = operationsHarness(options); await assert.rejects(h.readWorkforceOperations(AbortSignal.timeout(1000)));
  }
});

test('main procurement context keeps purchasing approval separate from warehouse receipt and QC/QA', () => {
  const h = mainHarness(), c = h.purchaseRevisionContext();
  assert.equal(c.actors.buyer1, h.shared.byJob.buyer[0]);
  assert.equal(c.actors.buyer2, h.shared.byJob.buyer[1]);
  assert.equal(c.actors.sales, h.shared.byJob.sales[1]);
  assert.deepEqual(Array.from(c.receiptActors.receivers), h.shared.byJob.warehouse.slice(1));
  assert.equal(c.receiptActors.qc, h.shared.byJob.qc[0]);
  assert.equal(c.receiptActors.qa, h.shared.byJob.qa[0]);
  assert.equal(c.actors.admin, h.admin, 'Bootstrap fixture identity is not reassigned to a business job');
});

function receiptHarness() {
  const file = path.join(__dirname, 'lib/enterprise-round2-procurement.cjs'), module = { exports: {} }, calls = [], bursts = [];
  const context = vm.createContext({ module, exports: module.exports, process: { env: {} },
    require(name) {
      if (name === './material-audit-fixture.cjs') return {};
      if (name === './enterprise-round2-runner.cjs') return { synchronizedBurst: async people => { bursts.push(...people); throw new Error('RECEIPT_BURST_SENTINEL'); } };
      if (name === './purchase-quality-audit-fixture.cjs') return {
        explicitPurchaseSources: value => value,
        createApprovedPurchaseFixture: async () => ({ approved: { id: 90, revision: 0 } }),
      };
      assert.fail(`Unexpected receipt contract dependency: ${name}`);
    },
  });
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\nmodule.exports = { purchaseReceiptSubmissionProbe, purchaseReceiptCostProbe };', context, { filename: file });
  const shared = cohort();
  const actors = { buyer1: shared.byJob.buyer[0], buyer2: shared.byJob.buyer[1] };
  const receiver = shared.byJob.warehouse[1], otherReceiver = shared.byJob.warehouse[2];
  const receiptActors = { receivers: [receiver, otherReceiver], qc: shared.byJob.qc[0], qa: shared.byJob.qa[0] };
  const rows = { findMany: async () => [], findUnique: async () => ({ id: 90 }) };
  const ctx = { actors, receiptActors, runId: 'receipt-roles', material: { id: 50, nameZh: 'Synthetic raw material' }, supplier: { id: 60 },
    dataOf: r => r.json.data, verify: () => assert.fail('Sentinel precedes acceptance'),
    prisma: new Proxy({}, { get: () => rows }),
    request: async (endpoint, options) => { calls.push({ endpoint, ...options });
      if (options.data.quantity !== 0.5) throw new Error('RECEIPT_FIRST_WRITE_SENTINEL');
      return { status: 201, json: { data: {} } };
    },
  };
  return { ...module.exports, ctx, calls, bursts, receiver, otherReceiver };
}

for (const explicit of [true, false]) test(`durable receipt missing-key probe reaches business validation as the ${explicit ? 'actual warehouse' : 'legacy buyer'}`, async () => {
  const h = receiptHarness(); if (!explicit) delete h.ctx.receiptActors;
  await assert.rejects(h.purchaseReceiptSubmissionProbe(h.ctx, AbortSignal.timeout(1000)), /RECEIPT_FIRST_WRITE_SENTINEL/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].actor, explicit ? h.receiver : h.ctx.actors.buyer1);
  assert.equal(h.calls[0].method, 'POST');
  assert.deepEqual(Object.keys(h.calls[0].headers), []);
});

for (const explicit of [true, false]) test(`fractional receipt concurrency preserves ${explicit ? 'two actual warehouse receivers' : 'the original compatibility principals'}`, async () => {
  const h = receiptHarness(); if (!explicit) delete h.ctx.receiptActors;
  await assert.rejects(h.purchaseReceiptCostProbe(h.ctx, AbortSignal.timeout(1000)), /RECEIPT_BURST_SENTINEL/);
  const first = explicit ? h.receiver : h.ctx.actors.buyer1;
  assert.equal(h.calls.length, 4); assert(h.calls.every(row => row.actor === first && row.data.quantity === 0.5));
  assert.deepEqual(h.bursts, explicit ? [h.receiver, h.otherReceiver] : [h.ctx.actors.buyer1, h.ctx.actors.buyer2]);
  assert.deepEqual(h.calls.map(row => row.instance), [0, 1, 0, 1]);
});

test('the real main customer/shipment path uses the explicit sales2 and warehouse3 principals, not defaults', async () => {
  const h = mainHarness(), salesperson = h.shared.byJob.sales[1], warehouse = h.shared.byJob.warehouse[2];
  const result = await h.shipment({ material: { id: 50, nameZh: 'Synthetic goods' }, batchNo: 'REAL-LOT' },
    AbortSignal.timeout(1000), 60, { salesperson, warehouse });
  assert.equal(result.id, 900);
  assert.deepEqual(h.http.map(item => item.authorization), [`Bearer ${salesperson.token}`, `Bearer ${warehouse.token}`]);
  assert.equal(h.http[0].sent.salespersonId, salesperson.id);
  assert.equal(h.http[1].sent.customerId, 900); assert.equal(h.http[1].sent.batchNo, 'REAL-LOT');
  assert.equal(h.http[1].sent.quantity, 60);
  const rows = JSON.parse(JSON.stringify(h.actions));
  assert.deepEqual(rows.map(item => item.actorId), [salesperson.id, warehouse.id]);
  assert.deepEqual(rows.map(item => item.path), ['/customers', '/shipping']);
  assert(!/private-|Bearer|"authorization"/.test(JSON.stringify(rows)), 'Private execution identity is not raw audit data');
});

test('the real HTTP recorder excludes bootstrap/configuration activity rather than pretending it is workforce work', async () => {
  const h = mainHarness(), person = h.shared.byJob.sales[0];
  await h.request('/warehouses', { actor: h.admin });
  await h.request('/auth/me', { actor: person });
  assert.equal(h.actions.length, 0);
  await h.request('/orders/7', { actor: person, instance: 1 });
  assert.equal(h.actions.length, 1); assert.equal(h.actions[0].instance, 1);
  assert.equal(h.actions[0].actorId, person.id); assert.equal(h.actions[0].status, 201);
});

function loginHarness() {
  const file = path.join(__dirname, 'lib/ui-audit-user.cjs'), module = { exports: {} }, calls = [], sessions = [];
  const account = { username: 'existing-buyer', password: 'private-existing-password', role: 'fixture_buyer', segment: 'mixed' };
  // Match the real login DTO: isActive is deliberately only returned by /auth/me.
  const user = { id: 71, username: account.username, role: account.role, segment: 'mixed', mustChangePassword: false };
  const currentUser = { ...user, isActive: true, permissions: ['procurement.read'], dataScopes: ['procurement_visible'] };
  const context = vm.createContext({ module, exports: module.exports, process: { env: {} },
    require(name) {
      if (['fs', 'path', 'crypto'].includes(name)) return require(name);
      if (name === './audit-runtime-context.cjs') return { applyAuditDatabaseContext() { calls.push('database-context'); } };
      if (name === '../../backend/node_modules/bcryptjs') return { hash: async () => { calls.push('password-hash'); return 'private-hash'; } };
      if (name === '../../backend/node_modules/@prisma/client') return { PrismaClient: class {
        constructor() { calls.push('database-client'); this.user = { upsert: async () => { calls.push('upsert'); } }; }
        async $disconnect() { calls.push('disconnect'); }
      } };
      assert.fail(`Unexpected login dependency: ${name}`);
    },
  });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  const page = { request: { post: async (url, options) => { calls.push({ url, data: options.data });
    return { ok: () => true, json: async () => ({ data: { token: 'private-session-token', user } }) }; },
  get: async (url, options) => { calls.push({ url, headers: options.headers });
    return { ok: () => true, json: async () => ({ data: currentUser }) }; } },
  addInitScript: async (_apply, session) => { calls.push('session-init'); sessions.push(session); },
  evaluate: async (_apply, session) => { calls.push('session-current'); sessions.push(session); } };
  return { ...module.exports, calls, account, user, currentUser, page, sessions };
}

test('UI login default still prepares the original fixture account', async () => {
  const h = loginHarness(), result = await h.loginUiAuditUser(h.page, 'http://127.0.0.1:5006/', { account: h.account });
  assert.equal(result.user.id, 71); assert(h.calls.includes('upsert')); assert(h.calls.includes('password-hash'));
  assert.equal(h.calls.filter(x => typeof x === 'object').length, 1, 'Legacy login does not gain a new HTTP dependency');
});

test('existing-account login accepts the real login DTO and returns authenticated fresh readiness without fixture writes', async () => {
  const h = loginHarness(), result = await h.loginUiAuditUser(h.page, 'http://127.0.0.1:5006/', { account: h.account, reuseExistingAccount: true });
  assert.equal(result.account, h.account); assert.equal(result.user.id, 71);
  assert.equal(result.user, h.currentUser); assert.equal(result.user.isActive, true);
  assert.deepEqual(result.user.permissions, ['procurement.read']); assert(!Object.hasOwn(h.user, 'isActive'));
  assert.deepEqual(h.calls.filter(x => typeof x === 'string'), ['session-init', 'session-current']);
  assert.equal(h.calls[0].url, 'http://127.0.0.1:5006/api/auth/login');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].data)), { username: h.account.username, password: h.account.password });
  assert.equal(h.calls[1].url, 'http://127.0.0.1:5006/api/auth/me');
  assert.equal(h.calls[1].headers.Authorization, 'Bearer private-session-token');
  assert.equal(h.sessions.length, 2); assert(h.sessions.every(session => session.savedUser === h.currentUser));
});

test('a mistyped existing-account option cannot silently reset a shared identity', async () => {
  const h = loginHarness();
  await assert.rejects(h.loginUiAuditUser(h.page, 'http://127.0.0.1:5006/', { account: h.account, reuseExistingAccount: 'true' }));
  assert.deepEqual(h.calls, []);
});

for (const field of ['account', 'username', 'password', 'role']) test(`existing-account login rejects missing ${field} before database or HTTP`, async () => {
  const h = loginHarness(), account = { ...h.account }; delete account[field];
  await assert.rejects(h.loginUiAuditUser(h.page, 'http://127.0.0.1:5006/', { account: field === 'account' ? undefined : account, reuseExistingAccount: true }));
  assert.deepEqual(h.calls, []);
});

for (const [name, mutate] of [
  ['username', h => { h.user.username = 'another-person'; }],
  ['role', h => { h.user.role = 'admin'; }],
  ['invalid id', h => { h.user.id = 0; }],
  ['segment', h => { h.user.segment = 'channel'; }],
  ['password change required', h => { h.user.mustChangePassword = true; }],
  ['missing password readiness', h => { delete h.user.mustChangePassword; }],
]) test(`existing-account login rejects ${name} drift before installing a session`, async () => {
  const h = loginHarness(); mutate(h);
  await assert.rejects(h.loginUiAuditUser(h.page, 'http://127.0.0.1:5006/', { account: h.account, reuseExistingAccount: true }));
  assert.equal(h.calls.length, 1); assert.equal(typeof h.calls[0], 'object');
});

for (const [name, mutate] of [
  ['another id', h => { h.currentUser.id++; }],
  ['another username', h => { h.currentUser.username = 'another-person'; }],
  ['another role', h => { h.currentUser.role = 'admin'; }],
  ['another segment', h => { h.currentUser.segment = 'direct'; }],
  ['inactive account', h => { h.currentUser.isActive = false; }],
  ['missing active state', h => { delete h.currentUser.isActive; }],
  ['password change required', h => { h.currentUser.mustChangePassword = true; }],
  ['missing password readiness', h => { delete h.currentUser.mustChangePassword; }],
]) test(`existing-account login rejects fresh /auth/me ${name} without fixture writes or session installation`, async () => {
  const h = loginHarness(); mutate(h);
  await assert.rejects(h.loginUiAuditUser(h.page, 'http://127.0.0.1:5006/', { account: h.account, reuseExistingAccount: true }));
  assert.equal(h.calls.length, 2); assert(h.calls.every(x => typeof x === 'object'));
});

test('existing-account login rejects /auth/me HTTP failure before session installation', async () => {
  const h = loginHarness(); h.page.request.get = async () => ({ ok: () => false, status: () => 401 });
  await assert.rejects(h.loginUiAuditUser(h.page, 'http://127.0.0.1:5006/', { account: h.account, reuseExistingAccount: true }), /401/);
  assert.equal(h.calls.length, 1);
});

for (const endpoint of ['post', 'get']) test(`existing-account ${endpoint} transport errors do not disclose credentials`, async () => {
  const h = loginHarness(); h.page.request[endpoint] = async () => {
    throw new Error(`request failed with private-session-token ${h.account.password}`);
  };
  await assert.rejects(h.loginUiAuditUser(h.page, 'http://127.0.0.1:5006/', { account: h.account, reuseExistingAccount: true }), error => {
    const diagnostics = [error.message, error.stack, JSON.stringify(error)].join('\n');
    assert(!diagnostics.includes('private-session-token')); assert(!diagnostics.includes(h.account.password)); return true;
  });
  assert(h.calls.every(x => typeof x === 'object'));
});

for (const endpoint of ['post', 'get']) test(`existing-account ${endpoint} response parsing errors do not disclose credentials`, async () => {
  const h = loginHarness(); h.page.request[endpoint] = async () => ({ ok: () => true, json: async () => {
    throw new Error(`invalid response private-session-token ${h.account.password}`);
  } });
  await assert.rejects(h.loginUiAuditUser(h.page, 'http://127.0.0.1:5006/', { account: h.account, reuseExistingAccount: true }), error => {
    const diagnostics = [error.message, error.stack, JSON.stringify(error)].join('\n');
    assert(!diagnostics.includes('private-session-token')); assert(!diagnostics.includes(h.account.password)); return true;
  });
  assert.equal(h.sessions.length, 0); assert(h.calls.every(x => typeof x === 'object'));
});

test('an empty authenticated /auth/me response cannot invent readiness', async () => {
  const h = loginHarness(); h.page.request.get = async () => ({ ok: () => true, json: async () => ({ data: null }) });
  await assert.rejects(h.loginUiAuditUser(h.page, 'http://127.0.0.1:5006/', { account: h.account, reuseExistingAccount: true }), /profile identity or readiness changed/);
  assert.equal(h.sessions.length, 0); assert(h.calls.every(x => typeof x === 'object'));
});

function revisionProofHarness() {
  const file = path.join(__dirname, 'lib/enterprise-round2-procurement-browser.cjs'), module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, URL,
    require(name) { if (name.startsWith('node:')) return require(name);
      if (name === './enterprise-round2-procurement.cjs') return require('./lib/enterprise-round2-procurement.cjs');
      if (name.startsWith('./')) return {}; assert.fail(`Unexpected revision proof dependency: ${name}`); },
  });
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\nmodule.exports = { workforceRevisionBuyers, revisionBuyerProfile, verifyWorkforceRevisionWrites };', context, { filename: file });
  const shared = cohort();
  for (const a of shared.byJob.buyer) { a.account.role = a.role; a.account.segment = 'mixed';
    a.profile = { id: a.id, username: a.account.username, role: a.role, segment: 'mixed', isActive: true, mustChangePassword: false,
      permissions: ['procurement.read', 'procurement.write', 'procurement.approve'], dataScopes: ['procurement_visible'] };
  }
  const buyers = shared.byJob.buyer, orderId = 90;
  const writes = [[0, 'PATCH', '', 200], [1, 'PATCH', '', 409], [1, 'PATCH', '', 200], [1, 'POST', '/confirm-sources', 200], [0, 'PATCH', '/status', 200]]
    .map(([index, method, suffix, status]) => ({ actorId: buyers[index].id, role: buyers[index].role, instance: index, method, path: `/api/procurement/orders/${orderId}${suffix}`, status }));
  const audit = (id, index, action, details) => ({ id, userId: buyers[index].id, resource: 'purchase_order', resourceId: orderId, action, details: JSON.stringify(details) });
  const audits = [audit(1, 0, 'CREATE', {}), audit(2, 1, 'STATUS_CHANGE', { schema: 'purchase-status/v2', revision: 0, isSourceApproval: true }),
    audit(3, 0, 'REVISE', { schema: 'purchase-revision/v1', after: { id: String(orderId), revision: 1, quantity: 120, price: 11 } }),
    audit(4, 1, 'REVISE', { schema: 'purchase-revision/v1', after: { id: String(orderId), revision: 2, quantity: 80, price: 9 } }),
    audit(5, 1, 'CONFIRM_SOURCES', { schema: 'purchase-source-confirmation/v1', after: { id: String(orderId), revision: 3 }, source: { revision: 3 } }),
    audit(6, 0, 'STATUS_CHANGE', { schema: 'purchase-status/v2', revision: 3, from: 'pending', to: 'approved', isSourceApproval: true, sourceAuditId: 5 })];
  return { ...module.exports, shared, buyers, writes, audits, orderId };
}

test('PO browser resolves only its two run-owned purchasing principals and preserves legacy mode', () => {
  const h = revisionProofHarness(); assert.equal(h.workforceRevisionBuyers({ actors: {} }), null);
  const actual = h.workforceRevisionBuyers({ workforce: h.shared, actors: { buyer1: h.buyers[0], buyer2: h.buyers[1] } });
  assert.equal(actual[0], h.buyers[0]); assert.equal(actual[1], h.buyers[1]);
});

test('PO buyer profile and cohort identity mismatches fail closed', () => {
  const h = revisionProofHarness();
  assert.throws(() => h.revisionBuyerProfile({ ...h.buyers[0].profile, id: h.buyers[1].id }, h.buyers[0]));
  assert.throws(() => h.revisionBuyerProfile({ ...h.buyers[0].profile, permissions: ['*'] }, h.buyers[0]));
  assert.throws(() => h.workforceRevisionBuyers({ workforce: h.shared, actors: { buyer1: h.buyers[1], buyer2: h.buyers[0] } }));
});

test('PO browser writes bind two revisions and the other buyer approval to persisted audit identities', () => {
  const h = revisionProofHarness(); h.verifyWorkforceRevisionWrites(h.orderId, h.buyers, h.writes, h.audits);
  assert(!/private-|password|token/.test(JSON.stringify({ writes: h.writes, audits: h.audits })));
});

for (const [name, mutate] of [
  ['self approval', h => { h.audits.at(-1).userId = h.buyers[1].id; }],
  ['borrowed browser actor', h => { h.writes[0].actorId = 1; }],
  ['missing conflict write', h => { h.writes.splice(1, 1); }],
  ['wrong source audit', h => { const d = JSON.parse(h.audits.at(-1).details); d.sourceAuditId = 3; h.audits.at(-1).details = JSON.stringify(d); }],
]) test(`PO native/audit proof rejects ${name}`, () => {
  const h = revisionProofHarness(); mutate(h);
  assert.throws(() => h.verifyWorkforceRevisionWrites(h.orderId, h.buyers, h.writes, h.audits));
});

function purchasingBrowserHarness({ drift = false, exposeObservedWrite = false } = {}) {
  const file = path.join(__dirname, 'lib/enterprise-round2-procurement-browser.cjs'), module = { exports: {} };
  const { shared, buyers } = revisionProofHarness(), calls = [], pages = [];
  const browser = { async newPage() {
    const index = pages.length, actor = buyers[index];
    const page = { setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, on() {},
      waitForResponse: async () => ({ status: () => 200, json: async () => ({ data: { ...actor.profile,
        ...(drift && index === 1 ? { id: buyers[0].id } : {}) } }) }),
      async goto() { calls.push({ type: 'native-auth', actorId: actor.id }); }, async screenshot() {},
      getByTestId() { return { async click() { if (index === 1) throw new Error('PO_NATIVE_FIELDS_SENTINEL'); }, async waitFor() {}, async fill() {} }; } };
    pages.push(page); return page;
  }, async close() {} };
  const context = vm.createContext({ module, exports: module.exports, URL,
    require(name) {
      if (name === 'node:fs') return { mkdirSync() {} }; if (name.startsWith('node:')) return require(name);
      if (name === './material-audit-fixture.cjs') return { ensureReleasedMaterial: async () => ({ id: 50, nameZh: 'Synthetic material' }) };
      if (name === './browser-launch-guard.cjs') return { launchBrowserWithGuard: async () => ({ browser }) };
      if (name === './browser-cjk-font-guard.cjs') return { verifyRenderedCjk: async () => ({}) };
      if (name === './procurement-toolbar-layout-audit.cjs') return { verifyProcurementToolbarLayouts: async () => [] };
      if (name === './ui-audit-user.cjs') return { loginUiAuditUser: async (_page, _url, options) => {
        const actor = buyers.find(item => item.account === options.account); assert(actor); assert.equal(options.reuseExistingAccount, true);
        calls.push({ type: 'existing-login', actorId: actor.id }); return { user: actor.profile, token: `private-current-${actor.id}` };
      } };
      if (name === './purchase-quality-audit-fixture.cjs') return {
        explicitPurchaseSources: value => value,
        createApprovedPurchaseFixture: async (_ctx, people) => { assert.equal(people.buyer, buyers[0]); assert.equal(people.approver, buyers[1]); return { approved: { id: 90 } }; },
      };
      if (name.startsWith('./')) return {}; assert.fail(`Unexpected purchasing browser dependency: ${name}`);
    },
  });
  let source = fs.readFileSync(file, 'utf8');
  if (exposeObservedWrite) {
    const anchor = '  async function clickWrite(page, testId, suffix) {';
    assert.equal(source.split(anchor).length, 2, 'Expose only the real nested observer in this VM test');
    source = source.replace(anchor, '  module.exports.observedWrite = observedWrite;\n' + anchor);
  }
  vm.runInContext(source, context, { filename: file });
  const ctx = { workforce: shared, actors: { buyer1: buyers[0], buyer2: buyers[1] }, runId: 'purchasing-roles',
    reportPath: '/unused/purchasing/report.json', urls: ['http://127.0.0.1:5006', 'http://127.0.0.1:5008'],
    dataOf: r => r.json.data, request: async (endpoint, options) => {
      if (endpoint === '/auth/me') { calls.push({ type: 'api-auth', actorId: options.actor.id, instance: options.instance }); return { json: { data: options.actor.profile } }; }
      assert.equal(endpoint, '/procurement/suppliers'); return { json: { data: { id: 60 } } };
    } };
  return { ...module.exports, ctx, calls, buyers, pages, api: module.exports };
}

test('the real purchasing browser reuses both accounts and verifies dual-node plus native profiles before editing', async () => {
  const h = purchasingBrowserHarness();
  await assert.rejects(h.purchaseRevisionBrowser(h.ctx, AbortSignal.timeout(1000)), /PO_NATIVE_FIELDS_SENTINEL/);
  assert.deepEqual(h.calls.filter(x => x.type === 'existing-login').map(x => x.actorId), h.buyers.map(a => a.id));
  assert.deepEqual(h.calls.filter(x => x.type === 'api-auth').map(x => [x.actorId, x.instance]), h.buyers.flatMap(a => [[a.id, 0], [a.id, 1]]));
  assert.deepEqual(h.calls.filter(x => x.type === 'native-auth').map(x => x.actorId), h.buyers.map(a => a.id));
});

test('the real purchasing browser stops before native editing when its second page returns a borrowed profile', async () => {
  const h = purchasingBrowserHarness({ drift: true });
  await assert.rejects(h.purchaseRevisionBrowser(h.ctx, AbortSignal.timeout(1000)), /Purchasing session actor changed/);
});

test('a foreign purchasing browser credential is rejected without leaking either session in audit errors', async () => {
  const h = purchasingBrowserHarness({ exposeObservedWrite: true });
  await assert.rejects(h.purchaseRevisionBrowser(h.ctx, AbortSignal.timeout(1000)), /PO_NATIVE_FIELDS_SENTINEL/);
  const foreign = 'private-foreign-browser-session', expected = h.buyers[0].token;
  const response = { json: async () => ({}), request: () => ({ allHeaders: async () => ({ authorization: 'Bearer ' + foreign }) }) };
  await assert.rejects(h.api.observedWrite(h.pages[0], response), error => {
    assert.match(error.message, /Browser write used another purchasing session/);
    const diagnostics = [error.message, error.stack, JSON.stringify(error)].join('\n');
    assert(!diagnostics.includes(foreign), 'Foreign authorization escaped into failure evidence');
    assert(!diagnostics.includes(expected), 'Expected authorization escaped into failure evidence');
    return true;
  });
});

function finalizationHarness({ provider = 'postgresql', failure, deniedNode, partial = false, only } = {}) {
  const parent = path.join(__dirname, '../output/contract');
  fs.mkdirSync(parent, { recursive: true });
  const folder = fs.mkdtempSync(path.join(parent, 'workforce-final-'));
  const auditRunner = createRound2Runner({ catalog, reportPath: path.join(folder, 'report.json'), metadata: { provider } });
  for (const check of auditRunner.report.checks) if (check.id !== 'workforce-rbac'
    && (provider === 'postgresql' || !['database-restart-ambiguous-commit', 'recovery-full-ledger-reconciliation'].includes(check.id))) {
    check.status = 'passed'; check.evidence = { wiringFixtureOnly: true };
  }
  if (partial) auditRunner.report.checks.find(c => c.id === 'bom-revision-freeze').status = 'failed';
  let h, calls = 0;
  h = mainHarness({ auditRunner, env: only ? { ROUND2_ONLY_CHECK: only } : {},
    respond: async (url, options) => {
      assert(url.endsWith('/api/auth/me'));
      const actor = h.shared.actors.find(a => `Bearer ${a.token}` === options.headers.authorization); assert(actor);
      const denied = deniedNode && actor.job === 'qa' && url.startsWith('http://127.0.0.1:5008');
      return denied ? { status: 401, json: { success: false } } : { status: 200, json: { success: true, data: actor.profile } };
    },
    verifyWorkforceParticipation(report, options) {
      calls++; assert.equal(report, auditRunner.report); assert.equal(options.requirePostgres, provider === 'postgresql');
      for (const actor of report.workforcePreparation.actors) for (const instance of [0, 1]) {
        assert.equal(actor.currentProfileResponsesByInstance[instance].status, 200, 'Final profile denied');
        assert.equal(actor.currentProfilesByInstance[instance].id, actor.id);
      }
      if (failure) throw new Error('REAL_FINAL_VERIFIER_FAILURE');
      return { wiringFixtureOnly: true, businessParticipationAccepted: provider === 'postgresql' };
    } });
  return { h, auditRunner, folder, calls: () => calls };
}

test('final orchestration refreshes forty current profiles then invokes the real runner final ID once', async () => {
  const x = finalizationHarness(); await x.h.finalizeWorkforceParticipation(); await x.h.finalizeWorkforceParticipation();
  assert.equal(x.calls(), 1); assert.equal(x.h.http.length, 40);
  assert.equal(new Set(x.h.http.map(r => `${r.authorization}:${r.url}`)).size, 40);
  assert.equal(x.auditRunner.report.checks.find(c => c.id === 'workforce-rbac').status, 'passed');
  assert.equal(x.auditRunner.report.workforcePreparation.businessParticipationAccepted, true);
  assert(!/private-|password|"token"/.test(JSON.stringify(x.auditRunner.report.workforcePreparation)));
});

test('SQLite final orchestration validates available duties but never promotes the original final ID', async () => {
  const x = finalizationHarness({ provider: 'sqlite' }); await x.h.finalizeWorkforceParticipation();
  assert.equal(x.calls(), 1); assert.equal(x.h.http.length, 40);
  assert.equal(x.auditRunner.report.checks.find(c => c.id === 'workforce-rbac').status, 'not_run');
  assert.equal(x.auditRunner.report.workforcePreparation.businessParticipationAccepted, false);
  assert.equal(x.auditRunner.report.workforcePreparation.verification.businessParticipationAccepted, false);
});

for (const options of [{ failure: true }, { deniedNode: true }]) test(`final orchestration retains failure and does not retry it: ${JSON.stringify(options)}`, async () => {
  const x = finalizationHarness(options);
  await assert.rejects(x.h.finalizeWorkforceParticipation());
  await x.h.finalizeWorkforceParticipation();
  assert.equal(x.calls(), 1); assert.equal(x.h.http.length, 40);
  assert.equal(x.auditRunner.report.checks.find(c => c.id === 'workforce-rbac').status, 'failed');
  assert.equal(x.auditRunner.report.workforcePreparation.businessParticipationAccepted, false);
  assert(x.auditRunner.report.workforcePreparation.verificationError);
  if (options.deniedNode) {
    const qa = x.auditRunner.report.workforcePreparation.actors.find(a => a.job === 'qa');
    assert.equal(qa.currentProfileResponsesByInstance[1].status, 401);
    assert.equal(qa.currentProfilesByInstance[1], null, 'Do not fall back to the initial profile');
  }
});

test('a missing prior chain prevents PG final acceptance without erasing raw current profiles', async () => {
  const x = finalizationHarness({ partial: true }); await x.h.finalizeWorkforceParticipation();
  assert.equal(x.calls(), 0); assert.equal(x.h.http.length, 40);
  assert.equal(x.auditRunner.report.checks.find(c => c.id === 'workforce-rbac').status, 'not_run');
  assert(x.auditRunner.report.workforcePreparation.verificationNotRunReason);
});

test('single-check diagnostic never invents whole-workforce acceptance', async () => {
  const x = finalizationHarness({ only: 'shared-sales' }); await x.h.finalizeWorkforceParticipation();
  assert.equal(x.calls(), 0); assert.equal(x.h.http.length, 0);
  assert.equal(x.auditRunner.report.checks.find(c => c.id === 'workforce-rbac').status, 'not_run');
});

test('entry finally publishes terminal report and failure exit when SQLite final verification fails', async () => {
  const x = finalizationHarness({ provider: 'sqlite', failure: true });
  assert.equal(await x.h.finishEntry(), 1);
  const report = JSON.parse(fs.readFileSync(path.join(x.folder, 'report.json'), 'utf8'));
  assert(report.finishedAt); assert.match(report.executionError, /REAL_FINAL_VERIFIER_FAILURE/);
  assert.match(report.workforcePreparation.verificationError, /REAL_FINAL_VERIFIER_FAILURE/);
  assert.equal(report.checks.find(c => c.id === 'workforce-rbac').status, 'not_run');
});
