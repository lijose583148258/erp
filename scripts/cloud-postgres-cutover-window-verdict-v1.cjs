const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'cloud-postgres-cutover-window-verdict-v1.json');
const MAX_WINDOW_MS = Number(process.env.POSTGRES_CUTOVER_MAX_WINDOW_MS || 60 * 60 * 1000);

const required = {
  fixtureSeed: 'output/audit/cloud-postgres-migration-fixture-seed-v1.json',
  snapshot: 'output/audit/postgres-migration-snapshot-v1.json',
  manifest: 'output/audit/postgres-migration-import-manifest-v1.json',
  import: 'output/audit/postgres-migration-import-v1.json',
  importAudit: 'output/audit/postgres-import-rehearsal-audit-v1.json',
  targetReadback: 'output/audit/cloud-postgres-migration-fixture-verify-target-v1.json',
  rollbackMutation: 'output/audit/cloud-postgres-migration-fixture-mutate-v1.json',
  rollback: 'output/audit/postgres-migration-rollback-v1.json',
  rollbackReadback: 'output/audit/cloud-postgres-migration-fixture-verify-source-v1.json',
  salesRoute: 'output/playwright/sales-orders-audit-report-v1.json',
  procurementRoute: 'output/playwright/procurement-audit-report-v1.json',
  warehouseRoute: 'output/playwright/warehouse-transfer-browser-audit-report-v1.json',
  shippingRoute: 'output/playwright/shipping-audit-report-v1.json',
  collectionRoute: 'output/playwright/collection-center-human-flow-browser-audit-report-v1.json',
  postgresBackupRestore: 'output/audit/cloud-postgres-backup-restore-audit-v1.json',
  postgresPromotion: 'output/audit/cloud-postgres-promotion-audit-v1.json',
};

function readReport(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) return { relativePath, absolutePath, exists: false, report: null, mtimeMs: null };
  try {
    return {
      relativePath,
      absolutePath,
      exists: true,
      report: JSON.parse(fs.readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, '')),
      mtimeMs: fs.statSync(absolutePath).mtimeMs,
    };
  } catch (error) {
    return { relativePath, absolutePath, exists: true, report: null, mtimeMs: fs.statSync(absolutePath).mtimeMs, parseError: String(error?.message || error) };
  }
}

function semanticCheck(name, report) {
  if (!report) return { passed: false, reason: 'missing-or-invalid-json' };
  if (report.status && report.status !== 'passed') return { passed: false, reason: `status=${report.status}` };
  if (name === 'snapshot' && (!report.checksumSha256 || Number(report.totalRowCount) < 1)) return { passed: false, reason: 'snapshot-checksum-or-rows-missing' };
  if (name === 'manifest' && (!report.snapshot?.checksumSha256 || !Array.isArray(report.phases))) return { passed: false, reason: 'manifest-evidence-missing' };
  if (name === 'import' && report.summary?.verificationPassed !== true) return { passed: false, reason: 'import-verification-not-passed' };
  if (name === 'rollback' && report.integrity?.verified !== true) return { passed: false, reason: 'rollback-integrity-not-verified' };
  if (name === 'fixtureSeed' || name === 'targetReadback' || name === 'rollbackReadback') {
    if (!report.actualFingerprint || report.actualFingerprint !== report.expectedFingerprint) return { passed: false, reason: 'fixture-fingerprint-mismatch' };
  }
  if (name === 'rollbackMutation' && (!report.actualFingerprint || report.actualFingerprint === report.expectedFingerprint)) {
    return { passed: false, reason: 'rollback-mutation-did-not-change-fingerprint' };
  }
  return { passed: true };
}

function main() {
  const loaded = Object.fromEntries(Object.entries(required).map(([name, relativePath]) => [name, readReport(relativePath)]));
  const seedStart = Date.parse(loaded.fixtureSeed.report?.startedAt || '');
  const now = Date.now();
  const checks = Object.entries(loaded).map(([name, item]) => {
    const semantic = item.exists && !item.parseError ? semanticCheck(name, item.report) : { passed: false, reason: item.parseError || 'missing' };
    const inWindow = Number.isFinite(seedStart) && item.mtimeMs >= seedStart - 2000 && item.mtimeMs <= now + 2000;
    return {
      name,
      path: item.relativePath,
      status: semantic.passed && inWindow ? 'passed' : 'failed',
      semantic: semantic.passed ? 'passed' : semantic.reason,
      sameWindow: inWindow,
      modifiedAt: item.mtimeMs ? new Date(item.mtimeMs).toISOString() : null,
    };
  });

  const fingerprints = {
    source: loaded.fixtureSeed.report?.expectedFingerprint || null,
    postgres: loaded.targetReadback.report?.actualFingerprint || null,
    rollback: loaded.rollbackReadback.report?.actualFingerprint || null,
  };
  const fingerprintMatch = Boolean(fingerprints.source)
    && fingerprints.source === fingerprints.postgres
    && fingerprints.source === fingerprints.rollback;
  checks.push({ name: 'cross-database-fingerprint', status: fingerprintMatch ? 'passed' : 'failed', fingerprints });

  const elapsedMs = Number.isFinite(seedStart) ? now - seedStart : null;
  const withinDuration = elapsedMs !== null && elapsedMs >= 0 && elapsedMs <= MAX_WINDOW_MS;
  checks.push({ name: 'window-duration', status: withinDuration ? 'passed' : 'failed', elapsedMs, maximumMs: MAX_WINDOW_MS });

  const passed = checks.every((check) => check.status === 'passed');
  const verdict = {
    name: 'Cloud PostgreSQL Cutover Same-Window Verdict',
    version: 1,
    status: passed ? 'passed' : 'failed',
    checkedAt: new Date().toISOString(),
    runId: process.env.GITHUB_RUN_ID || null,
    commit: process.env.GITHUB_SHA || null,
    sameWindowPassed: passed,
    checks,
    boundary: {
      proven: [
        'representative SQLite business records were snapshotted and imported with row-count verification',
        'imported marker records were read back from PostgreSQL',
        'PostgreSQL routes were exercised through browser business flows',
        'PostgreSQL logical backup/restore and controlled promotion completed',
        'the source SQLite backup was restored and matched the pre-cutover fingerprint',
      ],
      notProven: [
        'automatic cross-region failover',
        'production traffic behavior or a 24-hour soak',
        'zero-downtime migration of a customer production dataset',
      ],
    },
  };
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');
  console.log(`Cloud PostgreSQL cutover same-window verdict: ${verdict.status.toUpperCase()}`);
  console.log(`Report: ${OUTPUT_PATH}`);
  if (!passed) process.exit(1);
}

main();
