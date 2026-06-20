import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

const isProduction = process.env.NODE_ENV === 'production';
const configuredJwtSecret = process.env.JWT_SECRET?.trim();
const JWT_SECRET = configuredJwtSecret || crypto.randomBytes(48).toString('base64url');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const isWeakProductionSecret = (secret: string | undefined) => {
  if (!secret) return true;
  const normalized = secret.toLowerCase();
  return secret.length < 32
    || normalized.includes('replace_with')
    || normalized.includes('your-secret')
    || normalized.includes('changeme')
    || normalized.includes('default');
};

if (isProduction && isWeakProductionSecret(configuredJwtSecret)) {
  throw new Error('JWT_SECRET must be a non-placeholder value of at least 32 characters in production');
}

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
  segment?: 'direct' | 'channel' | 'mixed';
  authAt?: number;
  iat?: number;
  exp?: number;
}

/**
 * 生成JWT token
 */
export const generateToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as any,
  });
};

/**
 * 验证JWT token
 */
export const verifyToken = (token: string): JwtPayload => {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch (error) {
    throw new Error('Invalid token');
  }
};

/**
 * 解码JWT token（不验证）
 */
export const decodeToken = (token: string): JwtPayload | null => {
  try {
    return jwt.decode(token) as JwtPayload;
  } catch (error) {
    return null;
  }
};
