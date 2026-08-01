const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_ROOT = path.join(ROOT, 'output', 'postgres-server-artifact');
const ARTIFACT_BACKEND = path.join(OUTPUT_ROOT, 'backend');
const ARTIFACT_PACKAGE_JSON = path.join(ARTIFACT_BACKEND, 'package.json');
const ARTIFACT_PACKAGE_LOCK_JSON = path.join(ARTIFACT_BACKEND, 'package-lock.json');
const ARTIFACT_DIST = path.join(ARTIFACT_BACKEND, 'dist');
const ARTIFACT_PRISMA = path.join(ARTIFACT_BACKEND, 'prisma');
const ARTIFACT_CLIENT = path.join(ARTIFACT_PRISMA, 'generated-client');
const ARTIFACT_ORDER_IMPORT_MIGRATION = path.join(
  ARTIFACT_PRISMA,
  'postgres-migrations',
  '202607220001_order-import-idempotency',
  'migration.sql',
);
const ARTIFACT_ORDER_IMPORT_RETENTION_MIGRATION = path.join(
  ARTIFACT_PRISMA,
  'postgres-migrations',
  '202607220002_order-import-retention',
  'migration.sql',
);
const ARTIFACT_SCRIPTS = path.join(OUTPUT_ROOT, 'scripts');
const ARTIFACT_FRONTEND_DIST = path.join(OUTPUT_ROOT, 'dist');
const SOURCE_POSTGRES_CLIENT = path.join(ROOT, 'output', 'postgres-prisma-artifact', 'generated-client');
const SOURCE_POSTGRES_PRISMA = path.join(ROOT, 'output', 'postgres-prisma-artifact', 'prisma');
const SOURCE_POSTGRES_MIGRATIONS = path.join(ROOT, 'backend', 'prisma', 'postgres-migrations');
const SOURCE_BACKEND_PACKAGE_JSON = path.join(ROOT, 'backend', 'package.json');
const SOURCE_BACKEND_PACKAGE_LOCK_JSON = path.join(ROOT, 'backend', 'package-lock.json');
const SOURCE_BACKEND_PACKAGES = path.join(ROOT, 'backend', 'packages');
const SOURCE_FRONTEND_DIST = path.join(ROOT, 'dist');
const REPORT_PATH = path.join(ROOT, 'output', 'audit', 'postgres-server-artifact-v1.json');
const TIMEOUT_MS = Number(process.env.POSTGRES_SERVER_ARTIFACT_TIMEOUT_MS || 180000);

const report = {
  name: 'PostgreSQL Server Artifact Build',
  version: '1.0',
  status: 'running',
  startedAt: new Date().toISOString(),
  artifactRoot: path.relative(ROOT, OUTPUT_ROOT).replace(/\\/g, '/'),
  steps: [],
};

function writeReport() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function step(name, status, details = {}) {
  report.steps.push({ name, status, at: new Date().toISOString(), ...details });
  writeReport();
  console.log(`[${status}] ${name}`);
}

function run(command, args, stepName, options = {}) {
  const output = execFileSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --use-system-ca`.trim() },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: TIMEOUT_MS,
    ...options,
  });
  step(stepName, 'passed', { output: output.trim().slice(0, 2000) });
}

function copyDir(source, target) {
  if (!fs.existsSync(source)) throw new Error(`Copy source does not exist: ${source}`);
  fs.rmSync(target, { recursive: true, force: true });
  copyDirRecursive(source, target);
}

function copyDirRecursive(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyDirRecursive(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  copyFileWithRetry(source, target);
}

function copyFileWithRetry(source, target, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.copyFileSync(source, target);
      return;
    } catch (error) {
      const retryable = ['EBUSY', 'EPERM'].includes(error.code);
      if (retryable && filesHaveSameDigest(source, target)) return;
      if (!retryable || attempt === attempts) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 200);
    }
  }
}

function filesHaveSameDigest(source, target) {
  try {
    const sourceStat = fs.statSync(source);
    const targetStat = fs.statSync(target);
    if (sourceStat.size !== targetStat.size) return false;
    const digest = filePath => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    return digest(source) === digest(target);
  } catch {
    return false;
  }
}

function copyStep(name, source, target) {
  copyDir(source, target);
  step(name, 'passed', {
    source: path.relative(ROOT, source).replace(/\\/g, '/'),
    target: path.relative(ROOT, target).replace(/\\/g, '/'),
  });
}

function patchFile(relativePath, patcher) {
  const filePath = path.join(ARTIFACT_BACKEND, relativePath);
  const original = fs.readFileSync(filePath, 'utf8');
  const next = patcher(original);
  if (next === original) throw new Error(`Patch did not change ${relativePath}`);
  fs.writeFileSync(filePath, next, 'utf8');
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function listFilesRecursive(rootDir) {
  return fs.readdirSync(rootDir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(rootDir, entry.name);
    return entry.isDirectory() ? listFilesRecursive(filePath) : [filePath];
  });
}

function patchRuntime() {
  const runtimeFile = patchFile('dist/config/runtime.js', (original) => {
    const needle = `if (exports.runtime.databaseEngine === 'postgresql') {\n        throw new Error('PostgreSQL DATABASE_URL is configured, but this runtime package is built with the SQLite Prisma provider. Build a PostgreSQL-specific server artifact before SaaS deployment.');\n    }`;
    const replacement = `if (exports.runtime.databaseEngine === 'postgresql' && process.env.AILAODA_PRISMA_PROVIDER !== 'postgresql') {\n        throw new Error('PostgreSQL DATABASE_URL is configured, but this runtime package is not marked as a PostgreSQL Prisma provider artifact. Build a PostgreSQL-specific server artifact before SaaS deployment.');\n    }`;
    if (!original.includes(needle)) throw new Error('PostgreSQL runtime guard token not found in dist/config/runtime.js');
    return original.replace(needle, replacement);
  });
  step('patch-postgres-runtime-policy', 'passed', { runtimeFile });
}

function patchDatabase() {
  const runtimeFiles = listFilesRecursive(ARTIFACT_DIST).filter(filePath => filePath.endsWith('.js'));
  const patchedClientImports = [];

  for (const filePath of runtimeFiles) {
    const original = fs.readFileSync(filePath, 'utf8');
    let generatedClientPath = path.relative(path.dirname(filePath), ARTIFACT_CLIENT).replace(/\\/g, '/');
    if (!generatedClientPath.startsWith('.')) generatedClientPath = `./${generatedClientPath}`;
    const next = original.replace(
      /require\((["'])@prisma\/client\1\)/g,
      `require("${generatedClientPath}")`,
    );
    if (next !== original) {
      fs.writeFileSync(filePath, next, 'utf8');
      patchedClientImports.push(path.relative(ARTIFACT_BACKEND, filePath).replace(/\\/g, '/'));
    }
  }

  const databasePath = path.join(ARTIFACT_DIST, 'config', 'database.js');
  const databaseOriginal = fs.readFileSync(databasePath, 'utf8');
  const databaseNext = databaseOriginal.replace(
    'if (sqliteDbPath) {',
    "if (runtime_1.runtime.databaseEngine === 'sqlite' && sqliteDbPath) {",
  );
  if (databaseNext === databaseOriginal) {
    throw new Error('PostgreSQL database runtime condition patch failed');
  }
  fs.writeFileSync(databasePath, databaseNext, 'utf8');

  const residualDefaultClientImports = runtimeFiles.filter(filePath => (
    /require\((["'])@prisma\/client\1\)/.test(fs.readFileSync(filePath, 'utf8'))
  ));
  if (!patchedClientImports.includes('dist/config/database.js') || residualDefaultClientImports.length) {
    throw new Error(
      `PostgreSQL generated client require patch incomplete: patched=${patchedClientImports.length}, residual=${residualDefaultClientImports.length}`,
    );
  }

  step('patch-postgres-database-client', 'passed', {
    databaseFile: path.relative(ROOT, databasePath).replace(/\\/g, '/'),
    patchedRuntimeImportCount: patchedClientImports.length,
    patchedRuntimeImports: patchedClientImports,
  });
}

function writeArtifactPackageMetadata() {
  const packageMetadata = JSON.parse(fs.readFileSync(SOURCE_BACKEND_PACKAGE_JSON, 'utf8'));
  packageMetadata.private = true;
  packageMetadata.type = 'commonjs';
  fs.writeFileSync(ARTIFACT_PACKAGE_JSON, `${JSON.stringify(packageMetadata, null, 2)}\n`, 'utf8');
  fs.copyFileSync(SOURCE_BACKEND_PACKAGE_LOCK_JSON, ARTIFACT_PACKAGE_LOCK_JSON);
  step('write-postgres-server-package-metadata', 'passed', {
    packagePath: path.relative(ROOT, ARTIFACT_PACKAGE_JSON).replace(/\\/g, '/'),
    lockPath: path.relative(ROOT, ARTIFACT_PACKAGE_LOCK_JSON).replace(/\\/g, '/'),
  });
}

function installArtifactDependencies() {
  run(
    process.platform === 'win32' ? 'cmd.exe' : 'npm',
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm ci --omit=dev --ignore-scripts']
      : ['ci', '--omit=dev', '--ignore-scripts'],
    'install-postgres-server-production-dependencies',
    { cwd: ARTIFACT_BACKEND },
  );
}

function writeManifest() {
  const manifest = {
    artifact: 'postgres-server',
    generatedAt: new Date().toISOString(),
    prismaProvider: 'postgresql',
    startCommand: 'AILAODA_PRISMA_PROVIDER=postgresql node backend/dist/server.js',
    preStartCommands: [
      'node scripts/postgres-schema-migrate-v1.cjs apply',
      'node scripts/postgres-schema-migrate-v1.cjs verify',
    ],
    maintenanceCommands: [
      'ORDER_IMPORT_RETENTION_MODE=report-only node backend/dist/maintenance/order-import-retention.js',
      'ORDER_IMPORT_RETENTION_MODE=enforce node backend/dist/maintenance/order-import-retention.js',
    ],
    requiredEnvironment: [
      'NODE_ENV=production',
      'AILAODA_DEPLOYMENT_MODE=saas',
      'AILAODA_PRISMA_PROVIDER=postgresql',
      'DATABASE_URL=postgresql://...',
      'JWT_SECRET',
    ],
    nonGoals: [
      'Does not perform data migration.',
      'Does not prove raw SQL compatibility.',
      'Does not replace migration rehearsal or route-level smoke tests.',
    ],
  };
  const manifestPath = path.join(OUTPUT_ROOT, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  step('write-postgres-server-manifest', 'passed', {
    manifestPath: path.relative(ROOT, manifestPath).replace(/\\/g, '/'),
  });
}

function verifyArtifact() {
  const required = [
    path.join(ARTIFACT_DIST, 'server.js'),
    path.join(ARTIFACT_DIST, 'config', 'database.js'),
    path.join(ARTIFACT_DIST, 'config', 'runtime.js'),
    ARTIFACT_PACKAGE_JSON,
    ARTIFACT_PACKAGE_LOCK_JSON,
    path.join(ARTIFACT_FRONTEND_DIST, 'index.html'),
    path.join(ARTIFACT_BACKEND, 'node_modules', 'express', 'package.json'),
    path.join(ARTIFACT_CLIENT, 'index.js'),
    path.join(ARTIFACT_PRISMA, 'schema.prisma'),
    ARTIFACT_ORDER_IMPORT_MIGRATION,
    ARTIFACT_ORDER_IMPORT_RETENTION_MIGRATION,
    path.join(ARTIFACT_SCRIPTS, 'postgres-schema-migrate-v1.cjs'),
    path.join(OUTPUT_ROOT, 'manifest.json'),
  ];
  for (const filePath of required) {
    if (!fs.existsSync(filePath)) throw new Error(`Missing PostgreSQL server artifact file: ${filePath}`);
  }

  const database = fs.readFileSync(path.join(ARTIFACT_DIST, 'config', 'database.js'), 'utf8');
  const runtime = fs.readFileSync(path.join(ARTIFACT_DIST, 'config', 'runtime.js'), 'utf8');
  const schema = fs.readFileSync(path.join(ARTIFACT_PRISMA, 'schema.prisma'), 'utf8');
  const packageMetadata = JSON.parse(fs.readFileSync(ARTIFACT_PACKAGE_JSON, 'utf8'));
  if (!database.includes('require("../../prisma/generated-client")')) throw new Error('Artifact database.js does not use generated PostgreSQL client.');
  const residualDefaultClientImports = listFilesRecursive(ARTIFACT_DIST)
    .filter(filePath => filePath.endsWith('.js'))
    .filter(filePath => /require\((["'])@prisma\/client\1\)/.test(fs.readFileSync(filePath, 'utf8')));
  if (residualDefaultClientImports.length) {
    throw new Error(`Artifact runtime still imports the default Prisma client: ${residualDefaultClientImports.join(', ')}`);
  }
  if (!runtime.includes("AILAODA_PRISMA_PROVIDER !== 'postgresql'")) throw new Error('Artifact runtime.js is missing PostgreSQL provider marker guard.');
  if (!schema.includes('provider = "postgresql"')) throw new Error('Artifact Prisma schema is not PostgreSQL.');
  if (packageMetadata.type !== 'commonjs') throw new Error('Artifact backend package metadata must declare CommonJS.');
  if (!packageMetadata.dependencies?.express) throw new Error('Artifact backend package metadata is missing the Express production dependency.');
  const artifactMoney = require(path.join(ARTIFACT_DIST, 'utils', 'money.js'));
  if (artifactMoney.addMoney('0.10', '0.20') !== 0.3) {
    throw new Error('Artifact generated Prisma client Decimal runtime smoke failed.');
  }

  step('verify-postgres-server-artifact', 'passed', {
    files: required.map(filePath => path.relative(ROOT, filePath).replace(/\\/g, '/')),
    generatedClientDecimalRuntimeSmoke: 'passed',
  });
}

function main() {
  writeReport();
  try {
    run(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm run audit:db:postgres-artifact']
      : ['run', 'audit:db:postgres-artifact'], 'refresh-postgres-prisma-artifact');
    run(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm --prefix backend run build']
      : ['--prefix', 'backend', 'run', 'build'], 'build-backend-dist');

    if (!fs.existsSync(SOURCE_POSTGRES_CLIENT)) throw new Error('PostgreSQL generated client is missing. Run audit:db:postgres-artifact first.');
    if (!fs.existsSync(path.join(ROOT, 'backend', 'dist'))) throw new Error('Backend dist is missing. Run backend build first.');

    fs.rmSync(OUTPUT_ROOT, { recursive: true, force: true });
    fs.mkdirSync(ARTIFACT_BACKEND, { recursive: true });
    copyStep('copy-backend-dist', path.join(ROOT, 'backend', 'dist'), ARTIFACT_DIST);
    copyStep('copy-postgres-prisma-schema', SOURCE_POSTGRES_PRISMA, ARTIFACT_PRISMA);
    copyStep(
      'copy-postgres-versioned-migrations',
      SOURCE_POSTGRES_MIGRATIONS,
      path.join(ARTIFACT_PRISMA, 'postgres-migrations'),
    );
    copyStep('copy-postgres-generated-client', SOURCE_POSTGRES_CLIENT, ARTIFACT_CLIENT);
    copyStep('copy-backend-local-packages', SOURCE_BACKEND_PACKAGES, path.join(ARTIFACT_BACKEND, 'packages'));
    copyStep(
      'copy-postgres-versioned-migrator',
      path.join(ROOT, 'scripts', 'postgres-schema-migrate-v1.cjs'),
      path.join(ARTIFACT_SCRIPTS, 'postgres-schema-migrate-v1.cjs'),
    );
    copyStep('copy-frontend-dist', SOURCE_FRONTEND_DIST, ARTIFACT_FRONTEND_DIST);

    writeArtifactPackageMetadata();
    patchRuntime();
    patchDatabase();
    installArtifactDependencies();
    writeManifest();
    verifyArtifact();
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
    step('postgres-server-artifact-failed', 'failed', { reason: report.error });
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    writeReport();
  }

  if (report.status === 'passed') {
    console.log(`PostgreSQL server artifact build passed. Report: ${REPORT_PATH}`);
  } else {
    console.error(`PostgreSQL server artifact build failed. Report: ${REPORT_PATH}`);
  }
}

main();
