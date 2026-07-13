import bcrypt from 'bcryptjs';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { writeAuthAuditLog } from './auth-audit.service';
import { deleteRefreshTokensForUser } from './auth-token-store.service';

export class AuthPasswordError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthPasswordError';
  }
}

type ChangePasswordInput = {
  userId: number;
  username: string;
  oldPassword: string;
  newPassword: string;
  ipAddress?: string;
  userAgent?: string;
};

export async function changeOwnPassword(input: ChangePasswordInput) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
  });

  if (!user) {
    throw new AuthPasswordError(404, '用户不存在');
  }

  const isOldPasswordValid = await bcrypt.compare(input.oldPassword, user.passwordHash);
  if (!isOldPasswordValid) {
    throw new AuthPasswordError(400, '原密码错误');
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  await prisma.user.update({
    where: { id: input.userId },
    data: {
      passwordHash,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  });
  const deletedRefreshTokens = await deleteRefreshTokensForUser(input.userId);

  await writeAuthAuditLog({
    userId: input.userId,
    action: 'CHANGE_PASSWORD',
    details: deletedRefreshTokens === null
      ? '用户修改了密码，已递增分布式会话代次并失效全部旧刷新令牌'
      : `用户修改了密码，已失效 ${deletedRefreshTokens} 个刷新令牌`,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  logger.info(`用户 ${input.username} 修改了密码`);
}
