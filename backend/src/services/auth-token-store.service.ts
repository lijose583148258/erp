import crypto from 'crypto';
import type Redis from 'ioredis';
import { createRedisClient, ensureRedisConnected, isRedisConfigured } from '../infrastructure/redis-runtime';
import { logger } from '../utils/logger';

export type RefreshTokenRecord = {
  userId: number;
  generation: number;
  issuedAt: Date;
  expiresAt: Date;
};

export type CreatedRefreshToken = {
  refreshToken: string;
  expiresAt: Date;
};

export interface AuthTokenStore {
  issueRefreshToken(userId: number, expectedGeneration?: number): Promise<CreatedRefreshToken | null>;
  consumeRefreshToken(refreshToken: string): Promise<RefreshTokenRecord | null>;
  deleteRefreshToken(refreshToken: string): Promise<void>;
  revokeRefreshTokensForUser(userId: number): Promise<number | null>;
  blacklistAccessToken(token: string): Promise<void>;
  isAccessTokenBlacklisted(token: string): Promise<boolean>;
  status(): { driver: 'memory' | 'redis'; ready: boolean; lastError: string | null };
}

export class AuthTokenStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthTokenStoreUnavailableError';
  }
}

const REFRESH_TOKEN_TTL_MS = Number(process.env.REFRESH_TOKEN_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const TOKEN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const KEY_PREFIX = String(process.env.AUTH_TOKEN_KEY_PREFIX || 'ailaoda:auth').trim();

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const refreshKey = (hash: string) => `${KEY_PREFIX}:refresh:${hash}`;
const generationKey = (userId: number) => `${KEY_PREFIX}:generation:${userId}`;
const blacklistKey = (hash: string) => `${KEY_PREFIX}:blacklist:${hash}`;

const accessTokenTtlMs = (token: string) => {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp?: number };
    if (payload.exp) return Math.max(1000, payload.exp * 1000 - Date.now());
  } catch {
    // Invalid tokens still receive a bounded blacklist lifetime.
  }
  return REFRESH_TOKEN_TTL_MS;
};

export class MemoryAuthTokenStore implements AuthTokenStore {
  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();
  private readonly generations = new Map<number, number>();
  private readonly blacklist = new Map<string, number>();

  async issueRefreshToken(userId: number, expectedGeneration?: number) {
    const generation = this.generations.get(userId) || 0;
    if (expectedGeneration !== undefined && generation !== expectedGeneration) return null;

    const refreshToken = crypto.randomBytes(48).toString('base64url');
    const issuedAt = new Date();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    this.refreshTokens.set(hashToken(refreshToken), { userId, generation, issuedAt, expiresAt });
    return { refreshToken, expiresAt };
  }

  async consumeRefreshToken(refreshToken: string) {
    const hash = hashToken(refreshToken);
    const record = this.refreshTokens.get(hash) || null;
    this.refreshTokens.delete(hash);
    if (!record || record.expiresAt.getTime() <= Date.now()) return null;
    if ((this.generations.get(record.userId) || 0) !== record.generation) return null;
    return record;
  }

  async deleteRefreshToken(refreshToken: string) {
    this.refreshTokens.delete(hashToken(refreshToken));
  }

  async revokeRefreshTokensForUser(userId: number) {
    this.generations.set(userId, (this.generations.get(userId) || 0) + 1);
    let deleted = 0;
    for (const [hash, record] of this.refreshTokens) {
      if (record.userId !== userId) continue;
      this.refreshTokens.delete(hash);
      deleted += 1;
    }
    return deleted;
  }

  async blacklistAccessToken(token: string) {
    this.blacklist.set(hashToken(token), Date.now() + accessTokenTtlMs(token));
  }

  async isAccessTokenBlacklisted(token: string) {
    const hash = hashToken(token);
    const expiresAt = this.blacklist.get(hash);
    if (!expiresAt) return false;
    if (expiresAt <= Date.now()) {
      this.blacklist.delete(hash);
      return false;
    }
    return true;
  }

  cleanup() {
    const now = Date.now();
    for (const [hash, record] of this.refreshTokens) {
      if (record.expiresAt.getTime() <= now) this.refreshTokens.delete(hash);
    }
    for (const [hash, expiresAt] of this.blacklist) {
      if (expiresAt <= now) this.blacklist.delete(hash);
    }
  }

  status() {
    return { driver: 'memory' as const, ready: true, lastError: null };
  }
}

export class RedisAuthTokenStore implements AuthTokenStore {
  private lastError: string | null = null;

  constructor(private readonly client: Redis) {}

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      await ensureRedisConnected(this.client);
      const result = await operation();
      this.lastError = null;
      return result;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw new AuthTokenStoreUnavailableError(`Distributed auth token store unavailable: ${this.lastError}`);
    }
  }

  async issueRefreshToken(userId: number, expectedGeneration?: number) {
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    const issuedAt = new Date();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    const tokenHash = hashToken(refreshToken);
    const result = await this.run(() => this.client.eval(
      `local current = tonumber(redis.call('GET', KEYS[1]) or '0')
       if ARGV[1] ~= '' and current ~= tonumber(ARGV[1]) then return -1 end
       redis.call('PSETEX', KEYS[2], ARGV[2], cjson.encode({userId=tonumber(ARGV[3]), generation=current, issuedAt=ARGV[4], expiresAt=ARGV[5]}))
       return current`,
      2,
      generationKey(userId),
      refreshKey(tokenHash),
      expectedGeneration === undefined ? '' : String(expectedGeneration),
      String(REFRESH_TOKEN_TTL_MS),
      String(userId),
      issuedAt.toISOString(),
      expiresAt.toISOString(),
    ));
    if (Number(result) < 0) return null;
    return { refreshToken, expiresAt };
  }

  async consumeRefreshToken(refreshToken: string) {
    const key = refreshKey(hashToken(refreshToken));
    const raw = await this.run(() => this.client.eval(
      `local value = redis.call('GET', KEYS[1])
       if value then redis.call('DEL', KEYS[1]) end
       return value`,
      1,
      key,
    ));
    if (typeof raw !== 'string') return null;

    const parsed = JSON.parse(raw) as { userId: number; generation: number; issuedAt: string; expiresAt: string };
    const currentGeneration = Number(await this.run(() => this.client.get(generationKey(parsed.userId))) || 0);
    const record = { ...parsed, issuedAt: new Date(parsed.issuedAt), expiresAt: new Date(parsed.expiresAt) };
    if (record.expiresAt.getTime() <= Date.now() || currentGeneration !== record.generation) return null;
    return record;
  }

  async deleteRefreshToken(refreshToken: string) {
    await this.run(() => this.client.del(refreshKey(hashToken(refreshToken))).then(() => undefined));
  }

  async revokeRefreshTokensForUser(userId: number) {
    await this.run(() => this.client.incr(generationKey(userId)));
    return null;
  }

  async blacklistAccessToken(token: string) {
    await this.run(() => this.client.psetex(blacklistKey(hashToken(token)), accessTokenTtlMs(token), '1').then(() => undefined));
  }

  async isAccessTokenBlacklisted(token: string) {
    return this.run(async () => Boolean(await this.client.exists(blacklistKey(hashToken(token)))));
  }

  status() {
    return {
      driver: 'redis' as const,
      ready: this.client.status === 'ready',
      lastError: this.lastError,
    };
  }
}

const resolveDriver = () => {
  const configured = String(process.env.AUTH_TOKEN_STORE_DRIVER || '').trim().toLowerCase();
  if (configured === 'memory' || configured === 'redis') return configured;
  return isRedisConfigured() ? 'redis' : 'memory';
};

const driver = resolveDriver();
if (process.env.NODE_ENV === 'production' && process.env.AILAODA_DEPLOYMENT_MODE === 'saas' && driver !== 'redis') {
  throw new Error('SaaS deployment requires AUTH_TOKEN_STORE_DRIVER=redis and a direct or Sentinel Redis configuration.');
}

const redisClient = driver === 'redis' ? createRedisClient('auth-token-store') : null;
if (driver === 'redis' && !redisClient) {
  throw new Error('AUTH_TOKEN_STORE_DRIVER=redis requires a direct or Sentinel Redis configuration.');
}

export const authTokenStore: AuthTokenStore = redisClient
  ? new RedisAuthTokenStore(redisClient)
  : new MemoryAuthTokenStore();

const cleanupTimer = setInterval(() => {
  if (authTokenStore instanceof MemoryAuthTokenStore) authTokenStore.cleanup();
}, TOKEN_CLEANUP_INTERVAL_MS);
cleanupTimer.unref?.();

export const createRefreshToken = (userId: number, expectedGeneration?: number) =>
  authTokenStore.issueRefreshToken(userId, expectedGeneration);
export const consumeRefreshToken = (refreshToken: string) => authTokenStore.consumeRefreshToken(refreshToken);
export const deleteRefreshToken = (refreshToken: string) => authTokenStore.deleteRefreshToken(refreshToken);
export const deleteRefreshTokensForUser = (userId: number) => authTokenStore.revokeRefreshTokensForUser(userId);
export const blacklistAccessToken = (token: string) => authTokenStore.blacklistAccessToken(token);
export const isTokenBlacklisted = (token: string) => authTokenStore.isAccessTokenBlacklisted(token);
export const getAuthTokenStoreStatus = () => authTokenStore.status();

logger.info(`[AuthTokenStore] initialized with ${driver} driver`);
