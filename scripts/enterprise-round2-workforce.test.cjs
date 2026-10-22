const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('./config/enterprise-round2-v1.json');

// Stub the existing database fixture boundary before loading the helper. No
// Prisma/bcrypt/runtime/server dependencies or live credentials are necessary.
const auditUserPath = require.resolve('./lib/ui-audit-user.cjs');
const originalModule = require.cache[auditUserPath];
let seedAccount;
require.cache[auditUserPath] = { id: auditUserPath, filename: auditUserPath, loaded: true,
  exports: { ensureUiAuditUser: async account => seedAccount(account) } };
const { createWorkforce } = require('./lib/enterprise-round2-workforce.cjs');
if (originalModule) require.cache[auditUserPath] = originalModule;
else delete require.cache[auditUserPath];

const registrySource = fs.readFileSync(path.join(__dirname, '../backend/src/permissions/permissionRegistry.ts'), 'utf8');
const definitionsSource = registrySource.split('export const PERMISSION_DEFINITIONS:')[1].split('export const ALL_PERMISSION_CODES')[0];
const registry = [...definitionsSource.matchAll(/\bcode:\s*'([^']+)'/g)].map(match => ({ code: match[1] }));
const scopes = [...registrySource.split('export type DataScope =')[1].split('export type Permission =')[0].matchAll(/'([^']+)'/g)].map(match => match[1]);
const copy = value => JSON.parse(JSON.stringify(value));
const sorted = values => [...values].sort();

function harness(options = {}) {
  const calls = [], ensured = [], policies = new Map(), users = new Map(), tokens = new Map();
  const bootstrapToken = 'private-bootstrap-token', password = 'Private-fixture-password!Aa1';
  seedAccount = async account => {
    ensured.push(copy(account));
    const user = { id: 100 + ensured.length, username: account.username, role: account.role,
      segment: account.segment, isActive: true, mustChangePassword: false };
    users.set(account.username, { ...user, password: account.password });
    return account;
  };
  const result = (data, status = 200) => ({ status, json: { success: status < 400, data } });
  const profile = (user, endpoint, instance) => {
    const publicUser = { ...user }; delete publicUser.password;
    const policy = policies.get(user.role);
    const value = { ...publicUser, permissions: [...policy.permissions], dataScopes: [...policy.dataScopes] };
    return options.profile ? options.profile(value, { endpoint, instance, user, policies }) || value : value;
  };
  const request = async (endpoint, opts) => {
    assert(Object.hasOwn(opts, 'auth'), `${endpoint}: implicit auth is forbidden`);
    assert([0, 1].includes(opts.instance), `${endpoint}: explicit node is required`);
    calls.push({ endpoint, ...copy(opts) });
    if (options.intercept) {
      const intercepted = options.intercept(endpoint, opts, { calls, ensured, policies, users, tokens, result });
      if (intercepted) return intercepted;
    }
    if (endpoint === '/auth/me' && opts.auth === bootstrapToken) {
      assert.equal(opts.method, 'GET');
      return result({ id: 1, role: 'admin', username: 'bootstrap', permissions: registry.map(row => row.code), dataScopes: ['all'] });
    }
    if (endpoint === '/roles/permissions') {
      assert.equal(opts.method, 'GET'); assert.equal(opts.auth, bootstrapToken);
      const definitions = copy(registry);
      return result(options.registry ? options.registry(definitions, opts.instance) : definitions);
    }
    if (endpoint === '/roles') {
      assert.equal(opts.auth, bootstrapToken); assert.equal(opts.instance, 0); assert.equal(opts.method, 'POST');
      assert(!policies.has(opts.data.code), 'Policy identity must be unique');
      const created = { ...copy(opts.data), id: policies.size + 1, isSystem: false };
      policies.set(created.code, created);
      return result(options.created ? options.created(created) || created : created, 201);
    }
    if (endpoint === '/auth/login') {
      assert.equal(opts.auth, null); assert.equal(opts.method, 'POST'); assert.equal(opts.instance, 0);
      const user = users.get(opts.data.username);
      assert(user, 'Only an actually ensured account may login'); assert.equal(opts.data.password, user.password);
      const token = options.token ? options.token(user) : `private-actor-token-${user.id}`;
      tokens.set(token, user);
      return result({ token, user: profile(user, endpoint, opts.instance) });
    }
    if (endpoint === '/auth/me') {
      assert.equal(opts.method, 'GET');
      const user = tokens.get(opts.auth);
      assert(user, 'auth/me must use the actor token, never the bootstrap default');
      return result(profile(user, endpoint, opts.instance));
    }
    assert.fail(`Unexpected endpoint: ${endpoint}`);
  };
  const dataOf = response => {
    assert([200, 201].includes(response.status), `HTTP ${response.status}`);
    assert(response.json.data, 'Response has no data');
    return response.json.data;
  };
  return { calls, ensured, policies, users, tokens, run: (changes = {}) => createWorkforce({ request, dataOf, bootstrapToken,
    runId: 'r2-workforce-contract-2026-10-16', password, catalog: copy(catalog), ...changes }) };
}

test('real catalog creates 14 dynamic policies and exactly 20 independent non-admin accounts', { timeout: 5000 }, async () => {
  const fake = harness(), workforce = await fake.run();
  assert.equal(workforce.version, 'enterprise-round2-workforce/v1');
  assert.equal(workforce.configurationOnly, true); assert.equal(workforce.participationNotYetProven, true);
  assert.equal(workforce.actors.length, 20); assert.equal(fake.ensured.length, 20); assert.equal(fake.policies.size, 14);
  assert.equal(new Set(workforce.actors.map(actor => actor.id)).size, 20);
  assert.equal(new Set(workforce.actors.map(actor => actor.account.username)).size, 20);
  assert.equal(new Set(workforce.actors.map(actor => actor.token)).size, 20);
  assert.deepEqual(Object.keys(workforce.byJob), catalog.roles.map(row => row.job));
  for (const { job, count } of catalog.roles) {
    assert.equal(workforce.byJob[job].length, count);
    assert.deepEqual(workforce.byJob[job].map(actor => actor.index), Array.from({ length: count }, (_, index) => index + 1));
    for (const actor of workforce.byJob[job]) {
      assert.equal(actor.job, job); assert.equal(actor.id, Number(actor.profile.id)); assert.notEqual(actor.id, 1);
      assert(!['admin', 'manager', 'sales', 'warehouse', 'finance'].includes(actor.role));
      assert.equal(actor.account.role, actor.role); assert.equal(actor.account.segment, 'mixed');
      assert.match(actor.role, /^[a-z][a-z0-9_:-]{1,49}$/); assert(actor.account.username.length <= 48);
      assert.equal(workforce.actors.find(value => value.id === actor.id), actor);
      assert.deepEqual(actor.profilesByInstance[0], actor.profilesByInstance[1]);
      assert.equal(actor.profile, actor.profilesByInstance[0]);
      assert(!actor.profile.dataScopes.includes('all'));
      assert(actor.profile.permissions.every(code => registry.some(row => row.code === code)), 'Every grant exists in actual source registry');
      assert(actor.profile.dataScopes.every(scope => scopes.includes(scope)), 'Every scope exists in actual source registry');
    }
  }
  assert.equal(fake.calls.filter(call => call.endpoint === '/roles/permissions').length, 2);
  assert.equal(fake.calls.filter(call => call.endpoint === '/auth/login').length, 20);
  assert.equal(fake.calls.filter(call => call.endpoint === '/auth/me').length, 41);
  assert(!Object.hasOwn(workforce, 'checks')); assert(!Object.hasOwn(workforce, 'passed'));
  assert(fake.calls.every(call => ['/auth/me', '/auth/login', '/roles/permissions', '/roles'].includes(call.endpoint)), 'No business operation or acceptance ID is performed by configuration');
});

test('warehouse, procurement, quality, finance and production grants remain precisely separated', { timeout: 5000 }, async () => {
  const { byJob } = await harness().run();
  const permissions = job => byJob[job][0].profile.permissions;
  const exact = (job, grants, dataScopes) => {
    assert.deepEqual(sorted(permissions(job)), sorted(grants));
    assert.deepEqual(sorted(byJob[job][0].profile.dataScopes), sorted(dataScopes));
  };
  exact('warehouse', ['orders.shippingReady.read', 'shipping.read', 'shipping.write', 'shipping.receipts.read', 'warehouse.read', 'warehouse.write',
    'warehouse.ledger.read', 'procurement.read', 'procurement.receive', 'procurement.suppliers.read', 'materials.read'], ['warehouse_visible', 'procurement_visible']);
  exact('owner', ['orders.read', 'orders.payment.verify', 'finance.read', 'procurement.read', 'procurement.approve', 'procurement.payment.verify', 'collections.read', 'barter.read', 'barter.approve', 'orders.payment.reversal.review'], ['finance_visible', 'procurement_visible']);
  exact('sales_lead', ['orders.read', 'orders.update', 'orders.status.manage', 'orders.complete', 'customers.read', 'materials.read', 'shipping.read', 'shipping.receipts.read'], ['team_customers']);
  exact('sales', ['orders.read', 'orders.create', 'orders.update', 'orders.payment.record', 'customers.read', 'customers.create', 'customers.update', 'materials.read', 'shipping.read', 'shipping.receipts.read', 'barter.read', 'barter.write'], ['own_customers']);
  exact('buyer', ['procurement.read', 'procurement.write', 'procurement.approve', 'procurement.suppliers.read', 'materials.read'], ['procurement_visible']);
  exact('qc', ['production.read', 'production.quality.inspect', 'procurement.quality.inspect'], ['warehouse_visible', 'procurement_visible']);
  exact('qa', ['production.read', 'production.quality.release', 'procurement.quality.release'], ['warehouse_visible', 'procurement_visible']);
  exact('payables', ['finance.read', 'procurement.payment.record', 'barter.read', 'barter.post'], ['finance_visible', 'procurement_visible']);
  exact('receivables', ['orders.read', 'orders.payment.record', 'orders.payment.verify', 'finance.read', 'collections.read', 'barter.read', 'barter.post', 'orders.payment.reversal.request'], ['finance_visible']);
  exact('cost_accountant', ['production.cost.read', 'production.read', 'finance.read', 'warehouse.read', 'warehouse.ledger.read', 'materials.read'], ['finance_visible', 'warehouse_visible']);
  exact('research', ['production.read', 'production.bom.write', 'materials.read'], ['warehouse_visible']);
  exact('production_planner', ['production.read', 'production.plan.write', 'warehouse.read', 'materials.read'], ['warehouse_visible']);
  exact('production_operator', ['production.read', 'production.execute', 'warehouse.read', 'materials.read'], ['warehouse_visible']);
  exact('system_admin', ['system.read', 'system.metrics.read', 'system.backup.manage', 'settings.read', 'audit.read'], []);
  for (const [job, denied] of Object.entries({
    warehouse: ['orders.read', 'finance.read', 'procurement.write', 'procurement.approve', 'procurement.quality.inspect', 'procurement.payment.record'],
    buyer: ['procurement.receive', 'procurement.payment.record', 'procurement.payment.verify', 'production.execute'],
    qc: ['procurement.quality.release', 'production.quality.release', 'procurement.read', 'procurement.suppliers.read', 'finance.read'],
    qa: ['procurement.quality.inspect', 'production.quality.inspect', 'procurement.read', 'procurement.suppliers.read', 'finance.read'],
    payables: ['procurement.payment.verify', 'orders.payment.verify', 'orders.payment.record'],
    receivables: ['procurement.payment.record', 'procurement.payment.verify', 'orders.payment.reversal.review', 'barter.approve'],
    sales: ['barter.approve', 'barter.post', 'orders.payment.verify', 'orders.payment.reversal.review'],
    owner: ['barter.post', 'barter.write', 'orders.payment.reversal.request'],
    system_admin: ['orders.read', 'orders.create', 'procurement.write', 'warehouse.write', 'production.execute', 'authorization.roles.manage', 'team.write'],
  })) for (const permission of denied) assert(!permissions(job).includes(permission), `${job} forbidden grant: ${permission}`);
  for (const permission of ['collections.read', 'barter.read', 'barter.approve', 'orders.payment.reversal.review']) {
    assert(permissions('owner').includes(permission), `Independent owner responsibility missing: ${permission}`);
  }
  assert.notEqual(byJob.buyer[0].id, byJob.buyer[1].id);
  assert.notEqual(byJob.owner[0].id, byJob.buyer[0].id);
  assert.notEqual(byJob.owner[0].id, byJob.buyer[1].id);
  assert.notEqual(byJob.qc[0].id, byJob.qa[0].id);
  assert.notEqual(byJob.payables[0].id, byJob.owner[0].id);
});

test('headcounts are read from catalog.roles, not a hidden per-job count dictionary', { timeout: 5000 }, async () => {
  const changed = copy(catalog);
  changed.roles.find(row => row.job === 'sales').count = 2;
  changed.roles.find(row => row.job === 'warehouse').count = 4;
  const workforce = await harness().run({ catalog: changed });
  assert.equal(workforce.actors.length, 20);
  assert.equal(workforce.byJob.sales.length, 2); assert.equal(workforce.byJob.warehouse.length, 4);
});

test('unknown and inherited job names, duplicate jobs, invalid counts and incomplete cohorts fail before any request', { timeout: 5000 }, async () => {
  for (const [mutate, message] of [
    [value => { value.roles[0].job = 'not_a_job'; }, /Unknown workforce job/],
    [value => { value.roles[0].job = 'toString'; }, /Unknown workforce job/],
    [value => { value.roles[1].job = 'owner'; }, /Duplicate workforce job/],
    [value => { value.roles[0].count = '1'; }, /Invalid workforce count/],
    [value => { value.roles[0].count = 0; }, /Invalid workforce count/],
    [value => { value.roles[0].count = 2; }, /exactly 20/],
    [value => { value.roles.pop(); }, /14 known jobs/],
  ]) {
    const fake = harness(), changed = copy(catalog); mutate(changed);
    await assert.rejects(fake.run({ catalog: changed }), message);
    assert.equal(fake.calls.length, 0); assert.equal(fake.ensured.length, 0);
  }
});

test('a typo or missing real registry permission fails before policy or account creation', { timeout: 5000 }, async () => {
  const fake = harness({ registry: definitions => definitions.filter(row => row.code !== 'orders.shippingReady.read') });
  await assert.rejects(fake.run(), /warehouse: permission missing from real registry: orders.shippingReady.read/);
  assert.equal(fake.policies.size, 0); assert.equal(fake.ensured.length, 0);
});

test('registry drift between nodes and duplicate registry entries fail closed', { timeout: 5000 }, async () => {
  for (const [change, message] of [
    [(definitions, instance) => instance === 1 ? definitions.filter(row => row.code !== 'finance.read') : definitions, /Cross-node permission registry/],
    [definitions => [...definitions, definitions[0]], /duplicate registry codes/],
  ]) {
    const fake = harness({ registry: change });
    await assert.rejects(fake.run(), message); assert.equal(fake.policies.size, 0); assert.equal(fake.ensured.length, 0);
  }
});

test('HTTP-denied policy creation never falls back to a privileged built-in role', { timeout: 5000 }, async () => {
  const fake = harness({ intercept: (endpoint, _opts, { result }) => endpoint === '/roles' ? result({ message: 'Denied grant' }, 403) : null });
  await assert.rejects(fake.run(), /HTTP 403/);
  assert.equal(fake.calls.filter(call => call.endpoint === '/roles').length, 1);
  assert.equal(fake.ensured.length, 0); assert.equal(fake.calls.filter(call => call.endpoint === '/auth/login').length, 0);
});

test('server-added forbidden permission or all scope fails the exact policy readback', { timeout: 5000 }, async () => {
  for (const change of [
    created => { if (created.code.endsWith('_warehouse')) created.permissions.push('orders.read'); },
    created => { if (created.code.endsWith('_warehouse')) created.dataScopes.push('all'); },
  ]) {
    const fake = harness({ created: change });
    await assert.rejects(fake.run(), /warehouse created .*exact policy mismatch/);
    assert.equal(fake.ensured.length, 0);
  }
});

test('a secondary-node forbidden grant is observed through auth/me and rejected without retries', { timeout: 5000 }, async () => {
  const fake = harness({ profile: (profile, { endpoint, instance }) => {
    if (profile.role.endsWith('_warehouse') && endpoint === '/auth/me' && instance === 1) profile.permissions.push('orders.read');
  } });
  await assert.rejects(fake.run(), /warehouse\/1 node 1 permissions: exact policy mismatch/);
  const warehouse = fake.ensured.find(account => account.role.endsWith('_warehouse'));
  const login = fake.calls.find(call => call.endpoint === '/auth/login' && call.data.username === warehouse.username);
  assert(login);
  const user = fake.users.get(warehouse.username);
  assert.equal(fake.calls.filter(call => call.endpoint === '/auth/me' && call.auth === `private-actor-token-${user.id}` && call.instance === 1).length, 1);
});

test('missing live permission, wrong scope and role-string privilege fallback cannot pass', { timeout: 5000 }, async () => {
  for (const [mutate, message] of [
    [profile => { profile.permissions = profile.permissions.filter(code => code !== 'procurement.payment.verify'); }, /permissions: exact policy mismatch/],
    [profile => { profile.dataScopes.push('all'); }, /dataScopes: exact policy mismatch/],
    [profile => { profile.role = 'admin'; }, /role mismatch/],
    [profile => { delete profile.permissions; }, /permissions: expected string array/],
  ]) {
    const fake = harness({ profile: (profile, { endpoint, instance }) => {
      if (endpoint === '/auth/me' && instance === 1) mutate(profile);
    } });
    await assert.rejects(fake.run(), message);
    assert.equal(fake.ensured.length, 1);
  }
});

test('shared or bootstrap user IDs and shared login tokens are rejected', { timeout: 5000 }, async () => {
  for (const options of [
    { profile: profile => { profile.id = 1; } },
    { profile: profile => { profile.id = 101; } },
    { token: () => 'private-shared-token' },
    { token: () => 'private-bootstrap-token' },
  ]) {
    const fake = harness(options);
    await assert.rejects(fake.run(), /not independent|token reused/);
    assert(fake.ensured.length <= 2, 'Identity reuse must stop immediately, not build a nominal 20');
  }
});

test('secondary-node auth/me failure is not hidden by login data, synthetic grants or a retry loop', { timeout: 5000 }, async () => {
  const fake = harness({ intercept: (endpoint, opts, { result }) => endpoint === '/auth/me' && opts.auth !== 'private-bootstrap-token' && opts.instance === 1
    ? result({ message: 'Node unavailable' }, 503) : null });
  await assert.rejects(fake.run(), /HTTP 503/);
  assert.equal(fake.ensured.length, 1);
  assert.equal(fake.calls.filter(call => call.endpoint === '/auth/me' && call.instance === 1).length, 1);
});
