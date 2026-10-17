const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { verifyPostgresRecoveryProof, verifyPostgresLedgerRecovery, deriveRecoveryLedgerChanges } = require('./lib/enterprise-round2-postgres-recovery-proof.cjs');
const { postgresRecoveryProofFixture, postgresRecoveryPriorChecks, resignPostgresRecoveryProof, rehashPostgresLedger,
  putPostgresLedgerRow } = require('./fixtures/postgres-recovery-proof-fixture.cjs');

// Contract tests exercise synthetic evidence shape and refusal boundaries only.
// They do not execute PostgreSQL, ERP, a browser or an actual crash experiment.
const copy = value => JSON.parse(JSON.stringify(value));
const allSnapshots = e => [e.baseline, ...e.branches.flatMap(b => [b.beforeLedger, b.afterRecoveryLedger, b.afterReplayLedger, b.afterSecondReplayLedger])];
const row = (snapshot, table, id) => snapshot.tables[table].rows.find(row => JSON.parse(row.raw).id === id);
const setValue = (snapshot, table, id, field, value) => { const valueRow = JSON.parse(row(snapshot, table, id).raw); valueRow[field] = value; putPostgresLedgerRow(snapshot, table, valueRow); };
const verify = e => verifyPostgresRecoveryProof(e, { runId: e.runId, priorChecks: postgresRecoveryPriorChecks() });

test('synthetic chain proves the two distinct commit windows and derives second fixed ID from the same source', () => {
  const e = postgresRecoveryProofFixture(), proof = verify(e), derived = verifyPostgresLedgerRecovery(e, { runId: e.runId, priorChecks: postgresRecoveryPriorChecks() });
  assert.equal(proof.priorChecks, 34); assert.equal(proof.originalReceipts, 2); assert.equal(proof.duplicateReceipts, 0);
  assert.equal(proof.fullLedgerSnapshots, 9); assert.equal(proof.productionReady, false); assert.equal(proof.fullWorkforceAccepted, false);
  assert.deepEqual(derived, { ...proof, schema: 'enterprise-round2-postgres-ledger-recovery-proof/v1', sourceChainDigest: e.chainDigest });
});

test('fixture accepts caller raw prior siblings and preserves caller run identity without importing regression code', () => {
  const priorChecks = postgresRecoveryPriorChecks(); priorChecks[0].evidence.changed = 'another actual replay';
  const e = postgresRecoveryProofFixture({ runId: 'fixture-other-run-only', priorChecks });
  assert.equal(verifyPostgresRecoveryProof(e, { runId: e.runId, priorChecks }).runId, e.runId);
  assert.throws(() => verify(e), /Prior proof belongs/);
});

const mutations = [
  ['wrong provider', e => { e.provider = 'sqlite'; }],
  ['false success status', e => { e.status = 'failed'; }],
  ['missing old obligation', e => { e.priorChecks.pop(); }],
  ['duplicate old obligation', e => { e.priorChecks[1] = copy(e.priorChecks[0]); }],
  ['previous package not passed', e => { e.priorChecks[0].status = 'not_run'; }],
  ['forged previous evidence digest', e => { e.priorChecks[0].evidenceSha256 = 'f'.repeat(64); }],
  ['warehouse replaced by administrator', e => { e.profiles.warehouse.role = 'admin'; }],
  ['warehouse universal scope', e => { e.profiles.warehouse.dataScopes.push('all'); }],
  ['warehouse lacks receipt capability', e => { e.profiles.warehouse.permissions = ['shipping.read']; }],
  ['warehouse and sales share an account', e => { e.profiles.sales.id = e.profiles.warehouse.id; }],
  ['database role differs from claimed profile', e => { setValue(e.baseline, 'users', 70, 'role', 'admin'); }],
  ['actual PG17.7 disguised by PG16.9 image tag', e => { e.controlBefore.database.version = 170007; }],
  ['actual fsync disabled', e => { e.controlBefore.database.fsync = 'off'; }],
  ['actual PGDATA differs', e => { e.controlBefore.database.dataDirectory = '/another/data'; }],
  ['database system identifier changed', e => { e.controlAfter.database.systemIdentifier = '999999999'; }],
  ['primary process replaced instead of restarted', e => { e.controlAfter.containers[0].id = 'f'.repeat(64); }],
  ['application restarted instead of surviving database fault', e => { e.controlAfter.containers[2].startedAt = '2026-10-17T00:00:30Z'; }],
  ['immutable application image changed', e => { e.controlAfter.containers[2].imageId = `sha256:${'f'.repeat(64)}`; }],
  ['primary volume switched', e => { e.controlAfter.containers[0].volume.source = '/foreign'; }],
  ['initial replica was already stopped', e => { e.replicaStopped.originallyRunning = false; }],
  ['replica not restored', e => { e.cleanup.replica.restored = false; }],
  ['replica accidentally promoted', e => { e.cleanup.replica.recovery = false; }],
  ['replica WAL has not caught up', e => { e.cleanup.replica.replayLsn = '0/1'; }],
  ['cleanup failure', e => { e.cleanup.errors.push({ name: 'settings', message: 'failed' }); }],
  ['restored effective setting drift', e => { e.cleanup.settingsRestored.effective.setting = 'foreign'; }],
  ['restored auto.conf entry drift', e => { e.cleanup.settingsRestored.autoEntries.push({ name: 'synchronous_standby_names', setting: '' }); }],
  ['foreign transaction xid at COMMIT', e => { e.branches[1].syncRep.backend_xid = '999'; }],
  ['reused PID belongs to a different backend generation', e => { e.branches[1].syncRep.backend_start = '2026-10-17T00:00:14Z'; }],
  ['COMMIT is not the row-locked transaction', e => { e.branches[1].syncRep.xact_start = '2026-10-17T00:00:18.010Z'; }],
  ['not actually waiting for SyncRep', e => { e.branches[1].syncRep.wait_event_type = 'Lock'; }],
  ['not actual COMMIT query', e => { e.branches[1].syncRep.query = 'SELECT 1'; }],
  ['row-lock wait is not bound to any locker', e => { e.branches[0].bound.blockers = []; }],
  ['wait observed before database generation', e => { e.branches[1].bound.backend_start = '2026-10-17T00:00:01Z'; }],
  ['synchronous gate could be satisfied by real standby', e => { e.branches[1].gate.standbyCount = 1; }],
  ['synchronous gate is not a unique owned gate', e => { e.branches[1].gate.value = 'FIRST 1 (production_standby)'; }],
  ['global LSN substituted for exact transaction window', e => { e.branches[1].waitLSN.boundary = 'global WAL LSN was high'; }],
  ['invented local flush observation without wait LSN', e => { e.branches[1].waitLSN.localFlushed = true; }],
  ['observed wait LSN was not locally flushed', e => { e.branches[1].waitLSN.value = '0/100'; e.branches[1].waitLSN.localFlushed = false; }],
  ['acknowledgment already received before kill', e => { e.branches[1].ackPendingAtKill.headersReceived = true; }],
  ['request settled before kill', e => { e.branches[0].ackPendingAtKill.settled = true; }],
  ['expired Prisma fault window', e => { e.branches[1].windowToKillMs = 3000; }],
  ['clean stop substituted for crash', e => { e.branches[0].kill.exitCode = 0; }],
  ['wrong process generation killed', e => { e.branches[0].kill.processStartedAt = '2026-10-17T00:00:01Z'; }],
  ['primary started before original HTTP ended', e => { e.branches[0].request.finishedAt = '2026-10-17T00:00:13.100Z'; }],
  ['successful original response is not ambiguous commit', e => { e.branches[1].request.status = 201; e.branches[1].request.json.success = true; }],
  ['client timeout substituted for crash error', e => { const request = e.branches[0].request; request.status = 0; request.headersReceivedAt = null;
    request.transportError = { code: 'UND_ERR_CONNECT_TIMEOUT', name: 'TimeoutError' }; }],
  ['recovery log digest forged', e => { e.branches[0].recoveryLogs.sha256 = 'f'.repeat(64); }],
  ['no actual crash-recovery log', e => { const logs = e.branches[1].recoveryLogs; logs.text = 'server started normally and ready'; logs.sha256 = crypto.createHash('sha256').update(logs.text).digest('hex'); }],
  ['crash log from another container', e => { e.branches[1].recoveryLogs.containerId = 'f'.repeat(64); }],
  ['crash log predates fault', e => { e.branches[1].recoveryLogs.since = '2026-10-17T00:00:00Z'; }],
  ['first replay says already committed when precommit was killed', e => { e.branches[0].replays[0].json.data.replayed = true; }],
  ['committed replay recreates receipt instead of returning original', e => { e.branches[1].replays[0].json.data.replayed = false; }],
  ['replay changed original key', e => { e.branches[1].replays[0].key = 'another-valid-key'; }],
  ['replay changed receipt facts', e => { e.branches[0].replays[0].sent = { ...e.branches[0].request.sent, quantity: 11 }; }],
  ['replay executed only on same node', e => { e.branches[0].replays[0].instance = 0; }],
  ['recovered lookup wrong not-found code', e => { e.branches[0].recoveryLookup[0].json.errorCode = 'NOT_FOUND'; }],
  ['committed original ACK differs from database frozen receipt', e => { e.branches[1].recoveryLookup[0].json.data.submission.receipt.id = 9999; }],
  ['dual-node sales readback wrong quantity', e => { e.branches[1].readbacks[0].json.data.fulfillment.lines[0].acceptedQuantity = 19; }],
  ['receipt readback wrong original receiptNo', e => { e.branches[0].readbacks[1].json.data.receipts[0].receiptNo = 'another'; }],
  ['browser claims stale outstanding quantity', e => { e.browser.readbacks[2].expected.outstandingQuantity = 1; }],
  ['browser quietly displays partial-load warning', e => { e.browser.readbacks[0].noPartialLoadWarning = false; }],
  ['browser business target is obscured', e => { e.browser.screenshots[0].unobscured = false; }],
  ['diagnostic screenshot substituted for acceptance', e => { e.browser.screenshots[0].diagnostic = true; }],
  ['missing CJK glyph', e => { e.browser.screenshots[0].font.glyphs[0].signature = 'missing1'; }],
  ['warehouse browser readback belongs to foreign actor', e => { e.browser.warehouseReadbacks[0].actorId = 71; }],
  ['warehouse browser never showed original receipt', e => { e.browser.warehouseReadbacks[0].text = 'empty'; }],
  ['sales still made unpermitted optional lookup', e => { e.browser.actions.push({ job: 'sales', method: 'GET', path: '/api/contracts' }); }],
  ['missing prior business domain', e => { e.baseline.tables.supplier_payments.rows = []; rehashPostgresLedger(e.baseline); }],
  ['read-write ledger snapshot', e => { e.branches[0].afterRecoveryLedger.transaction.readOnly = 'off'; }],
  ['snapshot from another database', e => { e.branches[0].afterRecoveryLedger.transaction.database = 'another'; }],
  ['snapshot from stale postmaster', e => { e.branches[0].afterRecoveryLedger.transaction.postmasterStartedAt = e.controlBefore.database.postmasterStartedAt; }],
];
for (const [name, mutate] of mutations) test(`rejects ${name} even after chain is re-signed`, () => {
  const e = postgresRecoveryProofFixture(); mutate(e); resignPostgresRecoveryProof(e); assert.throws(() => verify(e));
});

test('chain digest alone catches unsigned modifications', () => {
  const e = postgresRecoveryProofFixture(); e.scope += ' changed'; assert.throws(() => verify(e), /digest mismatch/);
});
test('caller runId and raw siblings are mandatory when supplied; a digest-only sibling is not raw proof', () => {
  const e = postgresRecoveryProofFixture(); assert.throws(() => verifyPostgresRecoveryProof(e, { runId: 'stale-run' }));
  assert.throws(() => verifyPostgresRecoveryProof(e, { priorChecks: e.priorChecks }), /raw evidence/);
});
test('missing raw HTTP provenance cannot be replaced by a plausible fabricated ACK', () => {
  const e = postgresRecoveryProofFixture(), target = e.branches[0].replays[0];
  e.actions = e.actions.filter(action => action !== target); resignPostgresRecoveryProof(e); assert.throws(() => verify(e), /missing from capture/);
});
test('duplicate frozen audit and duplicate receipt are rejected with fresh table hashes and chain digest', () => {
  for (const table of ['audit_logs', 'shipment_receipts']) {
    const e = postgresRecoveryProofFixture(), snapshot = e.branches[0].afterReplayLedger;
    const existing = JSON.parse(row(snapshot, table, table === 'audit_logs' ? 3001 : 2001).raw);
    putPostgresLedgerRow(snapshot, table, { ...existing, id: 9999 }); resignPostgresRecoveryProof(e); assert.throws(() => verify(e));
  }
});
test('amount changed by 0.000001 is rejected even on the target order whose status may change', () => {
  const e = postgresRecoveryProofFixture(); setValue(e.branches[0].afterReplayLedger, 'orders', e.manifest.orderId, 'final_amount', 200.000001);
  resignPostgresRecoveryProof(e); assert.throws(() => verify(e), /Historical column changed: final_amount/);
});
test('historical huge number change survives JSON Number collision and is still rejected by raw comparison', () => {
  const e = postgresRecoveryProofFixture();
  for (const snapshot of allSnapshots(e)) {
    const target = row(snapshot, 'orders', 1); target.raw = target.raw.replace('"final_amount":null', '"final_amount":9007199254740992.000001'); rehashPostgresLedger(snapshot);
  }
  const target = row(e.branches[1].afterReplayLedger, 'orders', 1); const before = target.raw;
  target.raw = target.raw.replace('9007199254740992.000001', '9007199254740992.000002');
  assert.equal(JSON.parse(before).final_amount, JSON.parse(target.raw).final_amount, 'Test actually exercises precision collapse');
  rehashPostgresLedger(e.branches[1].afterReplayLedger); resignPostgresRecoveryProof(e); assert.throws(() => verify(e), /Unapproved full-ledger delta/);
});
test('dropping an entire monetary column from every manifest and row cannot hide historical changes', () => {
  const e = postgresRecoveryProofFixture();
  for (const snapshot of allSnapshots(e)) {
    const manifest = snapshot.manifest.find(table => table.name === 'payment_records'); manifest.columns = manifest.columns.filter(column => column.name !== 'exchange_rate');
    for (const record of snapshot.tables.payment_records.rows) { const value = JSON.parse(record.raw); delete value.exchange_rate; record.raw = JSON.stringify(value); }
    rehashPostgresLedger(snapshot);
  }
  resignPostgresRecoveryProof(e); assert.throws(() => verify(e), /Omitted current business column: payment_records.exchange_rate/);
});
test('unknown public tables with real non-id primary keys are captured and must stay identical', () => {
  const e = postgresRecoveryProofFixture();
  for (const snapshot of allSnapshots(e)) {
    snapshot.manifest.push({ name: 'ailaoda_schema_migrations', kind: 'r', primaryKey: ['version'], columns: [
      { name: 'version', type: 'text', ordinal: 1 }, { name: 'applied_at', type: 'timestamp', ordinal: 2 }] });
    snapshot.tables.ailaoda_schema_migrations = { rows: [{ key: '["20261017"]', raw: '{"version":"20261017","applied_at":"2026-10-17T00:00:00Z"}' }] };
    rehashPostgresLedger(snapshot);
  }
  resignPostgresRecoveryProof(e); verify(e);
  const changed = e.branches[1].afterSecondReplayLedger;
  changed.tables.ailaoda_schema_migrations.rows[0].raw = changed.tables.ailaoda_schema_migrations.rows[0].raw.replace('00:00:00', '00:00:01');
  rehashPostgresLedger(changed); resignPostgresRecoveryProof(e); assert.throws(() => verify(e), /Unapproved full-ledger delta/);
});
test('producer-provided table ignore or allowedChanges cannot legalize unrelated ledger mutations', () => {
  const e = postgresRecoveryProofFixture(), b = e.branches[1];
  const old = copy(row(b.afterSecondReplayLedger, 'inventory_cost_ledgers', 1));
  setValue(b.afterSecondReplayLedger, 'inventory_cost_ledgers', 1, 'cost_amount_delta', 0.000001);
  e.allowedChanges = [{ table: 'inventory_cost_ledgers', key: old.key, expectedBefore: old.raw, expectedAfter: row(b.afterSecondReplayLedger, 'inventory_cost_ledgers', 1).raw }];
  e.ignoreTables = ['inventory_cost_ledgers']; resignPostgresRecoveryProof(e); assert.throws(() => verify(e), /Unapproved full-ledger delta/);
});
test('exact allowances derive only native committed receipt/audit and precise order/shipment columns', () => {
  const e = postgresRecoveryProofFixture(), b = e.branches[0];
  const changes = deriveRecoveryLedgerChanges(b.afterRecoveryLedger, b.afterReplayLedger, { completedBranches: [b], manifest: e.manifest, profiles: e.profiles, actions: e.actions });
  assert.deepEqual([...new Set(changes.map(change => change.table))].sort(), ['audit_logs', 'orders', 'shipment_receipts', 'shipments']);
  assert(changes.every(change => Object.keys(change).sort().join(',') === 'expectedAfter,expectedBefore,key,table'));
  assert.equal(changes.length, 4);
});
test('uncaptured technical audit and second audit for one captured request cannot be waived', () => {
  for (const duplicate of [false, true]) {
    const e = postgresRecoveryProofFixture(), b = e.branches[0], value = { id: 4001, user_id: 70, action: 'POST',
      resource: '/api/shipping/1005/receipt-events', resource_id: null, details: 'Status: 201, Duration: 12ms', created_at: '2026-10-17T00:00:15Z' };
    if (duplicate) {
      putPostgresLedgerRow(b.afterReplayLedger, 'audit_logs', value); putPostgresLedgerRow(b.afterSecondReplayLedger, 'audit_logs', value);
      // Both actual 201 replays are captured, so three technical audits exceed
      // this concrete target's total request count, not a table-wide ignore.
      putPostgresLedgerRow(b.afterReplayLedger, 'audit_logs', { ...value, id: 4002 }); putPostgresLedgerRow(b.afterReplayLedger, 'audit_logs', { ...value, id: 4003 });
    } else putPostgresLedgerRow(b.afterReplayLedger, 'audit_logs', { ...value, resource: '/api/orders/1001/payment' });
    resignPostgresRecoveryProof(e); assert.throws(() => verify(e), /Uncaptured or duplicate new technical audit/);
  }
});
test('a future replay action cannot authorize a technical audit in the earlier recovery snapshot', () => {
  const e = postgresRecoveryProofFixture(), b = e.branches[0];
  putPostgresLedgerRow(b.afterRecoveryLedger, 'audit_logs', { id: 4999, user_id: 70, action: 'POST', resource: '/api/shipping/1005/receipt-events',
    resource_id: null, details: 'Status: 201, Duration: 12ms', created_at: '2026-10-17T00:00:14.050Z' });
  resignPostgresRecoveryProof(e); assert.throws(() => verify(e), /Uncaptured or duplicate new technical audit/);
});
test('precommit recovery cannot include receipt, and committed recovery cannot lose original receipt', () => {
  for (const committed of [false, true]) {
    const e = postgresRecoveryProofFixture(), b = e.branches[Number(committed)];
    b.afterRecoveryLedger = copy(committed ? b.beforeLedger : b.afterReplayLedger);
    b.afterRecoveryLedger.transaction = copy(b.afterReplayLedger.transaction); resignPostgresRecoveryProof(e); assert.throws(() => verify(e));
  }
});

function pngBytes() {
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (name, bytes) => { const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc(Buffer.concat([type, bytes]))); return Buffer.concat([length, type, bytes, checksum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(16); header.writeUInt32BE(16, 4); header[8] = 8; header[9] = 6;
  const raster = Buffer.alloc(16 * (16 * 4 + 1), 255); for (let y = 0; y < 16; y++) raster[y * 65] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raster)), chunk('IEND', Buffer.alloc(0))]);
}
test('optional artifact resolver checks actual PNG files rather than accepting evidence path strings', () => {
  const root = path.join(__dirname, '../output/review/postgres-proof-contract'); fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, `synthetic-${crypto.randomUUID()}.png`); fs.writeFileSync(file, pngBytes());
  try {
    const e = postgresRecoveryProofFixture(), visited = new Set();
    verifyPostgresRecoveryProof(e, { priorChecks: postgresRecoveryPriorChecks(), resolveArtifactPath: original => { visited.add(original); return file; } });
    assert.equal(visited.size, 8);
    fs.writeFileSync(file, 'not a PNG'); assert.throws(() => verifyPostgresRecoveryProof(e, { resolveArtifactPath: () => file }));
  } finally { fs.unlinkSync(file); }
});
