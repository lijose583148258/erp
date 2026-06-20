import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import prisma from '../config/database';
import { BackupService } from '../services/backup.service';
import { getBackupDir, getSqliteDbPath, loadRuntimeEnv, runtime } from '../config/runtime';
import { logger } from '../utils/logger';

const args = process.argv.slice(2);
const command = (args[0] || 'status').toLowerCase();
const target = args[1];

const ensureSqliteDirectory = () => {
    const dbPath = getSqliteDbPath();
    if (!dbPath) {
        return null;
    }

    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    return dbPath;
};

const formatBytes = (bytes: number | null) => {
    if (bytes === null) return 'N/A';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const printStatus = () => {
    const dbPath = getSqliteDbPath();
    const dbExists = Boolean(dbPath && fs.existsSync(dbPath));
    const dbStats = dbExists && dbPath ? fs.statSync(dbPath) : null;
    const backups = BackupService.getBackupList();

    console.log('');
    console.log('=== Database Status ===');
    console.log(`Environment: ${runtime.nodeEnv}`);
    console.log(`Database Type: ${dbPath ? 'sqlite-file' : 'external'}`);
    console.log(`SQLite Path: ${dbPath || 'not configured'}`);
    console.log(`Database Exists: ${dbExists ? 'yes' : 'no'}`);
    console.log(`Database Size: ${formatBytes(dbStats ? dbStats.size : null)}`);
    console.log(`Database Updated At: ${dbStats ? dbStats.mtime.toLocaleString() : 'N/A'}`);
    console.log(`Backup Dir: ${getBackupDir()}`);
    console.log(`Backup Count: ${backups.length}`);

    if (backups.length > 0) {
        console.log(`Latest Backup: ${backups[0].filename}`);
        console.log(`Latest Backup Time: ${backups[0].createdAt.toLocaleString()}`);
    } else {
        console.log('Latest Backup: none');
    }

    console.log('');
    console.log('=== Recent Backups ===');
    if (backups.length === 0) {
        console.log('No backup files found');
    } else {
        backups.slice(0, 10).forEach(item => {
            console.log(`- ${item.filename} | ${formatBytes(item.size)} | ${item.createdAt.toLocaleString()}`);
        });
    }
    console.log('');
};

const restoreBackup = async (fileName: string) => {
    const dbPath = getSqliteDbPath();
    if (!dbPath) {
        throw new Error('Current database is not SQLite file mode, restore is not available');
    }

    const safeName = path.basename(fileName);
    if (safeName !== fileName) {
        throw new Error('Backup file name contains an invalid path');
    }

    if (!/^[A-Za-z0-9._-]+\.db$/.test(safeName)) {
        throw new Error('Backup file name format is invalid');
    }

    const backupPath = path.join(getBackupDir(), safeName);
    if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${safeName}`);
    }

    await BackupService.restoreBackup(safeName);
    console.log(`Database restored from backup: ${safeName}`);
};

const seedDatabase = async () => {
    // C5修复：生产环境禁止执行 seed（防止弱密码账号被创建）
    if (runtime.nodeEnv === 'production') {
        console.error('❌ 安全拒绝: 不允许在生产环境执行 seed 操作。如需初始化用户，请使用环境变量或 API 注册。');
        process.exit(1);
    }

    const defaultUsers = [
        { username: 'admin', role: 'admin', segment: 'mixed', password: 'admin123' },
        { username: 'manager', role: 'manager', segment: 'mixed', password: 'manager123' },
        { username: 'sales', role: 'sales', segment: 'direct', password: 'sales123' },
        { username: 'warehouse', role: 'warehouse', segment: 'mixed', password: 'warehouse123' },
        { username: 'finance', role: 'finance', segment: 'mixed', password: 'finance123' },
    ];

    const hashedUsers = await Promise.all(defaultUsers.map(async user => ({
        username: user.username,
        role: user.role,
        segment: user.segment,
        email: `${user.username}@ailaoda.local`,
        isActive: true,
        passwordHash: await bcrypt.hash(user.password, 12),
    })));

    for (const user of hashedUsers) {
        await prisma.user.upsert({
            where: { username: user.username },
            update: {
                role: user.role,
                segment: user.segment,
                email: user.email,
                isActive: true,
                passwordHash: user.passwordHash,
            },
            create: user,
        });
    }

    const customerCount = await prisma.customer.count();
    const salesUser = await prisma.user.findUnique({ where: { username: 'sales' } });

    if (customerCount === 0 && salesUser) {
        await prisma.customer.createMany({
            data: [
                {
                    name: 'Demo Chemicals Co.',
                    nameZh: '演示化工有限公司',
                    nameEn: 'Demo Chemicals Co.',
                    nameVi: 'Công ty Hóa chất Demo',
                    licenseNumber: 'DEMO-001',
                    creditLimit: 500000,
                    riskLevel: 'low',
                    contactName: 'Zhang San',
                    contactPhone: '13800138001',
                    contactEmail: 'zhangsan@example.com',
                    segment: 'direct',
                    salespersonId: salesUser.id,
                    status: 'active',
                    overdueAmount: 0,
                },
                {
                    name: 'Sample Trade Ltd.',
                    nameZh: '示例贸易有限公司',
                    nameEn: 'Sample Trade Ltd.',
                    nameVi: 'Công ty Thương mại Mẫu',
                    licenseNumber: 'DEMO-002',
                    creditLimit: 300000,
                    riskLevel: 'medium',
                    contactName: 'Li Si',
                    contactPhone: '13800138002',
                    contactEmail: 'lisi@example.com',
                    segment: 'channel',
                    salespersonId: salesUser.id,
                    status: 'active',
                    overdueAmount: 0,
                },
            ],
        });
    }

    console.log('Seed data prepared');
};

const run = async () => {
    loadRuntimeEnv();
    BackupService.init();
    ensureSqliteDirectory();

    switch (command) {
        case 'prepare':
        case 'init':
            console.log('Database base prepared');
            printStatus();
            return;
        case 'status':
        case 'info':
            printStatus();
            return;
        case 'backup': {
            const fileName = await BackupService.performBackup();
            console.log(`Backup created: ${fileName}`);
            return;
        }
        case 'seed':
            await seedDatabase();
            console.log('Seed completed');
            return;
        case 'restore':
            if (!target) {
                throw new Error('Please provide the backup file name, for example: npm run db:manage -- restore backup-2026-04-08T12-00-00-000Z.db');
            }
            await restoreBackup(target);
            return;
        default:
            console.log('');
            console.log('=== Database Management Commands ===');
            console.log('npm run db:manage -- prepare');
            console.log('npm run db:manage -- status');
            console.log('npm run db:manage -- backup');
            console.log('npm run db:manage -- seed');
            console.log('npm run db:manage -- restore <backup-file.db>');
            console.log('');
            return;
    }
};

run().catch(error => {
    logger.error('Database management command failed', error);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
