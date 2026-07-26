const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const outDir = path.join(process.cwd(), 'output', 'audit');
const profile = process.env.ENTERPRISE_EVIDENCE_CLASS || 'synthetic-scale';
const expectedRows = Number(process.env.ENTERPRISE_TARGET_ROWS || 170911);
const read = (name) => JSON.parse(fs.readFileSync(path.join(outDir, name), 'utf8'));
const source = read('enterprise-database-fingerprint-source-v1.json');
const target = read('enterprise-database-fingerprint-postgres-v1.json');
const rollback = read('enterprise-database-fingerprint-rollback-v1.json');
const mismatches = [];
for (const [table, count] of Object.entries(source.counts)) {
  if (Number(target.counts[table]) !== Number(count)) mismatches.push({ table, source: count, target: target.counts[table] });
  if (Number(rollback.counts[table]) !== Number(count)) mismatches.push({ table, source: count, rollback: rollback.counts[table] });
}
if (source.totalRows !== expectedRows) mismatches.push({ metric: 'totalRows', expected: expectedRows, actual: source.totalRows });
const status = mismatches.length ? 'failed' : 'passed';
const report = {
  name: 'Enterprise release certification verdict', version: 1, status, evidenceClass: profile,
  productionEligible: status === 'passed' && profile === 'real-snapshot',
  syntheticEligible: status === 'passed', expectedRows,
  sourceRows: source.totalRows, targetRows: target.totalRows, rollbackRows: rollback.totalRows,
  critical: { source: source.critical, target: target.critical, rollback: rollback.critical },
  mismatches, generatedAt: new Date().toISOString(),
};
report.sha256 = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');
fs.writeFileSync(path.join(outDir, 'enterprise-release-verdict-v1.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (status !== 'passed') process.exit(1);
