import fs from 'node:fs';
import path from 'node:path';
const { DatabaseSync } = require('node:sqlite');
jest.mock('../config/database', () => ({ __esModule: true, default: { $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn() } }));
import prisma from '../config/database';
import { repairShipmentSubmissionSchema, repairShipmentReservationSchema } from './runtime-schema-core-repair';

test.each(['legacy', 'partial', 'current'])('additive shipment identity upgrade preserves %s facts and nullable history, twice', async mode => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE shipments(id INTEGER PRIMARY KEY, shipment_no TEXT NOT NULL, quantity REAL NOT NULL,
      batch_no TEXT, status TEXT NOT NULL${mode === 'legacy' ? '' : ', submission_key TEXT'}${mode === 'current' ? ', submission_fingerprint TEXT, submission_json TEXT' : ''});
      INSERT INTO shipments(id,shipment_no,quantity,batch_no,status) VALUES(1,'SHP-OLD',1.5,'LOT-OLD','delivered');`);
    if (mode === 'current') db.exec(`INSERT INTO shipments VALUES(2,'SHP-NEW',2,'LOT-NEW','pending','existing-request','original-hash','original-json');`);
    const before = db.prepare('SELECT id,shipment_no,quantity,batch_no,status FROM shipments ORDER BY id').all();
    (prisma.$queryRawUnsafe as jest.Mock).mockImplementation(async (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args));
    (prisma.$executeRawUnsafe as jest.Mock).mockImplementation(async (sql: string, ...args: unknown[]) => { db.prepare(sql).run(...args); return 1; });
    const report = { entries: [] }; await repairShipmentSubmissionSchema(report); await repairShipmentSubmissionSchema(report);
    expect(db.prepare('SELECT id,shipment_no,quantity,batch_no,status FROM shipments ORDER BY id').all()).toEqual(before);
    expect(db.prepare('SELECT submission_key,submission_fingerprint,submission_json FROM shipments WHERE id=1').get())
      .toEqual({ submission_key: null, submission_fingerprint: null, submission_json: null });
    if (mode === 'current') expect(db.prepare('SELECT submission_key,submission_fingerprint,submission_json FROM shipments WHERE id=2').get())
      .toEqual({ submission_key: 'existing-request', submission_fingerprint: 'original-hash', submission_json: 'original-json' });
    db.exec(`INSERT INTO shipments(id,shipment_no,quantity,status) VALUES(3,'NULL-2',1,'pending');
      INSERT INTO shipments(id,shipment_no,quantity,status,submission_key) VALUES(4,'KEYED',1,'pending','unique-request');`);
    expect(() => db.exec(`INSERT INTO shipments(id,shipment_no,quantity,status,submission_key) VALUES(5,'DUP',1,'pending','unique-request');`)).toThrow(/UNIQUE/);
  } finally { db.close(); }
});
test('PostgreSQL migration is additive, nullable, rerunnable and does not rewrite old shipments', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../prisma/postgres-migrations/202610150001_shipment-submission/migration.sql'), 'utf8');
  for (const column of ['submission_key', 'submission_fingerprint', 'submission_json']) expect(sql).toContain(`ADD COLUMN IF NOT EXISTS "${column}" TEXT`);
  expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "shipments_submission_key_key"');
  expect(sql).not.toMatch(/\b(?:DROP|DELETE|UPDATE|NOT NULL)\b/i);
});

test.each(['legacy', 'partial', 'current'])('reservation upgrade preserves %s history and stock FK on repeat', async mode => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE stock_balances(id INTEGER PRIMARY KEY, quantity REAL); INSERT INTO stock_balances VALUES(1,40);
      CREATE TABLE shipments(id INTEGER PRIMARY KEY, quantity REAL, batch_no TEXT${mode === 'legacy' ? '' : ', reservation_balance_id INTEGER REFERENCES stock_balances(id) ON DELETE RESTRICT ON UPDATE CASCADE'}${mode === 'current' ? ', reservation_quantity REAL, reservation_state TEXT, reservation_audit_id INTEGER' : ''});
      INSERT INTO shipments(id,quantity,batch_no) VALUES(1,30,'OLD');`);
    (prisma.$queryRawUnsafe as jest.Mock).mockImplementation(async (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args));
    (prisma.$executeRawUnsafe as jest.Mock).mockImplementation(async (sql: string, ...args: unknown[]) => { db.prepare(sql).run(...args); return 1; });
    if (mode === 'current') db.exec(`INSERT INTO shipments VALUES(2,30,'HELD',1,30,'reserved',100)`);
    const report = { entries: [] }; await repairShipmentReservationSchema(report); await repairShipmentReservationSchema(report);
    expect(db.prepare('SELECT * FROM shipments WHERE id=1').get()).toEqual({ id: 1, quantity: 30, batch_no: 'OLD', reservation_balance_id: null,
      reservation_quantity: null, reservation_state: null, reservation_audit_id: null });
    if (mode === 'current') expect(db.prepare('SELECT * FROM shipments WHERE id=2').get()).toMatchObject({ reservation_state: 'reserved', reservation_audit_id: 100 });
    expect(() => db.exec('UPDATE shipments SET reservation_balance_id=999 WHERE id=1')).toThrow(/FOREIGN KEY/);
    db.exec('UPDATE shipments SET reservation_balance_id=1 WHERE id=1'); expect(() => db.exec('DELETE FROM stock_balances WHERE id=1')).toThrow(/FOREIGN KEY/);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); expect(db.prepare('SELECT quantity FROM stock_balances').get()).toEqual({ quantity: 40 });
  } finally { db.close(); }
});
