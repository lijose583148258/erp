const TRANSIENT_PATTERNS = [
  'database is locked',
  'SQLITE_BUSY',
  'Transaction already closed',
  'P2034',
  'P2028',
];

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isTransientDbError = (error: unknown) => {
  if (!error) return false;

  const err = error as any;
  const code = String(err.code || '');
  const message = String(err.message || '');

  return (
    TRANSIENT_PATTERNS.some(pattern => code.includes(pattern) || message.includes(pattern)) ||
    /database is locked|SQLITE_BUSY/i.test(message)
  );
};

export async function withDbRetry<T>(
  operation: () => Promise<T>,
  options: {
    label?: string;
    attempts?: number;
    baseDelayMs?: number;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 60;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt >= attempts) {
        throw error;
      }

      await delay(baseDelayMs * attempt);
    }
  }

  throw lastError;
}
