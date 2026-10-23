import { resolveListenHost } from './runtime';

describe('resolveListenHost', () => {
  it('defaults to IPv4 loopback for a missing or blank value', () => {
    expect(resolveListenHost()).toBe('127.0.0.1');
    expect(resolveListenHost('  ')).toBe('127.0.0.1');
  });

  it.each(['127.0.0.1', '::1', '0.0.0.0', '::'])('allows the explicit supported host %s', host => {
    expect(resolveListenHost(host)).toBe(host);
  });

  it.each(['localhost', '10.0.0.5', 'example.test', '0.0.0.0:5001'])('rejects unsupported host %s', host => {
    expect(() => resolveListenHost(host)).toThrow('Invalid AILAODA_LISTEN_HOST');
  });
});
