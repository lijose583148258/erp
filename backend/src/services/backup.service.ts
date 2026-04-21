import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { getBackupDir, getSqliteDbPath, loadRuntimeEnv, runtime } from '../config/runtime';

const SQLITE_BACKUP_COMPANION_SUFFIXES = ['-wal', '-shm', '-journal'] as const;
const DEFAULT_BACKUP_RETENTION_DAYS = 90;

export interface BackupFileInfo {
    filename: string;
    size: number;
    createdAt: Date;
}

export interface DatabaseStatus {
    nodeEnv: string;
    databaseType: 'sqlite-file' | 'external';
    sqliteDbPath: string | null;
    databaseExists: boolean;
    databaseSize: number | null;
    databaseUpdatedAt: Date | null;
    backupDir: string;
    backupCount: number;
    latestBackup: BackupFileInfo | null;
}

export class BackupService {
    private static normalizePathCandidates(filePath: string) {
        const raw = String(filePath || '');
        const cleaned = raw
            .replace(/^\uFEFF/, '')
            .replace(/[\u0000-\u001F\u007F]/g, '')
            .trim()
            .replace(/^['"]+|['"]+$/g, '');

        const variants = [
            raw,
            cleaned,
            cleaned.replace(/\//g, path.sep),
            path.normalize(cleaned),
        ];

        return Array.from(new Set(variants.filter(Boolean)));
    }

    private static resolveExistingDbPath(filePath: string) {
        const candidates = this.normalizePathCandidates(filePath);
        const resolved = candidates.find(candidate => fs.existsSync(candidate));
        return resolved || candidates[0] || filePath;
    }

    private static ensureBackupDir() {
        const backupDir = getBackupDir();
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
            logger.info(`Backup directory created: ${backupDir}`);
        }

        return backupDir;
    }

    private static resolveSafeBackupPath(fileName: string) {
        const safeName = path.basename(fileName);

        if (safeName !== fileName) {
            throw new Error('Backup file name contains an invalid path');
        }

        if (!/^[A-Za-z0-9._-]+\.db$/.test(safeName)) {
            throw new Error('Backup file name format is invalid');
        }

        return path.join(this.ensureBackupDir(), safeName);
    }

    private static getCompanionFilePaths(basePath: string) {
        return SQLITE_BACKUP_COMPANION_SUFFIXES.map((suffix) => `${basePath}${suffix}`);
    }

    private static copyExistingFile(sourcePath: string, targetPath: string) {
        if (!fs.existsSync(sourcePath)) {
            return false;
        }

        fs.copyFileSync(sourcePath, targetPath);
        fs.utimesSync(targetPath, new Date(), new Date());
        return true;
    }

    private static removeIfExists(filePath: string) {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    static init() {
        loadRuntimeEnv();
        this.ensureBackupDir();
    }

    static async performBackup(): Promise<string> {
        this.init();

        const configuredDbPath = getSqliteDbPath();
        if (!configuredDbPath) {
            throw new Error('Current database is not SQLite file mode, backup is not available');
        }

        const dbPath = this.resolveExistingDbPath(configuredDbPath);
        if (!fs.existsSync(dbPath)) {
            throw new Error(`Database file not found: ${configuredDbPath}`);
        }

        if (dbPath !== configuredDbPath) {
            logger.warn(`Backup DB path normalized from "${configuredDbPath}" to "${dbPath}"`);
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFileName = `backup-${timestamp}.db`;
        const backupPath = path.join(this.ensureBackupDir(), backupFileName);

        try {
            this.copyExistingFile(dbPath, backupPath);
            this.getCompanionFilePaths(dbPath).forEach((companionPath) => {
                const companionSuffix = companionPath.slice(dbPath.length);
                const targetCompanionPath = path.join(this.ensureBackupDir(), `${backupFileName}${companionSuffix}`);
                this.copyExistingFile(companionPath, targetCompanionPath);
            });
            logger.info(`Database backup created: ${backupFileName}`);
            this.cleanupOldBackups();
            return backupFileName;
        } catch (error) {
            logger.error('Database backup failed', error);
            throw error;
        }
    }

    static async restoreBackup(fileName: string): Promise<string> {
        this.init();

        const configuredDbPath = getSqliteDbPath();
        if (!configuredDbPath) {
            throw new Error('Current database is not SQLite file mode, restore is not available');
        }
        const dbPath = this.resolveExistingDbPath(configuredDbPath);

        const backupPath = this.resolveSafeBackupPath(fileName);
        if (!fs.existsSync(backupPath)) {
            throw new Error(`Backup file not found: ${fileName}`);
        }

        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        try {
            const restoreSnapshotName = `restore-pre-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
            const restoreSnapshotPath = path.join(this.ensureBackupDir(), restoreSnapshotName);

            this.copyExistingFile(dbPath, restoreSnapshotPath);
            this.getCompanionFilePaths(dbPath).forEach((companionPath) => {
                const companionSuffix = companionPath.slice(dbPath.length);
                const targetCompanionPath = path.join(this.ensureBackupDir(), `${restoreSnapshotName}${companionSuffix}`);
                this.copyExistingFile(companionPath, targetCompanionPath);
            });

            this.getCompanionFilePaths(dbPath).forEach((companionPath) => this.removeIfExists(companionPath));
            this.copyExistingFile(backupPath, dbPath);
            this.getCompanionFilePaths(backupPath).forEach((companionPath) => {
                const companionSuffix = companionPath.slice(backupPath.length);
                const targetCompanionPath = `${dbPath}${companionSuffix}`;
                this.copyExistingFile(companionPath, targetCompanionPath);
            });
            logger.info(`Database restored from backup: ${path.basename(fileName)}`);
            return path.basename(fileName);
        } catch (error) {
            logger.error('Database restore failed', error);
            throw error;
        }
    }

    static getDatabaseStatus(): DatabaseStatus {
        this.init();

        const backupDir = this.ensureBackupDir();
        const dbPath = getSqliteDbPath();
        const dbExists = Boolean(dbPath && fs.existsSync(dbPath));
        const dbStats = dbExists && dbPath ? fs.statSync(dbPath) : null;
        const backups = this.getBackupList();

        return {
            nodeEnv: runtime.nodeEnv,
            databaseType: dbPath ? 'sqlite-file' : 'external',
            sqliteDbPath: dbPath,
            databaseExists: dbExists,
            databaseSize: dbStats ? dbStats.size : null,
            databaseUpdatedAt: dbStats ? dbStats.mtime : null,
            backupDir,
            backupCount: backups.length,
            latestBackup: backups.length > 0 ? backups[0] : null,
        };
    }

    private static cleanupOldBackups() {
        const configuredRetentionDays = Number(process.env.BACKUP_RETENTION_DAYS || DEFAULT_BACKUP_RETENTION_DAYS);
        const MAX_AGE_DAYS = Number.isFinite(configuredRetentionDays) && configuredRetentionDays > 0
            ? configuredRetentionDays
            : DEFAULT_BACKUP_RETENTION_DAYS;
        const now = Date.now();
        const backupDir = this.ensureBackupDir();

        try {
            const files = fs.readdirSync(backupDir);
            files.forEach(file => {
                try {
                    const filePath = path.join(backupDir, file);
                    const stats = fs.statSync(filePath);
                    if (!stats.isFile()) return;
                    if (!file.endsWith('.db')) return;

                    const ageInDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);
                    if (ageInDays > MAX_AGE_DAYS) {
                        fs.unlinkSync(filePath);
                        this.getCompanionFilePaths(filePath).forEach((companionPath) => this.removeIfExists(companionPath));
                        logger.info(`Expired backup removed: ${file}`);
                    }
                } catch (fileError) {
                    logger.error(`Failed to process backup file (${file})`, fileError);
                }
            });
        } catch (error) {
            logger.error('Failed to clean old backups', error);
        }
    }

    static getBackupList(): BackupFileInfo[] {
        this.init();

        try {
            const backupDir = this.ensureBackupDir();
            return fs.readdirSync(backupDir)
                .map(file => {
                    const filePath = path.join(backupDir, file);
                    const stats = fs.statSync(filePath);
                    return {
                        filename: file,
                        size: stats.size,
                        createdAt: stats.mtime,
                    };
                })
                .filter(item => item.filename.endsWith('.db'))
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        } catch (error) {
            logger.error('Failed to load backup list', error);
            return [];
        }
    }
}
