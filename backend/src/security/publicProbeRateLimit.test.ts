import express from 'express';
import request from 'supertest';
import { createPublicProbeLimiter, resolvePublicProbeRateLimit } from './publicProbeRateLimit';

describe('public probe rate limit', () => {
  it('uses bounded production defaults and rejects invalid overrides', () => {
    expect(resolvePublicProbeRateLimit('production', {})).toEqual({ windowMs: 60_000, max: 120 });
    expect(resolvePublicProbeRateLimit('production', {
      PUBLIC_PROBE_RATE_LIMIT_WINDOW_MS: 'not-a-number',
      PUBLIC_PROBE_RATE_LIMIT_MAX: '2',
    })).toEqual({ windowMs: 60_000, max: 120 });
  });

  it('returns 429 after the configured probe budget is exhausted', async () => {
    const app = express();
    app.use(createPublicProbeLimiter('production', {
      PUBLIC_PROBE_RATE_LIMIT_WINDOW_MS: '60000',
      PUBLIC_PROBE_RATE_LIMIT_MAX: '10',
    }));
    app.get('/ready', (_req, res) => res.json({ status: 'ready' }));

    for (let index = 0; index < 10; index += 1) {
      await request(app).get('/ready').expect(200);
    }
    const rejected = await request(app).get('/ready').expect(429);
    expect(rejected.body).toEqual({ status: 'rate-limited' });
    expect(rejected.headers['ratelimit-policy']).toBeDefined();
  });
});
