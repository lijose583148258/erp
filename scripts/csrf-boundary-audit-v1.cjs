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
  'backend/src/security/csrfBoundary.ts',
  'createCsrfBoundary',
  'P0',
  'CSRF/session boundary middleware is missing.'
);
if (!boundary.includes('CSRF_ORIGIN_REJECTED')) add('P1', 'backend/src/security/csrfBoundary.ts', 'Unsafe API writes should reject untrusted Origin headers.');
if (!boundary.includes('CSRF_COOKIE_AUTH_REJECTED')) add('P1', 'backend/src/security/csrfBoundary.ts', 'Token-like cookie authentication should be rejected without Bearer auth.');
if (!boundary.includes('X-CSRF-Protection-Mode')) add('P2', 'backend/src/security/csrfBoundary.ts', 'Active CSRF protection mode should be observable.');

const server = requireIncludes(
  'backend/src/server.ts',
  'createCsrfBoundary({ allowedOrigins })',
  'P0',
  'Server must mount the CSRF/session boundary using runtime allowed origins.'
);
if (!server.includes("from './security/csrfBoundary'")) add('P1', 'backend/src/server.ts', 'Server should import the CSRF boundary module.');

const auth = requireIncludes(
  'backend/src/middleware/auth.ts',
  "authHeader.startsWith('Bearer ')",
  'P0',
  'Authentication middleware must remain Bearer-token based.'
);
if (/req\.cookies|req\.signedCookies/.test(auth)) {
  add('P0', 'backend/src/middleware/auth.ts', 'Authentication middleware must not accept cookie tokens under the Bearer-only CSRF boundary.');
}

const apiClient = requireIncludes(
  'utils/api.ts',
  'config.headers.Authorization = `Bearer ${token}`',
  'P1',
  'Frontend API client should send Authorization: Bearer.'
);
if (/withCredentials\s*:\s*true/.test(apiClient)) {
  add('P1', 'utils/api.ts', 'Frontend API client should not enable credentialed cookie requests under the Bearer-only session boundary.');
}

if (!exists('backend/src/security/csrfBoundary.test.ts')) {
  add('P1', 'backend/src/security/csrfBoundary.test.ts', 'CSRF boundary tests are missing.');
}
if (!exists('docs/adr/0005-csrf-and-session-boundary.md')) {
  add('P1', 'docs/adr/0005-csrf-and-session-boundary.md', 'CSRF/session boundary ADR is missing.');
}

if (findings.length) {
  console.error('CSRF Boundary Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('CSRF Boundary Audit: PASS');
console.log('- API auth remains Bearer-token based.');
console.log('- Unsafe browser API writes are origin-bound.');
console.log('- Token-like cookie API authentication is rejected.');
console.log('- ADR and tests document the session boundary.');
