const fs = require('fs');
const path = require('path');
const { isActiveSource } = require('./lib/active-source-scope.cjs');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const REPORT_PATH = path.join(OUTPUT_DIR, 'status-badge-governance-audit-v1.json');

const SOURCE_ROOTS = ['components', 'pages'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

const toPosix = (filePath) => filePath.split(path.sep).join('/');
const rel = (filePath) => toPosix(path.relative(ROOT, filePath));

function walk(dir, files) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    if (!isActiveSource(rel(full))) continue;
    files.push(full);
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function findAll(text, regex) {
  const matches = [];
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text))) {
    matches.push({ index: match.index, value: match[0] });
  }
  return matches;
}

function main() {
  const files = [];
  for (const root of SOURCE_ROOTS) walk(path.join(ROOT, root), files);

  const findings = [];
  const allowedStatusBadgeExports = new Set([
    'components/ui/StatusBadge.tsx',
    'components/DataTable.tsx',
  ]);
  const allowedLowercaseStatusBadgeHelpers = new Set([
    'pages/collections/collectionCenter.helpers.ts',
  ]);

  for (const file of files) {
    const relative = rel(file);
    const text = fs.readFileSync(file, 'utf8');

    for (const match of findAll(text, /export\s+const\s+StatusBadge\b/g)) {
      if (!allowedStatusBadgeExports.has(relative)) {
        findings.push({
          file: relative,
          line: lineOf(text, match.index),
          rule: 'no-page-local-status-badge-export',
          message: '页面或模块不得再导出本地 StatusBadge；请使用公共 components/ui/StatusBadge 或业务正名组件。',
        });
      }
    }

    for (const match of findAll(text, /\bSTATUS_BADGE\b/g)) {
      findings.push({
        file: relative,
        line: lineOf(text, match.index),
        rule: 'no-legacy-status-badge-table',
        message: '不得新增旧式 STATUS_BADGE class 表；状态色应集中到 components/ui/StatusBadge。',
      });
    }

    for (const match of findAll(text, /\bstatusClass\s*=/g)) {
      findings.push({
        file: relative,
        line: lineOf(text, match.index),
        rule: 'no-page-status-class-helper',
        message: '不得新增页面内 statusClass；状态色应复用公共状态色工具。',
      });
    }

    for (const match of findAll(text, /export\s+const\s+statusBadge\b/g)) {
      if (!allowedLowercaseStatusBadgeHelpers.has(relative)) {
        findings.push({
          file: relative,
          line: lineOf(text, match.index),
          rule: 'no-unregistered-status-badge-helper',
          message: '小写 statusBadge helper 需要登记；优先复用公共状态色工具。',
        });
      }
    }
  }

  const requiredImports = [
    'pages/collections/collectionCenter.helpers.ts',
    'pages/adjustment/adjustment.constants.tsx',
    'pages/production/ProductionWorkspacePrimitives.tsx',
  ];

  for (const relative of requiredImports) {
    const full = path.join(ROOT, ...relative.split('/'));
    const text = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
    if (!text.includes('getStatusBorderBadgeClassName')) {
      findings.push({
        file: relative,
        line: 1,
        rule: 'required-status-tone-bridge-missing',
        message: '该文件应通过 getStatusBorderBadgeClassName 接入统一状态色口径。',
      });
    }
  }

  const productionPrimitives = path.join(ROOT, 'pages', 'production', 'ProductionWorkspacePrimitives.tsx');
  const productionText = fs.existsSync(productionPrimitives) ? fs.readFileSync(productionPrimitives, 'utf8') : '';
  if (!productionText.includes('WorkOrderStatusBadge')) {
    findings.push({
      file: 'pages/production/ProductionWorkspacePrimitives.tsx',
      line: 1,
      rule: 'production-status-badge-not-renamed',
      message: '生产工单状态组件必须正名为 WorkOrderStatusBadge，避免与公共 StatusBadge 混淆。',
    });
  }

  const dataTable = path.join(ROOT, 'components', 'DataTable.tsx');
  const dataTableText = fs.existsSync(dataTable) ? fs.readFileSync(dataTable, 'utf8') : '';
  if (!dataTableText.includes('UnifiedStatusBadge')) {
    findings.push({
      file: 'components/DataTable.tsx',
      line: 1,
      rule: 'datatable-compat-not-bridged',
      message: 'DataTable 兼容 StatusBadge 必须桥接到公共 StatusBadge。',
    });
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const report = {
    status: findings.length ? 'failed' : 'passed',
    scannedFiles: files.length,
    findings,
  };
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, report: REPORT_PATH }, null, 2));
  if (findings.length) process.exitCode = 1;
}

main();
