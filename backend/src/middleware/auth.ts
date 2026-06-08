import { Request, Response, NextFunction, RequestHandler } from 'express';
import { verifyToken } from '../utils/jwt';
import { isTokenBlacklisted } from '../services/auth-token-store.service';
import { logger } from '../utils/logger';
import { DataScope, Permission } from '../permissions/permissionRegistry';
import { casbinAllowsAllPermissions } from '../permissions/casbinAuthorization';
import { getDataScopesForRole, roleExistsAndActive } from '../services/authorization-policy.service';
import { resolveUserSegment } from '../services/role-assignment-policy.service';
import prisma from '../config/database';

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
    const token = bearerToken;

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
    const currentUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        username: true,
        role: true,
        segment: true,
        isActive: true,
        updatedAt: true,
      },
    });

    if (!currentUser?.isActive) {
      return res.status(401).json({
        success: false,
        message: '账号已停用或不存在，请联系管理员',
      });
    }

    if (!(await roleExistsAndActive(currentUser.role))) {
      return res.status(403).json({
        success: false,
        message: '账号角色已停用，请联系管理员重新分配权限',
      });
    }

    const issuedAtMs = payload.authAt || (payload.iat ? payload.iat * 1000 : 0);
    const userChangedAtMs = currentUser.updatedAt.getTime();
    if (!issuedAtMs || issuedAtMs < userChangedAtMs) {
      return res.status(401).json({
        success: false,
        message: '账号信息或密码已更新，请重新登录',
      });
    }

    const segment = resolveUserSegment(currentUser.role, currentUser.segment);
    req.user = {
      userId: currentUser.id,
      username: currentUser.username,
      role: currentUser.role,
      segment,
      dataScopes: await getDataScopesForRole(currentUser.role),
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
