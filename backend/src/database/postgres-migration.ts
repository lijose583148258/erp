import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Client } from 'pg';
import { assertImportedCountsMatch } from './postgres-import-verification';
import prisma from '../config/database';
import { BackupService } from '../services/backup.service';
import { getBackupDir, loadRuntimeEnv, runtime } from '../config/runtime';
import { formatBytes, getDatabaseInfo } from './db-utils';

type SnapshotTable = {
  name: string;
  rowCount: number;
  rows: Record<string, unknown>[];
};

type SnapshotReport = {
  snapshotFileName: string;
  snapshotPath: string;
  checksumSha256: string;
  tableCount: number;
  totalRowCount: number;
  tableSummary: Array<{ name: string; rowCount: number }>;
  criticalTables?: Array<{ name: string; present: boolean; rowCount: number | null }>;
};

type ManifestPhase = {
  phase: string;
  rationale: string;
  tableCount: number;
  rowCount: number;
  tables: Array<{ name: string; rowCount: number }>;
};

type ManifestReport = {
  snapshot: {
    fileName: string;
    path: string;
    checksumSha256: string;
    tableCount: number;
    totalRowCount: number;
  };
  criticalTables?: Array<{ name: string; present: boolean; rowCount: number | null }>;
  phases: ManifestPhase[];
  deferredTables?: Array<{ name: string; rowCount: number }>;
};

const CRITICAL_TABLE_NAMES = [
  'users',
  'customers',
  'orders',
  'order_items',
  'payment_records',
  'product_batches',
  'inventory_cost_ledgers',
  'stock_balances',
  'stock_entries',
  'stock_movements',
  'purchase_orders',
  'shipments',
];

const IMPORT_PHASES: Array<{ phase: string; tables: string[]; rationale: string }> = [
  {
    phase: 'foundation',
    tables: ['users', 'auth_permissions', 'auth_roles', 'auth_role_permissions', 'auth_policy_migrations'],
    rationale: 'Identity, permissions, and role graph should load first because many business tables reference users or permission-owned flows.',
  },
  {
    phase: 'master-data',
    tables: ['customers', 'suppliers', 'warehouses', 'locations', 'product_batches', 'contracts'],
    rationale: 'Customer, supplier, warehouse, location, batch, and contract records anchor downstream order, stock, and logistics data.',
  },
  {
    phase: 'commercial-transactions',
    tables: ['orders', 'order_items', 'payment_records', 'purchase_orders', 'purchase_receipts'],
    rationale: 'Sales and procurement transactions depend on master data and feed inventory, finance, and logistics timelines.',
  },
  {
    phase: 'inventory-ledger',
    tables: ['stock_balances', 'stock_entries', 'stock_movements', 'inventory_cost_ledgers'],
    rationale: 'Inventory and cost ledgers must load in a stable order so quantity and cost audit trails can be reconciled after import.',
  },
  {
    phase: 'operations',
    tables: ['shipments', 'shipment_receipts', 'receivable_adjustments', 'adjustment_records', 'production_work_orders'],
    rationale: 'Operational workflow records sit on top of commercial and inventory state and are smoked after foundational import completes.',
  },
];

const snapshotDir = () => path.join(getBackupDir(), 'postgres-migration');
const auditDir = () => path.join(process.cwd(), 'output', 'audit');

const ensureSnapshotDir = () => {
  const dir = snapshotDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const ensureAuditDir = () => {
  const dir = auditDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const timestampStamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const escapeIdentifier = (value: string) => value.replace(/"/g, '""');

const hashFile = (filePath: string) => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
};

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

const writeAuditReport = (baseName: string, report: Record<string, unknown>, mdLines: string[]) => {
  const outputDir = ensureAuditDir();
  const jsonPath = path.join(outputDir, `${baseName}.json`);
  const markdownPath = path.join(outputDir, `${baseName}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, `${mdLines.join('\n')}\n`, 'utf8');
  return { jsonPath, markdownPath };
};

const buildTableRowCountMap = (tableSummary: Array<{ name: string; rowCount: number }>) => new Map(
  tableSummary.map((table) => [table.name, table.rowCount]),
);

const readSnapshotReport = () => {
  const snapshotReportPath = path.join(auditDir(), 'postgres-migration-snapshot-v1.json');
  if (!fs.existsSync(snapshotReportPath)) {
    throw new Error('Snapshot report not found. Run "npm run db:pg -- snapshot" before continuing.');
  }
  return JSON.parse(fs.readFileSync(snapshotReportPath, 'utf8')) as SnapshotReport;
};

const readManifestReport = () => {
  const manifestReportPath = path.join(auditDir(), 'postgres-migration-import-manifest-v1.json');
  if (!fs.existsSync(manifestReportPath)) {
    throw new Error('Import manifest report not found. Run "npm run db:pg -- manifest" before continuing.');
  }
  return JSON.parse(fs.readFileSync(manifestReportPath, 'utf8')) as ManifestReport;
};

const readSnapshotPayload = (snapshotPath: string) => {
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot file does not exist: ${snapshotPath}`);
  }
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as {
    createdAt?: string;
    tables?: SnapshotTable[];
  };
};

const listSqliteTables = async () => {
  const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  );

  return tables
    .map(item => item.name)
    .filter(name => /^[A-Za-z0-9_]+$/.test(name));
};

const exportSnapshot = async () => {
  loadRuntimeEnv();
  const dbInfo = getDatabaseInfo();
  if (!dbInfo.sqliteDbPath) {
    throw new Error('Current database is not SQLite file mode, snapshot export is not available');
  }

  const tables = await listSqliteTables();
  const snapshotTables: SnapshotTable[] = [];

  for (const table of tables) {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "${escapeIdentifier(table)}"`
    );

    snapshotTables.push({
      name: table,
      rowCount: rows.length,
      rows,
    });
  }

  const payload = {
    createdAt: new Date().toISOString(),
    source: {
      nodeEnv: runtime.nodeEnv,
      sqliteDbPath: dbInfo.sqliteDbPath,
      databaseSize: dbInfo.databaseSize,
      databaseUpdatedAt: dbInfo.databaseUpdatedAt?.toISOString() || null,
    },
    tables: snapshotTables,
  };

  const outputDir = ensureSnapshotDir();
  const fileName = `postgres-snapshot-${timestampStamp()}.json`;
  const outputPath = path.join(outputDir, fileName);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  const totalRowCount = snapshotTables.reduce((sum, table) => sum + table.rowCount, 0);
  const checksumSha256 = hashFile(outputPath);
  const criticalTables = CRITICAL_TABLE_NAMES.map((name) => {
    const match = snapshotTables.find((table) => table.name === name);
    return {
      name,
      present: Boolean(match),
      rowCount: match ? match.rowCount : null,
    };
  });
  const report = {
    name: 'PostgreSQL Migration Snapshot',
    version: 1,
    generatedAt: new Date().toISOString(),
    snapshotFileName: fileName,
    snapshotPath: outputPath,
    checksumSha256,
    tableCount: snapshotTables.length,
    totalRowCount,
    source: payload.source,
    criticalTables,
    tableSummary: snapshotTables.map(table => ({
      name: table.name,
      rowCount: table.rowCount,
    })),
  };
  const reports = writeAuditReport(
    'postgres-migration-snapshot-v1',
    report,
    [
      '# PostgreSQL Migration Snapshot v1',
      '',
      `- generated: ${report.generatedAt}`,
      `- snapshot: ${fileName}`,
      `- path: ${outputPath}`,
      `- checksumSha256: ${checksumSha256}`,
      `- tables: ${snapshotTables.length}`,
      `- rows: ${totalRowCount}`,
      '',
      '## Critical Tables',
      ...criticalTables.map((table) => `- ${table.name}: ${table.present ? table.rowCount : 'missing'}`),
    ],
  );

  return {
    fileName,
    outputPath,
    tableCount: snapshotTables.length,
    totalRowCount,
    checksumSha256,
    reports,
  };
};

const printPlan = async () => {
  loadRuntimeEnv();
  const dbInfo = getDatabaseInfo();
  const backups = BackupService.getBackupList();
  const tableNames = await listSqliteTables();
  const recommendedSteps = [
    'Create one final SQLite backup',
    'Export a migration snapshot JSON',
    'Provision PostgreSQL and set POSTGRES_URL',
    'Run schema diff and data verification',
    'Cut over only after smoke tests pass',
    'If cutover fails, restore the SQLite backup and revert env vars',
  ];

  const report = {
    name: 'PostgreSQL Migration Plan',
    version: 1,
    generatedAt: new Date().toISOString(),
    databaseType: dbInfo.databaseType,
    sqlitePath: dbInfo.sqliteDbPath,
    databaseSizeBytes: dbInfo.databaseSize,
    databaseSizeLabel: formatBytes(dbInfo.databaseSize),
    databaseUpdatedAt: dbInfo.databaseUpdatedAt?.toISOString() || null,
    backupDir: getBackupDir(),
    backupCount: backups.length,
    latestBackup: backups[0]?.filename || null,
    currentTables: tableNames.length,
    targetEnvVar: 'POSTGRES_URL',
    recommendedSteps,
  };
  const reports = writeAuditReport(
    'postgres-migration-plan-v1',
    report,
    [
      '# PostgreSQL Migration Plan v1',
      '',
      `- generated: ${report.generatedAt}`,
      `- database type: ${dbInfo.databaseType}`,
      `- sqlite path: ${dbInfo.sqliteDbPath || 'not configured'}`,
      `- database size: ${formatBytes(dbInfo.databaseSize)}`,
      `- current tables: ${tableNames.length}`,
      `- backup dir: ${getBackupDir()}`,
      `- backup count: ${backups.length}`,
      `- target env: POSTGRES_URL`,
      '',
      '## Recommended Steps',
      ...recommendedSteps.map((step, index) => `${index + 1}. ${step}`),
    ],
  );

  console.log('');
  console.log('=== PostgreSQL Migration Plan ===');
  console.log(`Current Database: ${dbInfo.databaseType}`);
  console.log(`SQLite Path: ${dbInfo.sqliteDbPath || 'not configured'}`);
  console.log(`Current Tables: ${tableNames.length}`);
  console.log(`Backup Dir: ${getBackupDir()}`);
  console.log(`Backup Count: ${backups.length}`);
  console.log(`Suggested Target Env: POSTGRES_URL`);
  console.log(`Plan Report: ${reports.jsonPath}`);
  console.log('');
  console.log('=== Recommended Steps ===');
  recommendedSteps.forEach((step, index) => console.log(`${index + 1}. ${step}`));
  console.log('');

  return { report, reports };
};

const buildImportManifest = async () => {
  const snapshotReport = readSnapshotReport();

  const rowCounts = buildTableRowCountMap(snapshotReport.tableSummary || []);
  const coveredTables = new Set<string>();
  const phaseSummary = IMPORT_PHASES.map((phase) => {
    const tables = phase.tables
      .filter((tableName) => rowCounts.has(tableName))
      .map((tableName) => {
        coveredTables.add(tableName);
        return {
          name: tableName,
          rowCount: rowCounts.get(tableName) || 0,
        };
      });

    return {
      phase: phase.phase,
      rationale: phase.rationale,
      tableCount: tables.length,
      rowCount: tables.reduce((sum, table) => sum + table.rowCount, 0),
      tables,
    };
  }).filter((phase) => phase.tableCount > 0);

  const deferredTables = (snapshotReport.tableSummary || [])
    .filter((table) => !coveredTables.has(table.name))
    .map((table) => ({
      name: table.name,
      rowCount: table.rowCount,
    }));

  const manifest = {
    name: 'PostgreSQL Import Manifest',
    version: 1,
    generatedAt: new Date().toISOString(),
    snapshot: {
      fileName: snapshotReport.snapshotFileName,
      path: snapshotReport.snapshotPath,
      checksumSha256: snapshotReport.checksumSha256,
      tableCount: snapshotReport.tableCount,
      totalRowCount: snapshotReport.totalRowCount,
    },
    criticalTables: snapshotReport.criticalTables || [],
    phases: phaseSummary,
    deferredTables,
    nonClaims: [
      'This manifest defines import order and validation checkpoints.',
      'It does not execute a PostgreSQL import by itself.',
    ],
  };

  const reports = writeAuditReport(
    'postgres-migration-import-manifest-v1',
    manifest,
    [
      '# PostgreSQL Import Manifest v1',
      '',
      `- generated: ${manifest.generatedAt}`,
      `- snapshot: ${manifest.snapshot.fileName}`,
      `- checksumSha256: ${manifest.snapshot.checksumSha256}`,
      `- snapshot tables: ${manifest.snapshot.tableCount}`,
      `- snapshot rows: ${manifest.snapshot.totalRowCount}`,
      '',
      '## Import Phases',
      ...phaseSummary.flatMap((phase, index) => [
        `${index + 1}. ${phase.phase} (${phase.tableCount} tables, ${phase.rowCount} rows)`,
        `   rationale: ${phase.rationale}`,
        ...phase.tables.map((table) => `   - ${table.name}: ${table.rowCount}`),
      ]),
      '',
      `## Deferred Tables (${deferredTables.length})`,
      ...deferredTables.map((table) => `- ${table.name}: ${table.rowCount}`),
    ],
  );

  return { manifest, reports };
};

const runDryImportRehearsal = async () => {
  const manifest = readManifestReport();

  const snapshotPath = manifest.snapshot?.path;
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    throw new Error('Import manifest points to a missing snapshot file. Regenerate the snapshot and manifest before dry-run rehearsal.');
  }

  const snapshotChecksumSha256 = hashFile(snapshotPath);
  if (snapshotChecksumSha256 !== manifest.snapshot.checksumSha256) {
    throw new Error('Snapshot checksum does not match the import manifest. Regenerate the snapshot and manifest before dry-run rehearsal.');
  }

  const snapshotPayload = readSnapshotPayload(snapshotPath) as {
    createdAt?: string;
    tables?: Array<{ name: string; rowCount?: number; rows?: Array<Record<string, unknown>> }>;
  };
  const snapshotTables = Array.isArray(snapshotPayload.tables) ? snapshotPayload.tables : [];
  const snapshotRowCounts = new Map(
    snapshotTables.map((table) => [table.name, Number(table.rowCount ?? (Array.isArray(table.rows) ? table.rows.length : 0))]),
  );

  const seenTables = new Set<string>();
  const checks = {
    snapshotChecksumVerified: true,
    phaseCount: manifest.phases.length,
    allPhaseTablesPresentInSnapshot: true,
    allCriticalTablesPresent: true,
    duplicatePhaseTables: [] as string[],
    totalRowsAccountedFor: true,
  };

  const phaseExecutions = manifest.phases.map((phase, index) => {
    let phaseMissingTables = 0;
    let phaseDuplicateTables = 0;
    let validatedRowCount = 0;

    const tables = phase.tables.map((table) => {
      const expectedRowCount = Number(table.rowCount || 0);
      const actualRowCount = snapshotRowCounts.get(table.name);
      const presentInSnapshot = typeof actualRowCount === 'number';
      const duplicate = seenTables.has(table.name);

      if (!presentInSnapshot) {
        checks.allPhaseTablesPresentInSnapshot = false;
        phaseMissingTables += 1;
      } else {
        validatedRowCount += actualRowCount;
      }

      if (duplicate) {
        checks.duplicatePhaseTables.push(table.name);
        phaseDuplicateTables += 1;
      }

      seenTables.add(table.name);

      return {
        name: table.name,
        expectedRowCount,
        actualRowCount: presentInSnapshot ? actualRowCount : null,
        presentInSnapshot,
        rowCountMatchesSnapshot: presentInSnapshot ? actualRowCount === expectedRowCount : false,
        duplicatePhaseAssignment: duplicate,
      };
    });

    const expectedRowCount = tables.reduce((sum, table) => sum + table.expectedRowCount, 0);
    const rowCountMatchesManifest = validatedRowCount === expectedRowCount;
    if (!rowCountMatchesManifest) {
      checks.totalRowsAccountedFor = false;
    }

    return {
      phase: phase.phase,
      index: index + 1,
      rationale: phase.rationale,
      expectedTableCount: phase.tableCount,
      validatedTableCount: tables.filter((table) => table.presentInSnapshot).length,
      expectedRowCount,
      validatedRowCount,
      rowCountMatchesManifest,
      missingTableCount: phaseMissingTables,
      duplicateTableCount: phaseDuplicateTables,
      tables,
    };
  });

  const deferredTables = (manifest.deferredTables || []).map((table) => {
    const actualRowCount = snapshotRowCounts.get(table.name);
    const presentInSnapshot = typeof actualRowCount === 'number';
    return {
      name: table.name,
      expectedRowCount: Number(table.rowCount || 0),
      actualRowCount: presentInSnapshot ? actualRowCount : null,
      presentInSnapshot,
      rowCountMatchesSnapshot: presentInSnapshot ? actualRowCount === Number(table.rowCount || 0) : false,
    };
  });

  const criticalTableCoverage = CRITICAL_TABLE_NAMES.map((tableName) => {
    const manifestCritical = (manifest.criticalTables || []).find((table) => table.name === tableName);
    const phaseName = phaseExecutions.find((phase) => phase.tables.some((table) => table.name === tableName))?.phase || null;
    const actualRowCount = snapshotRowCounts.get(tableName);
    const presentInSnapshot = typeof actualRowCount === 'number';
    if (!manifestCritical?.present || !presentInSnapshot) {
      checks.allCriticalTablesPresent = false;
    }
    return {
      name: tableName,
      presentInManifest: Boolean(manifestCritical),
      presentInSnapshot,
      assignedPhase: phaseName,
      expectedRowCount: manifestCritical?.rowCount ?? null,
      actualRowCount: presentInSnapshot ? actualRowCount : null,
    };
  });

  const totalManifestRows =
    phaseExecutions.reduce((sum, phase) => sum + phase.expectedRowCount, 0) +
    deferredTables.reduce((sum, table) => sum + table.expectedRowCount, 0);
  const totalSnapshotRows = manifest.snapshot.totalRowCount;
  if (totalManifestRows !== totalSnapshotRows) {
    checks.totalRowsAccountedFor = false;
  }

  const duplicatePhaseTables = Array.from(new Set(checks.duplicatePhaseTables)).sort();
  const report = {
    name: 'PostgreSQL Dry-Run Import Rehearsal',
    version: 1,
    generatedAt: new Date().toISOString(),
    snapshot: {
      fileName: manifest.snapshot.fileName,
      path: snapshotPath,
      checksumSha256: manifest.snapshot.checksumSha256,
      checksumVerified: true,
      tableCount: manifest.snapshot.tableCount,
      totalRowCount: manifest.snapshot.totalRowCount,
    },
    phases: phaseExecutions,
    deferredTables,
    criticalTableCoverage,
    totals: {
      manifestRows: totalManifestRows,
      snapshotRows: totalSnapshotRows,
      rowTotalsMatch: totalManifestRows === totalSnapshotRows,
    },
    checks: {
      snapshotChecksumVerified: checks.snapshotChecksumVerified,
      phaseCount: checks.phaseCount,
      allPhaseTablesPresentInSnapshot: checks.allPhaseTablesPresentInSnapshot,
      allCriticalTablesPresent: checks.allCriticalTablesPresent,
      duplicatePhaseTables,
      totalRowsAccountedFor: checks.totalRowsAccountedFor,
    },
    nextActions: [
      'Provision the PostgreSQL rehearsal database and schema.',
      'Import tables in manifest phase order and capture row-count verification per phase.',
      'Run route-level smoke tests against the PostgreSQL server artifact in the same rehearsal window.',
      'Keep the final SQLite backup and rollback evidence alongside the import verification output.',
    ],
    nonClaims: [
      'This dry-run does not connect to PostgreSQL.',
      'This dry-run does not execute INSERT statements or prove route behavior.',
    ],
  };

  const reports = writeAuditReport(
    'postgres-migration-dry-run-v1',
    report,
    [
      '# PostgreSQL Dry-Run Import Rehearsal v1',
      '',
      `- generated: ${report.generatedAt}`,
      `- snapshot: ${report.snapshot.fileName}`,
      `- checksumSha256: ${report.snapshot.checksumSha256}`,
      `- checksum verified: ${report.snapshot.checksumVerified}`,
      `- phase count: ${report.checks.phaseCount}`,
      `- all phase tables present: ${report.checks.allPhaseTablesPresentInSnapshot}`,
      `- all critical tables present: ${report.checks.allCriticalTablesPresent}`,
      `- duplicate phase tables: ${duplicatePhaseTables.length ? duplicatePhaseTables.join(', ') : 'none'}`,
      `- row totals match: ${report.totals.rowTotalsMatch}`,
      '',
      '## Phase Execution Order',
      ...phaseExecutions.flatMap((phase) => [
        `${phase.index}. ${phase.phase} (${phase.validatedTableCount}/${phase.expectedTableCount} tables, ${phase.validatedRowCount}/${phase.expectedRowCount} rows)`,
        `   rationale: ${phase.rationale}`,
        ...phase.tables.map((table) => `   - ${table.name}: expected ${table.expectedRowCount}, snapshot ${table.actualRowCount ?? 'missing'}`),
      ]),
      '',
      `## Deferred Tables (${deferredTables.length})`,
      ...deferredTables.map((table) => `- ${table.name}: expected ${table.expectedRowCount}, snapshot ${table.actualRowCount ?? 'missing'}`),
      '',
      '## Critical Table Coverage',
      ...criticalTableCoverage.map((table) => `- ${table.name}: phase ${table.assignedPhase || 'unassigned'}, snapshot ${table.actualRowCount ?? 'missing'}`),
    ],
  );

  console.log('');
  console.log('=== PostgreSQL Dry-Run Import Rehearsal ===');
  console.log(`Snapshot File: ${report.snapshot.fileName}`);
  console.log(`Checksum Verified: ${report.snapshot.checksumVerified}`);
  console.log(`Phase Count: ${report.checks.phaseCount}`);
  console.log(`Row Totals Match: ${report.totals.rowTotalsMatch}`);
  console.log(`Dry-Run Report: ${reports.jsonPath}`);
  console.log('');

  return { report, reports };
};

const toPostgresConnectionString = () => {
  loadRuntimeEnv();
  const connection = process.env.POSTGRES_URL || (process.env.DATABASE_URL?.startsWith('postgres') ? process.env.DATABASE_URL : '');
  if (!connection) {
    throw new Error('POSTGRES_URL is required for PostgreSQL import rehearsal.');
  }
  if (!connection.startsWith('postgresql://') && !connection.startsWith('postgres://')) {
    throw new Error('POSTGRES_URL must be a PostgreSQL connection string.');
  }
  return connection;
};

const JSON_NORMALIZATION_FIELDS = [
  { table: 'customers', legacy: 'addresses_json', normalized: 'addresses_jsonb' },
  { table: 'customers', legacy: 'contacts_json', normalized: 'contacts_jsonb' },
  { table: 'suppliers', legacy: 'addresses_json', normalized: 'addresses_jsonb' },
  { table: 'suppliers', legacy: 'contacts_json', normalized: 'contacts_jsonb' },
  { table: 'collection_disputes', legacy: 'evidence_json', normalized: 'evidence_jsonb' },
  { table: 'receivable_adjustments', legacy: 'evidence_json', normalized: 'evidence_jsonb' },
] as const;

const normalizeJsonFieldsInPostgres = async () => {
  const client = new Client({ connectionString: toPostgresConnectionString() });
  const results: Array<{ table: string; legacy: string; normalized: string; rowCount: number; invalidJsonRows: number }> = [];
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE OR REPLACE FUNCTION ailaoda_try_jsonb(value text)
      RETURNS jsonb
      LANGUAGE plpgsql
      IMMUTABLE
      AS $$
      BEGIN
        RETURN value::jsonb;
      EXCEPTION WHEN others THEN
        RETURN NULL;
      END;
      $$;
    `);

    for (const field of JSON_NORMALIZATION_FIELDS) {
      const table = quoteIdentifier(field.table);
      const legacy = quoteIdentifier(field.legacy);
      const normalized = quoteIdentifier(field.normalized);
      const index = quoteIdentifier(`${field.table}_${field.normalized}_gin_idx`);

      await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${normalized} jsonb`);
      await client.query(`
        UPDATE ${table}
           SET ${normalized} = ailaoda_try_jsonb(${legacy})
         WHERE ${legacy} IS NOT NULL
           AND btrim(${legacy}) <> ''
           AND ${normalized} IS NULL
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS ${index} ON ${table} USING GIN (${normalized})`);

      const counts = await client.query<{ row_count: string; invalid_json_rows: string }>(`
        SELECT COUNT(*) FILTER (WHERE ${normalized} IS NOT NULL)::bigint AS row_count,
               COUNT(*) FILTER (
                 WHERE ${legacy} IS NOT NULL
                   AND btrim(${legacy}) <> ''
                   AND ${normalized} IS NULL
               )::bigint AS invalid_json_rows
          FROM ${table}
      `);
      results.push({
        ...field,
        rowCount: Number(counts.rows[0]?.row_count || 0),
        invalidJsonRows: Number(counts.rows[0]?.invalid_json_rows || 0),
      });
    }

    await client.query('COMMIT');
    const reports = writeAuditReport(
      'postgres-json-normalization-v1',
      {
        name: 'PostgreSQL JSON Normalization',
        version: '1.0',
        status: results.some((item) => item.invalidJsonRows > 0) ? 'warning' : 'passed',
        mode: 'shadow-jsonb-columns',
        fields: results,
        nonGoals: [
          'Does not remove legacy text columns.',
          'Does not switch application reads until module-level backfill verification passes.',
        ],
        generatedAt: new Date().toISOString(),
      },
      [
        '# PostgreSQL JSON Normalization v1',
        '',
        '- mode: shadow-jsonb-columns',
        `- status: ${results.some((item) => item.invalidJsonRows > 0) ? 'warning' : 'passed'}`,
        '',
        ...results.map((item) => `- ${item.table}.${item.legacy} -> ${item.normalized}: ${item.rowCount} normalized, ${item.invalidJsonRows} invalid`),
        '',
        '- Legacy text columns are retained until module-level read-back verification completes.',
      ],
    );
    console.log(`JSON normalization report: ${reports.jsonPath}`);
    console.log(`Normalized fields: ${results.length}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
};

const toOrderedImportTables = (manifest: ManifestReport, snapshotTables: SnapshotTable[]) => {
  const snapshotTableMap = new Map(snapshotTables.map((table) => [table.name, table]));
  const tablesFromPhases = manifest.phases.flatMap((phase) => phase.tables.map((table) => ({
    phase: phase.phase,
    deferred: false,
    table: snapshotTableMap.get(table.name) || {
      name: table.name,
      rowCount: table.rowCount,
      rows: [],
    },
  })));
  const tablesFromDeferred = (manifest.deferredTables || []).map((table) => ({
    phase: 'deferred',
    deferred: true,
    table: snapshotTableMap.get(table.name) || {
      name: table.name,
      rowCount: table.rowCount,
      rows: [],
    },
  }));
  return [...tablesFromPhases, ...tablesFromDeferred];
};

const listExistingTargetTables = async (client: Client) => {
  const rows = await client.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'`
  );
  return new Set(rows.rows.map((row) => row.table_name));
};

const verifyEmptyOrResetTarget = async (
  client: Client,
  orderedTables: Array<{ phase: string; deferred: boolean; table: SnapshotTable }>,
) => {
  const importMode = (process.env.POSTGRES_IMPORT_MODE || 'empty-only').toLowerCase();
  const tableNames = orderedTables.map((entry) => entry.table.name);
  const uniqueTableNames = Array.from(new Set(tableNames));
  const existingTargetTables = await listExistingTargetTables(client);
  const missingTables = uniqueTableNames.filter((tableName) => !existingTargetTables.has(tableName));
  if (missingTables.length) {
    throw new Error(`Target PostgreSQL schema is missing tables: ${missingTables.join(', ')}`);
  }

  const tableCounts: Array<{ name: string; rowCount: number }> = [];
  for (const tableName of uniqueTableNames) {
    const result = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(tableName)}`);
    tableCounts.push({
      name: tableName,
      rowCount: Number(result.rows[0]?.count || 0),
    });
  }

  const nonEmptyTables = tableCounts.filter((table) => table.rowCount > 0);
  if (nonEmptyTables.length === 0) {
    return {
      importMode,
      targetResetApplied: false,
      nonEmptyTables: [],
      tableCounts,
    };
  }

  if (importMode !== 'truncate') {
    throw new Error(
      `Target PostgreSQL schema is not empty (${nonEmptyTables.length} tables contain rows). Set POSTGRES_IMPORT_MODE=truncate for rehearsal reset.`,
    );
  }

  await client.query(`TRUNCATE TABLE ${uniqueTableNames.map((tableName) => quoteIdentifier(tableName)).join(', ')} RESTART IDENTITY CASCADE`);
  return {
    importMode,
    targetResetApplied: true,
    nonEmptyTables,
    tableCounts,
  };
};

const insertSnapshotRows = async (client: Client, table: SnapshotTable) => {
  if (!table.rows.length) {
    return 0;
  }

  const columns = Object.keys(table.rows[0] || {});
  if (!columns.length) {
    let inserted = 0;
    for (let index = 0; index < table.rows.length; index += 1) {
      await client.query(`INSERT INTO ${quoteIdentifier(table.name)} DEFAULT VALUES`);
      inserted += 1;
    }
    return inserted;
  }

  const maxParametersPerBatch = 5000;
  const batchSize = Math.max(1, Math.floor(maxParametersPerBatch / columns.length));
  let insertedRows = 0;

  for (let index = 0; index < table.rows.length; index += batchSize) {
    const chunk = table.rows.slice(index, index + batchSize);
    const values: unknown[] = [];
    const valueGroups = chunk.map((row, rowIndex) => {
      const placeholders = columns.map((column, columnIndex) => {
        values.push(Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null);
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    await client.query(
      `INSERT INTO ${quoteIdentifier(table.name)} (${columns.map(quoteIdentifier).join(', ')}) VALUES ${valueGroups.join(', ')}`,
      values,
    );
    insertedRows += chunk.length;
  }

  return insertedRows;
};

const syncPostgresSequences = async (client: Client, tableNames: string[]) => {
  const synced: Array<{ table: string; column: string; sequence: string; nextValue: number }> = [];
  for (const tableName of tableNames) {
    const result = await client.query<{ column_name: string; sequence_name: string | null }>(
      `SELECT
          c.column_name,
          pg_get_serial_sequence($1, c.column_name) AS sequence_name
       FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = $2`,
      [`public.${tableName}`, tableName],
    );

    for (const row of result.rows) {
      if (!row.sequence_name) continue;
      const maxValueResult = await client.query<{ value: string | null }>(
        `SELECT MAX(${quoteIdentifier(row.column_name)})::bigint::text AS value FROM ${quoteIdentifier(tableName)}`,
      );
      const maxValue = Number(maxValueResult.rows[0]?.value || 0);
      const sequenceValue = maxValue > 0 ? maxValue : 1;
      const sequenceWasCalled = maxValue > 0;
      await client.query('SELECT setval($1, $2, $3)', [row.sequence_name, sequenceValue, sequenceWasCalled]);
      synced.push({
        table: tableName,
        column: row.column_name,
        sequence: row.sequence_name,
        nextValue: sequenceWasCalled ? sequenceValue + 1 : sequenceValue,
      });
    }
  }
  return synced;
};

const verifyImportedCounts = async (client: Client, expectedCounts: Array<{ name: string; expectedRowCount: number }>) => {
  const results: Array<{ name: string; expectedRowCount: number; actualRowCount: number; matches: boolean }> = [];
  for (const expected of expectedCounts) {
    const countResult = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(expected.name)}`);
    const actualRowCount = Number(countResult.rows[0]?.count || 0);
    results.push({
      name: expected.name,
      expectedRowCount: expected.expectedRowCount,
      actualRowCount,
      matches: actualRowCount === expected.expectedRowCount,
    });
  }
  return results;
};

const importIntoPostgres = async () => {
  const manifest = readManifestReport();
  const snapshotPayload = readSnapshotPayload(manifest.snapshot.path);
  const snapshotTables = snapshotPayload.tables || [];
  const snapshotChecksumSha256 = hashFile(manifest.snapshot.path);
  if (snapshotChecksumSha256 !== manifest.snapshot.checksumSha256) {
    throw new Error('Snapshot checksum does not match the import manifest. Regenerate the snapshot and manifest before PostgreSQL import rehearsal.');
  }

  const orderedTables = toOrderedImportTables(manifest, snapshotTables);
  const connectionString = toPostgresConnectionString();
  const client = new Client({ connectionString });
  const startedAt = new Date();

  await client.connect();
  try {
    await client.query('BEGIN');
    const reset = await verifyEmptyOrResetTarget(client, orderedTables);
    await client.query(`SET LOCAL session_replication_role = 'replica'`);

    const importedTables: Array<{
      name: string;
      phase: string;
      deferred: boolean;
      expectedRowCount: number;
      insertedRowCount: number;
    }> = [];

    for (const entry of orderedTables) {
      const insertedRowCount = await insertSnapshotRows(client, entry.table);
      importedTables.push({
        name: entry.table.name,
        phase: entry.phase,
        deferred: entry.deferred,
        expectedRowCount: entry.table.rowCount,
        insertedRowCount,
      });
    }

    await client.query(`SET LOCAL session_replication_role = 'origin'`);
    const sequenceAdjustments = await syncPostgresSequences(client, importedTables.map((table) => table.name));
    const countVerification = await verifyImportedCounts(
      client,
      importedTables.map((table) => ({
        name: table.name,
        expectedRowCount: table.expectedRowCount,
      })),
    );
    assertImportedCountsMatch(countVerification);
    await client.query('COMMIT');

    const report = {
      name: 'PostgreSQL Import Rehearsal',
      version: 1,
      generatedAt: new Date().toISOString(),
      startedAt: startedAt.toISOString(),
      snapshot: {
        fileName: manifest.snapshot.fileName,
        path: manifest.snapshot.path,
        checksumSha256: manifest.snapshot.checksumSha256,
        checksumVerified: true,
      },
      target: {
        connectionEnv: process.env.POSTGRES_URL ? 'POSTGRES_URL' : 'DATABASE_URL',
        importMode: reset.importMode,
        targetResetApplied: reset.targetResetApplied,
        nonEmptyTablesBeforeReset: reset.nonEmptyTables,
      },
      importedTables,
      verification: countVerification,
      sequenceAdjustments,
      summary: {
        importedTableCount: importedTables.length,
        importedRowCount: importedTables.reduce((sum, table) => sum + table.insertedRowCount, 0),
        verificationPassed: countVerification.every((table) => table.matches),
      },
      nonClaims: [
        'This report does not prove route-level write behavior.',
        'This report does not replace same-window smoke tests, backup/restore verification, or rollback evidence.',
      ],
    };

    const reports = writeAuditReport(
      'postgres-migration-import-v1',
      report,
      [
        '# PostgreSQL Import Rehearsal v1',
        '',
        `- generated: ${report.generatedAt}`,
        `- snapshot: ${report.snapshot.fileName}`,
        `- checksum verified: ${report.snapshot.checksumVerified}`,
        `- import mode: ${report.target.importMode}`,
        `- target reset applied: ${report.target.targetResetApplied}`,
        `- imported tables: ${report.summary.importedTableCount}`,
        `- imported rows: ${report.summary.importedRowCount}`,
        `- count verification passed: ${report.summary.verificationPassed}`,
        '',
        '## Imported Tables',
        ...report.importedTables.map((table) => `- ${table.phase}/${table.name}: inserted ${table.insertedRowCount}, expected ${table.expectedRowCount}`),
        '',
        '## Count Verification',
        ...report.verification.map((table) => `- ${table.name}: actual ${table.actualRowCount}, expected ${table.expectedRowCount}, matches ${table.matches}`),
      ],
    );

    console.log('');
    console.log('=== PostgreSQL Import Rehearsal ===');
    console.log(`Imported Tables: ${report.summary.importedTableCount}`);
    console.log(`Imported Rows: ${report.summary.importedRowCount}`);
    console.log(`Verification Passed: ${report.summary.verificationPassed}`);
    console.log(`Import Report: ${reports.jsonPath}`);
    console.log('');

    return { report, reports };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
};

const rollbackToBackup = async (fileName?: string) => {
  loadRuntimeEnv();
  const backups = BackupService.getBackupList();
  const target = fileName || backups[0]?.filename;

  if (!target) {
    throw new Error('No backup file available for rollback');
  }

  const result = await BackupService.restoreBackup(target);
  const report = {
    name: 'PostgreSQL Migration Rollback',
    version: 1,
    generatedAt: new Date().toISOString(),
    restoredBackupFileName: target,
    keepSqliteDatabaseUrl: true,
    integrity: result.integrity,
  };
  const reports = writeAuditReport(
    'postgres-migration-rollback-v1',
    report,
    [
      '# PostgreSQL Migration Rollback v1',
      '',
      `- generated: ${report.generatedAt}`,
      `- restored backup: ${target}`,
      `- manifest verified: ${result.integrity.verified}`,
      `- manifest exists: ${result.integrity.manifestExists}`,
      '- suggestion: keep DATABASE_URL on SQLite until the new cutover is validated',
    ],
  );

  console.log('');
  console.log('=== PostgreSQL Migration Rollback ===');
  console.log(`Restored backup: ${target}`);
  console.log('Rollback suggestion: keep DATABASE_URL on SQLite until the new cutover is validated');
  console.log(`Rollback Report: ${reports.jsonPath}`);
  console.log('');

  return { result, report, reports };
};

const run = async () => {
  const command = (process.argv[2] || 'plan').toLowerCase();
  const target = process.argv[3];

  switch (command) {
    case 'plan':
      await printPlan();
      return;
    case 'snapshot': {
      const result = await exportSnapshot();
      console.log('');
      console.log('=== PostgreSQL Migration Snapshot ===');
      console.log(`Snapshot File: ${result.fileName}`);
      console.log(`Snapshot Path: ${result.outputPath}`);
      console.log(`Table Count: ${result.tableCount}`);
      console.log(`Total Rows: ${result.totalRowCount}`);
      console.log(`Checksum: ${result.checksumSha256}`);
      console.log(`Snapshot Report: ${result.reports.jsonPath}`);
      console.log('');
      return;
    }
    case 'manifest': {
      const result = await buildImportManifest();
      console.log('');
      console.log('=== PostgreSQL Import Manifest ===');
      console.log(`Snapshot File: ${result.manifest.snapshot.fileName}`);
      console.log(`Snapshot Tables: ${result.manifest.snapshot.tableCount}`);
      console.log(`Snapshot Rows: ${result.manifest.snapshot.totalRowCount}`);
      console.log(`Phase Count: ${result.manifest.phases.length}`);
      console.log(`Manifest Report: ${result.reports.jsonPath}`);
      console.log('');
      return;
    }
    case 'dry-run-import':
      await runDryImportRehearsal();
      return;
    case 'import':
      await importIntoPostgres();
      return;
    case 'normalize-json':
      await normalizeJsonFieldsInPostgres();
      return;
    case 'rollback':
      await rollbackToBackup(target);
      return;
    default:
      console.log('');
      console.log('=== PostgreSQL Migration Commands ===');
      console.log('npm run db:pg -- plan');
      console.log('npm run db:pg -- snapshot');
      console.log('npm run db:pg -- manifest');
      console.log('npm run db:pg -- dry-run-import');
      console.log('POSTGRES_URL=postgresql://... npm run db:pg -- import');
      console.log('POSTGRES_URL=postgresql://... npm run db:pg -- normalize-json');
      console.log('npm run db:pg -- rollback <backup-file.db>');
      console.log('');
      return;
  }
};

run().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
