import request from 'supertest';
import app from '../server';

describe('public readiness information boundary', () => {
  const originalToken = process.env.AILAODA_METRICS_BEARER_TOKEN;

  afterAll(() => {
    if (originalToken === undefined) delete process.env.AILAODA_METRICS_BEARER_TOKEN;
    else process.env.AILAODA_METRICS_BEARER_TOKEN = originalToken;
  });

  it('returns only minimal dependency booleans on the public readiness route', async () => {
    const response = await request(app).get('/ready');
    expect([200, 503]).toContain(response.status);
    expect(Object.keys(response.body).sort()).toEqual(['database', 'redis', 'status', 'timestamp']);
    expect(Object.keys(response.body.redis).sort()).toEqual(['ready']);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toHaveProperty('dependencyPolicy');
    expect(response.body).not.toHaveProperty('degradable');
    expect(response.body).not.toHaveProperty('uptime');
  });

  it('does not expose deep readiness anonymously', async () => {
    await request(app).get('/internal/ready').expect(401);
  });

  it('allows the metrics collector token to read deep readiness', async () => {
    process.env.AILAODA_METRICS_BEARER_TOKEN = 'readiness-boundary-token-1234567890';
    const response = await request(app)
      .get('/internal/ready')
      .set('Authorization', 'Bearer readiness-boundary-token-1234567890');
    expect([200, 503]).toContain(response.status);
    expect(response.body).toHaveProperty('dependencyPolicy');
    expect(response.body).toHaveProperty('degradable');
  });
});
