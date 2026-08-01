import prisma from '../config/database';
import decimalShadowContract from './decimal-shadow-v1.json';
import {
  addColumnIfMissing,
  ensureTriggerDefinition,
  triggerExists,
  type SchemaRepairReport,
} from './runtime-schema-repair-utils';

type DecimalShadowField = {
  legacyColumn: string;
  shadowColumn: string;
  precision: number;
  scale: number;
  kind: 'money' | 'exchange_rate';
};

type DecimalShadowTable = {
  table: string;
  insertTrigger: string;
  updateTrigger: string;
  fields: DecimalShadowField[];
};

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

const shadowAssignment = (field: DecimalShadowField, prefix = '') =>
  `${quoteIdentifier(field.shadowColumn)} = ROUND(${prefix}${quoteIdentifier(field.legacyColumn)}, ${field.scale})`;

const mismatchPredicate = (field: DecimalShadowField) => {
  const format = `%.${field.scale}f`;
  return `${quoteIdentifier(field.shadowColumn)} IS NULL OR printf('${format}', ${quoteIdentifier(field.shadowColumn)}) <> printf('${format}', ${quoteIdentifier(field.legacyColumn)})`;
};

const createInsertTriggerSql = (table: DecimalShadowTable) => `
  CREATE TRIGGER ${quoteIdentifier(table.insertTrigger)}
  AFTER INSERT ON ${quoteIdentifier(table.table)}
  BEGIN
    UPDATE ${quoteIdentifier(table.table)}
       SET ${table.fields.map(field => shadowAssignment(field, 'NEW.')).join(', ')}
     WHERE "id" = NEW."id";
  END
`;

const createUpdateTriggerSql = (table: DecimalShadowTable) => `
  CREATE TRIGGER ${quoteIdentifier(table.updateTrigger)}
  AFTER UPDATE OF ${table.fields.map(field => quoteIdentifier(field.legacyColumn)).join(', ')}
  ON ${quoteIdentifier(table.table)}
  BEGIN
    UPDATE ${quoteIdentifier(table.table)}
       SET ${table.fields.map(field => shadowAssignment(field, 'NEW.')).join(', ')}
     WHERE "id" = NEW."id";
  END
`;

const normalizeCount = (value: unknown) => typeof value === 'bigint' ? Number(value) : Number(value || 0);

const verifyDecimalShadowState = async (tables: DecimalShadowTable[]) => {
  const failures: string[] = [];

  for (const table of tables) {
    const columns = await prisma.$queryRawUnsafe<Array<{ name: unknown; type: unknown }>>(
      `PRAGMA table_info(${quoteIdentifier(table.table)})`,
    );
    const columnTypes = new Map(columns.map(column => [
      String(column.name),
      String(column.type || '').toUpperCase().replace(/\s+/g, ''),
    ]));

    for (const field of table.fields) {
      const expectedType = `NUMERIC(${field.precision},${field.scale})`;
      if (columnTypes.get(field.shadowColumn) !== expectedType) {
        failures.push(`${table.table}.${field.shadowColumn}:type=${columnTypes.get(field.shadowColumn) || 'missing'}`);
        continue;
      }

      const format = `%.${field.scale}f`;
      const rows = await prisma.$queryRawUnsafe<Array<{ mismatch_count: unknown }>>(`
        SELECT COUNT(*) AS mismatch_count
          FROM ${quoteIdentifier(table.table)}
         WHERE ${quoteIdentifier(field.shadowColumn)} IS NULL
            OR printf('${format}', ${quoteIdentifier(field.shadowColumn)})
             <> printf('${format}', ${quoteIdentifier(field.legacyColumn)})
      `);
      const mismatchCount = normalizeCount(rows[0]?.mismatch_count);
      if (mismatchCount > 0) {
        failures.push(`${table.table}.${field.shadowColumn}:mismatch=${mismatchCount}`);
      }
    }

    if (!(await triggerExists(table.insertTrigger))) failures.push(`${table.insertTrigger}:missing`);
    if (!(await triggerExists(table.updateTrigger))) failures.push(`${table.updateTrigger}:missing`);
  }

  if (failures.length) {
    throw new Error(`Decimal shadow repair verification failed: ${failures.slice(0, 12).join(', ')}`);
  }
};

export const repairDecimalShadowSchema = async (report: SchemaRepairReport) => {
  const tables = decimalShadowContract.tables as DecimalShadowTable[];

  for (const table of tables) {
    for (const field of table.fields) {
      await addColumnIfMissing(
        report,
        table.table,
        field.shadowColumn,
        `NUMERIC(${field.precision}, ${field.scale})`,
      );
    }

    const updatedRows = await prisma.$executeRawUnsafe(`
      UPDATE ${quoteIdentifier(table.table)}
         SET ${table.fields.map(field => shadowAssignment(field)).join(', ')}
       WHERE ${table.fields.map(mismatchPredicate).join(' OR ')}
    `);
    report.entries.push({
      kind: 'seed',
      target: `${table.table}.decimal-shadow-backfill`,
      action: updatedRows > 0 ? 'updated' : 'exists',
    });

    await ensureTriggerDefinition(report, table.insertTrigger, createInsertTriggerSql(table));
    await ensureTriggerDefinition(report, table.updateTrigger, createUpdateTriggerSql(table));
  }

  await verifyDecimalShadowState(tables);
  report.entries.push({
    kind: 'seed',
    target: `${decimalShadowContract.version}.verification`,
    action: 'exists',
  });
};
