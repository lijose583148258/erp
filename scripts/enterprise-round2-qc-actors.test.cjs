const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const copy = value => JSON.parse(JSON.stringify(value));
const person = (id, role) => ({ id, role, job: role, token: `private-synthetic-token-${id}` });
const actors = { admin: person(1, 'admin'), stock0: person(2, 'warehouse0'), stock1: person(3, 'warehouse1'), buyer1: person(4, 'manager1'), buyer2: person(5, 'manager2') };
const duties = { research: person(11, 'research'), planner: person(12, 'planner'), operators: [person(13, 'operator')], qc: person(14, 'qc'), qa: person(15, 'qa') };
const ok = (data, status = 200) => ({ status, json: { data: copy(data) } });
const denied = (message, status = 409) => ({ status, json: { message } });
const dataOf = response => { assert([200, 201].includes(response.status), JSON.stringify(response)); return response.json.data; };

function load(name, dependencies) {
  const filename = path.join(__dirname, 'lib', name), module = { exports: {} }, actualRequire = createRequire(filename);
  const realmAssert = Object.assign((...args) => assert(...args), assert, { deepEqual: (a, b, message) => assert.deepEqual(copy(a), copy(b), message) });
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, __dirname: path.dirname(filename),
    require: key => key === 'node:assert/strict' ? realmAssert : dependencies[key] || actualRequire(key), URL, AbortSignal }, { filename });
  return module.exports;
}

function harness(injected = true) {
  const p = injected ? duties : { research: actors.admin, planner: actors.stock0, operators: [actors.stock0], qc: actors.stock0, qa: actors.buyer1 };
  let next = 100;
  const materials = new Map(), batches = new Map(), stocks = new Map(), boms = new Map(), orders = new Map(), checks = [], costs = [], movements = [], audits = [];
  const calls = [];
  const checkActor = (actor, expected, endpoint) => assert.equal(actor.id, expected.id, `Wrong actor for ${endpoint}`);
  const shapeOrder = order => ({ ...copy(order), productBatch: order.batchId ? copy(batches.get(order.batchId)) : null });
  const request = async (endpoint, options = {}) => {
    const actor = options.actor || actors.admin, method = options.method || 'GET', data = options.data;
    calls.push({ path: endpoint, method, actorId: actor.id, instance: options.instance || 0, data: copy(data ?? null) });
    let response;
    if (endpoint === '/warehouses') { checkActor(actor, actors.admin, endpoint); response = ok({ id: next++ }, 201); }
    else if (endpoint.match(/^\/warehouses\/\d+\/locations$/)) { checkActor(actor, actors.admin, endpoint); response = ok({ id: next++ }, 201); }
    else if (endpoint === '/warehouses/stock-balances') {
      checkActor(actor, actors.admin, endpoint);
      const batch = { id: next++, materialId: data.materialId, batchNo: data.batchNo, stockQuantity: data.quantity, qualityStatus: 'hold' };
      const stock = { ...copy(data), id: next++, batchId: batch.id };
      batches.set(batch.id, batch); stocks.set(stock.id, stock);
      costs.push({ id: next++, batchId: batch.id, quantityDelta: 100, costAmountDelta: 1000 });
      response = ok(stock, 201);
    } else if (endpoint === '/production/boms') {
      checkActor(actor, p.research, endpoint);
      const bom = { ...copy(data), id: next++, qualityCharacteristics: data.qualityCharacteristics.map(row => ({ ...row, id: next++ })) };
      boms.set(bom.id, bom); response = ok(bom, 201);
    } else if (endpoint === '/production/work-orders' && method === 'POST') {
      checkActor(actor, p.planner, endpoint);
      const order = { ...copy(data), id: next++, status: 'planned', workOrderNo: `WO-${next}`, genealogyEdges: [], batchId: data.batchId || null };
      orders.set(order.id, order); response = ok(shapeOrder(order), 201);
    } else if (endpoint === '/production/work-orders') {
      checkActor(actor, p.operators[0], endpoint); response = ok([...orders.values()].map(shapeOrder));
    } else if (endpoint.startsWith('/warehouses/stock-balances?')) {
      checkActor(actor, p.operators[0], endpoint);
      const batchNo = new URL(`http://fixture${endpoint}`).searchParams.get('batchNo'); response = ok([...stocks.values()].filter(stock => stock.batchNo === batchNo));
    } else if (endpoint.match(/^\/production\/work-orders\/\d+\/status$/)) {
      const order = orders.get(Number(endpoint.split('/')[3]));
      checkActor(actor, data.status === 'cancelled' ? actors.stock0 : p.operators[0], endpoint);
      if (data.status === 'completed') {
        const stock = stocks.get(data.consumptionRecords[0].stockBalanceId), input = batches.get(stock.batchId);
        if (input.qualityStatus !== 'released') response = denied('Input not independently released');
        else if (order.status === 'completed') response = ok(shapeOrder(order));
        else {
          const output = { id: next++, stockQuantity: 10, qualityStatus: 'released' };
          batches.set(output.id, output); order.batchId = output.id; order.status = 'completed';
          order.genealogyEdges = [{ quantityConsumed: 10 }]; stock.quantity -= 10; input.stockQuantity -= 10;
          costs.push({ id: next++, workOrderId: order.id, batchId: input.id, costAmountDelta: -100 }, { id: next++, workOrderId: order.id, batchId: output.id, costAmountDelta: 100 });
          movements.push({ id: next++, materialId: stock.materialId, quantityDelta: -10 });
          audits.push({ id: next++, action: 'UPDATE_PRODUCTION_WORK_ORDER_STATUS', resourceId: order.id, userId: actor.id });
          response = ok(shapeOrder(order));
        }
      } else { order.status = data.status; response = ok(shapeOrder(order)); }
    } else if (endpoint.match(/^\/production\/work-orders\/\d+\/checks$/)) {
      const order = orders.get(Number(endpoint.split('/')[3]));
      const control = data.sampleNo === 'synthetic-qc-revision';
      if (control) assert([actors.admin.id, actors.stock0.id, actors.stock1.id].includes(actor.id));
      else checkActor(actor, data.sampleNo === 'cancelled' ? actors.stock0 : p.qc, endpoint);
      if (order.status === 'cancelled') response = denied('Terminal work order');
      else {
        const qc = { id: next++, workOrderId: order.id, checkNo: `QC-${next}`, revision: checks.filter(row => row.workOrderId === order.id).length + 1,
          inspectorUserId: actor.id, checkedBy: actor.role, result: data.measurements[0].measuredNumeric === '3' ? 'fail' : 'pass', status: 'submitted', control,
          measurements: copy(data.measurements) };
        checks.push(qc);
        audits.push({ id: next++, action: 'CREATE_PRODUCTION_QC', resourceId: qc.id, workOrderId: order.id, userId: actor.id });
        response = ok(qc, 201);
      }
    } else if (endpoint.match(/^\/production\/work-orders\/\d+\/checks\/\d+\/review$/)) {
      const order = orders.get(Number(endpoint.split('/')[3])), qc = checks.find(row => row.id === Number(endpoint.split('/')[5]));
      const latest = checks.filter(row => row.workOrderId === order.id).at(-1);
      if (qc.control) assert([actors.admin.id, actors.buyer1.id, actors.buyer2.id].includes(actor.id));
      else assert([p.qc.id, p.qa.id].includes(actor.id), `Wrong reviewer for ${endpoint}`);
      if (qc.inspectorUserId === actor.id) {
        response = denied('SEGREGATION_OF_DUTIES', qc.control || !injected ? 409 : 403);
        if (response.status === 403) response.json.requiredPermissions = ['production.quality.release'];
      }
      else if (latest.id !== qc.id) response = denied('STALE_REVISION');
      else if (qc.status !== 'submitted' || (qc.result === 'fail' && data.decision === 'release')) response = denied('Invalid quality decision');
      else {
        qc.status = data.decision === 'release' ? 'released' : 'rejected'; qc.disposition = data.decision === 'release' ? 'released' : 'quarantine';
        qc.reviewedByUserId = actor.id; qc.reviewedBy = actor.role; qc.reviewNote = data.reviewNote;
        if (order.batchId) batches.get(order.batchId).qualityStatus = data.decision === 'release' ? 'released' : 'quarantine';
        audits.push({ id: next++, action: 'REVIEW_PRODUCTION_QC', resourceId: qc.id, workOrderId: order.id, userId: actor.id });
        response = ok(qc);
      }
    } else throw new Error(`Unexpected synthetic request ${method} ${endpoint}`);
    // Match main.request: identities are request metadata, not HTTP DTO fields.
    return response;
  };
  const prisma = {
    productBatch: { findUniqueOrThrow: async ({ where }) => copy(where.id ? batches.get(where.id) : [...batches.values()].find(row => row.batchNo === where.batchNo)), findUnique: async ({ where }) => copy(batches.get(where.id)) },
    stockBalance: { findUniqueOrThrow: async ({ where }) => copy(stocks.get(where.id)), findUnique: async ({ where }) => copy(stocks.get(where.id)) },
    productionWorkOrder: { findUniqueOrThrow: async ({ where, include }) => include ? shapeOrder(orders.get(where.id)) : copy(orders.get(where.id)), findUnique: async ({ where }) => shapeOrder(orders.get(where.id)) },
    productionQualityCheck: { findMany: async ({ where }) => copy(checks.filter(row => row.workOrderId === where.workOrderId)) },
    stockMovement: { findMany: async ({ where }) => copy(movements.filter(row => where.materialId.in.includes(row.materialId))) },
    inventoryCostLedger: { findMany: async ({ where }) => copy(costs.filter(row => where.OR.some(part => (part.batchId != null && row.batchId === part.batchId) || (part.workOrderId != null && row.workOrderId === part.workOrderId)))) },
    auditLog: { findMany: async ({ where }) => copy(audits.filter(row => where.OR ? where.OR.some(part => part.resourceId ? row.action === part.action && row.resourceId === part.resourceId : row.workOrderId === Number(part.details.contains.match(/\d+/)[0])) : where.action === 'UPDATE_PRODUCTION_WORK_ORDER_STATUS' ? row.action === where.action && row.resourceId === where.resourceId : row.workOrderId === Number(where.details.contains.match(/\d+/)[0]))) },
  };
  const ctx = { actors, productionActors: injected ? duties : undefined, request, prisma, dataOf, runId: 'synthetic-qc', urls: ['http://node0', 'http://node1'], reportPath: '/synthetic/report.json',
    ensureReleasedMaterial: async options => { const material = { id: next++, nameZh: options.name }; materials.set(material.id, material); return material; } };
  const density = { densityProbe: async (context, _signal, fixture) => { assert.equal(context.actors, actors); return { browserFixture: { rawId: fixture.raw.id }, legacyControl: true }; }, densityBrowser: async context => { assert.equal(context.actors, actors); return { legacyControl: true }; } };
  const probe = load('enterprise-round2-qc-isolation.cjs', { './enterprise-round2-density.cjs': density });
  return { ctx, calls, p, density, checks, orders, batches, stocks, costs, movements, audits, probe, run: () => probe.qcIsolationProbe(ctx, AbortSignal.timeout(5000)) };
}

test('QC permission denials surround the request and retain exact valid QA positive controls', async () => {
  const h = harness(), evidence = await h.run();
  assert.equal(typeof h.probe.verifyQcSelfReviews, 'function');
  assert.doesNotThrow(() => h.probe.verifyQcSelfReviews(evidence));
  for (const item of evidence.cases) {
    const proof = item.selfReview;
    assert.deepEqual(copy(proof.after), copy(proof.before));
    assert.deepEqual(copy(proof.authorized.sent), copy(proof.sent));
    assert.equal(proof.response.status, 403);
    assert.equal(proof.authorized.response.status, 200);
    assert.equal(proof.sent.decision, item.state === 'quarantine' ? 'reject' : 'release');
    assert.equal(proof.before.checks.at(-1).status, 'submitted');
    assert.equal(proof.before.batch.qualityStatus, 'hold');
    assert.equal(proof.authorized.before.batch.qualityStatus, 'hold');
    assert.equal(proof.authorized.after.batch.qualityStatus, item.state === 'quarantine' ? 'quarantine' : 'released');
  }
  const held = evidence.cases[0];
  const consumedAt = h.calls.findIndex(row => row.path === `/production/work-orders/${held.downstream.id}/status` && row.data?.status === 'completed');
  const qaAt = h.calls.findIndex(row => row.path === held.selfReview.path && row.actorId === duties.qa.id);
  assert(qaAt > consumedAt, 'Hold QA positive control must follow the original blocked consumption');
  assert.equal(held.after.batch.qualityStatus, 'hold', 'Original consumption snapshot must remain historical');
});

for (const [name, mutate] of [
  ['inspection status', h => { h.checks.at(-1).status = 'released'; }],
  ['measurement', h => { h.checks.at(-1).measurements[0].measuredNumeric = '99'; }],
  ['upstream batch', h => { [...h.batches.values()].at(-1).qualityStatus = 'released'; }],
  ['stock', h => { [...h.stocks.values()].at(-1).quantity -= 1; }],
  ['upstream work order', h => { [...h.orders.values()].at(-1).notes = 'forbidden mutation'; }],
  ['cost', h => { h.costs.at(-1).costAmountDelta -= 1; }],
  ['movement', h => { h.movements.push({ id: 99999, materialId: [...h.stocks.values()].at(-1).materialId, quantityDelta: -1 }); }],
  ['business audit', h => { const qc = h.checks.at(-1); h.audits.push({ id: 99999, action: 'REVIEW_PRODUCTION_QC', resourceId: qc.id, workOrderId: qc.workOrderId, userId: duties.qc.id }); }],
]) test(`QC producer fails on a 403 that secretly changes ${name}`, async () => {
  const h = harness(), request = h.ctx.request;
  h.ctx.request = async (endpoint, options) => {
    const result = await request(endpoint, options);
    if (endpoint.endsWith('/review') && options.actor.id === duties.qc.id) mutate(h);
    return result;
  };
  await assert.rejects(h.run, /QC self-review rejection mutated business evidence/);
});

for (const [name, mutate] of [
  ['missing immediate snapshot', e => { delete e.cases[0].selfReview.before; }],
  ['missing denial', e => { delete e.cases[0].selfReview; }],
  ['wrong permission', e => { e.cases[0].selfReview.response.json.requiredPermissions = ['other']; }],
  ['business conflict instead of permission denial', e => { e.cases[0].selfReview.response.status = 409; }],
  ['wrong QC identity', e => { e.cases[0].selfReview.actorId = actors.admin.id; }],
  ['missing recorded QC action', e => { e.roleActions = e.roleActions.filter(row => row.path !== e.cases[0].selfReview.path || row.actorId !== duties.qc.id); }],
  ['QA self review', e => { e.cases[0].selfReview.authorized.actorId = duties.qc.id; }],
  ['invalid quarantine release', e => { e.cases[1].selfReview.sent.decision = 'release'; }],
  ['different QA body', e => { e.cases[0].selfReview.authorized.sent.reviewNote = 'other'; }],
  ['different QA endpoint', e => { e.cases[0].selfReview.authorized.path += '/other'; }],
  ['stale revision before denial', e => { e.cases[0].selfReview.before.checks.push({ id: 999, revision: 2 }); }],
  ['changed measurement after denial', e => { e.cases[0].selfReview.after.checks[0].measurements[0].measuredNumeric = '99'; }],
  ['changed cost after QA', e => { e.cases[0].selfReview.authorized.after.costs[0].costAmountDelta -= 1; }],
  ['missing QA audit', e => { e.cases[0].selfReview.authorized.after.audits = []; }],
  ['wrong initial inspection author', e => { e.cases[0].selfReview.before.audits.find(row => row.action === 'CREATE_PRODUCTION_QC').userId = duties.qa.id; }],
  ['rewritten inspection during QA', e => { e.cases[0].selfReview.authorized.after.checks[0].result = 'fail'; }],
]) test(`QC independent denial proof rejects ${name}`, async () => {
  const h = harness(), evidence = copy(await h.run());
  assert.equal(typeof h.probe.verifyQcSelfReviews, 'function');
  mutate(evidence);
  assert.throws(() => h.probe.verifyQcSelfReviews(evidence));
});

for (const injected of [true, false]) test(`QC three real input states and legacy review races retain authorized identities (injected=${injected})`, async () => {
  const h = harness(injected), evidence = await h.run();
  assert.deepEqual(copy(evidence.cases.map(item => [item.state, item.requests.find(row => row.name === 'consume').status])), [['hold', 409], ['quarantine', 409], ['released', 200]]);
  assert(h.calls.some(row => row.path === evidence.cases[1].selfReview.path && row.actorId === h.p.qa.id
    && row.data?.reviewNote === 'Failed result cannot be released'));
  assert.equal(evidence.cases[1].requests.find(row => row.name === 'failed-release').status, 409);
  assert(h.calls.some(row => row.path.endsWith('/review') && row.actorId === actors.admin.id));
  assert.equal(evidence.reviewRaces.cases[0].response.status, 409);
  assert.deepEqual(copy(evidence.reviewRaces.reviewResponses.map(row => row.actorId).sort()), [actors.buyer1.id, actors.buyer2.id]);
  assert.deepEqual(copy(evidence.reviewRaces.reviewResponses.map(row => row.status).sort()), [200, 409]);
  assert(evidence.density.legacyControl);
  if (injected) {
    assert.equal(evidence.roleActions.filter(row => row.path === '/production/work-orders' && row.method === 'POST' && row.actorId === duties.planner.id).length, 6);
    assert.equal(evidence.roleActions.filter(row => row.path === '/production/boms' && row.actorId === duties.research.id).length, 6);
    assert.equal(evidence.roleActions.filter(row => row.path.endsWith('/checks') && row.actorId === duties.qc.id).length, 6);
    assert(!JSON.stringify(evidence).includes('private-synthetic-token'));
  } else assert.equal(evidence.roleActions, undefined);
});

test('QC explicit duty configuration fails closed instead of defaulting a missing inspector to admin', async () => {
  const h = harness(); h.ctx.productionActors = { ...duties, qc: undefined };
  await assert.rejects(h.run, /Explicit non-bootstrap QC production duties/); assert.equal(h.calls.length, 0);
});

function browserHarness(h, apiEvidence) {
  const item = apiEvidence.cases.find(row => row.state === 'quarantine');
  const opened = [], assertions = [], posted = [];
  let launched = 0, closed = 0;
  const knownPeople = [...Object.values(actors), duties.qc, duties.qa, duties.operators[0]];
  class Page {
    constructor() { this.fields = {}; this.waiters = []; }
    setDefaultTimeout() {}
    on() {}
    async addInitScript(_fn, state) { this.actor = knownPeople.find(actor => actor.id === Number(state.user.id)); assert.equal(state.token, this.actor.token); opened.push(this.actor.id); }
    async goto(url) { assert.equal(url, 'http://node1/#production'); }
    latest() { return h.checks.filter(row => row.workOrderId === item.upstream.id).at(-1); }
    panelText() {
      const rows = h.checks.filter(row => row.workOrderId === item.upstream.id);
      return rows.map(row => [row.checkNo, row.status, row.reviewNote, row.reviewedBy].filter(Boolean).join(' ')).join('\n')
        + (this.latest().status === 'submitted' && this.latest().inspectorUserId === this.actor.id ? '\n职责分离：必须切换另一名有放行权限的账号审核。' : '');
    }
    count(id) {
      const latest = this.latest();
      if (id === 'production-qc-save') return Number(this.actor.id === h.p.qc.id && !['submitted', 'released'].includes(latest.status));
      if (id === 'production-qc-release') return Number(this.actor.id === h.p.qa.id && latest.status === 'submitted' && latest.inspectorUserId !== this.actor.id);
      return 1;
    }
    locator(id) {
      return { id,
        async waitFor() {}, async scrollIntoViewIfNeeded() {}, innerText: async () => this.panelText(),
        fill: async value => { this.fields[id] = value; },
        click: async () => {
          if (!['production-qc-save', 'production-qc-release'].includes(id)) return;
          assert.equal(this.count(id), 1, `Browser action hidden for ${this.actor.role}: ${id}`);
          const endpoint = `/production/work-orders/${item.upstream.id}/checks` + (id === 'production-qc-release' ? `/${this.latest().id}/review` : '');
          const data = id === 'production-qc-save' ? { sampleNo: this.fields['production-quality-sample-no'], measurements: [{ characteristicId: item.upstreamBom.qualityCharacteristics[0].id,
            measuredNumeric: this.fields[`production-quality-value-${item.upstreamBom.qualityCharacteristics[0].id}`] }] } : { decision: 'release', reviewNote: this.fields['production-quality-review-note'] };
          const result = await h.ctx.request(endpoint, { method: 'POST', actor: this.actor, instance: 1, data });
          posted.push({ actorId: this.actor.id, endpoint, status: result.status });
          const response = { request: () => ({ method: () => 'POST' }), url: () => `http://node1/api${endpoint}`, status: () => result.status, json: async () => result.json };
          const waiting = this.waiters.find(waiter => waiter.predicate(response)); assert(waiting, 'Expected actual write response waiter'); waiting.resolve(response);
        },
        _page: this,
      };
    }
    getByTestId(id) { return this.locator(id); }
    getByPlaceholder(id) { return this.locator(id); }
    async screenshot() {}
    waitForResponse(predicate) { return new Promise(resolve => this.waiters.push({ predicate, resolve })); }
  }
  const expect = locator => ({
    async toContainText(value) { assertions.push({ actorId: locator._page.actor.id, value }); assert(locator._page.panelText().includes(value), `Missing browser business text ${value}`); },
    async toHaveCount(value) { assertions.push({ actorId: locator._page.actor.id, id: locator.id, count: value }); assert.equal(locator._page.count(locator.id), value); },
  });
  const browser = { newPage: async () => new Page(), close: async () => { closed++; } };
  const module = load('enterprise-round2-qc-browser.cjs', {
    'node:fs': { mkdirSync() {} },
    'playwright/test': { expect },
    './browser-launch-guard.cjs': { launchBrowserWithGuard: async () => { launched++; return { browser }; } },
    './browser-cjk-font-guard.cjs': { verifyRenderedCjk: async () => ({ syntheticOnly: true }) },
    './enterprise-round2-qc-isolation.cjs': h.probe,
    './enterprise-round2-density.cjs': h.density,
  });
  return { opened, assertions, posted, launches: () => launched, closes: () => closed,
    run: () => module.qcReleaseBrowser(h.ctx, apiEvidence, AbortSignal.timeout(5000)) };
}

for (const injected of [true, false]) test(`QC browser orchestration uses inspector, independent reviewer and executor without tokens in evidence (injected=${injected})`, async () => {
  const h = harness(injected), api = await h.run(), browser = browserHarness(h, api), evidence = await browser.run();
  assert.deepEqual(browser.opened, [h.p.qc.id, h.p.qa.id, h.p.operators[0].id]);
  assert.deepEqual(browser.posted.map(row => [row.actorId, row.status]), [[h.p.qc.id, 201], [h.p.qa.id, 200]]);
  assert(browser.assertions.some(row => row.actorId === h.p.qc.id && row.value === '必须切换另一名'));
  assert(browser.assertions.some(row => row.actorId === h.p.qc.id && row.id === 'production-qc-release' && row.count === 0));
  assert.equal(evidence.afterCompletion.stock.quantity, 90);
  assert.equal(evidence.afterRelease.stock.quantity, 100);
  assert.deepEqual(copy(evidence.afterCompletion.costs.filter(row => row.workOrderId === evidence.afterCompletion.workOrder.id).map(row => row.costAmountDelta)), [-100, 100]);
  assert.equal(evidence.replay.status, 200);
  assert.equal(evidence.submitted.inspectorUserId, h.p.qc.id);
  assert.equal(evidence.released.reviewedByUserId, h.p.qa.id);
  assert.deepEqual(copy(evidence.browser.map(row => [row.actorId, row.role])), [[h.p.qc.id, h.p.qc.role], [h.p.qa.id, h.p.qa.role], [h.p.operators[0].id, h.p.operators[0].role]]);
  assert.equal(evidence.density.legacyControl, true);
  assert(!JSON.stringify(evidence).includes('private-synthetic-token'));
  assert.equal(browser.launches(), 1); assert.equal(browser.closes(), 1);
});

test('QC browser rejects incomplete explicit duties before launching a browser', async () => {
  const h = harness(), api = await h.run(), browser = browserHarness(h, api);
  h.ctx.productionActors = { ...duties, qa: undefined };
  await assert.rejects(browser.run, /Explicit non-bootstrap QC browser duties/); assert.equal(browser.launches(), 0);
});

test('QC business rejection cannot become an authorization 403 false pass', async () => {
  const h = harness(), request = h.ctx.request;
  h.ctx.request = async (endpoint, options) => options.data?.reviewNote === 'Failed result cannot be released'
    ? { status: 403, json: { message: 'wrong permission' }, actorId: options.actor.id } : request(endpoint, options);
  await assert.rejects(h.run);
});
