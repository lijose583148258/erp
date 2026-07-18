jest.mock('../config/database', () => ({
  __esModule: true,
  default: { auditLog: { create: jest.fn() } },
}));

jest.mock('../services/ai-budget.service', () => ({
  AIBudgetService: {
    getStatus: jest.fn(() => ({ dailyTokenBudget: 500, budgetConfigured: true })),
    reserve: jest.fn(async () => ({ allowed: true })),
    recordProviderSuccess: jest.fn(async () => undefined),
    recordProviderFailure: jest.fn(async () => undefined),
  },
}));

import prisma from '../config/database';
import { AIController } from './ai.controller';
import { AuthRequest } from '../middleware/auth';
import type { Response as ExpressResponse } from 'express';

const auditCreate = prisma.auditLog.create as jest.Mock;
const request = (withUser = true) => ({
  body: { prompt: 'explain approvals', currentPage: 'dashboard', language: 'en-US' },
  user: withUser ? { userId: 1, username: 'manager-1', role: 'manager', segment: 'direct' } : undefined,
  ip: '127.0.0.1',
  get: jest.fn(() => 'contract-agent'),
}) as unknown as AuthRequest;
const response = () => ({ json: jest.fn() }) as unknown as ExpressResponse;

describe('AI controller durable audit boundary', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      AI_GATEWAY_EXTERNAL_ENABLED: 'true',
      AI_GATEWAY_ENDPOINT: 'https://ai.example.test/v1/chat/completions',
      AI_GATEWAY_ALLOWED_HOSTS: 'ai.example.test',
      AI_GATEWAY_MODEL: 'governed-model',
      AI_GATEWAY_API_KEY: 'server-secret',
    };
    auditCreate.mockReset();
    global.fetch = jest.fn(async () => new globalThis.Response(JSON.stringify({
      choices: [{ message: { content: 'Use the approval workspace.' } }],
    }), { status: 200 })) as typeof fetch;
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('blocks provider dispatch when the mandatory audit write fails', async () => {
    auditCreate.mockRejectedValue(new Error('audit database unavailable'));
    const res = response();

    await new AIController().assist(request(), res);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ mode: 'local', reason: 'audit_unavailable' }),
    }));
    expect(auditCreate.mock.calls[0][0].data.action).toBe('AI_ASSIST_EXTERNAL_DISPATCH');
  });

  it('persists sanitized dispatch evidence before the provider call', async () => {
    auditCreate.mockResolvedValue({ id: 'audit-1' });
    const res = response();

    await new AIController().assist(request(), res);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({
      userId: 1,
      action: 'AI_ASSIST_EXTERNAL_DISPATCH',
      resource: 'ai-assistant',
    });
    const details = String(auditCreate.mock.calls[0][0].data.details);
    expect(JSON.parse(details)).toEqual({
      role: 'manager', segment: 'direct', currentPage: 'dashboard',
      model: 'governed-model', endpointHost: 'ai.example.test',
    });
    expect(details).not.toContain('explain approvals');
    expect(details).not.toContain('server-secret');
    expect(auditCreate.mock.calls[1][0].data.action).toBe('AI_ASSIST_EXTERNAL');
  });

  it('blocks provider dispatch when authenticated identity is unavailable', async () => {
    const res = response();

    await new AIController().assist(request(false), res);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reason: 'audit_unavailable' }),
    }));
  });
});
