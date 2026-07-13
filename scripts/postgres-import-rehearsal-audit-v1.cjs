const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'postgres-import-rehearsal-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'postgres-import-rehearsal-audit-v1.md');

const findings = [];
const checks = [];

function normalize(relativePath) {
  return relativePath.replace(/\\/g, '/');
}

function readText(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n');
}

function readJson(relativePath) {
  const text = readText(relativePath);
  if (!text) return null;
  return JSON.parse(text);
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function addFinding(severity, area, file, message, evidence = {}) {
  findings.push({ severity, area, file: normalize(file), message, evidence });
}

function pass(area, file, message, evidence = {}) {
  checks.push({ status: 'passed', area, file: normalize(file), message, evidence });
}

function checkPackageScript() {
  const packageJson = readJson('package.json');
  if (!packageJson?.scripts) {
    addFinding('P0', 'package-scripts', 'package.json', 'package scripts are missing');
    return;
  }
  const expected = 'node ./scripts/postgres-import-rehearsal-audit-v1.cjs';
  if (packageJson.scripts['audit:db:postgres-import-rehearsal'] !== expected) {
    addFinding('P1', 'package-scripts', 'package.json', 'missing or changed audit:db:postgres-import-rehearsal script', {
      expected,
      actual: packageJson.scripts['audit:db:postgres-import-rehearsal'] || null,
    });
    return;
  }
  pass('package-scripts', 'package.json', 'postgres import rehearsal audit script is registered');
}

function checkImportTransactionSafety() {
  const migrationPath = 'backend/src/database/postgres-migration.ts';
  const verificationPath = 'backend/src/database/postgres-import-verification.ts';
  const migration = readText(migrationPath);
  const verification = readText(verificationPath);
  if (!migration || !verification) {
    addFinding('P0', 'import-transaction', migrationPath, 'pre-commit import verification source is missing');
    return;
  }

  const importStart = migration.indexOf('const importIntoPostgres');
  const begin = migration.indexOf("await client.query('BEGIN');", importStart);
  const reset = migration.indexOf('verifyEmptyOrResetTarget(client, orderedTables)', importStart);
  const verify = migration.indexOf('assertImportedCountsMatch(countVerification);', importStart);
  const commit = migration.indexOf("await client.query('COMMIT');", importStart);
  const orderIsSafe = importStart >= 0
    && begin > importStart
    && reset > begin
    && verify > reset
    && commit > verify;

  if (!orderIsSafe) {
    addFinding('P0', 'import-transaction', migrationPath, 'import must BEGIN before reset and verify counts before COMMIT', {
      importStart,
      begin,
      reset,
      verify,
      commit,
    });
    return;
  }
  if (!verification.includes('throw new Error(`PostgreSQL import verification failed before commit:')) {
    addFinding('P0', 'import-transaction', verificationPath, 'count mismatch must throw before commit');
    return;
  }

  pass('import-transaction', migrationPath, 'reset, import, count verification, and commit are ordered in one transaction');
}

function checkRequiredReports() {
  const snapshot = readJson('output/audit/postgres-migration-snapshot-v1.json');
  if (!snapshot) {
    addFinding('P0', 'required-reports', 'output/audit/postgres-migration-snapshot-v1.json', 'snapshot report is missing');
  } else {
    pass('required-reports', 'output/audit/postgres-migration-snapshot-v1.json', 'snapshot report exists');
  }

  const manifest = readJson('output/audit/postgres-migration-import-manifest-v1.json');
  if (!manifest) {
    addFinding('P0', 'required-reports', 'output/audit/postgres-migration-import-manifest-v1.json', 'import manifest report is missing');
  } else {
    pass('required-reports', 'output/audit/postgres-migration-import-manifest-v1.json', 'import manifest report exists');
  }

  const importReport = readJson('output/audit/postgres-migration-import-v1.json');
  if (!importReport) {
    addFinding('P0', 'required-reports', 'output/audit/postgres-migration-import-v1.json', 'PostgreSQL import rehearsal report is missing; run POSTGRES_URL=... npm run db:pg -- import');
    return null;
  }

  pass('required-reports', 'output/audit/postgres-migration-import-v1.json', 'PostgreSQL import rehearsal report exists');
  return { snapshot, manifest, importReport };
}

function checkImportEvidence(snapshot, manifest, importReport) {
  const snapshotPath = snapshot?.snapshotPath;
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    addFinding('P0', 'import-evidence', 'output/audit/postgres-migration-snapshot-v1.json', 'snapshot file referenced by snapshot report is missing', {
      snapshotPath: snapshotPath || null,
    });
    return;
  }

  const actualChecksum = hashFile(snapshotPath);
  if (snapshot.checksumSha256 !== actualChecksum) {
    addFinding('P0', 'import-evidence', 'output/audit/postgres-migration-snapshot-v1.json', 'snapshot report checksum does not match the snapshot file', {
      expected: snapshot.checksumSha256 || null,
      actual: actualChecksum,
    });
  }

  if (!importReport.snapshot || importReport.snapshot.checksumSha256 !== snapshot.checksumSha256) {
    addFinding('P1', 'import-evidence', 'output/audit/postgres-migration-import-v1.json', 'import report snapshot checksum must match the latest snapshot report', {
      importChecksum: importReport.snapshot?.checksumSha256 || null,
      snapshotChecksum: snapshot.checksumSha256 || null,
    });
  }

  if (importReport.snapshot?.checksumVerified !== true) {
    addFinding('P1', 'import-evidence', 'output/audit/postgres-migration-import-v1.json', 'import report must confirm checksumVerified=true');
  }

  if (!Array.isArray(importReport.importedTables) || importReport.importedTables.length === 0) {
    addFinding('P0', 'import-evidence', 'output/audit/postgres-migration-import-v1.json', 'import report must include imported table evidence');
  } else {
    pass('import-evidence', 'output/audit/postgres-migration-import-v1.json', 'import report contains imported tables', {
      importedTableCount: importReport.importedTables.length,
    });
  }

  const expectedTableCount = (manifest.phases || []).reduce((sum, phase) => sum + (phase.tables || []).length, 0)
    + ((manifest.deferredTables || []).length);
  if ((importReport.importedTables || []).length !== expectedTableCount) {
    addFinding('P1', 'import-evidence', 'output/audit/postgres-migration-import-v1.json', 'imported table count must match manifest phase+deferred table count', {
      expectedTableCount,
      actualTableCount: Array.isArray(importReport.importedTables) ? importReport.importedTables.length : null,
    });
  }

  const importedTableMap = new Map((importReport.importedTables || []).map((table) => [table.name, table]));
  for (const phase of manifest.phases || []) {
    for (const table of phase.tables || []) {
      const imported = importedTableMap.get(table.name);
      if (!imported) {
        addFinding('P1', 'import-evidence', 'output/audit/postgres-migration-import-v1.json', 'manifest table is missing from imported table evidence', {
          tableName: table.name,
          phase: phase.phase,
        });
        continue;
      }
      if (imported.phase !== phase.phase) {
        addFinding('P1', 'import-evidence', 'output/audit/postgres-migration-import-v1.json', 'imported table phase must match manifest phase', {
          tableName: table.name,
          expectedPhase: phase.phase,
          actualPhase: imported.phase || null,
        });
      }
      if (Number(imported.expectedRowCount) !== Number(table.rowCount)) {
        addFinding('P1', 'import-evidence', 'output/audit/postgres-migration-import-v1.json', 'imported table expected row count must match manifest row count', {
          tableName: table.name,
          expected: table.rowCount,
          actual: imported.expectedRowCount ?? null,
        });
      }
      if (Number(imported.insertedRowCount) !== Number(table.rowCount)) {
        addFinding('P0', 'import-evidence', 'output/audit/postgres-migration-import-v1.json', 'inserted row count must match manifest row count', {
          tableName: table.name,
          expected: table.rowCount,
          actual: imported.insertedRowCount ?? null,
        });
      }
    }
  }

  for (const table of manifest.deferredTables || []) {
    const imported = importedTableMap.get(table.name);
    if (!imported) {
      addFinding('P1', 'import-evidence', 'output/audit/postgres-migration-import-v1.json', 'deferred manifest table is missing from imported table evidence', {
        tableName: table.name,
      });
      continue;
    }
    if (imported.phase !== 'deferred' || imported.deferred !== true) {
      addFinding('P1', 'import-evidence', 'output/audit/postgres-migration-import-v1.json', 'deferred table must be marked as deferred in the import report', {
        tableName: table.name,
        phase: imported.phase || null,
        deferred: imported.deferred ?? null,
      });
    }
  }

  if (!Array.isArray(importReport.verification) || importReport.verification.length !== expectedTableCount) {
    addFinding('P1', 'verification', 'output/audit/postgres-migration-import-v1.json', 'verification section must cover every imported table', {
      expectedTableCount,
      actualVerificationCount: Array.isArray(importReport.verification) ? importReport.verification.length : null,
    });
  } else {
    const mismatches = importReport.verification.filter((table) => table.matches !== true);
    if (mismatches.length) {
      addFinding('P0', 'verification', 'output/audit/postgres-migration-import-v1.json', 'verification section contains row-count mismatches', {
        mismatches: mismatches.map((table) => ({
          name: table.name,
          expectedRowCount: table.expectedRowCount,
          actualRowCount: table.actualRowCount,
        })),
      });
    } else {
      pass('verification', 'output/audit/postgres-migration-import-v1.json', 'verification rows all match expected counts');
    }
  }

  const importedRowCount = (importReport.importedTables || []).reduce((sum, table) => sum + Number(table.insertedRowCount || 0), 0);
  if (!importReport.summary || Number(importReport.summary.importedRowCount) !== importedRowCount) {
    addFinding('P1', 'summary', 'output/audit/postgres-migration-import-v1.json', 'summary importedRowCount must match the imported table rows', {
      expected: importedRowCount,
      actual: importReport.summary?.importedRowCount ?? null,
    });
  }

  if (!importReport.summary || importReport.summary.verificationPassed !== true) {
    addFinding('P0', 'summary', 'output/audit/postgres-migration-import-v1.json', 'summary verificationPassed must be true');
  }
}

function writeReports(report) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const md = [
    '# PostgreSQL Import Rehearsal Audit v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    `- findings: ${report.findings.length}`,
    `- checks: ${report.checks.length}`,
    '',
    '## Findings',
  ];
  if (report.findings.length === 0) md.push('- none');
  for (const finding of report.findings) {
    md.push(`- ${finding.severity} ${finding.area} ${finding.file}: ${finding.message}`);
  }
  md.push('', '## Boundary');
  md.push('- This audit proves PostgreSQL import row-count evidence is structurally consistent.');
  md.push('- It does not prove route-level smoke tests, backup/restore verification, or rollback success.');
  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');
}

function main() {
  checkPackageScript();
  checkImportTransactionSafety();
  const reports = checkRequiredReports();
  if (reports) {
    checkImportEvidence(reports.snapshot, reports.manifest, reports.importReport);
  }

  const hasP0 = findings.some((finding) => finding.severity === 'P0');
  const report = {
    name: 'PostgreSQL Import Rehearsal Audit',
    version: 1,
    generatedAt: new Date().toISOString(),
    status: hasP0 ? 'failed' : findings.length ? 'warning' : 'passed',
    scope: 'postgresql-import-rehearsal-report-validation',
    findings,
    checks,
    reports: {
      json: JSON_REPORT,
      markdown: MD_REPORT,
    },
    nonClaims: [
      'route-level PostgreSQL smoke tests were not executed by this audit',
      'backup/restore fingerprint verification was not executed by this audit',
      'rollback evidence is still required in the same rehearsal window',
    ],
  };

  writeReports(report);
  console.log(JSON.stringify({
    status: report.status,
    findings: report.findings.length,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));
  if (report.status === 'failed') process.exitCode = 1;
}

main();
