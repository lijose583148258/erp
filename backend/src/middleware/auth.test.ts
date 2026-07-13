import { isPasswordChangeRequiredAllowedRoute } from './auth';

describe('password change required route gate', () => {
  it('allows only self-service auth routes while password change is required', () => {
    expect(isPasswordChangeRequiredAllowedRoute('GET', '/api/auth/me')).toBe(true);
    expect(isPasswordChangeRequiredAllowedRoute('POST', '/api/auth/logout')).toBe(true);
    expect(isPasswordChangeRequiredAllowedRoute('PUT', '/api/auth/password')).toBe(true);
    expect(isPasswordChangeRequiredAllowedRoute('GET', '/api/v1/auth/me?fresh=1')).toBe(true);
    expect(isPasswordChangeRequiredAllowedRoute('PUT', '/api/v1/auth/password')).toBe(true);
  });

  it('blocks business and token refresh routes while password change is required', () => {
    expect(isPasswordChangeRequiredAllowedRoute('GET', '/api/customers')).toBe(false);
    expect(isPasswordChangeRequiredAllowedRoute('GET', '/api/v1/orders')).toBe(false);
    expect(isPasswordChangeRequiredAllowedRoute('POST', '/api/auth/refresh')).toBe(false);
    expect(isPasswordChangeRequiredAllowedRoute('POST', '/api/v1/auth/login')).toBe(false);
  });
});
