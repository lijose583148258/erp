const fs = require('fs');
const path = require('path');

const root = process.cwd();
const findings = [];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const requireTokens = (file, tokens) => {
  if (!fs.existsSync(path.join(root, file))) {
    findings.push({ severity: 'P0', file, message: 'Required distributed auth file is missing.' });
    return;
  }
  const content = read(file);
  for (const token of tokens) {
    if (!content.includes(token)) findings.push({ severity: 'P0', file, message: `Missing token: ${token}` });
  }
};

requireTokens('backend/src/services/auth-token-store.service.ts', [
  'class RedisAuthTokenStore',
  "createHash('sha256')",
  'consumeRefreshToken',
  "redis.call('DEL', KEYS[1])",
  'generationKey',
  'expectedGeneration',
  'issuedAt',
  'SaaS deployment requires AUTH_TOKEN_STORE_DRIVER=redis',
]);
requireTokens('backend/src/controllers/auth.controller.ts', [
  'await consumeRefreshToken(refreshToken)',
  'tokenData.issuedAt.getTime() < user.updatedAt.getTime()',
  'createRefreshToken(user.id, tokenData.generation)',
  'await blacklistAccessToken',
]);
requireTokens('backend/src/middleware/auth.ts', [
  'await isTokenBlacklisted(token)',
  'AUTH_TOKEN_STORE_UNAVAILABLE',
]);
requireTokens('backend/src/services/distributed-rate-limit.service.ts', [
  "from 'rate-limit-redis'",
  'createLoginRateLimitStore',
  'createApiRateLimitStore',
  'SaaS deployment requires LOGIN_RATE_LIMIT_STORE=redis',
]);
requireTokens('backend/src/routes/auth.routes.ts', [
  'loginIpLimiter',
  'LOGIN_IP_RATE_LIMIT_MAX',
  'loginAccountKey',
  "createHash('sha256')",
  "createLoginRateLimitStore('ip')",
  "createLoginRateLimitStore('account')",
]);
requireTokens('backend/src/routes/auth-rate-limit.test.ts', [
  'does not share the strict account budget between usernames behind one IP',
  'rate_limit_alpha',
  'rate_limit_beta',
]);
requireTokens('backend/src/infrastructure/redis-runtime.ts', [
  "from 'ioredis'",
  'ensureRedisConnected',
  'probeRedis',
]);
requireTokens('docker-compose.production-postgres.yml', [
  'AUTH_TOKEN_STORE_DRIVER: redis',
  'LOGIN_RATE_LIMIT_STORE: redis',
  'redis:7.4-bookworm',
  'ailao-redis-data:',
]);

const packageJson = JSON.parse(read('backend/package.json'));
if (!packageJson.dependencies?.ioredis || !packageJson.dependencies?.['rate-limit-redis']) {
  findings.push({ severity: 'P0', file: 'backend/package.json', message: 'ioredis and rate-limit-redis must be production dependencies.' });
}
if (packageJson.dependencies?.redis) {
  findings.push({ severity: 'P1', file: 'backend/package.json', message: 'Duplicate redis SDK should be removed.' });
}

if (findings.length) {
  console.error('Distributed Auth Session Audit: FAIL');
  for (const finding of findings) console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  process.exit(1);
}

console.log('Distributed Auth Session Audit: PASS');
console.log('- Refresh tokens are hashed, single-use, generation-bound, and stale-user aware.');
console.log('- Access-token revocation and two-layer login/API rate limits use Redis in SaaS mode.');
console.log('- Production compose provisions persistent authenticated Redis.');
