const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const findings = [];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/^\uFEFF/, '');
}

function add(severity, file, message) {
  findings.push({ severity, file, message });
}

function requireIncludes(file, token, severity, message) {
  const content = read(file);
  if (!content.includes(token)) add(severity, file, message);
  return content;
}

const startScript = requireIncludes(
  'scripts/start-postgres-rehearsal-v1.ps1',
  'POSTGRES_WINDOWS_BIN_ZIP',
  'P0',
  'Portable PostgreSQL rehearsal start script is missing.',
);

for (const token of [
  'POSTGRES_PORTABLE_DIR',
  'POSTGRES_PASSWORD',
  'initdb.exe',
  'pg_ctl.exe',
  'createdb.exe',
  'psql.exe',
  'Expand-Archive',
  'connectionString',
  'CheckOnly',
]) {
  if (!startScript.includes(token)) add('P1', 'scripts/start-postgres-rehearsal-v1.ps1', `Missing portable rehearsal token: ${token}`);
}

const stopScript = requireIncludes(
  'scripts/stop-postgres-rehearsal-v1.ps1',
  'pg_ctl.exe',
  'P0',
  'Portable PostgreSQL rehearsal stop script is missing.',
);

for (const token of ['PG_VERSION', 'stop -D', 'POSTGRES_RUNTIME_ROOT']) {
  if (!stopScript.includes(token)) add('P1', 'scripts/stop-postgres-rehearsal-v1.ps1', `Missing portable stop token: ${token}`);
}

const packageJson = read('package.json');
for (const token of ['"db:pg:start-rehearsal"', '"db:pg:stop-rehearsal"']) {
  if (!packageJson.includes(token)) add('P1', 'package.json', `package.json should expose ${token.replace(/"/g, '')}.`);
}

const runbook = requireIncludes(
  'docs/runbooks/POSTGRESQL_MIGRATION_REHEARSAL.md',
  'POSTGRES_WINDOWS_BIN_ZIP',
  'P1',
  'Migration runbook should document the Windows portable PostgreSQL archive path.',
);

for (const token of ['npm run db:pg:start-rehearsal', 'npm run db:pg:stop-rehearsal', 'official PostgreSQL Windows binary archive']) {
  if (!runbook.includes(token)) add('P1', 'docs/runbooks/POSTGRESQL_MIGRATION_REHEARSAL.md', `Runbook is missing portable rehearsal token: ${token}`);
}

const deployment = requireIncludes(
  'docs/DEPLOYMENT.md',
  'POSTGRES_WINDOWS_BIN_ZIP',
  'P1',
  'Deployment docs should document the Windows portable PostgreSQL rehearsal path.',
);

if (!deployment.includes('npm run db:pg:start-rehearsal')) {
  add('P1', 'docs/DEPLOYMENT.md', 'Deployment docs should reference npm run db:pg:start-rehearsal.');
}

if (findings.length) {
  console.error('PostgreSQL Portable Rehearsal Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('PostgreSQL Portable Rehearsal Audit: PASS');
console.log('- Windows portable PostgreSQL rehearsal scripts document official zip or extracted binary inputs.');
console.log('- package.json exposes start/stop rehearsal commands.');
console.log('- Runbook and deployment docs document the non-Docker Windows rehearsal path.');
