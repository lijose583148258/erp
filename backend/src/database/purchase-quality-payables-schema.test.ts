import fs from 'node:fs';
import path from 'node:path';
const { DatabaseSync } = require('node:sqlite');
import prisma from '../config/database';
import { repairReceiptSchema } from './runtime-schema-receipt-repair';
import { columnExists, type SchemaRepairReport } from './runtime-schema-repair-utils';

jest.mock('../config/database', () => ({ __esModule: true, default: {
  $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn(),
} }));

const nullableReceiptColumns: Record<string, string> = {
  supplier_batch_no: 'TEXT', batch_id: 'INTEGER', payable_amount_native: 'DECIMAL',
  payable_amount_base: 'DECIMAL', payable_snapshot_json: 'TEXT', incoming_quality_plan_json: 'TEXT',
};
const legacyReceiptColumns = `id INTEGER PRIMARY KEY, receipt_no TEXT NOT NULL, purchase_order_id INTEGER NOT NULL,
  quantity REAL NOT NULL, accepted_quantity REAL NOT NULL DEFAULT 0, rejected_quantity REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'kg', batch_no TEXT, stock_entry_ref TEXT, discrepancy_reason TEXT, note TEXT,
  received_by INTEGER, submission_key TEXT, submission_fingerprint TEXT, submission_json TEXT,
  received_at TEXT NOT NULL, created_at TEXT NOT NULL`;
const historicalSubmission = ' {"schema":"purchase-receipt-submission/v1","receiptNo":"PR-LEGACY","quantity":2} ';
const confirmedPayable = ' {"schema":"receipt-payable-source/v1","currency":"USD","amountNative":15.37,"amountBase":3.99} ';
const frozenPlan = ' {"schema":"purchase-incoming-quality/v1","specification":"SPEC-OLD"} ';
const fingerprint = 'b'.repeat(64);
const indexes: Record<string, { table: string; columns: string[]; unique: number; partial?: number }> = {
  purchase_receipts_batch_id_key: { table: 'purchase_receipts', columns: ['batch_id'], unique: 1 },
  incoming_quality_checks_check_no_key: { table: 'incoming_quality_checks', columns: ['check_no'], unique: 1 },
  incoming_quality_checks_purchase_receipt_id_revision_key: { table: 'incoming_quality_checks', columns: ['purchase_receipt_id', 'revision'], unique: 1 },
  incoming_quality_checks_purchase_receipt_id_request_key_key: { table: 'incoming_quality_checks', columns: ['purchase_receipt_id', 'request_key'], unique: 1 },
  incoming_quality_checks_status_idx: { table: 'incoming_quality_checks', columns: ['status'], unique: 0 },
  supplier_payments_payment_no_key: { table: 'supplier_payments', columns: ['payment_no'], unique: 1 },
  supplier_payments_purchase_receipt_id_request_key_key: { table: 'supplier_payments', columns: ['purchase_receipt_id', 'request_key'], unique: 1 },
  supplier_payments_account_transaction_idx: { table: 'supplier_payments', columns: ['payment_account_ref', 'external_transaction_ref'], unique: 0 },
  supplier_payments_account_transaction_key: { table: 'supplier_payments', columns: ['payment_account_ref', 'external_transaction_ref'], unique: 1, partial: 1 },
  supplier_payments_status_idx: { table: 'supplier_payments', columns: ['status'], unique: 0 },
};

describe('purchase incoming quality and payables additive schema', () => {
  let db: { exec(sql: string): void; close(): void; prepare(sql: string): {
    all(...args: unknown[]): Array<Record<string, unknown>>;
    get(...args: unknown[]): Record<string, unknown>;
    run(...args: unknown[]): unknown;
  } };
  const repair = async () => {
    const report: SchemaRepairReport = { entries: [] };
    await repairReceiptSchema(report);
    return report;
  };
  const checkIntegrity = () => {
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  };
  const receipt = (id = 1, batchId: number | null = null) => {
    db.prepare(`INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,quantity,accepted_quantity,
      unit,batch_no,stock_entry_ref,note,received_by,submission_key,submission_fingerprint,submission_json,
      received_at,created_at,batch_id) VALUES(?, ?, 1, 2, 2, 'kg', 'OLD-LOT', 'ENTRY-OLD', 'old note', 5,
      ?, ?, ?, '2026-10-01T00:00:00Z', '2026-10-01T00:00:01Z', ?)`)
      .run(id, `PR-${id}`, `request-${id}`, fingerprint, historicalSubmission, batchId);
  };
  const quality = (id: number, receiptId = 1, revision = id, key = `qc-request-${id}`, inspector = 6, reviewer: number | null = null) => {
    db.prepare(`INSERT INTO incoming_quality_checks(id,check_no,purchase_receipt_id,revision,request_key,
      fingerprint,submission_json,result,measurements_json,inspector_user_id,reviewed_by_user_id)
      VALUES(?, ?, ?, ?, ?, ?, ?, 'pass', ?, ?, ?)`)
      .run(id, `IQC-${id}`, receiptId, revision, key, fingerprint, historicalSubmission, '[{"code":"PH","measuredNumeric":"7.5"}]', inspector, reviewer);
  };
  const payment = (id: number, receiptId = 1, key = `payment-request-${id}`, account = 'BANK-ACCOUNT-1', external = `BANK-TXN-${id}`, submitter = 8, verifier: number | null = null) => {
    db.prepare(`INSERT INTO supplier_payments(id,payment_no,purchase_receipt_id,amount_native,currency,
      base_amount,request_key,fingerprint,submission_json,method,date,payment_account_ref,external_transaction_ref,
      evidence_ref,submitted_by_user_id,verified_by_user_id)
      VALUES(?, ?, ?, '15.37', 'USD', '3.99', ?, ?, ?, 'bank_transfer', '2026-10-14T00:00:00Z', ?, ?, 'BANK-PROOF-1', ?, ?)`)
      .run(id, `SP-${id}`, receiptId, key, fingerprint, historicalSubmission, account, external, submitter, verifier);
  };
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      CREATE TABLE purchase_orders(id INTEGER PRIMARY KEY);
      CREATE TABLE shipments(id INTEGER PRIMARY KEY);
      CREATE TABLE product_batches(id INTEGER PRIMARY KEY);
      INSERT INTO users VALUES(5),(6),(7),(8),(9);
      INSERT INTO purchase_orders VALUES(1); INSERT INTO product_batches VALUES(10),(11);`);
    (prisma.$queryRawUnsafe as jest.Mock).mockImplementation(async (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args));
    (prisma.$executeRawUnsafe as jest.Mock).mockImplementation(async (sql: string, ...args: unknown[]) => { db.prepare(sql).run(...args); return 1; });
  });
  afterEach(() => db.close());

  it.each(['fresh-create', 'legacy-upgrade', 'partial-upgrade'])('repairs %s twice without inventing legacy AP, lots, checks or payments', async mode => {
    if (mode !== 'fresh-create') {
      db.exec(`CREATE TABLE purchase_receipts(${legacyReceiptColumns}
        ${mode === 'partial-upgrade' ? ', supplier_batch_no TEXT, payable_amount_native DECIMAL, payable_snapshot_json TEXT' : ''},
        FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id),
        FOREIGN KEY(received_by) REFERENCES users(id));
        INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,quantity,accepted_quantity,unit,batch_no,
          stock_entry_ref,note,received_by,submission_key,submission_fingerprint,submission_json,received_at,created_at)
          VALUES(1,'PR-1',1,2,2,'kg','OLD-LOT','ENTRY-OLD','old note',5,'request-1','${fingerprint}',
          '${historicalSubmission}','2026-10-01T00:00:00Z','2026-10-01T00:00:01Z');`);
      if (mode === 'partial-upgrade') db.prepare('UPDATE purchase_receipts SET supplier_batch_no=?,payable_amount_native=?,payable_snapshot_json=? WHERE id=1')
        .run('REAL-SUPPLIER-LOT', '15.37', confirmedPayable);
    }
    let before = mode === 'fresh-create' ? null : db.prepare('SELECT * FROM purchase_receipts WHERE id=1').get();
    for (let run = 0; run < 2; run += 1) {
      const report = await repair();
      if (mode === 'fresh-create' && run === 0) { receipt(); before = db.prepare('SELECT * FROM purchase_receipts WHERE id=1').get(); }
      const actual = db.prepare('SELECT * FROM purchase_receipts WHERE id=1').get();
      expect(Object.fromEntries(Object.keys(before!).map(column => [column, actual[column]]))).toEqual(before);
      for (const [column, type] of Object.entries(nullableReceiptColumns)) {
        const presentInPartial = ['supplier_batch_no', 'payable_amount_native', 'payable_snapshot_json'].includes(column);
        const expectedAction = run === 0 && (mode === 'legacy-upgrade' || (mode === 'partial-upgrade' && !presentInPartial)) ? 'added' : 'exists';
        expect(report.entries.find(entry => entry.target === `purchase_receipts.${column}`))
          .toEqual({ kind: 'column', target: `purchase_receipts.${column}`, action: expectedAction });
        expect(db.prepare("PRAGMA table_info('purchase_receipts')").all().find(row => row.name === column))
          .toMatchObject({ type, notnull: 0, dflt_value: null });
        if (mode !== 'partial-upgrade' || !presentInPartial) expect(actual[column]).toBeNull();
      }
      expect(actual.submission_json).toBe(historicalSubmission);
      expect(db.prepare('SELECT COUNT(*) AS count FROM incoming_quality_checks').get()).toEqual({ count: 0 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM supplier_payments').get()).toEqual({ count: 0 });
      checkIntegrity();
    }
    receipt(2);
    for (const column of Object.keys(nullableReceiptColumns)) expect(db.prepare('SELECT * FROM purchase_receipts WHERE id=2').get()[column]).toBeNull();
  });

  it('preserves confirmed decimal amounts and exact JSON across repeated repairs without changing v1 receipt identity', async () => {
    await repair(); receipt(1, 10);
    db.prepare(`UPDATE purchase_receipts SET supplier_batch_no=?,payable_amount_native=?,payable_amount_base=?,
      payable_snapshot_json=?,incoming_quality_plan_json=? WHERE id=1`).run('ACTUAL-SUPPLIER-LOT', '15.37', '3.99', confirmedPayable, frozenPlan);
    quality(1, 1, 1, 'same-key', 6, 7); payment(1, 1, 'same-key', 'BANK-ACCOUNT-1', 'BANK-TXN-1', 8, 9);
    const prior = ['purchase_receipts', 'incoming_quality_checks', 'supplier_payments'].map(table => db.prepare(`SELECT * FROM ${table}`).all());
    for (let run = 0; run < 2; run += 1) {
      await repair();
      expect(['purchase_receipts', 'incoming_quality_checks', 'supplier_payments'].map(table => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(prior);
    }
    expect(db.prepare(`SELECT CAST(payable_amount_native AS TEXT) AS native,CAST(payable_amount_base AS TEXT) AS base,
      payable_snapshot_json AS snapshot,incoming_quality_plan_json AS plan,submission_json AS submission FROM purchase_receipts WHERE id=1`).get())
      .toEqual({ native: '15.37', base: '3.99', snapshot: confirmedPayable, plan: frozenPlan, submission: historicalSubmission });
    expect(db.prepare(`SELECT CAST(amount_native AS TEXT) AS native,CAST(base_amount AS TEXT) AS base,status FROM supplier_payments WHERE id=1`).get())
      .toEqual({ native: '15.37', base: '3.99', status: 'draft' });
    expect(db.prepare("PRAGMA table_info('supplier_payments')").all().filter(row => ['amount_native', 'base_amount'].includes(String(row.name))))
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'amount_native', type: 'DECIMAL', notnull: 1, dflt_value: null }),
        expect.objectContaining({ name: 'base_amount', type: 'DECIMAL', notnull: 1, dflt_value: null })]));
    checkIntegrity();
  });

  it('has identically named indexes, receipt-scoped keys/revisions and globally unique bank transactions', async () => {
    await repair(); receipt(1, 10); receipt(2, 11); receipt(3); receipt(4);
    for (const [name, definition] of Object.entries(indexes)) {
      expect(db.prepare(`PRAGMA index_list('${definition.table}')`).all().find(row => row.name === name))
        .toMatchObject({ unique: definition.unique, partial: definition.partial || 0 });
      expect(db.prepare(`PRAGMA index_info('${name}')`).all().map(row => row.name)).toEqual(definition.columns);
    }
    expect(() => receipt(5, 10)).toThrow(/UNIQUE constraint failed: purchase_receipts.batch_id/);
    quality(1, 1, 1, 'same-key'); quality(2, 2, 1, 'same-key');
    expect(() => quality(3, 1, 1, 'different-key')).toThrow(/UNIQUE constraint failed/);
    expect(() => quality(3, 1, 2, 'same-key')).toThrow(/UNIQUE constraint failed/);
    quality(3, 1, 2, 'different-key');
    payment(1, 1, 'same-key', 'BANK-A', 'TXN-1'); payment(2, 2, 'same-key', 'BANK-B', 'TXN-1');
    expect(() => payment(3, 1, 'same-key', 'BANK-A', 'TXN-2')).toThrow(/UNIQUE constraint failed/);
    expect(() => payment(3, 2, 'different-key', 'BANK-A', 'TXN-1')).toThrow(/UNIQUE constraint failed/);
    checkIntegrity();
  });

  it('retains cancelled proposal facts while releasing only its bank reference for a corrected new proposal', async () => {
    await repair(); receipt(1, 10); receipt(2, 11);
    payment(1, 1, 'incorrect-proposal', 'BANK-A', 'TXN-1');
    const prior = db.prepare('SELECT * FROM supplier_payments WHERE id=1').get();
    db.prepare('UPDATE supplier_payments SET status=\'cancelled\',verification_json=? WHERE id=1').run(' {"schema":"supplier-payment-cancel/v1","reason":"wrong receipt"} ');
    payment(2, 2, 'corrected-proposal', 'BANK-A', 'TXN-1');
    expect(db.prepare('SELECT * FROM supplier_payments WHERE id=1').get()).toEqual({ ...prior,
      status: 'cancelled', verification_json: ' {"schema":"supplier-payment-cancel/v1","reason":"wrong receipt"} ' });
    expect(() => payment(3, 1, 'another-active-proposal', 'BANK-A', 'TXN-1')).toThrow(/UNIQUE constraint failed/);
    await repair();
    expect(db.prepare('SELECT id,status,external_transaction_ref FROM supplier_payments ORDER BY id').all())
      .toEqual([{ id: 1, status: 'cancelled', external_transaction_ref: 'TXN-1' }, { id: 2, status: 'draft', external_transaction_ref: 'TXN-1' }]);
    checkIntegrity();
  });

  it('restricts removal of receipt/batch/inspector/reviewer/finance actor evidence and rejects orphan children', async () => {
    await repair(); receipt(1, 10); quality(1, 1, 1, 'quality-1', 6, 7); payment(1, 1, 'payment-1', 'BANK-A', 'TXN-1', 8, 9);
    for (const table of ['incoming_quality_checks', 'supplier_payments']) {
      const keys = db.prepare(`PRAGMA foreign_key_list('${table}')`).all();
      expect(keys).toHaveLength(3);
      for (const key of keys) expect(key).toMatchObject({ on_delete: 'RESTRICT', on_update: 'CASCADE' });
    }
    expect(db.prepare("PRAGMA foreign_key_list('purchase_receipts')").all().find(key => key.from === 'batch_id'))
      .toMatchObject({ table: 'product_batches', to: 'id', on_delete: 'RESTRICT', on_update: 'CASCADE' });
    for (const sql of ['DELETE FROM purchase_receipts WHERE id=1', 'DELETE FROM product_batches WHERE id=10',
      ...[6,7,8,9].map(id => `DELETE FROM users WHERE id=${id}`)]) expect(() => db.exec(sql)).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => quality(2, 99)).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => quality(2, 1, 2, 'other-key', 99)).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => payment(2, 99)).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => payment(2, 1, 'other-key', 'BANK-A', 'TXN-2', 99)).toThrow(/FOREIGN KEY constraint failed/);
    checkIntegrity();
  });

  it('rejects incomplete batch provenance constraints without rebuilding or erasing historical receipts', async () => {
    db.exec(`CREATE TABLE purchase_receipts(${legacyReceiptColumns}, batch_id INTEGER);
      INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,quantity,received_at,created_at,batch_id)
        VALUES(1,'PR-INCOMPLETE',1,1,'original','original',10);`);
    const prior = db.prepare('SELECT id,receipt_no,purchase_order_id,quantity,received_at,created_at,batch_id FROM purchase_receipts').all();
    await expect(repair()).rejects.toThrow('PURCHASE_RECEIPT_BATCH_FOREIGN_KEY_REQUIRED');
    expect(db.prepare('SELECT id,receipt_no,purchase_order_id,quantity,received_at,created_at,batch_id FROM purchase_receipts').all()).toEqual(prior);
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });

  it('fails closed on a manually incomplete business-table foreign key without fabricating or deleting facts', async () => {
    await repair(); receipt();
    const ddl = String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='incoming_quality_checks'").get().sql);
    db.exec('DROP TABLE incoming_quality_checks');
    db.exec(ddl.replace(/,\s*CONSTRAINT "incoming_quality_checks_inspector_user_id_fkey" FOREIGN KEY \("inspector_user_id"\) REFERENCES "users"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/, ''));
    quality(1, 1, 1, 'preserved-request', 6, 7);
    const prior = db.prepare('SELECT * FROM incoming_quality_checks').all();
    await expect(repair()).rejects.toThrow('PURCHASE_QUALITY_PAYABLE_FOREIGN_KEY_REQUIRED:incoming_quality_checks.inspector_user_id');
    expect(db.prepare('SELECT * FROM incoming_quality_checks').all()).toEqual(prior);
  });

  it('does not silently accept a stale unconditional bank-reference constraint which would prevent correction after cancellation', async () => {
    await repair(); receipt(); payment(1);
    db.exec('DROP INDEX supplier_payments_account_transaction_key');
    db.exec('CREATE UNIQUE INDEX "supplier_payments_account_transaction_key" ON "supplier_payments"("payment_account_ref", "external_transaction_ref")');
    const prior = db.prepare('SELECT * FROM supplier_payments').all();
    await expect(repair()).rejects.toThrow('SUPPLIER_PAYMENT_ACTIVE_REFERENCE_INDEX_REQUIRED');
    expect(db.prepare('SELECT * FROM supplier_payments').all()).toEqual(prior);
  });

  it('allows the two owned new tables for additive repair introspection without widening arbitrary table access', async () => {
    await repair();
    await expect(columnExists('incoming_quality_checks', 'review_json')).resolves.toBe(true);
    await expect(columnExists('supplier_payments', 'verification_json')).resolves.toBe(true);
    await expect(columnExists('unowned_table', 'arbitrary')).rejects.toThrow(/unknown table/);
  });

  it('keeps the Prisma and PostgreSQL DDL additive and nullable; this is not a live PostgreSQL migration test', () => {
    const model = fs.readFileSync(path.join(__dirname, '../../prisma/models/procurement.prisma'), 'utf8');
    for (const [field, type, column] of [['supplierBatchNo', 'String', 'supplier_batch_no'], ['payableAmountNative', 'Decimal', 'payable_amount_native'],
      ['payableAmountBase', 'Decimal', 'payable_amount_base'], ['payableSnapshotJson', 'String', 'payable_snapshot_json'], ['incomingQualityPlanJson', 'String', 'incoming_quality_plan_json']])
      expect(model).toMatch(new RegExp(`^\\s*${field}\\s+${type}\\?\\s+@map\\("${column}"\\)\\s*$`, 'm'));
    expect(model).toMatch(/batchId\s+Int\?\s+@unique\s+@map\("batch_id"\)/);
    expect(model).toContain('@@index([paymentAccountRef, externalTransactionRef], map: "supplier_payments_account_transaction_idx")');
    expect(model).not.toContain('@@unique([paymentAccountRef, externalTransactionRef]');
    expect(model).toMatch(/model IncomingQualityCheck[\s\S]*?@@unique\(\[purchaseReceiptId, revision\]\)/);
    const ddl = fs.readFileSync(path.join(__dirname, '../../prisma/postgres-migrations/202610140001_purchase-quality-payables/migration.sql'), 'utf8')
      .replace(/^\s*--.*$/gm, '');
    const receiptColumns = ddl.slice(ddl.indexOf('ALTER TABLE "purchase_receipts"'), ddl.indexOf('DO $$'));
    for (const [column, type] of Object.entries(nullableReceiptColumns))
      expect(receiptColumns).toContain(`ADD COLUMN IF NOT EXISTS "${column}" ${type === 'DECIMAL' ? 'DECIMAL(65,30)' : type}`);
    expect(receiptColumns).not.toMatch(/\bDEFAULT\b|\bNOT\s+NULL\b/i);
    expect(ddl).not.toMatch(/^\s*(?:UPDATE|DELETE|DROP|TRUNCATE)\b/im);
    expect(ddl).toMatch(/FOREIGN KEY \("batch_id"\) REFERENCES "product_batches"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/);
    for (const [name, definition] of Object.entries(indexes))
      expect(ddl).toContain(`CREATE ${definition.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS "${name}" ON "${definition.table}"(${definition.columns.map(column => `"${column}"`).join(', ')})${definition.partial ? ' WHERE "status" <> \'cancelled\'' : ''};`);
    for (const table of ['incoming_quality_checks', 'supplier_payments']) expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
  });
});
