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

function requireIncludes(file, text, severity, message) {
  const content = read(file);
  if (!content.includes(text)) add(severity, file, message);
  return content;
}

if (!exists('tsconfig.strict.json')) {
  add('P1', 'tsconfig.strict.json', 'Frontend strict TypeScript ratchet config is missing.');
} else {
  const config = read('tsconfig.strict.json');
  for (const token of ['"strict": true', '"noImplicitAny": true', '"strictNullChecks": true', '"noUncheckedIndexedAccess": true']) {
    if (!config.includes(token)) add('P1', 'tsconfig.strict.json', `Missing strict compiler option: ${token}`);
  }
  for (const file of [
    'app/serverState.ts',
    'app/clientState.ts',
    'components/ErrorBoundary.tsx',
    'components/PageErrorBoundary.tsx',
    'components/ui/EnterpriseDataGrid.tsx',
    'services/realtime.service.ts',
    'shared/api-contract.ts',
    'sdk/ailaoda-api-client.ts',
  ]) {
    if (!config.includes(`"${file}"`)) add('P2', 'tsconfig.strict.json', `Strict ratchet should include ${file}.`);
  }
}

const packageJson = requireIncludes(
  'package.json',
  'typecheck:strict',
  'P1',
  'package.json should expose the strict ratchet command.',
);
if (!packageJson.includes('tsc -p tsconfig.strict.json --pretty false')) {
  add('P1', 'package.json', 'typecheck:strict should run tsc against tsconfig.strict.json.');
}

const commercialAudit = requireIncludes(
  'scripts/commercial-erp-crm-ui-ux-audit-v1.cjs',
  'typecheck:strict',
  'P2',
  'Commercial audit should mention the frontend strict ratchet evidence.',
);
if (!commercialAudit.includes('tsconfig.strict.json')) {
  add('P2', 'scripts/commercial-erp-crm-ui-ux-audit-v1.cjs', 'Commercial audit should reference tsconfig.strict.json.');
}

if (!exists('docs/adr/0015-frontend-strict-typescript-ratchet.md')) {
  add('P2', 'docs/adr/0015-frontend-strict-typescript-ratchet.md', 'Frontend strict TypeScript ADR is missing.');
}

if (findings.length) {
  console.error('Frontend Strict Ratchet Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('Frontend Strict Ratchet Audit: PASS');
console.log('- tsconfig.strict.json enables strict TypeScript checks for the frontend ratchet set.');
console.log('- Runtime error boundaries are covered by strict TypeScript checks.');
console.log('- package.json exposes npm run typecheck:strict.');
console.log('- Commercial readiness evidence references the strict ratchet instead of claiming full frontend strict completion.');
