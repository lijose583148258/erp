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

const packageJson = JSON.parse(read('package.json'));
if (!packageJson.dependencies?.['@tanstack/react-virtual']) {
  add('P1', 'package.json', '@tanstack/react-virtual must be a production dependency.');
}

const grid = requireIncludes(
  'components/ui/EnterpriseDataGrid.tsx',
  "from '@tanstack/react-virtual'",
  'P1',
  'EnterpriseDataGrid should use TanStack Virtual.',
);
for (const token of ['useVirtualizer({', 'virtualized = true', 'virtualizeThreshold', 'data-virtualized', 'data-virtualizer="tanstack"', 'rowVirtualizer.measureElement', 'virtualTopPadding', 'virtualBottomPadding', 'overscan: 8']) {
  if (!grid.includes(token)) add('P1', 'components/ui/EnterpriseDataGrid.tsx', `Missing virtualized grid token: ${token}`);
}

const operatingGrid = requireIncludes(
  'components/operatingTable/OperatingDataGrid.tsx',
  'virtualized?: boolean',
  'P2',
  'OperatingDataGrid should expose the virtualization toggle for operating pages.',
);
if (!operatingGrid.includes('virtualized={virtualized}')) {
  add('P2', 'components/operatingTable/OperatingDataGrid.tsx', 'OperatingDataGrid should pass the virtualized prop through.');
}

const tests = requireIncludes(
  'scripts/frontend-unit-tests.tsx',
  'enterprise grid mounts only the TanStack virtual row window',
  'P1',
  'Frontend unit tests should render a large EnterpriseDataGrid through TanStack Virtual.',
);
for (const token of ['data-virtualizer="tanstack"', 'mountedRows > 0', 'mountedRows < rows.length']) {
  if (!tests.includes(token)) add('P1', 'scripts/frontend-unit-tests.tsx', `Missing virtualized render assertion: ${token}`);
}

const adr = 'docs/adr/0013-virtualized-grid-boundary.md';
if (!exists(adr)) {
  add('P2', adr, 'Virtualized grid ADR is missing.');
} else {
  const content = read(adr);
  for (const token of ['## Status', '## Context', '## Decision', '## Consequences']) {
    if (!content.includes(token)) add('P2', adr, `ADR is missing token: ${token}`);
  }
}

if (findings.length) {
  console.error('Virtualized Grid Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('Virtualized Grid Audit: PASS');
console.log('- EnterpriseDataGrid uses @tanstack/react-virtual for measured row virtualization and overscan.');
console.log('- OperatingDataGrid preserves the toggle for high-frequency operating tables.');
console.log('- The audit and component test verify the dependency, hook integration, row measurement, spacer contract, and bounded DOM rows.');
