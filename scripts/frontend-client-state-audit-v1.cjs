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

function requireIncludes(file, token, severity, message) {
  if (!exists(file)) {
    add(severity, file, `${message} File is missing.`);
    return '';
  }
  const content = read(file);
  if (!content.includes(token)) add(severity, file, message);
  return content;
}

const packageJson = requireIncludes(
  'package.json',
  '"zustand"',
  'P1',
  'package.json should include Zustand as the frontend client-state library.',
);
if (!packageJson.includes('"audit:frontend:client-state"')) {
  add('P1', 'package.json', 'package.json should expose npm run audit:frontend:client-state.');
}

const clientState = requireIncludes(
  'app/clientState.ts',
  "import { create } from 'zustand'",
  'P1',
  'Client state boundary should be implemented with Zustand.',
);
for (const token of [
  'useClientStateStore',
  'language: readStoredLanguage()',
  'theme: readStoredTheme()',
  'notifications: []',
  'currentUser: initialCurrentUser',
  'setIsLoggedIn',
  'setCurrentUser',
  'toggleTheme',
  'dismissNotification',
]) {
  if (clientState && !clientState.includes(token)) {
    add('P1', 'app/clientState.ts', `Missing client-state token: ${token}`);
  }
}

const appShell = requireIncludes(
  'app/useAppShell.tsx',
  "import { useClientStateStore } from './clientState'",
  'P1',
  'useAppShell should consume the Zustand client-state boundary.',
);
for (const token of [
  'useClientStateStore(state => state.language)',
  'useClientStateStore(state => state.currentUser)',
  'useClientStateStore(state => state.notifications)',
  'useClientStateStore(state => state.setIsLoggedIn)',
  'useClientStateStore(state => state.setIsCommandPaletteOpen)',
]) {
  if (appShell && !appShell.includes(token)) {
    add('P1', 'app/useAppShell.tsx', `useAppShell is missing store selector: ${token}`);
  }
}

const strictConfig = requireIncludes(
  'tsconfig.strict.json',
  '"app/clientState.ts"',
  'P2',
  'Client state boundary should be covered by the strict TypeScript ratchet.',
);
if (strictConfig && !strictConfig.includes('"app/serverState.ts"')) {
  add('P2', 'tsconfig.strict.json', 'Server-state ratchet should remain in strict coverage.');
}

if (!exists('docs/adr/0018-frontend-client-state-store.md')) {
  add('P2', 'docs/adr/0018-frontend-client-state-store.md', 'Frontend client-state ADR is missing.');
}

if (findings.length) {
  console.error('Frontend Client State Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('Frontend Client State Audit: PASS');
console.log('- Zustand is installed as the frontend client-state library.');
console.log('- app/clientState.ts owns shell-level client state and notifications.');
console.log('- useAppShell consumes the store while preserving the existing AppContext facade.');
console.log('- The client-state boundary is covered by the strict TypeScript ratchet.');
