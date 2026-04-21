import { Request, Response, NextFunction, RequestHandler } from 'express';
import { verifyToken } from '../utils/jwt';
import { isTokenBlacklisted } from '../controllers/auth.controller';
import { logger } from '../utils/logger';
import { DataScope, Permission } from '../permissions/permissionRegistry';
import { casbinAllowsAllPermissions } from '../permissions/casbinAuthorization';
import { getDataScopesForRole } from '../services/authorization-policy.service';

export interface AuthRequest extends Request {
  user?: {
    userId: number;
    username: string;
    role: string;
    segment?: 'direct' | 'channel' | 'mixed';
    dataScopes?: DataScope[];
  };
}

export type AuthRouteHandler = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => unknown | Promise<unknown>;

export const authRoute = (handler: AuthRouteHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req as AuthRequest, res, next)).catch(next);
  };

/**
 * JWT 认证中间件（含 Token 黑名单检查）
 */
export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null;
    const queryToken = req.method === 'GET' && typeof req.query.token === 'string'
      ? req.query.token
      : null;
    const token = bearerToken || queryToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: '未提供认证令牌',
      });
    }

    // C3修复：检查 Token 是否已被加入黑名单（登出/密码修改后失效）
    if (isTokenBlacklisted(token)) {
      return res.status(401).json({
        success: false,
        message: '认证令牌已失效，请重新登录',
      });
    }

    const payload = verifyToken(token);
    req.user = {
      ...payload,
      segment: payload.segment || (payload.role === 'sales' ? 'direct' : 'mixed'),
      dataScopes: await getDataScopesForRole(payload.role),
    };

    next();
  } catch (error) {
    logger.error('认证失败:', error);
    return res.status(401).json({
      success: false,
      message: '认证令牌无效或已过期',
    });
  }
};

/**
 * 角色权限中间件
 */
export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: '未认证',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: '权限不足',
      });
    }

    next();
  };
};

export const authorizePermission = (...permissions: Permission[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: '未认证',
      });
    }

    try {
      const allowed = await casbinAllowsAllPermissions(req.user.role, permissions);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: '权限不足',
          requiredPermissions: permissions,
        });
      }
    } catch (error) {
      logger.error('权限判定失败:', error);
      return res.status(500).json({
        success: false,
        message: '权限判定失败',
      });
    }

    next();
  };
};
