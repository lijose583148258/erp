import { randomUUID } from 'node:crypto';
// Node 22+ runner provides SQLite; application types intentionally still target Node 20.
const { DatabaseSync } = require('node:sqlite');
import prisma from '../config/database';
import { repairReceivableSchema } from './runtime-schema-receivable-repair';
jest.mock('../config/database', () => ({ __esModule: true, default: { $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn() } }));

describe('SQLite quantity cancellation schema on fresh and upgraded installations', () => {
  let db: { exec(sql: string): void; close(): void;
    prepare(sql: string): { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown; run(...args: unknown[]): unknown } };
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE customers(id INTEGER PRIMARY KEY); CREATE TABLE orders(id INTEGER PRIMARY KEY);
      CREATE TABLE order_items(id INTEGER PRIMARY KEY); CREATE TABLE users(id INTEGER PRIMARY KEY);
      INSERT INTO customers VALUES(1); INSERT INTO orders VALUES(1); INSERT INTO order_items VALUES(3); INSERT INTO users VALUES(1);`);
    (prisma.$queryRawUnsafe as jest.Mock).mockImplementation(async (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args));
    (prisma.$executeRawUnsafe as jest.Mock).mockImplementation(async (sql: string) => { db.exec(sql); return 1; });
  });
  afterEach(() => db.close());
  const insert = (type: string, line: number | null, quantity: number | null, key: string | null, fingerprint: string | null) => db.prepare(`
    INSERT INTO receivable_adjustments(adjustment_no,adjustment_type,customer_id,order_id,amount,reason,created_by,order_item_id,cancelled_quantity,request_key,request_fingerprint)
    VALUES(?, ?, 1, 1, 0, 'test reason', 1, ?, ?, ?, ?)`).run(randomUUID(), type, line, quantity, key, fingerprint);

  it.each(['repair-created', 'prisma-created', 'legacy-upgrade'])('enforces typed, finite, unique requests on %s schema', async mode => {
    if (mode !== 'repair-created') db.exec(`CREATE TABLE receivable_adjustments(
      id INTEGER PRIMARY KEY, adjustment_no TEXT, adjustment_type TEXT NOT NULL, customer_id INTEGER, order_id INTEGER,
      amount REAL, reason TEXT, created_by INTEGER, status TEXT DEFAULT 'pending', created_at TEXT
      ${mode === 'prisma-created' ? ', order_item_id INTEGER REFERENCES order_items(id), cancelled_quantity REAL, request_key TEXT, request_fingerprint TEXT' : ''}
    ); INSERT INTO receivable_adjustments(id,adjustment_no,adjustment_type,customer_id,order_id,amount,reason,created_by) VALUES(1,'legacy','credit_memo',1,1,20,'prior credit',1);`);
    await repairReceivableSchema({ entries: [] });
    await repairReceivableSchema({ entries: [] });
    if (mode !== 'repair-created') expect(db.prepare('SELECT amount,order_item_id,cancelled_quantity,request_key FROM receivable_adjustments WHERE id=1').get())
      .toMatchObject({ amount: 20, order_item_id: null, cancelled_quantity: null, request_key: null });
    expect(() => insert('credit_memo', null, null, null, null)).not.toThrow();
    expect(() => insert('order_quantity_cancellation', 3, 60, 'request-1', 'hash')).not.toThrow();
    for (const quantity of [null, 0, -1, Infinity, NaN]) expect(() => insert('order_quantity_cancellation', 3, quantity, 'bad', 'hash')).toThrow();
    expect(() => insert('order_quantity_cancellation', null, 1, 'bad', 'hash')).toThrow();
    expect(() => insert('order_quantity_cancellation', 999, 1, 'bad', 'hash')).toThrow();
    expect(() => insert('order_quantity_cancellation', 3, 1, null, 'hash')).toThrow();
    expect(() => insert('order_quantity_cancellation', 3, 1, 'bad', null)).toThrow();
    expect(() => insert('order_quantity_cancellation', 3, 1, 'request-1', 'hash')).toThrow();
    expect(() => insert('credit_memo', 3, 1, null, null)).toThrow();
    expect(() => db.exec("UPDATE receivable_adjustments SET cancelled_quantity=-1 WHERE request_key='request-1'")).toThrow();
    expect(() => db.exec("UPDATE receivable_adjustments SET adjustment_type='credit_memo' WHERE request_key='request-1'")).toThrow();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA integrity_check').get()).toMatchObject({ integrity_check: 'ok' });
  });
});
