jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: { compare: jest.fn(), hash: jest.fn() },
}));

import bcrypt from 'bcryptjs';
import { comparePassword, hashPassword, PasswordWorkCapacityError } from './auth-password-work.service';

const compare = bcrypt.compare as jest.Mock;
const hash = bcrypt.hash as jest.Mock;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('shared password work capacity', () => {
  beforeEach(() => { jest.resetAllMocks(); });

  it('shares two active slots between hash and compare, preserving FIFO', async () => {
    const started: string[] = [];
    const work: Array<ReturnType<typeof deferred<any>>> = [];
    let running = 0;
    let maximum = 0;
    const begin = (name: string) => {
      started.push(name);
      running += 1;
      maximum = Math.max(maximum, running);
      const item = deferred<any>();
      work.push(item);
      return item.promise.finally(() => { running -= 1; });
    };
    compare.mockImplementation((password: string) => begin(password));
    hash.mockImplementation((password: string) => begin(password));

    const results = [comparePassword('first', 'hash'), hashPassword('second'),
      comparePassword('third', 'hash'), hashPassword('fourth')];
    expect(started).toEqual(['first', 'second']);
    work[0].resolve(true);
    await results[0];
    await flush();
    const newcomer = comparePassword('fifth', 'hash');
    expect(started).toEqual(['first', 'second', 'third']);
    work[1].resolve('second-hash');
    await results[1];
    await flush();
    expect(started).toEqual(['first', 'second', 'third', 'fourth']);
    work[2].resolve(false);
    await results[2];
    await flush();
    expect(started).toEqual(['first', 'second', 'third', 'fourth', 'fifth']);
    work[3].resolve('fourth-hash');
    work[4].resolve(true);
    await expect(Promise.all([...results, newcomer])).resolves.toEqual([
      true, 'second-hash', false, 'fourth-hash', true,
    ]);
    expect(maximum).toBe(2);
  });

  it('accepts exactly 64 pending jobs in addition to two active jobs', async () => {
    const blockers = [deferred<boolean>(), deferred<boolean>()];
    compare.mockImplementationOnce(() => blockers[0].promise)
      .mockImplementationOnce(() => blockers[1].promise)
      .mockResolvedValue(true);
    const accepted = Array.from({ length: 66 }, (_, index) => comparePassword(`request-${index}`, 'hash'));
    expect(compare).toHaveBeenCalledTimes(2);
    const rejected = comparePassword('do-not-leak-password', 'do-not-leak-hash');
    await expect(rejected).rejects.toBeInstanceOf(PasswordWorkCapacityError);
    await expect(rejected).rejects.toThrow('Password processing capacity is temporarily full.');
    expect(compare).toHaveBeenCalledTimes(2);
    blockers.forEach(item => item.resolve(true));
    await expect(Promise.all(accepted)).resolves.toHaveLength(66);
    expect(compare).toHaveBeenCalledTimes(66);
    await expect(comparePassword('after-capacity', 'hash')).resolves.toBe(true);
  });

  it('reserves a released slot for queued work before a new arrival', async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const queued = deferred<boolean>();
    compare.mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => queued.promise)
      .mockResolvedValue(true);
    const a = comparePassword('a', 'hash');
    const b = comparePassword('b', 'hash');
    const c = comparePassword('c', 'hash');
    first.resolve(true);
    // This continuation runs after the release but before the queued job completes.
    const d = a.then(() => comparePassword('d', 'hash'));
    await a;
    await flush();
    expect(compare.mock.calls.map(call => call[0])).toEqual(['a', 'b', 'c']);
    second.resolve(true);
    queued.resolve(true);
    await Promise.all([b, c, d]);
    expect(compare.mock.calls.map(call => call[0])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('releases a slot after an asynchronous failure without retrying', async () => {
    const failed = deferred<boolean>();
    const other = deferred<string>();
    const failure = new Error('bcrypt comparison failed');
    compare.mockImplementationOnce(() => failed.promise).mockResolvedValue(false);
    hash.mockImplementationOnce(() => other.promise);
    const a = comparePassword('bad', 'hash');
    const b = hashPassword('other');
    const c = comparePassword('queued', 'hash');
    const assertion = expect(a).rejects.toBe(failure);
    failed.reject(failure);
    await assertion;
    await expect(c).resolves.toBe(false);
    expect(compare).toHaveBeenCalledTimes(2);
    other.resolve('other-hash');
    await b;
  });

  it('releases a slot after a synchronous bcrypt throw without retrying', async () => {
    const failure = new Error('bcrypt synchronously rejected');
    compare.mockImplementationOnce(() => { throw failure; }).mockResolvedValue(true);
    await expect(comparePassword('bad', 'hash')).rejects.toBe(failure);
    await expect(Promise.all([comparePassword('one', 'hash'), comparePassword('two', 'hash')]))
      .resolves.toEqual([true, true]);
    expect(compare).toHaveBeenCalledTimes(3);
  });

  it('passes exact inputs and results once and fixes hash cost at 12', async () => {
    compare.mockResolvedValueOnce(false);
    hash.mockResolvedValueOnce('unchanged-hash-value');
    await expect(comparePassword('password-value', 'stored-hash-value')).resolves.toBe(false);
    await expect(hashPassword('new-password-value')).resolves.toBe('unchanged-hash-value');
    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare).toHaveBeenCalledWith('password-value', 'stored-hash-value');
    expect(hash).toHaveBeenCalledTimes(1);
    expect(hash).toHaveBeenCalledWith('new-password-value', 12);
  });
});
