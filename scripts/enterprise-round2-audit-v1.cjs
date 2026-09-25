const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const catalog = require('./config/enterprise-round2-v1.json');
const { createRound2Runner, synchronizedBurst } = require('./lib/enterprise-round2-runner.cjs');
const { ensureReleasedMaterial } = require('./lib/material-audit-fixture.cjs');
const { ensureUiAuditUser, createAuditPrismaClient } = require('./lib/ui-audit-user.cjs');

const reportPath = path.resolve(process.env.ROUND2_REPORT_PATH || 'output/audit/enterprise-round2-v1.json');
const urls = [process.env.APP_URL, process.env.SECONDARY_APP_URL].map(value => String(value || '').replace(/\/$/, ''));
const runId = `r2-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const runner = createRound2Runner({ catalog, reportPath, metadata: {
  runId, commit: process.env.GITHUB_SHA || process.env.ROUND2_COMMIT || null,
  dirtySource: process.env.ROUND2_DIRTY || null, sourceHash: process.env.ROUND2_SOURCE_HASH || null, builtAt: process.env.ROUND2_BUILT_AT || null,
  provider: process.env.AUDIT_PRISMA_PROVIDER || 'sqlite', appUrls: urls,
  scope: 'API+database probes; not full workforce/browser acceptance',
  loadCohort: '20 distinct warehouse actors, separate from the planned workforce',
} });
const implemented = ['stock-20-contention', 'transfer-shipping-contention', 'shipping-cost-conservation', 'payment-duplicate-verification',
  'barter-dual-stock-posting-replay', 'barter-offset-cash-difference', 'barter-reversal-conservation', 'barter-consumed-receipt-reversal-blocked'];
const actors = {};
let prisma;

async function request(endpoint, { actor = actors.admin, instance = 0, method = 'GET', data, signal } = {}) {
  const signals = [AbortSignal.timeout(20_000), ...(signal ? [signal] : [])];
  const response = await fetch(`${urls[instance]}/api${endpoint}`, {
    method, headers: { 'content-type': 'application/json', ...(actor?.token ? { authorization: `Bearer ${actor.token}` } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.any(signals),
  });
  const raw = await response.text();
  let json;
  try { json = JSON.parse(raw); } catch { json = { message: raw.slice(0, 300) }; }
  return { ok: response.ok, status: response.status, json };
}
function dataOf(result, statuses = [200, 201]) {
  assert(statuses.includes(result.status), `HTTP ${result.status}: ${JSON.stringify(result.json)}`);
  assert(result.json?.data, 'Response has no data');
  return result.json.data;
}
const micro = value => Math.round(Number(value) * 1_000_000);
const cents = value => Math.round(Number(value) * 100);
function verify(requirements, evidence) {
  const violations = Object.entries(requirements).filter(([, passed]) => !passed).map(([name]) => name);
  if (violations.length) { const error = new Error(violations.join('; ')); error.evidence = { ...evidence, violations }; throw error; }
  return evidence;
}

async function setup(signal) {
  assert.equal(process.env.ROUND2_ALLOW_MUTATIONS, 'true', 'Explicit isolated-sandbox mutation opt-in is required');
  assert(urls[0] && urls[1] && urls[0] !== urls[1], 'Two distinct application URLs are required');
  assert(process.env.DATABASE_URL || process.env.AUDIT_DATABASE_URL, 'An explicit audit database is required; no stable-runtime fallback');
  for (const url of urls) assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname), 'Only isolated loopback sandboxes are supported');
  prisma = createAuditPrismaClient();
  const password = crypto.randomBytes(24).toString('base64url') + '!Aa1';
  const definitions = [['admin', 'admin'], ['sales', 'sales'], ['finance1', 'finance'], ['finance2', 'finance'],
    ...Array.from({ length: 20 }, (_, index) => [`stock${index}`, 'warehouse'])];
  for (const [job, role] of definitions) {
    signal.throwIfAborted();
    const username = `${runId}_${job}`;
    await ensureUiAuditUser({ username, password, role, segment: role === 'sales' ? 'direct' : 'mixed' });
    const login = dataOf(await request('/auth/login', { actor: null, method: 'POST', data: { username, password }, signal }));
    assert(login.token && login.user?.id, 'Invalid login identity');
    actors[job] = { id: login.user.id, job, role, token: login.token };
  }
  // Cross-instance token readiness, before measuring business writes.
  dataOf(await request('/warehouses', { instance: 1, signal }));
}

async function stockFixture(label, signal, { valued = true } = {}) {
  const material = await ensureReleasedMaterial({ request: (endpoint, options) => request(endpoint, { ...options, signal }),
    code: `${runId}-${label}`, name: `${runId}-${label}`, category: 'finished_good', unit: 'kg' });
  let warehouses = dataOf(await request('/warehouses', { signal }));
  let source = warehouses.flatMap(wh => wh.locations || []).find(loc => loc.code === 'LOC-FG');
  const warehouse = dataOf(await request('/warehouses', { method: 'POST', signal,
    data: { code: `${runId}-${label}`, name: `Round2 ${label}`, type: 'physical' } }));
  if (!source) source = dataOf(await request(`/warehouses/${warehouse.id}/locations`, { method: 'POST', signal,
    data: { code: 'LOC-FG', name: 'Round2 finished goods', type: 'internal' } }));
  const destination = dataOf(await request(`/warehouses/${warehouse.id}/locations`, { method: 'POST', signal,
    data: { code: `${runId}-${label}-dest`, name: `Round2 destination ${label}`, type: 'internal' } }));
  const batchNo = `${runId}-${label}-batch`;
  const stock = dataOf(await request('/warehouses/stock-balances', { method: 'POST', signal,
    data: { locationId: source.id, materialId: material.id, productName: material.nameZh, batchNo, quantity: 100, unit: 'kg',
      unitCost: valued ? 10 : undefined, sourceRef: `${runId}-${label}-seed`, reason: 'isolated round2 fixture' } }));
  return { material, source, destination, stock, batchNo };
}

async function readStock(fixture, signal) {
  const where = { materialId: fixture.material.id, batchNo: fixture.batchNo };
  const balances = await prisma.stockBalance.findMany({ where, orderBy: { id: 'asc' } });
  const movements = await prisma.stockMovement.findMany({ where, orderBy: { id: 'asc' } });
  const entries = await prisma.stockEntry.findMany({ where: { movements: { some: where } }, orderBy: { id: 'asc' } });
  const batch = await prisma.productBatch.findUnique({ where: { batchNo: fixture.batchNo } });
  const costs = batch ? await prisma.inventoryCostLedger.findMany({ where: { batchId: batch.id }, orderBy: { id: 'asc' } }) : [];
  const api = await Promise.all(urls.map((_, instance) => request(`/warehouses/stock-balances?batchNo=${encodeURIComponent(fixture.batchNo)}&pageSize=100`, { instance, signal })));
  const apiBalances = api.map(result => dataOf(result).filter(row => Number(row.materialId) === fixture.material.id && row.batchNo === fixture.batchNo));
  return { balances, movements, entries, batch, costs, apiBalances };
}
function stockInvariants(state) {
  return {
    no_negative_physical_stock: state.balances.every(row => Number(row.quantity) >= 0),
    balances_equal_posted_movements: state.balances.every(row => micro(row.quantity) === state.movements.filter(m => m.stockBalanceId === row.id).reduce((sum, m) => sum + micro(m.quantityDelta), 0)),
    movements_have_no_negative_state: state.movements.every(row => Number(row.quantityBefore) >= 0 && Number(row.quantityAfter) >= 0),
    movement_arithmetic_matches: state.movements.every(row => micro(row.quantityBefore) + micro(row.quantityDelta) === micro(row.quantityAfter)),
    both_instances_match_database: state.apiBalances.every(rows => state.balances.every(balance =>
      rows.some(row => Number(row.id) === balance.id && micro(row.quantity) === micro(balance.quantity)))),
  };
}

async function stockContention(signal) {
  const fixture = await stockFixture('stock20', signal);
  const cohort = Array.from({ length: 20 }, (_, index) => ({ ...actors[`stock${index}`], index }));
  const responses = await synchronizedBurst(cohort, async actor => {
    const requestId = `${runId}-take-${actor.index}`;
    const result = await request(`/warehouses/stock-balances/${fixture.stock.id}/transfer`, { actor, instance: actor.index % 2, method: 'POST', signal,
      data: { toLocationId: fixture.destination.id, quantity: 10, requestId } });
    return { status: result.status, requestId, message: result.json?.message, instance: actor.index % 2 };
  }, signal);
  let state = await readStock(fixture, signal);
  const winners = responses.filter(row => row.status === 201);
  const evidence = { materialId: fixture.material.id, stockId: fixture.stock.id, responses, state };
  const requirements = {
    ...stockInvariants(state),
    exactly_ten_successes: winners.length === 10,
    remaining_ten_are_business_conflicts: responses.filter(row => row.status === 409).length === 10,
    source_exhausted_not_negative: micro(state.balances.find(row => row.id === fixture.stock.id)?.quantity) === 0,
    total_physical_quantity_conserved: state.balances.reduce((sum, row) => sum + micro(row.quantity), 0) === micro(100),
    one_voucher_per_winner_no_loser_voucher: responses.every(row => state.entries.filter(entry => entry.sourceRef === `warehouse_transfer:${row.requestId}`).length === (row.status === 201 ? 1 : 0)),
    complete_two_sided_movements: state.movements.length === 1 + winners.length * 2,
  };
  if (winners.length) {
    const winner = winners[0];
    const replay = await request(`/warehouses/stock-balances/${fixture.stock.id}/transfer`, { actor: cohort.find(actor => actor.id === winner.actorId), instance: 1 - winner.instance, method: 'POST', signal,
      data: { toLocationId: fixture.destination.id, quantity: 10, requestId: winner.requestId } });
    const after = await readStock(fixture, signal);
    requirements.replay_does_not_post_again = replay.status === 201 && after.movements.length === state.movements.length && after.entries.length === state.entries.length
      && JSON.stringify(after.balances) === JSON.stringify(state.balances);
    evidence.replayStatus = replay.status;
  }
  return verify(requirements, evidence);
}

async function customer(signal) {
  return dataOf(await request('/customers', { actor: actors.sales, method: 'POST', signal, data: {
    name: `${runId}-${crypto.randomBytes(3).toString('hex')}`, creditLimit: 100000, termsDays: 30,
    segment: 'direct', poolState: 'private', salespersonId: actors.sales.id,
    contactName: 'Synthetic round2', contactPhone: '0900000000',
  } }));
}
async function shipment(fixture, signal, quantity = 60) {
  const buyer = await customer(signal);
  return dataOf(await request('/shipping', { actor: actors.stock0, method: 'POST', signal, data: {
    customerId: buyer.id, materialId: fixture.material.id, productName: fixture.material.nameZh,
    quantity, unit: 'kg', batchNo: fixture.batchNo, carrier: 'Round2 synthetic',
  } }));
}
async function transferShipping(signal) {
  const fixture = await stockFixture('transfer-ship', signal);
  const delivery = await shipment(fixture, signal);
  const requestId = `${runId}-compete`;
  const responses = await synchronizedBurst([actors.stock0, actors.stock1], async actor => {
    const transfer = actor.id === actors.stock0.id;
    const result = await request(transfer ? `/warehouses/stock-balances/${fixture.stock.id}/transfer` : `/shipping/${delivery.id}/status`, {
      actor, instance: transfer ? 0 : 1, method: transfer ? 'POST' : 'PATCH', signal,
      data: transfer ? { toLocationId: fixture.destination.id, quantity: 60, requestId } : { status: 'in_transit' },
    });
    return { status: result.status, operation: transfer ? 'transfer' : 'shipping', message: result.json?.message };
  }, signal);
  const state = await readStock(fixture, signal);
  const persisted = await prisma.shipment.findUnique({ where: { id: delivery.id } });
  const shippingWon = responses.find(row => row.operation === 'shipping').status === 200;
  const transferWon = responses.find(row => row.operation === 'transfer').status === 201;
  return verify({
    ...stockInvariants(state), exactly_one_operation_succeeded: Number(shippingWon) + Number(transferWon) === 1,
    loser_received_conflict: responses.filter(row => row.status === 409).length === 1,
    source_quantity_is_40: micro(state.balances.find(row => row.id === fixture.stock.id)?.quantity) === micro(40),
    destination_matches_transfer: micro(state.balances.find(row => row.locationId === fixture.destination.id)?.quantity || 0) === micro(transferWon ? 60 : 0),
    shipment_status_matches_posting: persisted.status === (shippingWon ? 'in_transit' : 'pending'),
    shipping_voucher_exactly_once: state.entries.filter(row => row.sourceType === 'shipping_issue' && row.sourceRef === delivery.shipmentNo).length === Number(shippingWon),
    transfer_voucher_exactly_once: state.entries.filter(row => row.sourceRef === `warehouse_transfer:${requestId}`).length === Number(transferWon),
  }, { stockId: fixture.stock.id, shipmentId: delivery.id, responses, state, persisted });
}

async function shippingCost(signal) {
  const fixture = await stockFixture('ship-cost', signal);
  const delivery = await shipment(fixture, signal);
  dataOf(await request(`/shipping/${delivery.id}/status`, { actor: actors.stock0, method: 'PATCH', signal, data: { status: 'in_transit' } }));
  const state = await readStock(fixture, signal);
  const finalDelivery = await shipment(fixture, signal, 40);
  dataOf(await request(`/shipping/${finalDelivery.id}/status`, { actor: actors.stock0, method: 'PATCH', signal, data: { status: 'in_transit' } }));
  const depleted = await readStock(fixture, signal);
  const unvalued = await stockFixture('ship-unvalued', signal, { valued: false });
  const unvaluedDelivery = await shipment(unvalued, signal);
  const unvaluedBefore = await readStock(unvalued, signal);
  const denied = await request(`/shipping/${unvaluedDelivery.id}/status`, { actor: actors.stock0, method: 'PATCH', signal, data: { status: 'in_transit' } });
  const unvaluedAfter = await readStock(unvalued, signal);
  const deniedShipment = await prisma.shipment.findUnique({ where: { id: unvaluedDelivery.id } });
  return verify({
    ...stockInvariants(state), physical_balance_40: state.balances.reduce((sum, row) => sum + micro(row.quantity), 0) === micro(40),
    product_batch_balance_40: micro(state.batch?.stockQuantity) === micro(40),
    inventory_cost_balance_400: state.costs.reduce((sum, row) => sum + cents(row.costAmountDelta), 0) === cents(400),
    inventory_cost_quantity_40: state.costs.reduce((sum, row) => sum + micro(row.quantityDelta), 0) === micro(40),
    final_quantity_and_cost_zero: micro(depleted.batch?.stockQuantity) === 0 && depleted.balances.every(row => micro(row.quantity) === 0)
      && depleted.costs.reduce((sum, row) => sum + cents(row.costAmountDelta), 0) === 0
      && depleted.costs.reduce((sum, row) => sum + micro(row.quantityDelta), 0) === 0,
    unvalued_stock_requires_reconciliation: denied.status === 409 && denied.json.message.startsWith('STOCK_COST_RECONCILIATION_REQUIRED'),
    unvalued_rejection_leaves_no_half_posting: deniedShipment.status === 'pending' && JSON.stringify(unvaluedAfter) === JSON.stringify(unvaluedBefore),
  }, { shipmentId: delivery.id, expected: { quantity: 40, unitCost: 10, cost: 400 }, state, depleted,
    unvalued: { status: denied.status, message: denied.json?.message, before: unvaluedBefore, after: unvaluedAfter } });
}

async function paymentVerification(signal) {
  const buyer = await customer(signal);
  const material = await ensureReleasedMaterial({ request: (endpoint, options) => request(endpoint, { ...options, signal }),
    code: `${runId}-payment`, name: `${runId}-payment`, category: 'finished_good' });
  const order = dataOf(await request('/orders', { actor: actors.sales, method: 'POST', signal, data: {
    customerId: buyer.id, items: [{ materialId: material.id, productName: material.nameZh, quantity: 10, unit: 'kg', unitPrice: 100 }], paymentTerms: 30,
  } }));
  dataOf(await request(`/orders/${order.id}/payment`, { actor: actors.sales, method: 'POST', signal,
    data: { amount: 300, method: 'bank_transfer', payerName: 'Round2 synthetic', note: runId } }));
  const before = dataOf(await request(`/orders/${order.id}`, { actor: actors.finance1, signal }));
  const payment = before.paymentRecords.find(row => row.status === 'pending');
  assert(payment?.id, 'Pending payment is missing');
  const responses = await synchronizedBurst([actors.finance1, actors.finance2], async actor => {
    const result = await request(`/orders/${order.id}/payment/${payment.id}/verify`, { actor, instance: actor.id === actors.finance1.id ? 0 : 1, method: 'POST', signal });
    return { status: result.status, message: result.json?.message };
  }, signal);
  const readbacks = await Promise.all(urls.map(async (_, instance) => dataOf(await request(`/orders/${order.id}`, { actor: actors.finance1, instance, signal }))));
  const persisted = await prisma.order.findUnique({ where: { id: order.id }, include: { paymentRecords: true } });
  return verify({
    repeated_verification_is_idempotent: responses.every(row => row.status === 200),
    exactly_one_verified_payment: persisted.paymentRecords.length === 1 && persisted.paymentRecords[0].status === 'verified',
    paid_amount_is_300_not_600: cents(persisted.paidAmount) === cents(300),
    payment_status_partial: persisted.paymentStatus === 'partial',
    both_instances_agree: readbacks.every(row => cents(row.paidAmount) === cents(300) && row.paymentRecords.length === 1),
  }, { orderId: order.id, paymentId: payment.id, responses, paidAmount: persisted.paidAmount,
    paymentStatus: persisted.paymentStatus, payments: persisted.paymentRecords,
    readbacks: readbacks.map(row => ({ id: row.id, paidAmount: row.paidAmount, paymentStatus: row.paymentStatus })) });
}

async function barterFixture(label, unequal, signal) {
  const our = await stockFixture(label, signal);
  const incoming = await ensureReleasedMaterial({ request: (endpoint, options) => request(endpoint, { ...options, signal }),
    code: `${runId}-${label}-raw`, name: `${runId}-${label}-raw`, category: 'raw_material', unit: 'kg' });
  const warehouses = dataOf(await request('/warehouses', { signal }));
  let raw = warehouses.flatMap(wh => wh.locations || []).find(loc => loc.code === 'LOC-RAW');
  if (!raw) raw = dataOf(await request(`/warehouses/${our.destination.warehouseId}/locations`, { method: 'POST', signal,
    data: { code: 'LOC-RAW', name: 'Round2 raw material', type: 'internal' } }));
  const buyer = await customer(signal);
  const order = dataOf(await request('/orders', { actor: actors.sales, method: 'POST', signal, data: {
    customerId: buyer.id, items: [{ materialId: our.material.id, productName: our.material.nameZh, quantity: 10, unit: 'kg', unitPrice: 20 }], paymentTerms: 30,
  } }));
  const receivedBatch = `${runId}-${label}-incoming`;
  const settlement = dataOf(await request('/barter/settlements', { actor: actors.sales, method: 'POST', signal, data: {
    counterpartyType: 'customer', counterpartyName: buyer.name, customerId: buyer.id, orderId: order.id,
    settlementMode: unequal ? 'mixed' : 'barter', currency: 'CNY', note: runId,
    items: [
      { side: 'our', materialId: our.material.id, itemName: our.material.nameZh, unit: 'kg', quantity: 10, unitPrice: 20, sourceDocument: our.batchNo },
      { side: 'counterparty', materialId: incoming.id, itemName: incoming.nameZh, unit: 'kg', quantity: 20, unitPrice: unequal ? 7.5 : 10, sourceDocument: receivedBatch },
    ],
  } }));
  dataOf(await request(`/barter/settlements/${settlement.id}/approve`, { actor: actors.admin, method: 'PATCH', signal, data: { note: runId } }));
  return { our, incoming: { material: incoming, batchNo: receivedBatch }, settlement, order, offset: unequal ? 150 : 200 };
}
async function readBarter(ctx, signal) {
  const [our, incoming, settlement, order, api] = await Promise.all([
    readStock(ctx.our, signal), readStock(ctx.incoming, signal),
    prisma.barterSettlement.findUnique({ where: { id: ctx.settlement.id }, include: { offsetPostings: true, reversalLogs: true } }),
    prisma.order.findUnique({ where: { id: ctx.order.id }, include: { paymentRecords: true } }),
    Promise.all(urls.map(async (_, instance) => dataOf(await request(`/barter/settlements/${ctx.settlement.id}`, { actor: actors.finance1, instance, signal })))),
  ]);
  return { our, incoming, settlement, order, api: api.map(row => ({ id: row.id, status: row.status, cashDifference: row.cashDifference })) };
}
async function postBarter(ctx, actor, instance, signal) {
  return request(`/barter/settlements/${ctx.settlement.id}/post`, { actor, instance, method: 'POST', signal, data: { postingAmount: ctx.offset, note: runId } });
}
async function barterPosting(signal) {
  const ctx = await barterFixture('barter-post', false, signal);
  const responses = await synchronizedBurst([actors.finance1, actors.finance2], async actor => {
    const result = await postBarter(ctx, actor, actor.id === actors.finance1.id ? 0 : 1, signal);
    return { status: result.status, message: result.json?.message };
  }, signal);
  const state = await readBarter(ctx, signal);
  const replay = await postBarter(ctx, actors.finance1, 1, signal);
  const after = await readBarter(ctx, signal);
  return verify({
    ...stockInvariants(state.our), ...Object.fromEntries(Object.entries(stockInvariants(state.incoming)).map(([key, value]) => [`incoming_${key}`, value])),
    one_post_succeeded_other_is_conflict: responses.filter(row => row.status === 200).length === 1 && responses.filter(row => row.status === 409).length === 1,
    two_stock_legs_once: state.our.entries.filter(row => row.sourceType === 'barter_issue').length === 1 && state.incoming.entries.filter(row => row.sourceType === 'barter_receipt').length === 1,
    outgoing_physical_90: state.our.balances.reduce((sum, row) => sum + micro(row.quantity), 0) === micro(90),
    incoming_physical_20: state.incoming.balances.reduce((sum, row) => sum + micro(row.quantity), 0) === micro(20),
    batch_quantities_match_stock: micro(state.our.batch?.stockQuantity) === micro(90) && micro(state.incoming.batch?.stockQuantity) === micro(20),
    outgoing_carrying_cost_not_sale_value: state.our.costs.reduce((sum, row) => sum + cents(row.costAmountDelta), 0) === cents(900),
    incoming_has_valuation: state.incoming.costs.reduce((sum, row) => sum + cents(row.costAmountDelta), 0) === cents(200),
    exactly_one_offset_and_payment: state.settlement.offsetPostings.length === 1 && state.order.paymentRecords.length === 1 && cents(state.order.paidAmount) === cents(200),
    replay_is_noop: replay.status === 409 && JSON.stringify(after) === JSON.stringify(state),
    both_instances_see_posted: state.api.every(row => row.status === 'posted'),
  }, { settlementId: ctx.settlement.id, responses, replayStatus: replay.status, state });
}
async function barterDifference(signal) {
  const ctx = await barterFixture('barter-difference', true, signal);
  dataOf(await postBarter(ctx, actors.finance1, 0, signal));
  const state = await readBarter(ctx, signal);
  return verify({
    sale_valuation_200_incoming_150: cents(state.settlement.totalPartyAValue) === cents(200) && cents(state.settlement.totalPartyBValue) === cents(150),
    cash_difference_is_50_not_received: cents(state.settlement.cashDifference) === cents(50) && state.order.paymentRecords.every(row => row.method === 'barter'),
    offset_only_150: state.settlement.offsetPostings.length === 1 && cents(state.settlement.offsetPostings[0].offsetAmount) === cents(150),
    outstanding_50_remains: cents(state.order.finalAmount) - cents(state.order.paidAmount) === cents(50) && state.order.paymentStatus === 'partial',
    both_instances_agree: state.api.every(row => row.status === 'posted' && cents(row.cashDifference) === cents(50)),
  }, { scope: 'Positive cash difference stays receivable; cash collection and opposite-direction refund not yet covered', state });
}
async function barterReversal(signal) {
  const ctx = await barterFixture('barter-reverse', true, signal);
  dataOf(await postBarter(ctx, actors.finance1, 0, signal));
  const posted = await readBarter(ctx, signal);
  const responses = await synchronizedBurst([actors.finance1, actors.finance2], async actor => {
    const result = await request(`/barter/settlements/${ctx.settlement.id}/reverse`, { actor, instance: actor.id === actors.finance1.id ? 0 : 1, method: 'POST', signal, data: { reason: 'Round2 exact reversal' } });
    return { status: result.status, message: result.json?.message };
  }, signal);
  const state = await readBarter(ctx, signal);
  return verify({
    ...stockInvariants(state.our),
    reverse_succeeds_other_is_idempotent_or_conflict: responses.some(row => row.status === 200) && responses.every(row => [200, 409].includes(row.status)),
    status_and_reversal_log_once: state.settlement.status === 'reversed' && state.settlement.reversalLogs.length === 1,
    both_stock_legs_reversed_once: state.our.entries.filter(row => row.sourceType === 'barter_issue_reversal').length === 1 && state.incoming.entries.filter(row => row.sourceType === 'barter_receipt_reversal').length === 1,
    original_quantity_restored: state.our.balances.reduce((sum, row) => sum + micro(row.quantity), 0) === micro(100) && state.incoming.balances.reduce((sum, row) => sum + micro(row.quantity), 0) === 0,
    batch_traceability_retained: micro(state.our.batch?.stockQuantity) === micro(100) && state.incoming.batch && micro(state.incoming.batch.stockQuantity) === 0,
    carrying_cost_reversed_exactly: state.our.costs.length >= 3 && state.incoming.costs.length >= 2 && state.our.costs.reduce((sum, row) => sum + cents(row.costAmountDelta), 0) === cents(1000) && state.incoming.costs.reduce((sum, row) => sum + cents(row.costAmountDelta), 0) === 0,
    financial_offset_reversed_not_deleted: state.settlement.offsetPostings.length === 1 && state.order.paymentRecords.length === 1 && state.order.paymentRecords[0].status !== 'verified' && cents(state.order.paidAmount) === 0,
    both_instances_see_reversed: state.api.every(row => row.status === 'reversed'),
  }, { settlementId: ctx.settlement.id, responses, posted, state });
}

async function barterConsumedReversal(signal) {
  const ctx = await barterFixture('barter-consumed', true, signal);
  dataOf(await postBarter(ctx, actors.finance1, 0, signal));
  const receipt = await readStock(ctx.incoming, signal);
  const raw = receipt.balances[0];
  dataOf(await request(`/warehouses/stock-balances/${raw.id}/transfer`, { actor: actors.stock0, method: 'POST', signal,
    data: { toLocationId: ctx.our.source.id, quantity: 20, requestId: `${runId}-barter-consume-transfer` } }));
  const delivery = await shipment(ctx.incoming, signal, 10);
  dataOf(await request(`/shipping/${delivery.id}/status`, { actor: actors.stock0, method: 'PATCH', signal, data: { status: 'in_transit' } }));
  const before = await readBarter(ctx, signal);
  const result = await request(`/barter/settlements/${ctx.settlement.id}/reverse`, { actor: actors.finance1, method: 'POST', signal,
    data: { reason: 'Must reject: part of received goods already consumed by shipment' } });
  const after = await readBarter(ctx, signal);
  return verify({
    partial_consumption_real: micro(before.incoming.batch?.stockQuantity) === micro(10) && before.incoming.costs.reduce((sum, row) => sum + cents(row.costAmountDelta), 0) === cents(75),
    reversal_rejected: result.status === 409,
    entire_transaction_rolled_back: JSON.stringify(after) === JSON.stringify(before),
    no_financial_or_reversal_side_effect: after.settlement.status === 'posted' && after.settlement.reversalLogs.length === 0 && cents(after.order.paidAmount) === cents(150),
    no_negative_stock: after.incoming.balances.every(row => Number(row.quantity) >= 0),
  }, { settlementId: ctx.settlement.id, shipmentId: delivery.id, reversalStatus: result.status, reversalMessage: result.json?.message, before, after });
}

async function main() {
  try {
    await setup(AbortSignal.timeout(90_000));
  } catch (error) {
    for (const id of implemented) runner.block(id, `Setup failed: ${error.message}`);
    runner.report.setupError = String(error.message || error);
    return;
  }
  await runner.run('stock-20-contention', stockContention);
  await runner.run('transfer-shipping-contention', transferShipping);
  await runner.run('shipping-cost-conservation', shippingCost);
  await runner.run('payment-duplicate-verification', paymentVerification);
  await runner.run('barter-dual-stock-posting-replay', barterPosting);
  await runner.run('barter-offset-cash-difference', barterDifference);
  await runner.run('barter-reversal-conservation', barterReversal);
  await runner.run('barter-consumed-receipt-reversal-blocked', barterConsumedReversal);
}

main().catch(error => { runner.report.executionError = String(error.message || error); }).finally(async () => {
  if (prisma) await prisma.$disconnect();
  const report = runner.finish();
  console.log(JSON.stringify({ status: report.status, passed: report.summary.passedChecks, failed: report.summary.failedChecks, remaining: report.summary.remainingChecks, reportPath }));
  process.exitCode = report.status === 'passed' ? 0 : report.summary.failedChecks || report.executionError || report.setupError ? 1 : 2;
});
