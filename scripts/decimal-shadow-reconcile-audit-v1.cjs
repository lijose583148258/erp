const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CONTRACT_PATH = path.join(ROOT, 'backend', 'src', 'database', 'decimal-shadow-v1.json');
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const AUDIT_LABEL = String(process.env.DECIMAL_SHADOW_AUDIT_LABEL || '').trim().toLowerCase();
if (AUDIT_LABEL && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(AUDIT_LABEL)) {
  throw new Error(`invalid DECIMAL_SHADOW_AUDIT_LABEL: ${AUDIT_LABEL}`);
}
const REPORT_BASENAME = `decimal-shadow-reconcile-v1${AUDIT_LABEL ? `-${AUDIT_LABEL}` : ''}`;
const REPORT_PATH = path.join(ROOT, 'output', 'audit', `${REPORT_BASENAME}.json`);
const MARKDOWN_PATH = path.join(ROOT, 'output', 'audit', `${REPORT_BASENAME}.md`);

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const quoteIdentifier = (value) => {
  if (!IDENTIFIER.test(value)) throw new Error(`unsafe decimal-shadow identifier: ${value}`);
  return `"${value}"`;
};
const normalizeRow = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [
  key,
  typeof value === 'bigint' ? Number(value) : value,
]));

function resolveProvider() {
  const url = String(
    process.env.AUDIT_DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.DATABASE_URL
    || '',
  ).trim();
  return /^postgres(?:ql)?:\/\//i.test(url) ? { provider: 'postgresql', url } : { provider: 'sqlite', url };
}

async function auditSqlite() {
  const prisma = require('../backend/dist/config/database').default;
  const tables = [];
  try {
    for (const table of contract.tables) {
      const tableName = quoteIdentifier(table.table);
      const columns = (await prisma.$queryRawUnsafe(`PRAGMA table_info(${tableName})`)).map(normalizeRow);
      const columnMap = new Map(columns.map(column => [String(column.name), column]));
      const triggers = await prisma.$queryRawUnsafe(
        'SELECT name FROM sqlite_master WHERE type = ? AND name IN (?, ?)',
        'trigger',
        table.insertTrigger,
        table.updateTrigger,
      );
      const triggerNames = new Set(triggers.map(row => row.name));
      const fields = [];

      for (const field of table.fields) {
        const legacy = quoteIdentifier(field.legacyColumn);
        const shadow = quoteIdentifier(field.shadowColumn);
        const format = `%.${field.scale}f`;
        const rows = await prisma.$queryRawUnsafe(`
          SELECT
            COUNT(*) AS totalRows,
            SUM(CASE WHEN ${shadow} IS NULL THEN 1 ELSE 0 END) AS nullShadowRows,
            SUM(CASE WHEN printf('${format}', ${shadow}) <> printf('${format}', ${legacy}) THEN 1 ELSE 0 END) AS mismatchRows,
            printf('${format}', COALESCE(SUM(ROUND(${legacy}, ${field.scale})), 0)) AS legacyRoundedSum,
            printf('${format}', COALESCE(SUM(${shadow}), 0)) AS shadowSum
          FROM ${tableName}
        `);
        const metrics = normalizeRow(rows[0] || {});
        const column = columnMap.get(field.shadowColumn);
        fields.push({
          ...field,
          columnPresent: Boolean(column),
          declaredType: column ? String(column.type || '') : null,
          totalRows: Number(metrics.totalRows || 0),
          nullShadowRows: Number(metrics.nullShadowRows || 0),
          mismatchRows: Number(metrics.mismatchRows || 0),
          legacyRoundedSum: String(metrics.legacyRoundedSum || ''),
          shadowSum: String(metrics.shadowSum || ''),
          passed: Boolean(column)
            && Number(metrics.nullShadowRows || 0) === 0
            && Number(metrics.mismatchRows || 0) === 0
            && String(metrics.legacyRoundedSum || '') === String(metrics.shadowSum || ''),
        });
      }

      tables.push({
        table: table.table,
        triggers: {
          insert: triggerNames.has(table.insertTrigger),
          update: triggerNames.has(table.updateTrigger),
        },
        fields,
        passed: triggerNames.has(table.insertTrigger)
          && triggerNames.has(table.updateTrigger)
          && fields.every(field => field.passed),
      });
    }
  } finally {
    await prisma.$disconnect();
  }
  return tables;
}

async function auditPostgres(url) {
  if (!url) throw new Error('PostgreSQL decimal-shadow audit requires AUDIT_DATABASE_URL, POSTGRES_URL, or DATABASE_URL.');
  const { Client } = require('../backend/node_modules/pg');
  const client = new Client({ connectionString: url, application_name: 'ailaoda-decimal-shadow-audit' });
  const tables = [];
  await client.connect();
  try {
    await client.query("SET statement_timeout = '60s'");
    for (const table of contract.tables) {
      const tableName = quoteIdentifier(table.table);
      const columnRows = await client.query(
        `SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
        [table.table],
      );
      const columnMap = new Map(columnRows.rows.map(column => [column.column_name, column]));
      const triggerRows = await client.query(
        `SELECT tgname
           FROM pg_trigger
          WHERE tgrelid = $1::regclass
            AND NOT tgisinternal`,
        [`public.${table.table}`],
      );
      const triggerNames = new Set(triggerRows.rows.map(row => row.tgname));
      const fields = [];

      for (const field of table.fields) {
        const legacy = quoteIdentifier(field.legacyColumn);
        const shadow = quoteIdentifier(field.shadowColumn);
        const result = await client.query(`
          SELECT
            COUNT(*)::bigint::text AS "totalRows",
            COUNT(*) FILTER (WHERE ${shadow} IS NULL)::bigint::text AS "nullShadowRows",
            COUNT(*) FILTER (WHERE ${shadow} IS DISTINCT FROM ROUND(${legacy}::numeric, ${field.scale}))::bigint::text AS "mismatchRows",
            COALESCE(SUM(ROUND(${legacy}::numeric, ${field.scale})), 0)::text AS "legacyRoundedSum",
            COALESCE(SUM(${shadow}), 0)::text AS "shadowSum"
          FROM ${tableName}
        `);
        const metrics = result.rows[0] || {};
        const column = columnMap.get(field.shadowColumn);
        const typeMatches = Boolean(column)
          && column.data_type === 'numeric'
          && Number(column.numeric_precision) === field.precision
          && Number(column.numeric_scale) === field.scale
          && column.is_nullable === 'NO';
        fields.push({
          ...field,
          columnPresent: Boolean(column),
          declaredType: column?.data_type || null,
          numericPrecision: column ? Number(column.numeric_precision) : null,
          numericScale: column ? Number(column.numeric_scale) : null,
          nullable: column?.is_nullable || null,
          totalRows: Number(metrics.totalRows || 0),
          nullShadowRows: Number(metrics.nullShadowRows || 0),
          mismatchRows: Number(metrics.mismatchRows || 0),
          legacyRoundedSum: String(metrics.legacyRoundedSum || ''),
          shadowSum: String(metrics.shadowSum || ''),
          passed: typeMatches
            && Number(metrics.nullShadowRows || 0) === 0
            && Number(metrics.mismatchRows || 0) === 0
            && String(metrics.legacyRoundedSum || '') === String(metrics.shadowSum || ''),
        });
      }

      tables.push({
        table: table.table,
        triggers: { write: triggerNames.has(table.postgresTrigger) },
        fields,
        passed: triggerNames.has(table.postgresTrigger) && fields.every(field => field.passed),
      });
    }
  } finally {
    await client.end();
  }
  return tables;
}

async function main() {
  const startedAt = new Date();
  const providerState = resolveProvider();
  const report = {
    name: 'Decimal Shadow Reconciliation',
    version: 1,
    contractVersion: contract.version,
    evidenceLabel: AUDIT_LABEL || null,
    phase: 'expand-backfill-dual-write',
    provider: providerState.provider,
    startedAt: startedAt.toISOString(),
    status: 'running',
    tables: [],
    nonClaims: [
      'Legacy Float columns remain the application read contract.',
      'This evidence does not authorize dropping legacy columns.',
      'PostgreSQL evidence is required separately before production read cutover.',
    ],
  };

  try {
    report.tables = providerState.provider === 'postgresql'
      ? await auditPostgres(providerState.url)
      : await auditSqlite();
    report.status = report.tables.every(table => table.passed) ? 'passed' : 'failed';
    report.summary = {
      tableCount: report.tables.length,
      fieldCount: report.tables.reduce((sum, table) => sum + table.fields.length, 0),
      totalRowsChecked: report.tables.reduce(
        (sum, table) => sum + Math.max(0, ...table.fields.map(field => field.totalRows)),
        0,
      ),
      nullShadowRows: report.tables.reduce(
        (sum, table) => sum + table.fields.reduce((fieldSum, field) => fieldSum + field.nullShadowRows, 0),
        0,
      ),
      mismatchRows: report.tables.reduce(
        (sum, table) => sum + table.fields.reduce((fieldSum, field) => fieldSum + field.mismatchRows, 0),
        0,
      ),
    };
  } catch (error) {
    report.status = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
  }

  report.finishedAt = new Date().toISOString();
  report.elapsedMs = Date.now() - startedAt.getTime();
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const lines = [
    '# Decimal Shadow Reconciliation v1',
    '',
    `- status: ${report.status}`,
    `- provider: ${report.provider}`,
    `- phase: ${report.phase}`,
    `- contract: ${report.contractVersion}`,
    `- summary: ${JSON.stringify(report.summary || {})}`,
    '',
    ...report.tables.flatMap(table => [
      `## ${table.table}`,
      `- passed: ${table.passed}`,
      `- triggers: ${JSON.stringify(table.triggers)}`,
      ...table.fields.map(field => `- ${field.legacyColumn} -> ${field.shadowColumn}: rows=${field.totalRows}, null=${field.nullShadowRows}, mismatch=${field.mismatchRows}, sum=${field.legacyRoundedSum}/${field.shadowSum}, passed=${field.passed}`),
      '',
    ]),
    '## Non-claims',
    ...report.nonClaims.map(item => `- ${item}`),
  ];
  fs.writeFileSync(MARKDOWN_PATH, `${lines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({
    status: report.status,
    provider: report.provider,
    summary: report.summary || null,
    reportPath: REPORT_PATH,
  }, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}

main();
