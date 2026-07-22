jest.mock('../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import express, { Request, Response } from 'express';
import request from 'supertest';
import { body } from 'express-validator';
import { logger } from '../utils/logger';
import { validateRequest } from './validateRequest';

describe('request validation logging boundary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('logs invalid field names without logging request values', async () => {
    const app = express();
    app.use(express.json());
    app.post('/credential-check', [
      body('password').custom(value => {
        throw new Error(`invalid password value: ${value}`);
      }),
      body('mfaCode').isLength({ min: 6 }),
      body('apiKey').isLength({ min: 20 }),
    ], validateRequest, (_req: Request, res: Response) => res.json({ success: true }));

    const secrets = {
      password: 'short-secret-password',
      mfaCode: '123',
      apiKey: 'private-api-key',
    };
    await request(app).post('/credential-check').send(secrets).expect(400);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const serializedLogArguments = JSON.stringify((logger.warn as jest.Mock).mock.calls);
    expect(serializedLogArguments).toContain('credential-check');
    expect(serializedLogArguments).toContain('password');
    expect(serializedLogArguments).toContain('mfaCode');
    expect(serializedLogArguments).toContain('apiKey');
    expect(serializedLogArguments).not.toContain(secrets.password);
    expect(serializedLogArguments).not.toContain(secrets.mfaCode);
    expect(serializedLogArguments).not.toContain(secrets.apiKey);
    expect(serializedLogArguments).not.toContain('body dump');
  });
});
