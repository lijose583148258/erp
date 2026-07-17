import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// 标准错误码枚举
export enum ErrorCode {
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  CONFLICT = 'CONFLICT',
  DATABASE_ERROR = 'DATABASE_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
}

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  errorCode: ErrorCode;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number = 500,
    errorCode: ErrorCode = ErrorCode.INTERNAL_ERROR,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 全局错误处理中间件
 * 支持多种错误类型的标准化处理
 */
export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // 记录错误
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userId: (req as any).user?.userId,
  });

  // 默认错误状态码
  let statusCode = 500;
  let message = '服务器内部错误';
  let errorCode: ErrorCode = ErrorCode.INTERNAL_ERROR;

  // 如果是自定义错误
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    errorCode = err.errorCode;
  }

  // Express/body-parser exposes stable status and type fields for request-body
  // failures. Map them before the generic 500 response so malformed or
  // oversized client input is not reported as an internal server failure.
  const parserError = err as Error & {
    status?: number;
    statusCode?: number;
    type?: string;
    body?: unknown;
  };
  const parserStatus = parserError.status ?? parserError.statusCode;

  if (
    parserError.type === 'entity.too.large'
    || parserStatus === 413
    || err.name === 'PayloadTooLargeError'
  ) {
    statusCode = 413;
    message = '请求内容超过大小限制';
    errorCode = ErrorCode.PAYLOAD_TOO_LARGE;
  } else if (
    parserError.type === 'entity.parse.failed'
    || (parserStatus === 400 && err instanceof SyntaxError && 'body' in parserError)
  ) {
    statusCode = 400;
    message = '请求内容不是有效的 JSON';
    errorCode = ErrorCode.VALIDATION_ERROR;
  }

  // Prisma错误处理
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as any;
    statusCode = 400;
    errorCode = ErrorCode.DATABASE_ERROR;

    // P2002: 唯一约束冲突
    if (prismaError.code === 'P2002') {
      message = '该编码、单号或名称已存在，请修改后再保存。';
      errorCode = ErrorCode.CONFLICT;
      statusCode = 409;
    }
    // P2003: 外键约束失败
    else if (prismaError.code === 'P2003') {
      message = '关联数据不存在';
      errorCode = ErrorCode.VALIDATION_ERROR;
    }
    // P2025: 记录不存在
    else if (prismaError.code === 'P2025') {
      message = '请求的资源不存在';
      errorCode = ErrorCode.NOT_FOUND;
      statusCode = 404;
    }
    else {
      message = '数据库操作失败';
    }
  }

  // Zod校验错误处理
  if (err.name === 'ZodError') {
    statusCode = 400;
    errorCode = ErrorCode.VALIDATION_ERROR;
    const zodError = err as any;
    const issues = zodError.issues?.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ');
    message = `填写内容不完整或格式不对，请按页面提示修改后再提交。${issues ? `（${issues}）` : ''}`;
  }

  // JWT错误处理
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = '认证令牌无效';
    errorCode = ErrorCode.UNAUTHORIZED;
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = '认证令牌已过期';
    errorCode = ErrorCode.UNAUTHORIZED;
  }

  // 防止敏感信息泄露
  const isProduction = process.env.NODE_ENV === 'production';

  // 返回错误响应
  res.status(statusCode).json({
    success: false,
    message,
    errorCode,
    timestamp: new Date().toISOString(),
    path: req.path,
    ...(!isProduction && {
      stack: err.stack,
      details: (err as any).details,
    }),
  });
};
