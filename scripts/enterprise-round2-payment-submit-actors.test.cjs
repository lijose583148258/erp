// Synthetic guards/validator contracts only, not a browser acceptance result.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { paymentWorkforceActors, paymentWorkforceProfile, paymentNativeRequest } = require('./lib/enterprise-round2-payment-actor-proof.cjs');
const { verifyPaymentSubmissionProof } = require('./lib/payment-submission-proof.cjs');
const { paymentSubmissionProofFixture } = require('./fixtures/payment-submission-proof-fixture.cjs');

const policies = {
  sales: { permissions: ['orders.read','orders.create','orders.update','orders.payment.record','customers.read','customers.create','customers.update','materials.read','shipping.read','shipping.receipts.read','barter.read','barter.write'], dataScopes: ['own_customers'] },
  receivables: { permissions: ['orders.read','orders.payment.record','orders.payment.verify','finance.read','collections.read','barter.read','barter.post','orders.payment.reversal.request'], dataScopes: ['finance_visible'] },
  owner: { permissions: ['orders.read','orders.payment.verify','finance.read','procurement.read','procurement.approve','procurement.payment.verify','collections.read','barter.read','barter.approve','orders.payment.reversal.review'], dataScopes: ['finance_visible','procurement_visible'] },
};
function context() {
  const actors = Array.from({ length: 20 }, (_, n) => ({ id: n + 1, job: 'other', index: 1, role: `custom_${n}` }));
  const person = (slot, job, index) => Object.assign(actors[slot], { job, index, account: { username: `wf_${slot}`, role: actors[slot].role, segment: 'mixed', password: 'private' }, token: `private-session-${slot}`,
    profile: { id: actors[slot].id, username: `wf_${slot}`, role: actors[slot].role, segment: 'mixed', isActive: true, mustChangePassword: false, ...structuredClone(policies[job]) } });
  const sales = person(9, 'sales', 3), requester = person(10, 'receivables', 1), reviewer = person(11, 'owner', 1);
  return { actors: { admin: { id: 99 } }, workforce: { actors, byJob: { sales: [actors[0], actors[1], sales], receivables: [requester], owner: [reviewer] } }, paymentActors: { sales, requester, reviewer } };
}
test('payment workforce preserves the original twenty-person references and legacy mode', () => {
  assert.equal(paymentWorkforceActors({ actors: {} }), null);
  const ctx = context(), people = paymentWorkforceActors(ctx);
  for (const duty of ['sales','requester','reviewer']) assert(people[duty] === ctx.paymentActors[duty]);
  assert(!JSON.stringify(paymentWorkforceProfile(people.sales.profile, people.sales)).includes('private'));
});
for (const [label, mutate] of [
  ['missing explicit duties', c => { delete c.paymentActors; }],
  ['missing cohort', c => { delete c.workforce; }],
  ['cloned sales identity', c => { c.paymentActors.sales = structuredClone(c.paymentActors.sales); }],
  ['wrong sales ordinal', c => { c.paymentActors.sales.index = 1; }],
  ['borrowed reviewer', c => { c.paymentActors.reviewer = c.paymentActors.requester; }],
  ['inactive principal', c => { c.paymentActors.sales.profile.isActive = false; }],
  ['password reset required', c => { c.paymentActors.requester.profile.mustChangePassword = true; }],
  ['permission expansion', c => { c.paymentActors.sales.profile.permissions.push('assets.read'); }],
  ['scope expansion', c => { c.paymentActors.requester.profile.dataScopes.push('all'); }],
  ['incomplete cohort', c => { c.workforce.actors.pop(); }],
]) test(`payment workforce rejects ${label}`, () => { const ctx = context(); mutate(ctx); assert.throws(() => paymentWorkforceActors(ctx)); });
test('current payment profile rejects identity, ready state and exact-policy drift', () => {
  const actor = context().paymentActors.sales;
  for (const change of [{ id: 88 }, { username: 'other' }, { role: 'sales' }, { isActive: false }, { mustChangePassword: true }, { permissions: [...actor.profile.permissions, 'assets.read'] }, { dataScopes: [] }]) {
    assert.throws(() => paymentWorkforceProfile({ ...actor.profile, ...change }, actor));
  }
});
test('native request binds the real authorization without exposing either secret on rejection', async () => {
  const actor = context().paymentActors.sales;
  const request = token => ({ url: () => 'http://127.0.0.1:3001/api/orders/9/payment', method: () => 'POST', allHeaders: async () => ({ authorization: `Bearer ${token}` }) });
  const expected = { origin: 'http://127.0.0.1:3001', method: 'POST', path: '/api/orders/9/payment', status: 200 };
  const evidence = await paymentNativeRequest(request(actor.token), actor, actor.token, 0, expected);
  assert.equal(evidence.authorizationMatched, true); assert(!JSON.stringify(evidence).includes(actor.token));
  await assert.rejects(paymentNativeRequest(request('private-wrong'), actor, actor.token, 0, expected), error => !String(error).includes('private-'));
  await assert.rejects(paymentNativeRequest(request(undefined), actor, undefined, 0, expected));
});
function workforceEvidence() {
  const e = paymentSubmissionProofFixture('sqlite'), ctx = context(), people = ctx.paymentActors;
  e.workforce = { version: 'payment-submission-workforce/v1', cohort: ctx.workforce.actors.map(({ id, job, index, role }) => ({ id, job, index, role })),
    actors: Object.fromEntries(Object.entries(people).map(([duty, actor]) => [duty, { actorId: actor.id, job: actor.job, index: actor.index, role: actor.role, profile: paymentWorkforceProfile(actor.profile, actor) }])),
    profiles: Object.entries(people).flatMap(([duty, actor]) => [0,1].map(instance => ({ duty, actorId: actor.id, instance, profile: paymentWorkforceProfile(actor.profile, actor) }))),
    sessions: Object.entries(people).map(([duty, actor], index) => ({ duty, actorId: actor.id, instance: index === 2 ? 1 : 0, authorizationMatched: true, profile: paymentWorkforceProfile(actor.profile, actor) })),
    nativeRequests: ['lost-ack','recovered-ack'].map(phase => ({ phase, actorId: people.sales.id, role: people.sales.role, instance: 0, method: 'POST', path: '/api/orders/9/payment', status: 200, authorizationMatched: true })),
    customer: { id: 1, salespersonId: people.sales.id }, order: { id: 9, createdBy: people.sales.id, customerId: 1 },
    verificationAudits: [1,2,3].map(id => ({ id: 100 + id, userId: people.requester.id, action: 'PAYMENT_VERIFIED', resource: 'payment', resourceId: id })) };
  e.workforce.nativeRequests.push(...[people.requester, people.reviewer].map((actor, instance) => ({ phase: 'collections-readback', actorId: actor.id, role: actor.role, instance,
    method: 'GET', path: '/api/collections/workbench', status: 200, authorizationMatched: true, payment: { id: 3, amount: 300, status: 'verified' } })));
  e.browser.role = people.sales.role;
  for (const key of ['before','twoGenuine','afterVerification','finalSnapshot','afterAllReplays']) {
    e[key].order.createdBy = people.sales.id;
    for (const payment of e[key].payments) payment.verifiedBy = people.requester.id;
  }
  e.optionalAiModuleFailure.afterRecovery = structuredClone(e.finalSnapshot);
  e.negatives.find(row => row.label === 'different-principal').actorId = people.requester.id;
  e.apiReadbacks.forEach((row, index) => { row.actorId = [people.requester, people.reviewer][index].id; });
  e.screenshots.filter(row => row.kind === 'finance-readback').forEach((row, index) => { row.actorId = [people.requester, people.reviewer][index].id; row.instance = index; });
  return e;
}
test('workforce payment proof accepts dynamic sales3/AR/owner roles with durable creator and audit binding', () => {
  assert.equal(verifyPaymentSubmissionProof(workforceEvidence(), 'sqlite').registrations, 3);
});
for (const [label, mutate] of [
  ['literal sales role instead of current dynamic role', e => { e.browser.role = 'sales'; }],
  ['missing native authorization', e => { e.workforce.nativeRequests[0].authorizationMatched = false; }],
  ['native wrong principal', e => { e.workforce.nativeRequests[0].actorId = 11; }],
  ['same node twice', e => { e.apiReadbacks[1].instance = 0; }],
  ['owner readback borrowed AR', e => { e.screenshots[2].actorId = 11; }],
  ['unrelated order creator', e => { e.workforce.order.createdBy = 99; }],
  ['unrelated durable submission owner', e => { e.finalSnapshot.submissions[0].userId = 99; }],
  ['unrelated verification audit actor', e => { e.workforce.verificationAudits[0].userId = 99; }],
  ['current profile permission drift', e => { e.workforce.profiles[0].profile.permissions.push('assets.read'); }],
  ['browser profile not ready', e => { e.workforce.sessions[0].profile.mustChangePassword = true; }],
  ['wrong sales ordinal in cohort', e => { e.workforce.cohort.find(row => row.id === 10).index = 1; }],
]) test(`workforce payment proof rejects ${label}`, () => { const e = workforceEvidence(); mutate(e); assert.throws(() => verifyPaymentSubmissionProof(e, 'sqlite')); });

test('actual payment probe routes customer/order/burst/conflicts and both API verifications through explicit duties; legacy remains unchanged', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { createRequire } = require('node:module');
  for (const injected of [true, false]) {
    const ctx = context(), sales = injected ? ctx.paymentActors.sales : { id: 70, role: 'sales' }, ar = injected ? ctx.paymentActors.requester : { id: 71, role: 'finance' };
    Object.assign(ctx.actors, { sales, finance1: ar, finance2: { id: 72, role: 'finance' } });
    if (!injected) { delete ctx.workforce; delete ctx.paymentActors; }
    const calls = [], orders = new Map(), payments = [], submissions = [], audits = []; let sequence = 20;
    const copy = value => structuredClone(value), ok = (data, extra = {}) => ({ status: 200, json: { data: copy(data), ...extra } });
    const request = async (endpoint, options = {}) => {
      const actor = options.actor || ctx.actors.admin, data = options.data;
      calls.push({ endpoint, actorId: actor.id, method: options.method || 'GET', instance: options.instance || 0 });
      if (endpoint === '/auth/me') return ok(actor.profile);
      if (endpoint === '/customers') { assert.equal(actor.id, injected ? sales.id : ctx.actors.admin.id); assert.equal(data.salespersonId, sales.id); return ok({ id: 1 }); }
      if (endpoint === '/orders') { assert.equal(actor.id, sales.id); const row = { id: ++sequence, createdBy: sales.id, customerId: 1, paidAmount: 0, paymentStatus: 'unpaid' }; orders.set(row.id, row); return ok(row); }
      const [, , orderKey, , paymentKey, verb] = endpoint.split('/');
      const orderId = Number(orderKey), order = orders.get(orderId);
      if (verb === 'verify') {
        assert.equal(actor.id, ar.id, 'Every API verification must be delegated to AR, never the owner');
        const payment = payments.find(row => row.id === Number(paymentKey)); payment.status = 'verified'; payment.verifiedBy = ar.id;
        order.paidAmount += payment.amount; order.paymentStatus = 'partial'; return ok(order);
      }
      assert(endpoint.endsWith('/payment'));
      if (actor.id !== sales.id) assert.equal(actor.id, ar.id, 'The foreign-principal 409 must exercise AR, not an unrelated finance fixture');
      if (!data.idempotencyKey) return { status: 400, json: { errorCode: 'PAYMENT_SUBMISSION_KEY_REQUIRED' } };
      const old = submissions.find(row => row.requestKey === data.idempotencyKey), fingerprint = JSON.stringify({ ...data, idempotencyKey: undefined });
      if (old) return old.userId === actor.id && old.orderId === orderId && old.fingerprint === fingerprint ? ok(order, { paymentSubmission: JSON.parse(old.resultJson), replayed: true }) : { status: 409, json: { errorCode: 'PAYMENT_SUBMISSION_KEY_CONFLICT' } };
      const pending = payments.filter(row => row.orderId === orderId && row.status === 'pending').reduce((sum, row) => sum + row.amount, 0);
      if (data.amount + pending + order.paidAmount > 1000) return { status: 409, json: { errorCode: 'PAYMENT_SUBMISSION_PENDING_CAPACITY' } };
      const paymentId = ++sequence, auditId = ++sequence;
      const receipt = { requestKey: data.idempotencyKey, paymentId, auditId, orderId, amount: data.amount, submittedBy: actor.id };
      payments.push({ id: paymentId, orderId, amount: data.amount, status: 'pending' });
      submissions.push({ paymentId, requestKey: data.idempotencyKey, orderId, userId: actor.id, fingerprint, resultJson: JSON.stringify(receipt) });
      audits.push({ id: auditId, resource: 'order', resourceId: orderId, action: 'PAYMENT_SUBMITTED', userId: actor.id });
      return ok(order, { paymentSubmission: receipt, replayed: false });
    };
    const matching = (rows, query) => rows.filter(row => Object.entries(query.where).every(([key, value]) => key === 'payment' ? payments.some(p => p.id === row.paymentId && p.orderId === value.orderId) : typeof value === 'object' ? value.in.includes(row[key]) : row[key] === value));
    ctx.prisma = {
      paymentRecord: { findMany: async q => copy(matching(payments, q)), count: async q => matching(payments, q).length, aggregate: async q => ({ _sum: { amount: matching(payments, q).reduce((sum, p) => sum + p.amount, 0) } }) },
      paymentSubmission: { findMany: async q => copy(matching(submissions, q)), count: async q => matching(submissions, q).length },
      auditLog: { findMany: async q => copy(matching(audits, q)), count: async q => matching(audits, q).length },
      order: { findUnique: async q => copy(orders.get(q.where.id)), findUniqueOrThrow: async q => copy(orders.get(q.where.id)) },
      customer: { findUniqueOrThrow: async () => ({ id: 1, salespersonId: sales.id }) },
    };
    Object.assign(ctx, { request, dataOf: response => { assert.equal(response.status, 200); return response.json.data; }, runId: 'synthetic-routing-only' });
    const file = path.join(__dirname, 'lib/enterprise-round2-payment-submit.cjs'), mod = { exports: {} }, actualRequire = createRequire(file), stop = new Error('ROUTING_CHECK_STOP_BEFORE_BROWSER');
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: mod, exports: mod.exports, process: { env: {} }, Date,
      require: key => key === 'node:timers/promises' ? { setTimeout: async () => {} } : key === './material-audit-fixture.cjs' ? { ensureReleasedMaterial: async () => ({ id: 2, nameZh: 'synthetic' }) } :
        key === './enterprise-round2-payment-submit-browser.cjs' ? { paymentSubmitBrowser: async () => { throw stop; } } : actualRequire(key) }, { filename: file });
    await assert.rejects(mod.exports.paymentSubmitProbe(ctx, AbortSignal.timeout(5000)), error => error === stop);
    assert.equal(calls.filter(row => row.endpoint.endsWith('/verify')).length, 2);
    assert(calls.filter(row => row.endpoint === '/orders').length >= 4);
    assert(calls.filter(row => row.endpoint.endsWith('/payment') && row.actorId === ar.id).length === 1);
    if (injected) assert.equal(calls.filter(row => row.endpoint === '/auth/me').length, 6);
  }
});

// Unit boundary simulation only: this executes the real nested open(), not a
// reconstructed login helper, and does not claim rendered browser acceptance.
async function nativeOpenHarness(duty, invalidLoginProfile = false) {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { createRequire } = require('node:module');
  const ctx = context(), actor = ctx.paymentActors[duty], priorToken = actor.token;
  const instance = duty === 'reviewer' ? 1 : 0, hash = duty === 'sales' ? 'orders' : 'collections';
  Object.assign(ctx, { urls: ['http://127.0.0.1:5006', 'http://127.0.0.1:5008'], runId: 'synthetic-open-unit', reportPath: path.join(__dirname, '../output/SYNTHETIC-NOT-WRITTEN.json') });
  const newToken = `private-new-${duty}`, origin = ctx.urls[instance], loginCalls = [];
  const nativeResponse = pathname => ({ url: () => `${origin}${pathname}`, status: () => 200,
    request: () => ({ url: () => `${origin}${pathname}`, method: () => 'GET', allHeaders: async () => ({ authorization: `Bearer ${newToken}` }) }),
    json: async () => ({ data: pathname === '/api/auth/me' ? structuredClone(actor.profile) : { ledger: [{ id: 3, amount: 300, status: 'verified' }] } }) });
  const page = { context: () => ({ tracing: { start: async () => {} } }), setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, on() {},
    waitForResponse: async predicate => { const response = ['/api/auth/me', '/api/collections/workbench'].map(nativeResponse).find(predicate); assert(response); return response; },
    goto: async () => {}, locator: () => ({ waitFor: async () => {} }) };
  const browser = { newPage: async () => page, close: async () => {} };
  const loginUiAuditUser = async (actualPage, appUrl, options) => {
    assert(actualPage === page); assert.equal(appUrl, `${origin}/`); assert(options.account === actor.account); assert.equal(options.reuseExistingAccount, true);
    loginCalls.push(duty); const user = structuredClone(actor.profile); if (invalidLoginProfile) user.id = 999;
    return { token: newToken, user };
  };
  const file = path.join(__dirname, 'lib/enterprise-round2-payment-submit-browser.cjs'), actualRequire = createRequire(file), mod = { exports: {} };
  const source = fs.readFileSync(file, 'utf8');
  const marker = source.indexOf('    e.bootstrapRecovery = await bootstrapFailureReadbacks();'); assert(marker > 0);
  const tryStart = source.lastIndexOf('  try {', marker);
  // Test-only exposure before any bootstrap/fault/business workflow executes.
  const exposed = `${source.slice(0, tryStart)}  return { open };\n${source.slice(tryStart)}`;
  const dependencies = { 'node:fs': { mkdirSync() {} }, 'playwright/test': { expect: {} },
    './browser-launch-guard.cjs': { launchBrowserWithGuard: async () => ({ browser }) },
    './ui-audit-user.cjs': { loginUiAuditUser } };
  vm.runInNewContext(exposed, { module: mod, exports: mod.exports, URL, Date, require: key => dependencies[key] || actualRequire(key) }, { filename: file });
  const controller = new AbortController(), evidence = { workforce: { sessions: [], nativeRequests: [] }, browser: { originalReceipt: { paymentId: 3 } } };
  const entry = await mod.exports.paymentSubmitBrowser(ctx, { id: 9 }, async () => ({}), evidence, controller.signal);
  return { ctx, actor, priorToken, newToken, loginCalls, evidence, controller, run: () => entry.open(actor, instance, hash) };
}
for (const duty of ['sales', 'requester', 'reviewer']) {
  test(`synthetic actual native open propagates fresh ${duty} login to the original shared cohort actor`, async () => {
    const h = await nativeOpenHarness(duty);
    try {
      await h.run(); assert.equal(h.loginCalls.length, 1);
      assert(h.actor === h.ctx.paymentActors[duty] && h.ctx.workforce.actors.includes(h.actor));
      assert(h.actor.token !== h.priorToken && h.actor.token === h.newToken, 'Successful native login must refresh the existing cohort object used by subsequent APIs');
      assert.equal(h.evidence.workforce.sessions[0].authorizationMatched, true);
    } finally { h.controller.abort(); }
  });
  test(`synthetic actual native open rejects mismatched ${duty} login profile without changing the shared token`, async () => {
    const h = await nativeOpenHarness(duty, true);
    try {
      await assert.rejects(h.run(), /Payment session principal changed/); assert.equal(h.loginCalls.length, 1);
      assert(h.actor.token === h.priorToken, 'Rejected login profile must not replace the shared cohort token');
      assert.deepEqual(h.evidence.workforce.sessions, []);
    } finally { h.controller.abort(); }
  });
}
