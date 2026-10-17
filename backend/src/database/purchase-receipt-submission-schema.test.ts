import fs from 'node:fs';
import path from 'node:path';
// The established test runner is Node 22+; application types still target Node 20.
const { DatabaseSync } = require('node:sqlite');
import prisma from '../config/database';
import { repairReceiptSchema } from './runtime-schema-receipt-repair';
import type { SchemaRepairReport } from './runtime-schema-repair-utils';

jest.mock('../config/database', () => ({ __esModule: true, default: {
  $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn(),
} }));

const columns = ['submission_key', 'submission_fingerprint', 'submission_json'];
const indexName = 'purchase_receipts_purchase_order_id_submission_key_key';
const storedFingerprint = 'a'.repeat(64);
const storedFacts = ' {"schema":"purchase-receipt-submission/v1","receiptNo":"PR-OLD","quantity":1.5} ';
const legacyTable = `CREATE TABLE purchase_receipts(
  id INTEGER PRIMARY KEY, receipt_no TEXT NOT NULL, purchase_order_id INTEGER NOT NULL,
  quantity REAL NOT NULL, accepted_quantity REAL NOT NULL DEFAULT 0,
  rejected_quantity REAL NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT 'kg',
  batch_no TEXT, stock_entry_ref TEXT, discrepancy_reason TEXT, note TEXT,
  received_by INTEGER, received_at TEXT NOT NULL, created_at TEXT NOT NULL
`;
const foreignKeys = `,
  FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id),
  FOREIGN KEY(received_by) REFERENCES users(id)
`;
const factualSelect = `SELECT id,receipt_no,purchase_order_id,quantity,accepted_quantity,rejected_quantity,
  unit,batch_no,stock_entry_ref,discrepancy_reason,note,received_by,received_at,created_at
  FROM purchase_receipts ORDER BY id`;

describe('additive durable purchase receipt submission schema', () => {
  let db: { exec(sql: string): void; close(): void; prepare(sql: string): {
    all(...args: unknown[]): Array<Record<string, unknown>>;
    get(...args: unknown[]): Record<string, unknown>;
    run(...args: unknown[]): unknown;
  } };

  const insertReceipt = (id: number, purchaseOrderId = 1, submissionKey: string | null = null) => {
    db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,quantity,accepted_quantity,
      rejected_quantity,unit,batch_no,stock_entry_ref,discrepancy_reason,note,received_by,received_at,created_at,
      submission_key,submission_fingerprint,submission_json)
      VALUES(?, ?, ?, 2, 1.5, .5, 'kg', 'SUPPLIER-LOT-OLD', 'ENTRY-OLD', 'damaged', 'original note', 5,
        '2026-10-01T00:00:00Z', '2026-10-01T00:00:01Z', ?, ?, ?)`)
      .run(id, `PR-${id}`, purchaseOrderId, submissionKey,
        submissionKey === null ? null : storedFingerprint, submissionKey === null ? null : storedFacts);
  };
  const repair = async () => {
    const report: SchemaRepairReport = { entries: [] };
    await repairReceiptSchema(report);
    return report;
  };

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      CREATE TABLE purchase_orders(id INTEGER PRIMARY KEY);
      CREATE TABLE shipments(id INTEGER PRIMARY KEY);
      CREATE TABLE product_batches(id INTEGER PRIMARY KEY);
      INSERT INTO users VALUES(5); INSERT INTO purchase_orders VALUES(1),(2);`);
    (prisma.$queryRawUnsafe as jest.Mock).mockImplementation(async (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args));
    (prisma.$executeRawUnsafe as jest.Mock).mockImplementation(async (sql: string, ...args: unknown[]) => {
      db.prepare(sql).run(...args); return 1;
    });
  });
  afterEach(() => db.close());

  it.each(['legacy-upgrade', 'existing-current', 'fresh-create'])('repairs %s twice while preserving receipt facts and unknown legacy identity', async mode => {
    if (mode !== 'fresh-create') {
      db.exec(`${legacyTable}${mode === 'existing-current' ? ', submission_key TEXT, submission_fingerprint TEXT, submission_json TEXT' : ''}${foreignKeys});`);
      db.exec(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,quantity,accepted_quantity,
        rejected_quantity,unit,batch_no,stock_entry_ref,discrepancy_reason,note,received_by,received_at,created_at)
        VALUES(1,'PR-1',1,2,1.5,.5,'kg','SUPPLIER-LOT-OLD','ENTRY-OLD','damaged','original note',5,
          '2026-10-01T00:00:00Z','2026-10-01T00:00:01Z');`);
      if (mode === 'existing-current') insertReceipt(2, 1, 'prior-receipt-request');
    }
    let prior = mode === 'fresh-create' ? [] : db.prepare(factualSelect).all();
    for (let run = 0; run < 2; run += 1) {
      const report = await repair();
      const expectedAction = mode === 'legacy-upgrade' && run === 0 ? 'added' : 'exists';
      expect(report.entries.filter(entry => columns.some(column => entry.target === `purchase_receipts.${column}`)))
        .toEqual(columns.map(column => ({ kind: 'column', target: `purchase_receipts.${column}`, action: expectedAction })));
      if (mode === 'fresh-create' && run === 0) {
        insertReceipt(1); insertReceipt(2, 1, 'prior-receipt-request');
        prior = db.prepare(factualSelect).all();
      }
      expect(db.prepare(factualSelect).all()).toEqual(prior);
      expect(db.prepare('SELECT submission_key,submission_fingerprint,submission_json FROM purchase_receipts WHERE id=1').get())
        .toEqual({ submission_key: null, submission_fingerprint: null, submission_json: null });
      for (const column of columns) expect(db.prepare("PRAGMA table_info('purchase_receipts')").all().find(row => row.name === column))
        .toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null });
      if (mode !== 'legacy-upgrade') expect(db.prepare('SELECT submission_key,submission_fingerprint,submission_json FROM purchase_receipts WHERE id=2').get())
        .toEqual({ submission_key: 'prior-receipt-request', submission_fingerprint: storedFingerprint, submission_json: storedFacts });
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    }
    insertReceipt(3);
    expect(db.prepare('SELECT submission_key,submission_fingerprint,submission_json FROM purchase_receipts WHERE id=3').get())
      .toEqual({ submission_key: null, submission_fingerprint: null, submission_json: null });
  });

  it('enforces a PO-scoped key while allowing different POs and multiple unknown legacy keys', async () => {
    await repair();
    insertReceipt(1, 1, 'same-request-key');
    expect(() => insertReceipt(2, 1, 'same-request-key')).toThrow(/UNIQUE constraint failed: purchase_receipts.purchase_order_id, purchase_receipts.submission_key/);
    insertReceipt(3, 2, 'same-request-key');
    insertReceipt(4); insertReceipt(5);
    expect(db.prepare(`PRAGMA index_list('purchase_receipts')`).all().find(row => row.name === indexName))
      .toMatchObject({ unique: 1, partial: 0 });
    expect(db.prepare(`PRAGMA index_info('${indexName}')`).all().map(row => row.name))
      .toEqual(['purchase_order_id', 'submission_key']);
    expect(db.prepare('SELECT COUNT(*) AS count FROM purchase_receipts').get()).toEqual({ count: 4 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });

  it('completes a partial additive upgrade before creating the identity index', async () => {
    db.exec(`${legacyTable}, submission_key TEXT${foreignKeys});`);
    db.exec(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,quantity,received_at,created_at,submission_key)
      VALUES(1,'PR-PARTIAL',1,1,'original','original','preserved-partial-key');`);
    const report = await repair();
    expect(report.entries.filter(entry => columns.some(column => entry.target === `purchase_receipts.${column}`)))
      .toEqual(columns.map((column, position) => ({ kind: 'column', target: `purchase_receipts.${column}`, action: position === 0 ? 'exists' : 'added' })));
    expect(db.prepare('SELECT submission_key,submission_fingerprint,submission_json FROM purchase_receipts').get())
      .toEqual({ submission_key: 'preserved-partial-key', submission_fingerprint: null, submission_json: null });
    expect(db.prepare(`PRAGMA index_info('${indexName}')`).all().map(row => row.name))
      .toEqual(['purchase_order_id', 'submission_key']);
  });

  it('fails rather than silently skipping conflicting pre-existing identities or deleting history', async () => {
    db.exec(`${legacyTable}, submission_key TEXT, submission_fingerprint TEXT, submission_json TEXT${foreignKeys});`);
    insertReceipt(1, 1, 'conflicting-key'); insertReceipt(2, 1, 'conflicting-key');
    const prior = db.prepare('SELECT * FROM purchase_receipts ORDER BY id').all();
    await expect(repair()).rejects.toThrow(/UNIQUE constraint failed/);
    const after = db.prepare('SELECT * FROM purchase_receipts ORDER BY id').all();
    expect(after.map(row => Object.fromEntries(Object.keys(prior[0]).map(column => [column, row[column]])))).toEqual(prior);
    for (const row of after) for (const column of Object.keys(row).filter(column => !(column in prior[0]))) expect(row[column]).toBeNull();
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });

  it('keeps Prisma and PostgreSQL DDL additive, nullable and identically indexed without fabricating identity', () => {
    const model = fs.readFileSync(path.join(__dirname, '../../prisma/models/procurement.prisma'), 'utf8');
    for (const [field, column] of [['submissionKey', columns[0]], ['submissionFingerprint', columns[1]], ['submissionJson', columns[2]]])
      expect(model).toMatch(new RegExp(`^\\s*${field}\\s+String\\?\\s+@map\\("${column}"\\)\\s*$`, 'm'));
    expect(model).toMatch(/@@unique\(\[purchaseOrderId, submissionKey\]\)/);
    // PostgreSQL contract only: this test does not execute a PostgreSQL migration.
    const migration = fs.readFileSync(path.join(__dirname,
      '../../prisma/postgres-migrations/202610130002_purchase-receipt-submission/migration.sql'), 'utf8')
      .replace(/^\s*--.*$/gm, '').trim();
    expect(migration).toBe(`ALTER TABLE "purchase_receipts"\n  ADD COLUMN IF NOT EXISTS "submission_key" TEXT,\n  ADD COLUMN IF NOT EXISTS "submission_fingerprint" TEXT,\n  ADD COLUMN IF NOT EXISTS "submission_json" TEXT;\n\nCREATE UNIQUE INDEX IF NOT EXISTS "${indexName}"\n  ON "purchase_receipts"("purchase_order_id", "submission_key");`);
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|DROP|DEFAULT|NOT\s+NULL)\b/i);
  });
});
