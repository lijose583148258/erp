import { withDbRetry } from './dbRetry';

describe('database transaction retry classification', () => {
  it('does not replay an ambiguous P1017 write after connection loss', async () => {
    const error = Object.assign(new Error('Server has closed the connection.'), { code: 'P1017' });
    const operation = jest.fn().mockRejectedValue(error);
    await expect(withDbRetry(operation, { baseDelayMs: 0 })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
  const raw = (code: string) => Object.assign(new Error('Raw query failed'), { code: 'P2010', meta: { code } });
  it.each(['40001', '40P01'])('retries a whole operation for PostgreSQL %s wrapped in P2010', async code => {
    const operation = jest.fn().mockRejectedValueOnce(raw(code)).mockResolvedValue('committed once');
    await expect(withDbRetry(operation, { baseDelayMs: 0 })).resolves.toBe('committed once');
    expect(operation).toHaveBeenCalledTimes(2);
  });
  it.each(['23505', '42P01', 'XX000', ''])('does not retry unrelated raw SQL failure %s', async code => {
    const error = raw(code), operation = jest.fn().mockRejectedValue(error);
    await expect(withDbRetry(operation, { baseDelayMs: 0 })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it('does not infer a raw SQL retry from error text alone', async () => {
    const error = Object.assign(new Error('40001 serialization failure'), { code: 'BUSINESS_CONFLICT' });
    const operation = jest.fn().mockRejectedValue(error);
    await expect(withDbRetry(operation, { baseDelayMs: 0 })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it('bounds retries and propagates the final conflict without claiming success', async () => {
    const error = raw('40001'), operation = jest.fn().mockRejectedValue(error);
    await expect(withDbRetry(operation, { baseDelayMs: 0, attempts: 3 })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
