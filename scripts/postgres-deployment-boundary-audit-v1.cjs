const fs = require('fs');
const path = require('path');

const root = process.cwd();
const findings = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, '');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function add(severity, file, message) {
  findings.push({ severity, file, message });
}

function requireIncludes(file, tokens) {
  if (!exists(file)) {
    add('P1', file, 'Required PostgreSQL deployment boundary file is missing.');
    return '';
  }
  const content = read(file);
  for (const token of tokens) {
    if (!content.includes(token)) add('P1', file, `Missing PostgreSQL boundary token: ${token}`);
  }
  return content;
}

const compose = requireIncludes('docker-compose.postgres.yml', [
  'postgres:16-bookworm',
  'POSTGRES_DB: ${POSTGRES_DB:-ailaoda}',
  'POSTGRES_USER: ${POSTGRES_USER:-ailaoda}',
  'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set before PostgreSQL rehearsal}',
  '${POSTGRES_PORT:-5432}:5432',
  'ailao-postgres-data:/var/lib/postgresql/data',
  'pg_isready',
]);
if (compose.includes('ailao-app:') || compose.includes('DATABASE_URL:')) {
  add('P0', 'docker-compose.postgres.yml', 'PostgreSQL rehearsal compose must not start or configure the current SQLite app artifact.');
}

requireIncludes('.env.production.example', [
  'DATABASE_URL=file:./runtime-data/stable.db',
  'DATABASE_URL=postgresql://postgres:password@postgres:5432/pro_sales?schema=public',
  'PostgreSQL target',
]);

requireIncludes('backend/src/config/runtime.ts', [
  "runtime.databaseEngine === 'postgresql'",
  'SQLite Prisma provider',
  'Build a PostgreSQL-specific server artifact',
]);

requireIncludes('scripts/postgres-prisma-artifact-v1.cjs', [
  'provider = "postgresql"',
  'GENERATED_CLIENT_DIR',
  'generate-postgres-prisma-client',
]);

requireIncludes('scripts/deployment-migration-readiness-audit-v1.cjs', [
  'docker-compose.postgres.yml',
  'postgres-deployment-boundary',
  'postgres-raw-sql',
  'postgres-server-artifact',
]);

requireIncludes('package.json', [
  'audit:db:postgres-artifact',
  'audit:db:postgres-boundary',
  'audit:db:postgres-raw-sql',
  'build:backend:postgres-artifact',
  'build:backend:postgres-server-artifact',
  'audit:db:postgres-server-artifact',
]);

requireIncludes('docs/adr/0022-postgresql-deployment-boundary.md', [
  'PostgreSQL Deployment Boundary',
  'docker-compose.postgres.yml',
  'does not start the current application container',
]);

if (findings.length) {
  console.error('PostgreSQL Deployment Boundary Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('PostgreSQL Deployment Boundary Audit: PASS');
console.log('- PostgreSQL rehearsal compose exists with required password and healthcheck.');
console.log('- Current SQLite Prisma runtime remains guarded from accidental PostgreSQL DATABASE_URL use.');
console.log('- PostgreSQL artifact probe and ADR document the deliberate cutover boundary.');
