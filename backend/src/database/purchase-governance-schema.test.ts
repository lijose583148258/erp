import fs from 'node:fs';
import path from 'node:path';
// The established test runner is Node 22+; application types still target Node 20.
const { DatabaseSync } = require('node:sqlite');
import prisma from '../config/database';
import { repairCoreSchema } from './runtime-schema-core-repair';
import type { SchemaRepairReport } from './runtime-schema-repair-utils';

jest.mock('../config/database', () => ({ __esModule: true, default: {
  $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn(),
} }));

const columns = ['supplier_payable_basis_json', 'incoming_quality_plan_json'];
const storedBasis = ' {"schema":"historical-evidence/v1","amount":125.50} ';
const storedPlan = '{"schema":"historical-plan/v1","items":[{"code":"PH"}]}';

describe('additive purchase governance snapshot schema', () => {
  let db: { exec(sql: string): void; close(): void; prepare(sql: string): {
    all(...args: unknown[]): Array<Record<string, unknown>>;
    get(...args: unknown[]): Record<string, unknown>;
    run(...args: unknown[]): unknown;
  } };

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE orders(id INTEGER PRIMARY KEY);
      CREATE TABLE customers(id INTEGER PRIMARY KEY);
      CREATE TABLE suppliers(id INTEGER PRIMARY KEY);
      CREATE TABLE shipments(id INTEGER PRIMARY KEY);`);
    (prisma.$queryRawUnsafe as jest.Mock).mockImplementation(async (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args));
    (prisma.$executeRawUnsafe as jest.Mock).mockImplementation(async (sql: string) => { db.exec(sql); return 1; });
  });
  afterEach(() => db.close());

  it.each(['legacy-upgrade', 'fresh-column-shape'])('repairs %s twice without fabricating or rewriting snapshots', async mode => {
    // The fresh shape models Prisma's nullable columns; it is not an ORM-generation test.
    db.exec(`CREATE TABLE purchase_orders(
      id INTEGER PRIMARY KEY, quantity REAL NOT NULL, price REAL NOT NULL,
      currency TEXT NOT NULL, exchange_rate REAL NOT NULL, revision INTEGER NOT NULL,
      tax_amount REAL NOT NULL, landed_cost_amount REAL NOT NULL, updated_at TEXT NOT NULL
      ${mode === 'fresh-column-shape' ? ', supplier_payable_basis_json TEXT, incoming_quality_plan_json TEXT' : ''}
    ); INSERT INTO purchase_orders(id,quantity,price,currency,exchange_rate,revision,tax_amount,landed_cost_amount,updated_at)
      VALUES(1,7.5,12.3,'USD',0.125,3,80,900,'2026-10-01T00:00:00Z');`);
    if (mode === 'fresh-column-shape') {
      db.prepare(`INSERT INTO purchase_orders(id,quantity,price,currency,exchange_rate,revision,tax_amount,landed_cost_amount,updated_at,
        supplier_payable_basis_json,incoming_quality_plan_json) VALUES(2,1,0,'CNY',1,9,0,0,'prior',?,?)`).run(storedBasis, storedPlan);
    }
    const prior = db.prepare('SELECT id,quantity,price,currency,exchange_rate,revision,tax_amount,landed_cost_amount,updated_at FROM purchase_orders ORDER BY id').all();
    for (let run = 0; run < 2; run += 1) {
      const report: SchemaRepairReport = { entries: [] };
      await repairCoreSchema(report);
      const expectedAction = mode === 'legacy-upgrade' && run === 0 ? 'added' : 'exists';
      expect(report.entries.filter(entry => columns.some(column => entry.target === `purchase_orders.${column}`)))
        .toEqual(columns.map(column => ({ kind: 'column', target: `purchase_orders.${column}`, action: expectedAction })));
      expect(db.prepare('SELECT id,quantity,price,currency,exchange_rate,revision,tax_amount,landed_cost_amount,updated_at FROM purchase_orders ORDER BY id').all()).toEqual(prior);
      expect(db.prepare('SELECT supplier_payable_basis_json,incoming_quality_plan_json FROM purchase_orders WHERE id=1').get())
        .toEqual({ supplier_payable_basis_json: null, incoming_quality_plan_json: null });
      for (const column of columns) {
        expect(db.prepare("PRAGMA table_info('purchase_orders')").all().find(row => row.name === column))
          .toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null });
      }
      if (mode === 'fresh-column-shape') expect(db.prepare('SELECT supplier_payable_basis_json,incoming_quality_plan_json FROM purchase_orders WHERE id=2').get())
        .toEqual({ supplier_payable_basis_json: storedBasis, incoming_quality_plan_json: storedPlan });
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    }
    db.exec(`INSERT INTO purchase_orders(id,quantity,price,currency,exchange_rate,revision,tax_amount,landed_cost_amount,updated_at)
      VALUES(3,1,2,'CNY',1,0,0,2,'new-draft');`);
    expect(db.prepare('SELECT supplier_payable_basis_json,incoming_quality_plan_json FROM purchase_orders WHERE id=3').get())
      .toEqual({ supplier_payable_basis_json: null, incoming_quality_plan_json: null });
  });

  it('keeps Prisma and the PostgreSQL migration additive, nullable and without invented defaults', () => {
    const model = fs.readFileSync(path.join(__dirname, '../../prisma/models/procurement.prisma'), 'utf8');
    for (const [field, column] of [['supplierPayableBasisJson', columns[0]], ['incomingQualityPlanJson', columns[1]]]) {
      expect(model).toMatch(new RegExp(`^\\s*${field}\\s+String\\?\\s+@map\\("${column}"\\)\\s*$`, 'm'));
    }
    const migration = fs.readFileSync(path.join(__dirname,
      '../../prisma/postgres-migrations/202610130001_purchase-governance-snapshots/migration.sql'), 'utf8')
      .replace(/^\s*--.*$/gm, '').trim();
    expect(migration).toBe(`ALTER TABLE "purchase_orders"\n  ADD COLUMN IF NOT EXISTS "supplier_payable_basis_json" TEXT,\n  ADD COLUMN IF NOT EXISTS "incoming_quality_plan_json" TEXT;`);
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|DROP|DEFAULT|NOT\s+NULL)\b/i);
  });
});
