const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const catalog = require('../config/enterprise-round2-v1.json');
const copy = value => JSON.parse(JSON.stringify(value));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const tables = ['stockBalance', 'stockEntry', 'stockMovement', 'productBatch', 'inventoryCostLedger'];
const ids = rows => rows.map(row => row.id).sort((a, b) => a - b);

function profileMatches(actual, person) {
  assert.equal(actual.id, person.id);
  for (const key of ['username', 'role', 'segment', 'mustChangePassword']) assert.equal(actual[key], person.profile[key], `Current profile ${key}`);
  assert.equal(actual.mustChangePassword, false);
  assert.equal(actual.isActive, true);
  for (const key of ['permissions', 'dataScopes']) {
    assert(Array.isArray(actual[key]) && actual[key].every(value => typeof value === 'string'));
    assert.equal(new Set(actual[key]).size, actual[key].length);
    assert.deepEqual([...actual[key]].sort(), [...person.profile[key]].sort(), `Current ${key}`);
  }
  assert(!actual.permissions.includes('*') && !actual.dataScopes.includes('all'));
}

function sameRows(actual, raw) {
  assert(Array.isArray(actual) && Array.isArray(raw));
  assert.deepEqual(ids(actual), ids(raw), 'Every persisted row must be read exactly once');
  for (const expected of raw) {
    const row = actual.find(item => item.id === expected.id);
    for (const key of Object.keys(expected)) assert.deepEqual(row[key], expected[key], `Persisted ${expected.id}/${key}`);
  }
}

// Domain-specific evidence reader. The original pressure cohort remains the
// race writer; real job holders inspect its vouchers without receiving grants.
function verifyStockWorkforce(proof, source) {
  assert.equal(proof.version, 'stock-pressure-workforce/v1');
  assert.equal(proof.appUrls.length, 2);
  assert.equal(new Set(proof.appUrls).size, 2);
  for (const url of proof.appUrls) assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname));
  assert.equal(proof.people.length, 20);
  assert(proof.people.every(person => Number.isSafeInteger(person.id) && person.id > 0));
  assert.equal(new Set(proof.people.map(person => person.id)).size, 20);
  for (const { job, count } of catalog.roles) {
    const people = proof.people.filter(person => person.job === job);
    assert.deepEqual(people.map(person => person.index).sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i + 1));
    for (const person of people) {
      assert.equal(person.role, person.profile.role); profileMatches(person.profile, person);
      assert.equal(person.profile.permissions.includes('warehouse.write'), job === 'warehouse', 'Only the existing warehouse duties can transfer');
    }
  }
  assert.equal(source.responses.length, 20);
  assert.equal(new Set(source.responses.map(row => row.actorId)).size, 20);
  assert(source.responses.every(row => !proof.people.some(person => person.id === row.actorId)), 'Pressure writers are not the workforce cohort');
  const state = copy(source.state);
  assert.equal(source.responses.filter(row => row.status === 201).length, 10);
  assert.equal(state.entries.length, 11);
  assert.equal(state.movements.length, 21);
  assert(state.balances.every(row => Number(row.quantity) >= 0));
  assert.equal(state.balances.reduce((sum, row) => sum + Number(row.quantity), 0), 100);
  assert.equal(state.batch.stockQuantity, 100);
  assert.equal(state.costs.reduce((sum, row) => sum + Number(row.quantityDelta), 0), 100);
  assert.equal(state.costs.reduce((sum, row) => sum + Math.round(Number(row.costAmountDelta) * 100), 0), 100000);
  for (const response of source.responses) {
    assert([201, 409].includes(response.status));
    const entries = state.entries.filter(entry => entry.sourceRef === `warehouse_transfer:${response.requestId}`);
    assert.equal(entries.length, response.status === 201 ? 1 : 0);
    if (entries.length) assert.equal(entries[0].createdBy, response.actorId, 'Pressure voucher author must remain the real writer');
  }
  for (const name of ['before', 'after']) {
    assert.deepEqual(Object.keys(proof[name]).sort(), [...tables].sort());
    for (const table of tables) assert(Array.isArray(proof[name][table]));
  }
  assert.deepEqual(proof.after, proof.before, 'Forbidden requests must not mutate any stock/cost business row');
  for (const [table, rows] of [['stockBalance', state.balances], ['stockEntry', state.entries],
    ['stockMovement', state.movements], ['productBatch', [state.batch]], ['inventoryCostLedger', state.costs]]) {
    sameRows(proof.before[table].filter(row => rows.some(item => item.id === row.id)), rows);
  }
  const cost = proof.people.find(person => person.job === 'cost_accountant');
  assert(cost.profile.permissions.includes('production.cost.read'));
  assert.deepEqual(proof.costReadbacks.map(row => row.instance), [0, 1]);
  for (const read of proof.costReadbacks) {
    assert.equal(read.actorId, cost.id); profileMatches(read.profile, cost);
    assert.equal(read.profileStatus, 200);
    const paths = [
      `/warehouses/stock-balances?batchNo=${encodeURIComponent(state.batch.batchNo)}&pageSize=100`,
      `/warehouses/stock-entries?batchNo=${encodeURIComponent(state.batch.batchNo)}&limit=200`,
      `/production/batches/${state.batch.id}/cost-ledger?page=1&pageSize=100`,
    ];
    assert.deepEqual(read.requests.map(row => row.path), paths);
    for (const row of read.requests) {
      assert.equal(row.method, 'GET'); assert.equal(row.status, 200); assert.equal(row.json.success, true);
    }
    sameRows(read.requests[0].json.data, state.balances);
    sameRows(read.requests[1].json.data, state.entries);
    for (const entry of read.requests[1].json.data) sameRows(entry.movements, state.movements.filter(row => row.entryId === entry.id));
    const data = read.requests[2].json.data;
    sameRows(data.items, state.costs);
    assert.deepEqual(data.meta, { page: 1, pageSize: 100, total: state.costs.length, totalPages: 1 });
    assert.equal(data.batch.id, state.batch.id);
    assert.equal(data.batch.stockQuantity, 100);
    for (const field of ['totalQuantityDelta', 'currentQuantity']) assert.equal(data.summary[field], 100);
    for (const field of ['totalCostAmountDelta', 'currentCostAmount']) assert.equal(data.summary[field], 1000);
  }
  const from = state.balances.find(row => row.id !== source.stockId && row.quantity === 100);
  const to = state.balances.find(row => row.id === source.stockId && row.quantity === 0);
  assert(from && to && from.locationId !== to.locationId, 'Use available stock and a real distinct destination, not an exhausted source');
  assert.equal(proof.denials.length, 40);
  assert.equal(new Set(proof.denials.map(row => `${row.actorId}:${row.instance}`)).size, 40);
  assert.equal(new Set(proof.denials.filter(row => row.method === 'POST').map(row => row.sent.requestId)).size, 34);
  for (const person of proof.people) for (const instance of [0, 1]) {
    const row = proof.denials.find(item => item.actorId === person.id && item.instance === instance);
    assert(row); profileMatches(row.profile, person); assert.equal(row.profileStatus, 200);
    if (person.job === 'warehouse') {
      assert(!row.profile.permissions.includes('production.cost.read'));
      assert.equal(row.method, 'GET');
      assert.equal(row.path, `/production/batches/${state.batch.id}/cost-ledger?page=1&pageSize=100`);
      assert.equal(row.sent, null);
    } else {
      assert.equal(row.method, 'POST'); assert.equal(row.path, `/warehouses/stock-balances/${from.id}/transfer`);
      assert.deepEqual(Object.keys(row.sent).sort(), ['quantity', 'requestId', 'toLocationId']);
      assert.equal(row.sent.quantity, 1); assert.equal(row.sent.toLocationId, to.locationId);
      assert.match(row.sent.requestId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/);
      assert(!state.entries.some(entry => entry.sourceRef === `warehouse_transfer:${row.sent.requestId}`));
    }
    assert.equal(row.status, 403); assert.equal(row.json.success, false);
    assert.deepEqual(row.json.requiredPermissions, [person.job === 'warehouse' ? 'production.cost.read' : 'warehouse.write'], 'Reject specifically for the real missing permission');
    assert.equal(row.afterBusinessSha256, digest(proof.before), 'Every denial has an immediate all-stock business snapshot');
  }
  return { costActor: cost.id, costNodes: 2, deniedActors: 20, denials: 40, unchangedBusinessTables: tables.length };
}

async function stockWorkforceProbe({ workforce, request, dataOf, prisma, runId, urls }, source, signal) {
  const proof = { version: 'stock-pressure-workforce/v1',
    scope: 'Same workforce observes real pressure vouchers and denied duties; pressure writers stay outside workforce; not all12 acceptance',
    appUrls: [...urls],
    people: workforce.actors.map(({ id, job, index, role, profile }) => ({ id, job, index, role, profile: copy(profile) })),
    costReadbacks: [], denials: [] };
  const snapshot = async () => {
    const result = {};
    for (const table of tables) result[table] = await prisma[table].findMany({ orderBy: { id: 'asc' } });
    return copy(result);
  };
  try {
    proof.before = await snapshot();
    const actor = workforce.byJob.cost_accountant[0], state = source.state;
    for (const instance of [0, 1]) {
      const auth = await request('/auth/me', { actor, instance, signal });
      const read = { actorId: actor.id, instance, profileStatus: auth.status, profile: dataOf(auth), requests: [] };
      proof.costReadbacks.push(read); profileMatches(read.profile, proof.people.find(person => person.id === actor.id));
      for (const path of [
        `/warehouses/stock-balances?batchNo=${encodeURIComponent(state.batch.batchNo)}&pageSize=100`,
        `/warehouses/stock-entries?batchNo=${encodeURIComponent(state.batch.batchNo)}&limit=200`,
        `/production/batches/${state.batch.id}/cost-ledger?page=1&pageSize=100`,
      ]) read.requests.push({ path, method: 'GET', ...await request(path, { actor, instance, signal }) });
    }
    const from = state.balances.find(row => row.id !== source.stockId && Number(row.quantity) === 100);
    const to = state.balances.find(row => row.id === source.stockId);
    assert(from && to);
    for (const actor of workforce.actors) for (const instance of [0, 1]) {
      signal.throwIfAborted();
      const auth = await request('/auth/me', { actor, instance, signal }), profile = dataOf(auth);
      profileMatches(profile, proof.people.find(person => person.id === actor.id));
      const isWarehouse = actor.job === 'warehouse';
      const sent = isWarehouse ? null : { quantity: 1, toLocationId: to.locationId, requestId: `${runId}-denied-${actor.id}-${instance}` };
      const path = isWarehouse ? `/production/batches/${state.batch.id}/cost-ledger?page=1&pageSize=100` : `/warehouses/stock-balances/${from.id}/transfer`;
      const method = isWarehouse ? 'GET' : 'POST';
      const response = await request(path, { actor, instance, method, ...(sent ? { data: sent } : {}), signal });
      const after = await snapshot();
      proof.denials.push({ actorId: actor.id, instance, profileStatus: auth.status, profile,
        path, method, sent, ...response, afterBusinessSha256: digest(after) });
      // Stop immediately on an unexpected effect; retain actual rows in failure evidence.
      proof.after = after;
      assert.deepEqual(after, proof.before); assert.equal(response.status, 403);
    }
    verifyStockWorkforce(proof, source);
    return proof;
  } catch (error) { error.evidence = proof; throw error; }
}

module.exports = { stockWorkforceProbe, verifyStockWorkforce };
