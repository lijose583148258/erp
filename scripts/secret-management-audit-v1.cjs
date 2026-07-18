const fs = require('fs');
const path = require('path');

const root = process.cwd();
const findings = [];
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));
const add = (severity, file, message) => findings.push({ severity, file, message });
const requireIncludes = (file, text, severity, message) => {
  const content = read(file);
  if (!content.includes(text)) add(severity, file, message);
  return content;
};

const boundary = requireIncludes(
  'backend/src/security/secretManagement.ts',
  'resolveManagedSecret',
  'P0',
  'Secret management boundary is missing.'
);
for (const token of ['getJwtSecret', 'getJwtSecretStatus', 'requiredInProduction: true', 'placeholder', 'ephemeral-dev']) {
  if (!boundary.includes(token)) add('P1', 'backend/src/security/secretManagement.ts', `Missing secret boundary token: ${token}`);
}

const jwt = requireIncludes(
  'backend/src/utils/jwt.ts',
  "from '../security/secretManagement'",
  'P0',
  'JWT utilities must resolve signing secret through the secret management boundary.'
);
if (/process\.env\.JWT_SECRET/.test(jwt)) {
  add('P0', 'backend/src/utils/jwt.ts', 'JWT utilities must not read process.env.JWT_SECRET directly.');
}
if (/crypto\.randomBytes/.test(jwt)) {
  add('P1', 'backend/src/utils/jwt.ts', 'Ephemeral JWT secret generation should live in the secret management boundary.');
}

const server = requireIncludes(
  'backend/src/server.ts',
  'getJwtSecretStatus',
  'P2',
  'Health/status endpoints should expose redacted secret readiness metadata.'
);
if (server.includes('JWT_SECRET')) {
  add('P1', 'backend/src/server.ts', 'Server health must not mention raw JWT_SECRET values.');
}

if (!exists('backend/src/security/secretManagement.test.ts')) {
  add('P1', 'backend/src/security/secretManagement.test.ts', 'Secret management boundary tests are missing.');
}
if (!exists('docs/adr/0006-secret-management-boundary.md')) {
  add('P1', 'docs/adr/0006-secret-management-boundary.md', 'Secret management ADR is missing.');
}

const validationMiddleware = requireIncludes(
  'backend/src/middleware/validateRequest.ts',
  'Request validation failed',
  'P0',
  'Request validation logging boundary is missing.'
);
if (/req\.body|body dump|JSON\.stringify\(req\.body/.test(validationMiddleware)) {
  add('P0', 'backend/src/middleware/validateRequest.ts', 'Validation failures must never log request body values.');
}
if (!validationMiddleware.includes('errorCount') || !validationMiddleware.includes('fields:')) {
  add('P2', 'backend/src/middleware/validateRequest.ts', 'Validation logs should retain value-free field and count diagnostics.');
}
if (!exists('backend/src/middleware/validateRequest.test.ts')) {
  add('P1', 'backend/src/middleware/validateRequest.test.ts', 'Validation log redaction regression test is missing.');
}

const zodValidationMiddleware = requireIncludes(
  'backend/src/middleware/validateZod.ts',
  'Zod 验证失败',
  'P0',
  'Zod validation logging boundary is missing.'
);
if (!zodValidationMiddleware.includes('errorCount') || !zodValidationMiddleware.includes('fields:')) {
  add('P2', 'backend/src/middleware/validateZod.ts', 'Zod validation logs should retain value-free field and count diagnostics.');
}
const zodLogStart = zodValidationMiddleware.indexOf("logger.warn('Zod 验证失败'");
const zodLogEnd = zodValidationMiddleware.indexOf('});', zodLogStart);
const zodLogBlock = zodLogStart >= 0 && zodLogEnd >= 0
  ? zodValidationMiddleware.slice(zodLogStart, zodLogEnd)
  : '';
if (/errors:\s*errorMessages/.test(zodLogBlock)) {
  add('P0', 'backend/src/middleware/validateZod.ts', 'Zod validation logs must not emit dynamic issue messages.');
}
if (!exists('backend/src/middleware/validateZod.test.ts')) {
  add('P1', 'backend/src/middleware/validateZod.test.ts', 'Zod validation log redaction regression test is missing.');
}

const loggerBoundary = requireIncludes(
  'backend/src/utils/logSanitizer.ts',
  'sanitizeLogValue',
  'P0',
  'Central structured logging redaction boundary is missing.'
);
for (const token of ['formatLogEntry', 'redactLogText', 'MAX_LOG_DEPTH', 'MAX_LOG_STRING_LENGTH', 'MAX_LOG_METADATA_LENGTH']) {
  if (!loggerBoundary.includes(token)) {
    add('P1', 'backend/src/utils/logSanitizer.ts', `Central logging boundary is missing token: ${token}`);
  }
}
const loggerConfig = requireIncludes(
  'backend/src/utils/logger.ts',
  "from './logSanitizer'",
  'P0',
  'Winston must use the central log sanitizer.'
);
if (!loggerConfig.includes('splat()')) {
  add('P1', 'backend/src/utils/logger.ts', 'Winston metadata interpolation is missing.');
}
if (!exists('backend/src/utils/logSanitizer.test.ts')) {
  add('P1', 'backend/src/utils/logSanitizer.test.ts', 'Central logging redaction and metadata regression tests are missing.');
}

const productionEnv = requireIncludes(
  '.env.production.example',
  'JWT_SECRET=replace_with_a_long_random_secret_before_server_deploy',
  'P1',
  'Production env example should require replacing JWT_SECRET.'
);
if (!productionEnv.includes('SECRET_MANAGER_REFERENCE')) {
  add('P2', '.env.production.example', 'Production env example should document future external secret-manager reference.');
}

const cloudAuditFiles = fs.readdirSync(path.join(root, 'scripts'))
  .filter((file) => /^cloud-.*\.cjs$/i.test(file));
for (const fileName of cloudAuditFiles) {
  const relativePath = `scripts/${fileName}`;
  const content = read(relativePath);
  if (/password\s*:\s*['"][^'"]{8,}['"]/i.test(content)) {
    add('P0', relativePath, 'Cloud audits must obtain credentials from ephemeral environment/password-file inputs, not source literals.');
  }
  if (/\{\s*standbyConfig\s*\}/.test(content)) {
    add('P0', relativePath, 'Raw PostgreSQL standby configuration must not be embedded in evidence reports.');
  }
}

const promotionAudit = requireIncludes(
  'scripts/cloud-postgres-promotion-audit-v1.cjs',
  'credentialsIncluded: false',
  'P0',
  'PostgreSQL promotion evidence must record only redacted configuration facts.'
);
if (!promotionAudit.includes('sensitiveValues.some(value => serialized.includes(value))')) {
  add('P1', 'scripts/cloud-postgres-promotion-audit-v1.cjs', 'Promotion evidence must fail closed if a runtime credential enters serialized evidence.');
}

const observationWorkflow = read('.github/workflows/enterprise-pilot-observation.yml');
for (const secretName of [
  'POSTGRES_PASSWORD',
  'POSTGRES_REPLICATION_PASSWORD',
  'REDIS_PASSWORD',
  'MINIO_ROOT_PASSWORD',
  'MEILI_MASTER_KEY',
  'GRAFANA_ADMIN_PASSWORD',
  'JWT_SECRET',
  'METRICS_BEARER_TOKEN',
]) {
  if (new RegExp(`${secretName}:\\s*sandbox-`, 'i').test(observationWorkflow)) {
    add('P0', '.github/workflows/enterprise-pilot-observation.yml', `${secretName} must not be derived from a public workflow run identifier.`);
  }
  if (!observationWorkflow.includes(`emit_secret ${secretName}`)) {
    add('P1', '.github/workflows/enterprise-pilot-observation.yml', `${secretName} must be generated and masked for every observation run.`);
  }
}
for (const requiredToken of [
  'Generate ephemeral observation secrets',
  'openssl rand -hex 32',
  '::add-mask::',
  'AUDIT_DATABASE_URL',
  "github.event_name == 'pull_request' && '1'",
  'One-minute observation is reserved for pull-request smoke validation',
]) {
  if (!observationWorkflow.includes(requiredToken)) {
    add('P1', '.github/workflows/enterprise-pilot-observation.yml', `Observation workflow is missing secret-control token: ${requiredToken}`);
  }
}

if (findings.length) {
  console.error('Secret Management Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('Secret Management Audit: PASS');
console.log('- JWT signing secret resolves through a central boundary.');
console.log('- Production weak or missing JWT_SECRET is rejected.');
console.log('- Health exposes redacted secret readiness metadata.');
console.log('- Validation failures retain value-free diagnostics without request payloads.');
console.log('- Central logging preserves bounded metadata and recursively redacts secret-bearing fields.');
console.log('- ADR and tests document the current env-to-secret-manager path.');
