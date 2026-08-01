import prisma from '../config/database';

export type RepairAction = 'created' | 'exists' | 'added' | 'skipped' | 'dropped' | 'updated';

export interface SchemaRepairEntry {
  kind: 'table' | 'column' | 'index' | 'trigger' | 'seed';
  target: string;
  action: RepairAction;
}

export interface SchemaRepairReport {
  entries: SchemaRepairEntry[];
}

type TableInfoRow = {
  cid?: unknown;
  name?: unknown;
  type?: unknown;
  notnull?: unknown;
  dflt_value?: unknown;
  pk?: unknown;
};

const normalizeTableInfo = (rows: TableInfoRow[]) =>
  rows.map((row) => ({
    ...row,
    cid: typeof row.cid === 'bigint' ? Number(row.cid) : row.cid,
    pk: typeof row.pk === 'bigint' ? Number(row.pk) : row.pk,
    notnull: typeof row.notnull === 'bigint' ? Number(row.notnull) : row.notnull,
  }));

export const tableExists = async (tableName: string) => {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    'SELECT name FROM sqlite_master WHERE type = ? AND name = ?',
    'table',
    tableName,
  );
  return rows.length > 0;
};

export const indexExists = async (indexName: string) => {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    'SELECT name FROM sqlite_master WHERE type = ? AND name = ?',
    'index',
    indexName,
  );
  return rows.length > 0;
};

export const triggerExists = async (triggerName: string) => {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    'SELECT name FROM sqlite_master WHERE type = ? AND name = ?',
    'trigger',
    triggerName,
  );
  return rows.length > 0;
};

const KNOWN_TABLES = new Set([
  'orders', 'order_items', 'customers', 'suppliers', 'payment_records', 'shipments', 'purchase_orders',
  'users',
  'purchase_receipts', 'shipment_receipts', 'receipt_discrepancy_cases',
  'receipt_discrepancy_actions', 'receipt_tolerance_rules',
  'barter_settlements', 'barter_items', 'barter_valuation_snapshots',
  'barter_offset_postings', 'barter_reversal_logs', 'contracts',
  'contract_milestones', 'product_batches', 'adjustment_records',
  'production_boms', 'production_bom_items', 'production_work_orders', 'production_quality_checks',
  'production_quality_characteristics', 'production_quality_measurements', 'batch_genealogy_edges',
  'inventory_cost_ledgers',
  'warehouses', 'locations', 'stock_balances', 'stock_entries', 'stock_movements',
  'auth_roles', 'auth_permissions', 'auth_role_permissions', 'auth_policy_migrations',
  'receivable_adjustments',
  'workflow_definitions', 'workflow_instances', 'workflow_tasks', 'workflow_actions',
  'notifications', 'business_events', 'alert_rules', 'bi_sales_daily',
  'materials', 'material_aliases',
]);

export const columnExists = async (tableName: string, columnName: string) => {
  if (!KNOWN_TABLES.has(tableName)) {
    throw new Error(`Schema repair rejected: unknown table '${tableName}'`);
  }
  const rows = await prisma.$queryRawUnsafe<TableInfoRow[]>(`PRAGMA table_info('${tableName}')`);
  return normalizeTableInfo(rows).some((row) => row.name === columnName);
};

export const createTableIfMissing = async (
  report: SchemaRepairReport,
  tableName: string,
  createSql: string,
) => {
  if (await tableExists(tableName)) {
    report.entries.push({ kind: 'table', target: tableName, action: 'exists' });
    return;
  }

  await prisma.$executeRawUnsafe(createSql);
  report.entries.push({ kind: 'table', target: tableName, action: 'created' });
};

export const addColumnIfMissing = async (
  report: SchemaRepairReport,
  tableName: string,
  columnName: string,
  definition: string,
) => {
  if (await columnExists(tableName, columnName)) {
    report.entries.push({ kind: 'column', target: `${tableName}.${columnName}`, action: 'exists' });
    return;
  }

  await prisma.$executeRawUnsafe(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${definition}`);
  report.entries.push({ kind: 'column', target: `${tableName}.${columnName}`, action: 'added' });
};

export const createIndexIfMissing = async (
  report: SchemaRepairReport,
  indexName: string,
  createSql: string,
) => {
  if (await indexExists(indexName)) {
    report.entries.push({ kind: 'index', target: indexName, action: 'exists' });
    return;
  }

  await prisma.$executeRawUnsafe(createSql);
  report.entries.push({ kind: 'index', target: indexName, action: 'created' });
};

const normalizeSchemaSql = (value: string) =>
  value.trim().replace(/;\s*$/, '').replace(/\s+/g, ' ').toLowerCase();

export const ensureTriggerDefinition = async (
  report: SchemaRepairReport,
  triggerName: string,
  createSql: string,
) => {
  if (!/^[a-z][a-z0-9_]{2,127}$/.test(triggerName)) {
    throw new Error(`Schema repair rejected unsafe trigger name '${triggerName}'`);
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ sql: string | null }>>(
    'SELECT sql FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1',
    'trigger',
    triggerName,
  );
  const currentSql = rows[0]?.sql || '';
  if (!currentSql) {
    await prisma.$executeRawUnsafe(createSql);
    report.entries.push({ kind: 'trigger', target: triggerName, action: 'created' });
    return;
  }
  if (normalizeSchemaSql(currentSql) === normalizeSchemaSql(createSql)) {
    report.entries.push({ kind: 'trigger', target: triggerName, action: 'exists' });
    return;
  }

  await prisma.$executeRawUnsafe(`DROP TRIGGER "${triggerName}"`);
  await prisma.$executeRawUnsafe(createSql);
  report.entries.push({ kind: 'trigger', target: triggerName, action: 'updated' });
};

export const dropIndexIfExists = async (
  report: SchemaRepairReport,
  indexName: string,
) => {
  if (!(await indexExists(indexName))) {
    report.entries.push({ kind: 'index', target: indexName, action: 'skipped' });
    return;
  }

  await prisma.$executeRawUnsafe(`DROP INDEX "${indexName}"`);
  report.entries.push({ kind: 'index', target: indexName, action: 'dropped' });
};
