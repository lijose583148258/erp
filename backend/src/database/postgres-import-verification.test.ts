import { assertImportedCountsMatch } from './postgres-import-verification';

describe('assertImportedCountsMatch', () => {
  it('accepts a fully reconciled import', () => {
    expect(() => assertImportedCountsMatch([
      { name: 'orders', expectedRowCount: 3, actualRowCount: 3, matches: true },
    ])).not.toThrow();
  });

  it('rejects mismatches before the caller can commit', () => {
    expect(() => assertImportedCountsMatch([
      { name: 'orders', expectedRowCount: 3, actualRowCount: 2, matches: false },
    ])).toThrow('PostgreSQL import verification failed before commit');
  });
});
