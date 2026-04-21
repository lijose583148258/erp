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
    for (const token of ['.manifest.json', 'sha256', 'verifyBackupIntegrity', 'manifestExists']) {
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
  checkPackaging(findings);
  checkBackupAndMigrationEvidence(findings);

  const hasP0 = findings.some(finding => finding.level === 'P0');
  const report = {
    generatedAt: new Date().toISOString(),
    status: hasP0 ? 'failed' : findings.length ? 'warning' : 'passed',
    scope: 'local-stable-runtime-to-server-migration-readiness',
    findings,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  };
  writeReports(report);
  console.log(JSON.stringify({
    status: report.status,
    findings: findings.length,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));
  if (report.status === 'failed') process.exitCode = 1;
}

main();
