/**
 * Retry only a pure read after a structured connection-closed error.
 * Never wrap writes, transactions containing writes, or HTTP response emission:
 * a disconnected write may already have committed. Keep withDbRetry unchanged.
 */
export async function withReadOnlyDbRetry<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      const connectionClosed = typeof error === 'object' && error !== null
        && 'code' in error && error.code === 'P1017';
      if (!connectionClosed || attempt >= 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 60 * attempt));
    }
  }
}
