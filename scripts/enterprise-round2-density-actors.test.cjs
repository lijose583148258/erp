const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const copy = value => JSON.parse(JSON.stringify(value));
const person = (id, role) => ({ id, role, token: `synthetic-private-${id}` });
const actors = { admin: person(1, 'admin'), stock0: person(2, 'warehouse'), stock1: person(3, 'warehouse'), buyer1: person(4, 'manager') };
const duties = { research: person(11, 'research'), planner: person(12, 'planner'), operators: [person(13, 'operator'), person(14, 'operator')], qc: person(15, 'qc'), qa: person(16, 'qa') };
const ok = (data, status = 200) => ({ status, json: { data: copy(data) } });
const dataOf = response => { assert([200, 201].includes(response.status), JSON.stringify(response)); return response.json.data; };

function load(browser = false) {
  const file = path.join(__dirname, 'lib', 'enterprise-round2-density-conversion.cjs');
  const module = { exports: {} }, actualRequire = createRequire(file), browserCalls = [];
  const realmAssert = Object.assign((...args) => assert(...args), assert, {
    deepEqual: (actual, expected, message) => assert.deepEqual(copy(actual), copy(expected), message),
  });
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, process: { env: browser ? { ROUND2_BROWSER: 'true' } : {} },
    require: key => key === 'node:assert/strict' ? realmAssert : key === './enterprise-round2-density-conversion-browser.cjs'
      ? { densityConversionBrowser: async (...args) => { browserCalls.push(args); return { legacyCalibrationSupplement: true }; } } : actualRequire(key) }, { filename: file });
  return { ...module.exports, browserCalls };
}

function harness(injected, { browser = false, wrongActor, mutateRejected = false } = {}) {
  const p = injected ? { research: duties.research, planner: duties.planner, operator: duties.operators[0], qc: duties.qc, qa: duties.qa }
    : { research: actors.admin, planner: actors.stock0, operator: actors.stock0, qc: actors.stock0, qa: actors.buyer1 };
  const raw = { id: 21, nameZh: 'density raw' }, fg = { id: 22, nameZh: 'density output' };
  const calls = [], prefix = 'synthetic-density-density-conversion', batchNo = `${prefix}-lot`;
  const stock = { id: 51, materialId: raw.id, batchNo, quantity: 100 }, other = { id: 50, materialId: raw.id, quantity: 10 };
  const rawBatch = { id: 500, batchNo, materialId: raw.id, stockQuantity: 100 };
  let revision, bom, order, completed = false, retired = false, auditRows = [];
  const densitySnapshot = () => [{ revisionId: revision.id, batchNo, quantityPerUnit: 0.8 }];
  const output = () => ({ ...copy(order), status: completed ? 'completed' : 'qc_pending', batchId: completed ? 700 : null,
    productBatch: completed ? { id: 700, stockQuantity: 10, unit: 'kg' } : null,
    genealogyEdges: completed ? [{ quantityConsumed: 8, inputUnit: 'L' }] : [] });
  const ledger = deltas => {
    let quantity = 0, cost = 0;
    return deltas.map(([dq, dc], index) => { const row = { id: index + 1, quantityBefore: quantity, costBefore: cost, quantityDelta: dq, costAmountDelta: dc };
      quantity += dq; cost += dc; return { ...row, quantityAfter: quantity, costAfter: cost }; });
  };
  const costs = () => completed ? [{ id: 10, batchId: rawBatch.id, quantityDelta: -8, costAmountDelta: -120 },
    ...ledger([[10, 120]]).map(row => ({ ...row, id: 11, batchId: 700 }))] : [];
  const request = async (url, options = {}) => {
    const actual = options.actor || actors.admin, method = options.method || 'GET', data = options.data;
    const expected = expectedPerson => assert.equal(actual.id, expectedPerson.id, `${method} ${url} must execute as the authorized business role`);
    let response;
    if (url === '/warehouses') { expected(actors.admin); response = ok([{ locations: [{ id: 7, code: 'LOC-FG' }] }]); }
    else if (url === '/warehouses/stock-balances') { expected(actors.admin); response = ok(data.quantity === 100 ? stock : other, 201); }
    else if (url === `/materials/${raw.id}/densities`) {
      expected(actors.buyer1); revision = { ...copy(data), id: 101, updatedAt: 'density-v1' }; response = ok(revision, 201);
    } else if (url.endsWith('/approve')) { expected(actors.admin); response = ok({ ...revision, status: 'approved' }); }
    else if (url.endsWith('/retire')) { expected(actors.admin); retired = true; response = ok({ ...revision, status: 'retired' }); }
    else if (url === '/production/boms') {
      expected(p.research);
      if (method === 'GET') response = ok([bom]);
      else if (!data.items[0].densityRevisionId) response = { status: 400, json: { message: 'Missing density basis' } };
      else if (data.items[0].unit !== 'L') response = { status: 409, json: { message: 'Wrong volume unit' } };
      else {
        bom = { ...copy(data), id: 201, items: [{ ...copy(data.items[0]), quantityPerUnit: 0.8, densitySnapshotJson: JSON.stringify({ batchNo, densityKgPerL: '1.250000' }) }], qualityCharacteristics: [{ id: 301 }] };
        response = ok(bom, 201);
      }
    } else if (url === '/production/work-orders') {
      if (method === 'GET') { expected(p.operator); response = ok([output()]); }
      else if (retired) { expected(injected ? p.planner : actors.stock1); response = { status: 409, json: { message: 'Density basis retired' } }; }
      else { expected(p.planner); order = { ...copy(data), id: 401, workOrderNo: 'DENSITY-WO', densitySnapshotJson: JSON.stringify(densitySnapshot()) }; response = ok(order, 201); }
    } else if (url.endsWith('/checks')) { expected(p.qc); response = ok({ id: 601, inspectorUserId: actual.id }, 201); }
    else if (url.endsWith('/review')) { expected(p.qa); response = ok({ id: 601, reviewedByUserId: actual.id }); }
    else if (url.endsWith('/status')) {
      expected(p.operator);
      if (data.status !== 'completed') response = ok({ ...order, status: data.status });
      else {
        const records = data.consumptionRecords, use = records[0]?.densityUse;
        const valid = records.length === 1 && records[0].stockBalanceId === stock.id && records[0].quantity === 8
          && use?.densityRevisionId === revision.id && use.temperatureC === '20' && use.pressureKpaAbs === '101.325'
          && use.compositionReference === 'Synthetic exact composition; no extrapolation';
        if (!valid) {
          if (mutateRejected) stock.quantity--;
          response = { status: 409, json: { message: 'Exact frozen density conditions required' } };
        } else {
          if (!completed) {
            completed = true; stock.quantity = 92; rawBatch.stockQuantity = 92;
            auditRows = [{ id: 901, userId: actual.id, details: JSON.stringify({ status: 'completed', densityActualConditions: [{ stockBalanceId: stock.id, materialId: raw.id, batchNo,
              quantity: 8, densityRevisionId: revision.id, temperatureC: '20', pressureKpaAbs: '101.325', compositionReference: use.compositionReference }] }) }];
          }
          response = ok(output());
        }
      }
    } else if (url.startsWith('/warehouses/stock-balances?')) { expected(p.operator); response = ok([stock]); }
    else throw new Error(`Unexpected synthetic request ${method} ${url}`);
    calls.push({ actorId: actual.id, role: actual.role, instance: options.instance || 0, method, path: url, sent: copy(data ?? null), status: response.status, json: copy(response.json) });
    return response;
  };
  const prisma = { productionBom: { count: async () => bom ? 1 : 0 },
    productionWorkOrder: { findUniqueOrThrow: async () => output() },
    productBatch: { findUniqueOrThrow: async () => copy(rawBatch) }, stockBalance: { findUniqueOrThrow: async () => copy(stock), findMany: async () => completed ? [{ id: 701, quantity: 10 }] : [] },
    inventoryCostLedger: { findMany: async ({ where }) => where.batchId ? ledger(completed ? [[100, 1500], [-8, -120]] : [[100, 1500]]) : costs() },
    auditLog: { findMany: async () => copy(auditRows) } };
  const loaded = load(browser), ctx = { actors, request, dataOf, prisma, runId: 'synthetic-density', ensureReleasedMaterial: async ({ category }) => category === 'raw_material' ? raw : fg,
    ...(injected ? { productionActors: wrongActor ? { ...duties, [wrongActor]: actors.admin } : duties } : {}) };
  return { calls, ctx, browserCalls: loaded.browserCalls, run: () => loaded.densityConversionProbe(ctx, AbortSignal.timeout(5000)) };
}

for (const injected of [true, false]) test(`density actual probe delegates manufacturing but preserves separate density governance (injected=${injected})`, async () => {
  const h = harness(injected), evidence = await h.run();
  assert.equal(evidence.rejected.length, 12);
  assert.deepEqual(copy(evidence.rejected.map(row => row.response.status)), [400, 409, ...Array(10).fill(409)]);
  assert.equal(h.calls.filter(row => row.sent?.status === 'completed').length, 12);
  const creates = h.calls.filter(row => row.path === '/production/work-orders' && row.method === 'POST');
  assert.deepEqual(creates.map(row => [row.actorId, row.status]), injected ? [[duties.planner.id, 201], [duties.planner.id, 409]] : [[actors.stock0.id, 201], [actors.stock1.id, 409]]);
  const governance = h.calls.filter(row => row.path.startsWith('/materials/'));
  assert.deepEqual(governance.map(row => row.actorId), [actors.buyer1.id, actors.admin.id, actors.admin.id]);
  assert.equal(evidence.case.after.audits[0].userId, injected ? duties.operators[0].id : actors.stock0.id);
  assert.deepEqual(evidence.case.replay, evidence.case.after);
  if (injected) {
    assert.deepEqual(copy(evidence.roleActions), h.calls);
    assert.deepEqual(Object.keys(evidence.productionActors).sort(), ['operator', 'planner', 'qa', 'qc', 'research']);
    assert(!JSON.stringify(evidence).includes('synthetic-private-'));
  } else {
    assert.equal(Object.hasOwn(evidence, 'roleActions'), false);
    assert.equal(Object.hasOwn(evidence, 'productionActors'), false);
  }
});

test('density calibration browser supplement retains the original context, not remapped governance actors', async () => {
  const h = harness(true, { browser: true }), evidence = await h.run();
  assert.equal(h.browserCalls.length, 1); assert.equal(h.browserCalls[0][0], h.ctx);
  assert.equal(h.browserCalls[0][0].actors.admin, actors.admin);
  assert.equal(h.browserCalls[0][0].actors.buyer1, actors.buyer1);
  assert.equal(evidence.browser.legacyCalibrationSupplement, true);
});

test('density delegation fails closed before fixture mutation if a manufacturing duty aliases bootstrap admin', async () => {
  const h = harness(true, { wrongActor: 'planner' });
  await assert.rejects(h.run, /Explicit non-bootstrap production duties/); assert.equal(h.calls.length, 0);
});

test('density delegated business-negative cases still reject any ledger mutation', async () => {
  const h = harness(true, { mutateRejected: true });
  await assert.rejects(h.run, /Expected values to be strictly deep-equal/);
  assert(h.calls.some(row => row.actorId === duties.operators[0].id && row.sent?.status === 'completed' && row.status === 409));
});

// Pure guards only; real native completion still requires the cumulative browser run.
function nativeGuards() {
  const file = path.join(__dirname, 'lib', 'enterprise-round2-density-conversion-browser.cjs');
  const module = { exports: {} }, actualRequire = createRequire(file);
  const realmAssert = Object.assign((...args) => assert(...args), assert, {
    deepEqual: (actual, expected, message) => assert.deepEqual(copy(actual), copy(expected), message),
  });
  vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nmodule.exports.guards={densityWorkforcePeople,densityWorkforceProfile,densityNativeWrite};',
    { module, exports: module.exports, URL, require: key => key === 'node:assert/strict' ? realmAssert : actualRequire(key) }, { filename: file });
  return module.exports.guards;
}

function nativeContext() {
  const definitions = [['research','production.bom.write'],['production_planner','production.plan.write'],
    ['production_operator','production.execute'],['qc','production.quality.inspect'],['qa','production.quality.release']];
  const people = definitions.map(([job, permission], index) => {
    const account = { username: `synthetic-${job}`, role: `synthetic-role-${job}`, segment: 'mixed', password: 'synthetic-private-password' };
    return { id: 11 + index, job, index: 1, role: account.role, account, token: `synthetic-private-token-${index}`,
      profile: { id: 11 + index, username: account.username, role: account.role, segment: 'mixed', isActive: true, mustChangePassword: false,
        permissions: ['production.read', permission], dataScopes: ['warehouse_visible'] } };
  });
  const byJob = Object.fromEntries(people.map(person => [person.job, [person]]));
  const cohort = [...people, ...Array.from({ length: 15 }, (_, index) => ({ id: 100 + index }))];
  return { actors, workforce: { actors: cohort, byJob }, productionActors: { research: people[0], planner: people[1], operators: [people[2]], qc: people[3], qa: people[4] } };
}

test('density native guards preserve legacy mode and bind five exact run-owned duty objects', () => {
  const g = nativeGuards(), ctx = nativeContext();
  assert.equal(g.densityWorkforcePeople({ actors }), null);
  const selected = g.densityWorkforcePeople(ctx);
  assert.equal(selected.research, ctx.workforce.byJob.research[0]); assert.equal(selected.operator, ctx.workforce.byJob.production_operator[0]);
  assert.equal(g.densityWorkforceProfile(copy(selected.planner.profile), selected.planner).id, selected.planner.id);
});

for (const [name, change] of [
  ['missing context', ctx => { delete ctx.workforce; }],
  ['missing duties', ctx => { delete ctx.productionActors; }],
  ['wrong cohort size', ctx => { ctx.workforce.actors.pop(); }],
  ['duplicate cohort id', ctx => { ctx.workforce.actors[19].id = ctx.workforce.actors[0].id; }],
  ['borrowed object with same id', ctx => { ctx.productionActors.research = copy(ctx.productionActors.research); }],
  ['noncohort object', ctx => { ctx.workforce.actors[0] = { id: 999 }; }],
  ['bootstrap planner', ctx => { ctx.productionActors.planner = actors.admin; }],
  ['wrong job', ctx => { ctx.productionActors.qc.job = 'qa'; }],
  ['wrong index', ctx => { ctx.productionActors.operator = ctx.productionActors.operators[0]; ctx.productionActors.operator.index = 2; }],
  ['missing permission', ctx => { ctx.productionActors.qa.profile.permissions = ['production.read']; }],
  ['customer assets grant', ctx => { ctx.productionActors.research.profile.permissions.push('assets.read'); }],
  ['global scope', ctx => { ctx.productionActors.planner.profile.dataScopes.push('all'); }],
]) test(`density native duty selection rejects ${name}`, () => {
  const ctx = nativeContext(); change(ctx);
  assert.throws(() => nativeGuards().densityWorkforcePeople(ctx), error => {
    const serialized = `${error.stack}\n${JSON.stringify(error.actual)}\n${JSON.stringify(error.expected)}`;
    assert(!serialized.includes('synthetic-private'), 'Duty mismatch must not serialize account credentials'); return true;
  });
});

for (const [field, value] of [['id',999],['username','other'],['role','admin'],['segment','other'],['isActive',false],['mustChangePassword',true],
  ['permissions',['production.read']],['permissions',['production.read','*']],['permissions',['production.read','production.read']],['dataScopes',['all']]]) {
  test(`density native profile rejects changed ${field}=${JSON.stringify(value)}`, () => {
    const actor = nativeContext().productionActors.research;
    assert.throws(() => nativeGuards().densityWorkforceProfile({ ...copy(actor.profile), [field]: value }, actor));
  });
}

test('density native write binds origin, actor, method, path and status without serializing credentials', async () => {
  const g = nativeGuards(), actor = nativeContext().productionActors.research, endpoint = '/api/production/boms';
  const response = (patch = {}) => ({ url: () => 'https://synthetic.local' + endpoint, status: () => 201, json: async () => ({ data: { id: 1 } }),
    request: () => ({ method: () => 'POST', allHeaders: async () => ({ authorization: `Bearer ${actor.token}` }), postDataJSON: () => ({ version: 'v1' }) }), ...patch });
  const row = await g.densityNativeWrite(response(), actor, 'https://synthetic.local', 'POST', endpoint, 201);
  assert.equal(row.actorId, actor.id); assert.equal(row.sent.version, 'v1'); assert(!JSON.stringify(row).includes('synthetic-private'));
  for (const patch of [{ url: () => 'https://foreign.local' + endpoint }, { status: () => 409 },
    { request: () => ({ method: () => 'PATCH' }) }, { url: () => 'https://synthetic.local/api/production/work-orders' },
    { request: () => ({ method: () => 'POST', allHeaders: async () => ({ authorization: 'Bearer synthetic-private-other' }) }) }]) {
    await assert.rejects(g.densityNativeWrite(response(patch), actor, 'https://synthetic.local', 'POST', endpoint, 201), error => {
      assert(!String(error.stack).includes('synthetic-private')); return true;
    });
  }
});
