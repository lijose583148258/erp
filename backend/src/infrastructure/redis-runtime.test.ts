import { createRedisClient, getRedisSentinels, isRedisConfigured, isRedisSentinelConfigured } from './redis-runtime';

describe('Redis runtime connection boundary', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    delete process.env.AUTH_REDIS_URL;
    delete process.env.CACHE_REDIS_URL;
    delete process.env.REDIS_SENTINELS;
    delete process.env.REDIS_MASTER_NAME;
    delete process.env.REDIS_PASSWORD;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('parses a Sentinel quorum and creates a lazy master-discovery client', () => {
    process.env.REDIS_SENTINELS = 'sentinel-a:26379,sentinel-b:26380,sentinel-c:26381';
    process.env.REDIS_MASTER_NAME = 'ailaoda-primary';
    process.env.REDIS_PASSWORD = 'test-password';

    expect(getRedisSentinels()).toEqual([
      { host: 'sentinel-a', port: 26379 },
      { host: 'sentinel-b', port: 26380 },
      { host: 'sentinel-c', port: 26381 },
    ]);
    expect(isRedisSentinelConfigured()).toBe(true);
    expect(isRedisConfigured()).toBe(true);
    const client = createRedisClient('unit-sentinel');
    expect(client?.options.name).toBe('ailaoda-primary');
    expect(client?.options.role).toBe('master');
    client?.disconnect();
  });

  it('rejects invalid Sentinel ports', () => {
    process.env.REDIS_SENTINELS = 'sentinel-a:not-a-port';
    process.env.REDIS_MASTER_NAME = 'ailaoda-primary';
    expect(() => getRedisSentinels()).toThrow('Invalid REDIS_SENTINELS entry');
  });
});
