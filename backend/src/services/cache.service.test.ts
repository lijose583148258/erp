import { cacheService } from './cache.service';
import { renderPrometheusMetrics } from '../middleware/metricsMiddleware';

describe('CacheService', () => {
  beforeEach(() => {
    cacheService.clearMemoryForTests();
  });

  it('stores JSON values in the unified memory fallback', async () => {
    await cacheService.setJson('unit-cache:profile', { name: 'AilaoDa' }, 60);

    await expect(cacheService.getJson<{ name: string }>('unit-cache:profile')).resolves.toEqual({ name: 'AilaoDa' });
    expect(cacheService.status()).toMatchObject({
      fallback: 'memory',
      redisConfigured: false,
    });
  });

  it('uses the loader only on cache miss', async () => {
    const loader = jest.fn(async () => ({ count: 1 }));

    await expect(cacheService.getOrSetJson('unit-cache:counter', 60, loader)).resolves.toEqual({ count: 1 });
    await expect(cacheService.getOrSetJson('unit-cache:counter', 60, loader)).resolves.toEqual({ count: 1 });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(renderPrometheusMetrics()).toContain('ailaoda_cache_operations_total{action="hit",namespace="unit-cache"}');
  });
});
