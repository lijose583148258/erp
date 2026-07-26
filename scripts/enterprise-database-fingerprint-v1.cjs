const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require(path.resolve(process.cwd(), process.env.AUDIT_PRISMA_CLIENT_PATH || 'backend/node_modules/@prisma/client'));

const LABEL = process.env.ENTERPRISE_FINGERPRINT_LABEL || 'database';
const OUT = path.join(process.cwd(), 'output', 'audit', `enterprise-database-fingerprint-${LABEL}-v1.json`);
const prisma = new PrismaClient({ datasources: { db: { url: process.env.AUDIT_DATABASE_URL || process.env.DATABASE_URL } } });
const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

function normalizeScalar(value) {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeScalar);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeScalar(item)]));
  }
  return value;
}

async function main() {
  const provider = String(process.env.AUDIT_PRISMA_PROVIDER || '').toLowerCase();
  const tableSql = provider === 'postgresql'
    ? "SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename"
    : "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations' ORDER BY name";
  const tables = await prisma.$queryRawUnsafe(tableSql);
  const counts = {};
  for (const row of tables) {
    const name = String(row.name);
    const result = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM ${q(name)}`);
    counts[name] = Number(result[0].count);
  }
  const critical = {};
  const candidates = [
    ['orders', 'SELECT COUNT(*) AS rows, COALESCE(SUM(final_amount),0) AS amount FROM orders'],
    ['payments', 'SELECT COUNT(*) AS rows, COALESCE(SUM(amount),0) AS amount FROM payment_records'],
    ['stock_balances', 'SELECT COUNT(*) AS rows, COALESCE(SUM(quantity),0) AS quantity FROM stock_balances'],
    ['stock_movements', 'SELECT COUNT(*) AS rows, COALESCE(SUM(quantity_delta),0) AS quantity FROM stock_movements'],
    ['cost_ledger', 'SELECT COUNT(*) AS rows, COALESCE(SUM(cost_after),0) AS amount FROM inventory_cost_ledgers'],
  ];
  for (const [name, sql] of candidates) {
    try {
      critical[name] = normalizeScalar((await prisma.$queryRawUnsafe(sql))[0]);
    } catch {
      critical[name] = null;
    }
  }
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  const payload = normalizeScalar({ label: LABEL, provider: provider || 'sqlite', totalRows, tableCount: Object.keys(counts).length, counts, critical });
  payload.fingerprintSha256 = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ name: 'Enterprise database fingerprint', version: 1, status: 'passed', ...payload, checkedAt: new Date().toISOString() }, null, 2) + '\n');
  console.log(JSON.stringify(payload));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());