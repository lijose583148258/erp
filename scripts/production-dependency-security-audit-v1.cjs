const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();
const findings = [];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, ''));
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, '');
}

function add(severity, file, message) {
  findings.push({ severity, file, message });
}

const packageJson = readJson('package.json');
const overrides = packageJson.overrides || {};
for (const [name, expected] of Object.entries({
  'protobufjs': '7.6.5',
  'ws': '8.21.0',
  'form-data': '4.0.6',
  'minimatch': '9.0.7',
  'brace-expansion': '2.1.2',
  'uuid': '11.1.1',
})) {
  if (overrides[name] !== expected) {
    add('P1', 'package.json', `Expected production dependency override ${name}@${expected}.`);
  }
}

if (!packageJson.dependencies?.exceljs) {
  add('P1', 'package.json', 'Expected exceljs as the maintained spreadsheet parser/exporter dependency.');
}

if (packageJson.dependencies?.xlsx || packageJson.devDependencies?.xlsx || packageJson.optionalDependencies?.xlsx) {
  add('P1', 'package.json', 'The no-fix xlsx dependency must not be present.');
}

const spreadsheetSecurity = read('utils/spreadsheetSecurity.ts');
for (const token of [
  'DEFAULT_MAX_SPREADSHEET_BYTES',
  'ALLOWED_SPREADSHEET_EXTENSIONS',
  'assertSafeSpreadsheetFile',
  'Spreadsheet parsing uses ExcelJS',
]) {
  if (!spreadsheetSecurity.includes(token)) {
    add('P1', 'utils/spreadsheetSecurity.ts', `Spreadsheet parser boundary is missing ${token}.`);
  }
}

for (const file of ['services/tableImport.service.ts', 'components/DataTable.tsx', 'components/ui/EnterpriseDataGrid.tsx', 'utils/spreadsheetIO.ts']) {
  const content = read(file);
  if (file !== 'utils/spreadsheetIO.ts' && !content.includes('parseSpreadsheetFileAs')) {
    add('P1', file, 'Spreadsheet import path should use the shared spreadsheet IO boundary.');
  }
  if (file === 'utils/spreadsheetIO.ts' && !content.includes('assertSafeSpreadsheetFile')) {
    add('P1', file, 'Spreadsheet import path should validate file type and size before workbook parsing.');
  }
  if (/from ['"]xlsx['"]|require\(['"]xlsx['"]\)|import\(['"]xlsx['"]\)|XLSX\./.test(content)) {
    add('P1', file, 'Spreadsheet path must not use the no-fix xlsx package.');
  }
}

for (const file of [
  'pages/collections/collectionCenter.helpers.ts',
  'utils/sampleDataGenerator.ts',
  'scripts/crm-permission-ai-audit-v1.cjs',
  'scripts/lib/browser-human-flow-modules.cjs',
  'vite.config.ts',
]) {
  const content = read(file);
  if (/from ['"]xlsx['"]|require\(['"]xlsx['"]\)|import\(['"]xlsx['"]\)|XLSX\./.test(content)) {
    add('P1', file, 'No-fix xlsx usage must not be reintroduced.');
  }
}

function auditPackageTree(relativeCwd, lockFile) {
  const auditCommand = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const auditArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm audit --omit=dev --json']
    : ['audit', '--omit=dev', '--json'];
  const audit = spawnSync(auditCommand, auditArgs, {
    cwd: path.join(root, relativeCwd),
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --use-system-ca`.trim() },
  });

  if (audit.error) {
    add('P1', lockFile, `Unable to run npm audit: ${audit.error.message}`);
    return;
  }

  const auditText = `${audit.stdout || ''}\n${audit.stderr || ''}`.trim();
  let report;
  try {
    const jsonStart = auditText.indexOf('{');
    report = JSON.parse(jsonStart >= 0 ? auditText.slice(jsonStart) : auditText);
  } catch (error) {
    add('P1', lockFile, `Unable to parse npm audit JSON: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const vulnerabilities = report.vulnerabilities || {};
  const names = Object.keys(vulnerabilities).sort();
  if (names.length) {
    add('P1', lockFile, `Production vulnerabilities remain: ${names.join(', ')}.`);
  }
  if ((report.metadata?.vulnerabilities?.total || 0) !== 0) {
    add('P1', lockFile, 'Production dependency audit must have zero total vulnerabilities.');
  }
  if ((report.metadata?.vulnerabilities?.critical || 0) !== 0) {
    add('P0', lockFile, 'Production dependency audit still has critical vulnerabilities.');
  }
}

auditPackageTree('.', 'package-lock.json');
auditPackageTree('backend', 'backend/package-lock.json');

if (!fs.existsSync(path.join(root, 'docs/adr/0019-production-dependency-security.md'))) {
  add('P2', 'docs/adr/0019-production-dependency-security.md', 'Production dependency security ADR is missing.');
}

if (findings.length) {
  console.error('Production Dependency Security Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('Production Dependency Security Audit: PASS');
console.log('- npm audit --omit=dev has zero production vulnerabilities in root and backend package trees.');
console.log('- Fixable production advisories are constrained through direct upgrades and npm overrides.');
console.log('- Spreadsheet import/export uses ExcelJS behind a shared size/type validation boundary.');
