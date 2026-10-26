const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readPostgresLedgerSnapshot, compareLedgerSnapshots, REQUIRED_TABLES } = require('./lib/enterprise-round2-postgres-ledger.cjs');

// Pure pg.Client boundary tests, not PostgreSQL/ERP execution evidence.
const copy = value => JSON.parse(JSON.stringify(value));
const key = id => JSON.stringify([String(id)]);
const users = ['id', 'username', 'password_hash', 'email', 'role', 'segment', 'avatar',
  'is_active', 'must_change_password', 'password_changed_at', 'last_login_at', 'created_at', 'updated_at'];
const excluded = ['auth_roles', 'auth_permissions', 'auth_role_permissions', 'auth_policy_migrations', '_prisma_migrations'];
function column(table, name, ordinal, primaryKeyOrdinal = 0) {
  return { table, tableKind: 'r', name, ordinal, type: name === 'id' ? 'integer' : 'text', nullable: primaryKeyOrdinal === 0,
    default: null, identity: '', generated: '', collation: null, primaryKeyOrdinal };
}
function harness(options = {}) {
  const calls = [];
  const metadata = { database: 'fixture_only', schema: 'public', serverVersionNum: '160009', isolation: 'repeatable read',
    readOnly: 'on', timeZone: 'UTC', dateStyle: 'ISO, YMD', snapshot: '20:30:21,25', backendPid: '55',
    postmasterStartedAt: '2026-10-17 00:00:00+00', startedAt: '2026-10-17 00:01:00+00',
    snapshotReadAt: '2026-10-17 00:01:00.001+00', inRecovery: false, ...options.metadata };
  const catalog = REQUIRED_TABLES.flatMap(table => table === 'users'
    ? users.map((name, index) => column(table, name, index + 1, name === 'id' ? 1 : 0))
    : [column(table, 'id', 1, 1), column(table, 'amount', 2)]);
  for (const table of excluded) catalog.push(column(table, 'id', 1, 1));
  if (options.catalog) options.catalog(catalog);
  const client = { query: async (sql, values) => {
    calls.push({ sql, values });
    if (options.fail?.(sql, values)) throw new Error(`injected query failure: ${sql.slice(0, 50)}`);
    if (sql.includes('postgres-ledger:transaction')) return { rows: [copy(metadata)] };
    if (sql.includes('postgres-ledger:catalog')) {
      assert.deepEqual(values, ['public']);
      return { rows: copy(catalog) };
    }
    if (sql.includes('postgres-ledger:rows')) {
      const table = /FROM "public"\."([a-z_][a-z0-9_]*)"/.exec(sql)?.[1];
      assert(table, `Malformed/unsafe table projection: ${sql}`);
      assert(!excluded.includes(table), 'Excluded auth tables must never be read');
      if (table === 'users') assert(!sql.includes('"password_hash"'), 'Password hashes must never be selected');
      return { rows: copy(options.rows?.[table] || []) };
    }
    return { rows: [] };
  } };
  return { client, calls, metadata, catalog, read: () => readPostgresLedgerSnapshot(client, { runId: 'fixture-run-only' }) };
}
const hash = rows => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
function put(snapshot, table, rows) {
  snapshot.tables[table] = { rows, sha256: hash(rows) };
}
async function pair() {
  const before = await harness({ rows: { orders: [{ key: key(1), raw: '{"id":1,"amount":9007199254740992.000001}' }] } }).read();
  return { before, after: copy(before) };
}

test('all current Prisma business maps including account ownership are mandatory, not a hand-picked financial subset', () => {
  const directory = path.join(__dirname, '../backend/prisma/models');
  const mapped = fs.readdirSync(directory).filter(name => name.endsWith('.prisma')).flatMap(name =>
    [...fs.readFileSync(path.join(directory, name), 'utf8').matchAll(/@@map\("([^"]+)"\)/g)].map(match => match[1]));
  assert.equal(mapped.length, new Set(mapped).size);
  assert.deepEqual([...REQUIRED_TABLES].sort(), mapped.filter(name => !excluded.includes(name)).sort());
  assert.equal(REQUIRED_TABLES.length, new Set(REQUIRED_TABLES).size);
  for (const table of ['business_events', 'business_event_deliveries', 'audit_logs', 'supplier_payments', 'production_boms',
    'production_work_orders', 'stock_balances', 'inventory_cost_ledgers', 'barter_cash_obligations', 'users']) assert(REQUIRED_TABLES.includes(table));
});

test('one actual repeatable-read, read-only transaction retains full unparsed decimals and complete column/PK catalog', async () => {
  const raw = '{"id":9007199254740993,"amount":9007199254740992.000001,"quantity":0.000001}';
  const h = harness({ rows: { orders: [{ key: key('9007199254740993'), raw }] } });
  const result = await h.read();
  assert.equal(result.version, 'postgres-business-ledger-snapshot/v1');
  assert.equal(result.provider, 'postgresql');
  assert.equal(result.runId, 'fixture-run-only');
  assert.deepEqual(result.transaction, h.metadata);
  assert.equal(result.tables.orders.rows[0].raw, raw);
  assert.equal(result.tables.orders.sha256, hash(result.tables.orders.rows));
  assert.equal(result.manifest.length, REQUIRED_TABLES.length);
  assert.deepEqual(result.manifest.find(table => table.name === 'orders').primaryKey, ['id']);
  assert.equal(result.manifest.find(table => table.name === 'orders').columns[1].type, 'text');
  assert.equal(h.calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(h.calls.at(-1).sql, 'COMMIT');
  assert.equal(h.calls.filter(call => call.sql.startsWith('BEGIN')).length, 1);
  assert(!h.calls.some(call => call.sql === 'ROLLBACK'));
  const rowsQuery = h.calls.find(call => call.sql.includes('FROM "public"."orders"')).sql;
  assert(rowsQuery.includes('json_build_array(t."id"::text)::text'));
  assert(rowsQuery.includes('row_to_json(t)::text'));
  const catalogQuery = h.calls.find(call => call.sql.includes('postgres-ledger:catalog')).sql;
  assert(catalogQuery.includes('WITH ORDINALITY'), 'int2vector lower bound must not turn the first PK column into ordinal zero');
  assert(catalogQuery.includes('k.ordinality <= pk.indnkeyatts'), 'INCLUDE columns must not become PK components');
});

test('account ownership columns are captured, only the known password hash is explicitly excluded', async () => {
  const h = harness({ rows: { users: [{ key: key(7), raw: '{"id":7,"username":"receivables","role":"r2wf_ar","is_active":true}' }] } });
  const result = await h.read();
  const account = result.manifest.find(table => table.name === 'users');
  assert.deepEqual(account.columns.map(item => item.name), users.filter(name => name !== 'password_hash'));
  assert.equal(result.tables.users.rows[0].key, key(7));
  assert.deepEqual(result.exclusions.find(item => item.name === 'users').columns, ['password_hash']);
  assert(result.exclusions.every(item => item.present));
  assert.equal(h.calls.filter(call => call.sql.includes('postgres-ledger:rows')).length, REQUIRED_TABLES.length);
});

test('unknown future business tables are fully captured rather than silently omitted', async () => {
  const h = harness({ catalog: rows => rows.push(column('new_business_postings', 'id', 1, 1), column('new_business_postings', 'amount', 2)),
    rows: { new_business_postings: [{ key: key(12), raw: '{"id":12,"amount":0.000001}' }] } });
  const result = await h.read();
  assert.equal(result.manifest.length, REQUIRED_TABLES.length + 1);
  assert.equal(result.tables.new_business_postings.rows.length, 1);
});

test('new auth-prefixed tables are not hidden by a wildcard exclusion', async () => {
  const result = await harness({ catalog: rows => rows.push(column('auth_business_approval', 'id', 1, 1)),
    rows: { auth_business_approval: [{ key: key(1), raw: '{"id":1}' }] } }).read();
  assert.equal(result.tables.auth_business_approval.rows.length, 1);
});

test('actual PostgreSQL migration ledger is captured with its version TEXT primary key and no invented id column', async () => {
  // scripts/postgres-schema-migrate-v1.cjs creates this table outside Prisma.
  const version = '202610140001_purchase-quality-payables';
  const raw = `{"version":"${version}","checksum_sha256":"${'a'.repeat(64)}","execution_ms":12,"applied_at":"2026-10-17T00:00:00+00:00"}`;
  const h = harness({ catalog: rows => rows.push(
    column('ailaoda_schema_migrations', 'version', 1, 1),
    { ...column('ailaoda_schema_migrations', 'checksum_sha256', 2), type: 'character(64)', nullable: false },
    { ...column('ailaoda_schema_migrations', 'execution_ms', 3), type: 'integer', nullable: false },
    { ...column('ailaoda_schema_migrations', 'applied_at', 4), type: 'timestamp with time zone', nullable: false },
  ), rows: { ailaoda_schema_migrations: [{ key: key(version), raw }] } });
  const before = await h.read(), after = copy(before);
  const manifest = before.manifest.find(table => table.name === 'ailaoda_schema_migrations');
  assert.deepEqual(manifest.primaryKey, ['version']);
  assert(!manifest.columns.some(item => item.name === 'id'));
  assert.equal(before.tables.ailaoda_schema_migrations.rows[0].raw, raw);
  assert(h.calls.some(call => call.sql.includes('json_build_array(t."version"::text)::text')));
  assert.equal(compareLedgerSnapshots(before, after).equal, true);
  put(after, 'ailaoda_schema_migrations', [{ key: key(version), raw: raw.replace('"execution_ms":12', '"execution_ms":13') }]);
  assert.equal(compareLedgerSnapshots(before, after).equal, false, 'Migration history is not excluded merely because it has no id');
});

test('future unreviewed users columns fail closed before credentials can be selected', async () => {
  const h = harness({ catalog: rows => rows.push(column('users', 'new_2fa_secret', 99)) });
  await assert.rejects(h.read(), /credential-exposure review/);
  assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
  assert(!h.calls.some(call => call.sql.includes('postgres-ledger:rows')));
});

test('stable SQL text keys cover ordered composite primary keys without JS numeric coercion', async () => {
  const h = harness({ catalog: rows => {
    const id = rows.find(row => row.table === 'stock_balances' && row.name === 'id');
    id.primaryKeyOrdinal = 2;
    rows.push(column('stock_balances', 'warehouse_key', 3, 1));
  }, rows: { stock_balances: [{ key: '["仓库", "9007199254740993"]', raw: '{"id":9007199254740993,"warehouse_key":"仓库"}' }] } });
  const result = await h.read();
  assert.deepEqual(result.manifest.find(table => table.name === 'stock_balances').primaryKey, ['warehouse_key', 'id']);
  assert(h.calls.some(call => call.sql.includes('json_build_array(t."warehouse_key"::text, t."id"::text)::text')));
});

test('rows are canonicalized before hashing independently of client result order', async () => {
  const rows = [{ key: key(2), raw: '{"id":2}' }, { key: key(1), raw: '{"id":1}' }];
  const snapshot = await harness({ rows: { orders: rows } }).read();
  assert.deepEqual(snapshot.tables.orders.rows.map(row => row.key), [key(1), key(2)]);
  assert.equal(snapshot.tables.orders.sha256, hash([...rows].reverse()));
});

for (const [name, transform, pattern] of [
  ['missing business table', rows => rows.splice(rows.findIndex(row => row.table === 'supplier_payments'), 2), /Missing required business table: supplier_payments/],
  ['missing actor ownership column', rows => rows.splice(rows.findIndex(row => row.table === 'users' && row.name === 'role'), 1), /missing ownership\/auth-state column role/],
  ['duplicate column catalog', rows => rows.push(copy(rows[0])), /duplicate column/],
  ['duplicate column ordinal', rows => { rows.find(row => row.table === 'orders' && row.name === 'amount').ordinal = 1; }, /duplicate column ordinal/],
  ['zero-column unknown table', rows => rows.push({ ...column('unknown_empty_table', 'placeholder', 1), name: null }), /SQL identifier must be text/],
  ['missing PK', rows => rows.filter(row => row.table === 'orders').forEach(row => { row.primaryKeyOrdinal = 0; }), /missing complete primary key/],
  ['gapped PK ordinal', rows => { rows.find(row => row.table === 'orders' && row.name === 'id').primaryKeyOrdinal = 2; }, /missing complete primary key/],
  ['nullable PK', rows => { rows.find(row => row.table === 'orders' && row.name === 'id').nullable = true; }, /nullable primary key/],
  ['duplicate PK ordinal', rows => { const row = rows.find(row => row.table === 'orders' && row.name === 'amount'); row.primaryKeyOrdinal = 1; row.nullable = false; }, /duplicate primary key ordinal/],
  ['foreign table', rows => rows.filter(row => row.table === 'orders').forEach(row => { row.tableKind = 'f'; }), /foreign tables/],
  ['table identifier injection', rows => { rows[0].table = 'orders"; DROP TABLE orders;--'; }, /Unsupported public ledger identifier/],
  ['column identifier injection', rows => { rows[0].name = 'id) FROM users;--'; }, /Unsupported public ledger identifier/],
]) test(`catalog rejects ${name} and rolls back before reading any rows`, async () => {
  const h = harness({ catalog: transform });
  await assert.rejects(h.read(), pattern);
  assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
  assert(!h.calls.some(call => call.sql.includes('postgres-ledger:rows')));
});

test('duplicate keys and decoded JSON values are rejected, never silently deduplicated or rounded', async () => {
  for (const rows of [
    [{ key: key(1), raw: '{"id":1}' }, { key: key(1), raw: '{"id":1}' }],
    [{ key: 1, raw: '{"id":1}' }], [{ key: key(1), raw: { id: 1 } }],
  ]) {
    const h = harness({ rows: { orders: rows } });
    await assert.rejects(h.read(), /duplicate row key|key must be raw SQL text|raw must be unparsed SQL text/);
    assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
  }
});

for (const stage of ['BEGIN', 'SET LOCAL', 'postgres-ledger:transaction', 'postgres-ledger:catalog', 'postgres-ledger:rows', 'COMMIT']) {
  test(`query failure at ${stage} attempts ROLLBACK and never returns a snapshot`, async () => {
    const h = harness({ fail: sql => sql.includes(stage) });
    await assert.rejects(h.read(), /injected query failure/);
    assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
  });
}

test('ROLLBACK failure is retained together with the original error and requires discarding the client', async () => {
  const h = harness({ fail: sql => sql.includes('postgres-ledger:rows') || sql === 'ROLLBACK' });
  await assert.rejects(h.read(), error => error instanceof AggregateError && error.errors.length === 2 && /discard this client/.test(error.message));
});

for (const metadata of [{ isolation: 'read committed' }, { readOnly: 'off' }, { schema: 'other_schema' }, { timeZone: 'Asia/Saigon' }, { snapshot: '' }]) {
  test(`actual transaction settings are checked: ${JSON.stringify(metadata)}`, async () => {
    const h = harness({ metadata });
    await assert.rejects(h.read());
    assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
    assert(!h.calls.some(call => call.sql.includes('postgres-ledger:rows')));
  });
}

test('unchanged historical rows compare equal even when transaction identity/timestamp changes', async () => {
  const { before, after } = await pair();
  after.transaction.snapshot = '30:40:';
  after.transaction.backendPid = '99';
  after.transaction.postmasterStartedAt = '2026-10-17 01:00:00+00';
  assert.deepEqual(compareLedgerSnapshots(before, after), { equal: true, differences: [], allowedChangesApplied: [] });
});

for (const table of ['orders', 'stock_balances', 'inventory_cost_ledgers', 'business_events', 'audit_logs', 'business_event_deliveries', 'users']) {
  test(`a one-millionth raw change in ${table} cannot be hidden by JS number precision`, async () => {
    const { before, after } = await pair();
    put(before, table, [{ key: key(9), raw: '{"id":9,"amount":9007199254740992.000001}' }]);
    put(after, table, [{ key: key(9), raw: '{"id":9,"amount":9007199254740992.000002}' }]);
    const result = compareLedgerSnapshots(before, after);
    assert.equal(result.equal, false);
    assert.equal(result.differences.length, 1);
    assert.equal(result.differences[0].table, table);
  });
}

for (const field of ['type', 'nullable', 'default', 'ordinal', 'identity', 'generated', 'collation']) {
  test(`field catalog drift (${field}) is not authorized by any row allowance`, async () => {
    const { before, after } = await pair();
    const column = after.manifest.find(table => table.name === 'orders').columns[1];
    column[field] = field === 'nullable' ? !column[field] : field === 'ordinal' ? 6 : 'changed';
    const result = compareLedgerSnapshots(before, after);
    assert.equal(result.equal, false);
    assert(result.differences.some(item => item.kind === 'manifest'));
  });
}

test('new unknown table/PK changes are visible manifest drift, not automatically accepted', async () => {
  const before = await harness().read();
  const after = await harness({ catalog: rows => rows.push(column('future_business_ledger', 'id', 1, 1)) }).read();
  assert.equal(compareLedgerSnapshots(before, after).equal, false);
  const changed = copy(before);
  changed.manifest.find(table => table.name === 'orders').primaryKey = ['amount'];
  assert.equal(compareLedgerSnapshots(before, changed).equal, false);
});

test('only exact changed row, added row and deleted row allowances can be applied', async () => {
  const { before, after } = await pair();
  const old = before.tables.orders.rows[0].raw;
  put(after, 'orders', [{ key: key(1), raw: '{"id":1,"amount":9007199254740992.000002}' }]);
  put(before, 'audit_logs', [{ key: key(40), raw: '{"id":40,"action":"historic"}' }]);
  put(after, 'audit_logs', [{ key: key(40), raw: '{"id":40,"action":"historic"}' }, { key: key(41), raw: '{"id":41,"action":"CREATE"}' }]);
  put(before, 'notifications', [{ key: key(20), raw: '{"id":20}' }]);
  const allowedChanges = [
    { table: 'orders', key: key(1), expectedBefore: old, expectedAfter: after.tables.orders.rows[0].raw },
    { table: 'audit_logs', key: key(41), expectedBefore: null, expectedAfter: after.tables.audit_logs.rows[1].raw },
    { table: 'notifications', key: key(20), expectedBefore: '{"id":20}', expectedAfter: null },
  ];
  const result = compareLedgerSnapshots(before, after, { allowedChanges });
  assert.equal(result.equal, true);
  assert.equal(result.allowedChangesApplied.length, 3);
  assert.equal(allowedChanges.length, 3, 'Caller allowances must not be mutated');
});

test('an exact new audit allowance never authorizes modification of an earlier audit', async () => {
  const { before, after } = await pair();
  put(before, 'audit_logs', [{ key: key(40), raw: '{"id":40,"action":"historic"}' }]);
  put(after, 'audit_logs', [{ key: key(40), raw: '{"id":40,"action":"forged"}' }, { key: key(41), raw: '{"id":41,"action":"CREATE"}' }]);
  const result = compareLedgerSnapshots(before, after, { allowedChanges: [
    { table: 'audit_logs', key: key(41), expectedBefore: null, expectedAfter: '{"id":41,"action":"CREATE"}' },
  ] });
  assert.equal(result.equal, false);
  assert.equal(result.allowedChangesApplied.length, 1);
  assert.equal(result.differences[0].key, key(40));
});

for (const allowedChanges of [
  ['audit_logs'], { audit_logs: '*' }, ['*'], [{ table: '*', key: '*', expectedBefore: null, expectedAfter: 'x' }],
  [{ table: 'orders', key: '*', expectedBefore: null, expectedAfter: 'x' }],
  [{ table: 'orders', key: key(1), predicate: () => true }],
  [{ table: 'orders', key: key(1), expectedBefore: null, expectedAfter: 'x', ignoreColumns: ['amount'] }],
  [{ table: 'orders', key: key(1), expectedBefore: null, expectedAfter: null }],
  [{ table: 'orders', key: key(1), expectedBefore: {}, expectedAfter: 'x' }],
]) test(`broad or malformed allowlist is rejected: ${JSON.stringify(allowedChanges)}`, async () => {
  const { before, after } = await pair();
  assert.throws(() => compareLedgerSnapshots(before, after, { allowedChanges }));
});

test('wrong expected raw, wrong key, duplicate and unused allowances do not produce green', async () => {
  const { before, after } = await pair();
  const allowance = { table: 'orders', key: key(1), expectedBefore: before.tables.orders.rows[0].raw, expectedAfter: '{"id":1,"amount":42}' };
  for (const change of [allowance, { ...allowance, key: key(2) }, { ...allowance, expectedBefore: 'wrong' }]) {
    const result = compareLedgerSnapshots(before, after, { allowedChanges: [change] });
    assert.equal(result.equal, false);
    assert(result.differences.some(item => item.kind === 'unused-or-mismatched-allowance'));
  }
  assert.throws(() => compareLedgerSnapshots(before, after, { allowedChanges: [allowance, allowance] }), /Duplicate exact row allowance/);
});

test('missing tables, row hash tampering, duplicate keys and mismatched snapshot identity are refused', async () => {
  const { before, after } = await pair();
  const missing = copy(after); delete missing.tables.supplier_payments;
  assert.throws(() => compareLedgerSnapshots(before, missing), /coverage mismatch/);
  const duplicate = copy(after); duplicate.tables.orders.rows.push(copy(duplicate.tables.orders.rows[0]));
  assert.throws(() => compareLedgerSnapshots(before, duplicate), /duplicate row key/);
  const hashTamper = copy(after); hashTamper.tables.orders.rows[0].raw = '{"id":1,"amount":0}';
  assert.throws(() => compareLedgerSnapshots(before, hashTamper), /row hash mismatch/);
  const otherRun = copy(after); otherRun.runId = 'other-run';
  assert.throws(() => compareLedgerSnapshots(before, otherRun), /different runs/);
  const otherDb = copy(after); otherDb.transaction.database = 'other_database';
  assert.throws(() => compareLedgerSnapshots(before, otherDb), /different databases/);
});

test('credential exclusion scope cannot be widened or removed to hide a changed business table', async () => {
  const { before, after } = await pair();
  const widened = copy(after); widened.exclusions.push({ name: 'audit_logs', reason: 'ignore', present: true });
  assert.throws(() => compareLedgerSnapshots(before, widened), /Unexpected exclusion scope/);
  const actorOmission = copy(after); actorOmission.exclusions.find(item => item.name === 'users').columns.push('role');
  assert.throws(() => compareLedgerSnapshots(before, actorOmission), /known password column/);
  const missing = copy(after); delete missing.exclusions;
  assert.throws(() => compareLedgerSnapshots(before, missing), /Missing explicit credential exclusions/);
});
