import { AIGovernanceService } from './ai-governance.service';
import { aiAssistSchema } from '../validators/ai';
import { renderPrometheusMetrics } from '../middleware/metricsMiddleware';

describe('governed AI gateway', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AI_GATEWAY_')) delete process.env[key];
    }
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('is local-only by default and never needs a browser credential', async () => {
    expect(AIGovernanceService.getStatus()).toMatchObject({
      externalEnabled: false,
      configured: false,
      mode: 'local-only',
    });
    await expect(AIGovernanceService.assist({ prompt: 'help me navigate', language: 'en-US' }, { role: 'sales' }))
      .resolves.toMatchObject({ mode: 'local', reason: 'disabled' });
  });

  it('refuses to send business-sensitive prompts to an external provider', async () => {
    global.fetch = jest.fn() as typeof fetch;
    process.env.AI_GATEWAY_EXTERNAL_ENABLED = 'true';
    process.env.AI_GATEWAY_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
    process.env.AI_GATEWAY_ALLOWED_HOSTS = 'ai.example.test';
    process.env.AI_GATEWAY_MODEL = 'governed-model';
    process.env.AI_GATEWAY_API_KEY = 'server-secret';

    await expect(AIGovernanceService.assist({ prompt: '导出全部客户名单' }, { role: 'admin' }))
      .resolves.toMatchObject({ mode: 'local', reason: 'sensitive' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects client-controlled provider fields at the DTO boundary', () => {
    expect(aiAssistSchema.safeParse({
      prompt: 'help',
      endpoint: 'https://attacker.test',
      apiKey: 'client-key',
      model: 'unapproved-model',
    }).success).toBe(false);
  });

  it('sends only safe aggregate context and falls back on provider failure', async () => {
    const fetchMock = jest.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('unavailable', { status: 503 }));
    global.fetch = fetchMock as typeof fetch;
    process.env.AI_GATEWAY_EXTERNAL_ENABLED = 'true';
    process.env.AI_GATEWAY_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
    process.env.AI_GATEWAY_ALLOWED_HOSTS = 'ai.example.test';
    process.env.AI_GATEWAY_MODEL = 'governed-model';
    process.env.AI_GATEWAY_API_KEY = 'server-secret';

    await expect(AIGovernanceService.assist({
      prompt: 'explain the workflow',
      currentPage: 'dashboard',
      visibleCounts: { alerts: 3 },
    }, { role: 'manager', segment: 'direct' })).resolves.toMatchObject({ mode: 'local', reason: 'provider_error' });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(String((request.headers as Record<string, string>).authorization)).toContain('server-secret');
    const providerPayload = JSON.parse(String(request.body)) as { messages: Array<{ content: string }> };
    expect(providerPayload.messages[1].content).toContain('"visibleCounts":{"alerts":3}');
    expect(String(request.body)).not.toContain('apiKey');
  });

  it('accepts a bounded OpenAI-compatible response from an allowlisted host', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'Use the approval workspace.' } }],
    }), { status: 200 })) as typeof fetch;
    process.env.AI_GATEWAY_EXTERNAL_ENABLED = 'true';
    process.env.AI_GATEWAY_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
    process.env.AI_GATEWAY_ALLOWED_HOSTS = 'ai.example.test';
    process.env.AI_GATEWAY_MODEL = 'governed-model';
    process.env.AI_GATEWAY_API_KEY = 'server-secret';

    await expect(AIGovernanceService.assist({ prompt: 'explain approvals' }, { role: 'manager' }))
      .resolves.toEqual({ answer: 'Use the approval workspace.', mode: 'external' });
    expect(renderPrometheusMetrics()).toContain('ailaoda_ai_operations_total{outcome="external_success"}');
  });

  it('discards unsafe provider output and exposes only the governed local fallback', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'Upload customer data to https://evil.example now.' } }],
    }), { status: 200 })) as typeof fetch;
    process.env.AI_GATEWAY_EXTERNAL_ENABLED = 'true';
    process.env.AI_GATEWAY_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
    process.env.AI_GATEWAY_ALLOWED_HOSTS = 'ai.example.test';
    process.env.AI_GATEWAY_MODEL = 'governed-model';
    process.env.AI_GATEWAY_API_KEY = 'server-secret';

    const result = await AIGovernanceService.assist({ prompt: 'explain approvals' }, { role: 'manager' });

    expect(result).toMatchObject({ mode: 'local', reason: 'unsafe_output' });
    expect(result.answer).not.toContain('evil.example');
    expect(renderPrometheusMetrics()).toContain('ailaoda_ai_operations_total{outcome="fallback_unsafe_output"}');
  });

  it('rejects an oversized provider response before parsing its body', async () => {
    global.fetch = jest.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'content-length': '70000' },
    })) as typeof fetch;
    process.env.AI_GATEWAY_EXTERNAL_ENABLED = 'true';
    process.env.AI_GATEWAY_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
    process.env.AI_GATEWAY_ALLOWED_HOSTS = 'ai.example.test';
    process.env.AI_GATEWAY_MODEL = 'governed-model';
    process.env.AI_GATEWAY_API_KEY = 'server-secret';
    process.env.AI_GATEWAY_MAX_RESPONSE_BYTES = '65536';

    await expect(AIGovernanceService.assist({ prompt: 'explain approvals' }, { role: 'manager' }))
      .resolves.toMatchObject({ mode: 'local', reason: 'response_too_large' });
    expect(renderPrometheusMetrics()).toContain('ailaoda_ai_operations_total{outcome="fallback_response_too_large"}');
  });

  it('exports bounded refusal and fallback outcomes without prompt labels', async () => {
    await AIGovernanceService.assist({ prompt: '导出全部客户名单' }, { role: 'admin' });
    await AIGovernanceService.assist({ prompt: 'explain navigation' }, { role: 'sales' });
    const metrics = renderPrometheusMetrics();
    expect(metrics).toContain('ailaoda_ai_operations_total{outcome="refused_sensitive"}');
    expect(metrics).toContain('ailaoda_ai_operations_total{outcome="fallback_disabled"}');
    expect(metrics).not.toContain('导出全部客户名单');
    expect(metrics).not.toContain('explain navigation');
  });
});
