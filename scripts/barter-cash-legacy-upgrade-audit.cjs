// Read-only source, SQLite backup to a new isolated directory, actual compiled repair/service code.
// Usage after backend build: node scripts/barter-cash-legacy-upgrade-audit.cjs <pre-upgrade.db>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const json = value => JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const ident = name => `"${name.replaceAll('"', '""')}"`;

async function main() {
  assert(process.argv[2], 'A pre-upgrade SQLite fixture is required; no default business database is opened');
  const source = path.resolve(process.argv[2]);
  const folder = path.join(root, 'output', 'round2', `cash-upgrade-${Date.now()}-${crypto.randomUUID()}`);
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, 'runtime.db');
  const original = new DatabaseSync(source, { readOnly: true });
  const tables = original.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
  assert(!tables.includes('barter_cash_obligations'), 'Source must predate cash obligation schema');
  const snapshot = db => hash(json(tables.map(name => ({ name, rows: db.prepare(`SELECT * FROM ${ident(name)} ORDER BY rowid`).all() }))));
  const before = snapshot(original);
  await backup(original, target);
  Object.assign(process.env, { NODE_ENV: 'test', AILAODA_DEPLOYMENT_MODE: 'local', DATABASE_URL: `file:${target.replaceAll('\\', '/')}`,
    AILAODA_RUNTIME_DB_PATH: target, LOG_DIR: path.join(folder, 'logs'), BACKUP_DIR: path.join(folder, 'backups') });
  const prisma = require(path.join(root, 'backend/dist/config/database.js')).default;
  const { repairBarterCashSchema } = require(path.join(root, 'backend/dist/database/runtime-schema-barter-cash-repair.js'));
  const { recordBarterRefund, voidBarterCashObligation } = require(path.join(root, 'backend/dist/services/barter/barter-cash.service.js'));
  const report = { status: 'running', source, target, before, attempts: [] };
  let copy;
  try {
    const repair = { entries: [] }; await repairBarterCashSchema(repair);
    const rows = await prisma.barterCashObligation.findMany({ orderBy: { id: 'asc' } });
    const negatives = original.prepare("SELECT * FROM barter_settlements WHERE status='posted' AND cash_difference<0 ORDER BY id").all();
    assert(negatives.length > 0, 'Fixture must contain a posted negative settlement');
    assert.equal(rows.length, negatives.length);
    for (const old of negatives) {
      const row = rows.find(r => r.settlementId === old.id); assert(row);
      assert.equal(row.status, 'review'); assert.equal(row.amount, Math.round(-old.cash_difference * 100) / 100);
      assert.equal(row.currency, old.currency.trim().toUpperCase()); assert.equal(row.ownerId, old.posted_by ?? old.created_by);
      for (const key of ['requestKey', 'paymentReference', 'paymentDate', 'resolutionNote', 'resolvedBy', 'resolvedAt', 'voidedBy', 'voidedAt']) assert.equal(row[key], null);
      await assert.rejects(recordBarterRefund(old.id, row.ownerId, { amount: row.amount, currency: row.currency,
        requestKey: crypto.randomUUID(), paymentReference: 'AUDIT-NOT-A-PAYMENT', paymentDate: '2026-01-01', note: 'Legacy guard rehearsal' }), /历史核对/);
      await assert.rejects(prisma.$transaction(tx => voidBarterCashObligation(tx, old.id, row.ownerId, true)), /历史核对/);
      report.attempts.push({ settlementId: old.id, refundRejected: true, reversalRejected: true });
    }
    const repeated = { entries: [] }; await repairBarterCashSchema(repeated);
    assert.deepEqual(await prisma.barterCashObligation.findMany({ orderBy: { id: 'asc' } }), rows);
    copy = new DatabaseSync(target, { readOnly: true });
    report.after = snapshot(copy); assert.equal(report.after, before); assert.equal(snapshot(original), before);
    assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(copy.prepare('PRAGMA foreign_key_check').all(), []);
    Object.assign(report, { status: 'passed', originalTableCount: tables.length, obligations: rows,
      repeatedRepairUnchanged: true, originalBusinessRowsUnchanged: true, integrity: 'ok', repair, repeated });
  } catch (e) { report.status = 'failed'; report.error = e.stack; throw e; }
  finally {
    copy?.close(); original.close(); await prisma.$disconnect();
    const file = path.join(folder, 'legacy-upgrade.json'); fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, reportPath: file }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
