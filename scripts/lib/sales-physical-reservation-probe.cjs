const assert = require('node:assert/strict');
const crypto = require('node:crypto');

async function probePhysicalReservation(ctx, report) {
  const { prisma, request, dataOf, order, original, material, customer, batchNo, runId, salesToken, adminToken, onLogin } = ctx;
  const e = report.physicalReservation = { version: 'physical-reservation-probe/v2', scope: 'Actual two-node race, hold generations, shared transfer/adjustment guard, QA fault and own dispatch; admin diagnostic, not original20 cross-role acceptance' };
  const snapshot = async () => ({
    balances: await prisma.stockBalance.findMany({ where: { materialId: material.id, batchNo }, orderBy: { id: 'asc' } }),
    batch: await prisma.productBatch.findUnique({ where: { batchNo } }),
    costs: await prisma.inventoryCostLedger.findMany({ where: { productBatch: { batchNo } }, orderBy: { id: 'asc' } }),
  });
  onLogin(salesToken);
  const second = dataOf(await request('/orders', { method: 'POST', data: { customerId: Number(customer.id),
    items: [{ materialId: material.id, productName: material.nameZh, quantity: 100, unit: 'kg', unitPrice: 10 }], paymentTerms: 30 } }));
  onLogin(adminToken); dataOf(await request(`/orders/${second.id}/status`, { method: 'PATCH', data: { status: 'confirmed' } }));
  const secondLine = dataOf(await request(`/orders/${second.id}`)).items[0];
  const create = async (target, line) => dataOf(await request('/shipping', { method: 'POST', data: { customerId: Number(customer.id),
    orderId: Number(target.id), orderItemId: Number(line.id), materialId: material.id, productName: material.nameZh, quantity: 30, unit: 'kg', batchNo } }));
  e.shipments = await Promise.all([create(order, original.items[0]), create(second, secondLine)]);
  e.before = await snapshot();
  e.reserveRace = await Promise.all(e.shipments.map((shipment, instance) => request(`/shipping/${shipment.id}/reserve`, {
    method: 'POST', instance, data: { expectedAuditId: null } })));
  e.afterReserve = await snapshot();
  assert.deepEqual(e.reserveRace.map(r => r.status).sort(), [201, 409], 'Exactly one30kg hold can fit the real40kg stock');
  assert.deepEqual(e.afterReserve, e.before, 'Reservation cannot book stock or inventory cost');
  const winnerIndex = e.reserveRace.findIndex(r => r.status === 201), winner = e.shipments[winnerIndex], loser = e.shipments[1 - winnerIndex];
  const beforeEffects = async () => ({ stock: await snapshot(), shipments: await prisma.shipment.findMany({ where: { id: { in: e.shipments.map(s => s.id) } }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { resource: 'shipment', resourceId: { in: e.shipments.map(s => s.id) } }, orderBy: { id: 'asc' } }) });
  const unchanged = await beforeEffects();
  e.reserveReplay = await request(`/shipping/${winner.id}/reserve`, { method: 'POST', instance: 1, data: { expectedAuditId: null } });
  assert.equal(e.reserveReplay.status, 200); assert.deepEqual(await beforeEffects(), unchanged);
  e.unreservedDispatch = await request(`/shipping/${loser.id}/status`, { method: 'PATCH', data: { status: 'in_transit' } });
  assert.equal(e.unreservedDispatch.status, 409); assert.match(e.unreservedDispatch.json.message, /STOCK_RESERVED_FOR_SHIPMENT/);
  assert.deepEqual(await beforeEffects(), unchanged);
  const warehouse = dataOf(await request('/warehouses', { method: 'POST', data: { code: `RSV-${Date.now()}`, name: runId, type: 'physical' } }));
  const destination = dataOf(await request(`/warehouses/${warehouse.id}/locations`, { method: 'POST', data: { code: `DST-${Date.now()}`, name: runId, type: 'internal' } }));
  const balance = e.before.balances[0];
  e.blockedTransfer = await request(`/warehouses/stock-balances/${balance.id}/transfer`, { method: 'POST', instance: 1,
    data: { toLocationId: destination.id, quantity: 11, requestId: crypto.randomUUID(), note: 'Cannot transfer a reserved shipment allocation' } });
  e.blockedAdjustment = await request(`/warehouses/stock-balances/${balance.id}`, { method: 'PATCH',
    data: { quantity: 29, expectedQuantity: 40, requestId: crypto.randomUUID(), note: 'Cannot adjust away reserved physical stock' } });
  assert.equal(e.blockedTransfer.status, 409); assert.equal(e.blockedAdjustment.status, 409);
  assert.deepEqual(await beforeEffects(), unchanged);
  const originalHold = e.reserveRace[winnerIndex].json.data.reservation;
  const releaseInput = { expectedAuditId: originalHold.auditId, reason: 'Cross-border documents delayed; release this allocation' };
  e.release = await request(`/shipping/${winner.id}/release-reservation`, { method: 'POST', data: releaseInput }); assert.equal(e.release.status, 201);
  const released = e.release.json.data.reservation;
  e.newGeneration = await request(`/shipping/${winner.id}/reserve`, { method: 'POST', instance: 1, data: { expectedAuditId: released.auditId } });
  assert.equal(e.newGeneration.status, 201); const afterNew = await beforeEffects();
  e.staleRelease = await request(`/shipping/${winner.id}/release-reservation`, { method: 'POST', instance: 1, data: releaseInput });
  e.staleReserve = await request(`/shipping/${winner.id}/reserve`, { method: 'POST', data: { expectedAuditId: null } });
  assert.equal(e.staleRelease.status, 409); assert.equal(e.staleReserve.status, 409); assert.deepEqual(await beforeEffects(), afterNew);
  e.exception = await request(`/shipping/${winner.id}/status`, { method: 'PATCH', data: { status: 'exception' } }); assert.equal(e.exception.status, 200);
  e.exceptionReservation = dataOf(await request(`/shipping/${winner.id}/reservation`));
  assert.equal(e.exceptionReservation.state, 'released'); assert.equal(e.exceptionReservation.activeQuantity, 0);
  e.loserReserve = await request(`/shipping/${loser.id}/reserve`, { method: 'POST', data: { expectedAuditId: null } }); assert.equal(e.loserReserve.status, 201);
  // Inject a later QC isolation as a fault, not as evidence of a real QA role.
  await prisma.productBatch.update({ where: { batchNo }, data: { qualityStatus: 'hold' } });
  const beforeHoldAttempt = await beforeEffects();
  e.qaBlockedDispatch = await request(`/shipping/${loser.id}/status`, { method: 'PATCH', instance: 1, data: { status: 'in_transit' } });
  assert.equal(e.qaBlockedDispatch.status, 409); assert.deepEqual(await beforeEffects(), beforeHoldAttempt);
  await prisma.productBatch.update({ where: { batchNo }, data: { qualityStatus: 'not_required' } });
  const trigger = `reservation_consume_fault_${Date.now()}`, pg = process.env.AUDIT_PRISMA_PROVIDER === 'postgresql', beforeAuditFailure = await beforeEffects();
  try {
    if (pg) {
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic reservation audit failure'; END; $$`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.resource='shipment' AND NEW.action='CONSUME_RESERVATION') EXECUTE FUNCTION ${trigger}()`);
    } else await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs WHEN NEW.resource='shipment' AND NEW.action='CONSUME_RESERVATION' BEGIN SELECT RAISE(ABORT,'Synthetic reservation audit failure'); END`);
    e.consumeAuditFailure = await request(`/shipping/${loser.id}/status`, { method: 'PATCH', data: { status: 'in_transit' } });
    assert.equal(e.consumeAuditFailure.status, 500);
  } finally {
    await prisma.$executeRawUnsafe(pg ? `DROP TRIGGER IF EXISTS ${trigger} ON audit_logs` : `DROP TRIGGER IF EXISTS ${trigger}`);
    if (pg) await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`);
  }
  assert.deepEqual(await beforeEffects(), beforeAuditFailure, 'Consumption audit failure rolls back status, hold, stock, batch and cost together');
  // The last free10kg can move while the actual owner dispatches its held30kg.
  e.freeTransferAndOwnDispatch = await Promise.all([
    request(`/warehouses/stock-balances/${balance.id}/transfer`, { method: 'POST', instance: 0,
      data: { toLocationId: destination.id, quantity: 10, requestId: crypto.randomUUID(), note: 'Transfer the genuinely free remainder only' } }),
    request(`/shipping/${loser.id}/status`, { method: 'PATCH', instance: 1, data: { status: 'in_transit' } }),
  ]);
  assert(e.freeTransferAndOwnDispatch.every(r => r.ok), JSON.stringify(e.freeTransferAndOwnDispatch));
  e.final = await snapshot(); e.finalReservation = dataOf(await request(`/shipping/${loser.id}/reservation`));
  assert.equal(e.finalReservation.state, 'consumed'); assert.equal(e.finalReservation.activeQuantity, 0);
  assert.equal(e.final.balances.find(b => b.id === balance.id).quantity, 0); assert.equal(e.final.balances.find(b => b.locationId === destination.id).quantity, 10);
  assert.equal(e.final.batch.stockQuantity, 10); assert.equal(e.final.costs.reduce((sum, row) => sum + row.costAmountDelta, 0), 100);
  const finalBeforeReplay = await beforeEffects();
  e.dispatchReplay = await request(`/shipping/${loser.id}/status`, { method: 'PATCH', instance: 0, data: { status: 'in_transit' } });
  assert.equal(e.dispatchReplay.status, 200); assert.deepEqual(await beforeEffects(), finalBeforeReplay);
}
module.exports = { probePhysicalReservation };
