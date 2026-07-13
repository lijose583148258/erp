import { runtime } from '../config/runtime';
import { compileProviderSql } from './raw-sql-compat';

describe('compileProviderSql', () => {
  const originalEngine = runtime.databaseEngine;

  afterEach(() => {
    runtime.databaseEngine = originalEngine;
  });

  it('keeps SQLite placeholders unchanged', () => {
    runtime.databaseEngine = 'sqlite';
    expect(compileProviderSql('SELECT * FROM customers WHERE id = ? AND status = ?')).toBe(
      'SELECT * FROM customers WHERE id = ? AND status = ?',
    );
  });

  it('uses numbered PostgreSQL placeholders in parameter order', () => {
    runtime.databaseEngine = 'postgresql';
    expect(compileProviderSql('SELECT * FROM customers WHERE id = ? AND status = ?')).toBe(
      'SELECT * FROM customers WHERE id = $1 AND status = $2',
    );
  });
});
