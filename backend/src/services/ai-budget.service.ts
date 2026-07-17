import type Redis from 'ioredis';
import { createRedisClient, ensureRedisConnected } from '../infrastructure/redis-runtime';

export type AIBudgetDecision = {
  allowed: boolean;
  reason?: 'budget_unconfigured' | 'budget_store_unavailable' | 'budget_exhausted' | 'circuit_open';
};

const dailyBudget = () => Math.max(0, Number(process.env.AI_DAILY_TOKEN_BUDGET || 0));
const budgetPrefix = () => String(process.env.AI_BUDGET_KEY_PREFIX || 'ailaoda:ai:budget:').trim();
const circuitPrefix = () => String(process.env.AI_CIRCUIT_KEY_PREFIX || 'ailaoda:ai:circuit:').trim();
const utcDay = () => new Date().toISOString().slice(0, 10);
const secondsUntilNextUtcDay = () => Math.max(60, Math.ceil((Date.parse(`${utcDay()}T00:00:00.000Z`) + 86_400_000 - Date.now()) / 1000) + 300);

let client: Redis | null | undefined;
const getClient = () => {
  if (client === undefined) client = createRedisClient('ai-budget');
  return client;
};

type BudgetRedis = Pick<Redis, 'exists' | 'eval' | 'del' | 'incr' | 'expire' | 'set'>;

export const reserveAIBudgetWithClient = async (redis: BudgetRedis, tokens: number, budget: number): Promise<AIBudgetDecision> => {
  if (await redis.exists(`${circuitPrefix()}open`)) return { allowed: false, reason: 'circuit_open' };
  const amount = Math.max(1, Math.ceil(tokens));
  const result = Number(await redis.eval(
    `local current = redis.call('INCRBY', KEYS[1], ARGV[1])
     if current == tonumber(ARGV[1]) then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
     if current > tonumber(ARGV[2]) then redis.call('DECRBY', KEYS[1], ARGV[1]); return -1 end
     return current`,
    1,
    `${budgetPrefix()}${utcDay()}`,
    amount,
    budget,
    secondsUntilNextUtcDay(),
  ));
  return result < 0 ? { allowed: false, reason: 'budget_exhausted' } : { allowed: true };
};

export const recordAIProviderFailureWithClient = async (redis: BudgetRedis) => {
  const failureKey = `${circuitPrefix()}failures`;
  const failures = await redis.incr(failureKey);
  if (failures === 1) await redis.expire(failureKey, Math.max(30, Number(process.env.AI_CIRCUIT_FAILURE_WINDOW_SECONDS || 300)));
  if (failures >= Math.max(1, Number(process.env.AI_CIRCUIT_FAILURE_THRESHOLD || 5))) {
    await redis.set(`${circuitPrefix()}open`, '1', 'EX', Math.max(10, Number(process.env.AI_CIRCUIT_OPEN_SECONDS || 60)));
  }
};

export class AIBudgetService {
  static getStatus() {
    return {
      dailyTokenBudget: dailyBudget(),
      budgetConfigured: dailyBudget() > 0,
      circuitFailureThreshold: Math.max(1, Number(process.env.AI_CIRCUIT_FAILURE_THRESHOLD || 5)),
      circuitOpenSeconds: Math.max(10, Number(process.env.AI_CIRCUIT_OPEN_SECONDS || 60)),
    };
  }

  static async reserve(tokens: number): Promise<AIBudgetDecision> {
    const budget = dailyBudget();
    if (budget <= 0) {
      return process.env.NODE_ENV === 'test' ? { allowed: true } : { allowed: false, reason: 'budget_unconfigured' };
    }
    const redis = getClient();
    if (!redis) return { allowed: false, reason: 'budget_store_unavailable' };
    try {
      await ensureRedisConnected(redis);
      return reserveAIBudgetWithClient(redis, tokens, budget);
    } catch {
      return { allowed: false, reason: 'budget_store_unavailable' };
    }
  }

  static async recordProviderSuccess() {
    const redis = getClient();
    if (!redis) return;
    try {
      await ensureRedisConnected(redis);
      await redis.del(`${circuitPrefix()}failures`, `${circuitPrefix()}open`);
    } catch {}
  }

  static async recordProviderFailure() {
    const redis = getClient();
    if (!redis) return;
    try {
      await ensureRedisConnected(redis);
      await recordAIProviderFailureWithClient(redis);
    } catch {}
  }
}
