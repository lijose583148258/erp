import { formatLogEntry, sanitizeLogValue } from './logSanitizer';

describe('central log formatting boundary', () => {
  it('retains value-free structured diagnostics', () => {
    const output = formatLogEntry({
      timestamp: '2026-07-18 12:00:00',
      level: 'warn',
      message: 'Request validation failed',
      method: 'POST',
      path: '/credential-check',
      fields: ['password', 'mfaCode'],
      errorCount: 2,
    });

    expect(output).toContain('Request validation failed');
    expect(output).toContain('"method":"POST"');
    expect(output).toContain('"path":"/credential-check"');
    expect(output).toContain('"fields":["password","mfaCode"]');
    expect(output).toContain('"errorCount":2');
  });

  it('redacts secrets from keys, messages, URLs, errors, and nested metadata', () => {
    const output = formatLogEntry({
      timestamp: '2026-07-18 12:00:00',
      level: 'error',
      message: 'Bearer bearer-token password=message-password postgres://user:url-password@db/erp',
      authorization: 'Bearer header-token',
      cookie: 'session=cookie-token',
      nested: {
        password: 'nested-password',
        refreshToken: 'nested-refresh-token',
        apiKey: 'nested-api-key',
        safeCode: 'P2002',
        error: new Error('apiKey=error-api-key'),
      },
    });

    for (const secret of [
      'bearer-token',
      'message-password',
      'url-password',
      'header-token',
      'cookie-token',
      'nested-password',
      'nested-refresh-token',
      'nested-api-key',
      'error-api-key',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('"safeCode":"P2002"');
  });

  it('bounds recursive and circular metadata instead of crashing the logger', () => {
    const circular: Record<string, unknown> = { status: 'failed' };
    circular.self = circular;

    expect(sanitizeLogValue(circular)).toEqual({
      status: 'failed',
      self: '[CIRCULAR]',
    });
  });

  it('fails closed when metadata access throws', () => {
    const hostileMetadata = {};
    Object.defineProperty(hostileMetadata, 'password', {
      enumerable: true,
      get: () => {
        throw new Error('getter-secret');
      },
    });

    const output = formatLogEntry({
      timestamp: '2026-07-18 12:00:00',
      level: 'error',
      message: 'Metadata formatting failed',
      hostileMetadata,
    });

    expect(output).toContain('[UNSERIALIZABLE]');
    expect(output).not.toContain('getter-secret');
  });
});
