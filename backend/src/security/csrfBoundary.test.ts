import express from 'express';
import request from 'supertest';
import { createCsrfBoundary } from './csrfBoundary';

const buildApp = () => {
  const app = express();
  app.use(createCsrfBoundary({ allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5001'] }));
  app.post('/api/orders', (_req, res) => res.json({ success: true }));
  app.post('/non-api', (_req, res) => res.json({ success: true }));
  return app;
};

describe('CSRF boundary', () => {
  it('allows bearer-token API writes from allowed origins', async () => {
    await request(buildApp())
      .post('/api/orders')
      .set('Origin', 'http://localhost:5173')
      .set('Authorization', 'Bearer test-token')
      .expect(200)
      .expect('X-CSRF-Protection-Mode', 'bearer-token-origin-boundary');
  });

  it('rejects browser write requests from untrusted origins', async () => {
    const response = await request(buildApp())
      .post('/api/orders')
      .set('Origin', 'https://evil.example')
      .set('Authorization', 'Bearer test-token')
      .expect(403);

    expect(response.body.errorCode).toBe('CSRF_ORIGIN_REJECTED');
  });

  it('rejects token-like cookie authentication without bearer auth', async () => {
    const response = await request(buildApp())
      .post('/api/orders')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', 'refreshToken=abc')
      .expect(403);

    expect(response.body.errorCode).toBe('CSRF_COOKIE_AUTH_REJECTED');
  });

  it('does not apply API CSRF rules outside the API namespace', async () => {
    await request(buildApp())
      .post('/non-api')
      .set('Origin', 'https://evil.example')
      .expect(200);
  });
});
