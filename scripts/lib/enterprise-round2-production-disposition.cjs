const assert = require('node:assert/strict');
const { assertContinuousLedger } = require('./enterprise-round2-production-lot.cjs');

const cents = value => Math.round(Number(value) * 100);

function assertProductionDispositionCostReconciliation(evidence) {
  const c = evidence.case;
  assert.equal(c.before.batch.stockQuantity, 10);
  assert.equal(c.before.stock.quantity, 10);
  assertContinuousLedger(c.before.costs, 10, 100);
  assert.equal(c.afterScrap.batch.stockQuantity, 7);
  assert.equal(c.afterScrap.stock.quantity, 7);
  assertContinuousLedger(c.afterScrap.costs, 7, 70);
  assert.equal(c.afterScrap.disposition.costAmount, 30);
  assert.equal(c.afterRework.source.reworkedQuantity, 2);
  assert.equal(c.afterRework.source.reworkedCostAmount, 20);
  assert.equal(c.afterRework.reworkBatch.stockQuantity, 2);
  assert.equal(c.afterRework.reworkBatch.qualityStatus, 'quarantined');
  assert.equal(c.afterRework.reworkStock.quantity, 2);
  assertContinuousLedger(c.afterRework.reworkCosts, 2, 20);
  assert.equal(c.afterRework.inventoryCost + c.afterRework.netLossCost, 100);
  assert.equal(c.afterRework.inventoryQuantity + c.afterRework.netLossQuantity, 10);
  assert.deepEqual(c.afterScrapReplay, c.afterScrap);
  assert.deepEqual(c.afterReworkReplay, c.afterReworkSnapshot);
  assert.equal(c.afterRework.audits.filter(row => row.action === 'POST_PRODUCTION_SCRAP_DISPOSITION').length, 1);
  assert.equal(c.afterRework.audits.filter(row => row.action === 'POST_PRODUCTION_REWORK_RETURN').length, 1);
  assert.equal(c.afterRework.entries.filter(row => row.sourceType === 'production_scrap').length, 1);
  assert.equal(c.afterRework.entries.filter(row => row.sourceType === 'production_rework_return').length, 1);
  assert.equal(c.afterRework.quarantinedIssue.status, 409);
  assert.equal(c.afterRework.readbacks.length, 2, 'Both API instances must read the final disposition state');
  for (const readback of c.afterRework.readbacks) {
    assert.equal(readback.originalBatch.stockQuantity, 7);
    assert.equal(readback.originalStock.quantity, 7);
    assert.equal(readback.reworkBatch.stockQuantity, 2);
    assert.equal(readback.reworkBatch.qualityStatus, 'quarantined');
    assert.equal(readback.reworkStock.quantity, 2);
    assert.deepEqual(readback.dispositions.map(row => Number(row.id)), [
      Number(c.afterScrap.disposition.id),
      Number(c.afterRework.reworkDisposition.id),
    ]);
  }
  return {
    scope: 'post-completion physical scrap and traceable rework return; generic adjustments are not accepted as manufacturing evidence',
    invariants: [
      'scrap changes the selected stock balance, aggregate batch quantity, cost ledger, stock entry, and audit atomically',
      'a replay with the same idempotency key cannot duplicate stock, cost, or audit facts',
      'rework can recover only an actual scrap quantity and carrying cost, into a new quarantined batch',
      'original inventory plus net loss expense remains equal to the original completed output cost',
      'both instances read the identical final stock, batch, cost, and QA state',
    ],
    case: c,
  };
}

async function productionDispositionProbe(ctx, signal) {
  const { request, dataOf, actors, prisma, runId, ensureReleasedMaterial } = ctx;
  const prefix = `${runId}-production-disposition`;
  const evidence = { scope: 'Actual work-order output, physical scrap, return-to-quarantine rework, and ledger/audit readback', rejected: [], case: null };
  const call = async (url, method = 'GET', data, actor = actors.admin, instance = 0) => dataOf(await request(url, { method, data, actor, instance, signal }));
  try {
    const warehouse = await call('/warehouses', 'POST', { code: `${prefix}-wh`, name: '生产损耗处置隔离仓', type: 'physical' });
    const sourceLocation = await call(`/warehouses/${warehouse.id}/locations`, 'POST', { code: `${prefix}-fg`, name: '成品暂存库位', type: 'internal' });
    const reworkLocation = await call(`/warehouses/${warehouse.id}/locations`, 'POST', { code: `${prefix}-rw`, name: '返工待检库位', type: 'quarantine' });
    const raw = await ensureReleasedMaterial({ request, code: `${prefix}-raw`, name: `${prefix}-raw`, category: 'raw_material' });
    const fg = await ensureReleasedMaterial({ request, code: `${prefix}-fg`, name: `${prefix}-fg`, category: 'finished_good' });
    const final = await ensureReleasedMaterial({ request, code: `${prefix}-final`, name: `${prefix}-final`, category: 'finished_good' });
    const rawStock = await call('/warehouses/stock-balances', 'POST', {
      materialId: raw.id, productName: raw.nameZh, batchNo: `${prefix}-raw-lot`, locationId: sourceLocation.id,
      quantity: 10, unit: 'kg', unitCost: 10, sourceRef: `${prefix}-raw-seed`, reason: 'production disposition isolated fixture',
    });
    const bom = await call('/production/boms', 'POST', {
      materialId: fg.id, productName: fg.nameZh, version: `${prefix}-v1`, status: 'active', outputUnit: 'kg', shelfLifeDays: 365,
      items: [{ materialId: raw.id, quantityPerUnit: 1, unit: 'kg', allowedVarianceRate: 0 }],
      qualityCharacteristics: [{ code: 'VISC', name: '粘度', valueType: 'numeric', unit: 'mPa.s', lowerLimit: 1, upperLimit: 2 }],
    });
    const workOrder = await call('/production/work-orders', 'POST', { bomId: bom.id, productName: fg.nameZh, targetQuantity: 10, producedQuantity: 10 }, actors.stock0);
    await call(`/production/work-orders/${workOrder.id}/status`, 'PATCH', { status: 'qc_pending' }, actors.stock0);
    const inspection = await call(`/production/work-orders/${workOrder.id}/checks`, 'POST', { sampleNo: `${prefix}-qc`, measurements: [{ characteristicId: bom.qualityCharacteristics[0].id, measuredNumeric: '1.5' }] }, actors.stock0);
    await call(`/production/work-orders/${workOrder.id}/checks/${inspection.id}/review`, 'POST', { decision: 'release', reviewNote: 'Independent release before loss disposition' }, actors.buyer1);
    await call(`/production/work-orders/${workOrder.id}/status`, 'PATCH', { status: 'completed', consumptionRecords: [{ stockBalanceId: rawStock.id, quantity: 10 }] }, actors.stock0);
    const completed = await prisma.productionWorkOrder.findUniqueOrThrow({ where: { id: workOrder.id }, include: { productBatch: true } });
    const outputBatch = completed.productBatch;
    assert(outputBatch, 'Completed work order must create an output batch');
    const outputStock = await prisma.stockBalance.findFirstOrThrow({ where: { materialId: fg.id, batchNo: outputBatch.batchNo } });

    const snapshot = async () => {
      const originalBatch = await prisma.productBatch.findUniqueOrThrow({ where: { id: outputBatch.id } });
      const originalStock = await prisma.stockBalance.findUniqueOrThrow({ where: { id: outputStock.id } });
      const costs = await prisma.inventoryCostLedger.findMany({ where: { batchId: outputBatch.id }, orderBy: { id: 'asc' } });
      const dispositions = await prisma.productionDisposition.findMany({ where: { workOrderId: workOrder.id }, orderBy: { id: 'asc' } });
      const reworkDisposition = dispositions.find(row => row.dispositionType === 'rework_return');
      const reworkBatch = reworkDisposition ? await prisma.productBatch.findUniqueOrThrow({ where: { id: reworkDisposition.batchId } }) : null;
      const reworkStock = reworkDisposition ? await prisma.stockBalance.findUniqueOrThrow({ where: { id: reworkDisposition.stockBalanceId } }) : null;
      const reworkCosts = reworkBatch ? await prisma.inventoryCostLedger.findMany({ where: { batchId: reworkBatch.id }, orderBy: { id: 'asc' } }) : [];
      const audits = await prisma.auditLog.findMany({ where: { resource: 'production_disposition', resourceId: { in: dispositions.map(row => row.id) } }, orderBy: { id: 'asc' } });
      const entries = await prisma.stockEntry.findMany({ where: { sourceType: { in: ['production_scrap', 'production_rework_return'] } }, orderBy: { id: 'asc' } });
      return { originalBatch, originalStock, costs, dispositions, reworkDisposition, reworkBatch, reworkStock, reworkCosts, audits, entries };
    };
    const beforeRaw = await snapshot();
    const before = { batch: beforeRaw.originalBatch, stock: beforeRaw.originalStock, costs: beforeRaw.costs };
    evidence.case = { workOrder, outputBatch, outputStock, before };

    const unchangedReject = async (label, action, expected = [400, 409]) => {
      const beforeState = await snapshot();
      const response = await action();
      const afterState = await snapshot();
      evidence.rejected.push({ label, response, before: beforeState, after: afterState });
      assert(expected.includes(response.status), `${label}: ${response.status} ${JSON.stringify(response.json)}`);
      assert.deepEqual(afterState, beforeState, `${label} must not mutate any persisted fact`);
    };
    await unchangedReject('missing-physical-stock-balance', () => request(`/production/work-orders/${workOrder.id}/dispositions`, { method: 'POST', actor: actors.stock0, signal, data: { type: 'scrap', quantity: 3, reason: 'missing source', idempotencyKey: `${prefix}-missing-stock` } }));
    await unchangedReject('wrong-output-stock-balance', () => request(`/production/work-orders/${workOrder.id}/dispositions`, { method: 'POST', actor: actors.stock0, signal, data: { type: 'scrap', quantity: 3, reason: 'wrong source', stockBalanceId: rawStock.id, idempotencyKey: `${prefix}-wrong-stock` } }));

    const scrapKey = `${prefix}-scrap`;
    const scrap = await call(`/production/work-orders/${workOrder.id}/dispositions`, 'POST', { type: 'scrap', quantity: 3, reason: 'Independent post-completion scrap evidence', note: 'fixture scrap', stockBalanceId: outputStock.id, idempotencyKey: scrapKey }, actors.stock0);
    const afterScrapRaw = await snapshot();
    const afterScrap = { batch: afterScrapRaw.originalBatch, stock: afterScrapRaw.originalStock, costs: afterScrapRaw.costs, disposition: afterScrapRaw.dispositions.find(row => row.id === scrap.id) };
    evidence.case.afterScrap = afterScrap;
    const scrapReplay = await call(`/production/work-orders/${workOrder.id}/dispositions`, 'POST', { type: 'scrap', quantity: 3, reason: 'Independent post-completion scrap evidence', note: 'fixture scrap', stockBalanceId: outputStock.id, idempotencyKey: scrapKey }, actors.stock1, 1);
    assert.equal(scrapReplay.id, scrap.id);
    const afterScrapReplayRaw = await snapshot();
    evidence.case.afterScrapReplay = { batch: afterScrapReplayRaw.originalBatch, stock: afterScrapReplayRaw.originalStock, costs: afterScrapReplayRaw.costs, disposition: afterScrapReplayRaw.dispositions.find(row => row.id === scrap.id) };
    await unchangedReject('scrap-idempotency-key-with-different-quantity', () => request(`/production/work-orders/${workOrder.id}/dispositions`, { method: 'POST', actor: actors.stock1, instance: 1, signal, data: { type: 'scrap', quantity: 2, reason: 'Independent post-completion scrap evidence', note: 'fixture scrap', stockBalanceId: outputStock.id, idempotencyKey: scrapKey } }));
    await unchangedReject('rework-without-scrap-source', () => request(`/production/work-orders/${workOrder.id}/dispositions`, { method: 'POST', actor: actors.stock0, signal, data: { type: 'rework_return', quantity: 1, reason: 'invalid return', destinationLocationId: reworkLocation.id, idempotencyKey: `${prefix}-missing-source` } }));
    await unchangedReject('rework-exceeds-actual-scrap', () => request(`/production/work-orders/${workOrder.id}/dispositions`, { method: 'POST', actor: actors.stock0, signal, data: { type: 'rework_return', quantity: 4, reason: 'invalid over return', sourceDispositionId: scrap.id, destinationLocationId: reworkLocation.id, idempotencyKey: `${prefix}-over-return` } }));

    const reworkKey = `${prefix}-rework`;
    const rework = await call(`/production/work-orders/${workOrder.id}/dispositions`, 'POST', { type: 'rework_return', quantity: 2, reason: 'Independent rework recovery', note: 'fixture rework', sourceDispositionId: scrap.id, destinationLocationId: reworkLocation.id, idempotencyKey: reworkKey }, actors.stock0);
    const afterReworkRaw = await snapshot();
    const source = afterReworkRaw.dispositions.find(row => row.id === scrap.id);
    const reworkBatch = afterReworkRaw.reworkBatch;
    const reworkStock = afterReworkRaw.reworkStock;
    assert(source && reworkBatch && reworkStock);
    const reworkReplay = await call(`/production/work-orders/${workOrder.id}/dispositions`, 'POST', { type: 'rework_return', quantity: 2, reason: 'Independent rework recovery', note: 'fixture rework', sourceDispositionId: scrap.id, destinationLocationId: reworkLocation.id, idempotencyKey: reworkKey }, actors.stock1, 1);
    assert.equal(reworkReplay.id, rework.id);
    const afterReworkReplayRaw = await snapshot();
    const afterReworkSnapshot = {
      source: afterReworkRaw.dispositions.find(row => row.id === scrap.id), reworkBatch: afterReworkRaw.reworkBatch, reworkStock: afterReworkRaw.reworkStock,
      reworkCosts: afterReworkRaw.reworkCosts, audits: afterReworkRaw.audits, entries: afterReworkRaw.entries,
    };
    evidence.case.afterReworkSnapshot = afterReworkSnapshot;
    evidence.case.afterReworkReplay = {
      source: afterReworkReplayRaw.dispositions.find(row => row.id === scrap.id), reworkBatch: afterReworkReplayRaw.reworkBatch, reworkStock: afterReworkReplayRaw.reworkStock,
      reworkCosts: afterReworkReplayRaw.reworkCosts, audits: afterReworkReplayRaw.audits, entries: afterReworkReplayRaw.entries,
    };

    const downstreamBom = await call('/production/boms', 'POST', {
      materialId: final.id, productName: final.nameZh, version: `${prefix}-downstream`, status: 'active', outputUnit: 'kg', shelfLifeDays: 365,
      items: [{ materialId: fg.id, quantityPerUnit: 1, unit: 'kg', allowedVarianceRate: 0 }],
      qualityCharacteristics: [{ code: 'APPEAR', name: '外观', valueType: 'numeric', unit: null, lowerLimit: 1, upperLimit: 2 }],
    });
    const downstream = await call('/production/work-orders', 'POST', { bomId: downstreamBom.id, productName: final.nameZh, targetQuantity: 1, producedQuantity: 1 }, actors.stock1);
    await call(`/production/work-orders/${downstream.id}/status`, 'PATCH', { status: 'qc_pending' }, actors.stock1);
    const downstreamQc = await call(`/production/work-orders/${downstream.id}/checks`, 'POST', { sampleNo: `${prefix}-downstream-qc`, measurements: [{ characteristicId: downstreamBom.qualityCharacteristics[0].id, measuredNumeric: '1.5' }] }, actors.stock1);
    await call(`/production/work-orders/${downstream.id}/checks/${downstreamQc.id}/review`, 'POST', { decision: 'release', reviewNote: 'Output inspection cannot bypass quarantined input' }, actors.buyer1);
    const quarantinedIssue = await request(`/production/work-orders/${downstream.id}/status`, { method: 'PATCH', actor: actors.stock1, instance: 1, signal, data: { status: 'completed', consumptionRecords: [{ stockBalanceId: reworkStock.id, quantity: 1 }] } });
    assert.equal(quarantinedIssue.status, 409);
    const afterQuarantineCheck = await snapshot();
    assert.deepEqual(afterQuarantineCheck, afterReworkRaw);

    const readbacks = await Promise.all([0, 1].map(async instance => {
      const [batchList, stockList] = await Promise.all([
        call('/production/work-orders', 'GET', undefined, actors.stock0, instance),
        call(`/warehouses/stock-balances?batchNo=${encodeURIComponent(outputBatch.batchNo)}&pageSize=100`, 'GET', undefined, actors.stock0, instance),
      ]);
      const reworkStocks = await call(`/warehouses/stock-balances?batchNo=${encodeURIComponent(reworkBatch.batchNo)}&pageSize=100`, 'GET', undefined, actors.stock0, instance);
      const rows = await call(`/production/work-orders/${workOrder.id}/dispositions`, 'GET', undefined, actors.stock0, instance);
      return {
        originalBatch: await prisma.productBatch.findUniqueOrThrow({ where: { id: outputBatch.id } }),
        originalStock: stockList.find(row => row.id === outputStock.id),
        reworkBatch: await prisma.productBatch.findUniqueOrThrow({ where: { id: reworkBatch.id } }),
        reworkStock: reworkStocks.find(row => row.id === reworkStock.id),
        workOrder: batchList.find(row => row.id === workOrder.id),
        dispositions: rows,
      };
    }));
    const finalState = await snapshot();
    evidence.case.afterRework = {
      source, reworkDisposition: rework, reworkBatch, reworkStock, reworkCosts: finalState.reworkCosts, audits: finalState.audits, entries: finalState.entries,
      inventoryCost: cents(finalState.costs.reduce((sum, row) => sum + Number(row.costAmountDelta), 0)) / 100 + cents(finalState.reworkCosts.reduce((sum, row) => sum + Number(row.costAmountDelta), 0)) / 100,
      inventoryQuantity: Number(finalState.originalBatch.stockQuantity) + Number(reworkBatch.stockQuantity),
      netLossCost: Number(scrap.costAmount) - Number(rework.costAmount),
      netLossQuantity: Number(scrap.quantity) - Number(rework.quantity),
      quarantinedIssue, readbacks,
    };
    assertProductionDispositionCostReconciliation(evidence);
    if (process.env.ROUND2_BROWSER === 'true') {
      const { productionDispositionBrowser } = require('./enterprise-round2-production-disposition-browser.cjs');
      evidence.browser = await productionDispositionBrowser(ctx, { workOrder, outputBatch, outputStock }, signal);
    }
    return evidence;
  } catch (error) { error.evidence ||= evidence; throw error; }
}

module.exports = { productionDispositionProbe, assertProductionDispositionCostReconciliation };
