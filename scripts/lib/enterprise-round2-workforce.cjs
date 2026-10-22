const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ensureUiAuditUser } = require('./ui-audit-user.cjs');

// Ordinary sandbox fixtures, not an RBAC implementation. Every grant is an
// existing permissionRegistry code; neither job nor dynamic role names grant
// permissions. The bootstrap administrator is deliberately outside the cohort.
const policies = {
  owner: {
    permissions: ['orders.read', 'orders.payment.verify', 'finance.read', 'procurement.read', 'procurement.approve', 'procurement.payment.verify', 'collections.read', 'barter.read', 'barter.approve', 'orders.payment.reversal.review'],
    dataScopes: ['finance_visible', 'procurement_visible'],
  },
  sales_lead: {
    permissions: ['orders.read', 'orders.update', 'orders.status.manage', 'orders.complete', 'customers.read', 'materials.read', 'shipping.read', 'shipping.receipts.read'],
    dataScopes: ['team_customers'],
  },
  sales: {
    permissions: ['orders.read', 'orders.create', 'orders.update', 'orders.payment.record', 'customers.read', 'customers.create', 'customers.update', 'materials.read', 'shipping.read', 'shipping.receipts.read', 'barter.read', 'barter.write'],
    dataScopes: ['own_customers'],
  },
  buyer: {
    permissions: ['procurement.read', 'procurement.write', 'procurement.approve', 'procurement.suppliers.read', 'materials.read'],
    dataScopes: ['procurement_visible'],
  },
  warehouse: {
    permissions: ['orders.shippingReady.read', 'shipping.read', 'shipping.write', 'shipping.receipts.read', 'warehouse.read', 'warehouse.write', 'warehouse.ledger.read', 'procurement.read', 'procurement.receive', 'procurement.suppliers.read', 'materials.read'],
    dataScopes: ['warehouse_visible', 'procurement_visible'],
  },
  production_planner: {
    permissions: ['production.read', 'production.plan.write', 'warehouse.read', 'materials.read'],
    dataScopes: ['warehouse_visible'],
  },
  production_operator: {
    permissions: ['production.read', 'production.execute', 'warehouse.read', 'materials.read'],
    dataScopes: ['warehouse_visible'],
  },
  research: {
    permissions: ['production.read', 'production.bom.write', 'materials.read'],
    dataScopes: ['warehouse_visible'],
  },
  qc: {
    permissions: ['production.read', 'production.quality.inspect', 'procurement.quality.inspect'],
    dataScopes: ['warehouse_visible', 'procurement_visible'],
  },
  qa: {
    permissions: ['production.read', 'production.quality.release', 'procurement.quality.release'],
    dataScopes: ['warehouse_visible', 'procurement_visible'],
  },
  receivables: {
    permissions: ['orders.read', 'orders.payment.record', 'orders.payment.verify', 'finance.read', 'collections.read', 'barter.read', 'barter.post', 'orders.payment.reversal.request'],
    dataScopes: ['finance_visible'],
  },
  payables: {
    permissions: ['finance.read', 'procurement.payment.record', 'barter.read', 'barter.post'],
    dataScopes: ['finance_visible', 'procurement_visible'],
  },
  cost_accountant: {
    permissions: ['production.cost.read', 'production.read', 'finance.read', 'warehouse.read', 'warehouse.ledger.read', 'materials.read'],
    dataScopes: ['finance_visible', 'warehouse_visible'],
  },
  system_admin: {
    permissions: ['system.read', 'system.metrics.read', 'system.backup.manage', 'settings.read', 'audit.read'],
    dataScopes: [],
  },
};

function exactStrings(actual, expected, label) {
  assert(Array.isArray(actual) && actual.every(value => typeof value === 'string'), `${label}: expected string array`);
  assert.equal(new Set(actual).size, actual.length, `${label}: duplicate grants`);
  assert.deepEqual([...actual].sort(), [...expected].sort(), `${label}: exact policy mismatch`);
}

function assertProfile(profile, account, policy, label) {
  assert(profile && Number.isSafeInteger(Number(profile.id)) && Number(profile.id) > 0, `${label}: missing real user id`);
  assert.equal(profile.username, account.username, `${label}: username mismatch`);
  assert.equal(profile.role, account.role, `${label}: role mismatch`);
  assert.equal(profile.segment, account.segment, `${label}: segment mismatch`);
  assert.equal(profile.mustChangePassword, false, `${label}: account is not ready`);
  assert.notEqual(profile.isActive, false, `${label}: inactive account`);
  exactStrings(profile.permissions, policy.permissions, `${label} permissions`);
  exactStrings(profile.dataScopes, policy.dataScopes, `${label} dataScopes`);
}

/**
 * Create the configured 14-job / 20-person cohort and read authoritative policy
 * on both nodes. request(endpoint, { auth, instance, method, data }) must use
 * auth:null for an anonymous login, never a default administrative credential.
 *
 * Returned token/account.password are private execution state, not report data.
 * Creation/profile checks prove configuration only, NOT workforce participation
 * or the existing workforce-rbac acceptance ID. Business probes own that proof.
 */
async function createWorkforce({ request, dataOf, bootstrapToken, runId, password, catalog }) {
  assert.equal(typeof request, 'function', 'request is required');
  assert.equal(typeof dataOf, 'function', 'dataOf is required');
  assert(typeof bootstrapToken === 'string' && bootstrapToken.length > 0, 'bootstrapToken is required');
  assert(typeof runId === 'string' && runId.trim(), 'runId is required');
  assert(typeof password === 'string' && password.length > 0, 'password is required');
  assert(Array.isArray(catalog?.roles), 'catalog.roles is required');
  assert.equal(catalog.roles.length, Object.keys(policies).length, 'catalog must contain the 14 known jobs');
  const jobs = new Set();
  for (const row of catalog.roles) {
    assert(row && Object.hasOwn(policies, row.job), `Unknown workforce job: ${row?.job}`);
    assert(!jobs.has(row.job), `Duplicate workforce job: ${row.job}`);
    assert(Number.isSafeInteger(row.count) && row.count > 0, `Invalid workforce count: ${row.job}`);
    jobs.add(row.job);
  }
  assert.equal(catalog.roles.reduce((sum, row) => sum + row.count, 0), 20, 'catalog must configure exactly 20 people');

  const bootstrap = dataOf(await request('/auth/me', { auth: bootstrapToken, instance: 0, method: 'GET' }));
  assert.equal(bootstrap.role, 'admin', 'Only the bootstrap identity may be the built-in administrator');
  assert(Number.isSafeInteger(Number(bootstrap.id)) && Number(bootstrap.id) > 0, 'Bootstrap has no real user id');
  const registries = [];
  for (const instance of [0, 1]) {
    const definitions = dataOf(await request('/roles/permissions', { auth: bootstrapToken, instance, method: 'GET' }));
    assert(Array.isArray(definitions) && definitions.every(row => typeof row?.code === 'string'), `Node ${instance}: invalid permission registry`);
    const codes = definitions.map(row => row.code);
    assert.equal(new Set(codes).size, codes.length, `Node ${instance}: duplicate registry codes`);
    registries.push(codes);
  }
  exactStrings(registries[1], registries[0], 'Cross-node permission registry');
  const registry = new Set(registries[0]);
  for (const [job, policy] of Object.entries(policies)) {
    for (const permission of policy.permissions) assert(registry.has(permission), `${job}: permission missing from real registry: ${permission}`);
    assert(!policy.dataScopes.includes('all'), `${job}: all scope is forbidden`);
  }

  const prefix = `r2wf_${crypto.createHash('sha256').update(runId).digest('hex').slice(0, 12)}`;
  const rolesByJob = {};
  for (const { job } of catalog.roles) {
    const role = `${prefix}_${job}`, policy = policies[job];
    // The real API is mounted at /roles, not an invented /authorization/roles.
    const created = dataOf(await request('/roles', { auth: bootstrapToken, instance: 0, method: 'POST',
      data: { code: role, name: `Round2 workforce ${job}`, description: 'Configuration fixture only; workforce participation is not yet proven.',
        isActive: true, permissions: [...policy.permissions], dataScopes: [...policy.dataScopes] } }));
    assert.equal(created.code, role, `${job}: role creation identity mismatch`);
    assert.equal(created.isSystem, false, `${job}: fixture must not use a built-in role`);
    assert.equal(created.isActive, true, `${job}: fixture role must be active`);
    exactStrings(created.permissions, policy.permissions, `${job} created permissions`);
    exactStrings(created.dataScopes, policy.dataScopes, `${job} created dataScopes`);
    rolesByJob[job] = role;
  }

  const actors = [], byJob = {}, userIds = new Set([Number(bootstrap.id)]), usernames = new Set(), tokens = new Set([bootstrapToken]);
  for (const { job, count } of catalog.roles) {
    byJob[job] = [];
    for (let index = 1; index <= count; index += 1) {
      const role = rolesByJob[job], policy = policies[job];
      const account = { username: `${prefix}_${job}_${index}`, password, role, segment: 'mixed' };
      await ensureUiAuditUser(account);
      const login = dataOf(await request('/auth/login', { auth: null, instance: 0, method: 'POST', data: { username: account.username, password } }));
      assert(typeof login.token === 'string' && login.token.length > 0, `${job}/${index}: login has no token`);
      assert(!tokens.has(login.token), `${job}/${index}: token reused by another identity`);
      tokens.add(login.token);
      assertProfile(login.user, account, policy, `${job}/${index} login`);
      const profilesByInstance = {};
      // These services read role permissions/scopes from the DB per request.
      // No cache invalidation endpoint or unbounded retry is needed or invented.
      for (const instance of [0, 1]) {
        const profile = dataOf(await request('/auth/me', { auth: login.token, instance, method: 'GET' }));
        assertProfile(profile, account, policy, `${job}/${index} node ${instance}`);
        assert.equal(Number(profile.id), Number(login.user.id), `${job}/${index} node ${instance}: identity changed`);
        profilesByInstance[instance] = { ...profile };
      }
      const profile = profilesByInstance[0], id = Number(profile.id);
      assert(!userIds.has(id), `${job}/${index}: user identity is not independent`);
      assert(!usernames.has(profile.username), `${job}/${index}: username is not independent`);
      userIds.add(id); usernames.add(profile.username);
      const actor = { job, index, id, role, account, token: login.token, profile, profilesByInstance };
      actors.push(actor); byJob[job].push(actor);
    }
  }
  assert.equal(actors.length, 20, 'Workforce cohort is incomplete');
  return { version: 'enterprise-round2-workforce/v1', configurationOnly: true, participationNotYetProven: true, actors, byJob };
}

// The final evidence reader reuses these exact fixture policies. It must not
// maintain a second permission matrix or accept the login DTO as /auth/me.
function verifyWorkforceProfile(profile, actor) {
  assert(Object.hasOwn(policies, actor.job), 'Unknown workforce job');
  assert.equal(profile?.id, actor.id, 'Workforce profile borrowed another identity');
  assert.equal(profile.isActive, true, 'Workforce current account must be active');
  assertProfile(profile, { username: `${actor.role}_${actor.index}`, role: actor.role, segment: 'mixed' },
    policies[actor.job], `${actor.job}/${actor.index}`);
}

module.exports = { createWorkforce, verifyWorkforceProfile };
