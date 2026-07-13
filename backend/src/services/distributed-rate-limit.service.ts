import type { Store } from 'express-rate-limit';
import RedisStore, { type RedisReply } from 'rate-limit-redis';
import { createRedisClient, ensureRedisConnected, isRedisConfigured } from '../infrastructure/redis-runtime';

const configuredDriver = String(process.env.LOGIN_RATE_LIMIT_STORE || '').trim().toLowerCase();
const driver = configuredDriver === 'memory' || configuredDriver === 'redis'
  ? configuredDriver
  : isRedisConfigured() ? 'redis' : 'memory';

if (process.env.NODE_ENV === 'production' && process.env.AILAODA_DEPLOYMENT_MODE === 'saas' && driver !== 'redis') {
  throw new Error('SaaS deployment requires LOGIN_RATE_LIMIT_STORE=redis and a direct or Sentinel Redis configuration.');
}

const client = driver === 'redis' ? createRedisClient('login-rate-limit') : null;
if (driver === 'redis' && !client) {
  throw new Error('LOGIN_RATE_LIMIT_STORE=redis requires a direct or Sentinel Redis configuration.');
}

const createRedisRateLimitStore = (prefix: string): Store | undefined => {
  if (!client) return undefined;
  const sendRawCommand = client.call.bind(client) as (...args: string[]) => Promise<RedisReply>;
  return new RedisStore({
    prefix,
    sendCommand: async (...args: string[]) => {
      await ensureRedisConnected(client);
      return sendRawCommand(...args);
    },
  });
};

export const createLoginRateLimitStore = (scope: 'account' | 'ip' = 'account') => {
  const basePrefix = String(process.env.LOGIN_RATE_LIMIT_KEY_PREFIX || 'ailaoda:rate-limit:login:');
  return createRedisRateLimitStore(`${basePrefix}${scope}:`);
};

export const createApiRateLimitStore = () => createRedisRateLimitStore(
  String(process.env.API_RATE_LIMIT_KEY_PREFIX || 'ailaoda:rate-limit:api:'),
);

export const createAIRateLimitStore = () => createRedisRateLimitStore(
  String(process.env.AI_RATE_LIMIT_KEY_PREFIX || 'ailaoda:rate-limit:ai:'),
);

export const getRateLimitStoreStatus = () => ({
  driver,
  ready: client ? client.status === 'ready' : true,
});
