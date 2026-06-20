import fs from 'fs';
import path from 'path';
import prisma from '../config/database';
import { BackupService } from '../services/backup.service';
import { getBackupDir, loadRuntimeEnv, runtime } from '../config/runtime';
import { getDatabaseInfo } from './db-utils';

type SnapshotTable = {
  name: string;
  rowCount: number;
  rows: Record<string, unknown>[];
};

const snapshotDir = () => path.join(getBackupDir(), 'postgres-migration');

const ensureSnapshotDir = () => {
  const dir = snapshotDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const timestampStamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const escapeIdentifier = (value: string) => value.replace(/"/g, '""');

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

  return { fileName, outputPath, tableCount: snapshotTables.length };
};

const printPlan = async () => {
  loadRuntimeEnv();
  const dbInfo = getDatabaseInfo();
  const backups = BackupService.getBackupList();
  const tableNames = await listSqliteTables();

  console.log('');
  console.log('=== PostgreSQL Migration Plan ===');
  console.log(`Current Database: ${dbInfo.databaseType}`);
  console.log(`SQLite Path: ${dbInfo.sqliteDbPath || 'not configured'}`);
  console.log(`Current Tables: ${tableNames.length}`);
  console.log(`Backup Dir: ${getBackupDir()}`);
  console.log(`Backup Count: ${backups.length}`);
  console.log(`Suggested Target Env: POSTGRES_URL`);
  console.log('');
  console.log('=== Recommended Steps ===');
  console.log('1. Create one final SQLite backup');
  console.log('2. Export a migration snapshot JSON');
  console.log('3. Provision PostgreSQL and set POSTGRES_URL');
  console.log('4. Run schema diff and data verification');
  console.log('5. Cut over only after smoke tests pass');
  console.log('6. If cutover fails, restore the SQLite backup and revert env vars');
  console.log('');
};

const rollbackToBackup = async (fileName?: string) => {
  loadRuntimeEnv();
  const backups = BackupService.getBackupList();
  const target = fileName || backups[0]?.filename;

  if (!target) {
    throw new Error('No backup file available for rollback');
  }

  await BackupService.restoreBackup(target);

  console.log('');
  console.log('=== PostgreSQL Migration Rollback ===');
  console.log(`Restored backup: ${target}`);
  console.log('Rollback suggestion: keep DATABASE_URL on SQLite until the new cutover is validated');
  console.log('');
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
      console.log('');
      return;
    }
    case 'rollback':
      await rollbackToBackup(target);
      return;
    default:
      console.log('');
      console.log('=== PostgreSQL Migration Commands ===');
      console.log('npm run db:pg -- plan');
      console.log('npm run db:pg -- snapshot');
      console.log('npm run db:pg -- rollback <backup-file.db>');
      console.log('');
      return;
  }
};

run().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
