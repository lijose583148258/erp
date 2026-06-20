import fs from 'fs';
import path from 'path';
import { getSqliteDbPath, runtime } from '../config/runtime';

export const ensureDirectory = (directoryPath: string) => {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
};

export const ensureSqliteParentDir = () => {
  const dbPath = getSqliteDbPath();
  if (!dbPath) {
    return null;
  }

  ensureDirectory(path.dirname(dbPath));
  return dbPath;
};

export const getDatabaseMode = () => {
  const dbPath = getSqliteDbPath();
  return dbPath ? 'sqlite-file' : 'external';
};

export const formatBytes = (bytes: number | null) => {
  if (bytes === null) return 'N/A';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export const getDatabaseInfo = () => {
  const dbPath = getSqliteDbPath();
  const dbExists = Boolean(dbPath && fs.existsSync(dbPath));
  const dbStats = dbExists && dbPath ? fs.statSync(dbPath) : null;

  return {
    nodeEnv: runtime.nodeEnv,
    databaseType: getDatabaseMode(),
    sqliteDbPath: dbPath,
    databaseExists: dbExists,
    databaseSize: dbStats ? dbStats.size : null,
    databaseUpdatedAt: dbStats ? dbStats.mtime : null,
  };
};

