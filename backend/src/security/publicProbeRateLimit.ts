import rateLimit from 'express-rate-limit';

type ProbeRateLimitEnvironment = Record<string, string | undefined>;

const boundedPositiveInteger = (value: string | undefined, fallback: number, minimum: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
};

export const resolvePublicProbeRateLimit = (
  nodeEnv: string,
  env: ProbeRateLimitEnvironment = process.env,
) => ({
  windowMs: boundedPositiveInteger(env.PUBLIC_PROBE_RATE_LIMIT_WINDOW_MS, 60_000, 1_000),
  max: boundedPositiveInteger(
    env.PUBLIC_PROBE_RATE_LIMIT_MAX,
    nodeEnv === 'production' ? 120 : 1_000,
    10,
  ),
});

export const createPublicProbeLimiter = (
  nodeEnv: string,
  env: ProbeRateLimitEnvironment = process.env,
) => {
  const config = resolvePublicProbeRateLimit(nodeEnv, env);
  return rateLimit({
    ...config,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'rate-limited' },
  });
};
