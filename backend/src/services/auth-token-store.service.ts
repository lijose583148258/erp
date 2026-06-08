import crypto from 'crypto';
import { logger } from '../utils/logger';

type RefreshTokenRecord = {
  userId: number;
  expiresAt: Date;
};

const tokenBlacklist = new Set<string>();
const refreshTokenStore = new Map<string, RefreshTokenRecord>();

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export function createRefreshToken(userId: number): { refreshToken: string; expiresAt: Date } {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  refreshTokenStore.set(refreshToken, { userId, expiresAt });
  return { refreshToken, expiresAt };
}

export function getValidRefreshToken(refreshToken: string): RefreshTokenRecord | null {
  const tokenData = refreshTokenStore.get(refreshToken);
  if (!tokenData || tokenData.expiresAt < new Date()) {
    refreshTokenStore.delete(refreshToken);
    return null;
  }
  return tokenData;
}

export function deleteRefreshToken(refreshToken: string) {
  refreshTokenStore.delete(refreshToken);
}

export function deleteRefreshTokensForUser(userId: number): number {
  let deleted = 0;
  for (const [token, data] of refreshTokenStore.entries()) {
    if (data.userId === userId) {
      refreshTokenStore.delete(token);
      deleted++;
    }
  }
  return deleted;
}

export function blacklistAccessToken(token: string) {
  tokenBlacklist.add(token);
}

export function isTokenBlacklisted(token: string): boolean {
  return tokenBlacklist.has(token);
}

setInterval(() => {
  const now = new Date();
  let refreshCleaned = 0;
  for (const [token, data] of refreshTokenStore.entries()) {
    if (data.expiresAt < now) {
      refreshTokenStore.delete(token);
      refreshCleaned++;
    }
  }

  let blacklistCleaned = 0;
  for (const token of tokenBlacklist) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      if (payload.exp && payload.exp * 1000 < now.getTime()) {
        tokenBlacklist.delete(token);
        blacklistCleaned++;
      }
    } catch {
      tokenBlacklist.delete(token);
      blacklistCleaned++;
    }
  }

  if (refreshCleaned > 0 || blacklistCleaned > 0) {
    logger.info(`Token cleanup complete: blacklist ${blacklistCleaned}, refresh tokens ${refreshCleaned}. Remaining blacklist ${tokenBlacklist.size}, refresh tokens ${refreshTokenStore.size}`);
  }
}, TOKEN_CLEANUP_INTERVAL_MS);
