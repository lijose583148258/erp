// Read-only source, SQLite backup to a new isolated directory, actual compiled repair/service code.
// Usage after backend build: node scripts/barter-cash-legacy-upgrade-audit.cjs <pre-upgrade.db>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const { execFileSync } = require('node:child_process');
const { readRegressionStamp } = require('./lib/enterprise-regression.cjs');
const root = path.resolve(__dirname, '..');
const json = value => JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const ident = name => `"${name.replaceAll('"', '""')}"`;

async function createLegacyFixture(source, folder) {
  // Reconstruct the immediately preceding schema only inside this fresh synthetic directory.
  // Never remove a table from the caller's pre-upgrade database.
  assert.equal(source, path.join(folder, 'legacy-fixture.db'));
  assert(!fs.existsSync(source), 'Synthetic fixture must be new');
  const url = `file:${source.replaceAll('\\', '/')}`;
  const prepared = execFileSync(process.execPath, [path.join(root, 'backend/dist/database/manage-db.cli.js'), 'prepare'], {
    cwd: root, timeout: 60000, windowsHide: true, encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', AILAODA_DEPLOYMENT_MODE: 'local', DATABASE_URL: url,
      AILAODA_RUNTIME_DB_PATH: source, LOG_DIR: path.join(folder, 'logs'), BACKUP_DIR: path.join(folder, 'backups') },
  });
  fs.writeFileSync(path.join(folder, 'fixture-prepare.log'), prepared);
  const { PrismaClient } = require(path.join(root, 'backend/node_modules/@prisma/client'));
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    const owner = await client.user.create({ data: { username: 'legacy-fixture-owner', passwordHash: 'NO_LOGIN_FIXTURE', role: 'finance', isActive: false } });
    const poster = await client.user.create({ data: { username: 'legacy-fixture-poster', passwordHash: 'NO_LOGIN_FIXTURE', role: 'finance', isActive: false } });
    const customer = await client.customer.create({ data: { name: 'Legacy sentinel customer', salespersonId: owner.id } });
    const order = await client.order.create({ data: { orderNo: 'LEGACY-SENTINEL', customerId: customer.id, createdBy: owner.id,
      totalAmount: 200, finalAmount: 200, paidAmount: 200, paymentStatus: 'paid', status: 'confirmed' } });
    await client.paymentRecord.create({ data: { orderId: order.id, amount: 200, baseAmount: 200, method: 'bank_transfer', status: 'verified', verifiedBy: poster.id } });
    for (const [index, [status, cashDifference, currency, postedBy]] of [
      ['posted', -50, 'CNY', poster.id], ['posted', -0.25, ' usd ', null],
      ['posted', 30, 'CNY', poster.id], ['approved', -50, 'CNY', null],
    ].entries()) await client.barterSettlement.create({ data: { settlementNo: `LEGACY-${index}`, counterpartyName: 'Legacy sentinel',
      customerId: customer.id, orderId: order.id, createdBy: owner.id, status, cashDifference, currency, postedBy } });
  } finally { await client.$disconnect(); }
  const fixture = new DatabaseSync(source);
  try {
    assert.equal(fixture.prepare('SELECT COUNT(*) AS n FROM barter_cash_obligations').get().n, 0);
    fixture.exec('DROP TABLE barter_cash_obligations');
  } finally { fixture.close(); }
}

async function main() {
  assert(process.argv[2], 'A pre-upgrade SQLite fixture is required; no default business database is opened');
  const startedAt = new Date().toISOString();
  const folder = path.join(root, 'output', 'round2', `cash-upgrade-${Date.now()}-${crypto.randomUUID()}`);
  fs.mkdirSync(folder, { recursive: true });
  const synthetic = process.argv[2] === '--fixture';
  const source = synthetic ? path.join(folder, 'legacy-fixture.db') : path.resolve(process.argv[2]);
  if (synthetic) await createLegacyFixture(source, folder);
  const target = path.join(folder, 'runtime.db');
  const original = new DatabaseSync(source, { readOnly: true });
  const tables = original.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
  assert(!tables.includes('barter_cash_obligations'), 'Source must predate cash obligation schema');
  assert(tables.length >= 63 && ['users', 'customers', 'orders', 'payment_records', 'barter_settlements'].every(name => tables.includes(name)), 'Full legacy schema required');
  const snapshot = db => hash(json(tables.map(name => ({ name, rows: db.prepare(`SELECT * FROM ${ident(name)} ORDER BY rowid`).all() }))));
  const before = snapshot(original);
  await backup(original, target);
  Object.assign(process.env, { NODE_ENV: 'test', AILAODA_DEPLOYMENT_MODE: 'local', DATABASE_URL: `file:${target.replaceAll('\\', '/')}`,
    AILAODA_RUNTIME_DB_PATH: target, LOG_DIR: path.join(folder, 'logs'), BACKUP_DIR: path.join(folder, 'backups') });
  const prisma = require(path.join(root, 'backend/dist/config/database.js')).default;
  const { repairBarterCashSchema } = require(path.join(root, 'backend/dist/database/runtime-schema-barter-cash-repair.js'));
  const { recordBarterRefund, voidBarterCashObligation } = require(path.join(root, 'backend/dist/services/barter/barter-cash.service.js'));
  const report = { status: 'running', startedAt, provider: 'sqlite', regression: readRegressionStamp(),
    fixtureKind: synthetic ? 'reconstructed-legacy-schema' : 'copied-legacy-database', source, target, before, attempts: [] };
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
    if (synthetic) {
      const packagingTarget = path.join(folder, 'packaging-upgrade.db');
      execFileSync(process.execPath, [path.join(root, 'scripts/material-packaging-legacy-upgrade-audit.cjs'), target, packagingTarget], { cwd: root, timeout: 60000, windowsHide: true, stdio: 'pipe' });
      report.packagingUpgrade = JSON.parse(fs.readFileSync(packagingTarget + '.json', 'utf8'));
      assert.equal(report.packagingUpgrade.status, 'passed');
      const densityTarget = path.join(folder, 'density-upgrade.db');
      execFileSync(process.execPath, [path.join(root, 'scripts/material-density-legacy-upgrade-audit.cjs'), target, densityTarget], { cwd: root, timeout: 60000, windowsHide: true, stdio: 'pipe' });
      report.densityUpgrade = JSON.parse(fs.readFileSync(densityTarget + '.json', 'utf8'));
      assert.equal(report.densityUpgrade.status, 'passed');
    }
    Object.assign(report, { status: 'passed', originalTableCount: tables.length, obligations: rows,
      repeatedRepairUnchanged: true, originalBusinessRowsUnchanged: true, integrity: 'ok', repair, repeated });
  } catch (e) { report.status = 'failed'; report.error = e.stack; throw e; }
  finally {
    copy?.close(); original.close(); await prisma.$disconnect();
    report.finishedAt = new Date().toISOString();
    const file = path.resolve(process.env.REGRESSION_LEGACY_PATH || path.join(folder, 'legacy-upgrade.json'));
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, reportPath: file }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
