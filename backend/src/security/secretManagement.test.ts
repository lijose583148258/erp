import {
  clearEphemeralSecretsForTests,
  getJwtSecret,
  getJwtSecretStatus,
  getSecretQualityIssues,
  resolveManagedSecret,
} from './secretManagement';

describe('secret management boundary', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    delete process.env.JWT_SECRET;
    clearEphemeralSecretsForTests();
  });

  afterAll(() => {
    process.env = originalEnv;
    clearEphemeralSecretsForTests();
  });

  it('identifies missing, short, and placeholder secrets', () => {
    expect(getSecretQualityIssues('', 32)).toContain('missing');
    expect(getSecretQualityIssues('short', 32)).toContain('shorter_than_32');
    expect(getSecretQualityIssues('replace_with_a_long_random_secret_before_server_deploy', 32)).toContain('placeholder');
  });

  it('uses a process-local ephemeral JWT secret outside production when none is configured', () => {
    const first = getJwtSecret();
    const second = getJwtSecret();
    const status = getJwtSecretStatus();

    expect(first).toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(status.source).toBe('ephemeral-dev');
    expect(status.configured).toBe(false);
  });

  it('uses configured environment secrets when present', () => {
    process.env.JWT_SECRET = 'a'.repeat(48);

    expect(getJwtSecret()).toBe('a'.repeat(48));
    expect(getJwtSecretStatus()).toMatchObject({
      configured: true,
      source: 'env',
      issues: [],
    });
  });

  it('rejects placeholder JWT secrets in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'replace_with_a_long_random_secret_before_server_deploy';

    expect(() => resolveManagedSecret('JWT_SECRET', {
      minLength: 32,
      requiredInProduction: true,
      allowEphemeralDev: true,
    })).toThrow(/JWT_SECRET must be a non-placeholder value/);
  });

  it('rejects missing production JWT secrets', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;

    expect(() => resolveManagedSecret('JWT_SECRET', {
      minLength: 32,
      requiredInProduction: true,
      allowEphemeralDev: true,
    })).toThrow(/JWT_SECRET must be configured in production/);
  });
});
