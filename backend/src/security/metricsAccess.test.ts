import { hasValidMetricsBearerToken } from './metricsAccess';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('metrics bearer access', () => {
  const originalToken = process.env.AILAODA_METRICS_BEARER_TOKEN;

  beforeEach(() => {
    process.env.AILAODA_METRICS_BEARER_TOKEN = 'metrics-test-token-1234567890';
    delete process.env.AILAODA_METRICS_BEARER_TOKEN_FILE;
  });

  afterAll(() => {
    if (originalToken === undefined) delete process.env.AILAODA_METRICS_BEARER_TOKEN;
    else process.env.AILAODA_METRICS_BEARER_TOKEN = originalToken;
  });

  it('accepts only the configured bearer token', () => {
    expect(hasValidMetricsBearerToken('Bearer metrics-test-token-1234567890')).toBe(true);
    expect(hasValidMetricsBearerToken('Bearer metrics-test-token-123456789x')).toBe(false);
    expect(hasValidMetricsBearerToken('Basic metrics-test-token-1234567890')).toBe(false);
    expect(hasValidMetricsBearerToken(undefined)).toBe(false);
  });

  it('does not accept any token when the collector secret is absent', () => {
    delete process.env.AILAODA_METRICS_BEARER_TOKEN;
    expect(hasValidMetricsBearerToken('Bearer metrics-test-token-1234567890')).toBe(false);
  });

  it('reads the collector token from a mounted secret file', () => {
    const secretFile = path.join(os.tmpdir(), `ailaoda-metrics-${process.pid}.txt`);
    fs.writeFileSync(secretFile, 'metrics-file-token-1234567890', 'utf8');
    try {
      delete process.env.AILAODA_METRICS_BEARER_TOKEN;
      process.env.AILAODA_METRICS_BEARER_TOKEN_FILE = secretFile;
      expect(hasValidMetricsBearerToken('Bearer metrics-file-token-1234567890')).toBe(true);
      expect(hasValidMetricsBearerToken('Bearer wrong-file-token')).toBe(false);
    } finally {
      fs.rmSync(secretFile, { force: true });
    }
  });
});
