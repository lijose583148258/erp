// SYNTHETIC CONTRACT FIXTURE ONLY. No PostgreSQL, ERP, browser, crash or actual
// cumulative run is executed by this file. Never use it as runtime evidence.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { REQUIRED_TABLES } = require('../lib/enterprise-round2-postgres-ledger.cjs');
const baseline = require('../config/enterprise-regression-baseline-v1.json');
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rawHash = value => crypto.createHash('sha256').update(value).digest('hex');
const key = id => JSON.stringify([String(id)]);
const time = seconds => new Date(Date.UTC(2026, 9, 17, 0, 0, 0) + seconds * 1000).toISOString();
const names = baseline.revisions.find(revision => revision.id === 'shared-sales-real-role-chain-v1').round2Checks;
function postgresRecoveryPriorChecks() { return names.map(id => ({ id, status: 'passed', evidence: { synthetic: true, check: id } })); }
function resignPostgresRecoveryProof(e) { delete e.chainDigest; e.chainDigest = hash(e); return e; }
function rehashPostgresLedger(snapshot) { for (const table of Object.values(snapshot.tables)) { table.rows.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0); table.sha256 = hash(table.rows); } return snapshot; }
function putPostgresLedgerRow(snapshot, table, value) {
  const columns = snapshot.manifest.find(item => item.name === table).columns;
  const complete = Object.fromEntries(columns.map(column => [column.name, Object.hasOwn(value, column.name) ? value[column.name] : null]));
  const row = { key: key(value.id), raw: JSON.stringify(complete) }, rows = snapshot.tables[table].rows;
  const index = rows.findIndex(existing => existing.key === row.key); if (index >= 0) rows[index] = row; else rows.push(row);
  rehashPostgresLedger(snapshot); return row;
}
function columns() {
  const directory = path.join(__dirname, '../../backend/prisma/models');
  return Object.fromEntries(fs.readdirSync(directory).filter(file => file.endsWith('.prisma')).flatMap(file =>
    [...fs.readFileSync(path.join(directory, file), 'utf8').matchAll(/model\s+\w+\s*\{([\s\S]*?)\n\}/g)].map(match => {
      const body = match[1], table = /@@map\("([^"]+)"\)/.exec(body)?.[1];
      const fields = body.split('\n').flatMap(line => { const match = /^\s*(\w+)\s+(?:String|Int|Float|Decimal|BigInt|Boolean|DateTime|Bytes|Json)(?:\?|\[\])?(?=\s|$)/.exec(line);
        return match ? [/@map\("([^"]+)"\)/.exec(line)?.[1] || match[1]] : []; });
      return [table, table === 'users' ? fields.filter(field => field !== 'password_hash') : fields];
    }).filter(([table]) => table)));
}
function postgresRecoveryProofFixture({ runId = 'fixture-pg-recovery-only', priorChecks = postgresRecoveryPriorChecks() } = {}) {
  const m = { orderId: 1001, orderItemId: 1002, materialId: 1003, paymentId: 1004, orderNo: 'SYNTHETIC-ORDER-NOT-RUNTIME',
    batchNo: 'SYNTHETIC-BATCH-NOT-RUNTIME', orderedQuantity: 20, amount: 200, shipmentIds: [1005, 1006] };
  const profiles = { warehouse: { id: 70, role: 'warehouse', permissions: ['shipping.read', 'shipping.write', 'shipping.receipts.read'], dataScopes: ['warehouse_visible'] },
    sales: { id: 71, role: 'sales', permissions: ['orders.read'], dataScopes: ['own_customers'] } };
  const fieldNames = columns(), manifest = [...REQUIRED_TABLES].sort().map(name => ({ name, kind: 'r', primaryKey: ['id'],
    columns: fieldNames[name].map((name, index) => ({ name, type: name === 'id' ? 'integer' : 'text', ordinal: index + 1,
      nullable: name !== 'id', default: null, identity: '', generated: '', collation: null })) }));
  const tx = (seconds, started = 0) => ({ database: 'ailaoda', schema: 'public', serverVersionNum: '160009', isolation: 'repeatable read',
    readOnly: 'on', timeZone: 'UTC', dateStyle: 'ISO, YMD', snapshot: '20:30:21,25', backendPid: '55', postmasterStartedAt: time(started),
    startedAt: time(seconds), snapshotReadAt: time(seconds + 0.001), inRecovery: false });
  const snapshot = { version: 'postgres-business-ledger-snapshot/v1', provider: 'postgresql', runId, transaction: tx(10), manifest,
    exclusions: ['auth_roles', 'auth_permissions', 'auth_role_permissions', 'auth_policy_migrations', '_prisma_migrations'].map(name => ({ name, reason: 'synthetic credential exclusion', present: true })), tables: {} };
  snapshot.exclusions.push({ name: 'users', columns: ['password_hash'], reason: 'synthetic password-only exclusion', present: true });
  for (const table of manifest) { snapshot.tables[table.name] = { rows: [], sha256: hash([]) }; putPostgresLedgerRow(snapshot, table.name, { id: 1 }); }
  putPostgresLedgerRow(snapshot, 'orders', { id: m.orderId, order_no: m.orderNo, final_amount: 200, paid_amount: 200, currency: 'CNY', status: 'shipped', updated_at: time(9) });
  putPostgresLedgerRow(snapshot, 'order_items', { id: m.orderItemId, order_id: m.orderId, material_id: m.materialId, quantity: 20, unit: 'kg', unit_price: 10 });
  putPostgresLedgerRow(snapshot, 'payment_records', { id: m.paymentId, order_id: m.orderId, amount: 200, status: 'verified' });
  for (const [job, profile] of Object.entries(profiles)) putPostgresLedgerRow(snapshot, 'users', { id: profile.id, username: `synthetic_${job}`, role: profile.role, is_active: true });
  for (const shipmentId of m.shipmentIds) putPostgresLedgerRow(snapshot, 'shipments', { id: shipmentId, order_id: m.orderId, order_item_id: m.orderItemId,
    material_id: m.materialId, quantity: 10, batch_no: m.batchNo, unit: 'kg', status: 'in_transit', delivered_at: null, updated_at: time(9) });
  const pg = seconds => ({ version: 160009, recovery: false, fsync: 'on', dataDirectory: '/var/lib/postgresql/data', systemIdentifier: '1234567890123456789', postmasterStartedAt: time(seconds) });
  const volume = replica => ({ name: `cloud-sandbox_postgres-${replica ? 'replica' : 'primary'}-data`, source: `/var/lib/docker/volumes/synthetic-${replica ? 'replica' : 'primary'}/_data`,
    destination: '/var/lib/postgresql/data', writable: true });
  const containers = ['postgres', 'postgres-replica', 'app-primary', 'app-secondary'].map((service, index) => ({ id: String(index + 1).repeat(64),
    image: index < 2 ? 'postgres:16.9-alpine' : 'ailaoda-enterprise-cloud:123456', imageId: `sha256:${String(index + 1).repeat(64)}`,
    service, project: 'cloud-sandbox', running: true, startedAt: time(0), ...(index < 2 ? { volume: volume(index === 1) } : {}) }));
  const controlBefore = { version: 'owned-postgres-control/v1', githubRunId: '123456', project: 'cloud-sandbox', containers, database: pg(0), credentialsIncluded: false };
  const e = { version: 'postgres-recovery-chain/v1', provider: 'postgresql', runId, status: 'passed',
    scope: 'SYNTHETIC CONTRACT FIXTURE ONLY; no PostgreSQL or browser executed', priorChecks: names.map(id => {
      const check = priorChecks.find(check => check.id === id); if (!check) throw new Error(`Synthetic fixture missing prior sibling ${id}`);
      return { id, status: check.status, evidenceSha256: hash(check.evidence) }; }), manifest: m, profiles, actions: [], controlBefore,
    replicaStopped: { stopped: true, id: containers[1].id, originallyRunning: true }, settingsBefore: { effective: { name: 'synchronous_standby_names',
      setting: '', source: 'default', sourcefile: null, pending_restart: false }, autoEntries: [], errors: [] }, baseline: copy(snapshot), branches: [] };
  const action = (actor, instance, method, endpoint, status, data, sent = null, requestKey = null, seconds = 15) => ({ method, path: endpoint,
    key: requestKey, actorId: actor.id, role: actor.role, instance, sent, status, json: { success: status < 400, ...(data === undefined ? {} : { data }) }, finishedAt: time(seconds) });
  const makeCommitted = (source, branch, index, seconds) => {
    const result = copy(source), receipt = { id: 2001 + index, receiptNo: `SPR-SYNTHETIC-${index}`, shipmentId: branch.shipmentId, quantity: 10, acceptedQuantity: 10,
      rejectedQuantity: 0, unit: 'kg', signedReceiptUrl: null, discrepancyReason: null, note: branch.request.sent.note, receivedBy: profiles.warehouse.id, receivedAt: time(seconds), createdAt: time(seconds) };
    const facts = { quantity: 10, acceptedQuantity: 10, rejectedQuantity: 0, discrepancyType: 'customer_short_signed', discrepancyReason: null, note: branch.request.sent.note, file: null };
    const event = { schema: 'shipment-receipt-submission/v1', key: branch.key, actorId: profiles.warehouse.id, shipmentId: branch.shipmentId,
      fingerprint: hash({ shipmentId: branch.shipmentId, actorId: profiles.warehouse.id, facts }), facts, receipt };
    putPostgresLedgerRow(result, 'shipment_receipts', { id: receipt.id, receipt_no: receipt.receiptNo, shipment_id: branch.shipmentId,
      quantity: 10, accepted_quantity: 10, rejected_quantity: 0, unit: 'kg', signed_receipt_url: null, discrepancy_reason: null,
      note: receipt.note, received_by: receipt.receivedBy, received_at: receipt.receivedAt, created_at: receipt.createdAt });
    const auditId = 3001 + index;
    putPostgresLedgerRow(result, 'audit_logs', { id: auditId, user_id: profiles.warehouse.id, action: 'CREATE_RECEIPT_EVENT', resource: 'shipment',
      resource_id: branch.shipmentId, details: JSON.stringify(event), created_at: time(seconds) });
    const shipment = JSON.parse(result.tables.shipments.rows.find(row => row.key === key(branch.shipmentId)).raw);
    putPostgresLedgerRow(result, 'shipments', { ...shipment, status: 'delivered', delivered_at: time(seconds), updated_at: time(seconds) });
    const order = JSON.parse(result.tables.orders.rows.find(row => row.key === key(m.orderId)).raw);
    putPostgresLedgerRow(result, 'orders', { ...order, status: index === 1 ? 'delivered' : 'shipped', updated_at: time(seconds) });
    return { snapshot: result, submission: { ...event, auditId } };
  };
  let previous = copy(snapshot);
  for (let index = 0; index < 2; index++) {
    const committed = index === 1, base = committed ? 18 : 11, restart = committed ? 19.2 : 13.2;
    const b = { name: committed ? 'commit-unknown' : 'before-commit', shipmentId: m.shipmentIds[index], key: `synthetic-pg-receipt-${index}`,
      beforeLedger: copy(previous), beforeDatabase: pg(committed ? 13.2 : 0) };
    const sent = { quantity: 10, acceptedQuantity: 10, rejectedQuantity: 0, note: `SYNTHETIC ${b.name}; not a customer signature` };
    b.request = { ...action(profiles.warehouse, 0, 'POST', `/shipping/${b.shipmentId}/receipt-events`, 500, undefined, sent, b.key, base + 0.6),
      headersReceivedAt: time(base + 0.5) }; e.actions.push(b.request);
    b.bound = { pid: 91 + index, backend_start: time(committed ? 13.3 : 1), xact_start: time(base), backend_xid: String(700 + index), application_name: '',
      state: 'active', wait_event_type: 'Lock', wait_event: 'transactionid', query: 'UPDATE "shipments" SET "id" = "id" WHERE "id" = $1', blockers: [81 + index] };
    if (committed) { b.syncRep = { ...b.bound, query: 'COMMIT', wait_event_type: 'IPC', wait_event: 'SyncRep', blockers: [] };
      b.gate = { value: 'FIRST 1 (r2_gate_0123456789abcdef)', standbyCount: 0 };
      b.waitLSN = { value: null, localFlushed: null, boundary: 'PostgreSQL 16.9 exact-backend COMMIT IPC/SyncRep implies local flush; source inference, not an observed LSN' }; }
    b.ackPendingAtKill = { recordedAt: time(base + 0.1), headersReceived: false, settled: false };
    b.kill = { id: containers[0].id, signal: 'SIGKILL', running: false, exitCode: 137, volume: volume(false), processStartedAt: time(committed ? 13.15 : 0), startedAt: time(base + 0.2), finishedAt: time(base + 0.3) };
    b.windowToKillMs = 300;
    b.restart = { id: containers[0].id, volume: volume(false), database: pg(restart), restarted: true, startedAt: time(committed ? 19 : 13), finishedAt: time(committed ? 20 : 14) };
    const log = 'database system was not properly shut down; automatic recovery in progress\nredo done at 0/100\ndatabase system is ready to accept connections\n';
    b.recoveryLogs = { containerId: containers[0].id, since: b.kill.startedAt, text: log, sha256: rawHash(log) };
    b.settingsAfterRestore = copy(e.settingsBefore);
    const original = makeCommitted(previous, b, index, committed ? 18.1 : 15);
    b.afterRecoveryLedger = committed ? copy(original.snapshot) : copy(previous); b.afterRecoveryLedger.transaction = tx(committed ? 20.1 : 14.1, restart);
    b.recoveryLookup = [0, 1].map(instance => {
      const found = action(profiles.warehouse, instance, 'GET', `/shipping/${b.shipmentId}/receipts?submissionKey=${b.key}`, committed ? 200 : 404,
        committed ? { submission: original.submission } : undefined, null, null, committed ? 20.2 : 14.2);
      if (!committed) found.json.errorCode = 'SHIPMENT_RECEIPT_SUBMISSION_NOT_FOUND'; return found;
    }); e.actions.push(...b.recoveryLookup);
    b.replays = [1, 0].map((instance, n) => action(profiles.warehouse, instance, 'POST', `/shipping/${b.shipmentId}/receipt-events`, 201,
      { submission: original.submission, replayed: committed || n === 1 }, sent, b.key, committed ? 21 + n : 15 + n)); e.actions.push(...b.replays);
    b.afterReplayLedger = copy(original.snapshot); b.afterReplayLedger.transaction = tx(committed ? 21.1 : 15.1, restart);
    b.afterSecondReplayLedger = copy(b.afterReplayLedger); b.afterSecondReplayLedger.transaction = tx(committed ? 22.1 : 16.1, restart);
    const receiptData = { receipts: [{ ...original.submission.receipt }], receiptSummary: { acceptedQuantity: 10, processedQuantity: 10 } };
    b.readbacks = [0, 1].flatMap(instance => [action(profiles.sales, instance, 'GET', `/orders/${m.orderId}`, 200, { id: m.orderId, finalAmount: 200, paidAmount: 200,
      fulfillment: { lines: [{ orderItemId: m.orderItemId, orderedQuantity: 20, dispatchedQuantity: 20, reservedQuantity: 0,
        acceptedQuantity: (index + 1) * 10, outstandingQuantity: 20 - (index + 1) * 10 }] } }),
    action(profiles.warehouse, instance, 'GET', `/shipping/${b.shipmentId}/receipts`, 200, receiptData)]); e.actions.push(...b.readbacks);
    e.branches.push(b); previous = copy(b.afterSecondReplayLedger);
  }
  e.controlAfter = { containers: copy(containers), database: pg(19.2), replica: { recovery: true, streaming: true, replayLsn: '0/200' }, connectionErrors: [], credentialsIncluded: false };
  e.controlAfter.containers[0].startedAt = time(19.15); e.controlAfter.containers[1].startedAt = time(23);
  e.cleanup = { status: 'passed', settingsRestored: copy(e.settingsBefore), errors: [], replica: { restored: true, id: containers[1].id,
    recovery: true, streaming: true, targetLsn: '0/200', replayLsn: '0/200' } };
  const font = { missingSignatures: ['missing1', 'missing2'], glyphs: Array.from({ length: 8 }, (_, n) => ({ inkPixels: 20 + n, signature: `synthetic-glyph-${n}` })) };
  const browser = e.browser = { runId, actors: Object.entries(profiles).map(([job, a]) => ({ job, actorId: a.id, role: a.role })), actions: [], screenshots: [], readbacks: [], warehouseReadbacks: [] };
  const shot = (job, name) => { const file = `/synthetic-not-runtime/${name}.png`; browser.screenshots.push({ job, actorId: profiles[job].id,
    path: file, name, diagnostic: false, unverified: false, visible: true, unobscured: true, font: copy(font) }); return file; };
  for (let index = 0; index < 3; index++) browser.readbacks.push({ runId, actorId: profiles.sales.id, job: 'sales', instance: 1,
    orderId: m.orderId, lineId: m.orderItemId, orderNo: m.orderNo, expected: { reservedQuantity: 0, dispatchedQuantity: 20, acceptedQuantity: index * 10, outstandingQuantity: 20 - index * 10, orderedQuantity: 20 },
    testIds: { reserved: `order-reserved-${m.orderId}-${m.orderItemId}`, obligation: `order-line-obligation-${m.orderId}-${m.orderItemId}` },
    unobscured: true, font: copy(font), noPartialLoadWarning: true, texts: { line: '20 kg / 20 kg', reserved: ': 0 kg', obligation: `已签收: ${index * 10} kg 待交: ${20 - index * 10} kg` },
    crop: shot('sales', `sales-${index}-crop`), screenshot: shot('sales', `sales-${index}`) });
  for (const [index, branch] of e.branches.entries()) { const submission = branch.replays[0].json.data.submission;
    browser.warehouseReadbacks.push({ runId, actorId: profiles.warehouse.id, job: 'warehouse', instance: 0, shipmentId: branch.shipmentId,
      submission: copy(submission), receiptNo: submission.receipt.receiptNo, text: submission.receipt.receiptNo, screenshot: shot('warehouse', `warehouse-${index}`) }); }
  return resignPostgresRecoveryProof(e);
}

module.exports = { postgresRecoveryProofFixture, postgresRecoveryPriorChecks, resignPostgresRecoveryProof, rehashPostgresLedger, putPostgresLedgerRow };
