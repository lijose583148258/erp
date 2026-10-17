const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { compareLedgerSnapshots } = require('./enterprise-round2-postgres-ledger.cjs');
const baseline = require('../config/enterprise-regression-baseline-v1.json');

// Independent, built-ins-only interpretation of captured PostgreSQL, HTTP and
// DOM evidence. Neither producer assertions nor producer-written allowances
// are trusted. Synthetic fixtures are never imported here.
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rawHash = value => crypto.createHash('sha256').update(value).digest('hex');
const sha = value => assert.match(value || '', /^[a-f0-9]{64}$/);
const positive = value => assert(Number.isSafeInteger(Number(value)) && Number(value) > 0, 'Positive concrete identity required');
const stamp = value => { assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'Missing actual timestamp'); return Date.parse(value); };
const sqlStamp = value => stamp(/(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value) ? value : `${value}Z`);
const same = (a, b, message) => assert.deepEqual(a, b, message);
const normalize = value => String(value || '').replace(/^\/api(?:\/v1)?(?=\/)/, '');
const json = value => { assert.equal(typeof value, 'string'); const parsed = JSON.parse(value); assert(parsed && !Array.isArray(parsed) && typeof parsed === 'object'); return parsed; };
const fixedPrior = baseline.revisions.find(revision => revision.id === 'shared-sales-real-role-chain-v1')?.round2Checks;
const historicalDomains = ['orders', 'order_items', 'shipments', 'shipment_receipts', 'payment_records', 'payment_submissions', 'payment_reversals',
  'purchase_orders', 'purchase_receipts', 'incoming_quality_checks', 'supplier_payments', 'production_boms', 'production_work_orders',
  'stock_balances', 'stock_entries', 'stock_movements', 'inventory_cost_ledgers', 'product_batches', 'batch_genealogy_edges',
  'barter_settlements', 'barter_offset_postings', 'barter_cash_obligations', 'business_events', 'business_event_deliveries', 'audit_logs', 'users'];
const schemaDirectory = path.join(__dirname, '../../backend/prisma/models');
const requiredColumns = Object.fromEntries(fs.readdirSync(schemaDirectory).filter(file => file.endsWith('.prisma')).flatMap(file => {
  const source = fs.readFileSync(path.join(schemaDirectory, file), 'utf8');
  return [...source.matchAll(/model\s+\w+\s*\{([\s\S]*?)\n\}/g)].map(match => {
    const body = match[1], table = /@@map\("([^"]+)"\)/.exec(body)?.[1];
    const columns = body.split('\n').flatMap(line => { const field = /^\s*(\w+)\s+(?:String|Int|Float|Decimal|BigInt|Boolean|DateTime|Bytes|Json)(?:\?|\[\])?(?=\s|$)/.exec(line);
      return field ? [/@map\("([^"]+)"\)/.exec(line)?.[1] || field[1]] : []; });
    return [table, table === 'users' ? columns.filter(column => column !== 'password_hash') : columns];
  }).filter(([table]) => table);
}));

// Preserve every nonmutable raw JSON value, including numbers beyond JS's safe
// range. JSON.parse/stringify alone would erase a 0.000001 historical change.
function rawFields(raw) {
  json(raw);
  const result = new Map(); let position = 0;
  const whitespace = () => { while (/\s/.test(raw[position] || '') && position < raw.length) position++; };
  whitespace(); assert.equal(raw[position++], '{'); whitespace();
  while (raw[position] !== '}') {
    assert.equal(raw[position], '"'); const start = position++; let escaped = false;
    while (position < raw.length) { const char = raw[position++]; if (!escaped && char === '"') break; escaped = !escaped && char === '\\'; }
    const name = JSON.parse(raw.slice(start, position)); assert(!result.has(name), 'Duplicate raw JSON column'); whitespace(); assert.equal(raw[position++], ':'); whitespace();
    const valueStart = position; let depth = 0, string = false; escaped = false;
    while (position < raw.length) {
      const char = raw[position];
      if (string) { if (!escaped && char === '"') string = false; escaped = !escaped && char === '\\'; }
      else if (char === '"') string = true;
      else if (char === '[' || char === '{') depth++;
      else if (char === ']' || char === '}') { if (!depth) break; depth--; }
      else if (char === ',' && !depth) break;
      position++;
    }
    result.set(name, raw.slice(valueStart, position).trim()); whitespace();
    if (raw[position] === ',') { position++; whitespace(); } else break;
  }
  assert.equal(raw[position++], '}'); whitespace(); assert.equal(position, raw.length);
  return result;
}
const rows = (snapshot, table) => { assert(Array.isArray(snapshot.tables?.[table]?.rows), `Missing raw ${table}`); return snapshot.tables[table].rows.map(row => ({ ...row, value: json(row.raw) })); };
function one(snapshot, table, id) { const found = rows(snapshot, table).filter(row => Number(row.value.id) === Number(id)); assert.equal(found.length, 1, `Missing/duplicate ${table}/${id}`); return found[0]; }
function preservedExcept(before, after, fields) {
  const a = rawFields(before), b = rawFields(after);
  same([...a.keys()], [...b.keys()], 'Mutable row column coverage changed');
  for (const [key, value] of a) if (!fields.includes(key)) assert.equal(b.get(key), value, `Historical column changed: ${key}`);
}
function requestFacts(request) {
  const input = request.sent;
  assert(input && input.quantity === 10 && input.acceptedQuantity === 10 && input.rejectedQuantity === 0, 'Recovery request must be the original10 kg');
  assert(typeof input.note === 'string' && input.note.trim());
  assert(!input.dataUrl && !input.fileName && !input.mimeType, 'This diagnostic must not fabricate a customer signature');
  return { quantity: 10, acceptedQuantity: 10, rejectedQuantity: 0, discrepancyType: input.discrepancyType || 'customer_short_signed',
    discrepancyReason: input.discrepancyReason?.trim() || null, note: input.note.trim(), file: null };
}
function assertBranchSubject(branch, manifest, profiles) {
  assert(['before-commit', 'commit-unknown'].includes(branch.name));
  assert(manifest.shipmentIds.includes(branch.shipmentId)); assert.match(branch.key || '', /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/);
  assert.equal(branch.request.method, 'POST'); assert.equal(normalize(branch.request.path), `/shipping/${branch.shipmentId}/receipt-events`);
  assert.equal(branch.request.key, branch.key); assert.equal(branch.request.actorId, profiles.warehouse.id); assert.equal(branch.request.role, profiles.warehouse.role);
  requestFacts(branch.request);
}
function frozenReceipt(snapshot, branch, profiles) {
  const found = rows(snapshot, 'audit_logs').filter(row => row.value.resource === 'shipment' && Number(row.value.resource_id) === branch.shipmentId
    && ['CREATE_RECEIPT_EVENT', 'REJECT_RECEIPT_EVENT'].includes(row.value.action)).filter(row => {
    try { return JSON.parse(row.value.details)?.key === branch.key; } catch { return false; }
  });
  assert.equal(found.length, 1, 'A committed key requires one immutable receipt audit');
  const audit = found[0], event = json(audit.value.details), facts = requestFacts(branch.request);
  same(Object.keys(event).sort(), ['schema', 'key', 'actorId', 'shipmentId', 'fingerprint', 'facts', 'receipt'].sort(), 'Frozen protocol fields changed');
  assert.equal(audit.value.action, 'CREATE_RECEIPT_EVENT'); assert.equal(Number(audit.value.user_id), profiles.warehouse.id);
  assert.equal(event.schema, 'shipment-receipt-submission/v1'); assert.equal(event.key, branch.key); assert.equal(event.actorId, profiles.warehouse.id);
  assert.equal(event.shipmentId, branch.shipmentId); same(event.facts, facts, 'Frozen request facts changed');
  assert.equal(event.fingerprint, hash({ shipmentId: branch.shipmentId, actorId: profiles.warehouse.id, facts }), 'Wrong original request fingerprint');
  const receipt = one(snapshot, 'shipment_receipts', event.receipt?.id), r = receipt.value;
  same(Object.keys(event.receipt).sort(), ['id', 'receiptNo', 'shipmentId', 'quantity', 'acceptedQuantity', 'rejectedQuantity', 'unit',
    'signedReceiptUrl', 'discrepancyReason', 'note', 'receivedBy', 'receivedAt', 'createdAt'].sort());
  const projection = { id: Number(r.id), receiptNo: r.receipt_no, shipmentId: Number(r.shipment_id), quantity: Number(r.quantity),
    acceptedQuantity: Number(r.accepted_quantity), rejectedQuantity: Number(r.rejected_quantity), unit: r.unit,
    signedReceiptUrl: r.signed_receipt_url, discrepancyReason: r.discrepancy_reason, note: r.note, receivedBy: Number(r.received_by),
    receivedAt: new Date(sqlStamp(r.received_at)).toISOString(), createdAt: new Date(sqlStamp(r.created_at)).toISOString() };
  same(event.receipt, projection, 'Receipt no longer matches its frozen ACK');
  assert.equal(projection.shipmentId, branch.shipmentId); assert.equal(projection.receivedBy, profiles.warehouse.id);
  assert.equal(projection.quantity, 10); assert.equal(projection.acceptedQuantity, 10); assert.equal(projection.rejectedQuantity, 0);
  assert.equal(projection.unit, 'kg'); assert.equal(projection.note, facts.note); assert.equal(projection.discrepancyReason, facts.discrepancyReason); assert.equal(projection.signedReceiptUrl, null);
  assert(typeof projection.receiptNo === 'string' && projection.receiptNo.trim());
  const all = rows(snapshot, 'shipment_receipts').filter(row => Number(row.value.shipment_id) === branch.shipmentId);
  assert.equal(all.length, 1, 'Duplicate target receipt fact');
  return { audit, receipt, submission: { ...event, auditId: Number(audit.value.id) } };
}

// Exact, narrow allowances derived from business facts, not accepted from the
// caller. All historical rows, all new tables and all other domains stay raw-
// identical. Even allowed rows must preserve every unrelated raw column.
function deriveRecoveryLedgerChanges(before, after, { completedBranches, manifest, profiles, actions }) {
  assert(Array.isArray(completedBranches) && completedBranches.length <= 2); assert(Array.isArray(actions));
  assert.equal(new Set(completedBranches.map(branch => branch.shipmentId)).size, completedBranches.length);
  const permitted = [], beforeRows = table => new Map(rows(before, table).map(row => [row.key, row]));
  const add = (table, oldRow, newRow) => { assert(newRow); permitted.push({ table, key: newRow.key,
    expectedBefore: oldRow?.raw ?? null, expectedAfter: newRow.raw }); };
  const oldReceipts = beforeRows('shipment_receipts'), oldAudits = beforeRows('audit_logs');
  const targetAuditIds = new Set(); let addedReceipts = 0;
  for (const branch of completedBranches) {
    assertBranchSubject(branch, manifest, profiles);
    const frozen = frozenReceipt(after, branch, profiles); targetAuditIds.add(Number(frozen.audit.value.id));
    if (!oldReceipts.has(frozen.receipt.key)) addedReceipts++;
    for (const [table, row, old] of [['shipment_receipts', frozen.receipt, oldReceipts], ['audit_logs', frozen.audit, oldAudits]]) {
      if (!old.has(row.key)) add(table, null, row);
      else assert.equal(old.get(row.key).raw, row.raw, 'Previously committed ACK changed');
    }
    const a = one(before, 'shipments', branch.shipmentId), b = one(after, 'shipments', branch.shipmentId);
    assert.equal(b.value.status, 'delivered'); assert.equal(b.value.order_id, manifest.orderId);
    assert.equal(b.value.order_item_id, manifest.orderItemId); assert.equal(b.value.material_id, manifest.materialId);
    assert.equal(b.value.quantity, 10); assert.equal(b.value.batch_no, manifest.batchNo);
    if (a.raw !== b.raw) { preservedExcept(a.raw, b.raw, ['status', 'delivered_at', 'updated_at']);
      assert.equal(a.value.status, 'in_transit'); assert.equal(a.value.delivered_at, null); stamp(b.value.delivered_at); stamp(b.value.updated_at); add('shipments', a, b); }
  }
  const a = one(before, 'orders', manifest.orderId), b = one(after, 'orders', manifest.orderId);
  if (a.raw !== b.raw) {
    assert(addedReceipts > 0, 'Replays/uncommitted requests cannot change the order');
    preservedExcept(a.raw, b.raw, ['status', 'updated_at']); assert(['shipped', 'delivered'].includes(a.value.status));
    assert.equal(b.value.status, completedBranches.length === 2 ? 'delivered' : 'shipped'); stamp(b.value.updated_at); add('orders', a, b);
  }
  const consumed = new Set();
  for (const row of rows(after, 'audit_logs')) {
    if (oldAudits.has(row.key) || targetAuditIds.has(Number(row.value.id))) continue;
    const record = row.value;
    const candidates = actions.map((action, index) => ({ action, index })).filter(({ action, index }) => !consumed.has(index)
      && action.method === 'POST' && /^\/shipping\/\d+\/receipt-events$/.test(normalize(action.path))
      && manifest.shipmentIds.some(id => normalize(action.path) === `/shipping/${id}/receipt-events`)
      && record.action === 'POST' && record.resource === `/api${normalize(action.path)}` && Number(record.user_id) === action.actorId
      && action.actorId === profiles.warehouse.id && action.role === profiles.warehouse.role && action.status >= 100
      && stamp(action.finishedAt) <= stamp(after.transaction.startedAt)
      && sqlStamp(record.created_at) <= stamp(after.transaction.snapshotReadAt)
      && (!action.startedAt || sqlStamp(record.created_at) >= stamp(action.startedAt))
      && record.resource_id === null && new RegExp(`^Status: ${action.status}, Duration: \\d+ms$`).test(record.details || ''));
    assert(candidates.length, 'Uncaptured or duplicate new technical audit'); consumed.add(candidates[0].index); stamp(record.created_at); add('audit_logs', null, row);
  }
  const compared = compareLedgerSnapshots(before, after, { allowedChanges: permitted });
  assert.equal(compared.equal, true, `Unapproved full-ledger delta: ${JSON.stringify(compared.differences.slice(0, 2))}`);
  return permitted;
}

function snapshotIdentity(snapshot, runId) {
  // The comparator validates all manifest tables/PKs, full row text and hashes.
  assert(compareLedgerSnapshots(snapshot, snapshot).equal);
  assert.equal(snapshot.runId, runId); const tx = snapshot.transaction;
  assert.equal(tx.database, 'ailaoda'); assert.equal(tx.schema, 'public'); assert.equal(Number(tx.serverVersionNum), 160009);
  assert.equal(tx.inRecovery, false); assert.equal(tx.timeZone, 'UTC'); assert.equal(tx.dateStyle, 'ISO, YMD');
  positive(tx.backendPid); stamp(tx.postmasterStartedAt); assert(stamp(tx.snapshotReadAt) >= stamp(tx.startedAt));
  for (const table of snapshot.manifest) {
    const names = table.columns.map(column => column.name);
    for (const column of requiredColumns[table.name] || []) assert(names.includes(column), `Omitted current business column: ${table.name}.${column}`);
    if (requiredColumns[table.name]?.includes('id')) assert(names.includes('id') && table.primaryKey.includes('id'), `Missing actual row ownership key: ${table.name}`);
    for (const row of rows(snapshot, table.name)) same([...rawFields(row.raw).keys()], names, `Incomplete raw column projection: ${table.name}`);
  }
}
function database(value) {
  assert.equal(value.version, 160009); assert.equal(value.recovery, false); assert.equal(value.fsync, 'on');
  assert.equal(value.dataDirectory, '/var/lib/postgresql/data'); assert.match(value.systemIdentifier || '', /^\d+$/); stamp(value.postmasterStartedAt);
}
function controlIdentity(before, after) {
  assert.equal(before.version, 'owned-postgres-control/v1'); assert.match(before.githubRunId || '', /^\d+$/);
  assert.match(before.project || '', /^[a-z0-9][a-z0-9_-]*$/); assert.equal(before.credentialsIncluded, false); assert.equal(after.credentialsIncluded, false);
  database(before.database); database(after.database); assert.equal(after.database.systemIdentifier, before.database.systemIdentifier);
  const expected = ['postgres', 'postgres-replica', 'app-primary', 'app-secondary'];
  for (const control of [before, after]) {
    assert.equal(control.containers?.length, 4); same(control.containers.map(c => c.service).sort(), [...expected].sort());
    assert.equal(new Set(control.containers.map(c => c.id)).size, 4);
    for (const c of control.containers) { assert.match(c.id || '', /^[a-f0-9]{64}$/); assert.match(c.imageId || '', /^sha256:[a-f0-9]{64}$/);
      assert.equal(c.project, before.project); assert.equal(c.running, true); stamp(c.startedAt);
      assert.equal(c.image, c.service.startsWith('app-') ? `ailaoda-enterprise-cloud:${before.githubRunId}` : 'postgres:16.9-alpine');
      if (!c.service.startsWith('app-')) { assert.equal(c.volume?.name, `${before.project}_postgres-${c.service === 'postgres' ? 'primary' : 'replica'}-data`);
        assert(typeof c.volume.source === 'string' && c.volume.source.startsWith('/')); assert.equal(c.volume.destination, '/var/lib/postgresql/data'); assert.equal(c.volume.writable, true); }
    }
  }
  for (const original of before.containers) { const current = after.containers.find(c => c.service === original.service);
    for (const field of ['id', 'image', 'imageId', 'project', 'volume']) same(current[field], original[field], 'Owned container/volume changed');
    if (original.service.startsWith('app-')) assert.equal(current.startedAt, original.startedAt, 'App restart cannot substitute for database restart');
  }
  assert.equal(after.replica?.recovery, true); assert.equal(after.replica.streaming, true);
  return before.containers.find(c => c.service === 'postgres');
}
function settings(value) {
  assert.equal(value.effective?.name, 'synchronous_standby_names'); assert.equal(typeof value.effective.setting, 'string');
  assert.equal(value.effective.pending_restart, false); assert(Array.isArray(value.autoEntries)); same(value.errors, []);
  assert(value.autoEntries.every(row => row.name === 'synchronous_standby_names' && !row.error));
}
function api(action, { actor, method, path, instance, status }) {
  assert(action && typeof action === 'object'); assert.equal(action.actorId, actor.id); assert.equal(action.role, actor.role);
  assert.equal(action.method, method); assert.equal(normalize(action.path), path); assert.equal(action.instance, instance); assert.equal(action.status, status);
  assert(action.json && typeof action.json === 'object'); if (status < 400) assert.equal(action.json.success, true);
  else assert.equal(action.json.success, false);
  return action.json.data;
}
const captured = (e, action) => assert(e.actions.some(value => hash(value) === hash(action)), 'Original HTTP action missing from capture');
function profile(value, role, permissions, scope) {
  positive(value.id); assert.equal(value.role, role); assert(Array.isArray(value.permissions) && Array.isArray(value.dataScopes));
  assert(!value.permissions.includes('all') && !value.permissions.includes('*') && !value.dataScopes.includes('all'));
  for (const permission of permissions) assert(value.permissions.includes(permission), `Missing real permission ${permission}`);
  assert(value.dataScopes.includes(scope));
}
function ledgerSubject(snapshot, e, accepted) {
  const m = e.manifest, order = one(snapshot, 'orders', m.orderId).value, item = one(snapshot, 'order_items', m.orderItemId).value;
  assert.equal(order.order_no, m.orderNo); assert.equal(order.final_amount, 200); assert.equal(order.paid_amount, 200); assert.equal(order.currency, 'CNY');
  assert.equal(item.order_id, m.orderId); assert.equal(item.material_id, m.materialId); assert.equal(item.quantity, 20); assert.equal(item.unit, 'kg'); assert.equal(item.unit_price, 10);
  const payments = rows(snapshot, 'payment_records').filter(row => Number(row.value.order_id) === m.orderId);
  assert.equal(payments.length, 1); assert.equal(payments[0].value.id, m.paymentId); assert.equal(payments[0].value.status, 'verified'); assert.equal(payments[0].value.amount, 200);
  const receipts = rows(snapshot, 'shipment_receipts').filter(row => m.shipmentIds.includes(Number(row.value.shipment_id)));
  assert.equal(receipts.reduce((n, row) => n + Number(row.value.accepted_quantity), 0), accepted);
  for (const id of m.shipmentIds) { const row = one(snapshot, 'shipments', id).value; assert.equal(row.order_id, m.orderId);
    assert.equal(row.order_item_id, m.orderItemId); assert.equal(row.material_id, m.materialId); assert.equal(row.batch_no, m.batchNo); assert.equal(row.quantity, 10); assert.equal(row.unit, 'kg'); }
}
function browserProof(e, options) {
  const browser = e.browser, m = e.manifest; assert.equal(browser?.runId, e.runId);
  const paths = new Set();
  const image = value => { assert(typeof value === 'string' && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/')) && /\.png$/i.test(value));
    assert(!value.split(/[\\/]/).includes('..')); paths.add(value);
    if (options.resolveArtifactPath) { const resolved = options.resolveArtifactPath(value), bytes = fs.readFileSync(resolved);
      assert(bytes.length > 24); assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert(bytes.readUInt32BE(16) > 10 && bytes.readUInt32BE(20) > 10); } };
  const raster = font => { assert(font?.glyphs?.length >= 8 && font.missingSignatures?.length >= 2);
    assert(font.glyphs.every(g => g.inkPixels > 0 && typeof g.signature === 'string' && !font.missingSignatures.includes(g.signature)));
    assert.equal(new Set(font.glyphs.map(g => g.signature)).size, font.glyphs.length); };
  for (const job of ['warehouse', 'sales']) { const actor = browser.actors?.filter(a => a.job === job); assert.equal(actor?.length, 1);
    assert.equal(actor[0].actorId ?? actor[0].id, e.profiles[job].id); assert.equal(actor[0].role, e.profiles[job].role); }
  assert(browser.screenshots?.length >= 5); for (const shot of browser.screenshots) {
    assert.equal(shot.actorId, e.profiles[shot.job]?.id); assert.equal(shot.visible, true); assert.equal(shot.unobscured, true);
    assert.notEqual(shot.diagnostic, true); assert.equal(shot.unverified, false); raster(shot.font); image(shot.path);
  }
  assert.equal(browser.readbacks?.length, 3);
  for (const [index, b] of browser.readbacks.entries()) {
    assert.equal(b.runId, e.runId); assert.equal(b.job, 'sales'); assert.equal(b.actorId, e.profiles.sales.id); assert.equal(b.instance, 1);
    assert.equal(b.orderId, m.orderId); assert.equal(b.lineId, m.orderItemId); assert.equal(b.orderNo, m.orderNo);
    same(b.expected, { reservedQuantity: 0, dispatchedQuantity: 20, acceptedQuantity: index * 10, outstandingQuantity: 20 - index * 10, orderedQuantity: 20 });
    assert.equal(b.noPartialLoadWarning, true); assert.equal(b.unobscured, true); raster(b.font); image(b.screenshot); image(b.crop);
    assert.equal(b.testIds.reserved, `order-reserved-${m.orderId}-${m.orderItemId}`); assert.equal(b.testIds.obligation, `order-line-obligation-${m.orderId}-${m.orderItemId}`);
    assert.match(b.texts.reserved, /:\s*0\s*kg(?:$|\s)/); assert.match(b.texts.obligation, new RegExp(`已签收:\\s*${index * 10}\\s*kg`));
    assert.match(b.texts.obligation, new RegExp(`待交:\\s*${20 - index * 10}\\s*kg`)); assert.match(b.texts.line, /20\s*kg\s*\/\s*20\s*kg/);
    for (const path of [b.screenshot, b.crop]) assert(browser.screenshots.some(shot => shot.path === path && shot.actorId === b.actorId));
  }
  assert.equal(browser.warehouseReadbacks?.length, 2);
  for (const [index, b] of browser.warehouseReadbacks.entries()) {
    const branch = e.branches[index], ack = frozenReceipt(branch.afterReplayLedger, branch, e.profiles).submission;
    assert.equal(b.runId, e.runId); assert.equal(b.job, 'warehouse'); assert.equal(b.actorId, e.profiles.warehouse.id);
    assert.equal(b.instance, 0); assert.equal(b.shipmentId, branch.shipmentId); same(b.submission, ack); assert.equal(b.receiptNo, ack.receipt.receiptNo);
    assert(typeof b.text === 'string' && b.text.includes(b.receiptNo)); image(b.screenshot);
    assert(browser.screenshots.some(shot => shot.path === b.screenshot && shot.actorId === b.actorId));
  }
  for (const a of browser.actions || []) if (a.job === 'sales') for (const [permission, endpoint] of [['contracts.read', /^\/contracts(?:[/?]|$)/], ['assets.read', /^\/assets\/batches(?:[/?]|$)/]])
    if (!e.profiles.sales.permissions.includes(permission)) assert(!(a.method === 'GET' && endpoint.test(normalize(a.path))), 'Unauthorized optional lookup');
  return paths.size;
}

function verifyPostgresRecoveryProof(e, options = {}) {
  assert.equal(e?.version, 'postgres-recovery-chain/v1'); assert.equal(e.provider, 'postgresql'); assert.equal(e.status, 'passed');
  assert(typeof e.runId === 'string' && e.runId.trim()); if (options.runId !== undefined) assert.equal(e.runId, options.runId);
  const { chainDigest, ...unsigned } = e; sha(chainDigest); assert.equal(chainDigest, hash(unsigned), 'Recovery chain digest mismatch');
  assert(typeof e.scope === 'string' && e.scope.trim());
  assert.equal(fixedPrior?.length, 34); assert.equal(e.priorChecks?.length, 34);
  same(e.priorChecks.map(c => c.id).sort(), [...fixedPrior].sort(), 'All prior34 obligations must replay');
  for (const check of e.priorChecks) { assert.equal(check.status, 'passed'); sha(check.evidenceSha256);
    if (options.priorChecks) { const matches = options.priorChecks.filter(c => c.id === check.id); assert.equal(matches.length, 1);
      assert.equal(matches[0].status, 'passed'); assert(matches[0].evidence && typeof matches[0].evidence === 'object', 'Prior sibling must retain raw evidence, not a self-reported digest');
      assert.equal(check.evidenceSha256, hash(matches[0].evidence), 'Prior proof belongs to a different cumulative replay'); } }
  const m = e.manifest; for (const field of ['orderId', 'orderItemId', 'materialId', 'paymentId']) positive(m[field]);
  assert(typeof m.orderNo === 'string' && m.orderNo.trim()); assert(typeof m.batchNo === 'string' && m.batchNo.trim());
  assert.equal(m.orderedQuantity, 20); assert.equal(m.amount, 200); assert.equal(m.shipmentIds?.length, 2); assert.equal(new Set(m.shipmentIds).size, 2); m.shipmentIds.forEach(positive);
  profile(e.profiles.warehouse, 'warehouse', ['shipping.read', 'shipping.write', 'shipping.receipts.read'], 'warehouse_visible');
  profile(e.profiles.sales, 'sales', ['orders.read'], 'own_customers'); assert.notEqual(e.profiles.warehouse.id, e.profiles.sales.id);
  assert(Array.isArray(e.actions) && e.actions.length > 0); const primary = controlIdentity(e.controlBefore, e.controlAfter);
  assert.equal(e.replicaStopped?.stopped, true); assert.equal(e.replicaStopped.originallyRunning, true);
  assert.equal(e.replicaStopped.id, e.controlBefore.containers.find(c => c.service === 'postgres-replica').id);
  settings(e.settingsBefore); assert.equal(e.cleanup?.status, 'passed'); same(e.cleanup.errors, []);
  same(e.cleanup.settingsRestored, e.settingsBefore, 'Settings were not restored exactly');
  assert.equal(e.cleanup.replica?.restored, true); assert.equal(e.cleanup.replica.id, e.replicaStopped.id);
  assert.equal(e.cleanup.replica.recovery, true); assert.equal(e.cleanup.replica.streaming, true);
  const lsn = value => { assert.match(value || '', /^[A-Fa-f0-9]+\/[A-Fa-f0-9]+$/); const [a, b] = value.split('/'); return (BigInt(`0x${a}`) << 32n) + BigInt(`0x${b}`); };
  assert(lsn(e.cleanup.replica.replayLsn) >= lsn(e.cleanup.replica.targetLsn));
  snapshotIdentity(e.baseline, e.runId); ledgerSubject(e.baseline, e, 0);
  for (const profile of Object.values(e.profiles)) { const user = one(e.baseline, 'users', profile.id).value;
    assert.equal(user.role, profile.role); assert.equal(user.is_active, true); }
  for (const domain of historicalDomains) assert(rows(e.baseline, domain).length > 0, `No prior business evidence in ${domain}`);
  assert.equal(e.branches?.length, 2); same(e.branches.map(b => b.name), ['before-commit', 'commit-unknown']);
  let previous = e.baseline, previousDatabase = e.controlBefore.database;
  for (const [index, b] of e.branches.entries()) {
    assert.equal(b.shipmentId, m.shipmentIds[index]); assertBranchSubject(b, m, e.profiles);
    assert.equal(b.request.instance, 0); captured(e, b.request); database(b.beforeDatabase); same(b.beforeDatabase, previousDatabase);
    const bound = b.bound; positive(bound?.pid); positive(bound.backend_xid); stamp(bound.backend_start); stamp(bound.xact_start);
    assert.equal(bound.state, 'active'); assert.equal(bound.wait_event_type, 'Lock'); assert(typeof bound.wait_event === 'string' && bound.wait_event.trim());
    assert.equal(bound.query, 'UPDATE "shipments" SET "id" = "id" WHERE "id" = $1');
    assert.equal(bound.blockers?.length, 1); positive(bound.blockers[0]); assert.notEqual(Number(bound.blockers[0]), Number(bound.pid));
    assert(stamp(bound.backend_start) >= stamp(b.beforeDatabase.postmasterStartedAt)); assert(stamp(bound.xact_start) >= stamp(bound.backend_start));
    assert(typeof bound.application_name === 'string');
    assert.equal(b.ackPendingAtKill?.headersReceived, false); assert.equal(b.ackPendingAtKill.settled, false);
    assert(stamp(b.ackPendingAtKill.recordedAt) >= stamp(bound.xact_start));
    assert.equal(b.kill?.id, primary.id); assert.equal(b.kill.signal, 'SIGKILL'); assert.equal(b.kill.running, false); assert.equal(b.kill.exitCode, 137); same(b.kill.volume, primary.volume);
    assert(stamp(b.kill.startedAt) >= stamp(b.ackPendingAtKill.recordedAt)); assert(stamp(b.kill.finishedAt) >= stamp(b.kill.startedAt));
    assert(Number.isFinite(b.windowToKillMs) && b.windowToKillMs >= 0 && b.windowToKillMs < 3000, 'Commit window not captured within Prisma deadline');
    assert.equal(b.restart?.id, primary.id); same(b.restart.volume, primary.volume); database(b.restart.database);
    assert.equal(b.restart.database.systemIdentifier, previousDatabase.systemIdentifier); assert.notEqual(b.restart.database.postmasterStartedAt, previousDatabase.postmasterStartedAt);
    assert.equal(b.restart.restarted, true); assert(stamp(b.restart.startedAt) >= stamp(b.kill.finishedAt)); assert(stamp(b.restart.finishedAt) >= stamp(b.restart.startedAt));
    const logs = b.recoveryLogs; assert.equal(logs?.containerId, primary.id); assert.equal(logs.since, b.kill.startedAt);
    assert.equal(typeof logs.text, 'string'); assert.equal(logs.sha256, rawHash(logs.text), 'Recovery log digest mismatch');
    assert(/automatic recovery in progress/i.test(logs.text), 'Missing actual PostgreSQL crash recovery log');
    assert(/redo done at|redo is not required/i.test(logs.text), 'Missing completed WAL redo');
    assert(/database system is ready to accept connections/i.test(logs.text), 'Missing post-recovery readiness log');
    assert(stamp(b.request.finishedAt) >= stamp(b.kill.startedAt) && stamp(b.request.finishedAt) <= stamp(b.restart.startedAt), 'Original HTTP must terminate before database restarts');
    if (b.request.status === 0) { const error = b.request.transportError || b.request.json?.transportError;
      assert(error && ['ECONNRESET', 'ECONNREFUSED', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT', 'EPIPE'].includes(error.code), 'Client abort/timeout is not a database crash');
      assert(!/abort|timeout/i.test(error.name || '')); assert.equal(b.request.headersReceivedAt, null); }
    else { assert([500, 503].includes(b.request.status)); assert.equal(b.request.json?.success, false);
      assert(stamp(b.request.headersReceivedAt) >= stamp(b.kill.startedAt)); }
    if (index === 0) { assert.equal(b.syncRep, undefined); assert.equal(b.kill.processStartedAt, primary.startedAt); }
    else { const s = b.syncRep; assert(s); for (const field of ['pid', 'backend_start', 'xact_start', 'backend_xid', 'application_name']) same(s[field], bound[field], 'COMMIT belongs to a different transaction');
      assert.equal(s.state, 'active'); assert.equal(s.wait_event_type, 'IPC'); assert.equal(s.wait_event, 'SyncRep'); assert.match(s.query || '', /^COMMIT\s*;?$/i);
      assert.match(b.gate?.value || '', /^FIRST 1 \(r2_gate_[a-f0-9]+\)$/); assert.equal(b.gate.standbyCount, 0);
      assert.notEqual(b.kill.processStartedAt, primary.startedAt); assert(typeof b.waitLSN?.boundary === 'string' && /SyncRep/.test(b.waitLSN.boundary));
      if (b.waitLSN.value === null) { assert.equal(b.waitLSN.localFlushed, null); assert(/16\.9/.test(b.waitLSN.boundary) && /inference|xact\.c.*local WAL flush order/i.test(b.waitLSN.boundary)); }
      else { lsn(b.waitLSN.value); assert.equal(b.waitLSN.localFlushed, true); } }
    same(b.settingsAfterRestore, e.settingsBefore, 'Branch settings drift');
    for (const snapshot of [b.beforeLedger, b.afterRecoveryLedger, b.afterReplayLedger, b.afterSecondReplayLedger]) snapshotIdentity(snapshot, e.runId);
    assert(compareLedgerSnapshots(b.beforeLedger, previous).equal, 'Branch did not start from previous full ledger');
    assert.equal(b.beforeLedger.transaction.postmasterStartedAt, b.beforeDatabase.postmasterStartedAt);
    for (const snapshot of [b.afterRecoveryLedger, b.afterReplayLedger, b.afterSecondReplayLedger]) {
      assert.equal(snapshot.transaction.postmasterStartedAt, b.restart.database.postmasterStartedAt);
      assert(stamp(snapshot.transaction.startedAt) >= stamp(b.restart.startedAt));
    }
    const committedAtRecovery = index === 0 ? [] : e.branches.slice(0, 2), completed = e.branches.slice(0, index + 1);
    const compare = (before, after, branches) => deriveRecoveryLedgerChanges(before, after, { completedBranches: branches, manifest: m, profiles: e.profiles, actions: e.actions });
    compare(b.beforeLedger, b.afterRecoveryLedger, committedAtRecovery);
    compare(b.afterRecoveryLedger, b.afterReplayLedger, completed); compare(b.afterReplayLedger, b.afterSecondReplayLedger, completed);
    ledgerSubject(b.afterRecoveryLedger, e, index === 0 ? 0 : 20); ledgerSubject(b.afterReplayLedger, e, (index + 1) * 10); ledgerSubject(b.afterSecondReplayLedger, e, (index + 1) * 10);
    const ack = frozenReceipt(b.afterReplayLedger, b, e.profiles).submission;
    assert.equal(b.recoveryLookup?.length, 2); assert.equal(b.replays?.length, 2);
    for (const instance of [0, 1]) { const lookup = b.recoveryLookup[instance];
      const body = api(lookup, { actor: e.profiles.warehouse, method: 'GET', path: `/shipping/${b.shipmentId}/receipts?submissionKey=${encodeURIComponent(b.key)}`, instance, status: index === 0 ? 404 : 200 }); captured(e, lookup);
      if (index === 0) { assert.equal(lookup.json.errorCode, 'SHIPMENT_RECEIPT_SUBMISSION_NOT_FOUND'); assert(!body?.submission); }
      else same(body?.submission, ack, 'Recovered ACK differs from the pre-crash commit'); }
    for (const [replayIndex, instance] of [1, 0].entries()) { const replay = b.replays[replayIndex];
      const body = api(replay, { actor: e.profiles.warehouse, method: 'POST', path: `/shipping/${b.shipmentId}/receipt-events`, instance, status: 201 }); captured(e, replay);
      assert.equal(replay.key, b.key); same(replay.sent, b.request.sent); same(body?.submission, ack); assert.equal(body.replayed, index === 1 || replayIndex === 1); }
    assert.equal(b.readbacks?.length, 4);
    for (const instance of [0, 1]) {
      const orderAction = b.readbacks.find(a => a.instance === instance && normalize(a.path) === `/orders/${m.orderId}`);
      const order = api(orderAction, { actor: e.profiles.sales, method: 'GET', path: `/orders/${m.orderId}`, instance, status: 200 }); captured(e, orderAction);
      assert.equal(Number(order.id), m.orderId); assert.equal(order.finalAmount, 200); assert.equal(order.paidAmount, 200);
      const line = order.fulfillment?.lines?.find(value => value.orderItemId === m.orderItemId); assert(line);
      for (const [field, value] of Object.entries({ orderedQuantity: 20, dispatchedQuantity: 20, acceptedQuantity: (index + 1) * 10, outstandingQuantity: 20 - (index + 1) * 10, reservedQuantity: 0 })) assert.equal(line[field], value);
      const receiptAction = b.readbacks.find(a => a.instance === instance && normalize(a.path) === `/shipping/${b.shipmentId}/receipts`);
      const receiptData = api(receiptAction, { actor: e.profiles.warehouse, method: 'GET', path: `/shipping/${b.shipmentId}/receipts`, instance, status: 200 }); captured(e, receiptAction);
      assert.equal(receiptData.receipts?.length, 1); assert.equal(receiptData.receipts[0].receiptNo, ack.receipt.receiptNo);
    }
    previous = b.afterSecondReplayLedger; previousDatabase = b.restart.database;
  }
  same(e.controlAfter.database, previousDatabase); const screenshots = browserProof(e, options);
  return { schema: 'enterprise-round2-postgres-recovery-proof/v1', runId: e.runId, provider: 'postgresql', chainDigest: e.chainDigest,
    branches: 2, priorChecks: 34, fullLedgerSnapshots: 9, originalReceipts: 2, duplicateReceipts: 0, screenshots,
    fullWorkforceAccepted: false, productionReady: false };
}
function verifyPostgresLedgerRecovery(e, options = {}) {
  const proof = verifyPostgresRecoveryProof(e, options);
  return { ...proof, schema: 'enterprise-round2-postgres-ledger-recovery-proof/v1', sourceChainDigest: proof.chainDigest };
}

module.exports = { verifyPostgresRecoveryProof, verifyPostgresLedgerRecovery, deriveRecoveryLedgerChanges };
