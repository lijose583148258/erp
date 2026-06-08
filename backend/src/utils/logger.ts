import { createLogger, format, transports } from 'winston';
import fs from 'fs';
import path from 'path';
import { loadRuntimeEnv, runtime } from '../config/runtime';

const { combine, timestamp, printf, colorize, errors } = format;

loadRuntimeEnv();

if (!fs.existsSync(runtime.logDir)) {
  fs.mkdirSync(runtime.logDir, { recursive: true });
}

// 自定义日志格式
const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

// 创建logger实例
export const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    // 控制台输出
    new transports.Console({
      format: combine(colorize(), logFormat),
    }),
    // 错误日志文件
    new transports.File({
      filename: path.join(runtime.logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // 所有日志文件
    new transports.File({
      filename: path.join(runtime.logDir, 'combined.log'),
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

const expectedBusinessErrorPatterns = [
  /\b[A-Z][A-Z0-9_]*(?:NOT_FOUND|INVALID|NOT_ALLOWED|ALREADY|REQUIRES|EXCEEDS|DUPLICATE|MISMATCH|CONFLICT|DENIED|BLOCKED|UNAUTHORIZED|FORBIDDEN)[A-Z0-9_]*\b/,
  /\bProductionCompletionValidationError\b/,
  /has no confirmed consumption record/i,
  /No available stock/i,
  /Duplicate .* detected/i,
  /already (?:been|exists|fully)/i,
  /Please refresh/i,
  /\b[A-Z][A-Z0-9_]*(?:BELOW_ZERO|TRANSITION|STATE)[A-Z0-9_]*\b/,
  /\b(?:Promise|Dispute|Order|Payment|Adjustment|Barter|Shipment|Purchase|Production) status cannot transition\b/i,
];

function stringifyLogArg(value: unknown): string {
  if (!value) return '';
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const message = typeof record.message === 'string' ? record.message : '';
    const name = typeof record.name === 'string' ? record.name : '';
    if (message || name) return `${name} ${message}`.trim();
  }
  return '';
}

function containsSystemErrorSignal(value: unknown) {
  if (!value) return false;
  const text = stringifyLogArg(value);
  return /\bPrismaClient|TypeError|ReferenceError|SyntaxError|DATABASE_ERROR|database|startup|connect/i.test(text);
}

export function isExpectedBusinessRejection(...args: unknown[]) {
  if (args.some(containsSystemErrorSignal)) {
    return false;
  }

  const text = args.map(stringifyLogArg).filter(Boolean).join(' ');
  return expectedBusinessErrorPatterns.some(pattern => pattern.test(text));
}

const originalLoggerError = logger.error.bind(logger) as (...args: unknown[]) => unknown;
const originalLoggerWarn = logger.warn.bind(logger) as (...args: unknown[]) => unknown;

logger.error = ((...args: unknown[]) => {
  if (isExpectedBusinessRejection(...args)) {
    return originalLoggerWarn('[business-rejection]', ...args);
  }
  return originalLoggerError(...args);
}) as typeof logger.error;

// 生产环境不输出debug日志
if (process.env.NODE_ENV === 'production') {
  logger.level = 'info';
}

export default logger;
