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
const backendPackageJson = readJson('backend/package.json');
const overrides = packageJson.overrides || {};
const archiverCompatibilitySpec = 'file:./backend/packages/archiver-exceljs-compat';
const backendArchiverCompatibilitySpec = 'file:./packages/archiver-exceljs-compat';
for (const [name, expected] of Object.entries({
  'protobufjs': '7.6.5',
  'ws': '8.21.0',
  'form-data': '4.0.6',
  'minimatch': '10.2.5',
  'brace-expansion': '5.0.8',
  'uuid': '11.1.1',
})) {
  if (overrides[name] !== expected) {
    add('P1', 'package.json', `Expected production dependency override ${name}@${expected}.`);
  }
}

if (packageJson.dependencies?.exceljs !== '4.4.0') {
  add('P1', 'package.json', 'Expected exceljs to be pinned exactly at 4.4.0.');
}

for (const [name, expected] of Object.entries({
  archiver: '$archiver',
  unzipper: '0.12.5',
})) {
  if (overrides.exceljs?.[name] !== expected) {
    add('P1', 'package.json', `Expected ExcelJS compatibility override ${name}@${expected}.`);
  }
}
if (packageJson.dependencies?.archiver !== archiverCompatibilitySpec) {
  add('P1', 'package.json', `Expected archiver compatibility boundary ${archiverCompatibilitySpec}.`);
}
if (packageJson.engines?.node !== '>=20.19.0') {
  add('P1', 'package.json', 'Node >=20.19.0 is required for synchronous ESM interoperability.');
}

if (packageJson.dependencies?.['@google/genai']) {
  add('P1', 'package.json', 'Unused @google/genai must not remain in the production dependency tree.');
}

if (backendPackageJson.dependencies?.exceljs !== '4.4.0') {
  add('P1', 'backend/package.json', 'Expected backend exceljs to be pinned exactly at 4.4.0.');
}
for (const [name, expected] of Object.entries({
  archiver: '$archiver',
  unzipper: '0.12.5',
})) {
  if (backendPackageJson.overrides?.exceljs?.[name] !== expected) {
    add('P1', 'backend/package.json', `Expected backend ExcelJS compatibility override ${name}@${expected}.`);
  }
}
if (backendPackageJson.dependencies?.archiver !== backendArchiverCompatibilitySpec) {
  add('P1', 'backend/package.json', `Expected backend archiver compatibility boundary ${backendArchiverCompatibilitySpec}.`);
}
if (backendPackageJson.engines?.node !== '>=20.19.0') {
  add('P1', 'backend/package.json', 'Backend Node >=20.19.0 is required for synchronous ESM interoperability.');
}
if (backendPackageJson.overrides?.['brace-expansion'] !== '5.0.8') {
  add('P1', 'backend/package.json', 'Expected backend production dependency override brace-expansion@5.0.8.');
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
  'backend/src/services/customer-io.service.ts',
  'backend/src/services/order-workspace.service.ts',
]) {
  const content = read(file);
  if (!content.includes("from '../infrastructure/spreadsheet-workbook'")) {
    add('P1', file, 'Backend spreadsheet exports must use the narrow document-workbook boundary.');
  }
  if (/from ['"]exceljs['"]|require\(['"]exceljs['"]\)/.test(content)) {
    add('P1', file, 'Backend runtime must not eagerly load the optional ExcelJS streaming implementation.');
  }
}

const spreadsheetWorkbookBoundary = read('backend/src/infrastructure/spreadsheet-workbook.ts');
if (!spreadsheetWorkbookBoundary.includes("require('exceljs/lib/doc/workbook')")) {
  add('P1', 'backend/src/infrastructure/spreadsheet-workbook.ts', 'Narrow ExcelJS document-workbook load is missing.');
}

const archiverCompatibility = read('backend/packages/archiver-exceljs-compat/index.cjs');
for (const token of ['archiver-upstream', 'ZipArchive', 'PassThrough', 'archive.append']) {
  if (!archiverCompatibility.includes(token)) {
    add('P1', 'backend/packages/archiver-exceljs-compat/index.cjs', `Archiver compatibility boundary is missing ${token}.`);
  }
}
const archiverCompatibilityPackage = readJson('backend/packages/archiver-exceljs-compat/package.json');
if (archiverCompatibilityPackage.dependencies?.['archiver-upstream'] !== 'npm:archiver@8.0.0') {
  add('P1', 'backend/packages/archiver-exceljs-compat/package.json', 'Official Archiver must be pinned exactly at 8.0.0.');
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

async function auditSpreadsheetRuntimeCompatibility() {
  try {
    const ExcelJS = require('exceljs');
    const { PassThrough } = require('node:stream');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('中越文回读');
    worksheet.columns = [
      { header: '产品', key: 'product' },
      { header: 'Sản phẩm', key: 'productVi' },
      { header: '数量', key: 'quantity' },
      { header: '单价', key: 'unitPrice' },
      { header: '金额', key: 'amount' },
    ];
    worksheet.addRow({
      product: '水性丙烯酸乳液',
      productVi: 'Nhũ tương acrylic',
      quantity: 3.25,
      unitPrice: 12.34,
    });
    worksheet.getCell('E2').value = { formula: 'C2*D2', result: 40.105 };
    worksheet.getRow(1).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    const readback = new ExcelJS.Workbook();
    await readback.xlsx.load(buffer);
    const sheet = readback.getWorksheet('中越文回读');
    const compatible = (
      sheet?.getCell('A2').value === '水性丙烯酸乳液'
      && sheet.getCell('B2').value === 'Nhũ tương acrylic'
      && sheet.getCell('C2').value === 3.25
      && sheet.getCell('E2').value?.formula === 'C2*D2'
      && sheet.getRow(1).font?.bold === true
    );
    if (!compatible) {
      add('P1', 'package-lock.json', 'ExcelJS create/write/read compatibility probe returned mismatched data.');
    }

    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    const streamEnded = new Promise((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    const streamingWorkbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream,
      useSharedStrings: true,
      useStyles: true,
    });
    const streamingSheet = streamingWorkbook.addWorksheet('stream-write-readback');
    streamingSheet.columns = [
      { header: 'product', key: 'product' },
      { header: 'productVi', key: 'productVi' },
    ];
    streamingSheet.addRow({
      product: '\u6c34\u6027\u4e19\u70ef\u9178\u4e73\u6db2',
      productVi: 'Nh\u0169 t\u01b0\u01a1ng acrylic',
    }).commit();
    await streamingWorkbook.commit();
    await streamEnded;

    const streamingReadback = new ExcelJS.Workbook();
    await streamingReadback.xlsx.load(Buffer.concat(chunks));
    const streamingReadbackSheet = streamingReadback.getWorksheet('stream-write-readback');
    if (
      streamingReadbackSheet?.getCell('A2').value !== '\u6c34\u6027\u4e19\u70ef\u9178\u4e73\u6db2'
      || streamingReadbackSheet.getCell('B2').value !== 'Nh\u0169 t\u01b0\u01a1ng acrylic'
    ) {
      add('P1', 'package-lock.json', 'ExcelJS streaming writer compatibility probe returned mismatched data.');
    }
  } catch (error) {
    add('P1', 'package-lock.json', `ExcelJS runtime compatibility probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (!fs.existsSync(path.join(root, 'docs/adr/0019-production-dependency-security.md'))) {
  add('P2', 'docs/adr/0019-production-dependency-security.md', 'Production dependency security ADR is missing.');
}

async function main() {
  await auditSpreadsheetRuntimeCompatibility();

  if (findings.length) {
    console.error('Production Dependency Security Audit: FAIL');
    for (const finding of findings) {
      console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
    }
    process.exit(1);
  }

  console.log('Production Dependency Security Audit: PASS');
  console.log('- npm audit --omit=dev has zero production vulnerabilities in root and backend package trees.');
  console.log('- Fixable production advisories are constrained through exact direct versions and compatibility-tested npm overrides.');
  console.log('- Spreadsheet import/export uses ExcelJS behind a shared size/type validation boundary.');
  console.log('- ExcelJS document and streaming write/read compatibility preserves text, numbers, formulas, and styles.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
