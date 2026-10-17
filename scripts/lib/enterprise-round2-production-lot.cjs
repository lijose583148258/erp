const assert = require('node:assert/strict');
const { synchronizedBurst } = require('./enterprise-round2-runner.cjs');
const quantity = value => Math.round(Number(value) * 1e6);
const money = value => Math.round(Number(value) * 100);

function assertContinuousLedger(rows, expectedQuantity, expectedCost) {
  assert(rows.length > 0, 'Missing cost ledger');
  let q = 0, c = 0;
  for (const row of rows) {
    assert.equal(quantity(row.quantityBefore), q, `Discontinuous quantity at ledger ${row.id}`);
    assert.equal(money(row.costBefore), c, `Discontinuous carrying cost at ledger ${row.id}`);
    q += quantity(row.quantityDelta); c += money(row.costAmountDelta);
    assert.equal(quantity(row.quantityAfter), q); assert.equal(money(row.costAfter), c);
    assert(q >= 0 && c >= 0, 'Negative physical quantity or carrying cost');
  }
  assert.equal(q, quantity(expectedQuantity)); assert.equal(c, money(expectedCost));
}

function assertLotState(state, { remaining, completed, consumption }) {
  assert.equal(state.workOrders.length, 2); assert(state.balances.length > 0); assert(state.rawMovements.length > 0);
  assert.equal(state.stockReadbacks.length, 2); assert.equal(state.workOrderReadbacks.length, 2);
  assert.equal(state.workOrders.filter(w => w.status === 'completed').length, completed);
  assert.equal(state.rawBatch.stockQuantity, remaining);
  assert.equal(state.balances.reduce((s, b) => s + b.quantity, 0), remaining);
  assertContinuousLedger(state.rawCosts, remaining, remaining * 10);
  const outputs = state.workOrders.filter(w => w.status === 'completed');
  assert.equal(new Set(outputs.map(w => w.batchId)).size, completed);
  for (const balance of state.balances) {
    let q = 0;
    for (const move of state.rawMovements.filter(m => m.stockBalanceId === balance.id)) {
      assert.equal(quantity(move.quantityBefore), q, `Discontinuous stock movement ${move.id}`);
      q += quantity(move.quantityDelta); assert.equal(quantity(move.quantityAfter), q); assert(q >= 0);
    }
    assert.equal(q, quantity(balance.quantity));
    for (const api of state.stockReadbacks) assert.equal(api.find(b => b.id === balance.id)?.quantity, balance.quantity);
  }
  for (const wo of state.workOrders) {
    const entries = state.entries.filter(e => e.sourceRef === wo.workOrderNo);
    const costs = state.workOrderCosts.filter(c => c.workOrderId === wo.id);
    if (wo.status !== 'completed') {
      assert.equal(wo.batchId, null); assert.equal(wo.genealogyEdges.length, 0);
      assert.equal(entries.length, 0); assert.equal(costs.length, 0); continue;
    }
    assert.equal(wo.productBatch.stockQuantity, consumption);
    assert.equal(wo.productBatch.qualityStatus, 'released');
    const outputBalances = state.outputBalances.filter(b => b.batchNo === wo.productBatch.batchNo);
    const outputMovements = state.outputMovements.filter(m => m.batchNo === wo.productBatch.batchNo);
    assert.equal(outputBalances.length, 1); assert.equal(outputBalances[0].quantity, consumption);
    assert.equal(outputMovements.length, 1); assert.equal(outputMovements[0].quantityBefore, 0);
    assert.equal(outputMovements[0].quantityDelta, consumption); assert.equal(outputMovements[0].quantityAfter, consumption);
    assert.equal(entries.filter(e => e.sourceType === 'production_output').length, 1);
    assert.equal(entries.filter(e => e.sourceType === 'production_consumption').length, 1);
    assert.equal(wo.genealogyEdges.length, 1);
    const edge = wo.genealogyEdges[0];
    assert.equal(edge.quantityConsumed, consumption); assert.equal(edge.outputBatchId, wo.batchId);
    assert.equal(edge.inputBatchNo, state.rawBatch.batchNo); assert.equal(edge.inputMaterialId, state.rawBatch.materialId);
    assert.equal(costs.length, 2); assert.equal(costs.reduce((s, c) => s + money(c.costAmountDelta), 0), 0);
    assert.equal(costs.find(c => c.quantityDelta < 0).costAmountDelta, -consumption * 10);
    assertContinuousLedger(costs.filter(c => c.batchId === wo.batchId), consumption, consumption * 10);
    for (const api of state.workOrderReadbacks) {
      const r = api.find(w => w.id === wo.id); assert.equal(r.status, 'completed'); assert.equal(r.batchId, wo.batchId);
    }
  }
}

async function productionLotProbe(ctx, signal) {
  const { request, dataOf, actors, prisma, runId, ensureReleasedMaterial } = ctx;
  const evidence = { scope: 'Two existing warehouse operators, two app instances, completion-time consumption; not separate pre-production picking or full workforce', cases: [], violations: [] };
  const call = async (url, method = 'GET', data, actor = actors.admin, instance = 0) => dataOf(await request(url, { method, data, actor, instance, signal }));
  const check = (label, action) => { try { action(); } catch (e) { evidence.violations.push(`${label}: ${e.message}`); } };
  try {
    const warehouse = await call('/warehouses', 'POST', { code: `${runId}-dual`, name: '双工单隔离测试仓库', type: 'physical' });
    const locations = [];
    for (let i = 0; i < 2; i++) locations.push(await call(`/warehouses/${warehouse.id}/locations`, 'POST', { code: `${runId}-dual-${i}`, name: `领料库位 ${i + 1}`, type: 'internal' }));
    for (const scenario of [{ name: 'shortage', quantity: 60, split: false }, { name: 'sufficient', quantity: 40, split: false }, { name: 'split-location', quantity: 50, split: true }]) {
      const item = { scenario, stages: [] }; evidence.cases.push(item);
      try {
        const prefix = `${runId}-${scenario.name}`;
        const raw = await ensureReleasedMaterial({ request, code: `${prefix}-raw`, name: `${prefix}-raw`, category: 'raw_material' });
        const fg = await ensureReleasedMaterial({ request, code: `${prefix}-fg`, name: `${prefix}-fg`, category: 'finished_good' });
        const batchNo = `${prefix}-lot`;
        const inbound = (amount, location, source) => call('/warehouses/stock-balances', 'POST', { materialId: raw.id, productName: raw.nameZh,
          batchNo, locationId: location.id, quantity: amount, unit: 'kg', unitCost: 10, sourceRef: `${prefix}-${source}`, reason: 'isolated dual work order fixture' });
        const stocks = [await inbound(scenario.split ? 50 : 100, locations[0], 'initial-0')];
        if (scenario.split) stocks.push(await inbound(50, locations[1], 'initial-1'));
        const bom = await call('/production/boms', 'POST', { materialId: fg.id, productName: fg.nameZh, version: 'dual-lot-v1', status: 'active', outputUnit: 'kg', shelfLifeDays: 365,
          items: [{ materialId: raw.id, quantityPerUnit: 1, unit: 'kg', allowedVarianceRate: 0 }],
          qualityCharacteristics: [{ code: 'VISC', name: '粘度', valueType: 'numeric', unit: 'mPa.s', lowerLimit: 1, upperLimit: 2 }] });
        const workOrders = [], operators = [actors.stock0, actors.stock1];
        for (const actor of operators) {
          const wo = await call('/production/work-orders', 'POST', { bomId: bom.id, productName: fg.nameZh, targetQuantity: scenario.quantity, producedQuantity: scenario.quantity }, actor);
          workOrders.push(wo);
          await call(`/production/work-orders/${wo.id}/status`, 'PATCH', { status: 'qc_pending' }, actor);
          const qc = await call(`/production/work-orders/${wo.id}/checks`, 'POST', { sampleNo: `${prefix}-${wo.id}`, measurements: [{ characteristicId: bom.qualityCharacteristics[0].id, measuredNumeric: '1.5' }] }, actor);
          await call(`/production/work-orders/${wo.id}/checks/${qc.id}/review`, 'POST', { decision: 'release', reviewNote: 'Independent release before contention' }, actors.buyer1);
        }
        Object.assign(item, { raw, fg, stocks, workOrders });
        const snapshot = async () => {
          const rawBatch = await prisma.productBatch.findUnique({ where: { batchNo } });
          const where = { materialId: raw.id, batchNo };
          const orders = await prisma.productionWorkOrder.findMany({ where: { id: { in: workOrders.map(w => w.id) } }, orderBy: { id: 'asc' }, include: { productBatch: true, genealogyEdges: true } });
          return { rawBatch, workOrders: orders,
            balances: await prisma.stockBalance.findMany({ where, orderBy: { id: 'asc' } }),
            rawMovements: await prisma.stockMovement.findMany({ where, orderBy: { id: 'asc' } }),
            outputBalances: await prisma.stockBalance.findMany({ where: { materialId: fg.id }, orderBy: { id: 'asc' } }),
            outputMovements: await prisma.stockMovement.findMany({ where: { materialId: fg.id }, orderBy: { id: 'asc' } }),
            rawCosts: await prisma.inventoryCostLedger.findMany({ where: { batchId: rawBatch.id }, orderBy: { id: 'asc' } }),
            workOrderCosts: await prisma.inventoryCostLedger.findMany({ where: { workOrderId: { in: workOrders.map(w => w.id) } }, orderBy: { id: 'asc' } }),
            entries: await prisma.stockEntry.findMany({ where: { sourceRef: { in: workOrders.map(w => w.workOrderNo) } }, orderBy: { id: 'asc' } }),
            statusAudits: await prisma.auditLog.findMany({ where: { action: 'UPDATE_PRODUCTION_WORK_ORDER_STATUS', resourceId: { in: workOrders.map(w => w.id) } }, orderBy: { id: 'asc' } }),
            stockReadbacks: await Promise.all([0, 1].map(instance => call(`/warehouses/stock-balances?batchNo=${encodeURIComponent(batchNo)}&pageSize=100`, 'GET', undefined, actors.stock0, instance))),
            workOrderReadbacks: await Promise.all([0, 1].map(async instance => (await call('/production/work-orders', 'GET', undefined, actors.stock0, instance)).filter(w => workOrders.some(wo => wo.id === w.id)))),
          };
        };
        const complete = actor => {
          const index = operators.findIndex(op => op.id === actor.id);
          return request(`/production/work-orders/${workOrders[index].id}/status`, { method: 'PATCH', actor, instance: index, signal,
            data: { status: 'completed', consumptionRecords: [{ stockBalanceId: stocks[scenario.split ? index : 0].id, quantity: scenario.quantity }] } });
        };
        const burst = await synchronizedBurst(operators, complete, signal);
        let state = await snapshot(); item.stages.push({ name: 'concurrent-completion', responses: burst, state });
        const short = scenario.name === 'shortage';
        check(`${scenario.name} responses`, () => assert.deepEqual(burst.map(r => r.status).sort(), short ? [200, 409] : [200, 200]));
        check(`${scenario.name} reconciliation`, () => assertLotState(state, { remaining: short ? 40 : 100 - 2 * scenario.quantity, completed: short ? 1 : 2, consumption: scenario.quantity }));
        if (short && state.workOrders.filter(w => w.status === 'completed').length === 1) {
          const loser = state.workOrders.findIndex(w => w.status !== 'completed');
          const retry = await complete(operators[loser]); const after = await snapshot();
          item.stages.push({ name: 'shortage-retry', response: retry, state: after });
          check('shortage retry business conflict', () => assert.equal(retry.status, 409));
          check('shortage retry is atomic', () => assert.deepEqual(after, state));
          await inbound(20, locations[0], 'replenishment'); const finish = await complete(operators[loser]);
          state = await snapshot(); item.stages.push({ name: 'replenishment-completion', response: finish, state });
          check('replenishment completion', () => { assert.equal(finish.status, 200); assertLotState(state, { remaining: 0, completed: 2, consumption: 60 }); });
        }
        const beforeReplay = state;
        const replays = await synchronizedBurst(operators, complete, signal); state = await snapshot();
        item.stages.push({ name: 'duplicate-completion', responses: replays, state });
        check(`${scenario.name} replay statuses`, () => assert(replays.every(r => r.status === 200)));
        check(`${scenario.name} replay changes no stock/cost/genealogy/audit`, () => assert.deepEqual(state, beforeReplay));
        for (const wo of state.workOrders.filter(w => w.status === 'completed')) check(`${scenario.name} completion audit once`, () => {
          const audits = state.statusAudits.filter(a => a.resourceId === wo.id && JSON.parse(a.details).status === 'completed');
          assert.equal(audits.length, 1, `Completion audit duplicated for ${wo.id}`);
          assert.equal(audits[0].userId, operators[workOrders.findIndex(w => w.id === wo.id)].id);
        });
        item.final = state;
      } catch (e) { item.error = e.stack; evidence.violations.push(`${scenario.name}: ${e.message}`); }
    }
    assert.equal(evidence.violations.length, 0, evidence.violations.join('\n')); return evidence;
  } catch (error) { error.evidence ||= evidence; throw error; }
}

async function genealogyReadback(ctx, lotEvidence, signal) {
  const fs = require('node:fs'), path = require('node:path');
  const { expect } = require('playwright/test');
  const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
  const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');
  const evidence = { scope: 'Direct upstream/downstream API and warehouse browser readback, not multi-level recall or complete workforce', api: [], browser: [], errors: [], injectedFailures: [] };
  let browser;
  const abort = () => { void browser?.close().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  try {
    assert.equal(lotEvidence.cases.length, 3); assert.equal(lotEvidence.violations.length, 0);
    for (const item of lotEvidence.cases) {
      const state = item.final;
      for (const batch of [state.rawBatch, ...state.workOrders.map(w => w.productBatch)]) for (const instance of [0, 1]) {
        const trace = ctx.dataOf(await ctx.request(`/production/batches/${batch.id}/trace`, { instance, actor: ctx.actors.stock0, signal }));
        assert.equal(trace.batch.id, batch.id); assert.equal(trace.scope, 'direct-one-hop');
        const isRaw = batch.id === state.rawBatch.id;
        const expected = state.workOrders.flatMap(w => w.genealogyEdges).filter(e => isRaw || e.outputBatchId === batch.id);
        const actual = isRaw ? trace.downstreamOutputs : trace.upstreamInputs;
        assert.deepEqual(actual.map(e => e.id).sort((a,b)=>a-b), expected.map(e => e.id).sort((a,b)=>a-b));
        for (const edge of actual) {
          const persisted = expected.find(e => e.id === edge.id);
          for (const key of ['inputMaterialId','inputBatchNo','inputStockBalanceId','quantityConsumed','inputUnit','outputBatchId','workOrderId']) assert.equal(edge[key], persisted[key]);
          assert.equal(edge.workOrder.status, 'completed');
        }
        evidence.api.push({ instance, trace });
      }
    }
    browser = (await launchBrowserWithGuard({ launchTimeoutMs: 15000, totalTimeoutMs: 30000, maxAttemptsPerStrategy: 1 })).browser;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000);
    const actor = ctx.actors.stock0;
    await page.addInitScript(({ token, user }) => {
      for (const key of ['token','auth_token','erp_auth_token']) localStorage.setItem(key, token);
      for (const key of ['user','currentUser','erp_current_user']) localStorage.setItem(key, JSON.stringify(user));
      localStorage.setItem('ailao.language','zh'); localStorage.setItem('language','zh-CN');
    }, { token: actor.token, user: { id: String(actor.id), name: actor.job, role: actor.role, segment: 'mixed' } });
    let faultPath = null;
    page.on('pageerror', e => evidence.errors.push(e.message));
    page.on('response', response => {
      if (response.status() < 400 || !response.url().includes('/api/')) return;
      const item = `${response.status()} ${new URL(response.url()).pathname}`;
      if (response.status() === 503 && new URL(response.url()).pathname === faultPath) evidence.injectedFailures.push(item);
      else evidence.errors.push(item);
    });
    await page.goto(`${ctx.urls[1]}/#production`); await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.getByTestId('production-desk-batches').click();
    const state = lotEvidence.cases.find(c => c.scenario.name === 'shortage').final;
    const dir = path.join(path.dirname(ctx.reportPath), `${ctx.runId}-genealogy`); fs.mkdirSync(dir, { recursive: true });
    for (const batch of [state.rawBatch, ...state.workOrders.map(w => w.productBatch)]) {
      await page.getByTestId('production-batch-search-input').fill(batch.batchNo);
      await page.getByTestId(`production-batch-row-${batch.id}`).click();
      const panel = page.getByTestId(`production-genealogy-${batch.id}`);
      const expected = evidence.api.find(x => x.instance === 1 && x.trace.batch.id === batch.id).trace;
      for (const [direction, edges] of [['upstreamInputs',expected.upstreamInputs],['downstreamOutputs',expected.downstreamOutputs]]) {
        const region = panel.getByTestId(`genealogy-${direction}`); await expect(region).toBeVisible();
        await expect(region.locator('[data-testid^="genealogy-edge-"]')).toHaveCount(edges.length);
        for (const edge of edges) {
          const row = region.getByTestId(`genealogy-edge-${edge.id}`);
          await expect(row).toContainText(direction === 'upstreamInputs' ? edge.inputBatchNo : edge.outputBatchNo);
          await expect(row).toContainText(edge.workOrder.workOrderNo);
          await expect(row).toContainText(`耗用 ${edge.quantityConsumed} ${edge.inputUnit}`);
        }
      }
      await panel.scrollIntoViewIfNeeded();
      const visible = await panel.evaluate(el => { const b=el.getBoundingClientRect();const top=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return !!top&&(el===top||el.contains(top)); });
      assert(visible); const font = await verifyRenderedCjk(page, `[data-testid="production-genealogy-${batch.id}"]`);
      const screenshot = path.join(dir, `batch-${batch.id}.png`); await page.screenshot({ path: screenshot });
      evidence.browser.push({ batchId: batch.id, text: await panel.innerText(), visible, font, screenshot });
      if (batch.id === state.rawBatch.id) {
        faultPath = `/api/production/batches/${batch.id}/trace`;
        const match = `**${faultPath}`;
        await page.route(match, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'isolated trace read failure' }) }));
        await panel.getByRole('button', { name: '刷新追溯' }).click();
        await expect(panel.getByRole('alert')).toContainText('追溯读取失败');
        await expect(panel.locator('[data-testid^="genealogy-edge-"]')).toHaveCount(0);
        await page.unroute(match); faultPath = null;
        await panel.getByRole('button', { name: '刷新追溯' }).click();
        await expect(panel.getByTestId('genealogy-downstreamOutputs').locator('[data-testid^="genealogy-edge-"]')).toHaveCount(2);
      }
    }
    assert.equal(evidence.errors.length, 0, JSON.stringify(evidence.errors)); assert.equal(evidence.injectedFailures.length, 1);
    return evidence;
  } catch (error) { error.evidence ||= evidence; throw error; }
  finally { signal.removeEventListener('abort', abort); await browser?.close(); }
}

module.exports = { assertContinuousLedger, assertLotState, productionLotProbe, genealogyReadback };
