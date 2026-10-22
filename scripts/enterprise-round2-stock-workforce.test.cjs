const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('./config/enterprise-round2-v1.json');
const { stockWorkforceProbe, verifyStockWorkforce } = require('./lib/enterprise-round2-stock-workforce.cjs');
const copy = value => JSON.parse(JSON.stringify(value));

// Synthetic executable producer/reader contracts, not browser or business credit.
function harness({ drift, mutate, responseCode } = {}) {
  let id = 100;
  const workforce = { actors: [], byJob: {} }, calls = [];
  for (const { job, count } of catalog.roles) {
    workforce.byJob[job] = [];
    for (let index = 1; index <= count; index++) {
      const actor = { id: ++id, job, index, role: `synthetic_${job}`, token: `PRIVATE_${id}` };
      actor.profile = { id, username: `synthetic_${id}`, role: actor.role, segment: 'mixed', mustChangePassword: false,
        isActive: true, permissions: job === 'warehouse' ? ['warehouse.read', 'warehouse.write', 'warehouse.ledger.read']
          : job === 'cost_accountant' ? ['warehouse.read', 'warehouse.ledger.read', 'production.cost.read'] : [],
        dataScopes: ['warehouse', 'cost_accountant'].includes(job) ? ['warehouse_visible'] : [] };
      workforce.actors.push(actor); workforce.byJob[job].push(actor);
    }
  }
  const source = { stockId: 1, responses: [], state: {
    balances: [{ id: 1, materialId: 5, batchNo: 'synthetic-stock', locationId: 10, quantity: 0 },
      { id: 2, materialId: 5, batchNo: 'synthetic-stock', locationId: 11, quantity: 100 }],
    entries: [{ id: 1, sourceType: 'warehouse_manual_inbound', sourceRef: 'seed', createdBy: 1 }],
    movements: [{ id: 1, entryId: 1, quantityDelta: 100 }],
    batch: { id: 6, batchNo: 'synthetic-stock', stockQuantity: 100 },
    costs: [{ id: 1, batchId: 6, quantityDelta: 100, costAmountDelta: 1000, createdBy: 1 }],
  } };
  for (let i = 0; i < 20; i++) {
    source.responses.push({ actorId: 20 + i, requestId: `take-${i}`, status: i < 10 ? 201 : 409 });
    if (i < 10) {
      source.state.entries.push({ id: i + 2, sourceType: 'warehouse_transfer', sourceRef: `warehouse_transfer:take-${i}`, createdBy: 20 + i });
      source.state.movements.push({ id: 2 + i * 2, entryId: i + 2, quantityDelta: -10 }, { id: 3 + i * 2, entryId: i + 2, quantityDelta: 10 });
    }
  }
  const rows = { stockBalance: source.state.balances, stockEntry: source.state.entries,
    stockMovement: source.state.movements, productBatch: [source.state.batch], inventoryCostLedger: source.state.costs };
  const db = copy(rows), prisma = Object.fromEntries(Object.keys(rows).map(table => [table, { findMany: async () => copy(db[table]) }]));
  const ok = data => ({ ok: true, status: 200, json: { success: true, data: copy(data) } });
  const request = async (path, opts) => {
    calls.push({ path, actorId: opts.actor.id, instance: opts.instance, method: opts.method || 'GET', sent: opts.data });
    if (path === '/auth/me') {
      const profile = copy(opts.actor.profile);
      if (drift) drift(profile, opts);
      return ok(profile);
    }
    if (opts.actor.job === 'cost_accountant' && (!opts.method || opts.method === 'GET')) {
      if (path.startsWith('/warehouses/stock-balances?')) return ok(source.state.balances);
      if (path.startsWith('/warehouses/stock-entries?')) return ok(source.state.entries.map(row => ({
        ...row, movements: source.state.movements.filter(item => item.entryId === row.id),
      })));
      assert(path.startsWith('/production/batches/6/cost-ledger?'));
      return ok({ batch: source.state.batch, items: source.state.costs,
        meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        summary: { totalQuantityDelta: 100, currentQuantity: 100, totalCostAmountDelta: 1000, currentCostAmount: 1000 } });
    }
    if (mutate) mutate(db, opts);
    return { ok: false, status: responseCode || 403, json: { success: false,
      requiredPermissions: [opts.actor.job === 'warehouse' ? 'production.cost.read' : 'warehouse.write'] } };
  };
  return { source, workforce, calls, run: () => stockWorkforceProbe({ workforce, request, prisma,
    dataOf: result => { assert.equal(result.status, 200); return result.json.data; },
    runId: 'synthetic-race', urls: ['http://127.0.0.1:1', 'http://127.0.0.1:2'] }, source, AbortSignal.timeout(5000)) };
}

test('actual probe uses all20 original actors, both nodes, available stock, complete ledger/cost and immediate immutable snapshots', async () => {
  const h = harness(), proof = await h.run();
  assert.deepEqual(verifyStockWorkforce(proof, h.source), { costActor: 119, costNodes: 2, deniedActors: 20, denials: 40, unchangedBusinessTables: 5 });
  assert.equal(h.calls.filter(row => row.method === 'POST').length, 34);
  assert.equal(h.calls.filter(row => row.path === '/auth/me').length, 42);
  assert(!/PRIVATE_|"token"|"password"/.test(JSON.stringify(proof)), 'No credential is evidence');
});

for (const [name, mutate] of [
  ['borrowed observer identity', p => { p.costReadbacks[0].actorId = 1; }],
  ['profile grant drift', p => { p.denials[0].profile.permissions.push('warehouse.write'); }],
  ['missing account readiness', p => { delete p.denials[0].profile.isActive; }],
  ['non-boolean account readiness', p => { p.denials[0].profile.isActive = 0; }],
  ['same node substituted', p => { p.denials[1].instance = 0; }],
  ['missing job holder', p => { p.people.pop(); }],
  ['two people share identity', p => { p.people[1].id = p.people[0].id; }],
  ['missing refusal', p => { p.denials.pop(); }],
  ['not found instead of permission rejection', p => { p.denials[0].status = 404; }],
  ['wrong forbidden permission', p => { p.denials[0].json.requiredPermissions = ['orders.read']; }],
  ['exhausted stock instead of valid request', p => { p.denials[0].path = '/warehouses/stock-balances/1/transfer'; }],
  ['same source and destination', p => { p.denials[0].sent.toLocationId = 11; }],
  ['invalid quantity', p => { p.denials[0].sent.quantity = 0; }],
  ['invalid request key', p => { p.denials[0].sent.requestId = 'invalid key'; }],
  ['reused denial key', p => { p.denials[1].sent.requestId = p.denials[0].sent.requestId; }],
  ['another endpoint payload', p => { p.denials[0].sent.status = 'cancelled'; }],
  ['inventory changed between denials', p => { p.denials[0].afterBusinessSha256 = '0'.repeat(64); }],
  ['stock outside race modified', p => { p.after.stockBalance.push({ id: 999, quantity: 1 }); }],
  ['missing voucher API row', p => { p.costReadbacks[0].requests[1].json.data.pop(); }],
  ['missing movement API row', p => { p.costReadbacks[0].requests[1].json.data[1].movements.pop(); }],
  ['voucher author borrowed', p => { p.costReadbacks[0].requests[1].json.data[1].createdBy = 101; }],
  ['cost history changed', p => { p.costReadbacks[1].requests[2].json.data.items[0].costAmountDelta = 1001; }],
  ['cost summary disagrees', p => { p.costReadbacks[1].requests[2].json.data.summary.currentCostAmount = 999; }],
  ['cost pages omitted', p => { p.costReadbacks[1].requests[2].json.data.meta.totalPages = 2; }],
  ['warehouse read is fake POST', p => { p.denials.find(row => row.method === 'GET').method = 'POST'; }],
  ['private origin substituted', p => { p.appUrls[0] = 'http://example.com'; }],
]) test(`independent reader rejects ${name}`, async () => {
  const h = harness(), proof = await h.run(); mutate(proof);
  assert.throws(() => verifyStockWorkforce(proof, h.source));
});

test('producer stops before business request when current authentication drifts', async () => {
  const h = harness({ drift: profile => { profile.id++; } });
  await assert.rejects(h.run(), /Expected values to be strictly equal/);
  assert.equal(h.calls.length, 1);
});
test('producer retains an actual unexpected business effect and stops after the first forbidden request', async () => {
  const h = harness({ mutate: db => { db.stockBalance[1].quantity = 99; } });
  await assert.rejects(h.run(), error => {
    assert.equal(error.evidence.denials.length, 1);
    assert.equal(error.evidence.after.stockBalance[1].quantity, 99);
    assert.equal(error.evidence.before.stockBalance[1].quantity, 100);
    return true;
  });
  assert.equal(h.calls.filter(row => row.method === 'POST').length, 1);
});
test('unauthenticated 401 cannot substitute for a legitimate forbidden duty', async () => {
  const h = harness({ responseCode: 401 });
  await assert.rejects(h.run());
  assert.equal(h.calls.filter(row => row.method === 'POST').length, 1);
});
