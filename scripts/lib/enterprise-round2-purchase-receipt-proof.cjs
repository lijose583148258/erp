const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

// Independent read-back checks, not producer flags or an import of the backend
// decision code. These narrow proofs do not complete incoming QA or payables.
const plain = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const fields = ['id', 'receiptNo', 'purchaseOrderId', 'quantity', 'acceptedQuantity', 'rejectedQuantity', 'unit', 'batchNo',
  'stockEntryRef', 'discrepancyReason', 'note', 'receivedBy', 'receivedAt', 'createdAt'];
const controlFields = ['supplierBatchNo', 'batchId', 'payableAmountNative', 'payableAmountBase', 'payableSnapshotJson', 'incomingQualityPlanJson'];
const receipt = (row, controlled = false) => Object.fromEntries([...fields, ...(controlled ? controlFields : [])].map(field => [field,
  controlled && ['payableAmountNative', 'payableAmountBase'].includes(field) ? moneyText(row[field]) : row[field]]));
function moneyText(value) {
  assert(value !== null && value !== undefined && typeof value !== 'boolean');
  const n = Number(value); assert(Number.isFinite(n) && n >= 0 && Number.isSafeInteger(Math.round(n * 100)) && Number(n.toFixed(2)) === n);
  return n.toFixed(2);
}
const cents = value => BigInt(moneyText(value).replace('.', ''));
const roundRatio = (n, d) => { assert(n >= 0n && d > 0n); return n / d + (n % d * 2n >= d ? 1n : 0n); };
function decimal(value) {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value)); assert(match, 'Exact decimal evidence is required');
  const fraction = match[2] || '', scale = fraction.length - Number(match[3] || 0), digits = BigInt(match[1] + fraction);
  assert(Number.isSafeInteger(scale) && Math.abs(scale) <= 324);
  return scale >= 0 ? { n: digits, d: 10n ** BigInt(scale) } : { n: digits * 10n ** BigInt(-scale), d: 1n };
}
function micro(value) {
  const r = decimal(value); assert.equal(r.n * 1000000n % r.d, 0n); const n = r.n * 1000000n / r.d;
  assert(n <= BigInt(Number.MAX_SAFE_INTEGER)); return n;
}
function verifyControlledSources(snapshot, r, facts) {
  const p = JSON.parse(r.payableSnapshotJson), q = JSON.parse(r.incomingQualityPlanJson), b = p.binding;
  exactKeys(p, ['schema','allocationPolicy','purchaseOrderId','receiptNo','supplierBatchNo','batchNo','receivedBy','binding','source','allocation','currency','baseCurrency','rateDirection']);
  assert.equal(p.schema, 'purchase-receipt-payable/v1'); assert.equal(p.allocationPolicy, 'cumulative_received_target_less_actual_posted/v1');
  for (const field of ['purchaseOrderId','receiptNo','supplierBatchNo','batchNo','receivedBy']) assert.equal(p[field], r[field]);
  exactKeys(b, ['revision','supplierId','materialId','unit','quantity','price','currency','exchangeRate']);
  positiveId(b.supplierId); positiveId(b.materialId); assert.equal(b.revision, facts.expectedRevision); assert.equal(b.unit, r.unit);
  assert.equal(p.currency, b.currency); assert.equal(p.baseCurrency, 'CNY'); assert.equal(p.rateDirection, 'foreign_per_CNY');
  exactKeys(q, ['schema','binding','plan']); assert.equal(q.schema, 'purchase-incoming-quality/v1'); assert.deepEqual(q.binding, b);
  assert(q.plan.specificationRef.length >= 3 && q.plan.specificationRevision.length >= 1);
  assert(Array.isArray(q.plan.characteristics) && q.plan.characteristics.length > 0 && q.plan.characteristics.some(c => c.required));
  assert.equal(new Set(q.plan.characteristics.map(c => c.code)).size, q.plan.characteristics.length);
  assert(q.plan.characteristics.every(c => c.code && c.name && c.testMethod));
  exactKeys(p.source, ['sourceAuditId','approvalAuditId','supplierPayableBasisJson']); positiveId(p.source.sourceAuditId); positiveId(p.source.approvalAuditId);
  assert(p.source.approvalAuditId > p.source.sourceAuditId);
  const writer = snapshot.audits.find(a => a.id === p.source.sourceAuditId), approval = snapshot.audits.find(a => a.id === p.source.approvalAuditId);
  assert(writer && approval); positiveId(writer.userId); positiveId(approval.userId); assert.notEqual(writer.userId, approval.userId);
  assert.equal(writer.resource, 'purchase_order'); assert.equal(writer.resourceId, r.purchaseOrderId);
  const w = JSON.parse(writer.details), a = JSON.parse(approval.details);
  assert.equal(w.schema, { CREATE:'purchase-create/v1', REVISE:'purchase-revision/v1', CONFIRM_SOURCES:'purchase-source-confirmation/v1' }[writer.action]);
  assert.equal(Number(w.after.id), r.purchaseOrderId); assert.equal(w.after.status, 'pending');
  for (const field of Object.keys(b)) assert.equal(field === 'supplierId' ? Number(w.after[field]) : w.after[field], b[field]);
  assert.equal(w.after.supplierPayableBasisJson, p.source.supplierPayableBasisJson); assert.equal(w.after.incomingQualityPlanJson, r.incomingQualityPlanJson);
  assert.equal(w.source.revision, b.revision); assert.equal(w.source.supplierPayableHash, hash(p.source.supplierPayableBasisJson));
  assert.equal(w.source.incomingQualityHash, hash(r.incomingQualityPlanJson));
  assert.equal(approval.action, 'STATUS_CHANGE'); assert.equal(approval.resource, 'purchase_order'); assert.equal(approval.resourceId, r.purchaseOrderId);
  assert.equal(a.schema, 'purchase-status/v2'); assert.equal(a.from, 'pending'); assert.equal(a.to, w.source.restoreOperationalStatus || 'approved');
  assert.equal(a.isSourceApproval, true); assert.equal(a.revision, b.revision); assert.equal(a.sourceAuditId, writer.id);
  assert.equal(a.supplierPayableHash, w.source.supplierPayableHash); assert.equal(a.incomingQualityHash, w.source.incomingQualityHash);
  const basis = JSON.parse(p.source.supplierPayableBasisJson), price = decimal(b.price), ordered = micro(b.quantity);
  assert.equal(basis.schema, 'supplier-payable-basis/v1'); assert.deepEqual(basis.binding, b); assert(ordered > 0n);
  assert.equal(basis.baseCurrency, 'CNY'); assert.equal(basis.rateDirection, 'foreign_per_CNY');
  assert(['included_in_price','additional_supplier_tax','none_or_third_party'].includes(basis.terms.taxTreatment)); assert(basis.terms.evidenceRef.length >= 3);
  if (basis.terms.taxTreatment !== 'additional_supplier_tax') assert.equal(cents(basis.terms.supplierTaxAmount), 0n);
  const goods = roundRatio(price.n * ordered * 100n, price.d * 1000000n), native = goods + cents(basis.terms.supplierTaxAmount) + cents(basis.terms.supplierChargesAmount);
  assert.equal(cents(basis.goodsAmountNative), goods); assert.equal(cents(basis.amountNative), native);
  const rate = decimal(b.exchangeRate); assert(rate.n > 0n); if (b.currency === 'CNY') assert.equal(b.exchangeRate, 1);
  const base = b.currency === 'CNY' ? native : roundRatio(native * rate.d, rate.n); assert.equal(cents(basis.amountBase), base);
  exactKeys(p.allocation, ['receivedQuantity','receivedQuantityBefore','receivedQuantityAfter','postedAmountNativeBefore','postedAmountBaseBefore','targetAmountNative','targetAmountBase','amountNative','amountBase']);
  const prior = snapshot.receipts.filter(row => row.id < r.id), receivedBefore = prior.reduce((sum, row) => sum + micro(row.acceptedQuantity), 0n);
  const nativeBefore = prior.reduce((sum, row) => sum + cents(row.payableAmountNative), 0n), baseBefore = prior.reduce((sum, row) => sum + cents(row.payableAmountBase), 0n);
  const received = micro(r.acceptedQuantity), after = receivedBefore + received; assert(after <= ordered);
  assert.equal(micro(p.allocation.receivedQuantity), received); assert.equal(micro(p.allocation.receivedQuantityBefore), receivedBefore);
  assert.equal(micro(p.allocation.receivedQuantityAfter), after); assert.equal(cents(p.allocation.postedAmountNativeBefore), nativeBefore); assert.equal(cents(p.allocation.postedAmountBaseBefore), baseBefore);
  const targetNative = roundRatio(native * after, ordered), targetBase = roundRatio(base * after, ordered);
  assert.equal(cents(p.allocation.targetAmountNative), targetNative); assert.equal(cents(p.allocation.targetAmountBase), targetBase);
  assert.equal(cents(p.allocation.amountNative), targetNative - nativeBefore); assert.equal(cents(p.allocation.amountBase), targetBase - baseBefore);
  assert.equal(cents(r.payableAmountNative), targetNative - nativeBefore); assert.equal(cents(r.payableAmountBase), targetBase - baseBefore);
}
const positiveId = value => assert(Number.isSafeInteger(value) && value > 0, 'Persisted identity must be a positive safe integer');
function exactKeys(value, expected) { assert(value && typeof value === 'object'); assert.deepEqual(Object.keys(value).sort(), [...expected].sort()); }
function text(value) { if (value === undefined || value === null || value === '') return null; assert.equal(typeof value, 'string'); return value.trim() || null; }
function requestFacts(orderId, request) {
  positiveId(orderId); positiveId(request.actorId); assert.equal(request.method, 'POST'); assert([0, 1].includes(request.instance));
  assert.equal(request.purchaseOrderId, orderId);
  const b = request.requestBody; assert(b && typeof b === 'object');
  const quantity = Number(b.quantity), acceptedQuantity = Number(b.acceptedQuantity ?? quantity), rejectedQuantity = Number(b.rejectedQuantity ?? 0);
  assert(Number.isFinite(quantity) && quantity > 0 && Number.isFinite(acceptedQuantity) && acceptedQuantity >= 0
    && Number.isFinite(rejectedQuantity) && rejectedQuantity >= 0 && Math.abs(quantity - acceptedQuantity - rejectedQuantity) <= 0.000001);
  return { purchaseOrderId: orderId, receivedBy: request.actorId, quantity, acceptedQuantity, rejectedQuantity,
    batchNo: text(b.batchNo), receivedAt: b.receivedAt ? new Date(b.receivedAt).toISOString() : null,
    discrepancyReason: text(b.discrepancyReason), discrepancyType: b.discrepancyType || 'short_shipped', note: text(b.note) };
}
function verifySubmission(snapshot, submission, request) {
  const controlled = submission.schema === 'purchase-receipt-submission/v2';
  exactKeys(submission, ['schema', 'key', 'fingerprint', 'auditId', 'receipt', ...(controlled ? ['facts'] : [])]);
  assert(['purchase-receipt-submission/v1','purchase-receipt-submission/v2'].includes(submission.schema)); assert.match(submission.key, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/);
  assert.equal(submission.key, request.requestKey); positiveId(submission.auditId); exactKeys(submission.receipt, [...fields, ...(controlled ? controlFields : [])]);
  const r = submission.receipt; positiveId(r.id); positiveId(r.purchaseOrderId); positiveId(r.receivedBy);
  assert(r.receiptNo && r.unit && r.batchNo); assert.equal(new Date(r.receivedAt).toISOString(), r.receivedAt);
  assert.equal(new Date(r.createdAt).toISOString(), r.createdAt);
  const facts = requestFacts(r.purchaseOrderId, request);
  if (controlled) {
    facts.expectedRevision = request.requestBody.expectedRevision; assert(Number.isSafeInteger(facts.expectedRevision) && facts.expectedRevision >= 0);
    assert(facts.batchNo); assert.equal(micro(facts.quantity), micro(facts.acceptedQuantity) + micro(facts.rejectedQuantity));
    assert.deepEqual(submission.facts, facts); assert.equal(r.batchNo, `PO-${r.purchaseOrderId}-RCV-${r.receiptNo}`);
    assert.equal(r.supplierBatchNo, facts.batchNo); if (r.acceptedQuantity > 0) positiveId(r.batchId); else assert.equal(r.batchId, null);
    verifyControlledSources(snapshot, r, facts);
  }
  const fingerprint = hash(JSON.stringify({ schema: controlled ? 'purchase-receipt-facts/v2' : 'purchase-receipt-facts/v1', ...facts }));
  assert.equal(submission.fingerprint, fingerprint); assert.equal(r.receivedBy, facts.receivedBy);
  for (const field of ['quantity', 'acceptedQuantity', 'rejectedQuantity', 'note', 'discrepancyReason']) assert.equal(r[field], facts[field]);
  if (!controlled && facts.batchNo !== null) assert.equal(r.batchNo, facts.batchNo);
  if (facts.receivedAt !== null) assert.equal(r.receivedAt, facts.receivedAt);
  assert(r.acceptedQuantity > 0 ? typeof r.stockEntryRef === 'string' && r.stockEntryRef.length > 0 : r.stockEntryRef === null);
  const stored = snapshot.receipts.filter(row => row.id === r.id); assert.equal(stored.length, 1);
  assert.deepEqual(receipt(stored[0], controlled), r); assert.equal(stored[0].submissionKey, submission.key);
  assert.equal(stored[0].submissionFingerprint, fingerprint); assert.equal(stored[0].submissionJson, JSON.stringify(submission));
  const audits = snapshot.audits.filter(row => row.id === submission.auditId); assert.equal(audits.length, 1);
  const audit = audits[0]; assert.equal(audit.action, 'CREATE_RECEIPT'); assert.equal(audit.userId, facts.receivedBy);
  assert.equal(audit.resource, 'purchase_order'); assert.equal(audit.resourceId, r.purchaseOrderId);
  assert.equal(audit.details, JSON.stringify({ schema: controlled ? 'purchase-receipt-audit/v2' : 'purchase-receipt-audit/v1', receiptId: r.id, receiptNo: r.receiptNo,
    submissionKeyHash: hash(submission.key), fingerprint, receiptHash: hash(JSON.stringify(r)) }));
  return r;
}
function arrays(snapshot) {
  for (const field of ['receipts', 'entries', 'batches', 'costs', 'balances', 'audits']) {
    assert(Array.isArray(snapshot[field]), `Raw ${field} evidence is required`);
    assert.equal(new Set(snapshot[field].map(row => row.id)).size, snapshot[field].length, `${field} contains duplicate raw rows`);
    for (const row of snapshot[field]) positiveId(row.id);
  }
}
function posted(snapshot, order, r, expectedCost) {
  const entry = snapshot.entries.filter(row => row.sourceRef === r.stockEntryRef); assert.equal(entry.length, 1);
  assert.equal(entry[0].sourceType, 'procurement_receipt'); assert.equal(entry[0].status, 'posted'); assert.equal(entry[0].createdBy, r.receivedBy);
  const movements = entry[0].movements || snapshot.movements?.filter(row => row.entryId === entry[0].id);
  assert(Array.isArray(movements)); assert.equal(movements.length, 1);
  const movement = movements[0]; assert.equal(movement.entryId, entry[0].id); assert.equal(movement.materialId, order.materialId);
  assert.equal(movement.batchNo, r.batchNo); assert.equal(movement.unit, r.unit); assert.equal(movement.quantityDelta, r.acceptedQuantity);
  assert.equal(movement.quantityAfter - movement.quantityBefore, r.acceptedQuantity);
  const batches = snapshot.batches.filter(row => row.batchNo === r.batchNo); assert.equal(batches.length, 1);
  if (r.batchId !== undefined) { assert.equal(batches[0].id, r.batchId); assert.equal(batches[0].qualityStatus, 'hold'); }
  assert.equal(batches[0].materialId, order.materialId); assert.equal(batches[0].stockQuantity, r.acceptedQuantity);
  const balances = snapshot.balances.filter(row => row.batchNo === r.batchNo); assert.equal(balances.length, 1);
  assert.equal(balances[0].materialId, order.materialId); assert.equal(balances[0].unit, r.unit); assert.equal(balances[0].quantity, r.acceptedQuantity);
  assert.equal(movement.stockBalanceId, balances[0].id);
  const costs = snapshot.costs.filter(row => row.sourceRef === entry[0].entryNo); assert.equal(costs.length, 1);
  const cost = costs[0]; assert.equal(cost.batchId, batches[0].id); assert.equal(cost.sourceType, 'inventory_adjustment');
  assert.equal(cost.createdBy, r.receivedBy); assert.equal(cost.quantityDelta, r.acceptedQuantity);
  assert.equal(cost.quantityAfter - cost.quantityBefore, r.acceptedQuantity); assert.equal(cost.costAmountDelta, expectedCost);
  assert.equal(cost.costAfter - cost.costBefore, expectedCost);
}
function bundle(data, snapshot, order) {
  assert.equal(Number(data.purchaseOrder.id), order.id); assert.equal(data.purchaseOrder.quantity, order.quantity);
  assert.equal(data.purchaseOrder.status, order.status); assert.equal(data.purchaseOrder.revision, order.revision);
  const listed = data.receipts.some(row => Object.hasOwn(row, 'supplierBatchNo'));
  assert.deepEqual(data.receipts, snapshot.receipts.map(row => ({ ...receipt(row), ...(listed ? {
    supplierBatchNo: row.supplierBatchNo ?? null, batchId: row.batchId ?? null,
    payableAmountNative: row.payableAmountNative == null ? null : moneyText(row.payableAmountNative), payableAmountBase: row.payableAmountBase == null ? null : moneyText(row.payableAmountBase),
  } : {}) })));
  const processed = snapshot.receipts.reduce((sum, r) => sum + r.quantity, 0), accepted = snapshot.receipts.reduce((sum, r) => sum + r.acceptedQuantity, 0);
  assert.deepEqual(data.receiptSummary, { orderedQuantity: order.quantity, processedQuantity: processed, acceptedQuantity: accepted,
    rejectedQuantity: processed - accepted, remainingQuantity: Math.max(0, order.quantity - processed), receiptCount: snapshot.receipts.length });
}
function apiSuccess(reply, replayed) { assert.equal(reply.status, 201); assert.equal(reply.json.success, true); assert.equal(reply.json.data.replayed, replayed); return reply.json.data; }
function apiRejected(reply, status, code) { assert.equal(reply.status, status); assert.equal(reply.json.success, false); if (code) assert.equal(reply.json.errorCode, code); }
function auditFault(e) {
  const f = e.faultInjection, id = e.faultBefore.order.id; assert(f); assert.equal(f.name, `receipt_audit_fault_${id}`);
  assert.equal(f.targetAction, 'CREATE_RECEIPT'); assert.equal(f.purchaseOrderId, id);
  for (const field of ['before', 'removed', 'beforeFunctions', 'removedFunctions']) assert.deepEqual(f[field], []);
  assert.equal(f.installed.length, 1); const sql = f.installed[0].definition; assert.equal(typeof sql, 'string');
  assert.match(sql, new RegExp(`CREATE TRIGGER ${f.name}\\b`, 'i'));
  assert.match(sql, /BEFORE INSERT ON (?:public\.)?audit_logs\b/i);
  assert.match(sql, /new\.action\s*=\s*'CREATE_RECEIPT'/i); assert(sql.includes("'CREATE_RECEIPT'"));
  assert.match(sql, /new\.resource\s*=\s*'purchase_order'/i); assert(sql.includes("'purchase_order'"));
  assert.match(sql, new RegExp(`new\\.resource_id\\s*=\\s*${id}(?:\\D|$)`, 'i'));
  if (e.provider === 'sqlite') {
    assert.deepEqual(f.installedFunctions, []); assert.match(sql, /RAISE\(ABORT,\s*'Synthetic receipt audit unavailable'\)/);
  } else {
    assert.match(sql, new RegExp(`EXECUTE FUNCTION (?:public\\.)?${f.name}\\(\\)`, 'i'));
    assert.equal(f.installedFunctions.length, 1); const fn = f.installedFunctions[0].definition;
    assert.match(fn, new RegExp(`CREATE OR REPLACE FUNCTION (?:public\\.)?${f.name}\\(\\)`, 'i'));
    assert.match(fn, /RETURNS trigger/i); assert.match(fn, /LANGUAGE plpgsql/i); assert.match(fn, /RAISE EXCEPTION 'Synthetic receipt audit unavailable'/);
  }
}

function verifyPurchaseReceiptSubmissionProof(input) {
  const e = plain(input); assert.equal(e.version, 'purchase-receipt-submission/v1'); assert(['sqlite', 'postgresql'].includes(e.provider));
  for (const s of [e.before, e.afterMissing, e.committed, e.afterConflicts, e.full, e.afterReplay, e.faultBefore, e.faultAfter]) arrays(s);
  const id = Number(e.original.id); positiveId(id); assert.equal(e.original.quantity, 2); assert.equal(e.original.price, 10);
  for (const s of [e.before, e.afterMissing, e.committed, e.afterConflicts, e.full, e.afterReplay]) {
    assert.equal(s.order.id, id);
    for (const field of ['materialId', 'quantity', 'price', 'unit', 'currency', 'exchangeRate', 'landedCostAmount', 'revision']) assert.equal(s.order[field], e.original[field]);
  }
  assert.equal(e.before.order.id, id); assert.equal(e.before.order.status, 'approved'); assert.equal(e.before.receipts.length, 0);
  for (const field of ['entries', 'batches', 'balances', 'costs']) assert.equal(e.before[field].length, 0);
  apiRejected(e.missingKey, 400, 'PURCHASE_RECEIPT_KEY_REQUIRED'); assert.equal(e.missingKey.requestKey, null);
  requestFacts(id, e.missingKey); assert.deepEqual(e.afterMissing, e.before);
  assert.equal(e.concurrent.length, 2); assert.deepEqual(e.concurrent.map(r => r.instance).sort(), [0, 1]);
  assert.equal(e.concurrent.filter(r => r.json.data.replayed === false).length, 1); assert.equal(e.concurrent.filter(r => r.json.data.replayed === true).length, 1);
  const owner = e.concurrent.find(r => r.json.data.replayed === false), ack = e.concurrent.find(r => r.json.data.replayed === true);
  const data = apiSuccess(owner, false); apiSuccess(ack, true);
  assert.equal(owner.actorId, ack.actorId); assert.equal(owner.requestKey, ack.requestKey); assert.deepEqual(owner.requestBody, ack.requestBody);
  assert.deepEqual(ack.json.data.submission, data.submission); assert.equal(e.committed.order.id, id); assert.equal(e.committed.order.status, 'in_transit');
  assert.equal(e.committed.receipts.length, 1); assert.equal(e.committed.entries.length, 1); assert.equal(e.committed.costs.length, 1);
  assert.equal(e.committed.batches.length, 1); assert.equal(e.committed.balances.length, 1);
  const r = verifySubmission(e.committed, data.submission, owner); assert.equal(r.purchaseOrderId, id); assert.equal(r.quantity, 1);
  posted(e.committed, e.committed.order, r, 10); bundle(data, e.committed, e.committed.order); bundle(ack.json.data, e.committed, e.committed.order);
  assert.equal(e.committed.audits.filter(a => a.action === 'CREATE_RECEIPT').length, 1);
  assert.deepEqual(e.committed.audits.slice(0, e.before.audits.length), e.before.audits);
  apiRejected(e.changed, 409, 'PURCHASE_RECEIPT_KEY_CONFLICT'); apiRejected(e.differentActor, 409, 'PURCHASE_RECEIPT_KEY_CONFLICT');
  assert.equal(e.changed.actorId, owner.actorId); assert.equal(e.changed.requestKey, owner.requestKey); assert.notDeepEqual(e.changed.requestBody, owner.requestBody);
  requestFacts(id, e.changed); assert.notEqual(e.differentActor.actorId, owner.actorId); assert.equal(e.differentActor.requestKey, owner.requestKey);
  assert.deepEqual(e.differentActor.requestBody, owner.requestBody); requestFacts(id, e.differentActor); assert.deepEqual(e.afterConflicts, e.committed);
  assert.equal(e.full.order.id, id); assert.equal(e.full.order.quantity, 2); assert.equal(e.full.order.status, 'received');
  assert.equal(e.full.receipts.length, 2); assert.equal(e.full.entries.length, 2); assert.equal(e.full.costs.length, 2);
  assert.equal(e.full.batches.length, 2); assert.equal(e.full.balances.length, 2);
  assert.deepEqual(e.full.receipts[0], e.committed.receipts[0]); assert.deepEqual(e.full.audits.slice(0, e.committed.audits.length), e.committed.audits);
  for (const row of e.full.receipts) posted(e.full, e.full.order, row, 10);
  const remaining = e.full.receipts[1]; assert.notEqual(remaining.submissionKey, owner.requestKey);
  const remainingSubmission = JSON.parse(remaining.submissionJson);
  verifySubmission(e.full, remainingSubmission, { ...owner, requestKey: remaining.submissionKey,
    requestBody: { ...owner.requestBody, batchNo: remainingSubmission.schema === 'purchase-receipt-submission/v2' ? remaining.supplierBatchNo : remaining.batchNo } });
  assert.equal(e.full.audits.filter(a => a.action === 'CREATE_RECEIPT').length, 2);
  assert.equal(e.full.receipts.reduce((sum, row) => sum + row.quantity, 0), 2);
  assert.equal(e.full.costs.reduce((sum, row) => sum + row.costAmountDelta, 0), 20);
  const replay = apiSuccess(e.replay, true); assert.equal(e.replay.actorId, owner.actorId); assert.equal(e.replay.requestKey, owner.requestKey);
  assert.deepEqual(e.replay.requestBody, owner.requestBody); assert.deepEqual(replay.submission, data.submission);
  verifySubmission(e.full, replay.submission, e.replay); bundle(replay, e.full, e.full.order); assert.equal(replay.receiptSummary.remainingQuantity, 0);
  assert.deepEqual(e.afterReplay, e.full);
  positiveId(e.faultBefore.order.id); assert.notEqual(e.faultBefore.order.id, id); assert.equal(e.faultBefore.order.status, 'approved');
  assert.equal(e.faultBefore.receipts.length, 0); assert.equal(e.faultBefore.entries.length, 0);
  apiRejected(e.auditFailure, 500, 'PURCHASE_RECEIPT_INTERNAL_ERROR'); auditFault(e);
  requestFacts(e.faultBefore.order.id, e.auditFailure); assert.equal(e.auditFailure.actorId, owner.actorId);
  assert.match(e.auditFailure.requestKey, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/);
  assert.deepEqual(e.faultAfter, e.faultBefore); assert.equal(e.orphanFaultBatch, null);
  return { concurrentNodes: 2, originalReceipts: 1, finalReceipts: 2, auditFailureRollback: true, fullReceivedReplay: true };
}

function verifyPurchaseReceiptRecoveryProof(input) {
  const e = plain(input), r = e.receiptRecovery; assert.equal(e.version, 'purchase-role-browser/v1');
  assert.equal(e.status, 'passed');
  assert(r); assert.equal(r.version, 'purchase-receipt-browser-recovery/v1'); assert.equal(r.status, 'passed');
  const receiver = e.actors.find(a => a.job === 'receiver'); assert(receiver); assert.equal(r.actorId, receiver.id); assert.equal(r.orderId, e.orderId);
  assert.equal(r.storageSlot, `ailaoda.purchase-receipt-intent/v1.${encodeURIComponent(String(receiver.id))}.${encodeURIComponent(String(e.orderId))}`);
  assert.deepEqual(r.firstRequest, r.replayRequest); assert.equal(r.firstRequest.instance, 1); assert.equal(r.firstRequest.method, 'POST');
  const controlled = r.ownerResponse.body.data.submission.schema === 'purchase-receipt-submission/v2';
  const expectedRevision = r.beforeOwner.orders[0].revision;
  assert.deepEqual(r.firstRequest.body, { quantity: 5, acceptedQuantity: 5, rejectedQuantity: 0, batchNo: e.batchNo,
    ...(controlled ? { expectedRevision } : {}) });
  const request = { ...r.firstRequest, actorId: receiver.id, purchaseOrderId: e.orderId, requestBody: r.firstRequest.body };
  assert.equal(r.ownerResponse.status, 201); assert.equal(r.ownerResponse.body.success, true); assert.equal(r.ownerResponse.body.data.replayed, false);
  assert.equal(r.replayResponse.status, 201); assert.equal(r.replayResponse.body.success, true); assert.equal(r.replayResponse.body.data.replayed, true);
  assert.deepEqual(r.ownerResponse.body.data.submission, r.replayResponse.body.data.submission);
  assert.equal(typeof r.persistedBeforeRefresh, 'string'); assert.equal(r.persistedAfterRefresh, r.persistedBeforeRefresh);
  const intent = JSON.parse(r.persistedBeforeRefresh); assert.deepEqual(intent, r.intent);
  exactKeys(intent, ['schema', 'userId', 'orderId', 'key', 'facts']); assert.equal(intent.schema, controlled ? 'purchase-receipt-intent/v2' : 'purchase-receipt-intent/v1');
  assert.equal(intent.userId, String(receiver.id)); assert.equal(intent.orderId, String(e.orderId)); assert.equal(intent.key, r.firstRequest.requestKey);
  assert.deepEqual(intent.facts, { quantity: 5, acceptedQuantity: 5, rejectedQuantity: 0, batchNo: e.batchNo, discrepancyReason: '', note: '',
    ...(controlled ? { expectedRevision } : {}) });
  assert.equal(r.refreshed, true); assert.equal(r.refreshDialogError, undefined); assert(Array.isArray(r.refreshDialogs));
  assert(r.refreshDialogs.every(d => d.type === 'beforeunload' && d.accepted === true));
  assert.deepEqual(r.refreshGuard, { inputsDisabled: 6, retryEnabled: true }); assert.deepEqual(r.restoredValues, ['5', '5', '0', e.batchNo, '', '']);
  for (const snapshot of [r.beforeOwner, r.afterOwner, r.beforeReplay, r.afterReplay, e.final]) arrays(snapshot);
  assert.equal(r.beforeOwner.receipts.length, 0); assert.equal(r.beforeOwner.orders.length, 1); assert.equal(r.beforeOwner.orders[0].quantity, 12);
  for (const field of ['entries', 'movements', 'batches', 'balances', 'costs']) assert.equal(r.beforeOwner[field].length, 0);
  assert.deepEqual(r.beforeReplay, r.afterOwner); assert.deepEqual(r.afterReplay, r.beforeReplay); assert.deepEqual(e.final, r.afterReplay);
  assert.equal(r.afterOwner.orders.length, 1); const order = r.afterOwner.orders[0]; assert.equal(order.id, e.orderId); assert.equal(order.quantity, 12);
  assert.equal(order.status, 'in_transit'); assert.equal(order.landedCostAmount, 120);
  assert.equal(r.afterOwner.receipts.length, 1); assert.equal(r.afterOwner.entries.length, 1); assert.equal(r.afterOwner.movements.length, 1);
  assert.equal(r.afterOwner.costs.length, 1); const stored = verifySubmission(r.afterOwner, r.ownerResponse.body.data.submission, request);
  assert.equal(r.afterOwner.balances.length, 1); assert.equal(r.afterOwner.batches.length, 1);
  assert.equal(stored.quantity, 5); posted(r.afterOwner, order, stored, 50);
  assert.equal(r.afterOwner.audits.filter(a => a.action === 'CREATE_RECEIPT').length, 1);
  assert.deepEqual(r.afterOwner.audits.slice(0, r.beforeOwner.audits.length), r.beforeOwner.audits);
  bundle(r.ownerResponse.body.data, r.afterOwner, order); bundle(r.replayResponse.body.data, r.afterReplay, order);
  const writes = e.writes.filter(w => w.operation === '/receipts'); assert.equal(writes.length, 1); assert.equal(writes[0].job, 'receiver');
  assert.equal(writes[0].requestKey, request.requestKey); assert.deepEqual(writes[0].request, request.requestBody); assert.deepEqual(writes[0].response, r.replayResponse.body);
  assert.equal(r.mutableRemainingQuantity, 7); assert.equal(r.storageAfterReplay, null);
  for (const field of ['unknownScreenshot', 'refreshedScreenshot', 'confirmedScreenshot']) { assert.equal(typeof r[field], 'string'); assert.match(r[field], /\.png$/); }
  return { lostAcknowledgment: true, refreshRecovery: true, physicalReceiptCount: 1, physicalQuantity: 5, costAmount: 50 };
}
module.exports = { verifyPurchaseReceiptSubmissionProof, verifyPurchaseReceiptRecoveryProof };
