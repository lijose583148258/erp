process.env.LOGIN_RATE_LIMIT_MAX = '2';
process.env.LOGIN_IP_RATE_LIMIT_MAX = '100';
process.env.LOGIN_RATE_LIMIT_WINDOW_MS = '60000';

import request from 'supertest';
import app from '../server';

describe('auth login rate limit', () => {
  it('rate-limits repeated login attempts before authentication work', async () => {
    await request(app).post('/api/auth/login').send({}).expect(400);
    await request(app).post('/api/auth/login').send({}).expect(400);

    const limited = await request(app).post('/api/auth/login').send({}).expect(429);
    expect(limited.body).toMatchObject({
      success: false,
      errorCode: 'LOGIN_RATE_LIMITED',
    });
  });

  it('does not share the strict account budget between usernames behind one IP', async () => {
    await request(app).post('/api/auth/login').send({ username: 'rate_limit_alpha' }).expect(400);
    await request(app).post('/api/auth/login').send({ username: 'rate_limit_alpha' }).expect(400);
    await request(app).post('/api/auth/login').send({ username: 'rate_limit_alpha' }).expect(429);

    await request(app).post('/api/auth/login').send({ username: 'rate_limit_beta' }).expect(400);
  });
});
