import { Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../config/database';
import { generateToken, verifyToken } from '../utils/jwt';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { LoginRequest, RegisterRequest, LoginResponse, ApiResponse } from '../types/api.types';
import { getPermissionsForRole, roleExistsAndActive } from '../services/authorization-policy.service';

// Token 黑名单 (生产环境建议使用 Redis)
const tokenBlacklist = new Set<string>();

// 刷新Token存储 (生产环境建议使用 Redis)
const refreshTokenStore = new Map<string, { userId: number; expiresAt: Date }>();

// L5修复：定时清理过期 Token，防止内存无限增长
const TOKEN_CLEANUP_INTERVAL = 60 * 60 * 1000; // 每小时清理一次
setInterval(() => {
    const now = new Date();
    // 清理过期的 refreshToken
    let refreshCleaned = 0;
    for (const [token, data] of refreshTokenStore.entries()) {
        if (data.expiresAt < now) {
            refreshTokenStore.delete(token);
            refreshCleaned++;
        }
    }
    // 清理黑名单中已过期的 JWT（JWT 过期后自然无效，无需继续保留）
    let blacklistCleaned = 0;
    for (const token of tokenBlacklist) {
        try {
            // 解码 JWT payload 检查过期时间（不验证签名，仅用于清理）
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            if (payload.exp && payload.exp * 1000 < now.getTime()) {
                tokenBlacklist.delete(token);
                blacklistCleaned++;
            }
        } catch {
            // 解析失败的 token 也清理掉
            tokenBlacklist.delete(token);
            blacklistCleaned++;
        }
    }
    if (refreshCleaned > 0 || blacklistCleaned > 0) {
        logger.info(`Token 清理完成: 黑名单清理 ${blacklistCleaned} 条, RefreshToken 清理 ${refreshCleaned} 条. 剩余: 黑名单 ${tokenBlacklist.size}, RefreshToken ${refreshTokenStore.size}`);
    }
}, TOKEN_CLEANUP_INTERVAL);

type UserSegment = 'direct' | 'channel' | 'mixed';

function resolveUserSegment(role: string, segment?: string | null): UserSegment {
    if (segment === 'direct' || segment === 'channel' || segment === 'mixed') {
        return segment;
    }

    if (role === 'sales') {
        return 'direct';
    }

    return 'mixed';
}

export class AuthController {
    /**
     * 用户登录
     */
    async login(req: AuthRequest, res: Response) {
        try {
            const { username, password } = req.body as LoginRequest;

            // 查找用户
            const user = await prisma.user.findUnique({
                where: { username },
                select: {
                    id: true,
                    username: true,
                    passwordHash: true,
                    email: true,
                    role: true,
                    segment: true,
                    avatar: true,
                    isActive: true,
                },
            });

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: '用户名或密码错误',
                } as ApiResponse);
            }

            if (!(await roleExistsAndActive(user.role))) {
                return res.status(403).json({
                    success: false,
                    message: '角色不存在或已禁用，请联系管理员',
                } as ApiResponse);
            }
            const permissions = await getPermissionsForRole(user.role);

            // 检查账户是否激活
            if (!user.isActive) {
                return res.status(403).json({
                    success: false,
                    message: '账户已被禁用，请联系管理员',
                } as ApiResponse);
            }

            // 验证密码
            const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
            if (!isPasswordValid) {
                logger.warn(`登录失败: 用户 ${username} 密码错误`);
                return res.status(401).json({
                    success: false,
                    message: '用户名或密码错误',
                } as ApiResponse);
            }

            // 生成 Token
            const token = generateToken({
                userId: user.id,
                username: user.username,
                role: user.role,
                segment: resolveUserSegment(user.role, user.segment),
            });

            // 生成刷新 Token
            const refreshToken = generateRefreshToken();
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7天
            refreshTokenStore.set(refreshToken, { userId: user.id, expiresAt });

            // 更新最后登录时间失败时不阻断登录，避免 SQLite 写入异常影响主流程
            try {
                await prisma.user.update({
                    where: { id: user.id },
                    data: { lastLoginAt: new Date() },
                });
            } catch (error) {
                logger.warn(`更新最后登录时间失败: 用户 ${username}`, error);
            }

            // 记录审计日志失败时也不阻断登录
            try {
                await prisma.auditLog.create({
                    data: {
                        userId: user.id,
                        action: 'LOGIN',
                        resource: 'auth',
                        details: `用户 ${username} 登录成功`,
                        ipAddress: req.ip,
                        userAgent: req.get('user-agent'),
                    },
                });
            } catch (error) {
                logger.warn(`登录审计记录失败: 用户 ${username}`, error);
            }

            logger.info(`用户 ${username} 登录成功`);

            const response: ApiResponse<LoginResponse> = {
                success: true,
                data: {
                    token,
                    refreshToken,
                    user: {
                        id: user.id,
                        username: user.username,
                        email: user.email,
                        role: user.role,
                        segment: resolveUserSegment(user.role, user.segment),
                        avatar: user.avatar,
                        permissions,
                    },
                    expiresIn: 7 * 24 * 60 * 60, // 7天（秒）
                },
                message: '登录成功',
                timestamp: new Date().toISOString(),
            };

            return res.json(response);
        } catch (error) {
            logger.error('登录错误:', error);
            return res.status(500).json({
                success: false,
                message: '服务器内部错误',
            } as ApiResponse);
        }
    }

    /**
     * 用户注册
     */
    async register(req: AuthRequest, res: Response) {
        try {
            const { username, password, email, role = 'sales', segment } = req.body as RegisterRequest;
            if (!(await roleExistsAndActive(role))) {
                return res.status(400).json({
                    success: false,
                    message: '角色不存在或已禁用',
                } as ApiResponse);
            }
            const resolvedSegment = resolveUserSegment(role, segment);

            // 检查用户名是否已存在
            const existingUser = await prisma.user.findUnique({
                where: { username },
            });

            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: '用户名已存在',
                } as ApiResponse);
            }

            // 加密密码
            const saltRounds = 12;
            const passwordHash = await bcrypt.hash(password, saltRounds);

            // 创建用户
            const newUser = await prisma.user.create({
                data: {
                    username,
                    passwordHash,
                    email: email || null,
                    role,
                    segment: resolvedSegment,
                    isActive: true,
                },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    role: true,
                    segment: true,
                    createdAt: true,
                },
            });

            // 记录审计日志
            await prisma.auditLog.create({
                data: {
                    userId: newUser.id,
                    action: 'REGISTER',
                    resource: 'auth',
                    details: `新用户 ${username} 注册成功`,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                },
            });

            logger.info(`新用户注册: ${username}`);

            return res.status(201).json({
                success: true,
                data: newUser,
                message: '注册成功',
            } as ApiResponse);
        } catch (error) {
            logger.error('注册错误:', error);
            return res.status(500).json({
                success: false,
                message: '服务器内部错误',
            } as ApiResponse);
        }
    }

    /**
     * 刷新 Token
     */
    async refreshToken(req: AuthRequest, res: Response) {
        try {
            const { refreshToken } = req.body;

            if (!refreshToken) {
                return res.status(400).json({
                    success: false,
                    message: '请提供刷新令牌',
                } as ApiResponse);
            }

            // 验证刷新 Token
            const tokenData = refreshTokenStore.get(refreshToken);
            if (!tokenData || tokenData.expiresAt < new Date()) {
                refreshTokenStore.delete(refreshToken);
                return res.status(401).json({
                    success: false,
                    message: '刷新令牌无效或已过期',
                } as ApiResponse);
            }

            // 获取用户信息
            const user = await prisma.user.findUnique({
                where: { id: tokenData.userId },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    role: true,
                    segment: true,
                    avatar: true,
                    isActive: true,
                },
            });

            if (!user || !user.isActive) {
                return res.status(401).json({
                    success: false,
                    message: '用户不存在或已被禁用',
                } as ApiResponse);
            }

            if (!(await roleExistsAndActive(user.role))) {
                return res.status(403).json({
                    success: false,
                    message: '角色不存在或已禁用，请联系管理员',
                } as ApiResponse);
            }

            // 生成新 Token
            const newToken = generateToken({
                userId: user.id,
                username: user.username,
                role: user.role,
                segment: resolveUserSegment(user.role, user.segment),
            });

            // 生成新的刷新 Token
            const newRefreshToken = generateRefreshToken();
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            refreshTokenStore.set(newRefreshToken, { userId: user.id, expiresAt });
            refreshTokenStore.delete(refreshToken); // 删除旧的

            return res.json({
                success: true,
                data: {
                    token: newToken,
                    refreshToken: newRefreshToken,
                    expiresIn: 7 * 24 * 60 * 60,
                },
                message: 'Token 刷新成功',
            } as ApiResponse);
        } catch (error) {
            logger.error('刷新Token错误:', error);
            return res.status(500).json({
                success: false,
                message: '服务器内部错误',
            } as ApiResponse);
        }
    }

    /**
     * 获取当前用户信息
     */
    async getCurrentUser(req: AuthRequest, res: Response) {
        try {
            if (!req.user) {
                return res.status(401).json({
                    success: false,
                    message: '未认证',
                } as ApiResponse);
            }

            const user = await prisma.user.findUnique({
                where: { id: req.user.userId },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    role: true,
                    segment: true,
                    avatar: true,
                    isActive: true,
                    lastLoginAt: true,
                    createdAt: true,
                },
            });

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: '用户不存在',
                } as ApiResponse);
            }

            if (!(await roleExistsAndActive(user.role))) {
                return res.status(403).json({
                    success: false,
                    message: '角色不存在或已禁用，请联系管理员',
                } as ApiResponse);
            }

            return res.json({
                success: true,
                data: {
                    ...user,
                    permissions: await getPermissionsForRole(user.role),
                },
            } as ApiResponse);
        } catch (error) {
            logger.error('获取用户信息错误:', error);
            return res.status(500).json({
                success: false,
                message: '服务器内部错误',
            } as ApiResponse);
        }
    }

    /**
     * 用户登出
     */
    async logout(req: AuthRequest, res: Response) {
        try {
            // 从请求头获取 token
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.substring(7);
                tokenBlacklist.add(token);
            }

            // 记录审计日志
            if (req.user) {
                await prisma.auditLog.create({
                    data: {
                        userId: req.user.userId,
                        action: 'LOGOUT',
                        resource: 'auth',
                        details: `用户 ${req.user.username} 登出`,
                        ipAddress: req.ip,
                        userAgent: req.get('user-agent'),
                    },
                });
            }

            return res.json({
                success: true,
                message: '登出成功',
            } as ApiResponse);
        } catch (error) {
            logger.error('登出错误:', error);
            return res.status(500).json({
                success: false,
                message: '服务器内部错误',
            } as ApiResponse);
        }
    }

    /**
     * 修改密码
     */
    async changePassword(req: AuthRequest, res: Response) {
        try {
            if (!req.user) {
                return res.status(401).json({
                    success: false,
                    message: '未认证',
                } as ApiResponse);
            }

            const { oldPassword, newPassword } = req.body;

            // 获取用户
            const user = await prisma.user.findUnique({
                where: { id: req.user.userId },
            });

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: '用户不存在',
                } as ApiResponse);
            }

            // 验证旧密码
            const isOldPasswordValid = await bcrypt.compare(oldPassword, user.passwordHash);
            if (!isOldPasswordValid) {
                return res.status(400).json({
                    success: false,
                    message: '原密码错误',
                } as ApiResponse);
            }

            // 加密新密码
            const saltRounds = 12;
            const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

            // 更新密码
            await prisma.user.update({
                where: { id: req.user.userId },
                data: { passwordHash: newPasswordHash },
            });

            // 记录审计日志
            await prisma.auditLog.create({
                data: {
                    userId: req.user.userId,
                    action: 'CHANGE_PASSWORD',
                    resource: 'auth',
                    details: '用户修改了密码',
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                },
            });

            logger.info(`用户 ${req.user.username} 修改了密码`);

            return res.json({
                success: true,
                message: '密码修改成功',
            } as ApiResponse);
        } catch (error) {
            logger.error('修改密码错误:', error);
            return res.status(500).json({
                success: false,
                message: '服务器内部错误',
            } as ApiResponse);
        }
    }
}

// 生成刷新 Token（使用加密安全随机数）
function generateRefreshToken(): string {
    return crypto.randomBytes(48).toString('base64url');
}

// 检查 Token 是否在黑名单中
export function isTokenBlacklisted(token: string): boolean {
    return tokenBlacklist.has(token);
}
