const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const findings = [];

function resolve(relativePath) {
  return path.join(ROOT, relativePath);
}

function read(relativePath) {
  const filePath = resolve(relativePath);
  if (!fs.existsSync(filePath)) {
    findings.push({ severity: 'P1', file: relativePath, message: 'required PostgreSQL server artifact file is missing' });
    return '';
  }
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function requireIncludes(file, tokens) {
  const content = read(file);
  if (!content) return content;
  for (const token of tokens) {
    if (!content.includes(token)) {
      findings.push({ severity: 'P1', file, message: `missing token: ${token}` });
    }
  }
  return content;
}

function requireExists(file) {
  if (!fs.existsSync(resolve(file))) {
    findings.push({ severity: 'P1', file, message: 'required PostgreSQL server artifact file is missing' });
  }
}

const manifest = requireIncludes('output/postgres-server-artifact/manifest.json', [
  '"artifact": "postgres-server"',
  '"prismaProvider": "postgresql"',
  'AILAODA_PRISMA_PROVIDER=postgresql',
  'DATABASE_URL=postgresql://...',
]);

requireExists('output/postgres-server-artifact/backend/dist/server.js');
requireExists('output/postgres-server-artifact/backend/prisma/generated-client/index.js');
requireIncludes('output/postgres-server-artifact/backend/package.json', ['"type": "commonjs"']);
requireExists('output/postgres-server-artifact/backend/node_modules/express/package.json');
requireExists('output/postgres-server-artifact/dist/index.html');

const database = requireIncludes('output/postgres-server-artifact/backend/dist/config/database.js', [
  'require("../../prisma/generated-client")',
  "runtime_1.runtime.databaseEngine === 'sqlite' && sqliteDbPath",
]);
if (database.includes('require("@prisma/client")')) {
  findings.push({
    severity: 'P0',
    file: 'output/postgres-server-artifact/backend/dist/config/database.js',
    message: 'PostgreSQL server artifact must not use the default SQLite Prisma client package.',
  });
}

requireIncludes('output/postgres-server-artifact/backend/dist/config/runtime.js', [
  "AILAODA_PRISMA_PROVIDER !== 'postgresql'",
  'PostgreSQL DATABASE_URL is configured',
]);

requireIncludes('output/postgres-server-artifact/backend/prisma/schema.prisma', [
  'provider = "postgresql"',
  'output          = "../generated-client"',
]);

requireIncludes('scripts/build-postgres-server-artifact-v1.cjs', [
  'audit:db:postgres-artifact',
  'require("../../prisma/generated-client")',
  'AILAODA_PRISMA_PROVIDER',
  "packageMetadata.type = 'commonjs'",
  'npm ci --omit=dev --ignore-scripts',
  'install-postgres-server-production-dependencies',
  'copy-frontend-dist',
  'postgres-server-artifact',
]);

requireIncludes('package.json', [
  'build:backend:postgres-server-artifact',
  'audit:db:postgres-server-artifact',
]);

if (manifest && !manifest.includes('Does not perform data migration.')) {
  findings.push({
    severity: 'P1',
    file: 'output/postgres-server-artifact/manifest.json',
    message: 'manifest must keep the PostgreSQL server artifact migration non-goal explicit',
  });
}

if (findings.length) {
  console.error('PostgreSQL Server Artifact Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('PostgreSQL Server Artifact Audit: PASS');
console.log('- Artifact uses the generated PostgreSQL Prisma client.');
console.log('- Runtime still requires the explicit AILAODA_PRISMA_PROVIDER=postgresql marker.');
console.log('- Manifest keeps data migration and route smoke tests outside this build claim.');
