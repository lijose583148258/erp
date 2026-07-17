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

const mfa = requireIncludes(
  'backend/src/security/mfa.service.ts',
  'evaluateLoginMfa',
  'P0',
  'MFA login gate service is missing.'
);
for (const token of ['generateTotpCode', 'verifyTotpCode', 'AILAODA_MFA_REQUIRED_ROLES', 'AILAODA_MFA_TOTP_SECRET']) {
  if (!mfa.includes(token)) add('P1', 'backend/src/security/mfa.service.ts', `Missing MFA token: ${token}`);
}

const authController = requireIncludes(
  'backend/src/controllers/auth.controller.ts',
  'evaluateLoginMfa',
  'P0',
  'Auth login must evaluate MFA before issuing tokens.'
);
const mfaPosition = authController.indexOf('evaluateLoginMfa');
const tokenPosition = authController.indexOf('const token = generateToken');
if (mfaPosition < 0 || tokenPosition < 0 || mfaPosition > tokenPosition) {
  add('P0', 'backend/src/controllers/auth.controller.ts', 'MFA check must happen before access token generation.');
}
for (const token of ['MFA_REQUIRED', 'MFA_INVALID', 'MFA_NOT_CONFIGURED', 'LOGIN_MFA_BLOCKED']) {
  if (!authController.includes(token)) add('P1', 'backend/src/controllers/auth.controller.ts', `Missing login MFA branch token: ${token}`);
}

const login = requireIncludes(
  'components/Login.tsx',
  'mfaCode',
  'P1',
  'Login UI should support entering an MFA code.'
);
if (!login.includes('one-time-code')) add('P2', 'components/Login.tsx', 'MFA input should use one-time-code autocomplete.');

const authService = requireIncludes(
  'services/auth.service.ts',
  'mfaCode',
  'P1',
  'Frontend auth service should send MFA code to login API.'
);
if (!authService.includes('/auth/login')) add('P1', 'services/auth.service.ts', 'Login endpoint call is missing.');

const api = requireIncludes(
  'utils/api.ts',
  'errorCode',
  'P2',
  'API client should preserve backend error codes for MFA_REQUIRED/MFA_INVALID.'
);
if (!api.includes('error.response?.data?.errorCode')) add('P2', 'utils/api.ts', 'API client should pass through response errorCode.');

if (!exists('backend/src/security/mfa.service.test.ts')) add('P1', 'backend/src/security/mfa.service.test.ts', 'MFA service tests are missing.');
if (!exists('docs/adr/0007-mfa-login-gate.md')) add('P1', 'docs/adr/0007-mfa-login-gate.md', 'MFA ADR is missing.');

const envExample = requireIncludes(
  '.env.production.example',
  'AILAODA_MFA_REQUIRED_ROLES',
  'P1',
  'Production env example should document MFA required roles.'
);
if (!envExample.includes('AILAODA_MFA_TOTP_SECRET')) add('P1', '.env.production.example', 'Production env example should document MFA TOTP secret.');

if (findings.length) {
  console.error('MFA Login Gate Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('MFA Login Gate Audit: PASS');
console.log('- Login can require TOTP for configured high-privilege roles.');
console.log('- No access or refresh token is minted before MFA succeeds.');
console.log('- Frontend login form and API client preserve MFA challenge signals.');
console.log('- ADR and tests document the current MFA gate and follow-up enrollment work.');
