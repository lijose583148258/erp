import Redis from 'ioredis';
import { logger } from '../utils/logger';
import { recordCacheMetric } from '../middleware/metricsMiddleware';
import { createRedisClient, isRedisConfigured } from '../infrastructure/redis-runtime';

type CacheStatus = {
  driver: 'memory' | 'redis';
  fallback: 'memory';
  redisConfigured: boolean;
  redisReady: boolean;
  lastError: string | null;
};

type CacheEntry = {
  value: string;
  expiresAt: number;
};

class MemoryCacheProvider {
  private readonly entries = new Map<string, CacheEntry>();

  async get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number) {
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }
}

class RedisCacheProvider {
  private readonly client: Redis;
  private lastError: string | null = null;
  private connecting: Promise<void> | null = null;

  constructor(client: Redis) {
    this.client = client;
    this.client.on('error', (error) => {
      this.lastError = error.message;
      logger.warn('[CacheService] Redis error; falling back to memory cache', error);
    });
  }

  async get(key: string) {
    await this.ensureConnected();
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number) {
    await this.ensureConnected();
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string) {
    await this.ensureConnected();
    await this.client.del(key);
  }

  status() {
    return {
      ready: this.client.status === 'ready',
      lastError: this.lastError,
    };
  }

  private async ensureConnected() {
    if (this.client.status === 'ready') return;
    if (!this.connecting) {
      this.connecting = this.client.connect()
        .then(() => undefined)
        .finally(() => {
          this.connecting = null;
        });
    }
    await this.connecting;
  }
}

class CacheService {
  private readonly memory = new MemoryCacheProvider();
  private readonly redis: RedisCacheProvider | null;
  private lastError: string | null = null;

  constructor() {
    const driver = String(process.env.CACHE_DRIVER || '').trim().toLowerCase();
    const redisClient = isRedisConfigured() && (driver === 'redis' || !driver) ? createRedisClient('cache') : null;
    this.redis = redisClient ? new RedisCacheProvider(redisClient) : null;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.getRaw(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      await this.del(key);
      recordCacheMetric('deserialize_error', key);
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number) {
    const payload = JSON.stringify(value);
    await this.setRaw(key, payload, ttlSeconds);
  }

  async getOrSetJson<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.getJson<T>(key);
    if (cached !== null) return cached;
    const value = await loader();
    await this.setJson(key, value, ttlSeconds);
    return value;
  }

  async del(key: string) {
    await this.memory.del(key);
    if (!this.redis) return;
    try {
      await this.redis.del(key);
      recordCacheMetric('delete', key);
    } catch (error) {
      this.rememberError(error);
      recordCacheMetric('error', key);
    }
  }

  status(): CacheStatus {
    const redisStatus = this.redis?.status();
    return {
      driver: this.redis ? 'redis' : 'memory',
      fallback: 'memory',
      redisConfigured: Boolean(this.redis),
      redisReady: Boolean(redisStatus?.ready),
      lastError: redisStatus?.lastError || this.lastError,
    };
  }

  clearMemoryForTests() {
    this.memory.clear();
  }

  private async getRaw(key: string) {
    if (this.redis) {
      try {
        const redisValue = await this.redis.get(key);
        if (redisValue !== null) {
          recordCacheMetric('hit', key);
          await this.memory.set(key, redisValue, 60);
          return redisValue;
        }
      } catch (error) {
        this.rememberError(error);
        recordCacheMetric('error', key);
      }
    }

    const memoryValue = await this.memory.get(key);
    recordCacheMetric(memoryValue === null ? 'miss' : 'hit', key);
    return memoryValue;
  }

  private async setRaw(key: string, value: string, ttlSeconds: number) {
    await this.memory.set(key, value, ttlSeconds);
    recordCacheMetric('set', key);

    if (!this.redis) return;
    try {
      await this.redis.set(key, value, ttlSeconds);
    } catch (error) {
      this.rememberError(error);
      recordCacheMetric('error', key);
    }
  }

  private rememberError(error: unknown) {
    this.lastError = error instanceof Error ? error.message : String(error);
    logger.warn('[CacheService] Cache backend unavailable; using memory fallback', error);
  }
}

export const cacheService = new CacheService();
