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

const productionEnv = requireIncludes(
  '.env.production.example',
  'JWT_SECRET=replace_with_a_long_random_secret_before_server_deploy',
  'P1',
  'Production env example should require replacing JWT_SECRET.'
);
if (!productionEnv.includes('SECRET_MANAGER_REFERENCE')) {
  add('P2', '.env.production.example', 'Production env example should document future external secret-manager reference.');
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
console.log('- ADR and tests document the current env-to-secret-manager path.');
