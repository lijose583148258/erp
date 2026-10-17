/**
 * Retry only a pure read after a structured connection-closed error.
 * Never wrap writes, transactions containing writes, or HTTP response emission:
 * a disconnected write may already have committed. Keep withDbRetry unchanged.
 */
export const isClosedDbConnectionError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P1017';

export async function withReadOnlyDbRetry<T>(read: () => Promise<T>): Promise<T> {
  // A restarted database can leave several closed connections in the pool.
  // Bound retry admission, not the duration/cancellation of an in-flight query;
  // never disconnect the shared pool and interrupt unrelated writes.
  const startedAt = performance.now();
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      const waitMs = 60 * attempt;
      if (!isClosedDbConnectionError(error) || attempt >= 5
        || performance.now() - startedAt + waitMs >= 1000) throw error;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      if (performance.now() - startedAt >= 1000) throw error;
    }
  }
}
