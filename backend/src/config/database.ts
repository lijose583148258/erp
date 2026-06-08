import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { assertRuntimeDeploymentPolicy, getSqliteDbPath, loadRuntimeEnv, runtime } from './runtime';

loadRuntimeEnv();
assertRuntimeDeploymentPolicy();

const sqliteDbPath = getSqliteDbPath();
if (runtime.databaseEngine === 'sqlite' && sqliteDbPath) {
  const sqliteDir = path.dirname(sqliteDbPath);
  if (!fs.existsSync(sqliteDir)) {
    fs.mkdirSync(sqliteDir, { recursive: true });
  }
  process.env.DATABASE_URL = `file:${sqliteDbPath.replace(/\\/g, '/')}`;
}

const prisma = new PrismaClient({
  log: [
    { level: 'query', emit: 'event' },
    { level: 'error', emit: 'stdout' },
    { level: 'warn', emit: 'stdout' },
  ],
});

prisma.$on('query', (event: any) => {
  if (process.env.NODE_ENV === 'development') {
    logger.debug(`Query: ${event.query}`);
    logger.debug(`Duration: ${event.duration}ms`);
  }
});

export const configureRuntimeDatabase = async () => {
  await prisma.$connect();

  if (sqliteDbPath) {
    await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
    await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL');
    await prisma.$queryRawUnsafe('PRAGMA cache_size = -64000');
    await prisma.$queryRawUnsafe('PRAGMA foreign_keys = ON');

    // Validate the generated Prisma mapping instead of assuming a physical table name.
    await prisma.user.findFirst({ select: { id: true } });
  }
};

export const connectDatabase = async () => {
  try {
    await configureRuntimeDatabase();
    logger.info('数据库连接成功');
  } catch (error) {
    logger.error('数据库连接失败', error);
    process.exit(1);
  }
};

export const disconnectDatabase = async () => {
  await prisma.$disconnect();
  logger.info('数据库连接已关闭');
};

export default prisma;
