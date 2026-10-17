const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const VERSION = 'postgres-business-ledger-snapshot/v1';
// This is a completeness floor, not a SELECT allowlist: new public tables are
// captured too. Keep the credential-bearing, non-business exclusions exact.
const REQUIRED_TABLES = Object.freeze([
  'adjustment_records', 'alert_rules', 'asset_balances', 'asset_transactions',
  'audit_logs', 'barter_agreement_items', 'barter_agreements', 'barter_cash_obligations',
  'barter_items', 'barter_offset_postings', 'barter_reversal_logs', 'barter_settlements',
  'barter_valuation_snapshots', 'batch_genealogy_edges', 'bi_sales_daily',
  'business_event_deliveries', 'business_events', 'collection_disputes', 'collection_promises',
  'contract_milestones', 'contracts', 'customers', 'incoming_quality_checks',
  'inventory_cost_ledgers', 'locations', 'material_aliases', 'material_density_revisions',
  'material_governance_changes', 'material_governance_runs', 'material_packaging_revisions',
  'materials', 'notifications', 'order_import_batches', 'order_items', 'orders',
  'payment_records', 'payment_reversal_requests', 'payment_reversals', 'payment_submissions',
  'product_batches', 'production_bom_items', 'production_boms', 'production_dispositions',
  'production_process_steps', 'production_quality_characteristics', 'production_quality_checks',
  'production_quality_measurements', 'production_work_orders', 'purchase_orders',
  'purchase_receipts', 'receipt_discrepancy_actions', 'receipt_discrepancy_cases',
  'receipt_tolerance_rules', 'receivable_adjustments', 'rmas', 'sales_fulfillment_plans',
  'samples', 'shipment_receipts', 'shipments', 'stock_balances', 'stock_entries',
  'stock_movements', 'supplier_payments', 'suppliers', 'warehouses',
  'users', 'workflow_actions', 'workflow_definitions', 'workflow_instances', 'workflow_tasks',
]);
const EXCLUSIONS = Object.freeze({
  auth_roles: 'Authorization configuration, not a business ledger; validated separately by the workforce gate.',
  auth_permissions: 'Authorization configuration, not a business ledger.',
  auth_role_permissions: 'Authorization configuration, not a business ledger.',
  auth_policy_migrations: 'Authorization migration bookkeeping, not a business ledger.',
  _prisma_migrations: 'Prisma migration bookkeeping, not a business ledger.',
});
const USER_COLUMNS = Object.freeze(['id', 'username', 'email', 'role', 'segment', 'avatar',
  'is_active', 'must_change_password', 'password_changed_at', 'last_login_at', 'created_at', 'updated_at']);
const USER_SECRET_COLUMN = 'password_hash';

const CATALOG_SQL = `/* postgres-ledger:catalog */
SELECT c.relname AS "table", c.relkind::text AS "tableKind", a.attname AS "name",
       a.attnum::int AS "ordinal", pg_catalog.format_type(a.atttypid, a.atttypmod) AS "type",
       NOT a.attnotnull AS "nullable", pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS "default",
       a.attidentity::text AS "identity", a.attgenerated::text AS "generated",
       CASE WHEN a.attcollation = 0 THEN NULL ELSE a.attcollation::regcollation::text END AS "collation",
       COALESCE((SELECT k.ordinality::int FROM unnest(pk.indkey) WITH ORDINALITY AS k(attnum, ordinality)
                  WHERE k.attnum = a.attnum AND k.ordinality <= pk.indnkeyatts), 0)::int AS "primaryKeyOrdinal"
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
  LEFT JOIN pg_catalog.pg_index pk ON pk.indrelid = c.oid AND pk.indisprimary
 WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'f')
 ORDER BY c.relname COLLATE "C", a.attnum`;
const TRANSACTION_SQL = `/* postgres-ledger:transaction */
SELECT current_database() AS "database", current_schema() AS "schema",
       current_setting('server_version_num') AS "serverVersionNum",
       current_setting('transaction_isolation') AS "isolation",
       current_setting('transaction_read_only') AS "readOnly",
       current_setting('TimeZone') AS "timeZone", current_setting('DateStyle') AS "dateStyle",
       pg_current_snapshot()::text AS "snapshot", pg_backend_pid()::text AS "backendPid",
       pg_postmaster_start_time()::text AS "postmasterStartedAt",
       transaction_timestamp()::text AS "startedAt", statement_timestamp()::text AS "snapshotReadAt",
       pg_is_in_recovery() AS "inRecovery"`;

function identifier(value) {
  assert.equal(typeof value, 'string', 'SQL identifier must be text');
  assert(/^[a-z_][a-z0-9_]*$/.test(value), `Unsupported public ledger identifier: ${value}`);
  return `"${value}"`;
}

function rowsHash(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function sortedRows(rows, name) {
  assert(Array.isArray(rows), `${name}: missing rows`);
  const seen = new Set();
  const result = rows.map(row => {
    assert.equal(typeof row.key, 'string', `${name}: key must be raw SQL text`);
    assert.equal(typeof row.raw, 'string', `${name}: raw must be unparsed SQL text`);
    assert(!seen.has(row.key), `${name}: duplicate row key ${row.key}`);
    seen.add(row.key);
    return { key: row.key, raw: row.raw };
  });
  return result.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

function catalogManifest(rows) {
  assert(Array.isArray(rows), 'Missing PostgreSQL column catalog');
  const tables = new Map();
  for (const row of rows) {
    identifier(row.table);
    identifier(row.name);
    assert(['r', 'p'].includes(row.tableKind), `${row.table}: foreign tables cannot prove a local MVCC snapshot`);
    if (Object.hasOwn(EXCLUSIONS, row.table)) continue;
    if (row.table === 'users') {
      assert(USER_COLUMNS.includes(row.name) || row.name === USER_SECRET_COLUMN,
        `users: unknown column ${row.name} requires credential-exposure review`);
      if (row.name === USER_SECRET_COLUMN) continue;
    }
    const table = tables.get(row.table) || { name: row.table, kind: row.tableKind, columns: [], primaryKey: [] };
    assert.equal(table.kind, row.tableKind, `${row.table}: inconsistent relation kind`);
    assert(!table.columns.some(column => column.name === row.name), `${row.table}: duplicate column ${row.name}`);
    assert(Number.isInteger(row.ordinal) && row.ordinal > 0, `${row.table}: invalid column ordinal`);
    assert(!table.columns.some(column => column.ordinal === row.ordinal), `${row.table}: duplicate column ordinal`);
    assert.equal(typeof row.type, 'string');
    assert(row.type.length > 0, `${row.table}: missing column type`);
    assert.equal(typeof row.nullable, 'boolean');
    assert(Number.isInteger(row.primaryKeyOrdinal) && row.primaryKeyOrdinal >= 0, `${row.table}: invalid primary key ordinal`);
    table.columns.push({ name: row.name, type: row.type, ordinal: row.ordinal, nullable: row.nullable,
      default: row.default, identity: row.identity, generated: row.generated, collation: row.collation });
    if (row.primaryKeyOrdinal > 0) {
      assert.equal(row.nullable, false, `${row.table}: nullable primary key`);
      assert(!table.primaryKey[row.primaryKeyOrdinal - 1], `${row.table}: duplicate primary key ordinal`);
      table.primaryKey[row.primaryKeyOrdinal - 1] = row.name;
    }
    tables.set(row.table, table);
  }
  for (const name of REQUIRED_TABLES) assert(tables.has(name), `Missing required business table: ${name}`);
  const userNames = tables.get('users').columns.map(column => column.name);
  for (const name of USER_COLUMNS) assert(userNames.includes(name), `users: missing ownership/auth-state column ${name}`);
  for (const table of tables.values()) {
    table.columns.sort((a, b) => a.ordinal - b.ordinal);
    assert(table.primaryKey.length > 0 && Array.from(table.primaryKey).every(Boolean), `${table.name}: missing complete primary key`);
  }
  return [...tables.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/** A dedicated, idle pg.Client is required; never pass a Pool/query facade. */
async function readPostgresLedgerSnapshot(pgClient, { runId } = {}) {
  assert(pgClient && typeof pgClient.query === 'function', 'A dedicated PostgreSQL client is required');
  assert.equal(typeof runId, 'string');
  assert(runId.trim().length > 0, 'runId is required');
  let begun = false;
  try {
    begun = true;
    await pgClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    // Stable textual output across before/after connections. These are LOCAL
    // settings only; no application or database-wide settings are changed.
    await pgClient.query("SET LOCAL search_path = public, pg_catalog");
    await pgClient.query("SET LOCAL TIME ZONE 'UTC'");
    await pgClient.query("SET LOCAL DateStyle = 'ISO, YMD'");
    await pgClient.query('SET LOCAL extra_float_digits = 3');
    await pgClient.query("SET LOCAL bytea_output = 'hex'");
    const metadata = await pgClient.query(TRANSACTION_SQL);
    assert.equal(metadata.rows.length, 1, 'Missing actual PostgreSQL transaction metadata');
    const transaction = metadata.rows[0];
    assert.equal(transaction.schema, 'public');
    assert.equal(transaction.isolation, 'repeatable read');
    assert.equal(transaction.readOnly, 'on');
    assert.equal(transaction.timeZone, 'UTC');
    assert.equal(typeof transaction.snapshot, 'string');
    assert(transaction.snapshot.length > 0, 'Missing actual MVCC snapshot');
    const catalog = await pgClient.query(CATALOG_SQL, ['public']);
    const manifest = catalogManifest(catalog.rows);
    const present = new Set(catalog.rows.map(row => row.table));
    const exclusions = Object.entries(EXCLUSIONS).map(([name, reason]) => ({ name, reason, present: present.has(name) }));
    exclusions.push({ name: 'users', columns: [USER_SECRET_COLUMN],
      reason: 'Exclude password hashes only; retain account ownership and authorization-state columns.',
      present: catalog.rows.some(row => row.table === 'users' && row.name === USER_SECRET_COLUMN) });
    const tables = Object.create(null);
    for (const table of manifest) {
      const key = `json_build_array(${table.primaryKey.map(column => `t.${identifier(column)}::text`).join(', ')})::text`;
      // Casting the entire JSON value to TEXT is deliberate: node-pg must not
      // decode numeric JSON values into JS Number and erase ledger differences.
      const projection = table.columns.map(column => identifier(column.name)).join(', ');
      const query = `/* postgres-ledger:rows */ SELECT ${key} AS key, row_to_json(t)::text AS raw FROM (SELECT ${projection} FROM "public".${identifier(table.name)}) AS t ORDER BY (${key}) COLLATE "C"`;
      const result = await pgClient.query(query);
      const rows = sortedRows(result.rows, table.name);
      tables[table.name] = { rows, sha256: rowsHash(rows) };
    }
    await pgClient.query('COMMIT');
    begun = false;
    return { version: VERSION, provider: 'postgresql', runId, transaction, exclusions, manifest, tables };
  } catch (error) {
    if (begun) {
      try { await pgClient.query('ROLLBACK'); }
      catch (rollbackError) { throw new AggregateError([error, rollbackError], 'PostgreSQL ledger snapshot failed; ROLLBACK also failed, discard this client'); }
    }
    throw error;
  }
}

function validateSnapshot(snapshot) {
  assert.equal(snapshot?.version, VERSION, 'Unsupported ledger snapshot version');
  assert.equal(snapshot.provider, 'postgresql');
  assert.equal(typeof snapshot.runId, 'string');
  assert.equal(snapshot.transaction?.isolation, 'repeatable read');
  assert.equal(snapshot.transaction?.readOnly, 'on');
  assert.equal(typeof snapshot.transaction?.snapshot, 'string');
  assert(snapshot.transaction.snapshot.length > 0, 'Missing MVCC snapshot identity');
  assert(Array.isArray(snapshot.exclusions), 'Missing explicit credential exclusions');
  assert.deepEqual(snapshot.exclusions.map(item => item.name).sort(), [...Object.keys(EXCLUSIONS), 'users'].sort(), 'Unexpected exclusion scope');
  assert.deepEqual(snapshot.exclusions.find(item => item.name === 'users').columns, [USER_SECRET_COLUMN], 'Only the known password column may be excluded from users');
  assert(Array.isArray(snapshot.manifest), 'Missing ledger manifest');
  const names = snapshot.manifest.map(table => table.name);
  assert.equal(new Set(names).size, names.length, 'Duplicate table in ledger manifest');
  assert.deepEqual([...Object.keys(snapshot.tables)].sort(), [...names].sort(), 'Manifest/table coverage mismatch');
  for (const required of REQUIRED_TABLES) assert(names.includes(required), `Missing required business table: ${required}`);
  for (const table of snapshot.manifest) {
    identifier(table.name);
    assert(!Object.hasOwn(EXCLUSIONS, table.name), 'Sensitive excluded table must not appear in business rows');
    assert(Array.isArray(table.columns) && table.columns.length > 0, `${table.name}: missing column catalog`);
    assert(Array.isArray(table.primaryKey) && table.primaryKey.length > 0, `${table.name}: missing primary key catalog`);
    const columns = table.columns.map(column => column.name);
    assert.equal(new Set(columns).size, columns.length, `${table.name}: duplicate column catalog`);
    if (table.name === 'users') assert.deepEqual([...columns].sort(), [...USER_COLUMNS].sort(), 'User ownership column coverage changed');
    for (const key of table.primaryKey) assert(columns.includes(key), `${table.name}: primary key missing from column catalog`);
    const rows = sortedRows(snapshot.tables[table.name].rows, table.name);
    assert.deepEqual(rows, snapshot.tables[table.name].rows, `${table.name}: noncanonical row ordering/shape`);
    assert.equal(snapshot.tables[table.name].sha256, rowsHash(rows), `${table.name}: row hash mismatch`);
  }
}

/** No table/column ignores: every exception is one exact observed row delta. */
function compareLedgerSnapshots(before, after, { allowedChanges = [] } = {}) {
  validateSnapshot(before);
  validateSnapshot(after);
  assert.equal(before.runId, after.runId, 'Ledger snapshots belong to different runs');
  assert.equal(before.transaction.database, after.transaction.database, 'Ledger snapshots belong to different databases');
  assert(Array.isArray(allowedChanges), 'allowedChanges must be exact row changes, not a table allowlist');
  const permitted = new Map();
  for (const change of allowedChanges) {
    assert(change && typeof change === 'object' && !Array.isArray(change), 'Invalid exact row allowance');
    assert.deepEqual(Object.keys(change).sort(), ['expectedAfter', 'expectedBefore', 'key', 'table'], 'Allowances require exactly table/key/expectedBefore/expectedAfter');
    identifier(change.table);
    assert(Object.hasOwn(before.tables, change.table) && Object.hasOwn(after.tables, change.table), 'Allowance cannot authorize table creation/removal');
    assert.equal(typeof change.key, 'string');
    assert(change.key.length > 0 && change.key !== '*', 'A concrete SQL row key is required');
    for (const field of ['expectedBefore', 'expectedAfter']) assert(change[field] === null || typeof change[field] === 'string', `${field} must be exact raw text or null`);
    assert.notEqual(change.expectedBefore, change.expectedAfter, 'Allowance must describe an actual change');
    const identity = JSON.stringify([change.table, change.key]);
    assert(!permitted.has(identity), 'Duplicate exact row allowance');
    permitted.set(identity, change);
  }
  const differences = [], allowedChangesApplied = [];
  if (!isDeepStrictEqual(before.manifest, after.manifest)) differences.push({ kind: 'manifest', before: before.manifest, after: after.manifest });
  if (!isDeepStrictEqual(before.exclusions, after.exclusions)) differences.push({ kind: 'exclusions', before: before.exclusions, after: after.exclusions });
  for (const table of new Set([...Object.keys(before.tables), ...Object.keys(after.tables)])) {
    const oldRows = new Map((before.tables[table]?.rows || []).map(row => [row.key, row.raw]));
    const newRows = new Map((after.tables[table]?.rows || []).map(row => [row.key, row.raw]));
    for (const key of new Set([...oldRows.keys(), ...newRows.keys()])) {
      const expectedBefore = oldRows.has(key) ? oldRows.get(key) : null;
      const expectedAfter = newRows.has(key) ? newRows.get(key) : null;
      if (expectedBefore === expectedAfter) continue;
      const identity = JSON.stringify([table, key]);
      const allowance = permitted.get(identity);
      const delta = { table, key, expectedBefore, expectedAfter };
      if (allowance && isDeepStrictEqual(allowance, delta)) {
        allowedChangesApplied.push(delta);
        permitted.delete(identity);
      } else differences.push({ kind: 'row', ...delta });
    }
  }
  for (const change of permitted.values()) differences.push({ kind: 'unused-or-mismatched-allowance', ...change });
  return { equal: differences.length === 0, differences, allowedChangesApplied };
}

module.exports = { readPostgresLedgerSnapshot, compareLedgerSnapshots, REQUIRED_TABLES };
