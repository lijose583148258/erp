import Redis from 'ioredis';
import { loadRuntimeEnv } from '../config/runtime';
import { logger } from '../utils/logger';

loadRuntimeEnv();

export type CacheProvider = 'disabled' | 'ioredis';
export type CacheFailureMode = 'bypass';
export type CacheStrategyId =
  | 'dashboard-summary'
  | 'permission-registry'
  | 'reference-data'
  | 'read-model';

export type CacheStrategy = {
  id: CacheStrategyId;
  owner: string;
  keyPrefix: string;
  ttlSeconds: number;
  invalidatesOn: string[];
  failureMode: CacheFailureMode;
};

export const CACHE_STRATEGIES: Record<CacheStrategyId, CacheStrategy> = {
  'dashboard-summary': {
    id: 'dashboard-summary',
    owner: 'reporting',
    keyPrefix: 'dashboard',
    ttlSeconds: 60,
    invalidatesOn: ['order write', 'collection write', 'stock movement', 'production completion'],
    failureMode: 'bypass',
  },
  'permission-registry': {
    id: 'permission-registry',
    owner: 'identity-access',
    keyPrefix: 'permissions',
    ttlSeconds: 300,
    invalidatesOn: ['role change', 'permission assignment', 'user status change'],
    failureMode: 'bypass',
  },
  'reference-data': {
    id: 'reference-data',
    owner: 'master-data',
    keyPrefix: 'reference',
    ttlSeconds: 300,
    invalidatesOn: ['customer update', 'supplier update', 'warehouse update', 'product update'],
    failureMode: 'bypass',
  },
  'read-model': {
    id: 'read-model',
    owner: 'operations',
    keyPrefix: 'read-model',
    ttlSeconds: 120,
    invalidatesOn: ['module-owned write event'],
    failureMode: 'bypass',
  },
};

export interface AppCache {
  readonly provider: CacheProvider;
  buildKey(strategyId: CacheStrategyId, parts: readonly string[]): string;
  getJson<T>(strategyId: CacheStrategyId, parts: readonly string[]): Promise<T | null>;
  setJson<T>(
    strategyId: CacheStrategyId,
    parts: readonly string[],
    value: T,
    ttlSeconds?: number,
  ): Promise<void>;
  deleteKey(strategyId: CacheStrategyId, parts: readonly string[]): Promise<void>;
}

const CACHE_KEY_VERSION = 'v1';

const isTruthy = (value?: string) =>
  ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const isDisabled = (value?: string) =>
  ['0', 'false', 'no', 'off'].includes(String(value || '').trim().toLowerCase());

const normalizeKeyPart = (part: string) => {
  const normalized = String(part || '').trim();
  if (!normalized) throw new Error('INVALID_CACHE_KEY_PART');
  return normalized.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 128);
};

const buildCacheKey = (strategyId: CacheStrategyId, parts: readonly string[]) => {
  const strategy = CACHE_STRATEGIES[strategyId];
  if (!strategy) throw new Error('UNKNOWN_CACHE_STRATEGY');
  if (!parts.length) throw new Error('CACHE_KEY_REQUIRES_PARTS');
  return ['ailaoda', CACHE_KEY_VERSION, strategy.keyPrefix, ...parts.map(normalizeKeyPart)].join(':');
};

export class DisabledCache implements AppCache {
  readonly provider = 'disabled' as const;

  buildKey(strategyId: CacheStrategyId, parts: readonly string[]) {
    return buildCacheKey(strategyId, parts);
  }

  async getJson<T>(_strategyId: CacheStrategyId, _parts: readonly string[]): Promise<T | null> {
    return null;
  }

  async setJson<T>(
    _strategyId: CacheStrategyId,
    _parts: readonly string[],
    _value: T,
    _ttlSeconds?: number,
  ): Promise<void> {}

  async deleteKey(_strategyId: CacheStrategyId, _parts: readonly string[]): Promise<void> {}
}

export class RedisAppCache implements AppCache {
  readonly provider = 'ioredis' as const;
  private readonly client: Redis;
  private connectPromise: Promise<void> | null = null;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.client.on('error', (error) => {
      logger.warn(`Cache Redis error: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  buildKey(strategyId: CacheStrategyId, parts: readonly string[]) {
    return buildCacheKey(strategyId, parts);
  }

  private isReady() {
    return String(this.client.status) === 'ready';
  }

  private async getReadyClient() {
    if (this.isReady()) return this.client;
    if (!this.connectPromise) {
      this.connectPromise = this.client.connect().catch((error) => {
        logger.warn(`Cache Redis connect failed, bypassing cache: ${error instanceof Error ? error.message : String(error)}`);
      }).then(() => undefined).finally(() => {
        this.connectPromise = null;
      });
    }
    await this.connectPromise;
    return this.isReady() ? this.client : null;
  }

  async getJson<T>(strategyId: CacheStrategyId, parts: readonly string[]): Promise<T | null> {
    const client = await this.getReadyClient();
    if (!client) return null;
    try {
      const value = await client.get(this.buildKey(strategyId, parts));
      return value ? JSON.parse(value) as T : null;
    } catch (error) {
      logger.warn(`Cache read failed, bypassing cache: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async setJson<T>(
    strategyId: CacheStrategyId,
    parts: readonly string[],
    value: T,
    ttlSeconds?: number,
  ): Promise<void> {
    const client = await this.getReadyClient();
    if (!client) return;
    const strategy = CACHE_STRATEGIES[strategyId];
    try {
      await client.set(
        this.buildKey(strategyId, parts),
        JSON.stringify(value),
        'EX',
        ttlSeconds || strategy.ttlSeconds,
      );
    } catch (error) {
      logger.warn(`Cache write failed, bypassing cache: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async deleteKey(strategyId: CacheStrategyId, parts: readonly string[]): Promise<void> {
    const client = await this.getReadyClient();
    if (!client) return;
    try {
      await client.del(this.buildKey(strategyId, parts));
    } catch (error) {
      logger.warn(`Cache delete failed, bypassing cache: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export const createAppCache = (): AppCache => {
  const redisUrl = process.env.CACHE_REDIS_URL || process.env.REDIS_URL || '';
  const cacheFlag = process.env.CACHE_ENABLED;
  if (!redisUrl || isDisabled(cacheFlag)) return new DisabledCache();
  if (isTruthy(cacheFlag) || redisUrl) return new RedisAppCache(redisUrl);
  return new DisabledCache();
};

export const appCache: AppCache = createAppCache();
