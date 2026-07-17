import { runtime } from '../config/runtime';

type UnsafeRawExecutor = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

export const compileProviderSql = (sql: string) => {
  if (runtime.databaseEngine !== 'postgresql') return sql;

  let parameterIndex = 0;
  return sql.replace(/\?/g, () => `$${++parameterIndex}`);
};

export const queryRawCompat = <T>(executor: UnsafeRawExecutor, sql: string, ...values: unknown[]) =>
  executor.$queryRawUnsafe<T>(compileProviderSql(sql), ...values);

export const executeRawCompat = (executor: UnsafeRawExecutor, sql: string, ...values: unknown[]) =>
  executor.$executeRawUnsafe(compileProviderSql(sql), ...values);
