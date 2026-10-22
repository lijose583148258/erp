// Small shared, side-effect-free guards for cash registration and reversal.
const assert = require('node:assert/strict');
const policies = {
  sales: { permissions: ['orders.read','orders.create','orders.update','orders.payment.record','customers.read','customers.create','customers.update','materials.read','shipping.read','shipping.receipts.read','barter.read','barter.write'], dataScopes: ['own_customers'] },
  receivables: { permissions: ['orders.read','orders.payment.record','orders.payment.verify','finance.read','collections.read','barter.read','barter.post','orders.payment.reversal.request'], dataScopes: ['finance_visible'] },
  owner: { permissions: ['orders.read','orders.payment.verify','finance.read','procurement.read','procurement.approve','procurement.payment.verify','collections.read','barter.read','barter.approve','orders.payment.reversal.review'], dataScopes: ['finance_visible','procurement_visible'] },
};
function paymentWorkforceProfile(profile, actor) {
  assert(actor && Object.hasOwn(policies, actor.job), 'Unknown payment workforce job');
  assert.equal(Number(profile?.id), actor.id, 'Payment session principal changed');
  for (const field of ['username','role','segment','isActive','mustChangePassword']) assert.equal(profile[field], actor.profile[field], `Payment profile ${field} changed`);
  assert.equal(profile.username, actor.account.username); assert.equal(profile.role, actor.role);
  assert.equal(profile.segment, actor.account.segment); assert.equal(actor.account.role, actor.role);
  assert.equal(profile.isActive, true); assert.equal(profile.mustChangePassword, false);
  assert(!['admin','manager','sales','finance'].includes(profile.role), 'Payment duties require the original custom cohort role');
  for (const field of ['permissions','dataScopes']) {
    assert(Array.isArray(profile[field]) && profile[field].every(value => typeof value === 'string'));
    assert.equal(new Set(profile[field]).size, profile[field].length, 'Duplicate payment grants');
    assert.deepEqual([...profile[field]].sort(), [...actor.profile[field]].sort(), `Payment current ${field} drift`);
    assert.deepEqual([...profile[field]].sort(), [...policies[actor.job][field]].sort(), `Payment ${actor.job} exact policy mismatch`);
  }
  return Object.fromEntries(['id','username','role','segment','isActive','mustChangePassword','permissions','dataScopes'].map(key => [key, Array.isArray(profile[key]) ? [...profile[key]] : profile[key]]));
}
function paymentWorkforceActors(ctx) {
  if (!ctx.workforce) { assert(!ctx.paymentActors, 'Payment duties require the original workforce'); return null; }
  assert(ctx.paymentActors, 'Explicit payment workforce duties are missing');
  assert.equal(ctx.workforce.actors?.length, 20, 'Payment requires the original twenty-person cohort');
  assert.equal(new Set(ctx.workforce.actors.map(person => person.id)).size, 20);
  const people = { sales: ctx.paymentActors.sales, requester: ctx.paymentActors.requester, reviewer: ctx.paymentActors.reviewer };
  for (const [duty, job, ordinal] of [['sales','sales',3], ['requester','receivables',1], ['reviewer','owner',1]]) {
    const actor = people[duty];
    assert(actor && Number.isSafeInteger(actor.id) && actor.id > 0, 'Payment duty has no real principal');
    assert(actor === ctx.workforce.byJob?.[job]?.[ordinal - 1] && ctx.workforce.actors.includes(actor), 'Payment duty borrowed another cohort principal');
    assert.equal(actor.job, job); assert.equal(actor.index, ordinal);
    assert(actor.id !== ctx.actors.admin.id, 'Bootstrap cannot perform a payment duty');
    paymentWorkforceProfile(actor.profile, actor);
  }
  assert.equal(new Set(Object.values(people).map(person => person.id)).size, 3, 'Payment duties must be independent');
  return people;
}
async function paymentNativeRequest(request, actor, token, instance, expected) {
  assert(typeof token === 'string' && token.trim(), 'Payment native session has no token');
  const url = new URL(request.url());
  assert.equal(url.origin, expected.origin); assert.equal(url.pathname, expected.path); assert.equal(request.method(), expected.method);
  const authorizationMatched = (await request.allHeaders()).authorization === `Bearer ${token}`;
  assert(authorizationMatched, 'Payment native request used another authenticated session');
  return { actorId: actor.id, role: actor.role, instance, method: request.method(), path: url.pathname, status: expected.status, authorizationMatched };
}
module.exports = { paymentWorkforceActors, paymentWorkforceProfile, paymentNativeRequest };
