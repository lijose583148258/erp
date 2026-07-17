const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));
const findings = [];

const add = (severity, file, message) => findings.push({ severity, file, message });
const requireIncludes = (file, text, severity, message) => {
  const content = read(file);
  if (!content.includes(text)) add(severity, file, message);
  return content;
};

const cacheService = requireIncludes(
  'backend/src/services/cache.service.ts',
  'class CacheService',
  'P0',
  'Unified CacheService boundary is missing.'
);
if (!cacheService.includes("from 'ioredis'")) add('P1', 'backend/src/services/cache.service.ts', 'Redis-backed cache provider should use the existing ioredis dependency.');
if (!cacheService.includes('MemoryCacheProvider')) add('P0', 'backend/src/services/cache.service.ts', 'Memory fallback provider is missing.');
if (!cacheService.includes('REDIS_URL') || !cacheService.includes('CACHE_REDIS_URL')) add('P1', 'backend/src/services/cache.service.ts', 'Redis URL configuration should support REDIS_URL and CACHE_REDIS_URL.');
if (!cacheService.includes('CACHE_DRIVER')) add('P2', 'backend/src/services/cache.service.ts', 'Cache driver override is not documented in code.');
if (!cacheService.includes('recordCacheMetric')) add('P1', 'backend/src/services/cache.service.ts', 'Cache operations should emit Prometheus metrics.');

const metrics = requireIncludes(
  'backend/src/middleware/metricsMiddleware.ts',
  'ailaoda_cache_operations_total',
  'P1',
  'Prometheus cache operation metric is missing.'
);
if (!metrics.includes('recordCacheMetric')) add('P1', 'backend/src/middleware/metricsMiddleware.ts', 'recordCacheMetric export is missing.');

const currencyService = requireIncludes(
  'backend/src/services/currency.service.ts',
  'getRateSnapshotCached',
  'P1',
  'Currency read model should consume the unified cache boundary.'
);
if (!currencyService.includes("from './cache.service'")) add('P1', 'backend/src/services/currency.service.ts', 'Currency service should import CacheService, not use a local-only cache path.');

const currencyRoutes = requireIncludes(
  'backend/src/routes/currency.routes.ts',
  'getRateSnapshotCached',
  'P1',
  'Currency rates route should return the cache-backed snapshot.'
);
if (!currencyRoutes.includes('cache: snapshot.cache')) add('P2', 'backend/src/routes/currency.routes.ts', 'Currency rates response should expose cache status for operators.');

const server = requireIncludes(
  'backend/src/server.ts',
  'cacheService.status()',
  'P2',
  'Health responses should expose cache status.'
);
if (!server.includes("from './services/cache.service'")) add('P2', 'backend/src/server.ts', 'Server should import the unified cache service for health/status visibility.');

if (!exists('docs/adr/0004-unified-cache-boundary.md')) {
  add('P1', 'docs/adr/0004-unified-cache-boundary.md', 'Unified cache boundary ADR is missing.');
}

const directRedisFiles = [];
const allowedRedisInfrastructureFiles = new Set([
  'backend/src/services/cache.service.ts',
  'backend/src/infrastructure/redis-runtime.ts',
  'backend/src/services/auth-token-store.service.ts',
]);
const scan = (dir) => {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'output') continue;
    const relativePath = path.join(dir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      scan(relativePath);
      continue;
    }
    if (!/\.(ts|tsx|js|cjs)$/.test(entry.name)) continue;
    if (allowedRedisInfrastructureFiles.has(relativePath)) continue;
    const content = read(relativePath);
    if (content.includes("from 'ioredis'") || content.includes("from 'redis'") || content.includes('require("ioredis")') || content.includes("require('ioredis')")) {
      directRedisFiles.push(relativePath);
    }
  }
};
scan('backend/src');
for (const file of directRedisFiles) {
  add('P1', file, 'Business code should use CacheService instead of importing Redis clients directly.');
}

if (findings.length) {
  console.error('Cache Strategy Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('Cache Strategy Audit: PASS');
console.log('- Unified CacheService boundary exists.');
console.log('- Redis is optional and memory fallback remains available.');
console.log('- Cache metrics and health visibility are present.');
console.log('- Currency exchange-rate snapshots consume the unified cache.');
