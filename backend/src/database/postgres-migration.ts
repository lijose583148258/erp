import { Client } from 'pg';
import { assertImportedCountsMatch } from './postgres-import-verification';
import { BackupService } from '../services/backup.service';
import { loadRuntimeEnv } from '../config/runtime';
import {
  hashFile,
  quoteIdentifier,
  readManifestReport,
  readSnapshotPayload,
  writeAuditReport,
  type ManifestReport,
  type SnapshotTable,
} from './postgres-migration-contract';
import {
  buildImportManifest,
  exportSnapshot,
  printPlan,
  runDryImportRehearsal,
} from './postgres-migration-snapshot';

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
