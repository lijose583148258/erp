import express from 'express';
import request from 'supertest';

jest.mock('../utils/logger', () => ({
  logger: {
    error: jest.fn(),
  },
}));

import { errorHandler, ErrorCode } from './errorHandler';

const buildApp = () => {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.post('/payload', (_req, res) => res.json({ success: true }));
  app.use(errorHandler);
  return app;
};

describe('global request-body error handling', () => {
  it('maps malformed JSON to a controlled 400 response', async () => {
    const response = await request(buildApp())
      .post('/payload')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      errorCode: ErrorCode.VALIDATION_ERROR,
    });
    expect(response.body.message).toBe('请求内容不是有效的 JSON');
  });

  it('maps an oversized JSON body to 413', async () => {
    const response = await request(buildApp())
      .post('/payload')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ padding: 'A'.repeat(2 * 1024) }))
      .expect(413);

    expect(response.body).toMatchObject({
      success: false,
      errorCode: ErrorCode.PAYLOAD_TOO_LARGE,
    });
    expect(response.body.message).toBe('请求内容超过大小限制');
  });
});
