import { withReadOnlyDbRetry } from './readOnlyDbRetry';

const closed = () => Object.assign(new Error('Server has closed the connection.'), { code: 'P1017' });

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

it('reads healthy data once without adding a wait', async () => {
  const read = jest.fn().mockResolvedValue('current');
  await expect(withReadOnlyDbRetry(read)).resolves.toBe('current');
  expect(read).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('recovers four stale pooled connections with five bounded pure reads', async () => {
  const read = jest.fn().mockResolvedValue('current');
  for (let index = 0; index < 4; index++) read.mockRejectedValueOnce(closed());
  const result = withReadOnlyDbRetry(read);
  await jest.runAllTimersAsync();
  await expect(result).resolves.toBe('current');
  expect(read).toHaveBeenCalledTimes(5);
  expect(performance.now()).toBe(600);
});

it('propagates persistent connection failure after five reads and 600ms of waits', async () => {
  const error = closed(), read = jest.fn().mockRejectedValue(error);
  const result = withReadOnlyDbRetry(read).catch(value => value);
  await jest.runAllTimersAsync();
  expect(await result).toBe(error);
  expect(read).toHaveBeenCalledTimes(5);
  expect(performance.now()).toBe(600);
});

it.each([
  Object.assign(new Error('P1017 appears only in text'), { code: 'P2021' }),
  new Error('P1017 Server has closed the connection.'),
  new Error('P1001 appears only in unstructured text'),
  Object.assign(new Error('Invalid business input'), { code: 'BUSINESS_ERROR' }),
])('never retries unrelated or unstructured errors: %s', async error => {
  const read = jest.fn().mockRejectedValue(error);
  await expect(withReadOnlyDbRetry(read)).rejects.toBe(error);
  expect(read).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('does not admit a wait or another read after a slow failed query exhausts the budget', async () => {
  const error = closed(), read = jest.fn().mockImplementation(async () => {
    jest.advanceTimersByTime(1001);
    throw error;
  });
  await expect(withReadOnlyDbRetry(read)).rejects.toBe(error);
  expect(read).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('does not issue a new read when a timer wakes beyond the monotonic retry budget', async () => {
  const error = closed(), read = jest.fn().mockRejectedValue(error);
  const result = withReadOnlyDbRetry(read).catch(value => value);
  await Promise.resolve();
  jest.advanceTimersByTime(1100);
  await jest.runAllTimersAsync();
  expect(await result).toBe(error);
  expect(read).toHaveBeenCalledTimes(1);
});

it('does not pretend the retry admission budget cancels a successful in-flight query', async () => {
  const read = jest.fn().mockImplementation(async () => {
    jest.advanceTimersByTime(1100);
    return 'current';
  });
  await expect(withReadOnlyDbRetry(read)).resolves.toBe('current');
  expect(read).toHaveBeenCalledTimes(1);
});

it('recovers a structured P1001 pure-read failure without fabricating a zero result', async () => {
  const error = Object.assign(new Error('Cannot reach database'), { code: 'P1001' });
  const read = jest.fn().mockRejectedValueOnce(error).mockResolvedValue(37);
  const result = withReadOnlyDbRetry(read);
  await jest.runAllTimersAsync();
  await expect(result).resolves.toBe(37);
  expect(read).toHaveBeenCalledTimes(2);
});

it('bounds persistent P1001 reads without disconnecting the shared pool', async () => {
  const error = Object.assign(new Error('Cannot reach database'), { code: 'P1001' });
  const read = jest.fn().mockRejectedValue(error);
  const result = withReadOnlyDbRetry(read).catch(value => value);
  await jest.runAllTimersAsync();
  expect(await result).toBe(error);
  expect(read).toHaveBeenCalledTimes(5);
  expect(performance.now()).toBe(600);
});
