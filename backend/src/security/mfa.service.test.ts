import { evaluateLoginMfa, generateTotpCode, verifyTotpCode } from './mfa.service';

describe('MFA service', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AILAODA_MFA_REQUIRED_ROLES;
    delete process.env.AILAODA_MFA_TOTP_SECRET;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('does not require MFA when no required roles are configured', () => {
    expect(evaluateLoginMfa('admin')).toEqual({ required: false, reason: 'not_configured' });
  });

  it('requires MFA only for configured roles', () => {
    process.env.AILAODA_MFA_REQUIRED_ROLES = 'admin,manager';
    process.env.AILAODA_MFA_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

    expect(evaluateLoginMfa('sales')).toEqual({ required: false, reason: 'role_not_required' });
    expect(evaluateLoginMfa('admin')).toEqual({ required: true, ok: false, reason: 'missing_code' });
  });

  it('validates standard 6-digit TOTP codes', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const timestamp = Date.UTC(2026, 6, 8, 12, 0, 0);
    const code = generateTotpCode(secret, timestamp);

    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotpCode(secret, code, timestamp)).toBe(true);
    expect(verifyTotpCode(secret, '000000', timestamp, 0)).toBe(code === '000000');
  });

  it('accepts configured MFA code for required role', () => {
    process.env.AILAODA_MFA_REQUIRED_ROLES = 'admin';
    process.env.AILAODA_MFA_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
    const code = generateTotpCode(process.env.AILAODA_MFA_TOTP_SECRET);

    expect(evaluateLoginMfa('admin', code)).toEqual({ required: true, ok: true });
    expect(evaluateLoginMfa('admin', '123456')).toEqual({ required: true, ok: false, reason: 'invalid_code' });
  });
});
