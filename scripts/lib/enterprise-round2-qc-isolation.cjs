const assert = require('node:assert/strict');
const { synchronizedBurst } = require('./enterprise-round2-runner.cjs');

function verifyQcSelfReviews(report) {
  assert.deepEqual(report.cases.map(item => item.state), ['hold', 'quarantine', 'released']);
  for (const item of report.cases) {
    const proof = item.selfReview, authorized = proof?.authorized;
    assert(proof?.before && proof.after && authorized?.before && authorized.after, 'Missing immediate QC self-review evidence');
    assert.equal(proof.method, 'POST'); assert.equal(proof.instance, 0);
    assert.equal(proof.path, `/production/work-orders/${item.upstream.id}/checks/${item.qc.id}/review`);
    assert.equal(proof.sent.decision, item.state === 'quarantine' ? 'reject' : 'release');
    assert(proof.sent.reviewNote?.trim());
    assert.equal(proof.actorId, item.qc.inspectorUserId);
    assert.equal(proof.response.status, report.productionActors ? 403 : 409);
    if (report.productionActors) {
      assert.equal(proof.actorId, report.productionActors.inspector.id);
      assert.equal(proof.role, report.productionActors.inspector.role);
      assert.deepEqual(proof.response.json.requiredPermissions, ['production.quality.release']);
      assert.equal(authorized.actorId, report.productionActors.reviewer.id);
      assert.equal(authorized.role, report.productionActors.reviewer.role);
      for (const record of [proof, authorized]) {
        const actions = report.roleActions.filter(action => action.path === record.path && action.actorId === record.actorId
          && JSON.stringify(action.sent) === JSON.stringify(record.sent));
        assert.equal(actions.length, 1, 'QC permission control must bind to one recorded role action');
        for (const key of ['role', 'method', 'instance', 'sent']) assert.deepEqual(actions[0][key], record[key]);
        assert.equal(actions[0].status, record.response.status); assert.deepEqual(actions[0].json, record.response.json);
      }
    } else assert.match(proof.response.json.message, /SEGREGATION_OF_DUTIES/);
    assert.deepEqual(proof.response, Object.fromEntries(Object.entries(item.requests.find(row => row.name === 'self-review') || {}).filter(([key]) => key !== 'name')));
    for (const state of [proof.before, proof.after, authorized.before, authorized.after]) {
      for (const key of ['checks', 'movements', 'costs', 'audits']) assert(Array.isArray(state[key]), `Missing QC ${key} snapshot`);
      assert(state.checks.length && state.costs.length && state.audits.length, 'QC snapshot must contain existing inspection, seed cost and business audit');
      assert.equal(state.workOrder.id, item.upstream.id); assert.equal(state.workOrder.status, 'qc_pending');
      assert.equal(state.batch.id, item.batchId); assert.equal(state.workOrder.batchId, item.batchId);
      assert.equal(state.stock.id, item.stock.id); assert.equal(state.stock.materialId, item.raw.id);
      for (const check of state.checks) { assert.equal(check.workOrderId, item.upstream.id); assert(check.measurements?.length); }
    }
    const pending = proof.before.checks.at(-1);
    assert.equal(pending.id, item.qc.id); assert.equal(pending.status, 'submitted');
    assert.deepEqual(pending, item.qc, 'Immediate snapshot must retain the actual newly submitted inspection');
    assert.equal(pending.inspectorUserId, proof.actorId);
    assert.equal(pending.result, item.state === 'quarantine' ? 'fail' : 'pass');
    assert.equal(proof.before.batch.qualityStatus, 'hold'); assert.equal(Number(proof.before.stock.quantity), 100);
    const creation = proof.before.audits.filter(row => row.action === 'CREATE_PRODUCTION_QC' && row.resourceId === pending.id);
    assert.equal(creation.length, 1); assert.equal(creation[0].userId, proof.actorId);
    assert.deepEqual(proof.after, proof.before, 'QC self-review rejection mutated business evidence');
    assert.deepEqual(authorized.before, proof.after, 'QA control must use the same still-pending inspection and business state');
    for (const key of ['path', 'method', 'instance', 'sent']) assert.deepEqual(authorized[key], proof[key], `QA must use the same ${key}`);
    assert.notEqual(authorized.actorId, proof.actorId);
    assert.equal(authorized.response.status, 200, 'QA must accept this exact request, not merely another request on another revision');
    const decided = authorized.after.checks.find(check => check.id === pending.id);
    assert(decided); assert.equal(decided.status, proof.sent.decision === 'release' ? 'released' : 'rejected');
    assert.equal(decided.disposition, proof.sent.decision === 'release' ? 'released' : 'quarantine');
    assert.equal(decided.reviewedByUserId, authorized.actorId); assert.equal(decided.reviewNote, proof.sent.reviewNote);
    assert.deepEqual(authorized.response.json.data, decided);
    const omit = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
    const reviewFields = ['status', 'disposition', 'reviewedByUserId', 'reviewedBy', 'reviewedAt', 'reviewNote', 'updatedAt'];
    assert.deepEqual(omit(decided, reviewFields), omit(pending, reviewFields), 'QA cannot rewrite inspection or measurements');
    assert.deepEqual(authorized.after.checks.filter(check => check.id !== pending.id), authorized.before.checks.filter(check => check.id !== pending.id));
    for (const key of ['stock', 'workOrder', 'movements', 'costs']) assert.deepEqual(authorized.after[key], authorized.before[key], `QA unexpectedly changed ${key}`);
    assert.equal(authorized.after.batch.qualityStatus, decided.disposition);
    assert.deepEqual(omit(authorized.after.batch, ['qualityStatus', 'updatedAt']), omit(authorized.before.batch, ['qualityStatus', 'updatedAt']));
    assert.deepEqual(authorized.after.audits.slice(0, -1), authorized.before.audits);
    const audit = authorized.after.audits.at(-1);
    assert.equal(audit.action, 'REVIEW_PRODUCTION_QC'); assert.equal(audit.resourceId, pending.id); assert.equal(audit.userId, authorized.actorId);
    assert.equal(authorized.after.audits.filter(row => row.action === 'REVIEW_PRODUCTION_QC' && row.resourceId === pending.id).length, 1);
    if (item.state === 'hold') {
      assert.equal(item.requests.find(row => row.name === 'consume')?.status, 409);
      assert.equal(item.after.batch.qualityStatus, 'hold', 'Hold is observed before its later QA positive control');
    }
  }
}

function assertQcIsolationCase(item) {
  assert(item.before && item.after && item.readbacks?.length === 2, 'Missing QC database/API evidence');
  assert.equal(item.before.batch.qualityStatus, item.state);
  const result = item.requests.find(r => r.name === 'consume');
  if (item.state === 'released') {
    assert.equal(result.status, 200); assert.equal(Number(item.after.stock.quantity), 90);
    assert.equal(item.after.workOrder.status, 'completed');
    assert.equal(Number(item.after.workOrder.productBatch.stockQuantity), 10);
    assert.equal(item.after.workOrder.genealogyEdges.length, 1);
    const costs = item.after.costs.filter(c => c.workOrderId === item.after.workOrder.id);
    assert.deepEqual(costs.map(c => Number(c.costAmountDelta)).sort((a,b)=>a-b), [-100,100]);
    assert.equal(item.after.costs.reduce((sum,c)=>sum+Number(c.costAmountDelta),0), item.before.costs.reduce((sum,c)=>sum+Number(c.costAmountDelta),0));
  } else {
    assert.equal(result.status, 409, 'Quarantined/held input must be rejected');
    assert.deepEqual(item.after, item.before, 'Rejected input mutated business evidence');
  }
  for (const r of item.readbacks) {
    assert.equal(r.workOrder.status, item.after.workOrder.status);
    assert.equal(Number(r.stock.find(s => s.id === item.after.stock.id)?.quantity), Number(item.after.stock.quantity));
  }
}

async function qcIsolationProbe(ctx, signal) {
  const { request, dataOf, prisma, ensureReleasedMaterial } = ctx;
  const duties = ctx.productionActors;
  const actors = { ...ctx.actors,
    author: duties ? duties.research : ctx.actors.admin,
    planner: duties ? duties.planner : ctx.actors.stock0,
    operator: duties ? duties.operators?.[0] : ctx.actors.stock0,
    inspector: duties ? duties.qc : ctx.actors.stock0,
    reviewer: duties ? duties.qa : ctx.actors.buyer1 };
  const prefix = ctx.runId + '-qc';
  const report = { scope: 'Existing stock-backed semi-finished batch QC, not supplier receipt QC, WIP or full workforce', cases: [] };
  if (duties) {
    const people = [actors.author, actors.planner, actors.operator, actors.inspector, actors.reviewer];
    for (const person of people) assert(person?.id && person.id !== actors.admin.id, 'Explicit non-bootstrap QC production duties are required');
    assert.equal(new Set(people.map(person => person.id)).size, people.length, 'QC production duties must use independent identities');
    report.productionActors = Object.fromEntries(['author', 'planner', 'operator', 'inspector', 'reviewer'].map(key => [key, { id: actors[key].id, role: actors[key].role }]));
    report.roleActions = [];
  }
  const send = async (url, options) => {
    const response = await request(url, { ...options, signal });
    if (duties) report.roleActions.push({ actorId: options.actor.id, role: options.actor.role, instance: options.instance || 0,
      method: options.method || 'GET', path: url, sent: options.data ?? null, status: response.status, json: response.json });
    return response;
  };
  const call = async (url, method = 'GET', data, actor = actors.admin, instance = 0) => dataOf(await send(url, { method, data, actor, instance }));
  const wh = await call('/warehouses', 'POST', { code: prefix, name: prefix, type: 'physical' });
  const location = await call(`/warehouses/${wh.id}/locations`, 'POST', { code: `${prefix}-loc`, name: prefix, type: 'internal' });
  for (const state of ['hold', 'quarantine', 'released']) {
    const item = { state, requests: [] }; report.cases.push(item);
    try {
      const raw = await ensureReleasedMaterial({ request, code: `${prefix}-${state}-semi`, name: `${prefix}-${state}-semi`, category: 'semi_finished' });
      const fg = await ensureReleasedMaterial({ request, code: `${prefix}-${state}-fg`, name: `${prefix}-${state}-fg`, category: 'finished_good' });
      const source = await ensureReleasedMaterial({ request, code: `${prefix}-${state}-source`, name: `${prefix}-${state}-source` });
      const batchNo = `${prefix}-${state}-lot`;
      const stock = await call('/warehouses/stock-balances', 'POST', { materialId: raw.id, productName: raw.nameZh, locationId: location.id, batchNo, quantity: 100, unit: 'kg', unitCost: 10, sourceRef: `${prefix}-${state}-seed`, reason: 'Isolated API QC boundary reproduction' });
      const batch = await prisma.productBatch.findUniqueOrThrow({ where: { batchNo } });
      const bom = async (output, input, label) => call('/production/boms', 'POST', { materialId: output.id, productName: output.nameZh, version: `${prefix}-${label}`, status: 'active', outputUnit: 'kg', shelfLifeDays: 365, items: [{ materialId: input.id, quantityPerUnit: 1, unit: 'kg', allowedVarianceRate: 0 }], qualityCharacteristics: [{ code: 'VISC', name: '粘度', valueType: 'numeric', unit: 'mPa.s', lowerLimit: 1, upperLimit: 2 }] }, actors.author);
      const upstreamBom = await bom(raw, source, 'upstream');
      const upstream = await call('/production/work-orders', 'POST', { bomId: upstreamBom.id, batchId: batch.id, productName: raw.nameZh, targetQuantity: 100, producedQuantity: 100 }, actors.planner);
      await call(`/production/work-orders/${upstream.id}/status`, 'PATCH', { status: 'qc_pending' }, actors.operator);
      const qc = await call(`/production/work-orders/${upstream.id}/checks`, 'POST', { sampleNo: `${prefix}-${state}-up`, measurements: [{ characteristicId: upstreamBom.qualityCharacteristics[0].id, measuredNumeric: state === 'quarantine' ? '3' : '1.5' }] }, actors.inspector);
      const reviewSnapshot = async () => JSON.parse(JSON.stringify({
        checks: await prisma.productionQualityCheck.findMany({ where: { workOrderId: upstream.id }, orderBy: { revision: 'asc' }, include: { measurements: { orderBy: { id: 'asc' } } } }),
        batch: await prisma.productBatch.findUniqueOrThrow({ where: { id: batch.id } }),
        stock: await prisma.stockBalance.findUniqueOrThrow({ where: { id: stock.id } }),
        workOrder: await prisma.productionWorkOrder.findUniqueOrThrow({ where: { id: upstream.id } }),
        movements: await prisma.stockMovement.findMany({ where: { materialId: { in: [raw.id] } }, orderBy: { id: 'asc' } }),
        costs: await prisma.inventoryCostLedger.findMany({ where: { OR: [{ batchId: batch.id }, { workOrderId: upstream.id }] }, orderBy: { id: 'asc' } }),
        audits: await prisma.auditLog.findMany({ where: { resource: 'production', OR: [
          { action: 'UPDATE_PRODUCTION_WORK_ORDER_STATUS', resourceId: upstream.id },
          { action: { in: ['CREATE_PRODUCTION_QC', 'REVIEW_PRODUCTION_QC'] }, details: { contains: `"workOrderId":${upstream.id},` } },
        ] }, orderBy: { id: 'asc' } }),
      }));
      const reviewPath = `/production/work-orders/${upstream.id}/checks/${qc.id}/review`;
      const reviewBody = { decision: state === 'quarantine' ? 'reject' : 'release', reviewNote: 'Isolated batch disposition valid role control' };
      item.selfReview = { actorId: actors.inspector.id, role: actors.inspector.role, path: reviewPath, method: 'POST', instance: 0, sent: reviewBody, before: await reviewSnapshot() };
      const self = await send(reviewPath, { method: 'POST', data: reviewBody, actor: actors.inspector });
      item.selfReview.response = self; item.selfReview.after = await reviewSnapshot();
      item.requests.push({ name: 'self-review', ...self });
      assert.equal(self.status, duties ? 403 : 409);
      assert.deepEqual(item.selfReview.after, item.selfReview.before, 'QC self-review rejection mutated business evidence');
      const authorizedReview = async () => {
        const proof = { actorId: actors.reviewer.id, role: actors.reviewer.role, path: reviewPath, method: 'POST', instance: 0, sent: { ...reviewBody }, before: await reviewSnapshot() };
        item.selfReview.authorized = proof;
        proof.response = await send(reviewPath, { method: 'POST', data: proof.sent, actor: actors.reviewer });
        proof.after = await reviewSnapshot(); assert.equal(proof.response.status, 200);
      };
      if (state === 'quarantine') {
        const denied = await send(`/production/work-orders/${upstream.id}/checks/${qc.id}/review`, { method: 'POST', data: { decision: 'release', reviewNote: 'Failed result cannot be released' }, actor: actors.reviewer });
        item.requests.push({ name: 'failed-release', ...denied }); assert.equal(denied.status, 409);
      }
      if (state !== 'hold') await authorizedReview();
      const downstreamBom = await bom(fg, raw, 'downstream');
      const downstream = await call('/production/work-orders', 'POST', { bomId: downstreamBom.id, productName: fg.nameZh, targetQuantity: 10, producedQuantity: 10 }, actors.planner);
      await call(`/production/work-orders/${downstream.id}/status`, 'PATCH', { status: 'qc_pending' }, actors.operator);
      const finishedQc = await call(`/production/work-orders/${downstream.id}/checks`, 'POST', { sampleNo: `${prefix}-${state}-down`, measurements: [{ characteristicId: downstreamBom.qualityCharacteristics[0].id, measuredNumeric: '1.5' }] }, actors.inspector);
      await call(`/production/work-orders/${downstream.id}/checks/${finishedQc.id}/review`, 'POST', { decision: 'release', reviewNote: 'Output passed does not authorize quarantined input' }, actors.reviewer);
      const snapshot = async () => ({ batch: await prisma.productBatch.findUniqueOrThrow({ where: { id: batch.id } }), stock: await prisma.stockBalance.findUniqueOrThrow({ where: { id: stock.id } }), workOrder: await prisma.productionWorkOrder.findUniqueOrThrow({ where: { id: downstream.id }, include: { genealogyEdges: true, productBatch: true } }), movements: await prisma.stockMovement.findMany({ where: { materialId: { in: [raw.id, fg.id] } }, orderBy: { id: 'asc' } }), costs: await prisma.inventoryCostLedger.findMany({ where: { OR: [{ batchId: batch.id }, { workOrderId: downstream.id }] }, orderBy: { id: 'asc' } }), audits: await prisma.auditLog.findMany({ where: { action: 'UPDATE_PRODUCTION_WORK_ORDER_STATUS', resourceId: downstream.id }, orderBy: { id: 'asc' } }) });
      Object.assign(item, { upstream, downstream, upstreamBom, downstreamBom, qc, raw, fg, stock, batchNo, batchId: batch.id });
      item.before = await snapshot();
      assert.equal(item.before.batch.qualityStatus, state);
      const result = await send(`/production/work-orders/${downstream.id}/status`, { method: 'PATCH', actor: actors.operator, instance: 1, data: { status: 'completed', consumptionRecords: [{ stockBalanceId: stock.id, quantity: 10 }] } });
      item.requests.push({ name: 'consume', ...result }); item.after = await snapshot();
      item.readbacks = await Promise.all([0, 1].map(async instance => ({ workOrder: (await call('/production/work-orders', 'GET', undefined, actors.operator, instance)).find(w => w.id === downstream.id), stock: await call(`/warehouses/stock-balances?batchNo=${encodeURIComponent(batchNo)}&pageSize=100`, 'GET', undefined, actors.operator, instance) })));
      item.selfReviewBlocked = [403, 409].includes(self.status);
      item.passed = state === 'released' ? result.status === 200 && Number(item.after.stock.quantity) === 90 : result.status === 409 && JSON.stringify(item.before) === JSON.stringify(item.after);
      assertQcIsolationCase(item);
      // Keep the original held-input rejection/readbacks intact, then prove that
      // the same pending inspection/body was valid for the independent QA role.
      if (state === 'hold') await authorizedReview();
    } catch (error) { item.error = error.message; item.passed = false; }
  }
  const failures = report.cases.filter(c => !c.passed);
  if (failures.length) { const error = new Error(failures.map(c => c.state + ': ' + c.error).join('; ')); error.evidence = report; throw error; }
  try { verifyQcSelfReviews(report); } catch (error) { error.evidence = report; throw error; }
  // Keep the old both-grant self-review and two eligible reviewers as separate
  // governance comparison controls; the real cohort has only one QA reviewer.
  try { report.reviewRaces = await qcReviewRaces(ctx, report.cases.find(c => c.state === 'hold'), signal); }
  catch (error) { error.evidence ||= report; throw error; }
  report.density = await require('./enterprise-round2-density.cjs').densityProbe(ctx, signal, report.cases.find(c => c.state === 'quarantine'));
  return report;
}

async function qcReviewRaces(ctx, item, signal) {
  const { request, dataOf, actors, prisma } = ctx;
  const endpoint = `/production/work-orders/${item.upstream.id}`;
  const evidence = { cases: [] };
  const inspect = actor => request(`${endpoint}/checks`, { actor, instance: actor.id === actors.stock1.id ? 1 : 0, method: 'POST', signal,
    data: { sampleNo: `${ctx.runId}-revision`, measurements: [{ characteristicId: item.upstreamBom.qualityCharacteristics[0].id, measuredNumeric: '1.5' }] } });
  const review = (qc, actor, decision = 'release', instance = 0) => request(`${endpoint}/checks/${qc.id}/review`, { actor, method: 'POST', instance, signal, data: { decision, reviewNote: 'Concurrent independent disposition' } });
  const snapshot = async () => ({ checks: await prisma.productionQualityCheck.findMany({ where: { workOrderId: item.upstream.id }, orderBy: { revision: 'asc' }, include: { measurements: true } }), batch: await prisma.productBatch.findUnique({ where: { id: item.batchId } }), stock: await prisma.stockBalance.findUnique({ where: { id: item.stock.id } }), audits: await prisma.auditLog.findMany({ where: { resource: 'production', action: { in: ['CREATE_PRODUCTION_QC', 'REVIEW_PRODUCTION_QC'] }, details: { contains: `"workOrderId":${item.upstream.id},` } }, orderBy: { id: 'asc' } }) });
  try {
    const own = dataOf(await inspect(actors.admin)); const beforeOwn = await snapshot();
    const denied = await review(own, actors.admin); assert.equal(denied.status, 409); assert.match(denied.json.message, /SEGREGATION_OF_DUTIES/); assert.deepEqual(await snapshot(), beforeOwn);
    evidence.cases.push({ name: 'same inspector with both permissions', response: denied, before: beforeOwn, after: await snapshot() });
    const races = await synchronizedBurst([actors.stock0, actors.stock1], inspect, signal);
    evidence.revisionResponses = races;
    assert.deepEqual(races.map(r => r.status), [201, 201]);
    const inspections = races.map(r => dataOf(r)).sort((a,b) => a.revision-b.revision);
    assert.equal(inspections[1].revision, inspections[0].revision + 1);
    const beforeStale = await snapshot(); const stale = await review(inspections[0], actors.buyer1); assert.equal(stale.status, 409); assert.match(stale.json.message, /STALE_REVISION/); assert.deepEqual(await snapshot(), beforeStale);
    evidence.cases.push({ name: 'concurrent revision allocation and stale review', races, stale, before: beforeStale, after: await snapshot() });
    const latest = inspections[1];
    const decisions = await synchronizedBurst([actors.buyer1, actors.buyer2], actor => review(latest, actor, actor.id === actors.buyer1.id ? 'release' : 'reject', actor.id === actors.buyer1.id ? 0 : 1), signal);
    evidence.reviewResponses = decisions;
    assert.deepEqual(decisions.map(r => r.status).sort(), [200, 409]);
    const state = await snapshot(); const decided = state.checks.find(c => c.id === latest.id);
    const winner = decisions.find(r => r.status === 200);
    assert.equal(decided.reviewedByUserId, winner.actorId); assert.equal(state.batch.qualityStatus, decided.disposition === 'released' ? 'released' : 'quarantine');
    assert.equal(state.stock.quantity, 100); assert.deepEqual(state.checks.filter(c => c.id !== latest.id), beforeStale.checks.filter(c => c.id !== latest.id));
    assert.equal(state.audits.filter(a => a.action === 'REVIEW_PRODUCTION_QC' && a.resourceId === latest.id).length, 1);
    const replay = await review(latest, actors.buyer1); assert.equal(replay.status, 409); assert.deepEqual(await snapshot(), state);
    evidence.cases.push({ name: 'two reviewers claim one decision and repeated review', decisions, state, replay });
    // A cancelled order cannot receive later quality decisions.
    const terminal = await request(`/production/work-orders/${item.downstream.id}/status`, { method: 'PATCH', actor: actors.stock0, signal, data: { status: 'cancelled' } });
    assert.equal(terminal.status, 200);
    const rejected = await request(`/production/work-orders/${item.downstream.id}/checks`, { method: 'POST', actor: actors.stock0, signal, data: { sampleNo: 'cancelled', measurements: [{ characteristicId: item.downstreamBom.qualityCharacteristics[0].id, measuredNumeric: '1.5' }] } });
    assert.equal(rejected.status, 409);
    evidence.cases.push({ name: 'no inspection on cancelled order', terminal, rejected });
    return evidence;
  } catch (error) { error.evidence = { ...item, reviewRaces: evidence }; throw error; }
}

module.exports = { qcIsolationProbe, assertQcIsolationCase, verifyQcSelfReviews };
