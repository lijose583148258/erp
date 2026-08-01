import {
  CRITICAL_TABLE_NAMES,
  IMPORT_PHASES,
  buildTableRowCountMap,
  quoteIdentifier,
  stringifyMigrationJson,
} from './postgres-migration-contract';

describe('PostgreSQL migration contract', () => {
  it('keeps critical tables unique and assigned to an import phase', () => {
    const phasedTables = IMPORT_PHASES.flatMap((phase) => phase.tables);
    expect(new Set(CRITICAL_TABLE_NAMES).size).toBe(CRITICAL_TABLE_NAMES.length);
    expect(new Set(phasedTables).size).toBe(phasedTables.length);
    for (const table of CRITICAL_TABLE_NAMES) {
      expect(phasedTables).toContain(table);
    }
  });

  it('preserves the dependency-safe phase order', () => {
    expect(IMPORT_PHASES.map((phase) => phase.phase)).toEqual([
      'foundation',
      'master-data',
      'commercial-transactions',
      'inventory-ledger',
      'operations',
    ]);
  });

  it('quotes PostgreSQL identifiers and maps snapshot row counts', () => {
    expect(quoteIdentifier('order"items')).toBe('"order""items"');
    expect(buildTableRowCountMap([
      { name: 'orders', rowCount: 2 },
      { name: 'order_items', rowCount: 5 },
    ])).toEqual(new Map([
      ['orders', 2],
      ['order_items', 5],
    ]));
  });

  it('serializes SQLite bigint snapshot values as lossless decimal strings', () => {
    const unsafeInteger = 9_007_199_254_740_993n;
    const serialized = stringifyMigrationJson({
      id: unsafeInteger,
      nested: [{ amount_decimal: 1_000n }],
      ordinaryNumber: 12.5,
    });

    expect(JSON.parse(serialized)).toEqual({
      id: '9007199254740993',
      nested: [{ amount_decimal: '1000' }],
      ordinaryNumber: 12.5,
    });
  });
});
