import bcrypt from 'bcryptjs';
import prisma from '../config/database';
import { BackupService } from '../services/backup.service';
import { loadRuntimeEnv } from '../config/runtime';
import { ensureSqliteParentDir, formatBytes, getDatabaseInfo } from './db-utils';
import { demoCustomers, demoUsers } from './seed-fixtures';
import { logger } from '../utils/logger';
import { repairRuntimeSchema } from './runtime-schema-repair';
import { repairRuntimeData } from './runtime-data-repair';
import { auditRuntimeSchema } from './runtime-schema-audit';

const args = process.argv.slice(2);
const command = (args[0] || 'status').toLowerCase();
const target = args[1];
const isProduction = () => process.env.NODE_ENV === 'production';
const isTruthy = (value?: string) =>
  ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const printStatus = () => {
  const dbInfo = getDatabaseInfo();
  const backups = BackupService.getBackupList();
  const backupStatus = BackupService.getDatabaseStatus();

  console.log('');
  console.log('=== Database Status ===');
  console.log(`Environment: ${dbInfo.nodeEnv}`);
  console.log(`Database Type: ${dbInfo.databaseType}`);
  console.log(`SQLite Path: ${dbInfo.sqliteDbPath || 'not configured'}`);
  console.log(`Database Exists: ${dbInfo.databaseExists ? 'yes' : 'no'}`);
  console.log(`Database Size: ${formatBytes(dbInfo.databaseSize)}`);
  console.log(`Database Updated At: ${dbInfo.databaseUpdatedAt ? dbInfo.databaseUpdatedAt.toLocaleString() : 'N/A'}`);
  console.log(`Backup Dir: ${backupStatus.backupDir}`);
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

const seedDatabase = async () => {
  if (isProduction() && !isTruthy(process.env.AILAODA_ALLOW_DEMO_SEED)) {
    throw new Error('Refused to seed demo accounts in production. Use bootstrap-admin with AILAODA_ADMIN_USERNAME and AILAODA_ADMIN_PASSWORD.');
  }

  const hashedUsers = await Promise.all(demoUsers.map(async user => ({
    username: user.username,
    role: user.role,
    segment: user.segment,
    email: `${user.username}@ailaoda.local`,
    isActive: true,
    passwordHash: await bcrypt.hash(user.password, 12),
    mustChangePassword: true,
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
        mustChangePassword: true,
      },
      create: user,
    });
  }

  const customerCount = await prisma.customer.count();
  const salesUser = await prisma.user.findUnique({ where: { username: 'sales' } });

  if (customerCount === 0 && salesUser) {
    await prisma.customer.createMany({
      data: demoCustomers.map(customer => ({
        ...customer,
        salespersonId: salesUser.id,
        status: 'active',
        overdueAmount: 0,
      })),
    });
  }

  console.log('Seed data prepared');
};

const bootstrapAdmin = async () => {
  const username = (process.env.AILAODA_ADMIN_USERNAME || '').trim();
  const password = process.env.AILAODA_ADMIN_PASSWORD || '';
  const email = (process.env.AILAODA_ADMIN_EMAIL || '').trim() || null;

  if (!username) {
    throw new Error('AILAODA_ADMIN_USERNAME is required');
  }
  if (password.length < 12) {
    throw new Error('AILAODA_ADMIN_PASSWORD must be at least 12 characters');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({
    where: { username },
    select: { id: true, role: true },
  });

  const user = await prisma.user.upsert({
    where: { username },
    update: {
      passwordHash,
      email,
      role: 'admin',
      segment: 'mixed',
      isActive: true,
    },
    create: {
      username,
      passwordHash,
      email,
      role: 'admin',
      segment: 'mixed',
      isActive: true,
    },
    select: {
      id: true,
      username: true,
      role: true,
      isActive: true,
    },
  });

  console.log(`${existing ? 'Updated' : 'Created'} bootstrap admin: ${user.username} (${user.role})`);
};

const restoreBackup = async (fileName: string) => {
  const dbPath = ensureSqliteParentDir();
  if (!dbPath) {
    throw new Error('Current database is not SQLite file mode, restore is not available');
  }

  const result = await BackupService.restoreBackup(fileName);
  const integrity = result.integrity.manifestExists
    ? result.integrity.verified ? 'manifest verified' : 'manifest failed'
    : 'legacy backup without manifest';
  console.log(`Database restored from backup: ${result.fileName} (${integrity})`);
};

const run = async () => {
  loadRuntimeEnv();
  BackupService.init();
  ensureSqliteParentDir();

  switch (command) {
    case 'prepare':
    case 'init':
    case 'repair': {
      const report = await repairRuntimeSchema();
      const dataReport = await repairRuntimeData();
      const created = report.entries.filter(entry => entry.action === 'created').length;
      const added = report.entries.filter(entry => entry.action === 'added').length;
      const repaired = dataReport.entries.filter(entry => entry.action === 'updated').length;
      console.log(`Database schema prepared | created=${created} added=${added} dataRepaired=${repaired}`);
      printStatus();
      return;
    }
    case 'audit': {
      const report = await auditRuntimeSchema();
      console.log(JSON.stringify(report, null, 2));
      return;
    }
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
    case 'bootstrap-admin':
    case 'admin:create':
      await bootstrapAdmin();
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
      console.log('npm run db:manage -- repair');
      console.log('npm run db:manage -- audit');
      console.log('npm run db:manage -- status');
      console.log('npm run db:manage -- backup');
      console.log('npm run db:manage -- seed');
      console.log('npm run db:manage -- bootstrap-admin');
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
