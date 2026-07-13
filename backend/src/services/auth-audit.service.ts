import prisma from '../config/database';
import { logger } from '../utils/logger';

type AuthAuditInput = {
  userId: number;
  action: 'LOGIN' | 'LOGIN_MFA_BLOCKED' | 'REGISTER' | 'LOGOUT' | 'CHANGE_PASSWORD';
  details: string;
  ipAddress?: string;
  userAgent?: string;
};

export async function writeAuthAuditLog(input: AuthAuditInput) {
  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      resource: 'auth',
      details: input.details,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
  });
}

export async function tryWriteAuthAuditLog(input: AuthAuditInput, warningMessage: string) {
  try {
    await writeAuthAuditLog(input);
  } catch (error) {
    logger.warn(warningMessage, error);
  }
}
