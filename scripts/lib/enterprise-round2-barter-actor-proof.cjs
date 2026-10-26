const assert = require('node:assert/strict');

// Deliberately barter-specific. This binds the existing same20 cohort; it does
// not provision roles, grant permissions or implement an authentication layer.
const duties = { sales: ['sales', 3, 'barter.write'], approver: ['owner', 1, 'barter.approve'],
  poster: ['receivables', 1, 'barter.post'], reverser: ['payables', 1, 'barter.post'] };
const mode = 'same-workforce-duties/v1';
const sorted = values => {
  assert(Array.isArray(values) && values.every(value => typeof value === 'string'), 'Missing barter permission/scope array');
  assert.equal(new Set(values).size, values.length, 'Duplicate barter permission/scope');
  return [...values].sort();
};
function publicProfile(profile) {
  assert(profile, 'Missing barter actor profile');
  return { id: Number(profile.id), username: profile.username, role: profile.role, segment: profile.segment,
    isActive: profile.isActive, mustChangePassword: profile.mustChangePassword,
    permissions: sorted(profile.permissions), dataScopes: sorted(profile.dataScopes) };
}
function actorSummary(actor) {
  return { id: actor.id, job: actor.job, index: actor.index, role: actor.role, profile: publicProfile(actor.profile) };
}
function assertDutySummary(summary, duty) {
  const [job, index, permission] = duties[duty];
  assert(summary && Number.isSafeInteger(summary.id) && summary.id > 0, `${duty}: missing barter actor`);
  assert.equal(summary.job, job); assert.equal(summary.index, index);
  assert(typeof summary.role === 'string' && !['admin', 'finance', 'sales', 'manager', 'warehouse'].includes(summary.role), `${duty}: expected actual custom role`);
  const profile = publicProfile(summary.profile);
  assert.equal(profile.id, summary.id); assert.equal(profile.role, summary.role);
  assert.equal(profile.isActive, true); assert.equal(profile.mustChangePassword, false);
  assert(profile.permissions.includes('barter.read') && profile.permissions.includes(permission), `${duty}: missing existing barter grant`);
  assert(!profile.dataScopes.includes('all'), `${duty}: broad all scope is forbidden`);
  if (duty === 'reverser') assert(!profile.permissions.includes('orders.payment.verify'), 'AP must not verify AR receipts');
}
function resolveBarterActors(ctx) {
  if (!ctx.workforce) {
    assert(!ctx.barterActors, 'Explicit barter duties require the same workforce');
    return { sales: ctx.actors.sales, approver: ctx.actors.admin, poster: ctx.actors.finance1, reverser: ctx.actors.finance2 };
  }
  assert(Array.isArray(ctx.workforce.actors), 'Same-workforce barter requires a real cohort array');
  assert.equal(ctx.workforce.actors.length, 20, 'Same-workforce barter requires exactly twenty people');
  // Array.from visits holes too, so a sparse twenty-slot array cannot masquerade
  // as twenty real identities. Only scalar IDs enter assertion diagnostics.
  const cohortIds = Array.from(ctx.workforce.actors, actor => actor?.id);
  assert(cohortIds.every(id => Number.isSafeInteger(id) && id > 0), 'Every barter cohort ID must be a positive safe integer');
  assert.equal(new Set(cohortIds).size, 20, 'Same-workforce barter requires twenty unique user IDs');
  assert(ctx.barterActors, 'Same-workforce barter requires explicit duties');
  for (const [duty, [job, index]] of Object.entries(duties)) {
    const actor = ctx.barterActors[duty], expected = ctx.workforce.byJob[job]?.[index - 1];
    // Compare as a boolean: assertion errors must never serialize credentials.
    assert(Boolean(actor && actor === expected), `${duty}: not the actual same-cohort actor reference`);
    assert(ctx.workforce.actors.some(person => person === actor), `${duty}: actor is outside the run-owned cohort`);
    assert(actor.account && actor.account.role === actor.role, `${duty}: account role mismatch`);
    assertDutySummary(actorSummary(actor), duty);
  }
  assert.equal(new Set(Object.values(ctx.barterActors).map(actor => actor.id)).size, 4, 'Four independent barter duties required');
  return ctx.barterActors;
}
function assertBarterProfile(actual, actor, instance) {
  const expected = actor.profilesByInstance?.[instance];
  assert(expected, 'Missing authoritative barter node profile');
  assert.equal(Number(actual?.id), actor.id, 'Barter current actor changed');
  assert.equal(actual?.role, actor.role, 'Barter current role changed');
  assert.equal(actual?.username, actor.account.username, 'Barter current username changed');
  assert.equal(actual?.segment, actor.account.segment || 'mixed', 'Barter current segment changed');
  assert.equal(actual?.isActive, true, 'Barter current account inactive');
  assert.equal(actual?.mustChangePassword, false, 'Barter current account requires reset');
  assert.deepEqual(publicProfile(actual), publicProfile(expected), 'Barter current permissions/scopes changed');
  assert.deepEqual(publicProfile(actual), publicProfile(actor.profile), 'Barter node profile drift');
  return publicProfile(actual);
}
async function attestBarterActors(ctx, signal) {
  const people = resolveBarterActors(ctx);
  if (!ctx.workforce) return [];
  const records = [];
  for (const [duty, actor] of Object.entries(people)) for (const instance of [0, 1]) {
    signal.throwIfAborted();
    const result = await ctx.request('/auth/me', { actor, instance, signal });
    assert.equal(result.status, 200, 'Barter current profile read failed');
    const profile = assertBarterProfile(ctx.dataOf(result), actor, instance);
    records.push({ duty, actorId: actor.id, role: actor.role, instance, status: result.status, profile });
  }
  return records;
}
async function requestHasBearer(request, token) {
  const header = await request.headerValue('authorization');
  return typeof token === 'string' && token.length > 0 && header === `Bearer ${token}`;
}
async function openBarterPage({ page, ctx, actor, duty, instance }) {
  let token = actor.token;
  if (ctx.workforce) {
    const { loginUiAuditUser } = require('./ui-audit-user.cjs');
    const login = await loginUiAuditUser(page, `${ctx.urls[instance]}/`, {
      account: actor.account, reuseExistingAccount: true, storage: { 'ailao.language': 'zh', language: 'zh-CN' },
    });
    assertBarterProfile(login.user, actor, instance); actor.token = login.token; token = login.token;
  } else {
    await page.addInitScript(({ savedToken, user }) => {
      for (const key of ['token', 'auth_token', 'erp_auth_token']) localStorage.setItem(key, savedToken);
      for (const key of ['user', 'currentUser', 'erp_current_user']) localStorage.setItem(key, JSON.stringify(user));
      localStorage.setItem('ailao.language', 'zh'); localStorage.setItem('language', 'zh-CN');
    }, { savedToken: token, user: { ...actor.loginUser, id: String(actor.id), name: actor.job, role: actor.role, segment: 'mixed' } });
  }
  const auth = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === new URL(ctx.urls[instance]).origin && url.pathname === '/api/auth/me' && response.request().method() === 'GET';
  });
  void auth.catch(() => {});
  await page.goto(`${ctx.urls[instance]}/#barter`);
  const response = await auth;
  assert.equal(response.status(), 200, 'Barter browser current profile failed');
  const authorizationVerified = await requestHasBearer(response.request(), token);
  assert.equal(authorizationVerified, true, 'Barter browser used a different bearer');
  const actual = (await response.json()).data;
  assert.equal(Number(actual.id), actor.id); assert.equal(actual.role, actor.role);
  const profile = ctx.workforce ? assertBarterProfile(actual, actor, instance) : undefined;
  await page.locator('#loading').waitFor({ state: 'hidden' });
  return { token, identity: { actorId: actor.id, role: actor.role, duty, instance, authorizationVerified, ...(profile ? { profile } : {}) } };
}
function assertBarterDutyRecord(record, actors, duty) {
  const expected = actors[duty];
  assert.equal(record.duty, duty, 'Wrong barter duty');
  assert.equal(record.actorId, expected.id, 'Wrong barter actor'); assert.equal(record.role, expected.role, 'Wrong barter role');
  assert([0, 1].includes(record.instance), 'Missing barter instance');
  assert.equal(record.authorizationVerified, true, 'Missing real browser Authorization check');
  assert.deepEqual(publicProfile(record.profile), publicProfile(expected.profile), 'Browser barter permissions/scopes drift');
}
function assertBarterDutyEvidence(evidence) {
  assert.equal(evidence.actorMode, mode, 'Unknown barter actor mode');
  for (const duty of Object.keys(duties)) assertDutySummary(evidence.barterActors?.[duty], duty);
  assert.equal(new Set(Object.values(evidence.barterActors).map(actor => actor.id)).size, 4);
  assert.equal(evidence.actorProfiles?.length, 8, 'Both-node current profiles required for all barter duties');
  for (const duty of Object.keys(duties)) for (const instance of [0, 1]) {
    const records = evidence.actorProfiles.filter(row => row.duty === duty && row.instance === instance);
    assert.equal(records.length, 1, 'Missing/duplicate authoritative barter profile');
    const record = records[0], expected = evidence.barterActors[duty];
    assert.equal(record.status, 200); assert.equal(record.actorId, expected.id); assert.equal(record.role, expected.role);
    assert.deepEqual(publicProfile(record.profile), publicProfile(expected.profile));
  }
}

module.exports = { resolveBarterActors, attestBarterActors, assertBarterProfile, actorSummary, requestHasBearer,
  openBarterPage, assertBarterDutyRecord, assertBarterDutyEvidence };
