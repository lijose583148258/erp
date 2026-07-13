import { isReleaseDemoCredential, shouldBlockDemoCredentials } from './demo-credentials';

describe('demo credential release boundary', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    delete process.env.AILAODA_BLOCK_DEMO_CREDENTIALS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('rejects published demo credentials in production even without an opt-in flag', () => {
    process.env.NODE_ENV = 'production';

    expect(shouldBlockDemoCredentials()).toBe(true);
    expect(isReleaseDemoCredential('admin', 'admin123')).toBe(true);
    expect(isReleaseDemoCredential('manager', 'manager123')).toBe(true);
  });

  it('keeps demo credentials available only for explicitly enabled non-production fixtures', () => {
    expect(isReleaseDemoCredential('admin', 'admin123')).toBe(false);

    process.env.AILAODA_BLOCK_DEMO_CREDENTIALS = 'true';
    expect(isReleaseDemoCredential('admin', 'admin123')).toBe(true);
    expect(isReleaseDemoCredential('admin', 'wrong')).toBe(false);
  });
});
