import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { getSqliteDbPath, loadRuntimeEnv } from './runtime';

loadRuntimeEnv();

const sqliteDbPath = getSqliteDbPath();
if (sqliteDbPath) {
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

export const connectDatabase = async () => {
  try {
    await prisma.$connect();
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
