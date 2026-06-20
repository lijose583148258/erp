import { Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/database';
import { generateToken } from '../utils/jwt';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { LoginRequest, RegisterRequest, LoginResponse, ApiResponse } from '../types/api.types';
import { getDataScopesForRole, getPermissionsForRole, roleExistsAndActive } from '../services/authorization-policy.service';
import { canAssignPrivilegedRoles, isRoleAssignmentChange, resolveUserSegment } from '../services/role-assignment-policy.service';
import {
    blacklistAccessToken,
    createRefreshToken,
    deleteRefreshToken,
    getValidRefreshToken,
} from '../services/auth-token-store.service';
import { tryWriteAuthAuditLog, writeAuthAuditLog } from '../services/auth-audit.service';
import { AuthPasswordError, changeOwnPassword } from '../services/auth-password.service';
import { demoUsers } from '../database/seed-fixtures';

const serverError = { success: false, message: '服务器内部错误' } as ApiResponse;
const truthy = (value?: string) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
const blockedDemoCredentials: Map<string, string> = new Map(demoUsers.map(user => [user.username, user.password]));

const isReleaseDemoCredential = (username: string, password: string) =>
    truthy(process.env.AILAODA_BLOCK_DEMO_CREDENTIALS)
    && blockedDemoCredentials.get(username) === password;

export class AuthController {
    async login(req: AuthRequest, res: Response) {
        try {
            const { username, password } = req.body as LoginRequest;
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
                    mustChangePassword: true,
                },
            });

            if (user && !user.isActive) {
                return res.status(403).json({ success: false, message: '账号已停用，请联系管理员' } as ApiResponse);
            }
            if (!user) {
                return res.status(401).json({ success: false, message: '用户名或密码错误' } as ApiResponse);
            }
            if (!user.isActive) {
                return res.status(403).json({ success: false, message: '账号已被停用，请联系管理员' } as ApiResponse);
            }
            if (!(await roleExistsAndActive(user.role))) {
                return res.status(403).json({ success: false, message: '角色不存在或已禁用，请联系管理员' } as ApiResponse);
            }

            const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
            if (!isPasswordValid) {
                logger.warn(`登录失败: 用户 ${username} 密码错误`);
                return res.status(401).json({ success: false, message: '用户名或密码错误' } as ApiResponse);
            }

            if (isReleaseDemoCredential(username, password) && !user.mustChangePassword) {
                logger.warn(`Release safety mode rejected default demo credential after password verification: ${username}`);
                return res.status(403).json({
                    success: false,
                    message: '发布安全模式已禁止默认演示账号直接登录，请使用已改密的正式账号',
                } as ApiResponse);
            }

            const segment = resolveUserSegment(user.role, user.segment);
            const [permissions, dataScopes] = await Promise.all([
                getPermissionsForRole(user.role),
                getDataScopesForRole(user.role),
            ]);

            try {
                await prisma.$executeRawUnsafe('UPDATE users SET last_login_at = ? WHERE id = ?', new Date().toISOString(), user.id);
            } catch (error) {
                logger.warn(`更新最后登录时间失败: 用户 ${username}`, error);
            }

            const token = generateToken({
                userId: user.id,
                username: user.username,
                role: user.role,
                segment,
                authAt: Date.now(),
            });
            const { refreshToken } = createRefreshToken(user.id);

            await tryWriteAuthAuditLog({
                userId: user.id,
                action: 'LOGIN',
                details: `用户 ${username} 登录成功`,
                ipAddress: req.ip,
                userAgent: req.get('user-agent'),
            }, `登录审计记录失败: 用户 ${username}`);

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
                        segment,
                        avatar: user.avatar,
                        mustChangePassword: user.mustChangePassword,
                        permissions,
                        dataScopes,
                    },
                    expiresIn: 7 * 24 * 60 * 60,
                },
                message: '登录成功',
                timestamp: new Date().toISOString(),
            };

            return res.json(response);
        } catch (error) {
            logger.error('登录错误:', error);
            return res.status(500).json(serverError);
        }
    }

    async register(req: AuthRequest, res: Response) {
        try {
            const { username, password, email, role = 'sales', segment } = req.body as RegisterRequest;
            if (!(await roleExistsAndActive(role))) {
                return res.status(400).json({ success: false, message: '角色不存在或已禁用' } as ApiResponse);
            }
            if (isRoleAssignmentChange(role) && !(await canAssignPrivilegedRoles(req))) {
                return res.status(403).json({
                    success: false,
                    message: '分配或变更敏感角色需要超级管理员授权',
                    errorCode: 'AUTHORIZATION_ROLES_MANAGE_REQUIRED',
                    requiredPermissions: ['authorization.roles.manage'],
                    timestamp: new Date().toISOString(),
                });
            }

            const existingUser = await prisma.user.findUnique({ where: { username } });
            if (existingUser) {
                return res.status(400).json({ success: false, message: '用户名已存在' } as ApiResponse);
            }

            const passwordHash = await bcrypt.hash(password, 12);
            const newUser = await prisma.user.create({
                data: {
                    username,
                    passwordHash,
                    email: email || null,
                    role,
                    segment: resolveUserSegment(role, segment),
                    isActive: true,
                    mustChangePassword: true,
                },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    role: true,
                    segment: true,
                    mustChangePassword: true,
                    createdAt: true,
                },
            });

            await writeAuthAuditLog({
                userId: newUser.id,
                action: 'REGISTER',
                details: `新用户 ${username} 注册成功`,
                ipAddress: req.ip,
                userAgent: req.get('user-agent'),
            });

            return res.status(201).json({
                success: true,
                data: newUser,
                message: '账号创建成功',
            } as ApiResponse);
        } catch (error) {
            logger.error('注册错误:', error);
            return res.status(500).json(serverError);
        }
    }

    async refreshToken(req: AuthRequest, res: Response) {
        try {
            const { refreshToken } = req.body;
            if (!refreshToken) {
                return res.status(400).json({ success: false, message: '请提供刷新令牌' } as ApiResponse);
            }

            const tokenData = getValidRefreshToken(refreshToken);
            if (!tokenData) {
                return res.status(401).json({ success: false, message: '刷新令牌无效或已过期' } as ApiResponse);
            }

            const user = await prisma.user.findUnique({
                where: { id: tokenData.userId },
                select: {
                    id: true,
                    username: true,
                    role: true,
                    segment: true,
                    isActive: true,
                },
            });

            if (!user || !user.isActive) {
                return res.status(401).json({ success: false, message: '用户不存在或已被停用' } as ApiResponse);
            }
            if (!(await roleExistsAndActive(user.role))) {
                return res.status(403).json({ success: false, message: '角色不存在或已禁用，请联系管理员' } as ApiResponse);
            }

            const newToken = generateToken({
                userId: user.id,
                username: user.username,
                role: user.role,
                segment: resolveUserSegment(user.role, user.segment),
                authAt: Date.now(),
            });
            const { refreshToken: newRefreshToken } = createRefreshToken(user.id);
            deleteRefreshToken(refreshToken);

            return res.json({
                success: true,
                data: {
                    token: newToken,
                    refreshToken: newRefreshToken,
                    expiresIn: 7 * 24 * 60 * 60,
                },
                message: '令牌刷新成功',
            } as ApiResponse);
        } catch (error) {
            logger.error('刷新 Token 错误:', error);
            return res.status(500).json(serverError);
        }
    }

    async getCurrentUser(req: AuthRequest, res: Response) {
        try {
            if (!req.user) {
                return res.status(401).json({ success: false, message: '未认证' } as ApiResponse);
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
                    mustChangePassword: true,
                    lastLoginAt: true,
                    createdAt: true,
                },
            });

            if (!user) {
                return res.status(404).json({ success: false, message: '用户不存在' } as ApiResponse);
            }
            if (!(await roleExistsAndActive(user.role))) {
                return res.status(403).json({ success: false, message: '角色不存在或已禁用，请联系管理员' } as ApiResponse);
            }

            return res.json({
                success: true,
                data: {
                    ...user,
                    permissions: await getPermissionsForRole(user.role),
                    dataScopes: await getDataScopesForRole(user.role),
                },
            } as ApiResponse);
        } catch (error) {
            logger.error('获取当前用户信息错误:', error);
            return res.status(500).json(serverError);
        }
    }

    async logout(req: AuthRequest, res: Response) {
        try {
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                blacklistAccessToken(authHeader.substring(7));
            }
            const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '';
            if (refreshToken) {
                deleteRefreshToken(refreshToken);
            }

            if (req.user) {
                await writeAuthAuditLog({
                    userId: req.user.userId,
                    action: 'LOGOUT',
                    details: `用户 ${req.user.username} 登出`,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                });
            }

            return res.json({ success: true, message: '登出成功' } as ApiResponse);
        } catch (error) {
            logger.error('登出错误:', error);
            return res.status(500).json(serverError);
        }
    }

    async changePassword(req: AuthRequest, res: Response) {
        try {
            if (!req.user) {
                return res.status(401).json({ success: false, message: '未认证' } as ApiResponse);
            }

            await changeOwnPassword({
                userId: req.user.userId,
                username: req.user.username,
                oldPassword: req.body.oldPassword,
                newPassword: req.body.newPassword,
                ipAddress: req.ip,
                userAgent: req.get('user-agent'),
            });

            return res.json({ success: true, message: '密码修改成功' } as ApiResponse);
        } catch (error) {
            if (error instanceof AuthPasswordError) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message,
                } as ApiResponse);
            }
            logger.error('修改密码错误:', error);
            return res.status(500).json(serverError);
        }
    }
}
