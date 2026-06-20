import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { getBackupDir, getSqliteDbPath, loadRuntimeEnv, runtime } from '../config/runtime';
import prisma, { configureRuntimeDatabase } from '../config/database';

const SQLITE_BACKUP_COMPANION_SUFFIXES = ['-wal', '-shm', '-journal'] as const;
const DEFAULT_BACKUP_RETENTION_DAYS = 90;
type BackupRetentionMode = 'report-only' | 'enforce';

export interface BackupRetentionPolicy {
    mode: BackupRetentionMode;
    retentionDays: number;
    maxFiles: number | null;
    maxTotalMB: number | null;
    maxTotalBytes: number | null;
}

export interface BackupDirectoryStats {
    totalFiles: number;
    totalBytes: number;
    dbFiles: number;
    manifestFiles: number;
    companionFiles: number;
}

export interface BackupFileInfo {
    filename: string;
    size: number;
    createdAt: Date;
    manifestExists: boolean;
    checksumSha256: string | null;
}

interface BackupManifestFile {
    filename: string;
    size: number;
    sha256: string;
}

interface BackupManifest {
    version: 1;
    createdAt: string;
    backupFileName: string;
    sourceDatabasePath: string;
    files: BackupManifestFile[];
}

export interface BackupIntegrityResult {
    fileName: string;
    manifestExists: boolean;
    verified: boolean;
    reason: string | null;
    files: Array<BackupManifestFile & { exists: boolean; matches: boolean }>;
}

export interface RestoreBackupResult {
    fileName: string;
    integrity: BackupIntegrityResult;
}

export const BACKUP_OPERATION_IN_PROGRESS = 'BACKUP_OPERATION_IN_PROGRESS';
export const BACKUP_OPERATION_IN_PROGRESS_MESSAGE = 'A backup or restore operation is already running.';
export const getBackupOperationConflictMessage = (error: unknown) => (
    error instanceof Error && error.message === BACKUP_OPERATION_IN_PROGRESS
        ? BACKUP_OPERATION_IN_PROGRESS_MESSAGE
        : null
);

export interface DatabaseStatus {
    nodeEnv: string;
    databaseType: 'sqlite-file' | 'external';
    sqliteDbPath: string | null;
    databaseExists: boolean;
    databaseSize: number | null;
    databaseUpdatedAt: Date | null;
    backupDir: string;
    backupCount: number;
    backupTotalSize: number;
    backupDirectoryStats: BackupDirectoryStats;
    backupRetention: BackupRetentionPolicy;
    latestBackup: BackupFileInfo | null;
}

export class BackupService {
    private static exclusiveOperation: { label: string; promise: Promise<unknown> } | null = null;

    private static async runExclusiveBackupOperation<T>(label: string, operation: () => Promise<T>): Promise<T> {
        if (this.exclusiveOperation) {
            throw new Error(BACKUP_OPERATION_IN_PROGRESS);
        }

        const promise = operation();
        this.exclusiveOperation = { label, promise };

        try {
            return await promise;
        } finally {
            if (this.exclusiveOperation?.promise === promise) {
                this.exclusiveOperation = null;
            }
        }
    }

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

    private static getManifestPath(backupPath: string) {
        return `${backupPath}.manifest.json`;
    }

    private static async hashFile(filePath: string) {
        return new Promise<string>((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);
            stream.on('data', chunk => hash.update(chunk));
            stream.on('error', reject);
            stream.on('end', () => resolve(hash.digest('hex')));
        });
    }

    private static async describeFileForManifest(filePath: string): Promise<BackupManifestFile> {
        const stats = fs.statSync(filePath);
        return {
            filename: path.basename(filePath),
            size: stats.size,
            sha256: await this.hashFile(filePath),
        };
    }

    private static async writeBackupManifest(backupPath: string, sourceDatabasePath: string, copiedFilePaths: string[]) {
        const manifest: BackupManifest = {
            version: 1,
            createdAt: new Date().toISOString(),
            backupFileName: path.basename(backupPath),
            sourceDatabasePath,
            files: await Promise.all(copiedFilePaths.map(filePath => this.describeFileForManifest(filePath))),
        };

        fs.writeFileSync(this.getManifestPath(backupPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }

    private static readBackupManifest(backupPath: string): BackupManifest | null {
        const manifestPath = this.getManifestPath(backupPath);
        if (!fs.existsSync(manifestPath)) return null;

        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
        if (parsed.version !== 1 || parsed.backupFileName !== path.basename(backupPath) || !Array.isArray(parsed.files)) {
            throw new Error(`Backup manifest is invalid: ${path.basename(manifestPath)}`);
        }
        return parsed;
    }

    private static copyExistingFile(sourcePath: string, targetPath: string) {
        if (!fs.existsSync(sourcePath)) {
            return false;
        }

        fs.copyFileSync(sourcePath, targetPath);
        fs.utimesSync(targetPath, new Date(), new Date());
        return true;
    }

    private static async checkpointSqliteWal(context: string) {
        const configuredDbPath = getSqliteDbPath();
        if (!configuredDbPath) return;

        try {
            await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
        } catch (error) {
            logger.warn(`SQLite WAL checkpoint skipped before ${context}`, error);
        }
    }

    private static async prepareSqliteFileRestore() {
        await this.checkpointSqliteWal('restore');
        await prisma.$disconnect();
    }

    private static async reconnectAfterSqliteFileRestore() {
        await configureRuntimeDatabase();
    }

    private static removeIfExists(filePath: string) {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    private static parsePositiveNumber(value: string | undefined, fallback: number | null = null) {
        if (value === undefined || value === null || String(value).trim() === '') return fallback;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    private static parsePositiveInteger(value: string | undefined, fallback: number | null = null) {
        const parsed = this.parsePositiveNumber(value, fallback);
        return parsed === null ? null : Math.floor(parsed);
    }

    private static parseRetentionMode(value: string | undefined): BackupRetentionMode {
        return String(value || 'enforce').trim().toLowerCase() === 'report-only' ? 'report-only' : 'enforce';
    }

    private static getRetentionPolicy(): BackupRetentionPolicy {
        const retentionDays = this.parsePositiveNumber(process.env.BACKUP_RETENTION_DAYS, DEFAULT_BACKUP_RETENTION_DAYS) || DEFAULT_BACKUP_RETENTION_DAYS;
        const maxFiles = this.parsePositiveInteger(process.env.BACKUP_MAX_FILES);
        const maxTotalMB = this.parsePositiveNumber(process.env.BACKUP_MAX_TOTAL_MB);
        return {
            mode: this.parseRetentionMode(process.env.BACKUP_RETENTION_MODE),
            retentionDays,
            maxFiles,
            maxTotalMB,
            maxTotalBytes: maxTotalMB ? Math.floor(maxTotalMB * 1024 * 1024) : null,
        };
    }

    private static getBackupDirectoryStats(): BackupDirectoryStats {
        const backupDir = this.ensureBackupDir();
        return fs.readdirSync(backupDir).reduce<BackupDirectoryStats>((stats, file) => {
            const filePath = path.join(backupDir, file);
            const fileStats = fs.statSync(filePath);
            if (!fileStats.isFile()) return stats;
            stats.totalFiles += 1;
            stats.totalBytes += fileStats.size;
            if (file.endsWith('.db')) stats.dbFiles += 1;
            if (file.endsWith('.manifest.json')) stats.manifestFiles += 1;
            if (SQLITE_BACKUP_COMPANION_SUFFIXES.some(suffix => file.endsWith(suffix))) stats.companionFiles += 1;
            return stats;
        }, {
            totalFiles: 0,
            totalBytes: 0,
            dbFiles: 0,
            manifestFiles: 0,
            companionFiles: 0,
        });
    }

    static init() {
        loadRuntimeEnv();
        this.ensureBackupDir();
    }

    static async performBackup(): Promise<string> {
        return this.runExclusiveBackupOperation('backup', () => this.performBackupExclusive());
    }

    private static async performBackupExclusive(): Promise<string> {
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
            await this.checkpointSqliteWal('backup');
            const copiedFilePaths: string[] = [];
            this.copyExistingFile(dbPath, backupPath);
            copiedFilePaths.push(backupPath);
            this.getCompanionFilePaths(dbPath).forEach((companionPath) => {
                const companionSuffix = companionPath.slice(dbPath.length);
                const targetCompanionPath = path.join(this.ensureBackupDir(), `${backupFileName}${companionSuffix}`);
                if (this.copyExistingFile(companionPath, targetCompanionPath)) {
                    copiedFilePaths.push(targetCompanionPath);
                }
            });
            await this.writeBackupManifest(backupPath, dbPath, copiedFilePaths);
            logger.info(`Database backup created: ${backupFileName}`);
            this.cleanupOldBackups();
            return backupFileName;
        } catch (error) {
            logger.error('Database backup failed', error);
            throw error;
        }
    }

    static async verifyBackupIntegrity(fileName: string): Promise<BackupIntegrityResult> {
        const backupPath = this.resolveSafeBackupPath(fileName);
        const manifest = this.readBackupManifest(backupPath);
        if (!manifest) {
            return {
                fileName: path.basename(fileName),
                manifestExists: false,
                verified: false,
                reason: 'missing-manifest',
                files: [],
            };
        }

        const files = await Promise.all(manifest.files.map(async (file) => {
            const safeFileName = path.basename(file.filename);
            const filePath = path.join(this.ensureBackupDir(), safeFileName);
            const exists = fs.existsSync(filePath);
            if (!exists) {
                return { ...file, exists, matches: false };
            }

            const stats = fs.statSync(filePath);
            const sha256 = await this.hashFile(filePath);
            return {
                ...file,
                exists,
                matches: stats.size === file.size && sha256 === file.sha256,
            };
        }));

        const verified = files.every(file => file.exists && file.matches);
        return {
            fileName: path.basename(fileName),
            manifestExists: true,
            verified,
            reason: verified ? null : 'manifest-mismatch',
            files,
        };
    }

    static async restoreBackup(fileName: string): Promise<RestoreBackupResult> {
        return this.runExclusiveBackupOperation('restore', () => this.restoreBackupExclusive(fileName));
    }

    private static async restoreBackupExclusive(fileName: string): Promise<RestoreBackupResult> {
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
        const integrity = await this.verifyBackupIntegrity(fileName);
        if (integrity.manifestExists && !integrity.verified) {
            throw new Error(`Backup integrity verification failed: ${integrity.reason}`);
        }

        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        try {
            await this.prepareSqliteFileRestore();
            const restoreSnapshotName = `restore-pre-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
            const restoreSnapshotPath = path.join(this.ensureBackupDir(), restoreSnapshotName);
            const restoreSnapshotFilePaths: string[] = [];

            if (this.copyExistingFile(dbPath, restoreSnapshotPath)) {
                restoreSnapshotFilePaths.push(restoreSnapshotPath);
            }
            this.getCompanionFilePaths(dbPath).forEach((companionPath) => {
                const companionSuffix = companionPath.slice(dbPath.length);
                const targetCompanionPath = path.join(this.ensureBackupDir(), `${restoreSnapshotName}${companionSuffix}`);
                if (this.copyExistingFile(companionPath, targetCompanionPath)) {
                    restoreSnapshotFilePaths.push(targetCompanionPath);
                }
            });
            if (restoreSnapshotFilePaths.length > 0) {
                await this.writeBackupManifest(restoreSnapshotPath, dbPath, restoreSnapshotFilePaths);
            }

            this.getCompanionFilePaths(dbPath).forEach((companionPath) => this.removeIfExists(companionPath));
            this.copyExistingFile(backupPath, dbPath);
            this.getCompanionFilePaths(backupPath).forEach((companionPath) => {
                const companionSuffix = companionPath.slice(backupPath.length);
                const targetCompanionPath = `${dbPath}${companionSuffix}`;
                this.copyExistingFile(companionPath, targetCompanionPath);
            });
            logger.info(`Database restored from backup: ${path.basename(fileName)}`);
            return {
                fileName: path.basename(fileName),
                integrity,
            };
        } catch (error) {
            logger.error('Database restore failed', error);
            throw error;
        } finally {
            await this.reconnectAfterSqliteFileRestore();
        }
    }

    static getDatabaseStatus(): DatabaseStatus {
        this.init();

        const backupDir = this.ensureBackupDir();
        const dbPath = getSqliteDbPath();
        const dbExists = Boolean(dbPath && fs.existsSync(dbPath));
        const dbStats = dbExists && dbPath ? fs.statSync(dbPath) : null;
        const backups = this.getBackupList();
        const backupDirectoryStats = this.getBackupDirectoryStats();

        return {
            nodeEnv: runtime.nodeEnv,
            databaseType: dbPath ? 'sqlite-file' : 'external',
            sqliteDbPath: dbPath,
            databaseExists: dbExists,
            databaseSize: dbStats ? dbStats.size : null,
            databaseUpdatedAt: dbStats ? dbStats.mtime : null,
            backupDir,
            backupCount: backups.length,
            backupTotalSize: backupDirectoryStats.totalBytes,
            backupDirectoryStats,
            backupRetention: this.getRetentionPolicy(),
            latestBackup: backups.length > 0 ? backups[0] : null,
        };
    }

    private static cleanupOldBackups() {
        const retentionPolicy = this.getRetentionPolicy();
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
                    if (ageInDays > retentionPolicy.retentionDays) {
                        if (retentionPolicy.mode !== 'enforce') {
                            logger.warn(`Backup retention report-only: expired backup would be removed: ${file}`);
                            return;
                        }
                        fs.unlinkSync(filePath);
                        this.getCompanionFilePaths(filePath).forEach((companionPath) => this.removeIfExists(companionPath));
                        this.removeIfExists(this.getManifestPath(filePath));
                        logger.info(`Expired backup removed: ${file}`);
                    }
                } catch (fileError) {
                    logger.error(`Failed to process backup file (${file})`, fileError);
                }
            });
        } catch (error) {
            logger.error('Failed to clean old backups', error);
        }

        this.cleanupBackupsByCountAndSize(retentionPolicy);
    }

    private static cleanupBackupsByCountAndSize(retentionPolicy: BackupRetentionPolicy) {
        if (!retentionPolicy.maxFiles && !retentionPolicy.maxTotalBytes) return;

        const backupDir = this.ensureBackupDir();
        try {
            const backupFiles = fs.readdirSync(backupDir)
                .filter(file => file.endsWith('.db'))
                .map(file => {
                    const filePath = path.join(backupDir, file);
                    const stats = fs.statSync(filePath);
                    return { file, filePath, size: stats.size, mtimeMs: stats.mtimeMs };
                })
                .filter(item => fs.statSync(item.filePath).isFile())
                .sort((a, b) => b.mtimeMs - a.mtimeMs);

            let retainedCount = 0;
            let retainedBytes = 0;
            for (const item of backupFiles) {
                const keepAtLeastOneBackup = retainedCount === 0;
                const exceedsCount = !keepAtLeastOneBackup && retentionPolicy.maxFiles !== null && retainedCount >= retentionPolicy.maxFiles;
                const exceedsSize = !keepAtLeastOneBackup && retentionPolicy.maxTotalBytes !== null && retainedBytes + item.size > retentionPolicy.maxTotalBytes;
                if (exceedsCount || exceedsSize) {
                    if (retentionPolicy.mode !== 'enforce') {
                        logger.warn(`Backup retention report-only: backup would be removed by ${exceedsCount ? 'count' : 'size'} guardrail: ${item.file}`);
                        retainedCount += 1;
                        retainedBytes += item.size;
                        continue;
                    }
                    fs.unlinkSync(item.filePath);
                    this.getCompanionFilePaths(item.filePath).forEach((companionPath) => this.removeIfExists(companionPath));
                    this.removeIfExists(this.getManifestPath(item.filePath));
                    logger.info(`Backup removed by retention policy: ${item.file}`);
                    continue;
                }
                retainedCount += 1;
                retainedBytes += item.size;
            }
        } catch (error) {
            logger.error('Failed to enforce backup count/size retention', error);
        }
    }

    private static getBackupManifestSummary(filePath: string) {
        try {
            const manifest = this.readBackupManifest(filePath);
            return {
                exists: Boolean(manifest),
                checksumSha256: manifest?.files.find(file => file.filename === path.basename(filePath))?.sha256 || null,
            };
        } catch {
            return {
                exists: false,
                checksumSha256: null,
            };
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
                    const manifest = this.getBackupManifestSummary(filePath);
                    return {
                        filename: file,
                        size: stats.size,
                        createdAt: stats.mtime,
                        manifestExists: manifest.exists,
                        checksumSha256: manifest.checksumSha256,
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
