const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const findings = [];

function read(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) {
    findings.push({ level: 'P1', file: relativePath, message: 'required JSON normalization file is missing' });
    return '';
  }
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

function requireToken(file, text, token) {
  if (!text.includes(token)) {
    findings.push({ level: 'P1', file, message: `missing JSON normalization token: ${token}` });
  }
}

const migrationFile = 'backend/src/database/postgres-migration.ts';
const migration = read(migrationFile);
[
  'JSON_NORMALIZATION_FIELDS',
  'normalizeJsonFieldsInPostgres',
  "case 'normalize-json'",
  'jsonb',
  'USING GIN',
  'invalidJsonRows',
  'postgres-json-normalization-v1',
  'Legacy text columns are retained',
].forEach(token => requireToken(migrationFile, migration, token));

const runbookFile = 'docs/runbooks/POSTGRESQL_MIGRATION_REHEARSAL.md';
const runbook = read(runbookFile);
['npm run db:pg -- normalize-json', 'postgres-json-normalization-v1.json', 'GIN indexes'].forEach(token => {
  requireToken(runbookFile, runbook, token);
});

const packageFile = 'package.json';
const packageText = read(packageFile);
requireToken(packageFile, packageText, 'audit:db:postgres-json-normalization');

const report = {
  name: 'PostgreSQL JSON Normalization Audit',
  version: '1.0',
  status: findings.some(item => item.level === 'P0') ? 'failed' : findings.length ? 'warning' : 'passed',
  findings,
  scope: 'static migration boundary only; live PostgreSQL execution remains required',
  generatedAt: new Date().toISOString(),
};

const outputDir = path.join(ROOT, 'output', 'audit');
fs.mkdirSync(outputDir, { recursive: true });
const jsonReport = path.join(outputDir, 'postgres-json-normalization-audit-v1.json');
fs.writeFileSync(jsonReport, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  status: report.status,
  findings: report.findings.length,
  jsonReport,
}, null, 2));

if (report.status === 'failed') process.exit(1);
