const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CONTRACT_PATH = path.join(ROOT, 'backend', 'src', 'database', 'decimal-shadow-v1.json');
const REPORT_PATH = path.join(ROOT, 'output', 'audit', 'decimal-shadow-write-path-v1.json');
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const ROLLBACK_SENTINEL = new Error('DECIMAL_SHADOW_AUDIT_ROLLBACK');
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));

const quoteIdentifier = (value) => {
  if (!IDENTIFIER.test(value)) throw new Error(`unsafe decimal-shadow identifier: ${value}`);
  return `"${value}"`;
};
const normalizeRow = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [
  key,
  typeof value === 'bigint' ? Number(value) : value,
]));

const uniqueCloneExpression = (tableName, columnName, runId) => {
  if (tableName === 'orders' && columnName === 'order_no') {
    return `"order_no" || '-DEC-${runId}'`;
  }
  if (tableName === 'orders' && ['import_batch_id', 'import_row_number'].includes(columnName)) {
    return 'NULL';
  }
  if (tableName === 'receivable_adjustments' && columnName === 'adjustment_no') {
    return `"adjustment_no" || '-DEC-${runId}'`;
  }
  return quoteIdentifier(columnName);
};

async function readFieldState(tx, table, id) {
  const projections = table.fields.flatMap(field => {
    const format = `%.${field.scale}f`;
    return [
      `printf('${format}', ${quoteIdentifier(field.legacyColumn)}) AS ${quoteIdentifier(`${field.legacyColumn}_legacy`)}`,
      `printf('${format}', ${quoteIdentifier(field.shadowColumn)}) AS ${quoteIdentifier(`${field.shadowColumn}_shadow`)}`,
    ];
  });
  const rows = await tx.$queryRawUnsafe(
    `SELECT ${projections.join(', ')} FROM ${quoteIdentifier(table.table)} WHERE "id" = ?`,
    id,
  );
  return normalizeRow(rows[0] || {});
}

function compareFieldState(table, state) {
  return table.fields.map(field => {
    const legacyValue = String(state[`${field.legacyColumn}_legacy`] || '');
    const shadowValue = String(state[`${field.shadowColumn}_shadow`] || '');
    return {
      legacyColumn: field.legacyColumn,
      shadowColumn: field.shadowColumn,
      scale: field.scale,
      legacyValue,
      shadowValue,
      passed: legacyValue === shadowValue,
    };
  });
}

async function runTableProbe(tx, table, runId) {
  const sourceRows = await tx.$queryRawUnsafe(
    `SELECT "id" FROM ${quoteIdentifier(table.table)} ORDER BY "id" LIMIT 1`,
  );
  const sourceId = Number(sourceRows[0]?.id || 0);
  if (!sourceId) {
    return {
      table: table.table,
      sourceRowPresent: false,
      updateProbe: null,
      insertProbe: null,
      passed: false,
      error: 'no source row is available for transactional write-path proof',
    };
  }

  await tx.$executeRawUnsafe(
    `UPDATE ${quoteIdentifier(table.table)}
        SET ${table.fields.map(field => `${quoteIdentifier(field.shadowColumn)} = NULL`).join(', ')}
      WHERE "id" = ?`,
    sourceId,
  );
  await tx.$executeRawUnsafe(
    `UPDATE ${quoteIdentifier(table.table)}
        SET ${table.fields.map(field => `${quoteIdentifier(field.legacyColumn)} = ${quoteIdentifier(field.legacyColumn)}`).join(', ')}
      WHERE "id" = ?`,
    sourceId,
  );
  const updateFields = compareFieldState(table, await readFieldState(tx, table, sourceId));

  const columns = (await tx.$queryRawUnsafe(`PRAGMA table_info(${quoteIdentifier(table.table)})`))
    .map(normalizeRow)
    .map(column => String(column.name))
    .filter(column => column !== 'id' && !table.fields.some(field => field.shadowColumn === column));
  const expressions = columns.map(column => uniqueCloneExpression(table.table, column, runId));
  const insertedRows = await tx.$queryRawUnsafe(
    `INSERT INTO ${quoteIdentifier(table.table)} (${columns.map(quoteIdentifier).join(', ')})
     SELECT ${expressions.join(', ')}
       FROM ${quoteIdentifier(table.table)}
      WHERE "id" = ?
     RETURNING "id"`,
    sourceId,
  );
  const insertedId = Number(insertedRows[0]?.id || 0);
  const insertFields = compareFieldState(table, await readFieldState(tx, table, insertedId));

  return {
    table: table.table,
    sourceRowPresent: true,
    sourceId,
    updateProbe: {
      corruptedShadowThenLegacyWrite: true,
      fields: updateFields,
      passed: updateFields.every(field => field.passed),
    },
    insertProbe: {
      shadowColumnsOmittedFromInsert: true,
      insertedId,
      fields: insertFields,
      passed: insertFields.every(field => field.passed),
    },
    passed: updateFields.every(field => field.passed) && insertFields.every(field => field.passed),
  };
}

async function main() {
  const startedAt = new Date();
  const report = {
    name: 'Decimal Shadow Transactional Write Path',
    version: 1,
    contractVersion: contract.version,
    provider: 'sqlite',
    mode: 'forced-rollback',
    startedAt: startedAt.toISOString(),
    status: 'running',
    tables: [],
  };
  let prisma;

  try {
    const databaseUrl = String(process.env.DATABASE_URL || '');
    if (/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
      throw new Error('This transactional trigger probe currently targets the SQLite rollback runtime only.');
    }
    prisma = require('../backend/dist/config/database').default;
    const runId = Date.now().toString(36);
    try {
      await prisma.$transaction(async (tx) => {
        for (const table of contract.tables) {
          report.tables.push(await runTableProbe(tx, table, runId));
        }
        throw ROLLBACK_SENTINEL;
      }, { maxWait: 10_000, timeout: 30_000 });
    } catch (error) {
      if (error !== ROLLBACK_SENTINEL) throw error;
    }

    report.status = report.tables.every(table => table.passed) ? 'passed' : 'failed';
    report.summary = {
      tableCount: report.tables.length,
      updateProbePassed: report.tables.filter(table => table.updateProbe?.passed).length,
      insertProbePassed: report.tables.filter(table => table.insertProbe?.passed).length,
      persistedAuditRows: 0,
    };
  } catch (error) {
    report.status = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (prisma) await prisma.$disconnect();
  }

  report.finishedAt = new Date().toISOString();
  report.elapsedMs = Date.now() - startedAt.getTime();
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    status: report.status,
    mode: report.mode,
    summary: report.summary || null,
    reportPath: REPORT_PATH,
  }, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}

main();
