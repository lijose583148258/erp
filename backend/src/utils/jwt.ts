import * as jwt from 'jsonwebtoken';
import { getJwtSecret, getJwtSecretStatus } from '../security/secretManagement';

const JWT_SECRET = getJwtSecret();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
export const jwtSecretStatus = getJwtSecretStatus();

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
