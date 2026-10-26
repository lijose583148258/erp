const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserFixture } = require('./fixtures/barter-browser-proof-fixture.cjs');
const { assertBarterBrowserChain } = require('./lib/enterprise-round2-barter-partial.cjs');
const { resolveBarterActors, attestBarterActors, assertBarterProfile, actorSummary, requestHasBearer } = require('./lib/enterprise-round2-barter-actor-proof.cjs');

function context() {
  const definitions = [['sales', 3, ['barter.read', 'barter.write'], ['own_customers']],
    ['owner', 1, ['barter.read', 'barter.approve'], ['finance_visible']],
    ['receivables', 1, ['barter.read', 'barter.post', 'orders.payment.verify'], ['finance_visible']],
    ['payables', 1, ['barter.read', 'barter.post'], ['finance_visible', 'procurement_visible']]];
  const people = definitions.map(([job, index, permissions, dataScopes], i) => {
    const role = `r2wf_test_${job}`, id = i + 12;
    const profile = { id, username: `person-${id}`, role, segment: 'mixed', isActive: true, mustChangePassword: false, permissions, dataScopes };
    return { id, job, index, role, account: { username: profile.username, password: 'PRIVATE-PASSWORD', role, segment: 'mixed' },
      token: `PRIVATE-TOKEN-${id}`, profile, profilesByInstance: { 0: structuredClone(profile), 1: structuredClone(profile) } };
  });
  const [sales, approver, poster, reverser] = people;
  // The other sixteen are cohort-size/identity fixtures only. They do not
  // impersonate any of the four barter duties or receive business grants.
  const cohort = [...people, ...Array.from({ length: 16 }, (_, index) => ({ id: 100 + index, job: 'unrelated_fixture', index: index + 1 }))];
  return { actors: {}, workforce: { actors: cohort, byJob: { sales: [null, null, sales], owner: [approver], receivables: [poster], payables: [reverser] } },
    barterActors: { sales, approver, poster, reverser }, dataOf: response => response.json.data,
    request: async (endpoint, { actor, instance }) => ({ status: 200, json: { data: actor.profilesByInstance[instance] } }) };
}

async function workforceEvidence() {
  const ctx = context(), evidence = browserFixture();
  evidence.actorMode = 'same-workforce-duties/v1';
  evidence.barterActors = Object.fromEntries(Object.entries(ctx.barterActors).map(([duty, actor]) => [duty, actorSummary(actor)]));
  evidence.actorProfiles = await attestBarterActors(ctx, new AbortController().signal);
  const attach = (record, duty) => Object.assign(record, { duty, actorId: ctx.barterActors[duty].id,
    role: ctx.barterActors[duty].role, profile: actorSummary(ctx.barterActors[duty]).profile, authorizationVerified: true });
  for (const record of evidence.roleOperations) attach(record, record.action.startsWith('create') ? 'sales' : record.action === 'approve' ? 'approver' : record.action === 'post' ? 'poster' : 'reverser');
  for (const readback of evidence.browser) attach(readback, 'poster');
  for (const denial of evidence.denials) attach(denial, 'sales');
  const { sales, approver, poster, reverser } = ctx.barterActors;
  const saved = evidence.stages.at(-1).persisted;
  saved.createdBy = sales.id;
  for (const batch of saved.settlements) {
    batch.createdBy = sales.id; batch.approvedBy = approver.id; batch.postedBy = poster.id;
    for (const reversal of batch.reversalLogs) reversal.reversedBy = reverser.id;
  }
  return evidence;
}

test('same20 barter duties retain actual sales3, owner, AR and AP object references', () => {
  const ctx = context(), people = resolveBarterActors(ctx);
  assert.equal(ctx.workforce.actors.length, 20);
  assert(ctx.workforce.actors.slice(4).every(actor => actor.job === 'unrelated_fixture'));
  for (const duty of Object.keys(ctx.barterActors)) assert(people[duty] === ctx.barterActors[duty]);
});
for (const [name, mutate] of [
  ['missing cohort array', ctx => { delete ctx.workforce.actors; }],
  ['four-person cohort masquerading as same20', ctx => { ctx.workforce.actors = ctx.workforce.actors.slice(0, 4); }],
  ['nineteen-person cohort', ctx => { ctx.workforce.actors.pop(); }],
  ['twenty-one-person cohort', ctx => { ctx.workforce.actors.push({ id: 999, job: 'unrelated_fixture', index: 17 }); }],
  ['duplicate ID outside the four barter duties', ctx => { ctx.workforce.actors[5].id = ctx.workforce.actors[4].id; }],
  ['placeholder reusing a barter duty ID', ctx => { ctx.workforce.actors[4].id = ctx.barterActors.sales.id; }],
  ['sparse cohort array', ctx => { delete ctx.workforce.actors[4]; }],
  ['zero cohort ID', ctx => { ctx.workforce.actors[4].id = 0; }],
  ['negative cohort ID', ctx => { ctx.workforce.actors[4].id = -1; }],
  ['fractional cohort ID', ctx => { ctx.workforce.actors[4].id = 1.5; }],
  ['string cohort ID', ctx => { ctx.workforce.actors[4].id = '100'; }],
  ['unsafe cohort ID', ctx => { ctx.workforce.actors[4].id = Number.MAX_SAFE_INTEGER + 1; }],
  ['missing explicit binding', ctx => { delete ctx.barterActors; }],
  ['foreign same-looking actor object', ctx => { ctx.barterActors.poster = { ...ctx.barterActors.poster }; }],
  ['wrong sales cohort member', ctx => { ctx.workforce.byJob.sales[2] = null; }],
  ['role spoofing', ctx => { ctx.barterActors.reverser.role = 'finance'; }],
  ['AP also allowed to verify AR receipts', ctx => { ctx.barterActors.reverser.profile.permissions.push('orders.payment.verify'); }],
]) test(`same20 barter actors reject ${name} without disclosing credentials`, () => {
  const ctx = context(); mutate(ctx);
  let error; try { resolveBarterActors(ctx); } catch (caught) { error = caught; }
  assert(error); assert.doesNotMatch(String(error.stack), /PRIVATE-(?:PASSWORD|TOKEN)/);
});

test('fresh authoritative profiles are read for all four duties on both nodes', async () => {
  const ctx = context(), calls = [];
  const request = ctx.request;
  ctx.request = async (endpoint, options) => { calls.push({ endpoint, actorId: options.actor.id, instance: options.instance }); return request(endpoint, options); };
  const proof = await attestBarterActors(ctx, new AbortController().signal);
  assert.equal(calls.length, 8); assert(calls.every(row => row.endpoint === '/auth/me'));
  assert.equal(proof.length, 8); assert.doesNotMatch(JSON.stringify(proof), /PRIVATE-(?:PASSWORD|TOKEN)/);
});
test('negative-cash orchestration stops stale same20 node permissions before any business fixture', async () => {
  const { barterNegativeCashProbe } = require('./lib/enterprise-round2-barter-negative.cjs');
  const ctx = context(), original = ctx.request;
  let fixtures = 0;
  ctx.barterFixture = async () => { fixtures++; assert.fail('Untrusted actor must not reach business fixtures'); };
  ctx.request = async (endpoint, options) => {
    const response = await original(endpoint, options);
    if (options.actor === ctx.barterActors.reverser && options.instance === 1) {
      response.json.data = structuredClone(response.json.data); response.json.data.dataScopes.push('all');
    }
    return response;
  };
  await assert.rejects(barterNegativeCashProbe(ctx, new AbortController().signal), /permissions\/scopes changed/);
  assert.equal(fixtures, 0);
});
for (const [name, mutate] of [
  ['wrong actor', p => { p.id++; }], ['role', p => { p.role = 'finance'; }],
  ['permission escalation', p => { p.permissions.push('orders.payment.verify'); }],
  ['data-scope escalation', p => { p.dataScopes.push('all'); }],
  ['inactive account', p => { p.isActive = false; }],
  ['password-reset account', p => { p.mustChangePassword = true; }],
]) test(`barter current profile rejects ${name}`, () => {
  const actor = context().barterActors.reverser, actual = structuredClone(actor.profile); mutate(actual);
  assert.throws(() => assertBarterProfile(actual, actor, 0));
});

test('Authorization evidence is a boolean, not a captured bearer secret', async () => {
  assert.equal(await requestHasBearer({ headerValue: async () => 'Bearer PRIVATE' }, 'PRIVATE'), true);
  assert.equal(await requestHasBearer({ headerValue: async () => 'Bearer OTHER' }, 'PRIVATE'), false);
  assert.equal(await requestHasBearer({ headerValue: async () => null }, 'PRIVATE'), false);
});

function browserSessionDouble(ctx, actor, instance, { mismatch = false } = {}) {
  const fs = require('node:fs'), vm = require('node:vm');
  const sourcePath = require.resolve('./lib/enterprise-round2-barter-actor-proof.cjs');
  const loaded = { exports: {} }, freshToken = `private-fresh-session-${actor.id}`, loginUser = structuredClone(actor.profile);
  if (mismatch) loginUser.id++;
  let logins = 0, navigations = 0;
  ctx.urls = ['http://127.0.0.1:3001', 'http://127.0.0.1:3002'];
  // Run the actual helper with only the login/network boundary replaced. Never
  // compare whole actor/account objects in assertion diagnostics.
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
    module: loaded, URL,
    require(name) {
      if (name === './ui-audit-user.cjs') return { loginUiAuditUser: async (_page, appUrl, options) => {
        logins++;
        assert.equal(options.account === actor.account, true);
        assert.equal(options.reuseExistingAccount, true);
        assert.equal(appUrl === `${ctx.urls[instance]}/`, true);
        return { token: freshToken, user: loginUser };
      } };
      return require(name);
    },
  }, { filename: sourcePath });
  const nativeRequest = { method: () => 'GET', headerValue: async () => `Bearer ${freshToken}` };
  const response = { url: () => `${ctx.urls[instance]}/api/auth/me`, request: () => nativeRequest,
    status: () => 200, json: async () => ({ data: structuredClone(actor.profile) }) };
  const page = {
    waitForResponse: async predicate => { assert.equal(predicate(response), true); return response; },
    goto: async url => { navigations++; assert.equal(url === `${ctx.urls[instance]}/#barter`, true); },
    locator: () => ({ waitFor: async () => {} }),
  };
  return { helper: loaded.exports, page, freshToken, counts: () => ({ logins, navigations }) };
}

for (const [duty, instance] of [['sales', 0], ['approver', 0], ['poster', 1], ['reverser', 1]]) {
  test(`actual barter browser login synchronizes shared ${duty} token before both-node API attestation`, async () => {
    const ctx = context(), actor = ctx.barterActors[duty], f = browserSessionDouble(ctx, actor, instance);
    const expectedTokens = new Map(Object.values(ctx.barterActors).map(person => [person, person.token]));
    expectedTokens.set(actor, f.freshToken);
    const reads = [], originalRequest = ctx.request;
    ctx.request = async (endpoint, options) => {
      assert.equal(endpoint === '/auth/me', true);
      assert.equal(ctx.workforce.actors.includes(options.actor), true);
      assert.equal(options.actor.token === expectedTokens.get(options.actor), true, 'API must use the current shared actor session');
      reads.push({ sameActor: options.actor === actor, instance: options.instance });
      return originalRequest(endpoint, options);
    };
    const session = await f.helper.openBarterPage({ page: f.page, ctx, actor, duty, instance });
    assert.equal(actor === ctx.barterActors[duty], true);
    assert.equal(actor.token === session.token, true, 'Native login must synchronize the same actor used by subsequent APIs');
    assert.equal(actor.token === f.freshToken, true);
    assert.equal(session.identity.authorizationVerified, true);
    const profiles = await f.helper.attestBarterActors(ctx, new AbortController().signal);
    assert.equal(profiles.length, 8); assert.equal(reads.length, 8);
    assert.deepEqual(reads.filter(row => row.sameActor).map(row => row.instance), [0, 1]);
    assert.deepEqual(f.counts(), { logins: 1, navigations: 1 });
    assert.doesNotMatch(JSON.stringify({ identity: session.identity, profiles }), /private-(?:fresh-session|session)|PRIVATE-(?:TOKEN|PASSWORD)/);
  });
  test(`mismatched ${duty} login profile cannot replace the shared actor token`, async () => {
    const ctx = context(), actor = ctx.barterActors[duty], originalToken = actor.token;
    const f = browserSessionDouble(ctx, actor, instance, { mismatch: true });
    await assert.rejects(f.helper.openBarterPage({ page: f.page, ctx, actor, duty, instance }), error => {
      assert.doesNotMatch(String(error), /private-fresh-session|PRIVATE-(?:TOKEN|PASSWORD)/);
      return /current actor changed/.test(String(error));
    });
    assert.equal(actor.token === originalToken, true, 'Rejected profile must preserve the prior execution identity');
    assert.deepEqual(f.counts(), { logins: 1, navigations: 0 });
  });
}

test('dynamic-role browser proof binds owner approval, AR posting/readback and AP reversal', async () => {
  assert.deepEqual(assertBarterBrowserChain(await workforceEvidence()).actors, [12, 13, 14, 15]);
});
for (const [name, mutate] of [
  ['AP used for AR readback', e => { e.browser[0].actorId = e.barterActors.reverser.id; }],
  ['AR used for AP reversal', e => { e.roleOperations[7].actorId = e.barterActors.poster.id; }],
  ['AP falsely credited as original poster', e => { e.stages.at(-1).persisted.settlements[1].postedBy = e.barterActors.reverser.id; }],
  ['AR falsely credited as reverser', e => { e.stages.at(-1).persisted.settlements[1].reversalLogs[0].reversedBy = e.barterActors.poster.id; }],
  ['dynamic role replaced by finance label', e => { e.roleOperations[2].role = 'finance'; }],
  ['missing browser Authorization check', e => { delete e.browser[0].authorizationVerified; }],
  ['wrong operation bearer', e => { e.roleOperations[3].authorizationVerified = false; }],
  ['stale browser scope', e => { e.browser[0].profile = { ...e.browser[0].profile, dataScopes: ['all'] }; }],
  ['missing node profile', e => { e.actorProfiles.pop(); }],
  ['unapproved duty mode', e => { e.actorMode = 'anything'; }],
]) test(`dynamic barter browser proof rejects ${name}`, async () => {
  const evidence = await workforceEvidence(); mutate(evidence);
  assert.throws(() => assertBarterBrowserChain(evidence));
});

// Execute the negative-cash orchestrator against an in-memory contract double.
// This proves dispatch and preservation of its original assertions, not live DB
// correctness or native browser acceptance.
function negativeContext({ reverseWins = false, legacy = false } = {}) {
  const ctx = context(), rows = new Map(), trace = [], references = new Map();
  if (legacy) {
    ctx.actors = { sales: { id: 2, role: 'sales' }, admin: { id: 1, role: 'admin' },
      finance1: { id: 3, role: 'finance' }, finance2: { id: 4, role: 'finance' } };
    delete ctx.workforce; delete ctx.barterActors;
  }
  const people = resolveBarterActors(ctx);
  const stock = (quantity, value) => ({ balances: [{ quantity }], batch: { stockQuantity: quantity }, costs: [{ costAmountDelta: value }],
    apiBalances: [[{ quantity }], [{ quantity }]] });
  const setStock = (row, posted) => {
    row.business.our = stock(posted ? 90 : 100, posted ? 900 : 1000);
    row.business.incoming = stock(posted ? 20 : 0, posted ? 250 : 0);
    row.business.order.paidAmount = posted ? 200 : 0;
  };
  const reply = (status, data) => ({ status, json: { data: structuredClone(data) } });
  ctx.runId = 'finance-barter-unit'; ctx.reportPath = 'F:/unused/report.json';
  ctx.barterFixture = async (label, kind, signal, options = {}) => {
    assert.equal(kind, 'negative'); signal.throwIfAborted();
    const id = rows.size + 1;
    const f = { label, settlement: { id }, order: { id }, agreement: options.agreement ? { id, agreementNo: `agreement-${id}` } : null };
    const business = { settlement: { id, status: 'approved', createdBy: people.sales.id, approvedBy: people.approver.id },
      order: { currency: 'CNY', paidAmount: 0, paymentRecords: [] } };
    const row = { f, business, currency: options.currency || 'CNY', liability: null, audits: [] };
    setStock(row, false); rows.set(id, row); return f;
  };
  ctx.readBarter = async f => structuredClone(rows.get(f.settlement.id).business);
  ctx.prisma = { barterCashObligation: { findUnique: async ({ where }) => structuredClone(rows.get(where.settlementId).liability) },
    auditLog: { findMany: async ({ where }) => structuredClone(rows.get(where.resourceId).audits),
      count: async ({ where }) => rows.get(where.resourceId).audits.length } };
  const originalRequest = ctx.request;
  ctx.request = async (endpoint, options = {}) => {
    const { actor, method = 'GET', instance = 0, data } = options;
    trace.push({ endpoint, actor, method, instance });
    if (endpoint === '/auth/me') return originalRequest(endpoint, options);
    if (endpoint.startsWith('/barter/agreements/')) return reply(200, { hasPendingRefund: false });
    const [, idText, action] = endpoint.match(/^\/barter\/settlements\/(\d+)(?:\/(\w+))?$/) || [];
    assert(idText, `Unexpected non-barter request: ${endpoint}`);
    const row = rows.get(Number(idText)), settlement = row.business.settlement;
    if (method === 'GET') return reply(200, { ...settlement, cashObligation: row.liability });
    const authorized = [people.poster.id, people.reverser.id].includes(actor.id);
    if (!authorized) return reply(403, null);
    if (action === 'post') {
      if (row.currency !== 'CNY' || settlement.status !== 'approved') return reply(409, null);
      settlement.status = 'posted'; settlement.postedBy = actor.id; setStock(row, true);
      row.liability = { id: Number(idText), amount: 50, currency: 'CNY', status: 'open', ownerId: actor.id };
      return reply(200, settlement);
    }
    if (action === 'refund') {
      if (reverseWins && row.f.label === 'negative-reverse-race') await new Promise(resolve => setTimeout(resolve, 1));
      if (!data.paymentReference) return reply(400, null);
      if (data.amount !== 50 || data.currency !== 'CNY' || settlement.status !== 'posted' || row.liability.status !== 'open'
        || references.has(data.paymentReference)) return reply(409, null);
      references.set(data.paymentReference, Number(idText));
      Object.assign(row.liability, { status: 'settled', resolvedBy: actor.id });
      row.audits.push({ userId: actor.id }); return reply(200, row.liability);
    }
    if (action === 'reverse') {
      if (settlement.status !== 'posted' || row.liability.status !== 'open') return reply(409, null);
      settlement.status = 'reversed'; row.liability.status = 'void'; setStock(row, false); return reply(200, settlement);
    }
    assert.fail(`Unexpected barter action: ${action}`);
  };
  return { ctx, trace, rows, people };
}
for (const legacy of [false, true]) for (const reverseWins of [false, true]) {
  test(`negative-cash probe preserves ${legacy ? 'legacy' : 'same20'} dispatch, refund/reversal ${reverseWins ? 'reversal' : 'refund'} winner and stock/cost obligations`, async () => {
    const { barterNegativeCashProbe } = require('./lib/enterprise-round2-barter-negative.cjs');
    const { ctx, trace, people } = negativeContext({ reverseWins, legacy });
    const prior = process.env.ROUND2_BROWSER; delete process.env.ROUND2_BROWSER;
    let evidence;
    try { evidence = await barterNegativeCashProbe(ctx, new AbortController().signal); }
    finally { if (prior === undefined) delete process.env.ROUND2_BROWSER; else process.env.ROUND2_BROWSER = prior; }
    assert.equal(evidence.cases.length, 5);
    const posts = trace.filter(row => row.endpoint.endsWith('/post'));
    assert.equal(posts.length, 5); assert(posts.every(row => row.actor === people.poster));
    const reads = trace.filter(row => /^\/barter\/settlements\/\d+$/.test(row.endpoint));
    assert(reads.every(row => row.actor === people.poster));
    assert.deepEqual(new Set(reads.map(row => row.instance)), new Set([0, 1]));
    const firstRefund = trace.find(row => row.endpoint === '/barter/settlements/1/refund' && row.actor.id !== people.sales.id);
    assert(firstRefund.actor === (legacy ? people.poster : people.reverser));
    const standardReverse = trace.find(row => row.endpoint === '/barter/settlements/3/reverse');
    assert(standardReverse.actor === people.reverser);
    assert.equal(evidence.cases[3].state.liability.status, reverseWins ? 'void' : 'settled');
    assert.equal(evidence.cases[4].state, undefined);
    assert.equal(evidence.cases[4].after.liability, null);
    assert(trace.every(row => row.endpoint === '/auth/me' || row.endpoint.startsWith('/barter/')),
      'AP must not be routed through AR payment verification');
    assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE-(?:PASSWORD|TOKEN)/);
  });
}
