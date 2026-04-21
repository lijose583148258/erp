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

// 生产环境不输出debug日志
if (process.env.NODE_ENV === 'production') {
  logger.level = 'info';
}

export default logger;
