import { AIBudgetService, recordAIProviderFailureWithClient, reserveAIBudgetWithClient } from './ai-budget.service';

describe('AI shared budget and circuit boundary', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'production' };
    delete process.env.AI_DAILY_TOKEN_BUDGET;
    delete process.env.AI_CIRCUIT_FAILURE_THRESHOLD;
    delete process.env.AI_CIRCUIT_OPEN_SECONDS;
  });

  afterAll(() => { process.env = originalEnv; });

  it('fails closed when production external AI has no daily budget', async () => {
    await expect(AIBudgetService.reserve(500)).resolves.toEqual({ allowed: false, reason: 'budget_unconfigured' });
  });

  it('returns budget exhaustion without accepting an over-limit reservation', async () => {
    const redis = {
      exists: jest.fn(async () => 0),
      eval: jest.fn(async () => -1),
    } as any;
    await expect(reserveAIBudgetWithClient(redis, 500, 1_000)).resolves.toEqual({ allowed: false, reason: 'budget_exhausted' });
    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('DECRBY'), 1, expect.stringMatching(/^ailaoda:ai:budget:/), 500, 1_000, expect.any(Number));
  });

  it('blocks calls while the shared provider circuit is open', async () => {
    const redis = { exists: jest.fn(async () => 1), eval: jest.fn() } as any;
    await expect(reserveAIBudgetWithClient(redis, 500, 1_000)).resolves.toEqual({ allowed: false, reason: 'circuit_open' });
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('opens the provider circuit when the failure threshold is reached', async () => {
    process.env.AI_CIRCUIT_FAILURE_THRESHOLD = '3';
    process.env.AI_CIRCUIT_OPEN_SECONDS = '90';
    const redis = {
      incr: jest.fn(async () => 3),
      expire: jest.fn(),
      set: jest.fn(async () => 'OK'),
    } as any;
    await recordAIProviderFailureWithClient(redis);
    expect(redis.set).toHaveBeenCalledWith('ailaoda:ai:circuit:open', '1', 'EX', 90);
  });
});
