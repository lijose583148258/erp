export type BaseSchemaBootstrapResult = {
  action: 'existing' | 'created';
  tableCount: number;
};

type BaseSchemaBootstrapDependencies = {
  databaseEngine: string;
  listTableNames: () => Promise<string[]>;
  applyDeclarativeSchema: () => Promise<void>;
};

const REQUIRED_BASE_TABLES = ['users', 'customers', 'orders'] as const;

const normalizeTableNames = (tableNames: string[]) => Array.from(new Set(
  tableNames
    .map(name => String(name || '').trim())
    .filter(name => name && !name.startsWith('sqlite_') && name !== '_prisma_migrations'),
)).sort();

const missingBaseTables = (tableNames: string[]) => {
  const available = new Set(tableNames);
  return REQUIRED_BASE_TABLES.filter(tableName => !available.has(tableName));
};

/**
 * Creates the Prisma-owned base schema only for a provably empty SQLite database.
 * Existing databases stay on the additive repair path; partial databases fail
 * closed so an operator can restore or inspect them without an implicit rewrite.
 */
export const ensureBaseSchema = async (
  dependencies: BaseSchemaBootstrapDependencies,
): Promise<BaseSchemaBootstrapResult> => {
  if (dependencies.databaseEngine !== 'sqlite') {
    throw new Error('Database prepare currently supports the SQLite runtime only. Use the PostgreSQL migration runbook for PostgreSQL.');
  }

  const before = normalizeTableNames(await dependencies.listTableNames());
  const missingBefore = missingBaseTables(before);
  if (missingBefore.length === 0) {
    return { action: 'existing', tableCount: before.length };
  }

  if (before.length > 0) {
    throw new Error(
      `Database has a partial base schema; missing ${missingBefore.join(', ')}. Restore a verified backup or inspect the database before retrying.`,
    );
  }

  await dependencies.applyDeclarativeSchema();

  const after = normalizeTableNames(await dependencies.listTableNames());
  const missingAfter = missingBaseTables(after);
  if (missingAfter.length > 0) {
    throw new Error(`Prisma base schema creation did not produce required tables: ${missingAfter.join(', ')}`);
  }

  return { action: 'created', tableCount: after.length };
};

