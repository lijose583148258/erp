import { ensureBaseSchema } from './base-schema-bootstrap';

describe('empty database base-schema bootstrap', () => {
  it('keeps an existing complete database on the additive repair path', async () => {
    const applyDeclarativeSchema = jest.fn(async () => undefined);

    await expect(ensureBaseSchema({
      databaseEngine: 'sqlite',
      listTableNames: async () => ['users', 'customers', 'orders', 'suppliers'],
      applyDeclarativeSchema,
    })).resolves.toEqual({ action: 'existing', tableCount: 4 });

    expect(applyDeclarativeSchema).not.toHaveBeenCalled();
  });

  it('creates and verifies the base schema for an empty SQLite database', async () => {
    let tableNames: string[] = [];
    const applyDeclarativeSchema = jest.fn(async () => {
      tableNames = ['users', 'customers', 'orders', 'suppliers'];
    });

    await expect(ensureBaseSchema({
      databaseEngine: 'sqlite',
      listTableNames: async () => tableNames,
      applyDeclarativeSchema,
    })).resolves.toEqual({ action: 'created', tableCount: 4 });

    expect(applyDeclarativeSchema).toHaveBeenCalledTimes(1);
  });

  it('fails closed for a non-empty partial database', async () => {
    const applyDeclarativeSchema = jest.fn(async () => undefined);

    await expect(ensureBaseSchema({
      databaseEngine: 'sqlite',
      listTableNames: async () => ['users'],
      applyDeclarativeSchema,
    })).rejects.toThrow('partial base schema; missing customers, orders');

    expect(applyDeclarativeSchema).not.toHaveBeenCalled();
  });

  it('verifies required tables after declarative schema creation', async () => {
    let tableNames: string[] = [];

    await expect(ensureBaseSchema({
      databaseEngine: 'sqlite',
      listTableNames: async () => tableNames,
      applyDeclarativeSchema: async () => {
        tableNames = ['users', 'customers'];
      },
    })).rejects.toThrow('did not produce required tables: orders');
  });

  it('does not run the SQLite repair path against PostgreSQL', async () => {
    await expect(ensureBaseSchema({
      databaseEngine: 'postgresql',
      listTableNames: async () => [],
      applyDeclarativeSchema: async () => undefined,
    })).rejects.toThrow('supports the SQLite runtime only');
  });
});
