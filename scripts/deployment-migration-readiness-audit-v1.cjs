const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'deployment-migration-readiness-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'deployment-migration-readiness-audit-v1.md');

function readText(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n');
}

function readJson(relativePath) {
  const text = readText(relativePath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return { __parseError: String(error.message || error) };
  }
}

function toPortablePath(value) {
  return value.replace(/\\/g, '/');
}

function addFinding(findings, level, area, file, message) {
  findings.push({ level, area, file, message });
}

function requireFile(findings, relativePath, area) {
  const text = readText(relativePath);
  if (text === null) {
    addFinding(findings, 'P0', area, relativePath, 'required deployment file is missing');
    return '';
  }
  return text;
}

function checkProductionEnv(findings) {
  const text = requireFile(findings, '.env.production.example', 'production-env');
  if (!text) return;

  const requiredKeys = [
    'NODE_ENV',
    'PORT',
    'DATABASE_URL',
    'JWT_SECRET',
    'CORS_ORIGIN',
    'BACKUP_DIR',
    'LOG_DIR',
    'UPLOAD_DIR',
    'FRONTEND_DIST_DIR',
    'SERVE_FRONTEND',
    'TRUST_PROXY',
    'BACKUP_RETENTION_DAYS',
    'BACKUP_RETENTION_MODE',
    'BACKUP_MAX_FILES',
    'BACKUP_MAX_TOTAL_MB',
    'AILAODA_HTTP_PORT',
  ];

  for (const key of requiredKeys) {
    if (!new RegExp(`^${key}=`, 'm').test(text)) {
      addFinding(findings, 'P1', 'production-env', '.env.production.example', `missing ${key}`);
    }
  }
  if (/DATABASE_URL=file:\.\/prisma\//.test(text)) {
    addFinding(findings, 'P0', 'production-env', '.env.production.example', 'SQLite production example must not store runtime DB under backend/prisma');
  }
  if (!/DATABASE_URL=file:\.\/runtime-data\/stable\.db/.test(text)) {
    addFinding(findings, 'P1', 'production-env', '.env.production.example', 'SQLite production example should default to ./runtime-data/stable.db');
  }
  if (!/JWT_SECRET=replace_with_a_long_random_secret_before_server_deploy/.test(text)) {
    addFinding(findings, 'P1', 'production-env', '.env.production.example', 'JWT_SECRET must stay an explicit replacement placeholder in the example');
  }
}

function checkRootDocker(findings) {
  const text = requireFile(findings, 'Dockerfile', 'root-docker');
  if (!text) return;
  for (const token of [
    'FROM node:20-bookworm-slim',
    'ENV NODE_ENV=production',
    'ENV PORT=5001',
    'ENV DATABASE_URL=file:/data/stable.db',
    'VOLUME ["/data"]',
    'EXPOSE 5001',
    'HEALTHCHECK',
    'CMD ["node", "backend/dist/server.js"]',
  ]) {
    if (!text.includes(token)) {
      addFinding(findings, 'P1', 'root-docker', 'Dockerfile', `missing expected token: ${token}`);
    }
  }
  if (/EXPOSE\s+5000/.test(text)) {
    addFinding(findings, 'P0', 'root-docker', 'Dockerfile', 'root Dockerfile must not expose stale port 5000');
  }
}

function checkBackendDocker(findings) {
  const text = requireFile(findings, 'backend/Dockerfile', 'backend-docker');
  if (!text) return;
  for (const token of [
    'FROM node:20-bookworm-slim',
    'ENV PORT=5001',
    'ENV SERVE_FRONTEND=false',
    'ENV DATABASE_URL=file:/data/stable.db',
    'VOLUME ["/data"]',
    'EXPOSE 5001',
    'HEALTHCHECK',
  ]) {
    if (!text.includes(token)) {
      addFinding(findings, 'P1', 'backend-docker', 'backend/Dockerfile', `missing expected token: ${token}`);
    }
  }
  if (/EXPOSE\s+5000|node:18-alpine/.test(text)) {
    addFinding(findings, 'P0', 'backend-docker', 'backend/Dockerfile', 'backend Dockerfile must not keep stale Node 18 / port 5000 deployment defaults');
  }
}

function checkDockerCompose(findings) {
  const text = requireFile(findings, 'docker-compose.yml', 'docker-compose');
  if (!text) return;
  for (const token of [
    '${AILAODA_HTTP_PORT:-5001}:5001',
    'DATABASE_URL: ${DATABASE_URL:-file:/data/stable.db}',
    'BACKUP_DIR: ${BACKUP_DIR:-/data/backups}',
    'BACKUP_RETENTION_MODE: ${BACKUP_RETENTION_MODE:-report-only}',
    'BACKUP_MAX_FILES: ${BACKUP_MAX_FILES:-800}',
    'BACKUP_MAX_TOTAL_MB: ${BACKUP_MAX_TOTAL_MB:-8192}',
    'UPLOAD_DIR: ${UPLOAD_DIR:-/data/uploads}',
    'ailao-data:/data',
    'JWT_SECRET: ${JWT_SECRET:?JWT_SECRET must be set before server deploy}',
  ]) {
    if (!text.includes(token)) {
      addFinding(findings, 'P1', 'docker-compose', 'docker-compose.yml', `missing expected token: ${token}`);
    }
  }
  if (/change-me-before-server-deploy/.test(text)) {
    addFinding(findings, 'P0', 'docker-compose', 'docker-compose.yml', 'docker compose must not provide a weak JWT_SECRET fallback');
  }
}

function checkPostgresDeploymentBoundary(findings) {
  const text = requireFile(findings, 'docker-compose.postgres.yml', 'postgres-deployment-boundary');
  if (!text) return;
  for (const token of [
    'postgres:16-bookworm',
    'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set before PostgreSQL rehearsal}',
    '${POSTGRES_PORT:-5432}:5432',
    'ailao-postgres-data:/var/lib/postgresql/data',
    'pg_isready',
    'current app',
    'SQLite Prisma artifact',
  ]) {
    if (!text.includes(token)) {
      addFinding(findings, 'P1', 'postgres-deployment-boundary', 'docker-compose.postgres.yml', `missing expected token: ${token}`);
    }
  }
  if (/ailao-app:|DATABASE_URL:/.test(text)) {
    addFinding(findings, 'P0', 'postgres-deployment-boundary', 'docker-compose.postgres.yml', 'PostgreSQL rehearsal compose must not start the current SQLite app artifact.');
  }
}

function checkPackaging(findings) {
  const text = requireFile(findings, 'scripts/package-stable.ps1', 'stable-package');
  if (!text) return;
  for (const token of [
    'backend\\dist',
    'backend\\prisma',
    'scripts\\start-stable-v2.ps1',
    'scripts\\check-runtime.ps1',
    '.env.production.example',
    'Writable runtime data must stay outside this package',
  ]) {
    if (!text.includes(token)) {
      addFinding(findings, 'P1', 'stable-package', 'scripts/package-stable.ps1', `missing package boundary token: ${token}`);
    }
  }
}

function checkBackupAndMigrationEvidence(findings) {
  const backupService = requireFile(findings, 'backend/src/services/backup.service.ts', 'backup-integrity');
  if (backupService) {
    for (const token of ['.manifest.json', 'sha256', 'verifyBackupIntegrity', 'manifestExists', 'BACKUP_RETENTION_MODE', 'BACKUP_MAX_FILES', 'BACKUP_MAX_TOTAL_MB']) {
      if (!backupService.includes(token)) {
        addFinding(findings, 'P0', 'backup-integrity', 'backend/src/services/backup.service.ts', `missing backup integrity token: ${token}`);
      }
    }
  }

  const backupAudit = requireFile(findings, 'scripts/backup-restore-api-audit-v1.cjs', 'backup-integrity');
  if (backupAudit) {
    for (const token of ['manifestExists', 'checksumSha256', 'restoreIntegrity.verified']) {
      if (!backupAudit.includes(token)) {
        addFinding(findings, 'P0', 'backup-integrity', 'scripts/backup-restore-api-audit-v1.cjs', `backup audit must assert ${token}`);
      }
    }
  }

  const migrationProbe = requireFile(findings, 'scripts/db-migration-probe.cjs', 'migration-probe');
  if (migrationProbe) {
    for (const token of ['provider = "postgresql"', 'prisma-validate-postgres-schema', 'original schema.prisma is unchanged']) {
      if (!migrationProbe.includes(token)) {
        addFinding(findings, 'P1', 'migration-probe', 'scripts/db-migration-probe.cjs', `migration probe should document/assert: ${token}`);
      }
    }
  }

  const postgresArtifact = requireFile(findings, 'scripts/postgres-prisma-artifact-v1.cjs', 'postgres-artifact');
  if (postgresArtifact) {
    for (const token of ['generate-postgres-prisma-client', 'GENERATED_CLIENT_DIR', 'provider = "postgresql"', 'output          = "../generated-client"']) {
      if (!postgresArtifact.includes(token)) {
        addFinding(findings, 'P1', 'postgres-artifact', 'scripts/postgres-prisma-artifact-v1.cjs', `PostgreSQL artifact probe should assert: ${token}`);
      }
    }
  }

  const postgresServerArtifact = requireFile(findings, 'scripts/build-postgres-server-artifact-v1.cjs', 'postgres-server-artifact');
  if (postgresServerArtifact) {
    for (const token of ['postgres-server-artifact', 'require("../../prisma/generated-client")', 'AILAODA_PRISMA_PROVIDER', 'Does not perform data migration.']) {
      if (!postgresServerArtifact.includes(token)) {
        addFinding(findings, 'P1', 'postgres-server-artifact', 'scripts/build-postgres-server-artifact-v1.cjs', `PostgreSQL server artifact build should assert: ${token}`);
      }
    }
  }

  const postgresServerArtifactAudit = requireFile(findings, 'scripts/postgres-server-artifact-audit-v1.cjs', 'postgres-server-artifact');
  if (postgresServerArtifactAudit) {
    for (const token of ['output/postgres-server-artifact', 'AILAODA_PRISMA_PROVIDER', 'require("@prisma/client")', 'provider = "postgresql"']) {
      if (!postgresServerArtifactAudit.includes(token)) {
        addFinding(findings, 'P1', 'postgres-server-artifact', 'scripts/postgres-server-artifact-audit-v1.cjs', `PostgreSQL server artifact audit should assert: ${token}`);
      }
    }
  }

  const postgresRawSqlAudit = requireFile(findings, 'scripts/postgres-raw-sql-compat-audit-v1.cjs', 'postgres-raw-sql');
  if (postgresRawSqlAudit) {
    for (const token of ['sqliteMaintenancePrefixes', 'knownPostgresMigrationBlockers', 'Unclassified SQLite-only SQL', 'PostgreSQL Raw SQL Compatibility Audit']) {
      if (!postgresRawSqlAudit.includes(token)) {
        addFinding(findings, 'P1', 'postgres-raw-sql', 'scripts/postgres-raw-sql-compat-audit-v1.cjs', `PostgreSQL raw SQL audit should assert: ${token}`);
      }
    }
  }

  const postgresMigrationRehearsalAudit = requireFile(findings, 'scripts/postgres-migration-rehearsal-audit-v1.cjs', 'postgres-migration-rehearsal');
  if (postgresMigrationRehearsalAudit) {
    for (const token of ['PostgreSQL Migration Rehearsal Audit', 'backup-restore:fingerprint', 'runtime:write-backup-restore', 'reviewRawSqlFiles', 'audit:db:postgres-import-rehearsal', 'audit:db:postgres-portable-rehearsal', 'run:db:postgres-import-rehearsal', 'live PostgreSQL service migration was not executed by this audit']) {
      if (!postgresMigrationRehearsalAudit.includes(token)) {
        addFinding(findings, 'P1', 'postgres-migration-rehearsal', 'scripts/postgres-migration-rehearsal-audit-v1.cjs', `PostgreSQL migration rehearsal audit should assert: ${token}`);
      }
    }
  }

  const postgresJsonAudit = requireFile(findings, 'scripts/postgres-json-normalization-audit-v1.cjs', 'postgres-json-normalization');
  if (postgresJsonAudit) {
    for (const token of ['JSON Normalization Audit', 'normalizeJsonFieldsInPostgres', 'postgres-json-normalization-v1']) {
      if (!postgresJsonAudit.includes(token)) {
        addFinding(findings, 'P1', 'postgres-json-normalization', 'scripts/postgres-json-normalization-audit-v1.cjs', `JSON normalization audit should assert: ${token}`);
      }
    }
  }

  const postgresImportRehearsalAudit = requireFile(findings, 'scripts/postgres-import-rehearsal-audit-v1.cjs', 'postgres-import-rehearsal');
  if (postgresImportRehearsalAudit) {
    for (const token of ['PostgreSQL Import Rehearsal Audit', 'postgres-migration-import-v1.json', 'snapshot checksum', 'verification rows all match', 'rollback evidence is still required']) {
      if (!postgresImportRehearsalAudit.includes(token)) {
        addFinding(findings, 'P1', 'postgres-import-rehearsal', 'scripts/postgres-import-rehearsal-audit-v1.cjs', `PostgreSQL import rehearsal audit should assert: ${token}`);
      }
    }
  }

  const postgresImportRehearsalRunner = requireFile(findings, 'scripts/run-postgres-import-rehearsal-v1.cjs', 'postgres-import-rehearsal');
  if (postgresImportRehearsalRunner) {
    for (const token of ['POSTGRES_URL is required', 'PRISMA_DB_PUSH_ARGS', "'db'", "'push'", '--schema', 'output/postgres-prisma-artifact/prisma', '--skip-generate', 'npm run db:pg -- import', 'npm run audit:db:postgres-import-rehearsal']) {
      if (!postgresImportRehearsalRunner.includes(token)) {
        addFinding(findings, 'P1', 'postgres-import-rehearsal', 'scripts/run-postgres-import-rehearsal-v1.cjs', `PostgreSQL import rehearsal runner should assert: ${token}`);
      }
    }
  }

  const postgresMigrationRunbook = requireFile(findings, 'docs/runbooks/POSTGRESQL_MIGRATION_REHEARSAL.md', 'postgres-migration-rehearsal');
  if (postgresMigrationRunbook) {
    for (const token of ['Preflight', 'Final SQLite backup', 'Snapshot export', 'PostgreSQL rehearsal', 'db:pg:start-rehearsal', 'db:pg:stop-rehearsal', 'audit:db:postgres-portable-rehearsal', 'npm run db:pg -- import', 'npm run db:pg -- normalize-json', 'postgres-json-normalization-v1.json', 'npm run audit:db:postgres-import-rehearsal', 'npm run run:db:postgres-import-rehearsal', 'Cutover smoke tests', 'Rollback', 'Do not claim production cutover']) {
      if (!postgresMigrationRunbook.includes(token)) {
        addFinding(findings, 'P1', 'postgres-migration-rehearsal', 'docs/runbooks/POSTGRESQL_MIGRATION_REHEARSAL.md', `PostgreSQL migration runbook should include: ${token}`);
      }
    }
  }

  const packageJson = requireFile(findings, 'package.json', 'postgres-artifact');
  if (packageJson) {
    for (const token of ['audit:db:postgres-artifact', 'audit:db:postgres-raw-sql', 'audit:db:postgres-json-normalization', 'audit:db:postgres-migration-rehearsal', 'audit:db:postgres-import-rehearsal', 'audit:db:postgres-portable-rehearsal', 'run:db:postgres-import-rehearsal', 'db:pg:start-rehearsal', 'db:pg:stop-rehearsal', 'audit:api:openapi', 'audit:api:sdk', 'audit:frontend:production-readiness', 'audit:security:production-readiness', 'build:backend:postgres-artifact', 'build:backend:postgres-server-artifact', 'audit:db:postgres-server-artifact']) {
      if (!packageJson.includes(token)) {
        addFinding(findings, 'P1', 'postgres-artifact', 'package.json', `missing ${token} script`);
      }
    }
  }

  const postgresPortableStart = requireFile(findings, 'scripts/start-postgres-rehearsal-v1.ps1', 'postgres-portable-rehearsal');
  if (postgresPortableStart) {
    for (const token of ['POSTGRES_PORTABLE_DIR', 'POSTGRES_WINDOWS_BIN_ZIP', 'POSTGRES_PASSWORD', 'initdb.exe', 'pg_ctl.exe', 'createdb.exe', 'connectionString']) {
      if (!postgresPortableStart.includes(token)) {
        addFinding(findings, 'P1', 'postgres-portable-rehearsal', 'scripts/start-postgres-rehearsal-v1.ps1', `Portable PostgreSQL rehearsal start script should include: ${token}`);
      }
    }
  }

  const postgresPortableStop = requireFile(findings, 'scripts/stop-postgres-rehearsal-v1.ps1', 'postgres-portable-rehearsal');
  if (postgresPortableStop) {
    for (const token of ['pg_ctl.exe', 'PG_VERSION', 'stop -D']) {
      if (!postgresPortableStop.includes(token)) {
        addFinding(findings, 'P1', 'postgres-portable-rehearsal', 'scripts/stop-postgres-rehearsal-v1.ps1', `Portable PostgreSQL rehearsal stop script should include: ${token}`);
      }
    }
  }

  const postgresPortableAudit = requireFile(findings, 'scripts/postgres-portable-rehearsal-audit-v1.cjs', 'postgres-portable-rehearsal');
  if (postgresPortableAudit) {
    for (const token of ['PostgreSQL Portable Rehearsal Audit', 'POSTGRES_WINDOWS_BIN_ZIP', 'db:pg:start-rehearsal', 'db:pg:stop-rehearsal', 'official PostgreSQL Windows binary archive']) {
      if (!postgresPortableAudit.includes(token)) {
        addFinding(findings, 'P1', 'postgres-portable-rehearsal', 'scripts/postgres-portable-rehearsal-audit-v1.cjs', `Portable PostgreSQL rehearsal audit should assert: ${token}`);
      }
    }
  }

  const openApiAudit = requireFile(findings, 'scripts/openapi-contract-audit-v1.cjs', 'api-contract');
  if (openApiAudit) {
    for (const token of ['OpenAPI Contract Audit', '/api/v1/openapi.json', '/api/v1/docs', '/api/rum/vitals', '/metrics', 'openapiRoutes.test.ts']) {
      if (!openApiAudit.includes(token)) {
        addFinding(findings, 'P1', 'api-contract', 'scripts/openapi-contract-audit-v1.cjs', `OpenAPI contract audit should assert: ${token}`);
      }
    }
  }

  const frontendReadinessRunner = requireFile(findings, 'scripts/run-frontend-production-readiness-v1.cjs', 'frontend-production-readiness');
  if (frontendReadinessRunner) {
    for (const token of ['Frontend Production Readiness Audit v1', 'audit:frontend:server-state', 'audit:frontend:client-state', 'audit:frontend:runtime-resilience', 'audit:ui:virtualized-grid', 'audit:pwa:offline', 'audit:observability:rum', 'test:unit:frontend', 'audit:frontend:bundle-budget']) {
      if (!frontendReadinessRunner.includes(token)) {
        addFinding(findings, 'P1', 'frontend-production-readiness', 'scripts/run-frontend-production-readiness-v1.cjs', `frontend readiness runner should assert: ${token}`);
      }
    }
  }

  const securityReadinessRunner = requireFile(findings, 'scripts/run-security-production-readiness-v1.cjs', 'security-production-readiness');
  if (securityReadinessRunner) {
    for (const token of ['Security Production Readiness Audit v1', 'audit:security:csp', 'audit:security:csrf-boundary', 'audit:security:mfa', 'audit:security:secrets', 'audit:security:dependencies']) {
      if (!securityReadinessRunner.includes(token)) {
        addFinding(findings, 'P1', 'security-production-readiness', 'scripts/run-security-production-readiness-v1.cjs', `security readiness runner should assert: ${token}`);
      }
    }
  }
}

function checkLivePostgresImportEvidence(findings) {
  const importAuditPath = 'output/audit/postgres-import-rehearsal-audit-v1.json';
  const importReportPath = 'output/audit/postgres-migration-import-v1.json';
  const runnerPath = 'output/audit/postgres-import-rehearsal-run-v1.json';
  const importAudit = readJson(importAuditPath);
  const importReport = readJson(importReportPath);
  const runner = readJson(runnerPath);

  if (!importAudit || importAudit.__parseError) {
    addFinding(
      findings,
      'P1',
      'live-postgres-evidence',
      importAuditPath,
      importAudit?.__parseError
        ? `PostgreSQL import rehearsal audit report is not valid JSON: ${importAudit.__parseError}`
        : 'PostgreSQL import rehearsal has not produced a live evidence report; run the rehearsal against an isolated PostgreSQL database.',
    );
  } else if (importAudit.status !== 'passed') {
    addFinding(
      findings,
      'P0',
      'live-postgres-evidence',
      importAuditPath,
      `PostgreSQL import rehearsal audit is ${importAudit.status}; deployment readiness cannot be passed while the import evidence gate is red.`,
    );
  }

  if (!importReport || importReport.__parseError) {
    addFinding(
      findings,
      'P1',
      'live-postgres-evidence',
      importReportPath,
      importReport?.__parseError
        ? `PostgreSQL import report is not valid JSON: ${importReport.__parseError}`
        : 'PostgreSQL import report is missing; a dry-run report is not sufficient for deployment readiness.',
    );
  } else {
    if (importReport.summary?.verificationPassed !== true) {
      addFinding(
        findings,
        'P0',
        'live-postgres-evidence',
        importReportPath,
        'PostgreSQL import report does not confirm row-count verificationPassed=true.',
      );
    }
    if (importReport.snapshot?.checksumVerified !== true) {
      addFinding(
        findings,
        'P0',
        'live-postgres-evidence',
        importReportPath,
        'PostgreSQL import report does not confirm snapshot checksum verification.',
      );
    }
  }

  if (!runner || runner.__parseError) {
    addFinding(
      findings,
      'P1',
      'live-postgres-evidence',
      runnerPath,
      runner?.__parseError
        ? `PostgreSQL import rehearsal runner report is not valid JSON: ${runner.__parseError}`
        : 'The orchestrated PostgreSQL import rehearsal has not completed successfully.',
    );
  } else if (runner.status !== 'passed') {
    addFinding(
      findings,
      'P0',
      'live-postgres-evidence',
      runnerPath,
      `PostgreSQL import rehearsal runner is ${runner.status}; schema push, import, and audit must pass in one recorded window.`,
    );
  } else {
    const requiredSteps = [
      'validate-environment',
      'push-postgres-schema',
      'import-postgres-snapshot',
      'audit-postgres-import-rehearsal',
    ];
    const stepMap = new Map((Array.isArray(runner.steps) ? runner.steps : []).map((step) => [step.name, step]));
    const failedSteps = requiredSteps.filter((name) => stepMap.get(name)?.status !== 'passed');
    if (failedSteps.length > 0) {
      addFinding(
        findings,
        'P0',
        'live-postgres-evidence',
        runnerPath,
        `PostgreSQL import rehearsal runner is missing passed steps: ${failedSteps.join(', ')}.`,
      );
    }

    const windowStart = Date.parse(runner.startedAt || '');
    const windowEnd = Date.parse(runner.finishedAt || '');
    const evidenceTimes = [
      ['postgres-migration-import-v1.json', importReport?.generatedAt],
      ['postgres-import-rehearsal-audit-v1.json', importAudit?.generatedAt],
    ];
    const outsideWindow = evidenceTimes
      .filter(([, generatedAt]) => {
        const timestamp = Date.parse(generatedAt || '');
        return !Number.isFinite(windowStart)
          || !Number.isFinite(windowEnd)
          || !Number.isFinite(timestamp)
          || timestamp < windowStart
          || timestamp > windowEnd;
      })
      .map(([name]) => name);
    if (outsideWindow.length > 0) {
      addFinding(
        findings,
        'P0',
        'live-postgres-evidence',
        runnerPath,
        `PostgreSQL import evidence is outside the orchestrated run window: ${outsideWindow.join(', ')}.`,
      );
    }
  }
}

function checkPostgresProductionTopology(findings) {
  const dockerfile = requireFile(findings, 'Dockerfile.postgres', 'postgres-production-topology');
  if (dockerfile) {
    for (const token of [
      'build:backend:postgres-server-artifact',
      'AILAODA_PRISMA_PROVIDER=postgresql',
      'COPY --from=build --chown=node:node /app/output/postgres-server-artifact/backend/dist ./backend/dist',
      'VOLUME ["/data"]',
      'USER node',
    ]) {
      if (!dockerfile.includes(token)) {
        addFinding(findings, 'P1', 'postgres-production-topology', 'Dockerfile.postgres', `missing ${token}`);
      }
    }
    if (dockerfile.includes('DATABASE_URL=file:')) {
      addFinding(findings, 'P0', 'postgres-production-topology', 'Dockerfile.postgres', 'PostgreSQL Dockerfile must not default to SQLite');
    }
  }

  const compose = requireFile(findings, 'docker-compose.production-postgres.yml', 'postgres-production-topology');
  if (compose) {
    for (const token of [
      'dockerfile: Dockerfile.postgres',
      'AILAODA_PRISMA_PROVIDER: postgresql',
      'DATABASE_URL: postgresql://',
      'POSTGRES_PASSWORD must be set',
      'condition: service_healthy',
      'postgres:16-bookworm',
    ]) {
      if (!compose.includes(token)) {
        addFinding(findings, 'P1', 'postgres-production-topology', 'docker-compose.production-postgres.yml', `missing ${token}`);
      }
    }
    if (compose.includes('DATABASE_URL: ${DATABASE_URL:-file:')) {
      addFinding(findings, 'P0', 'postgres-production-topology', 'docker-compose.production-postgres.yml', 'PostgreSQL compose must not fall back to SQLite');
    }
  }
}

function checkRuntimeDbGuard(findings) {
  const runtimeConfig = requireFile(findings, 'backend/src/config/runtime.ts', 'runtime-db-guard');
  if (!runtimeConfig) return;
  for (const token of ['isForbiddenSqliteRuntimeDbPath', "backendRoot, 'prisma'", 'AILAODA_ALLOW_LEGACY_PRISMA_DB']) {
    if (!runtimeConfig.includes(token)) {
      addFinding(findings, 'P0', 'runtime-db-guard', 'backend/src/config/runtime.ts', `missing runtime DB quarantine token: ${token}`);
    }
  }
}

function writeReports(report) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const md = [
    '# Deployment Migration Readiness Audit v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    `- findings: ${report.findings.length}`,
    '',
    '## Findings',
  ];
  if (report.findings.length === 0) md.push('- none');
  for (const finding of report.findings) {
    md.push(`- ${finding.level} ${finding.area} ${finding.file}: ${finding.message}`);
  }
  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');
}

function main() {
  const findings = [];
  checkProductionEnv(findings);
  checkRootDocker(findings);
  checkBackendDocker(findings);
  checkDockerCompose(findings);
  checkPostgresProductionTopology(findings);
  checkPostgresDeploymentBoundary(findings);
  checkPackaging(findings);
  checkBackupAndMigrationEvidence(findings);
  checkLivePostgresImportEvidence(findings);
  checkRuntimeDbGuard(findings);

  const hasP0 = findings.some(finding => finding.level === 'P0');
  const report = {
    generatedAt: new Date().toISOString(),
    status: hasP0 ? 'failed' : findings.length ? 'warning' : 'passed',
    scope: 'local-stable-runtime-to-server-migration-readiness',
    findings,
    jsonReport: toPortablePath(JSON_REPORT),
    markdownReport: toPortablePath(MD_REPORT),
  };
  writeReports(report);
  console.log(JSON.stringify({
    status: report.status,
    findings: findings.length,
    jsonReport: toPortablePath(JSON_REPORT),
    markdownReport: toPortablePath(MD_REPORT),
  }, null, 2));
  if (report.status === 'failed') process.exitCode = 1;
}

main();
