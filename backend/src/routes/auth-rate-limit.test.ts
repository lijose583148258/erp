process.env.LOGIN_RATE_LIMIT_MAX = '2';
process.env.LOGIN_IP_RATE_LIMIT_MAX = '100';
process.env.LOGIN_RATE_LIMIT_WINDOW_MS = '60000';

import request from 'supertest';
import express from 'express';
import app from '../server';
import { createLoginAccountLimiter } from './auth.routes';

describe('auth login rate limit', () => {
  const successfulUsername = 'rate_limit_success';
  const successfulPassword = 'RateLimitSuccess123!';

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

  it('does not consume the strict account budget for successful sign-ins', async () => {
    const successfulLoginApp = express();
    successfulLoginApp.use(express.json());
    successfulLoginApp.post('/login', createLoginAccountLimiter(), (_req, res) => {
      res.status(200).json({ success: true });
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await request(successfulLoginApp)
        .post('/login')
        .send({ username: successfulUsername, password: successfulPassword })
        .expect(200);
    }
  });
});
