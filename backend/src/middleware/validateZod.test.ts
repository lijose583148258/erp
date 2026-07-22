jest.mock('../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import express, { Request, Response } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { validateZod } from './validateZod';

describe('Zod validation logging boundary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('logs invalid field names without logging values or dynamic issue messages', async () => {
    const password = 'zod-secret-password';
    const schema = z.object({
      password: z.string().refine(() => false, {
        message: `invalid password value: ${password}`,
      }),
      mfaCode: z.string().min(6),
    });
    const app = express();
    app.use(express.json());
    app.post(
      '/zod-credential-check',
      validateZod(schema),
      (_req: Request, res: Response) => res.json({ success: true }),
    );

    const mfaCode = '123';
    await request(app).post('/zod-credential-check').send({ password, mfaCode }).expect(400);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const serializedLogArguments = JSON.stringify((logger.warn as jest.Mock).mock.calls);
    expect(serializedLogArguments).toContain('zod-credential-check');
    expect(serializedLogArguments).toContain('password');
    expect(serializedLogArguments).toContain('mfaCode');
    expect(serializedLogArguments).not.toContain(password);
    expect(serializedLogArguments).not.toContain(mfaCode);
    expect(serializedLogArguments).not.toContain('invalid password value');
  });
});
