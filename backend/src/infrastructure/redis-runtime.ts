import Redis, { type RedisOptions } from 'ioredis';
import { loadRuntimeEnv } from '../config/runtime';
import { logger } from '../utils/logger';

loadRuntimeEnv();

export const getRedisUrl = () => String(
  process.env.REDIS_URL || process.env.AUTH_REDIS_URL || process.env.CACHE_REDIS_URL || '',
).trim();

export const getRedisSentinels = () => String(process.env.REDIS_SENTINELS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
  .map(value => {
    const separator = value.lastIndexOf(':');
    const host = separator > 0 ? value.slice(0, separator) : value;
    const port = separator > 0 ? Number(value.slice(separator + 1)) : 26379;
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid REDIS_SENTINELS entry: ${value}`);
    return { host, port };
  });

export const isRedisSentinelConfigured = () => getRedisSentinels().length > 0 && Boolean(String(process.env.REDIS_MASTER_NAME || '').trim());
export const isRedisConfigured = () => Boolean(getRedisUrl()) || isRedisSentinelConfigured();

const getRedisPassword = () => {
  const direct = String(process.env.REDIS_PASSWORD || '').trim();
  if (direct) return direct;
  try {
    return decodeURIComponent(new URL(getRedisUrl()).password) || undefined;
  } catch {
    return undefined;
  }
};

const baseOptions = (purpose: string): RedisOptions => ({
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 1500),
  commandTimeout: Number(process.env.REDIS_COMMAND_TIMEOUT_MS || 1500),
  connectionName: `ailaoda-${purpose}`,
});

export const createRedisClient = (purpose: string) => {
  const redisUrl = getRedisUrl();
  const sentinelConfigured = isRedisSentinelConfigured();
  if (!redisUrl && !sentinelConfigured) return null;
  const client = sentinelConfigured
    ? new Redis({
        ...baseOptions(purpose),
        sentinels: getRedisSentinels(),
        name: String(process.env.REDIS_MASTER_NAME).trim(),
        password: getRedisPassword(),
        sentinelPassword: String(process.env.REDIS_SENTINEL_PASSWORD || '').trim() || undefined,
        role: 'master',
      })
    : new Redis(redisUrl, baseOptions(purpose));
  client.on('error', (error) => {
    logger.warn(`[Redis:${purpose}] connection error`, error);
  });
  return client;
};

const connectionPromises = new WeakMap<Redis, Promise<void>>();

export const ensureRedisConnected = async (client: Redis) => {
  if (client.status === 'ready') return;
  if (client.status === 'wait') {
    let connecting = connectionPromises.get(client);
    if (!connecting) {
      connecting = client.connect()
        .then(() => undefined)
        .finally(() => connectionPromises.delete(client));
      connectionPromises.set(client, connecting);
    }
    await connecting;
    return;
  }
  if (client.status === 'connecting' || client.status === 'connect') {
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        client.off('ready', onReady);
        client.off('error', onError);
      };
      client.once('ready', onReady);
      client.once('error', onError);
    });
    return;
  }
  throw new Error(`Redis client is not connectable (status=${client.status}).`);
};

let healthClient: Redis | null | undefined;

export const probeRedis = async () => {
  if (!isRedisConfigured()) return { configured: false, ready: true, mode: 'none', error: null as string | null };
  if (healthClient === undefined) healthClient = createRedisClient('health');
  if (!healthClient) return { configured: true, ready: false, error: 'Redis client could not be created.' };
  try {
    await ensureRedisConnected(healthClient);
    await healthClient.ping();
    return { configured: true, ready: true, mode: isRedisSentinelConfigured() ? 'sentinel' : 'direct', error: null as string | null };
  } catch (error) {
    return {
      configured: true,
      ready: false,
      mode: isRedisSentinelConfigured() ? 'sentinel' : 'direct',
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
