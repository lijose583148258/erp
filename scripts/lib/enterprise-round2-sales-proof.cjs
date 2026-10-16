const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');

// Deliberately independent of Prisma, Playwright, the producer's assertions and
// fixture code. Both catalog IDs must consume this SAME immutable chain.
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rawHash = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => JSON.parse(JSON.stringify(value));
const same = (a, b, label) => assert.deepEqual(json(a), json(b), label);
const parse = (value, label) => { assert.equal(typeof value, 'string', label); try { return JSON.parse(value); } catch { assert.fail(`${label}: invalid JSON`); } };
const id = (value, label) => { assert(Number.isSafeInteger(value) && value > 0, `${label}: positive safe ID required`); return value; };
function scaled(value, precision, label) {
  assert(value !== null && value !== undefined && value !== '' && typeof value !== 'boolean', `${label}: missing numeric fact`);
  assert(['string', 'number'].includes(typeof value), `${label}: invalid numeric type`);
  const text = String(value); assert(/^-?\d+(?:\.\d+)?$/.test(text), `${label}: invalid decimal`);
  const [integer, fraction = ''] = text.split('.'); assert(fraction.length <= precision, `${label}: excessive precision`);
  const n = BigInt(integer) * 10n ** BigInt(precision) + BigInt((integer.startsWith('-') ? '-' : '') + (fraction.padEnd(precision, '0') || '0'));
  assert(n <= BigInt(Number.MAX_SAFE_INTEGER) && n >= BigInt(Number.MIN_SAFE_INTEGER), `${label}: unsafe decimal`); return n;
}
const qty = (value, expected, label) => assert.equal(scaled(value, 6, label), BigInt(expected) * 1000000n, label);
const money = (value, expected, label) => assert.equal(scaled(value, 2, label), BigInt(expected) * 100n, label);
const sum = (rows, field, p) => rows.reduce((n, row) => n + scaled(row[field], p, field), 0n);
const normalizedPath = action => String(action.path || '').replace(/^\/api(?=\/)/, '');
const data = response => { const status = response?.status ?? response?.http?.status; assert(status >= 200 && status < 300, 'Missing successful original HTTP response'); assert(response.json?.data, 'Missing original JSON data'); return response.json.data; };
const fixedMoney = value => { const cents = scaled(value, 2, 'Immutable money'); return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`; };
const projection = (row, fields) => Object.fromEntries(fields.map(field => [field, ['amountNative', 'baseAmount', 'payableAmountNative', 'payableAmountBase'].includes(field) ? fixedMoney(row[field]) : row[field]]));
const stages = { firstReserved: [100, 0, 0], firstReleased: [0, 0, 0], firstReheld: [100, 0, 0], firstDispatched: [0, 100, 0],
  partialAccepted: [0, 100, 100], secondReserved: [50, 100, 100], secondDispatched: [0, 150, 100], fullyAccepted: [0, 150, 150] };
const aliases = { lead: ['sales_lead', 1], buyer1: ['buyer', 1], buyer2: ['buyer', 2], salesPeer: ['sales', 2], cost: ['cost_accountant', 1] };
const denialContracts = [
  ['sales cannot confirm own order', 'sales', 403], ['source confirmer cannot approve own sources', 'buyer2', 409],
  ['late quote/specification may remain blank only in draft', 'owner', 409],
  ['warehouse cannot read full orders', 'warehouse', 403], ['warehouse cannot read financial payables', 'warehouse', 403],
  ['foreign sales cannot read this customer order', 'salesPeer', 404], ['missing batch cannot reserve remainder', 'warehouse', 409],
  ['shortage cannot dispatch remainder', 'warehouse', 409], ['sales cannot reserve physical stock', 'sales', 403],
  ['QA hold freezes independent payment verification', 'owner', 409], ['QA hold blocks reservation of the real received batch', 'warehouse', 409],
  ['QA hold blocks dispatch of the real received batch', 'warehouse', 409], ['inspector cannot independently release own sample', 'qc', 403],
];

function verifySharedSalesChain(e, provider) {
  e = json(e); // Date / Prisma Decimal use exactly the artifact JSON representation.
  assert.equal(e?.version, 'shared-sales-chain/v1'); assert.equal(e.status, 'passed');
  assert(typeof e.runId === 'string' && e.runId.trim(), 'Missing run ID'); assert(['sqlite', 'postgresql'].includes(e.provider));
  if (provider !== undefined) assert.equal(e.provider, provider, 'Provider mismatch');
  assert.match(e.chainDigest || '', /^[a-f0-9]{64}$/);
  assert.equal(e.chainDigest, hash({ manifest: e.manifest, actions: e.actions, final: e.final, browser: e.browser, qualityBrowser: e.qualityBrowser }), 'Shared chain digest mismatch');
  const m = e.manifest, f = e.final; assert(m && f);
  for (const field of ['orderId', 'orderItemId', 'customerId', 'materialId', 'purchaseOrderId', 'purchaseReceiptId', 'replenishmentBatchId', 'paymentRecordId', 'supplierPaymentId', 'qualityCheckId', 'planId']) id(m[field], `manifest.${field}`);
  for (const field of ['orderNo', 'existingBatch', 'replenishmentBatch']) assert(typeof m[field] === 'string' && m[field].trim(), field);
  assert.notEqual(m.existingBatch, m.replenishmentBatch); qty(m.orderedQuantity, 150); qty(m.existingQuantity, 100); qty(m.plannedQuantity, 50); money(m.orderAmount, 1500); assert.equal(m.unit, 'kg');
  assert.equal(m.shipmentIds?.length, 2); m.shipmentIds.forEach(value => id(value, 'shipment ID')); assert.notEqual(...m.shipmentIds);
  assert.equal(e.workforce?.configurationOnly, true); assert.equal(e.workforce.participationNotYetProven, true);
  const actors = e.workforce.actors; assert.equal(actors?.length, 20); assert.equal(new Set(actors.map(a => a.id)).size, 20);
  const counts = { owner: 1, sales_lead: 1, sales: 3, buyer: 2, warehouse: 3, production_planner: 1, production_operator: 2, research: 1, qc: 1, qa: 1, receivables: 1, payables: 1, cost_accountant: 1, system_admin: 1 };
  for (const [job, count] of Object.entries(counts)) assert.equal(actors.filter(a => a.job === job).length, count, `Cohort ${job}`);
  for (const a of actors) {
    id(a.id, 'Actor'); assert.match(a.role || '', /^r2wf_[a-f0-9]{12}_[a-z_]+$/, 'Real dynamic least-privilege role required');
    for (const instance of [0, 1]) {
      const p = a.profilesByInstance?.[instance]; assert(p && p.id === a.id && p.role === a.role, 'Missing authoritative dual-node profile');
      assert.equal(p.isActive, true); assert.equal(p.mustChangePassword, false);
      for (const field of ['permissions', 'dataScopes']) { assert(Array.isArray(p[field])); assert.equal(new Set(p[field]).size, p[field].length); }
      assert(!p.dataScopes.includes('all'), 'Unrestricted all scope is forbidden');
      same(projection(p, ['id', 'username', 'role', 'permissions', 'dataScopes']), projection(a.profile, ['id', 'username', 'role', 'permissions', 'dataScopes']), 'Profile drift');
    }
  }
  const actor = job => { const [real, index] = aliases[job] || [job, 1]; const matches = actors.filter(a => a.job === real && a.index === index); assert.equal(matches.length, 1, `Missing independent actor ${job}`); return matches[0]; };
  const warehouse = actor('warehouse'); assert(!warehouse.profile.permissions.includes('orders.read')); assert(!warehouse.profile.permissions.some(p => p.startsWith('finance.'))); assert(!warehouse.profile.dataScopes.includes('finance_visible'));
  assert(warehouse.profile.permissions.includes('orders.shippingReady.read')); assert(!actor('qc').profile.permissions.includes('procurement.quality.release'));
  assert(!actor('qa').profile.permissions.includes('procurement.quality.inspect')); assert(!actor('payables').profile.permissions.includes('procurement.payment.verify'));
  for (const [job, permission] of [['sales', 'orders.create'], ['lead', 'orders.status.manage'], ['buyer1', 'procurement.write'], ['buyer2', 'procurement.write'], ['owner', 'procurement.payment.verify'], ['warehouse', 'shipping.write'], ['qc', 'procurement.quality.inspect'], ['qa', 'procurement.quality.release'], ['receivables', 'orders.payment.verify'], ['payables', 'procurement.payment.record'], ['cost', 'production.cost.read']]) assert(actor(job).profile.permissions.includes(permission), `${job} lacks authoritative grant`);
  const actionActor = row => { const a = actor(row.job); assert.equal(row.actorId, a.id, `Wrong actor for ${row.job}`); if (row.role !== undefined) assert.equal(row.role, a.role); assert([0, 1].includes(row.instance)); return a; };
  assert(Array.isArray(e.actions) && e.actions.length > 20); e.actions.forEach(actionActor);
  for (const browser of [e.browser, e.qualityBrowser]) { assert.equal(browser?.runId, e.runId, 'Browser from different run'); assert(browser.actions?.length); browser.actions.forEach(actionActor); }
  const action = (job, method, endpoint, status) => {
    const rows = [...e.actions, ...e.browser.actions, ...e.qualityBrowser.actions].filter(a => a.job === job && a.method === method && normalizedPath(a) === endpoint && a.status === status);
    assert(rows.length, `Missing actual ${job} ${method} ${endpoint} ${status}`); return rows[0];
  };
  const browserOriginal = (response, browser, job, method, endpoint, status) => {
    const http = response?.http; assert(http, 'Missing captured browser original'); assert.equal(http.job, job); assert.equal(http.method, method); assert.equal(normalizedPath(http), endpoint); assert.equal(http.status, status);
    same(response.json, http.json, 'Browser ACK differs from network original'); assert(browser.actions.some(row => hash(row) === hash(http)), 'Browser original missing from captured network'); actionActor(http);
  };
  const audit = (auditId, userId, resource, resourceId, verb, details) => {
    const rows = f.audits.filter(a => a.id === auditId); assert.equal(rows.length, 1, `Missing immutable audit ${auditId}`); const a = rows[0];
    assert.equal(a.userId, userId, 'Audit identity mismatch'); assert.equal(a.resource, resource); assert.equal(a.resourceId, resourceId); assert.equal(a.action, verb);
    if (details !== undefined) same(parse(a.details, verb), details, `${verb} immutable payload`); return a;
  };
  const order = row => {
    assert.equal(Number(row.id), m.orderId); assert.equal(Number(row.customerId), m.customerId); assert.equal(row.orderNo, m.orderNo);
    money(row.finalAmount, 1500, 'Original order amount'); money(row.paidAmount, 1500, 'Verified AR'); assert.equal(row.items?.length, 1);
    const item = row.items[0]; assert.equal(item.id, m.orderItemId); assert.equal(item.materialId, m.materialId); qty(item.quantity, 150, 'Original demand'); money(item.unitPrice, 10); assert.equal(item.unit, 'kg');
  };
  const snapshots = [e.stages.beforeDraft, e.stages.afterDraft, e.stages.beforeQC, ...Object.keys(stages).map(name => e.stages[name]?.snapshot), f];
  for (const s of snapshots) {
    assert(s, 'Missing business snapshot'); order(s.order); assert.equal(s.order.paymentRecords?.length, 1); const ar = s.order.paymentRecords[0];
    assert.equal(ar.id, m.paymentRecordId); assert.equal(ar.orderId, m.orderId); assert.equal(ar.status, 'verified'); assert.equal(ar.verifiedBy, actor('receivables').id); money(ar.amount, 1500);
    for (const b of s.balances) { assert.equal(b.materialId, m.materialId); assert(scaled(b.quantity, 6, 'Physical balance') >= 0n); }
  }
  for (const field of ['balances', 'batches', 'entries', 'costs']) same(e.stages.beforeDraft[field], e.stages.afterDraft[field], 'Draft must not post stock or cost');
  for (const name of ['firstReserved', 'firstReleased', 'firstReheld']) for (const field of ['balances', 'batches', 'entries', 'costs']) same(e.stages.afterDraft[field], e.stages[name].snapshot[field], 'Hold/release must not post physical/cost');
  for (const [s, physical, carrying] of [[e.stages.beforeDraft, 100, 1000], [e.stages.afterDraft, 100, 1000], [e.stages.beforeQC, 50, 500], ...Object.entries(stages).map(([name]) => [e.stages[name].snapshot, ['firstReserved', 'firstReleased', 'firstReheld'].includes(name) ? 100 : name === 'secondReserved' ? 50 : 0, ['firstReserved', 'firstReleased', 'firstReheld'].includes(name) ? 1000 : name === 'secondReserved' ? 500 : 0])]) {
    assert.equal(sum(s.balances, 'quantity', 6), BigInt(physical) * 1000000n, 'Physical stage total'); assert.equal(sum(s.costs, 'costAmountDelta', 2), BigInt(carrying) * 100n, 'Carrying cost stage total');
  }
  action('sales', 'POST', '/orders', 201); action('lead', 'PATCH', `/orders/${m.orderId}/status`, 200);
  action('sales', 'POST', `/orders/${m.orderId}/payment`, 200); action('receivables', 'POST', `/orders/${m.orderId}/payment/${m.paymentRecordId}/verify`, 200);
  const arAudits = f.audits.filter(a => a.resource === 'payment' && a.resourceId === m.paymentRecordId && a.action === 'PAYMENT_VERIFIED');
  assert.equal(arAudits.length, 1, 'AR verification must have exactly one immutable audit');
  assert.equal(arAudits[0].userId, actor('receivables').id); const arEvent = parse(arAudits[0].details, 'AR event');
  assert.equal(arEvent.orderId, m.orderId); assert.equal(arEvent.paymentId, m.paymentRecordId); money(arEvent.amount, 1500);
  assert.equal(arEvent.currency, 'CNY'); assert.equal(arEvent.verifiedBy, actor('receivables').id);
  assert.equal(arEvent.eventKey, `payment.verified:${m.paymentRecordId}`); assert(typeof arEvent.eventId === 'string' && arEvent.eventId.trim());
  for (const [name, job, status] of denialContracts) {
    const rows = e.denials?.filter(d => d.name === name); assert.equal(rows?.length, 1, `Missing rejection ${name}`); const d = rows[0]; assert.equal(d.job, job);
    assert(Number.isSafeInteger(d.actionIndex)); const a = e.actions[d.actionIndex]; assert(a); assert.equal(a.job, job); assert.equal(a.status, status); same(d.before, d.after, `${name}: rejected request changed business state`);
    assert.equal(d.before?.order?.id, m.orderId, 'Rejection snapshot belongs to another order');
    assert.equal(d.before.order.customerId, m.customerId); assert.equal(d.before.order.items?.length, 1);
    assert.equal(d.before.order.items[0].id, m.orderItemId); assert.equal(d.before.order.items[0].materialId, m.materialId); qty(d.before.order.items[0].quantity, 150);
    for (const field of ['shipments', 'checks', 'supplierPayments', 'plans', 'balances', 'batches', 'entries', 'costs', 'audits']) assert(Array.isArray(d.before[field]), `Missing rejection snapshot ${field}`);
    assert(d.before.balances.length && d.before.costs.length, 'Missing real rejection stock/cost facts');
    for (const balance of d.before.balances) { assert.equal(balance.materialId, m.materialId); assert(scaled(balance.quantity, 6, 'Rejected physical balance') >= 0n); }
  }
  const deniedTargets = [
    ['sales cannot confirm own order', 'PATCH', `/orders/${m.orderId}/status`, 'orders.status.manage'],
    ['late quote/specification may remain blank only in draft', 'PATCH', `/procurement/orders/${m.purchaseOrderId}/status`, null, 'PURCHASE_GOVERNANCE_SOURCE_REQUIRED'],
    ['source confirmer cannot approve own sources', 'PATCH', `/procurement/orders/${m.purchaseOrderId}/status`, null, 'PURCHASE_INDEPENDENT_APPROVAL_REQUIRED'],
    ['warehouse cannot read full orders', 'GET', `/orders/${m.orderId}`, 'orders.read'],
    ['warehouse cannot read financial payables', 'GET', '/procurement/payables', 'finance.read'],
    ['foreign sales cannot read this customer order', 'GET', `/orders/${m.orderId}`],
    ['missing batch cannot reserve remainder', 'POST', `/shipping/${m.shipmentIds[1]}/reserve`, null, 'SHIPMENT_RESERVATION_IDENTITY_REQUIRED'],
    ['shortage cannot dispatch remainder', 'PATCH', `/shipping/${m.shipmentIds[1]}/status`, null, 'SHIPMENT_BATCH_REQUIRED_BEFORE_DISPATCH'],
    ['sales cannot reserve physical stock', 'POST', `/shipping/${m.shipmentIds[0]}/reserve`, 'shipping.write'],
    ['QA hold freezes independent payment verification', 'POST', `/procurement/supplier-payments/${m.supplierPaymentId}/verify`, null, 'INCOMING_QA_RELEASE_REQUIRED'],
    ['QA hold blocks reservation of the real received batch', 'POST', `/shipping/${m.shipmentIds[1]}/reserve`, null, `STOCK_QC_RELEASE_REQUIRED:${m.replenishmentBatch}:hold：批次未放行，禁止发料或出库`],
    ['QA hold blocks dispatch of the real received batch', 'PATCH', `/shipping/${m.shipmentIds[1]}/status`, null, `STOCK_MATERIAL_BATCH_NOT_RELEASED:${m.replenishmentBatch}:hold`],
    ['inspector cannot independently release own sample', 'POST', `/procurement/quality-checks/${m.qualityCheckId}/review`, 'procurement.quality.release'],
  ];
  for (const [name, method, endpoint, permission, code] of deniedTargets) {
    const d = e.denials.find(row => row.name === name), a = e.actions[d.actionIndex];
    assert.equal(a.method, method, `${name}: wrong rejected method`); assert.equal(a.path, endpoint, `${name}: wrong rejected subject`); assert.equal(a.json.success, false);
    if (permission) same(a.json.requiredPermissions, [permission], `${name}: wrong required permission`);
    if (code) assert.equal(a.json.errorCode || a.json.message, code, `${name}: unrelated conflict`);
    if (name.startsWith('QA hold')) assert.equal(d.before.batches.find(b => b.id === m.replenishmentBatchId)?.qualityStatus, 'hold');
  }
  const po = f.purchase; assert.equal(po?.id, m.purchaseOrderId); assert.equal(po.salesOrderId, m.orderId); assert.equal(po.materialId, m.materialId); qty(po.quantity, 50); money(po.price, 10); assert.equal(po.unit, 'kg'); assert.equal(po.currency, 'CNY');
  const pendingPO = e.purchaseDraft; assert(pendingPO, 'Missing actual incomplete purchase draft');
  assert.equal(Number(pendingPO.id), po.id); assert.equal(Number(pendingPO.salesOrderId), m.orderId); assert.equal(pendingPO.status, 'pending');
  assert.equal(pendingPO.supplierPayableBasisJson, null); assert.equal(pendingPO.incomingQualityPlanJson, null);
  const createdPO = action('buyer1', 'POST', '/procurement/orders', 201); same(createdPO.json.data, pendingPO, 'Incomplete PO is not the original response');
  for (const field of ['supplierPayableBasis', 'incomingQualityPlan']) assert(createdPO.sent[field] == null, 'Unknown source must not be fabricated');
  const missingSource = e.denials.find(d => d.name === 'late quote/specification may remain blank only in draft');
  const missingSourceAction = e.actions[missingSource.actionIndex]; assert.equal(missingSourceAction.method, 'PATCH');
  assert.equal(missingSourceAction.path, `/procurement/orders/${po.id}/status`); assert.equal(missingSourceAction.json.errorCode, 'PURCHASE_GOVERNANCE_SOURCE_REQUIRED');
  action('buyer1', 'POST', '/procurement/orders', 201); action('buyer2', 'POST', `/procurement/orders/${po.id}/confirm-sources`, 200); action('owner', 'PATCH', `/procurement/orders/${po.id}/status`, 200);
  const sourceAudits = f.audits.filter(a => a.resource === 'purchase_order' && a.resourceId === po.id);
  const created = sourceAudits.filter(a => a.action === 'CREATE'), sources = sourceAudits.filter(a => a.action === 'CONFIRM_SOURCES');
  assert.equal(created.length, 1); assert.equal(created[0].userId, actor('buyer1').id); assert.equal(sources.length, 1); assert.equal(sources[0].userId, actor('buyer2').id);
  const sourceDetails = parse(sources[0].details, 'Source confirmation'); assert.equal(sourceDetails.schema, 'purchase-source-confirmation/v1');
  assert.equal(sourceDetails.source.supplierPayableHash, rawHash(po.supplierPayableBasisJson)); assert.equal(sourceDetails.source.incomingQualityHash, rawHash(po.incomingQualityPlanJson));
  const approvals = sourceAudits.filter(a => a.action === 'STATUS_CHANGE' && parse(a.details, 'PO status').isSourceApproval === true); assert.equal(approvals.length, 1); assert.equal(approvals[0].userId, actor('owner').id);
  const approval = parse(approvals[0].details, 'Approval'); assert.equal(approval.sourceAuditId, sources[0].id); assert.equal(approval.schema, 'purchase-status/v2'); assert.equal(approval.revision, po.revision); assert(created[0].id < sources[0].id && sources[0].id < approvals[0].id);
  assert.equal(po.receipts?.length, 1); const receipt = po.receipts[0]; assert.equal(receipt.id, m.purchaseReceiptId); assert.equal(receipt.batchId, m.replenishmentBatchId); assert.equal(receipt.batchNo, m.replenishmentBatch); assert.equal(receipt.batchNo, `PO-${po.id}-RCV-${receipt.receiptNo}`); assert.equal(receipt.receivedBy, warehouse.id);
  qty(receipt.quantity, 50); qty(receipt.acceptedQuantity, 50); qty(receipt.rejectedQuantity, 0); money(receipt.payableAmountNative, 500); money(receipt.payableAmountBase, 500);
  const purchaseAck = data(e.purchaseReceipt).submission; assert.equal(purchaseAck.schema, 'purchase-receipt-submission/v2'); same(parse(receipt.submissionJson, 'Receipt stored ACK'), purchaseAck);
  same(projection(receipt, Object.keys(purchaseAck.receipt)), purchaseAck.receipt, 'Receipt DB/ACK mismatch'); assert.equal(receipt.submissionKey, purchaseAck.key); assert.equal(receipt.submissionFingerprint, purchaseAck.fingerprint);
  assert.equal(purchaseAck.fingerprint, hash({ schema: 'purchase-receipt-facts/v2', ...purchaseAck.facts })); assert.equal(purchaseAck.facts.receivedBy, warehouse.id); assert.equal(purchaseAck.facts.purchaseOrderId, po.id); qty(purchaseAck.facts.quantity, 50); assert.equal(purchaseAck.facts.batchNo, receipt.supplierBatchNo);
  audit(purchaseAck.auditId, warehouse.id, 'purchase_order', po.id, 'CREATE_RECEIPT', { schema: 'purchase-receipt-audit/v2', receiptId: receipt.id, receiptNo: receipt.receiptNo, submissionKeyHash: rawHash(purchaseAck.key), fingerprint: purchaseAck.fingerprint, receiptHash: hash(purchaseAck.receipt) });
  const payable = parse(receipt.payableSnapshotJson, 'Frozen AP'); assert.equal(payable.purchaseOrderId, po.id); assert.equal(payable.batchNo, receipt.batchNo); assert.equal(payable.receivedBy, warehouse.id); assert.equal(payable.source.sourceAuditId, sources[0].id); assert.equal(payable.source.approvalAuditId, approvals[0].id); qty(payable.allocation.receivedQuantity, 50); money(payable.allocation.amountNative, 500); money(payable.allocation.amountBase, 500);
  for (const [bundle, eligible] of [[e.apBeforeQA, false], [e.apAfterQA, true]]) { assert.equal(bundle?.purchaseReceiptId, receipt.id); assert.equal(bundle.currency, 'CNY'); assert.equal(bundle.payableAmountNative, '500.00'); assert.equal(bundle.paidAmountNative, '0.00'); assert.equal(bundle.paymentEligibility.eligible, eligible); }
  const beforeQC = e.stages.beforeQC; assert.equal(beforeQC.batches.find(b => b.id === receipt.batchId)?.qualityStatus, 'hold'); assert.equal(beforeQC.checks.length, 0); assert.equal(beforeQC.supplierPayments.length, 1); assert.equal(beforeQC.supplierPayments[0].status, 'draft');
  const relocation = data(e.heldRelocation); assert(relocation); assert.equal(e.heldRelocation.status, 201); // Internal RM->FG relocation is NOT QA or another receipt.
  same(beforeQC.costs, e.stages.secondReserved.snapshot.costs, 'QC/QA/AP/relocation must not add receipt cost');
  assert.equal(f.checks?.length, 1); const check = f.checks[0], qcAck = data(e.inspection).submission, inspection = qcAck.inspection, review = data(e.qa).review;
  browserOriginal(e.inspection, e.qualityBrowser, 'qc', 'POST', `/procurement/receipts/${receipt.id}/quality-checks`, 201);
  browserOriginal(e.qa, e.qualityBrowser, 'qa', 'POST', `/procurement/quality-checks/${check.id}/review`, 200);
  assert.equal(check.id, m.qualityCheckId); assert.equal(check.purchaseReceiptId, receipt.id); assert.equal(check.inspectorUserId, actor('qc').id); assert.equal(check.reviewedByUserId, actor('qa').id); assert.notEqual(check.inspectorUserId, check.reviewedByUserId); assert.equal(check.status, 'released'); assert.equal(check.result, 'pass');
  assert.equal(qcAck.schema, 'incoming-quality-submission/v1'); same(parse(check.submissionJson, 'QC stored ACK'), qcAck); assert.equal(inspection.purchaseReceiptId, receipt.id); assert.equal(inspection.inspectorUserId, actor('qc').id); assert.equal(inspection.id, check.id); assert.equal(inspection.planHash, rawHash(receipt.incomingQualityPlanJson));
  same(parse(check.measurementsJson, 'QC measurements'), inspection.measurements); assert.equal(inspection.result, 'pass'); const ph = inspection.measurements.find(v => v.code === 'PH'); assert(ph && ph.instrumentNo); assert.equal(ph.result, 'pass'); assert.equal(Number(ph.measuredNumeric), 7.5); assert.equal(Number(ph.lowerLimit), 7); assert.equal(Number(ph.upperLimit), 8);
  const qcInput = { sampleNo: inspection.sampleNo, measurements: inspection.measurements.map(v => ({ code: v.code, unit: v.unit, measuredNumeric: v.measuredNumeric, measuredText: v.measuredText, instrumentNo: v.instrumentNo })), note: inspection.note };
  assert.equal(qcAck.fingerprint, hash({ schema: 'incoming-quality-facts/v1', purchaseReceiptId: receipt.id, inspectorUserId: actor('qc').id, ...qcInput })); assert.equal(check.requestKey, qcAck.key); assert.equal(check.fingerprint, qcAck.fingerprint);
  audit(qcAck.auditId, actor('qc').id, 'incoming_quality', check.id, 'CREATE_INCOMING_QC', { schema: 'incoming-quality-submit-audit/v1', requestKeyHash: rawHash(qcAck.key), fingerprint: qcAck.fingerprint, inspectionHash: hash(inspection), purchaseReceiptId: receipt.id });
  same(parse(check.reviewJson, 'QA stored ACK'), review); assert.equal(review.checkId, check.id); assert.equal(review.purchaseReceiptId, receipt.id); assert.equal(review.reviewedByUserId, actor('qa').id); assert.equal(review.decision, 'released'); assert.equal(review.inspectionHash, hash(inspection));
  const { auditId: reviewAuditId, ...reviewFacts } = review; audit(reviewAuditId, actor('qa').id, 'incoming_quality', check.id, 'REVIEW_INCOMING_QC', { schema: 'incoming-quality-review-audit/v1', reviewHash: hash(reviewFacts), checkId: check.id, purchaseReceiptId: receipt.id }); assert(qcAck.auditId < reviewAuditId);
  assert.equal(f.supplierPayments?.length, 1); const payment = f.supplierPayments[0], apAck = data(e.supplierPayment).submission, verify = data(e.supplierPaymentVerification).verification;
  browserOriginal(e.supplierPayment, e.qualityBrowser, 'payables', 'POST', `/procurement/receipts/${receipt.id}/payments`, 201);
  assert.equal(payment.id, m.supplierPaymentId); assert.equal(payment.purchaseReceiptId, receipt.id); assert.equal(payment.submittedByUserId, actor('payables').id); assert.equal(payment.verifiedByUserId, actor('owner').id); assert.notEqual(payment.submittedByUserId, payment.verifiedByUserId); assert.equal(payment.status, 'verified'); money(payment.amountNative, 500); money(payment.baseAmount, 500);
  same(parse(payment.submissionJson, 'AP stored proposal'), apAck); assert.equal(apAck.schema, 'supplier-payment-submission/v1'); same(projection(payment, Object.keys(apAck.payment)), apAck.payment); assert.equal(apAck.allocationBasis.payableSnapshotJson, receipt.payableSnapshotJson); assert.equal(apAck.allocationBasis.receiptSubmissionHash, hash(receipt.submissionJson));
  audit(apAck.auditId, actor('payables').id, 'supplier_payment', payment.id, 'SUPPLIER_PAYMENT_DRAFTED', { schema: 'supplier-payment-submit-audit/v1', paymentId: payment.id, purchaseReceiptId: receipt.id, submissionKeyHash: rawHash(apAck.key), fingerprint: apAck.fingerprint, paymentHash: hash(apAck.payment), allocationHash: hash(apAck.allocationBasis) });
  same(parse(payment.verificationJson, 'AP stored verification'), verify); assert.equal(verify.paymentId, payment.id); assert.equal(verify.purchaseReceiptId, receipt.id); assert.equal(verify.verifiedByUserId, actor('owner').id); assert.equal(verify.submittedByUserId, actor('payables').id); assert.equal(verify.qualityCheckId, check.id); assert.equal(verify.qualityReviewerUserId, actor('qa').id); assert.equal(verify.draftAuditId, apAck.auditId); assert.equal(verify.amountNative, '500.00'); assert.equal(verify.paidAmountNativeBefore, '0.00'); assert.equal(verify.paidAmountNativeAfter, '500.00');
  const { auditId: paymentAuditId, ...verificationFacts } = verify; audit(paymentAuditId, actor('owner').id, 'supplier_payment', payment.id, 'SUPPLIER_PAYMENT_VERIFIED', { schema: 'supplier-payment-decision-audit/v1', paymentId: payment.id, purchaseReceiptId: receipt.id, decisionHash: hash(verificationFacts) }); assert(paymentAuditId > reviewAuditId);
  assert.equal(f.shipments?.length, 2); same(f.shipments.map(s => s.id), m.shipmentIds); assert.equal(f.batches?.length, 2);
  for (const [index, quantity] of [[0, 100], [1, 50]]) {
    const s = f.shipments[index], draft = e.drafts?.[index], batchNo = index ? m.replenishmentBatch : m.existingBatch;
    browserOriginal(draft, e.browser, 'warehouse', 'POST', '/shipping', 201);
    assert.equal(s.orderId, m.orderId); assert.equal(s.orderItemId, m.orderItemId); assert.equal(s.materialId, m.materialId); assert.equal(s.customerId, m.customerId); assert.equal(s.createdBy, warehouse.id); qty(s.quantity, quantity); assert.equal(s.status, 'delivered'); assert.equal(s.batchNo, batchNo); assert.equal(s.reservationState, 'consumed');
    const ack = draft?.submission; assert.equal(ack?.schema, 'shipment-submission/v1'); assert.equal(ack.actorId, warehouse.id); same(parse(s.submissionJson, 'Shipment stored ACK'), ack); assert.equal(ack.fingerprint, hash({ actorId: warehouse.id, facts: ack.facts })); assert.equal(ack.shipment.id, s.id); qty(ack.facts.quantity, quantity); assert.equal(ack.facts.orderId, m.orderId); assert.equal(ack.facts.orderItemId, m.orderItemId); assert.equal(ack.shipment.batchNo, index ? null : batchNo);
    audit(ack.auditId, warehouse.id, 'shipment', s.id, 'CREATE', { schema: 'shipment-create/v1', key: ack.key, fingerprint: ack.fingerprint, actorId: ack.actorId, facts: ack.facts, shipment: ack.shipment });
    const reservationAudits = f.audits.filter(a => a.resource === 'shipment' && a.resourceId === s.id && ['RESERVE_STOCK', 'RELEASE_STOCK', 'CONSUME_RESERVATION'].includes(a.action));
    same(reservationAudits.map(a => a.action), index ? ['RESERVE_STOCK', 'CONSUME_RESERVATION'] : ['RESERVE_STOCK', 'RELEASE_STOCK', 'RESERVE_STOCK', 'CONSUME_RESERVATION']);
    let previous = null; for (const a of reservationAudits) { assert.equal(a.userId, warehouse.id); const v = parse(a.details, 'Reservation'); assert.equal(v.schema, 'shipment-reservation/v1'); assert.equal(v.actorId, warehouse.id); assert.equal(v.shipmentId, s.id); assert.equal(v.materialId, m.materialId); assert.equal(v.batchNo, batchNo); qty(v.quantity, quantity); assert.equal(v.previousAuditId, previous); previous = a.id; }
    assert.equal(s.reservationAuditId, previous);
    assert.equal(s.receipts.length, 1); const receiptAck = data(index ? e.secondReceipt : e.firstReceipt).submission;
    browserOriginal(index ? e.secondReceipt : e.firstReceipt, e.browser, 'warehouse', 'POST', `/shipping/${s.id}/receipt-events`, 201);
    for (const [endpoint, method, status] of [[`/shipping/${s.id}/reserve`, 'POST', 201], [`/shipping/${s.id}/status`, 'PATCH', 200]]) assert(e.browser.actions.some(row => row.job === 'warehouse' && normalizedPath(row) === endpoint && row.method === method && row.status === status), 'Warehouse action was not performed in browser');
    assert.equal(receiptAck.schema, 'shipment-receipt-submission/v1'); assert.equal(receiptAck.actorId, warehouse.id); assert.equal(receiptAck.shipmentId, s.id); assert.equal(receiptAck.fingerprint, hash({ shipmentId: s.id, actorId: warehouse.id, facts: receiptAck.facts }));
    same(projection(s.receipts[0], Object.keys(receiptAck.receipt)), receiptAck.receipt); qty(receiptAck.receipt.quantity, quantity); qty(receiptAck.receipt.acceptedQuantity, quantity); qty(receiptAck.facts.acceptedQuantity, quantity); qty(receiptAck.facts.rejectedQuantity, 0);
    const { auditId: receiptAuditId, ...receiptEvent } = receiptAck; audit(receiptAuditId, warehouse.id, 'shipment', s.id, 'CREATE_RECEIPT_EVENT', receiptEvent); assert(previous < receiptAuditId); if (index) assert(previous > paymentAuditId);
    const issues = f.entries.filter(v => v.sourceType === 'shipping_issue' && v.sourceRef === s.shipmentNo); assert.equal(issues.length, 1); assert.equal(issues[0].movements.length, 1); qty(issues[0].movements[0].quantityDelta, -quantity); assert.equal(issues[0].movements[0].batchNo, batchNo);
    const batch = f.batches.find(b => b.batchNo === batchNo); assert(batch); assert.equal(batch.id, s.productBatchId); qty(batch.stockQuantity, 0); assert.equal(batch.materialId, m.materialId);
    const costs = f.costs.filter(c => c.batchId === batch.id); assert(costs.length >= 2); assert.equal(sum(costs, 'quantityDelta', 6), 0n); assert.equal(sum(costs, 'costAmountDelta', 2), 0n);
    assert.equal(sum(costs.filter(c => Number(c.quantityDelta) < 0), 'quantityDelta', 6), -BigInt(quantity) * 1000000n); assert.equal(sum(costs.filter(c => Number(c.quantityDelta) < 0), 'costAmountDelta', 2), -BigInt(quantity * 10) * 100n);
    const reads = e.costReadbacks?.filter(r => r.batchId === batch.id); assert.equal(reads?.length, 2); same(reads.map(r => r.instance).sort(), [0, 1]);
    for (const r of reads) { assert.equal(r.data.batch?.id, batch.id); for (const field of ['totalQuantityDelta', 'currentQuantity']) qty(r.data.summary[field], 0); for (const field of ['totalCostAmountDelta', 'currentCostAmount']) money(r.data.summary[field], 0); same(r.data.items.map(c => c.id).sort((a,b) => a-b), costs.map(c => c.id).sort((a,b) => a-b)); assert(e.actions.some(a => a.job === 'cost' && a.method === 'GET' && a.path === `/production/batches/${batch.id}/cost-ledger` && a.instance === r.instance && a.status === 200 && hash(a.json.data) === hash(r.data)), 'Cost node lacks matching original API response'); }
  }
  for (const balance of f.balances) qty(balance.quantity, 0); assert.equal(f.batches.find(b => b.id === receipt.batchId).qualityStatus, 'released');
  assert.equal(f.plans?.length, 1); const plan = f.plans[0]; assert.equal(plan.id, m.planId); assert.equal(plan.orderId, m.orderId); assert.equal(plan.orderItemId, m.orderItemId); assert.equal(plan.sourceDocumentId, po.id); assert.equal(plan.status, 'closed'); assert.equal(plan.createdBy, actor('sales').id); assert.equal(plan.approvedBy, actor('lead').id); assert.equal(plan.closedBy, actor('lead').id); qty(plan.plannedQuantity, 50);
  const close = parse(plan.closeoutSnapshot, 'Plan closeout'); for (const field of ['committedQuantity', 'receivedQuantity', 'deliveredFromSource']) qty(close[field], 50); assert.equal(close.stockChanged, false); assert.equal(close.moneyChanged, false); same(close.purchaseReceiptIds, [receipt.id]); same(close.shipmentIds, [m.shipmentIds[1]]); same(close.shipmentReceiptIds, f.shipments[1].receipts.map(r => r.id));
  same(data(e.planClose), data(e.planCloseReplay), 'Stable close replay changed ACK');
  const closeActions = e.actions.filter(a => a.job === 'lead' && a.method === 'POST' && a.path === `/orders/${m.orderId}/fulfillment-plans/${plan.id}/close` && a.status === 200); assert.equal(closeActions.length, 2); same(closeActions.map(a => a.instance).sort(), [0, 1]); same(closeActions[0].sent, closeActions[1].sent, 'Stable close key/facts changed'); assert(typeof closeActions[0].sent.idempotencyKey === 'string' && closeActions[0].sent.idempotencyKey.length >= 8);
  same(closeActions[0].json.data, data(e.planClose)); same(closeActions[1].json.data, data(e.planCloseReplay));
  same(e.planCloseReplaySnapshot, f, 'Missing or changed persisted business facts after close replay');
  same(e.afterReplaysSnapshot, f, 'Missing or changed persisted business facts after shipment/receipt/payment replays');
  const replayOriginal = (response, job, endpoint, instance, status, original) => {
    assert.equal(response?.status, status); assert(response.json?.data, 'Missing replay response');
    const matches = e.actions.filter(a => a.job === job && a.method === 'POST' && a.path === endpoint && a.instance === instance
      && a.status === status && hash(a.json) === hash(response.json));
    assert.equal(matches.length, 1, 'Replay lacks unique actual HTTP provenance');
    if (original) { assert.equal(matches[0].key, original.key); same(matches[0].sent, original.sent, 'Replay changed original submitted facts'); }
  };
  for (const [field, isReceipt] of [['shipmentReplays', false], ['receiptReplays', true]]) {
    assert.equal(e[field]?.length, 4, `Missing ${field} on both application nodes`);
    assert.equal(new Set(e[field].map(r => `${r.index}:${r.instance}`)).size, 4, 'Replay node/subject repeated');
    for (const r of e[field]) {
      assert([0, 1].includes(r.index) && [0, 1].includes(r.instance));
      const original = isReceipt ? [e.firstReceipt, e.secondReceipt][r.index] : e.drafts[r.index];
      const ack = isReceipt ? data(original).submission : original.submission;
      assert.equal(original.http.key, ack.key, 'Captured original stable key differs');
      replayOriginal(r.response, 'warehouse', isReceipt ? `/shipping/${m.shipmentIds[r.index]}/receipt-events` : '/shipping', r.instance, isReceipt ? 201 : 200, original.http);
      assert.equal(isReceipt ? data(r.response).replayed : r.response.json.replayed, true);
      same(isReceipt ? data(r.response).submission : r.response.json.submission, ack, 'Replay replaced immutable original confirmation');
    }
  }
  replayOriginal(e.supplierVerificationReplay, 'owner', `/procurement/supplier-payments/${payment.id}/verify`, 0, 200);
  const paymentReplay = data(e.supplierVerificationReplay); assert.equal(paymentReplay.replayed, true);
  same(paymentReplay.submission, apAck); same(paymentReplay.decision, verify); same(paymentReplay.verification, verify);
  same(paymentReplay.payment, data(e.supplierPaymentVerification).payment, 'Payment replay changed verified amount or identity');
  const planAudits = f.audits.filter(a => a.resource === 'sales_fulfillment_plan' && a.resourceId === plan.id); same(planAudits.map(a => a.action).sort(), ['APPROVE_SALES_FULFILLMENT_PLAN', 'CLOSE_SALES_FULFILLMENT_PLAN', 'CREATE_SALES_FULFILLMENT_PLAN']); for (const a of planAudits) assert.equal(a.userId, actor(a.action === 'CREATE_SALES_FULFILLMENT_PLAN' ? 'sales' : 'lead').id);
  verifyBrowserStages(e, actor);
  return { schema: 'enterprise-round2-shared-sales-proof/v1', status: 'passed', runId: e.runId, provider: e.provider,
    chainDigest: e.chainDigest, manifestDigest: hash(m), manifest: json(m), orderId: m.orderId, orderItemId: m.orderItemId,
    purchaseOrderId: po.id, purchaseReceiptId: receipt.id, shipmentIds: [...m.shipmentIds], orderedQuantity: 150, amount: '1500.00',
    acceptedQuantity: 150, outstandingQuantity: 0, fullWorkforceAccepted: false };
}

function raster(font) {
  assert(font?.glyphs?.length >= 8 && font.missingSignatures?.length >= 2, 'Missing actual CJK raster probe');
  assert(font.glyphs.every(g => Number.isFinite(g.inkPixels) && g.inkPixels > 0 && typeof g.signature === 'string' && !font.missingSignatures.includes(g.signature)), 'Blank CJK glyph');
  assert.equal(new Set(font.glyphs.map(g => g.signature)).size, font.glyphs.length, 'Identical missing glyphs');
}
function imagePath(file) {
  // Cloud Linux paths must remain verifiable after downloading onto Windows.
  assert(typeof file === 'string' && (/^[A-Za-z]:[\\/]/.test(file) || file.startsWith('/')), 'Absolute screenshot path required');
  assert(!file.split(/[\\/]/).includes('..') && /\.png$/i.test(file), 'Unsafe/non-PNG screenshot path');
}
function png(file) {
  const stat = fs.statSync(file); assert(stat.isFile() && stat.size > 24, 'Screenshot missing/empty');
  const fd = fs.openSync(file, 'r'); const header = Buffer.alloc(24); try { fs.readSync(fd, header, 0, 24, 0); } finally { fs.closeSync(fd); }
  assert.equal(header.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Screenshot must be an actual PNG'); assert(header.readUInt32BE(16) > 10 && header.readUInt32BE(20) > 10, 'Invalid screenshot dimensions');
}
function verifyBrowserStages(e, actor) {
  const m = e.manifest;
  for (const [permission, endpoint] of [['contracts.read', /^\/contracts(?:[/?]|$)/], ['assets.read', /^\/assets\/batches(?:[/?]|$)/]]) {
    if (!actor('sales').profile.permissions.includes(permission)) assert(!e.browser.actions.some(a => a.job === 'sales' && a.method === 'GET' && endpoint.test(normalizedPath(a))), 'Unauthorized optional sales lookup was requested');
  }
  for (const [browser, jobs] of [[e.browser, ['warehouse', 'sales']], [e.qualityBrowser, ['qc', 'qa', 'payables']]]) {
    for (const job of jobs) { const a = browser.actors?.find(v => v.job === job); assert(a, `Missing actual browser ${job}`); assert.equal(a.actorId ?? a.id, actor(job).id); assert.equal(a.role, actor(job).role); }
    assert(browser.screenshots?.length); for (const shot of browser.screenshots) { assert.equal(shot.actorId, actor(shot.job).id); assert.equal(shot.unobscured, true, 'Covered/unverified screenshot'); assert.notEqual(shot.unverified, true); assert.notEqual(shot.diagnostic, true); raster(shot.font); imagePath(shot.path); }
  }
  for (const job of ['qc', 'qa', 'payables']) {
    const rows = e.qualityBrowser.browserProfiles?.filter(r => r.job === job); assert(rows?.length, `Missing fresh ${job} auth/me`);
    for (const row of rows) {
      assert.equal(row.actorId, actor(job).id); assert.equal(row.path, '/api/auth/me'); assert.equal(row.status, 200);
      const expected = projection(actor(job).profile, ['id', 'role', 'permissions', 'dataScopes']);
      for (const field of ['permissions', 'dataScopes']) { assert(Array.isArray(row.actual[field])); assert.equal(new Set(row.actual[field]).size, row.actual[field].length); expected[field] = [...expected[field]].sort(); }
      same({ ...row.actual, permissions: [...row.actual.permissions].sort(), dataScopes: [...row.actual.dataScopes].sort() }, expected, 'Quality browser profile drift');
    }
  }
  assert.equal(e.browser.readbacks?.length, Object.keys(stages).length);
  for (const [name, [reserved, dispatched, accepted]] of Object.entries(stages)) {
    const s = e.stages[name], expected = { reservedQuantity: reserved, dispatchedQuantity: dispatched, acceptedQuantity: accepted, outstandingQuantity: 150 - accepted, orderedQuantity: 150 };
    same(s.expected, expected, `${name}: expected state cannot be supplied arbitrarily`);
    assert.equal(s.details?.length, 2); assert.equal(s.lists?.length, 2);
    for (const instance of [0, 1]) for (const [endpoint, payload] of [[`/orders/${m.orderId}`, s.details[instance]], [`/orders?search=${encodeURIComponent(m.orderNo)}`, s.lists[instance]]]) assert(e.actions.some(a => a.job === 'sales' && a.instance === instance && a.method === 'GET' && a.path === endpoint && a.status === 200 && hash(a.json?.data) === hash(payload)), `${name}: dual-node original API readback missing`);
    for (const row of [...s.details, ...s.lists.map(list => list.find(o => Number(o.id) === m.orderId))]) {
      assert(row); assert.equal(Number(row.id), m.orderId); money(row.finalAmount, 1500); money(row.paidAmount, 1500); const line = row.fulfillment?.lines?.find(l => l.orderItemId === m.orderItemId); assert(line);
      for (const [key, value] of Object.entries(expected)) qty(line[key], value, `${name}/${key}`);
    }
    const b = s.browser; assert(b); assert.equal(b.runId, e.runId); assert.equal(b.actorId, actor('sales').id); assert.equal(b.orderId, m.orderId); assert.equal(b.lineId, m.orderItemId); assert.equal(b.orderNo, m.orderNo); same(b.expected, expected);
    assert.equal(b.noPartialLoadWarning, true, `${name} has no verified clean workspace readback`);
    assert.equal(b.unobscured, true, `${name} DOM is covered`); raster(b.font); same(e.browser.readbacks.find(v => v.screenshot === b.screenshot), b, 'Stage/browser readback substitution'); imagePath(b.screenshot); imagePath(b.crop);
    assert.equal(b.testIds.reserved, `order-reserved-${m.orderId}-${m.orderItemId}`); assert.equal(b.testIds.obligation, `order-line-obligation-${m.orderId}-${m.orderItemId}`);
    assert.match(b.texts.reserved, new RegExp(`:\\s*${reserved}\\s*kg(?:$|\\s)`)); assert.match(b.texts.obligation, new RegExp(`已签收:\\s*${accepted}\\s*kg`)); assert.match(b.texts.obligation, new RegExp(`待交:\\s*${150 - accepted}\\s*kg`)); assert.match(b.texts.line, new RegExp(`${dispatched}\\s*kg\\s*/\\s*150\\s*kg`));
    assert.equal(s.snapshot.shipments.reduce((n, ship) => n + ship.receipts.reduce((v, r) => v + r.acceptedQuantity, 0), 0), accepted, 'DOM acceptance differs from persisted receipts');
  }
  assert.equal(e.qualityBrowser.readbacks?.length, 2); for (const eligible of [false, true]) {
    const rows = e.qualityBrowser.readbacks.filter(r => r.eligible === eligible); assert.equal(rows.length, 1); const r = rows[0]; assert.equal(r.receiptId, m.purchaseReceiptId); assert.equal(r.amountNative, '500.00'); assert.equal(r.actorId, actor('payables').id); assert.equal(r.screenshot.unobscured, true); raster(r.screenshot.font); assert.match(r.screenshot.text, /500\.00\s*CNY/); assert(r.screenshot.text.includes(eligible ? '最新独立QA放行证据已确认' : '付款核验冻结'));
  }
}

function verifySharedSalesBrowser(e, provider) {
  const proof = verifySharedSalesChain(e, provider);
  return { ...proof, schema: 'enterprise-round2-shared-sales-browser-proof/v1', sourceChainDigest: proof.chainDigest,
    scope: 'same original150 shared chain; physical warehouse and sales/QC/QA/AP browser evidence only', fullWorkforceAccepted: false };
}

// Optional local artifact check: resolve producer absolute paths into downloaded
// artifacts explicitly. Never treat an inaccessible cloud path as image proof.
function verifySharedSalesImages(e, resolve = file => file) {
  assert.equal(typeof resolve, 'function'); const files = [...e.browser.screenshots, ...e.qualityBrowser.screenshots].map(s => s.path);
  for (const file of files) { imagePath(file); png(resolve(file)); } return { imagesVerified: new Set(files).size };
}
module.exports = { verifySharedSalesChain, verifySharedSalesBrowser, verifySharedSalesImages };
