const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const TARGET_ROWS = Number(process.env.ENTERPRISE_TARGET_ROWS || 170911);
const OUT = path.join(process.cwd(), 'output', 'audit', 'enterprise-scale-fixture-v1.json');
const prisma = new PrismaClient();

async function tableCounts() {
  const tables = await prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations' ORDER BY name");
  const counts = {};
  for (const row of tables) {
    const name = String(row.name);
    const result = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM \"${name.replace(/\"/g, '\"\"')}\"`);
    counts[name] = Number(result[0].count);
  }
  return counts;
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const user = await prisma.user.findUnique({ where: { username: 'migration_fixture_admin' } });
  if (!user) throw new Error('migration fixture user is required before scale generation');
  const before = await tableCounts();
  const beforeTotal = Object.values(before).reduce((a, b) => a + b, 0);
  const needed = TARGET_ROWS - beforeTotal;
  if (needed < 0) throw new Error(`existing rows ${beforeTotal} exceed target ${TARGET_ROWS}`);
  for (let offset = 0; offset < needed; offset += 5000) {
    const size = Math.min(5000, needed - offset);
    const data = Array.from({ length: size }, (_, index) => ({
      userId: user.id,
      action: 'enterprise_scale_probe',
      resource: 'release_certification',
      resourceId: offset + index + 1,
      details: JSON.stringify({ synthetic: true, ordinal: offset + index + 1 }),
      ipAddress: '127.0.0.1',
      userAgent: 'enterprise-release-certification-v1',
    }));
    await prisma.auditLog.createMany({ data });
  }
  const counts = await tableCounts();
  const actualRows = Object.values(counts).reduce((a, b) => a + b, 0);
  if (actualRows !== TARGET_ROWS) throw new Error(`row target mismatch: expected ${TARGET_ROWS}, got ${actualRows}`);
  const report = {
    name: 'Enterprise synthetic scale fixture', version: 1, status: 'passed', evidenceClass: 'synthetic-scale',
    targetRows: TARGET_ROWS, actualRows, tableCount: Object.keys(counts).length, counts,
    fingerprintSha256: crypto.createHash('sha256').update(JSON.stringify(counts)).digest('hex'),
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
