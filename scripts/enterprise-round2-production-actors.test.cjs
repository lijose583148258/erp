const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const copy = value => JSON.parse(JSON.stringify(value));
const actor = (id, role) => ({ id, role, token: `synthetic-token-${id}`, job: role });
const actors = { admin: actor(1, 'admin'), stock0: actor(2, 'warehouse'), stock1: actor(3, 'warehouse'), buyer1: actor(4, 'manager') };
const people = { research: actor(11, 'research'), planner: actor(12, 'planner'), operators: [actor(13, 'operator1'), actor(14, 'operator2')],
  qc: actor(15, 'qc'), qa: actor(16, 'qa'), cost: actor(17, 'cost'), warehouse: actor(18, 'physical-warehouse') };
const dataOf = response => { assert([200, 201].includes(response.status), JSON.stringify(response)); return response.json.data; };
const ok = (data, status = 200) => ({ status, json: { data: copy(data) } });

function load(name, dependencies = {}) {
  const file = path.join(__dirname, 'lib', name), module = { exports: {} }, actualRequire = createRequire(file);
  const realmAssert = Object.assign((...args) => assert(...args), assert, {
    deepEqual: (actual, expected, message) => assert.deepEqual(copy(actual), copy(expected), message),
  });
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, __dirname: path.dirname(file),
    process: { env: {} }, require: key => key === 'node:assert/strict' ? realmAssert : dependencies[key] || actualRequire(key), Date, AbortSignal, URL, Buffer }, { filename: file });
  return module.exports;
}

function bomHarness(injected = true) {
  let nextBom = 100, nextOrder = 200, nextRun = 300;
  const calls = [], boms = new Map(), orders = new Map(), runs = new Map();
  const p = injected ? people : { research: actors.admin, planner: actors.stock0, operators: [actors.stock0, actors.stock1], qc: actors.stock0, qa: actors.buyer1 };
  const stock = { id: 50, quantity: 100 };
  const requireActor = (options, expected) => assert.equal((options.actor || actors.admin).id, expected.id, `${options.method || 'GET'} ${options.path}: wrong production actor`);
  const request = async (endpoint, options = {}) => {
    const method = options.method || 'GET', data = options.data, id = Number(endpoint.split('/')[3]);
    calls.push({ path: endpoint, method, actorId: (options.actor || actors.admin).id, instance: options.instance || 0 });
    const opts = { ...options, path: endpoint };
    if (endpoint === '/warehouses') { requireActor(opts, actors.admin); return ok([{ locations: [{ id: 7, code: 'LOC-FG' }] }]); }
    if (endpoint === '/warehouses/stock-balances') { requireActor(opts, actors.admin); return ok(stock, 201); }
    if (endpoint === '/production/boms') {
      requireActor(opts, p.research);
      const bom = { ...copy(data), id: nextBom++, bomNo: `BOM-${nextBom}`, createdBy: p.research.id,
        items: data.items.map(item => ({ ...item, id: nextBom * 10 })), qualityCharacteristics: data.qualityCharacteristics.map(item => ({ ...item, id: nextBom * 100 })) };
      boms.set(bom.id, bom); return ok(bom, 201);
    }
    if (endpoint === '/production/work-orders' && method === 'POST') {
      requireActor(opts, p.planner);
      const wo = { ...copy(data), id: nextOrder++, workOrderNo: `WO-${nextOrder}`, status: 'planned', createdBy: p.planner.id, bom: boms.get(data.bomId), qualityChecks: [] };
      orders.set(wo.id, wo); return ok(wo, 201);
    }
    if (endpoint === '/production/work-orders') { requireActor(opts, p.operators[0]); return ok([...orders.values()]); }
    if (endpoint.endsWith('/preview-consumption')) { requireActor(opts, p.operators[0]); return ok([{ requiredQty: boms.get(orders.get(id).bomId).items[0].quantityPerUnit * 10 }]); }
    if (endpoint.endsWith('/status')) {
      requireActor(opts, data.status === 'cancelled' ? p.planner : p.operators[0]);
      if (data.consumptionRecords?.[0].quantity === 20) return { status: 409, json: { message: 'wrong frozen recipe' } };
      const wo = orders.get(id); wo.status = data.status;
      if (data.status === 'completed') { stock.quantity = 90; wo.productBatch = { id: 800, stockQuantity: 10 }; wo.genealogyEdges = [{ quantityConsumed: 10 }]; }
      return ok(wo);
    }
    if (endpoint.endsWith('/checks')) {
      requireActor(opts, p.qc); const wo = orders.get(id), spec = boms.get(wo.bomId).qualityCharacteristics[0];
      const qc = { id: 400 + id, inspectorUserId: p.qc.id, result: Number(spec.lowerLimit) <= 1.5 ? 'pass' : 'fail', measurements: [{ lowerLimit: spec.lowerLimit, upperLimit: spec.upperLimit }] };
      wo.qualityChecks.push(qc); return ok(qc, 201);
    }
    if (endpoint.endsWith('/review')) { requireActor(opts, p.qa); return ok({ id: 1, reviewedByUserId: p.qa.id }); }
    requireActor(opts, actors.admin);
    if (endpoint.startsWith('/materials/governance/backfill-candidates')) return ok({ items: [...boms.values()].filter(b => !b.items[0].materialId).map(b => ({ source: { id: b.id, materialName: b.items[0].materialName }, occurrenceCount: 1, expectedFingerprint: 'synthetic-source' })) });
    if (endpoint === '/materials/governance/backfill') {
      if (data.mappings.some(m => [...orders.values()].some(w => w.bomId === m.source.id))) return { status: 409, json: { message: '冻结' } };
      const originals = data.mappings.map(m => copy(boms.get(m.source.id))), run = { id: nextRun++, originals };
      for (const m of data.mappings) boms.get(m.source.id).items[0].materialId = m.materialId;
      runs.set(run.id, run); return ok({ run }, 201);
    }
    if (endpoint.endsWith('/rollback')) {
      const run = runs.get(Number(endpoint.split('/')[4]));
      if (run.originals.some(b => [...orders.values()].some(w => w.bomId === b.id))) return { status: 409, json: { message: '冻结' } };
      for (const bom of run.originals) boms.set(bom.id, copy(bom)); return ok({ run });
    }
    throw new Error(`Unexpected synthetic request ${method} ${endpoint}`);
  };
  const prisma = { productionBom: { findUnique: async ({ where }) => copy(boms.get(where.id)) }, productionWorkOrder: { findUnique: async ({ where }) => copy(orders.get(where.id)) },
    stockBalance: { findUnique: async () => copy(stock) }, inventoryCostLedger: { findMany: async () => [{ id: 1, costAmountDelta: -100 }, { id: 2, costAmountDelta: 100 }] },
    materialGovernanceRun: { findUnique: async ({ where }) => copy(runs.get(where.id)) }, auditLog: { count: async () => 0 } };
  const extras = Object.fromEntries(['material-unit', 'packaging', 'mass-conversion', 'unit-safety'].map(name => [`./enterprise-round2-${name}.cjs`, new Proxy({}, { get: () => async () => ({ syntheticLegacySupplement: true }) })]));
  const probe = load('enterprise-round2-bom-freeze.cjs', extras).bomFreezeProbe;
  return { calls, run: () => probe({ request, dataOf, actors, prisma, runId: 'synthetic-bom-roles', productionActors: injected ? people : undefined,
    ensureReleasedMaterial: async ({ category }) => ({ id: category === 'raw_material' ? 21 : 22, nameZh: category }) }, AbortSignal.timeout(5000)) };
}

for (const injected of [true, false]) test(`BOM actual API role delegation, cancellation and first-order/governance races (injected=${injected})`, async () => {
  const h = bomHarness(injected), evidence = await h.run();
  assert.equal(evidence.cases.length, 6);
  assert.equal(h.calls.filter(c => c.path === '/production/work-orders' && c.method === 'POST').length, 8);
  assert.equal(h.calls.filter(c => c.path.endsWith('/review')).length, 1);
  if (injected) {
    assert(evidence.roleActions.some(c => c.actorId === people.planner.id && c.sent?.status === 'cancelled'));
    assert(evidence.roleActions.filter(c => c.path.startsWith('/materials/governance')).every(c => c.actorId === actors.admin.id));
    assert(evidence.roleActions.some(c => c.actorId === people.operators[0].id && c.status === 409 && c.sent?.status === 'completed'));
    assert(!JSON.stringify(evidence).includes('synthetic-token-'));
  }
});

function lotHarness(injected = true) {
  const p = injected ? people : { research: actors.admin, operators: [actors.stock0, actors.stock1], qa: actors.buyer1, warehouse: actors.admin };
  let sequence = 100, current;
  const calls = [], planned = [];
  const ledger = (deltas, identity = 0) => {
    let quantity = 0, cost = 0;
    return deltas.map((delta, index) => { const row = { id: identity * 100 + index + 1, quantityBefore: quantity, costBefore: cost, quantityDelta: delta, costAmountDelta: delta * 10 };
      quantity += delta; cost += delta * 10; return { ...row, quantityAfter: quantity, costAfter: cost }; });
  };
  const view = () => {
    const { quantity: q, split, completed, replenished, raw, fg, stocks, batchNo, orders } = current;
    const rawBatch = { id: raw.id * 10, materialId: raw.id, batchNo, stockQuantity: 100 + (replenished ? 20 : 0) - completed.size * q };
    const workOrders = orders.map((wo, index) => ({ ...wo, status: completed.has(index) ? 'completed' : 'qc_pending',
      batchId: completed.has(index) ? wo.id * 10 : null,
      productBatch: completed.has(index) ? { id: wo.id * 10, materialId: fg.id, batchNo: `OUT-${wo.id}`, stockQuantity: q, qualityStatus: 'released' } : null,
      genealogyEdges: completed.has(index) ? [{ id: wo.id * 100, inputBatchNo: batchNo, inputMaterialId: raw.id, quantityConsumed: q, outputBatchId: wo.id * 10 }] : [] }));
    const balances = stocks.map((stock, index) => ({ ...stock, quantity: split ? 50 - (completed.has(index) ? q : 0) : rawBatch.stockQuantity }));
    const rawMovements = stocks.flatMap((stock, index) => ledger([split ? 50 : 100,
      ...[...completed].filter(i => !split || i === index).flatMap((i, n) => [...(!split && replenished && n === 1 ? [20] : []), -q])], stock.id).map(row => ({ ...row, stockBalanceId: stock.id })));
    const rawCosts = ledger([100, ...[...completed].flatMap((i, index) => [...(replenished && index === 1 ? [20] : []), -q])], rawBatch.id);
    const outputs = workOrders.filter(wo => wo.status === 'completed');
    return { rawBatch, workOrders, balances, rawMovements, rawCosts,
      outputBalances: outputs.map(wo => ({ id: wo.id, batchNo: wo.productBatch.batchNo, quantity: q })),
      outputMovements: outputs.map(wo => ({ id: wo.id, batchNo: wo.productBatch.batchNo, quantityBefore: 0, quantityDelta: q, quantityAfter: q })),
      workOrderCosts: outputs.flatMap(wo => [{ id: wo.id * 1000, batchId: rawBatch.id, workOrderId: wo.id, quantityDelta: -q, costAmountDelta: -q * 10 },
        ...ledger([q]).map(row => ({ ...row, id: wo.id * 1000 + 1, batchId: wo.batchId, workOrderId: wo.id }))]),
      entries: outputs.flatMap(wo => ['production_consumption', 'production_output'].map((sourceType, index) => ({ id: wo.id * 10000 + index, sourceRef: wo.workOrderNo, sourceType }))),
      statusAudits: outputs.map(wo => ({ id: wo.id, resourceId: wo.id, userId: p.operators[orders.findIndex(item => item.id === wo.id)].id, details: JSON.stringify({ status: 'completed' }) })) };
  };
  const request = async (endpoint, options = {}) => {
    const method = options.method || 'GET', data = options.data, actual = options.actor || actors.admin;
    const expected = person => assert.equal(actual.id, person.id, `${method} ${endpoint}: wrong production actor`);
    let result;
    if (endpoint === '/warehouses' || /\/warehouses\/\d+\/locations$/.test(endpoint)) { expected(actors.admin); result = ok({ id: ++sequence }, 201); }
    else if (endpoint === '/warehouses/stock-balances') {
      expected(data.quantity === 20 ? p.warehouse : actors.admin);
      if (data.quantity === 20) current.replenished = true;
      const stock = { ...data, id: ++sequence }; if (data.quantity !== 20) current.stocks.push(stock); result = ok(stock, 201);
    } else if (endpoint === '/production/boms') { expected(p.research); result = ok({ id: ++sequence, qualityCharacteristics: [{ id: 9 }] }, 201); }
    else if (endpoint === '/production/work-orders' && method === 'POST') {
      expected(injected ? p.planner : p.operators[current.orders.length]);
      const wo = { ...copy(data), id: ++sequence, workOrderNo: `LOT-WO-${sequence}` }; current.orders.push(wo); planned.push(wo); result = ok(wo, 201);
    } else if (endpoint === '/production/work-orders') { expected(p.operators[0]); result = ok(view().workOrders); }
    else if (endpoint.startsWith('/warehouses/stock-balances?')) { expected(injected ? p.warehouse : actors.stock0); result = ok(view().balances); }
    else {
      const index = current.orders.findIndex(wo => wo.id === Number(endpoint.split('/')[3])); assert(index >= 0);
      if (endpoint.endsWith('/status')) {
        expected(p.operators[index]);
        if (data.status === 'completed') {
          assert.equal(options.instance, index, 'Concurrent execution must preserve each operator/node binding');
          if (current.quantity === 60 && index === 1 && !current.replenished) result = { status: 409, json: { message: 'synthetic actual shortage' } };
          else { current.completed.add(index); result = ok({ id: current.orders[index].id }); }
        } else result = ok({ id: current.orders[index].id });
      } else if (endpoint.endsWith('/checks')) { expected(injected ? p.qc : p.operators[index]); result = ok({ id: ++sequence }, 201); }
      else if (endpoint.endsWith('/review')) { expected(p.qa); result = ok({ id: ++sequence }); }
      else throw new Error(`Unexpected synthetic request ${endpoint}`);
    }
    calls.push({ actorId: actual.id, role: actual.role, instance: options.instance || 0, method, path: endpoint, sent: data ?? null, status: result.status, json: copy(result.json) });
    return result;
  };
  // The fixture answers persisted reads from fixed expected scenario stages;
  // real stock arithmetic/concurrency is covered by the existing full runner.
  const prisma = { productBatch: { findUnique: async () => copy(view().rawBatch) },
    productionWorkOrder: { findMany: async () => copy(view().workOrders) },
    stockBalance: { findMany: async ({ where }) => copy(where.materialId === current.raw.id ? view().balances : view().outputBalances) },
    stockMovement: { findMany: async ({ where }) => copy(where.materialId === current.raw.id ? view().rawMovements : view().outputMovements) },
    inventoryCostLedger: { findMany: async ({ where }) => copy(where.batchId ? view().rawCosts : view().workOrderCosts) },
    stockEntry: { findMany: async () => copy(view().entries) }, auditLog: { findMany: async () => copy(view().statusAudits) } };
  const ensureReleasedMaterial = async ({ code, category }) => {
    const material = { id: ++sequence, nameZh: code };
    if (category === 'raw_material') current = { raw: material, stocks: [], orders: [], completed: new Set(), replenished: false,
      quantity: code.includes('shortage') ? 60 : code.includes('sufficient') ? 40 : 50, split: code.includes('split-location'), batchNo: code.replace(/-raw$/, '-lot') };
    else current.fg = material;
    return material;
  };
  const probe = load('enterprise-round2-production-lot.cjs').productionLotProbe;
  return { calls, planned, run: () => probe({ request, dataOf, actors, prisma, runId: 'synthetic-lot-roles', ensureReleasedMaterial,
    ...(injected ? { productionActors: people } : {}) }, AbortSignal.timeout(5000)) };
}

for (const injected of [true, false]) test(`actual lot producer preserves two operators, independent QC/QA and physical replenishment (injected=${injected})`, async () => {
  const h = lotHarness(injected), evidence = await h.run();
  assert.equal(evidence.cases.length, 3); assert.equal(evidence.violations.length, 0);
  assert.equal(h.planned.length, 6);
  const replenishment = h.calls.filter(call => call.path === '/warehouses/stock-balances' && call.sent.quantity === 20);
  assert.equal(replenishment.length, 1); assert.equal(replenishment[0].actorId, injected ? people.warehouse.id : actors.admin.id);
  const completions = h.calls.filter(call => call.sent?.status === 'completed');
  assert.equal(completions.length, 14);
  for (const call of completions) assert.equal(call.actorId, (injected ? people.operators : [actors.stock0, actors.stock1])[call.instance].id);
  if (injected) assert.deepEqual(copy(evidence.roleActions), copy(h.calls));
});

// Narrow source-gate contracts only: execute real genealogy API assertions,
// then stop at the browser-launch boundary. No fake DOM can pass a UI check.
function genealogyHarness({ injected = true, mutateTrace, mutateProfile, denialStatus = 403 } = {}) {
  const calls = [], sentinel = new Error('synthetic-genealogy-browser-boundary');
  let launches = 0;
  const profile = { id: people.operators[1].id, username: 'synthetic-production-operator-2', role: people.operators[1].role,
    segment: 'mixed', isActive: true, mustChangePassword: false,
    permissions: ['production.read', 'production.execute', 'warehouse.read', 'materials.read'], dataScopes: ['warehouse_visible'] };
  const reader = { ...people.operators[1], profile: copy(profile), profilesByInstance: [copy(profile), copy(profile)] };
  const duties = { ...people, operators: [people.operators[0], reader] };
  const cases = ['shortage', 'sufficient', 'split-location'].map((name, index) => {
    const base = (index + 1) * 1000, consumed = [60, 40, 50][index];
    const rawBatch = { id: base + 1, materialId: base + 20, batchNo: `RAW-${index}`, productName: `Raw ${index}`,
      stockQuantity: [0, 20, 0][index], unit: 'kg', productionDate: null, expiryDate: null };
    const workOrders = [0, 1].map(operator => {
      const productBatch = { id: base + 2 + operator, materialId: base + 30, batchNo: `OUT-${index}-${operator}`,
        productName: `Output ${index}`, stockQuantity: consumed, unit: 'kg', productionDate: null, expiryDate: null };
      const wo = { id: base + 10 + operator, workOrderNo: `WO-${index}-${operator}`, status: 'completed', batchId: productBatch.id, productBatch };
      wo.genealogyEdges = [{ id: base + 60 + operator, inputMaterialId: rawBatch.materialId, inputBatchNo: rawBatch.batchNo,
        inputStockBalanceId: base + 50 + (name === 'split-location' ? operator : 0), inputProductName: rawBatch.productName,
        quantityConsumed: consumed, inputUnit: 'kg', outputBatchId: productBatch.id, outputMaterialId: productBatch.materialId,
        outputBatchNo: productBatch.batchNo, outputProductName: productBatch.productName, outputQuantity: consumed, workOrderId: wo.id }];
      return wo;
    });
    return { scenario: { name }, final: { rawBatch, workOrders } };
  });
  const lotEvidence = { cases, violations: [] };
  const request = async (endpoint, options = {}) => {
    const actual = options.actor || actors.admin, instance = options.instance || 0;
    const call = { path: endpoint, instance, actorId: actual.id, role: actual.role, method: options.method || 'GET' };
    calls.push(call);
    if (endpoint === '/auth/me') {
      const value = copy(profile); mutateProfile?.(value, instance);
      return ok(value);
    }
    if (['/assets/balance', '/assets/history', '/assets/batches'].includes(endpoint)) {
      call.status = denialStatus;
      return { status: denialStatus, json: { success: false, message: 'synthetic asset access denied' } };
    }
    const match = /^\/production\/batches\/(\d+)\/trace$/.exec(endpoint);
    assert(match, `Unexpected genealogy API request ${endpoint}`);
    const batchId = Number(match[1]);
    const item = cases.find(entry => [entry.final.rawBatch.id, ...entry.final.workOrders.map(wo => wo.batchId)].includes(batchId));
    assert(item, `Unknown fixture batch ${batchId}`);
    const state = item.final, isRaw = batchId === state.rawBatch.id;
    const batch = isRaw ? state.rawBatch : state.workOrders.find(wo => wo.batchId === batchId).productBatch;
    const edges = state.workOrders.filter(wo => isRaw || wo.batchId === batchId).flatMap(wo => wo.genealogyEdges.map(edge => ({
      ...copy(edge), workOrder: { id: wo.id, workOrderNo: wo.workOrderNo, status: wo.status },
      ...(isRaw ? { outputBatch: copy(wo.productBatch) } : {}),
    })));
    const trace = { scope: 'direct-one-hop', batch: copy(batch), upstreamInputs: isRaw ? [] : edges,
      downstreamOutputs: isRaw ? edges : [], downstreamShipments: [],
      summary: { upstreamLotCount: isRaw ? 0 : 1, downstreamBatchCount: isRaw ? 2 : 0, shipmentCount: 0, customerCount: 0 } };
    mutateTrace?.(trace, { instance, isRaw, state });
    return ok(trace);
  };
  const probe = load('enterprise-round2-production-lot.cjs', {
    'playwright/test': { expect: () => { throw new Error('Synthetic API contract must not assert a DOM'); } },
    './browser-launch-guard.cjs': { launchBrowserWithGuard: async () => { launches++; throw sentinel; } },
    './browser-cjk-font-guard.cjs': { verifyRenderedCjk: () => { throw new Error('Synthetic API contract must not inspect rendered fonts'); } },
    'node:fs': { mkdirSync: () => { throw new Error('Synthetic API contract must not write browser evidence'); } },
  }).genealogyReadback;
  return { calls, profile, reader, sentinel, get launches() { return launches; }, run: () => probe({ request, dataOf, actors,
    ...(injected ? { productionActors: duties } : {}) }, lotEvidence, AbortSignal.timeout(5000)) };
}

for (const injected of [true, false]) test(`genealogy API binds all 18 persisted readbacks before a real browser boundary (injected=${injected})`, async () => {
  const h = genealogyHarness({ injected });
  let evidence;
  await assert.rejects(h.run(), error => { assert.equal(error, h.sentinel); evidence = error.evidence; return true; });
  assert.equal(h.launches, 1);
  const traceCalls = h.calls.filter(call => call.path.endsWith('/trace'));
  assert.equal(traceCalls.length, 18);
  const expected = injected ? h.reader : actors.stock0;
  assert(traceCalls.every(call => call.actorId === expected.id && call.role === expected.role && call.method === 'GET'));
  for (const instance of [0, 1]) assert.equal(traceCalls.filter(call => call.instance === instance).length, 9);
  assert.equal(evidence.api.length, 18);
  if (injected) {
    assert(evidence.api.every(row => row.actorId === expected.id && row.role === expected.role));
    assert.equal(evidence.productionActor.actorId, expected.id); assert.equal(evidence.productionActor.role, expected.role);
    assert.deepEqual(copy(evidence.productionActor.profiles).map(row => row.instance).sort(), [0, 1]);
    for (const row of evidence.productionActor.profiles) assert.deepEqual(copy(row.profile), h.profile);
    assert.deepEqual(h.calls.filter(call => call.path === '/auth/me').map(call => call.instance).sort(), [0, 1]);
    assert(h.calls.every(call => call.actorId === expected.id && call.role === expected.role && call.method === 'GET'));
    assert.deepEqual(copy(evidence.productionActor.assetRequests), []);
    assert.equal(evidence.productionActor.assetDenials.length, 3);
    for (const row of evidence.productionActor.assetDenials) {
      assert.equal(row.actorId, expected.id); assert.equal(row.instance, 1); assert.equal(row.status, 403);
    }
    assert.deepEqual(copy(evidence.productionActor.assetDenials.map(row => row.path)).sort(), ['/assets/balance', '/assets/batches', '/assets/history']);
  } else {
    assert.equal(evidence.productionActor, undefined);
    assert.equal(h.calls.length, 18, 'Legacy mode must retain its original role and API surface');
  }
  assert(!JSON.stringify(evidence).includes('synthetic-token-'), 'Private actor credentials must not enter genealogy evidence');
  assert(!/"(?:token|password|authorization)"\s*:/i.test(JSON.stringify(evidence)), 'Genealogy evidence must contain no credential properties');
});

const corruptGenealogy = [
  ...['id', 'materialId', 'batchNo', 'stockQuantity', 'unit'].map(field => [`batch ${field}`, trace => {
    trace.batch[field] = typeof trace.batch[field] === 'number' ? trace.batch[field] + 1 : `wrong-${trace.batch[field]}`;
  }]),
  ...['id', 'inputMaterialId', 'inputBatchNo', 'inputStockBalanceId', 'quantityConsumed', 'inputUnit', 'outputBatchId', 'outputMaterialId', 'outputBatchNo', 'outputQuantity', 'workOrderId'].map(field => [`edge ${field}`, trace => {
    const edge = trace.downstreamOutputs[0] || trace.upstreamInputs[0];
    edge[field] = typeof edge[field] === 'number' ? edge[field] + 1 : `wrong-${edge[field]}`;
  }]),
  ['missing sibling downstream edge', (trace, { isRaw }) => { if (isRaw) trace.downstreamOutputs.pop(); }],
  ['duplicate downstream edge', (trace, { isRaw }) => { if (isRaw) trace.downstreamOutputs.push(copy(trace.downstreamOutputs[0])); }],
  ['wrong nested work-order id', trace => { (trace.downstreamOutputs[0] || trace.upstreamInputs[0]).workOrder.id++; }],
  ['wrong nested work-order number', trace => { (trace.downstreamOutputs[0] || trace.upstreamInputs[0]).workOrder.workOrderNo = 'OTHER-WO'; }],
  ['non-completed work order', trace => { (trace.downstreamOutputs[0] || trace.upstreamInputs[0]).workOrder.status = 'qc_pending'; }],
  ['extra reverse-direction edge', (trace, { isRaw }) => {
    (isRaw ? trace.upstreamInputs : trace.downstreamOutputs).push(copy((isRaw ? trace.downstreamOutputs : trace.upstreamInputs)[0]));
  }],
  ['unexpected downstream shipment', trace => { trace.downstreamShipments.push({ id: 999 }); }],
  ['incorrect summary counts', trace => { trace.summary.customerCount = 1; }],
  ['node-one batch divergence', (trace, { instance }) => { if (instance === 1) trace.batch.stockQuantity++; }],
  ['node-one otherwise matching trace divergence', (trace, { instance }) => { if (instance === 1) trace.batch.productName = 'Different node product'; }],
];
for (const [name, mutateTrace] of corruptGenealogy) test(`genealogy API rejects ${name} before browser launch`, async () => {
  const h = genealogyHarness({ mutateTrace });
  await assert.rejects(h.run(), error => { assert.notEqual(error, h.sentinel, 'Corrupt persisted readback reached the browser boundary'); return true; });
  assert.equal(h.launches, 0);
});

for (const [name, mutateProfile] of [
  ['identity', value => { value.id++; }], ['role', value => { value.role = 'admin'; }],
  ['inactive account', value => { value.isActive = false; }], ['forced password change', value => { value.mustChangePassword = true; }],
  ['missing active-account fact', value => { delete value.isActive; }], ['missing password-ready fact', value => { delete value.mustChangePassword; }],
  ['missing production permission', value => { value.permissions = value.permissions.filter(permission => permission !== 'production.read'); }],
  ['asset permission', value => { value.permissions.push('assets.read'); }], ['wildcard permission', value => { value.permissions.push('*'); }],
  ['all-record scope', value => { value.dataScopes.push('all'); }],
]) test(`genealogy API rejects current-policy ${name} drift before browser launch`, async () => {
  const h = genealogyHarness({ mutateProfile: (value, instance) => { if (instance === 1) mutateProfile(value); } });
  await assert.rejects(h.run(), error => { assert.notEqual(error, h.sentinel); return true; });
  assert.equal(h.launches, 0);
});
test('genealogy API refuses a newly allowed asset endpoint before browser launch', async () => {
  const h = genealogyHarness({ denialStatus: 200 });
  await assert.rejects(h.run(), error => { assert.notEqual(error, h.sentinel); return true; });
  assert.equal(h.launches, 0);
});
