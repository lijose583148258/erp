const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// These are synthetic source-gate contracts, not business acceptance evidence.
// Execute the actual producer against a deliberately small, fixed-stage ledger;
// no database, browser, network, credentials, or generated evidence is used.
const filename = path.join(__dirname, 'lib/enterprise-round2-production-disposition.cjs');
const actualRequire = createRequire(filename);
const clone = value => structuredClone(value);
const jsonCopy = value => JSON.parse(JSON.stringify(value));

function loadProducer() {
  const module = { exports: {} };
  // Objects returned by the synthetic IO live in the host realm. Normalize
  // prototypes only, preserving every field/value, before deep comparison.
  const realmAssert = Object.assign((...args) => assert(...args), assert, {
    deepEqual(actual, expected, message) { assert.deepEqual(clone(actual), clone(expected), message); },
  });
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    process: { env: { ROUND2_BROWSER: 'false' } },
    require(name) {
      if (name === 'node:assert/strict') return realmAssert;
      assert(!name.includes('browser'), 'Synthetic contract must never load a browser');
      if (name === 'node:fs') throw new Error('Synthetic producer must not write evidence');
      return actualRequire(name);
    },
  }, { filename });
  return module.exports.productionDispositionProbe;
}

function fixture({ injected = true, fault = null } = {}) {
  const actor = (id, role) => ({ id, role, token: `synthetic-token-${id}` });
  const actors = {
    admin: actor(1, 'admin'), stock0: actor(2, 'warehouse'),
    stock1: actor(3, 'warehouse'), buyer1: actor(4, 'procurement'),
  };
  const productionActors = {
    research: actor(11, 'research'), planner: actor(12, 'production_planner'),
    operators: [actor(13, 'production_operator'), actor(14, 'production_operator')],
    qc: actor(15, 'qc'), qa: actor(16, 'qa'), cost: actor(17, 'cost_accountant'),
    warehouse: actor(18, 'warehouse'),
  };
  const expected = injected ? productionActors : {
    research: actors.admin, planner: actors.stock0, operators: [actors.stock0, actors.stock1],
    qc: actors.stock0, qa: actors.buyer1, cost: actors.admin, warehouse: actors.stock0,
  };
  const allActors = [...Object.values(actors), productionActors.research, productionActors.planner,
    ...productionActors.operators, productionActors.qc, productionActors.qa,
    productionActors.cost, productionActors.warehouse];
  const calls = [];
  const state = { completed: false, scrapped: false, reworked: false };
  const raw = { id: 201, nameZh: 'Synthetic raw' };
  const fg = { id: 202, nameZh: 'Synthetic product' };
  const final = { id: 203, nameZh: 'Synthetic downstream' };
  const sourceLocation = { id: 101 }, reworkLocation = { id: 102 };
  const rawStock = { id: 301, materialId: raw.id, quantity: 10 };
  const workOrder = { id: 501, workOrderNo: 'SYN-WO-501', createdBy: expected.planner.id };
  const downstream = { id: 502, workOrderNo: 'SYN-WO-502', createdBy: injected ? expected.planner.id : actors.stock1.id };
  const productBatch = () => ({ id: 601, materialId: fg.id, batchNo: 'SYN-FG-601',
    productName: fg.nameZh, unit: 'kg', stockQuantity: state.scrapped ? 7 : 10, qualityStatus: 'released' });
  const outputStock = () => ({ id: 701, materialId: fg.id, batchNo: 'SYN-FG-601',
    locationId: sourceLocation.id, quantity: state.scrapped ? 7 : 10 });
  const returnedBatch = () => ({ id: 602, materialId: fg.id, batchNo: 'SYN-RW-602',
    productName: fg.nameZh, unit: 'kg', stockQuantity: 2, qualityStatus: 'quarantined' });
  const returnedStock = () => ({ id: 702, materialId: fg.id, batchNo: 'SYN-RW-602',
    locationId: reworkLocation.id, quantity: 2 });
  const scrap = () => ({ id: 801, dispositionNo: 'SYN-PDS-801', workOrderId: workOrder.id,
    dispositionType: 'scrap', quantity: 3, costAmount: 30,
    reworkedQuantity: state.reworked ? 2 : 0, reworkedCostAmount: state.reworked ? 20 : 0,
    batchId: 601, stockBalanceId: 701, createdBy: expected.operators[0].id });
  const rework = () => ({ id: 802, dispositionNo: 'SYN-PDS-802', workOrderId: workOrder.id,
    dispositionType: 'rework_return', quantity: 2, costAmount: 20,
    sourceDispositionId: 801, batchId: 602, stockBalanceId: 702, createdBy: expected.operators[0].id });
  const ledgerRow = (id, batchId, sourceType, sourceRef, q0, dq, q1, c0, dc, c1) => ({
    id, ledgerNo: `SYN-ICL-${id}`, batchId, sourceType, sourceRef,
    workOrderId: workOrder.id, adjustmentId: null,
    quantityBefore: q0, quantityDelta: dq, quantityAfter: q1, unitCost: 10,
    costBefore: c0, costAmountDelta: dc, costAfter: c1, note: 'synthetic contract',
    createdBy: expected.operators[0].id, createdAt: new Date(`2026-10-17T00:00:0${id - 1001}.000Z`),
  });
  const originalCosts = () => [
    ledgerRow(1001, 601, 'production_finished_goods_receipt', workOrder.workOrderNo, 0, 10, 10, 0, 100, 100),
    ...(state.scrapped ? [ledgerRow(1002, 601, 'production_scrap', 'SYN-PDS-801', 10, -3, 7, 100, -30, 70)] : []),
  ];
  const returnedCosts = () => state.reworked
    ? [ledgerRow(1003, 602, 'production_rework_return', 'SYN-PDS-802', 0, 2, 2, 0, 20, 20)] : [];
  const dispositions = () => [...(state.scrapped ? [scrap()] : []), ...(state.reworked ? [rework()] : [])];
  const audits = () => [...(state.scrapped ? [{ id: 1101, action: 'POST_PRODUCTION_SCRAP_DISPOSITION',
    resource: 'production_disposition', resourceId: 801, userId: expected.operators[0].id }] : []),
  ...(state.reworked ? [{ id: 1102, action: 'POST_PRODUCTION_REWORK_RETURN',
    resource: 'production_disposition', resourceId: 802, userId: expected.operators[0].id }] : [])];
  const entries = () => [...(state.scrapped ? [{ id: 1201, sourceType: 'production_scrap', sourceRef: 'SYN-PDS-801' }] : []),
    ...(state.reworked ? [{ id: 1202, sourceType: 'production_rework_return', sourceRef: 'SYN-PDS-802' }] : [])];
  const costResponse = batchId => {
    const batch = batchId === 601 ? productBatch() : returnedBatch();
    const rows = batchId === 601 ? originalCosts() : returnedCosts();
    const currentQuantity = batch.stockQuantity, currentCostAmount = batchId === 601 ? 70 : 20;
    return {
      batch: { id: batch.id, batchNo: batch.batchNo, productName: batch.productName,
        stockQuantity: batch.stockQuantity, unit: batch.unit },
      summary: { totalQuantityDelta: currentQuantity, totalCostAmountDelta: currentCostAmount,
        currentQuantity, currentCostAmount, currentUnitCost: 10 },
      items: rows.toReversed().map(row => ({ ...row, createdAt: row.createdAt.toISOString(),
        batchNo: batch.batchNo, productName: batch.productName, workOrderNo: workOrder.workOrderNo,
        adjustmentNo: null, creator: { id: row.createdBy, username: `synthetic-${row.createdBy}`,
          role: allActors.find(item => item.id === row.createdBy).role } })),
      meta: { page: 1, pageSize: 100, total: rows.length, totalPages: 1 },
    };
  };
  const expectActor = (actual, wanted, endpoint) => {
    assert.equal(actual?.id, wanted.id, `${endpoint}: expected actual ${wanted.role} actor ${wanted.id}`);
    assert.equal(actual?.role, wanted.role, `${endpoint}: role must remain explicit`);
    assert.equal(actual?.token, wanted.token, `${endpoint}: must use that actor's private session`);
  };
  const request = async (endpoint, options = {}) => {
    const method = options.method || 'GET', instance = options.instance || 0, body = options.data;
    assert([0, 1].includes(instance));
    assert(options.signal, 'Every actual request retains the supplied cancellation signal');
    let wanted, data, status = method === 'POST' ? 201 : 200;
    if (endpoint === '/warehouses' && method === 'POST') { wanted = actors.admin; data = { id: 100 }; }
    else if (endpoint === '/warehouses/100/locations' && method === 'POST') {
      wanted = actors.admin; data = body.type === 'quarantine' ? reworkLocation : sourceLocation;
    } else if (endpoint === '/warehouses/stock-balances' && method === 'POST') {
      wanted = actors.admin; data = rawStock;
    } else if (endpoint === '/production/boms' && method === 'POST') {
      wanted = expected.research; data = { id: body.materialId === fg.id ? 401 : 402,
        createdBy: wanted.id, qualityCharacteristics: [{ id: body.materialId === fg.id ? 411 : 412 }] };
    } else if (endpoint === '/production/work-orders' && method === 'POST') {
      wanted = injected || body.bomId === 401 ? expected.planner : actors.stock1;
      data = body.bomId === 401 ? workOrder : downstream;
    } else if (/^\/production\/work-orders\/(501|502)\/status$/.test(endpoint) && method === 'PATCH') {
      const isOriginal = endpoint.includes('/501/');
      wanted = expected.operators[isOriginal ? 0 : 1];
      if (body.status === 'completed' && isOriginal) {
        assert.equal(body.consumptionRecords[0].stockBalanceId, rawStock.id);
        assert.equal(body.consumptionRecords[0].quantity, 10);
        state.completed = true; data = { ...workOrder, status: 'completed', productBatch: productBatch() };
      } else if (body.status === 'completed') {
        assert.equal(instance, 1); assert.equal(body.consumptionRecords[0].stockBalanceId, 702);
        status = 409; data = null;
      } else { assert.equal(body.status, 'qc_pending'); data = { status: body.status }; }
    } else if (/^\/production\/work-orders\/(501|502)\/checks$/.test(endpoint) && method === 'POST') {
      wanted = injected || endpoint.includes('/501/') ? expected.qc : actors.stock1;
      data = { id: endpoint.includes('/501/') ? 901 : 902, inspectorUserId: wanted.id, result: 'pass' };
    } else if (/^\/production\/work-orders\/(501|502)\/checks\/(901|902)\/review$/.test(endpoint) && method === 'POST') {
      wanted = expected.qa; data = { reviewedByUserId: wanted.id, decision: 'release' };
    } else if (endpoint === '/production/work-orders/501/dispositions' && method === 'POST') {
      assert(state.completed, 'Disposition must follow the actual completed fixture output');
      wanted = expected.operators[instance === 1 ? 1 : 0];
      if (body.type === 'scrap') {
        if (!body.stockBalanceId || body.stockBalanceId === rawStock.id) { status = 400; data = null; }
        else if (body.quantity !== 3) { assert.equal(instance, 1); status = 409; data = null; }
        else { assert.equal(body.stockBalanceId, 701); status = state.scrapped ? 200 : 201; state.scrapped = true; data = scrap(); }
      } else {
        assert.equal(body.type, 'rework_return');
        if (!body.sourceDispositionId) { status = 400; data = null; }
        else if (body.quantity !== 2) { assert.equal(body.quantity, 4); status = 409; data = null; }
        else { assert.equal(body.sourceDispositionId, 801); assert.equal(body.destinationLocationId, 102);
          status = state.reworked ? 200 : 201; state.reworked = true; data = rework(); }
      }
    } else if (endpoint === '/production/work-orders' && method === 'GET') {
      wanted = expected.operators[0]; data = [{ ...workOrder, status: 'completed', productBatch: productBatch() }, downstream];
    } else if (endpoint.startsWith('/warehouses/stock-balances?') && method === 'GET') {
      wanted = expected.warehouse;
      data = endpoint.includes('SYN-RW-602') ? [returnedStock()] : [outputStock()];
    } else if (endpoint === '/production/work-orders/501/dispositions' && method === 'GET') {
      wanted = expected.operators[0]; data = dispositions();
    } else if (/^\/production\/batches\/(601|602)\/cost-ledger\?page=1&pageSize=100$/.test(endpoint) && method === 'GET') {
      wanted = expected.cost;
      const batchId = Number(endpoint.match(/batches\/(\d+)/)[1]);
      data = costResponse(batchId);
      if (instance === 1 && batchId === 601 && fault) fault(data);
    } else throw new Error(`Unexpected synthetic producer request ${method} ${endpoint}`);
    expectActor(options.actor || actors.admin, wanted, endpoint);
    const response = { status, ok: status < 400, json: { success: status < 400, data: jsonCopy(data) } };
    calls.push({ actorId: wanted.id, role: wanted.role, instance, method, path: endpoint,
      sent: body === undefined ? null : jsonCopy(body), status, json: clone(response.json) });
    return response;
  };
  const prisma = {
    productionWorkOrder: { findUniqueOrThrow: async ({ where }) => {
      assert.equal(where.id, 501); assert(state.completed);
      return clone({ ...workOrder, status: 'completed', batchId: 601, productBatch: productBatch() });
    } },
    productBatch: { findUniqueOrThrow: async ({ where }) => {
      assert([601, 602].includes(where.id));
      if (where.id === 602) assert(state.reworked);
      return clone(where.id === 601 ? productBatch() : returnedBatch());
    } },
    stockBalance: {
      findFirstOrThrow: async () => { assert(state.completed); return clone(outputStock()); },
      findUniqueOrThrow: async ({ where }) => {
        assert([701, 702].includes(where.id));
        if (where.id === 702) assert(state.reworked);
        return clone(where.id === 701 ? outputStock() : returnedStock());
      },
    },
    inventoryCostLedger: { findMany: async ({ where, orderBy }) => {
      assert.equal(orderBy.id, 'asc'); assert([601, 602].includes(where.batchId));
      return clone(where.batchId === 601 ? originalCosts() : returnedCosts());
    } },
    productionDisposition: { findMany: async ({ where }) => {
      assert.equal(where.workOrderId, 501); return clone(dispositions());
    } },
    auditLog: { findMany: async () => clone(audits()) },
    stockEntry: { findMany: async () => clone(entries()) },
  };
  const ctx = { request, dataOf(response) { assert(response.status < 400); return response.json.data; },
    actors, prisma, runId: 'synthetic-production-actors',
    ensureReleasedMaterial: async ({ code }) => clone(code.endsWith('-raw') ? raw : code.endsWith('-fg') ? fg : final),
    ...(injected ? { productionActors } : {}),
  };
  return { ctx, calls, productionActors, state };
}

test('actual disposition producer uses explicit production jobs through scrap, rework, isolation and dual-node cost readback', async () => {
  const f = fixture();
  const evidence = await loadProducer()(f.ctx, AbortSignal.timeout(5000));
  assert(f.state.completed && f.state.scrapped && f.state.reworked);
  assert.equal(evidence.case.afterRework.quarantinedIssue.status, 409);
  assert.equal(evidence.case.afterRework.inventoryCost, 90);
  assert.equal(evidence.case.afterRework.netLossCost, 10);
  const costCalls = f.calls.filter(item => item.path.includes('/cost-ledger?'));
  assert.equal(costCalls.length, 4, 'Cost accountant must read both actual batches on both nodes');
  assert.deepEqual(costCalls.map(item => `${item.instance}:${item.path.match(/batches\/(\d+)/)[1]}`).sort(),
    ['0:601', '0:602', '1:601', '1:602']);
  assert.equal(evidence.costReadbacks.length, 4);
  for (const row of evidence.costReadbacks) {
    assert.equal(row.actorId, f.productionActors.cost.id);
    assert.equal(row.status, 200);
    const call = costCalls.find(item => item.instance === row.instance && item.path === row.path);
    assert(call, 'Every cost readback must be the actual captured HTTP response');
    assert.deepEqual(jsonCopy(row.json), call.json);
    assert.equal(row.rawRows.length, row.batchId === 601 ? 2 : 1);
    assert.deepEqual(jsonCopy(row.rawRows.map(item => item.id).sort()), jsonCopy(row.json.data.items.map(item => item.id).sort()));
  }
  const project = item => ({ id: item.id, role: item.role });
  assert.deepEqual(jsonCopy(evidence.productionActors), {
    research: project(f.productionActors.research), planner: project(f.productionActors.planner),
    operators: f.productionActors.operators.map(project), qc: project(f.productionActors.qc),
    qa: project(f.productionActors.qa), cost: project(f.productionActors.cost), warehouse: project(f.productionActors.warehouse),
  });
  assert.deepEqual(jsonCopy(evidence.roleActions), jsonCopy(f.calls), 'Do not replace real HTTP facts with role labels');
});

test('actual disposition producer retains the legacy actor contract when no production job bundle is supplied', async () => {
  const f = fixture({ injected: false });
  const evidence = await loadProducer()(f.ctx, AbortSignal.timeout(5000));
  assert.equal(evidence.case.afterRework.inventoryQuantity, 9);
  assert.equal(evidence.case.afterRework.netLossQuantity, 1);
  assert(f.calls.some(item => item.actorId === f.ctx.actors.stock1.id && item.status === 409));
  assert(f.calls.some(item => item.actorId === f.ctx.actors.buyer1.id && item.path.endsWith('/review')));
});

for (const [label, mutate] of [
  ['missing persisted row', data => { data.items.pop(); }],
  ['duplicated persisted row', data => { data.items.push(clone(data.items[0])); }],
  ['row quantity drift', data => { data.items[0].quantityAfter += 1; }],
  ['row cost drift', data => { data.items[0].costAmountDelta += 1; }],
  ['summary quantity drift', data => { data.summary.currentQuantity += 1; }],
  ['summary cost drift', data => { data.summary.currentCostAmount += 1; }],
  ['summary unit-cost drift', data => { data.summary.currentUnitCost += 1; }],
  ['wrong batch', data => { data.batch.id = 602; }],
  ['wrong saved actor', data => { data.items[0].createdBy = 999; }],
  ['truncated pagination', data => { data.meta.total += 1; data.meta.totalPages = 2; }],
]) test(`actual cost accountant readback rejects secondary-node ${label}`, async () => {
  const f = fixture({ fault: mutate });
  await assert.rejects(loadProducer()(f.ctx, AbortSignal.timeout(5000)), error => {
    assert.match(error.message, /cost.*ledger|ledger.*cost/i,
      'A semantic ledger mismatch must fail at the actual ledger comparison, not an unrelated role/API denial');
    assert(error.evidence, 'The producer retains the failed raw business evidence');
    assert(f.calls.some(item => item.instance === 1 && item.path.includes('/601/cost-ledger?')));
    return true;
  });
});
