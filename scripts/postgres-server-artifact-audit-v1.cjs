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

function listFilesRecursive(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  return fs.readdirSync(rootDir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(rootDir, entry.name);
    return entry.isDirectory() ? listFilesRecursive(filePath) : [filePath];
  });
}

const manifest = requireIncludes('output/postgres-server-artifact/manifest.json', [
  '"artifact": "postgres-server"',
  '"prismaProvider": "postgresql"',
  'AILAODA_PRISMA_PROVIDER=postgresql',
  'DATABASE_URL=postgresql://...',
]);

requireExists('output/postgres-server-artifact/backend/dist/server.js');
requireExists('output/postgres-server-artifact/backend/prisma/generated-client/index.js');
requireExists('output/postgres-server-artifact/backend/prisma/postgres-migrations/202607220001_order-import-idempotency/migration.sql');
requireExists('output/postgres-server-artifact/backend/prisma/postgres-migrations/202607220002_order-import-retention/migration.sql');
requireExists('output/postgres-server-artifact/backend/dist/maintenance/order-import-retention.js');
requireExists('output/postgres-server-artifact/scripts/postgres-schema-migrate-v1.cjs');
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

const residualDefaultClientImports = listFilesRecursive(resolve('output/postgres-server-artifact/backend/dist'))
  .filter(filePath => filePath.endsWith('.js'))
  .filter(filePath => /require\((["'])@prisma\/client\1\)/.test(fs.readFileSync(filePath, 'utf8')));
for (const filePath of residualDefaultClientImports) {
  findings.push({
    severity: 'P0',
    file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
    message: 'PostgreSQL server artifact runtime must not import the default SQLite Prisma client package.',
  });
}
try {
  const artifactMoney = require(resolve('output/postgres-server-artifact/backend/dist/utils/money.js'));
  if (artifactMoney.addMoney('0.10', '0.20') !== 0.3) {
    throw new Error('unexpected Decimal result');
  }
} catch (error) {
  findings.push({
    severity: 'P0',
    file: 'output/postgres-server-artifact/backend/dist/utils/money.js',
    message: `generated PostgreSQL Prisma client Decimal runtime smoke failed: ${error instanceof Error ? error.message : String(error)}`,
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
  'patchedRuntimeImportCount',
  'residualDefaultClientImports',
  'AILAODA_PRISMA_PROVIDER',
  "packageMetadata.type = 'commonjs'",
  'npm ci --omit=dev --ignore-scripts',
  'install-postgres-server-production-dependencies',
  'copy-frontend-dist',
  'postgres-server-artifact',
  'copy-postgres-versioned-migrations',
  'copy-postgres-versioned-migrator',
  'postgres-schema-migrate-v1.cjs apply',
  'postgres-schema-migrate-v1.cjs verify',
  'ORDER_IMPORT_RETENTION_MODE=report-only',
  'ORDER_IMPORT_RETENTION_MODE=enforce',
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
