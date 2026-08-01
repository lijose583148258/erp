const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const outDir = path.join(process.cwd(), 'output', 'audit');
const profile = process.env.ENTERPRISE_EVIDENCE_CLASS || 'synthetic-scale';
const expectedRows = Number(process.env.ENTERPRISE_TARGET_ROWS || 170911);
const read = (name) => JSON.parse(fs.readFileSync(path.join(outDir, name), 'utf8'));
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)) return `numeric:${value.replace(/^(-?)0+(?=\d)/, '$1')}`;
  if (typeof value === 'number') return `numeric:${String(value)}`;
  return value;
};
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const mismatch = (list, metric, detail) => list.push({ metric, ...detail });

const source = read('enterprise-database-fingerprint-source-v1.json');
const target = read('enterprise-database-fingerprint-postgres-v1.json');
const rollback = read('enterprise-database-fingerprint-rollback-v1.json');
const snapshot = read('postgres-migration-snapshot-v1.json');
const manifest = read('postgres-migration-import-manifest-v1.json');
const importReport = read('postgres-migration-import-v1.json');
const rollbackReport = read('postgres-migration-rollback-v1.json');
const decimalSource = read('decimal-shadow-reconcile-v1-sqlite-source.json');
const decimalTarget = read('decimal-shadow-reconcile-v1-postgres-import.json');
const decimalRollback = read('decimal-shadow-reconcile-v1-sqlite-rollback.json');
const mismatches = [];
for (const report of [source, target, rollback]) if (report.status !== 'passed') mismatch(mismatches, 'fingerprint-status', { label: report.label, status: report.status });
for (const [table, count] of Object.entries(source.counts || {})) {
  if (Number(target.counts?.[table]) !== Number(count)) mismatch(mismatches, 'table-count', { table, source: count, target: target.counts?.[table] });
  if (Number(rollback.counts?.[table]) !== Number(count)) mismatch(mismatches, 'rollback-table-count', { table, source: count, rollback: rollback.counts?.[table] });
  const snapshotCount = (snapshot.tableSummary || []).find((item) => item.name === table)?.rowCount;
  if (Number(snapshotCount) !== Number(count)) mismatch(mismatches, 'snapshot-source-table-count', { table, source: count, snapshot: snapshotCount });
}
for (const table of snapshot.tableSummary || []) if (!Object.prototype.hasOwnProperty.call(source.counts || {}, table.name)) mismatch(mismatches, 'source-missing-snapshot-table', { table: table.name });
if (profile === 'real-snapshot') {
  for (const report of [source, target, rollback]) {
    if (!report.fullContent || !report.tableContentHashes) mismatch(mismatches, 'content-fingerprint-missing', { label: report.label });
  }
  for (const table of Object.keys(source.tableContentHashes || {})) {
    if (target.tableContentHashes?.[table] !== source.tableContentHashes[table]) mismatch(mismatches, 'content-fingerprint-postgres', { table });
    if (rollback.tableContentHashes?.[table] !== source.tableContentHashes[table]) mismatch(mismatches, 'content-fingerprint-rollback', { table });
  }
}

for (const name of ['orders', 'payments', 'stock_balances', 'stock_movements', 'cost_ledger']) {
  if (!equal(source.critical?.[name], target.critical?.[name])) mismatch(mismatches, 'critical-postgres', { name, source: source.critical?.[name], target: target.critical?.[name] });
  if (!equal(source.critical?.[name], rollback.critical?.[name])) mismatch(mismatches, 'critical-rollback', { name, source: source.critical?.[name], rollback: rollback.critical?.[name] });
}
if (source.totalRows !== expectedRows) mismatch(mismatches, 'total-rows', { expected: expectedRows, actual: source.totalRows });
if (snapshot.totalRowCount !== expectedRows) mismatch(mismatches, 'snapshot-total-rows', { expected: expectedRows, actual: snapshot.totalRowCount });
if (manifest.snapshot?.checksumSha256 !== snapshot.checksumSha256) mismatch(mismatches, 'snapshot-manifest-checksum', { snapshot: snapshot.checksumSha256, manifest: manifest.snapshot?.checksumSha256 });
if (importReport.summary?.importedRowCount !== expectedRows || !importReport.summary?.verificationPassed) mismatch(mismatches, 'postgres-import', { importedRows: importReport.summary?.importedRowCount, verificationPassed: importReport.summary?.verificationPassed });
if (!rollbackReport.integrity?.verified) mismatch(mismatches, 'sqlite-rollback-integrity', { integrity: rollbackReport.integrity || null });
for (const [label, decimalReport, expectedProvider] of [
  ['source', decimalSource, 'sqlite'],
  ['postgres', decimalTarget, 'postgresql'],
  ['rollback', decimalRollback, 'sqlite'],
]) {
  const tableCount = Array.isArray(decimalReport.tables) ? decimalReport.tables.length : 0;
  const fieldCount = (decimalReport.tables || []).reduce((sum, table) => sum + (table.fields || []).length, 0);
  const tablesPassed = (decimalReport.tables || []).every(table => table.passed === true);
  if (
    decimalReport.status !== 'passed'
    || decimalReport.provider !== expectedProvider
    || tableCount !== 3
    || fieldCount !== 9
    || Number(decimalReport.summary?.nullShadowRows) !== 0
    || Number(decimalReport.summary?.mismatchRows) !== 0
    || !tablesPassed
  ) {
    mismatch(mismatches, 'decimal-shadow-reconcile', {
      label,
      status: decimalReport.status,
      provider: decimalReport.provider,
      expectedProvider,
      tableCount,
      fieldCount,
      nullShadowRows: decimalReport.summary?.nullShadowRows,
      mismatchRows: decimalReport.summary?.mismatchRows,
      tablesPassed,
    });
  }
}
if (
  decimalSource.contractVersion !== decimalTarget.contractVersion
  || decimalSource.contractVersion !== decimalRollback.contractVersion
) {
  mismatch(mismatches, 'decimal-shadow-contract-version', {
    source: decimalSource.contractVersion,
    postgres: decimalTarget.contractVersion,
    rollback: decimalRollback.contractVersion,
  });
}
const status = mismatches.length ? 'failed' : 'passed';
const report = {
  name: 'Enterprise release certification verdict', version: 3, status, evidenceClass: profile,
  productionEligible: status === 'passed' && profile === 'real-snapshot', syntheticEligible: status === 'passed' && profile === 'synthetic-scale', expectedRows,
  sourceRows: source.totalRows, targetRows: target.totalRows, rollbackRows: rollback.totalRows,
  snapshot: { checksumSha256: snapshot.checksumSha256, totalRows: snapshot.totalRowCount, tableCount: snapshot.tableCount },
  decimalShadow: {
    contractVersion: decimalSource.contractVersion,
    source: decimalSource.summary,
    postgres: decimalTarget.summary,
    rollback: decimalRollback.summary,
  },
  critical: { source: source.critical, target: target.critical, rollback: rollback.critical }, mismatches, generatedAt: new Date().toISOString(),
};
report.sha256 = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');
fs.writeFileSync(path.join(outDir, 'enterprise-release-verdict-v1.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (status !== 'passed') process.exit(1);
