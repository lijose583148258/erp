import { EventEmitter } from 'node:events';
import type Redis from 'ioredis';
import { createRedisClient, ensureRedisConnected, getRedisSentinels, isRedisConfigured, isRedisSentinelConfigured } from './redis-runtime';

class DeferredRedisClient extends EventEmitter {
  status: 'wait' | 'connecting' | 'connect' | 'ready' = 'wait';
  connect = jest.fn(() => {
    this.status = 'connecting';
    return new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        this.off('ready', onReady);
        this.off('error', onError);
      };
      this.once('ready', onReady);
      this.once('error', onError);
    });
  });

  becomeReady() {
    this.status = 'ready';
    this.emit('ready');
  }
}

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

  it('shares one listener pair while an existing client is connecting', async () => {
    const client = new DeferredRedisClient();
    client.status = 'connecting';
    const waiters = Array.from({ length: 20 }, () => ensureRedisConnected(client as unknown as Redis));

    expect(client.listenerCount('ready')).toBe(1);
    expect(client.listenerCount('error')).toBe(1);
    client.becomeReady();

    await expect(Promise.all(waiters)).resolves.toEqual(Array(20).fill(undefined));
    expect(client.listenerCount('ready')).toBe(0);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('connects a waiting client once for concurrent callers', async () => {
    const client = new DeferredRedisClient();
    const waiters = Array.from({ length: 20 }, () => ensureRedisConnected(client as unknown as Redis));

    expect(client.connect).toHaveBeenCalledTimes(1);
    client.becomeReady();

    await expect(Promise.all(waiters)).resolves.toEqual(Array(20).fill(undefined));
    expect(client.listenerCount('ready')).toBe(0);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('cleans up a failed shared connection and allows a later retry', async () => {
    const client = new DeferredRedisClient();
    client.status = 'connect';
    const waiters = Array.from({ length: 20 }, () => ensureRedisConnected(client as unknown as Redis));
    const settled = Promise.allSettled(waiters);
    const failure = new Error('Synthetic connection failure');
    client.emit('error', failure);

    expect(await settled).toEqual(Array(20).fill({ status: 'rejected', reason: failure }));
    expect(client.listenerCount('ready')).toBe(0);
    expect(client.listenerCount('error')).toBe(0);

    const retry = ensureRedisConnected(client as unknown as Redis);
    expect(client.listenerCount('ready')).toBe(1);
    client.becomeReady();
    await expect(retry).resolves.toBeUndefined();
    expect(client.listenerCount('ready')).toBe(0);
    expect(client.listenerCount('error')).toBe(0);
  });
});
