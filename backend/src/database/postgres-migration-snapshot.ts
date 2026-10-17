import fs from 'fs';
import path from 'path';
import prisma from '../config/database';
import { BackupService } from '../services/backup.service';
import { getBackupDir, loadRuntimeEnv, runtime } from '../config/runtime';
import { formatBytes, getDatabaseInfo } from './db-utils';
import {
  CRITICAL_TABLE_NAMES,
  IMPORT_PHASES,
  buildTableRowCountMap,
  ensureSnapshotDir,
  escapeIdentifier,
  hashFile,
  readManifestReport,
  readSnapshotPayload,
  readSnapshotReport,
  stringifyMigrationJson,
  timestampStamp,
  writeAuditReport,
  type SnapshotTable,
} from './postgres-migration-contract';

const listSqliteTables = async () => {
  const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  );

  return tables
    .map(item => item.name)
    .filter(name => /^[A-Za-z0-9_]+$/.test(name));
};

export const exportSnapshot = async () => {
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
  fs.writeFileSync(outputPath, stringifyMigrationJson(payload, 2), 'utf8');
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

export const printPlan = async () => {
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

export const buildImportManifest = async () => {
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

export const runDryImportRehearsal = async () => {
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
