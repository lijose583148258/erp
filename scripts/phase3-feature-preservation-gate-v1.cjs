const fs = require('fs');
const path = require('path');

const root = process.cwd();
const outputDir = path.join(root, 'output', 'audit');
const jsonPath = path.join(outputDir, 'phase3-feature-preservation-gate-v1.json');
const mdPath = path.join(outputDir, 'phase3-feature-preservation-gate-v1.md');

const requiredFiles = [
  { id: 'crm-workspace', path: 'pages/CRM.tsx', layer: 'page' },
  { id: 'sales-orders-workspace', path: 'pages/SalesOrders.tsx', layer: 'page' },
  { id: 'procurement-workspace', path: 'pages/Procurement.tsx', layer: 'page' },
  { id: 'production-workspace', path: 'pages/ProductionWorkspaceV2.tsx', layer: 'page' },
  { id: 'barter-workspace', path: 'pages/BarterWorkspaceView.tsx', layer: 'page' },
  { id: 'warehouse-workspace', path: 'pages/WarehouseWorkspace.tsx', layer: 'page' },
  { id: 'collection-center', path: 'pages/collections/CollectionCenterView.tsx', layer: 'page' },
  { id: 'shipping-workspace', path: 'pages/Shipping.tsx', layer: 'page' },
  { id: 'receivable-adjustment', path: 'pages/finance/ReceivableAdjustmentPanel.tsx', layer: 'page' },
  { id: 'role-management', path: 'pages/team/RoleManagementPanel.tsx', layer: 'page' },
  { id: 'workspace-task-navigator', path: 'components/ui/WorkspaceTaskNavigator.tsx', layer: 'ui' },
  { id: 'enterprise-data-grid', path: 'components/ui/EnterpriseDataGrid.tsx', layer: 'ui' },
  { id: 'form-field', path: 'components/ui/FormField.tsx', layer: 'ui' },
  { id: 'masterdata-readback-audit', path: 'scripts/masterdata-search-readback-api-audit-v1.cjs', layer: 'audit' },
  { id: 'sales-orders-browser-audit', path: 'scripts/sales-orders-browser-audit-v1.cjs', layer: 'audit' },
  { id: 'collection-human-flow-audit', path: 'scripts/collection-center-human-flow-browser-audit-v1.cjs', layer: 'audit' },
  { id: 'procurement-browser-audit', path: 'scripts/procurement-browser-audit-v1.cjs', layer: 'audit' },
  { id: 'chemical-bom-audit', path: 'scripts/chemical-bom-production-chain-audit-v1.cjs', layer: 'audit' },
  { id: 'barter-browser-audit', path: 'scripts/barter-browser-audit-v2.cjs', layer: 'audit' },
  { id: 'barter-stock-closure-audit', path: 'scripts/verify-barter-stock-closure.cjs', layer: 'audit' },
  { id: 'warehouse-ledger-audit', path: 'scripts/warehouse-ledger-api-audit-v1.cjs', layer: 'audit' },
  { id: 'stock-ledger-audit', path: 'scripts/stock-ledger-reconcile-audit-v1.cjs', layer: 'audit' },
  { id: 'mojibake-gate', path: 'scripts/effective-source-mojibake-gate-v1.cjs', layer: 'audit' },
];

const requiredPackageScripts = [
  'audit:daily:local-governance',
  'audit:phase3:soak:package',
  'audit:package:origin',
  'check:runtime',
  'audit:masterdata:search-readback',
  'audit:collection:human-flow',
  'audit:payment:verification-concurrency',
  'audit:warehouse:ledger',
  'audit:stock:ledger',
  'audit:test-data:whitelist',
];

const requiredBusinessCapabilities = [
  'CRM master data with multi-name, multi-address, multi-contact direction',
  'Sales order document chain with detail lines and payment readback',
  'Collection and payment verification chain',
  'Procurement supplier and purchase chain',
  'Chemical formula/BOM and production completion chain',
  'Warehouse stock ledger and movement chain',
  'Barter agreement, batch deduction, posting, and reversal chain',
  'Role and permission governance chain',
  'Backup, restore, migration, and local package chain',
  'Encoding triage and mojibake gate chain',
];

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function readJsonIfExists(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    return { __parseError: error.message };
  }
}

function getByPath(source, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => {
    if (current && Object.prototype.hasOwnProperty.call(current, key)) {
      return current[key];
    }
    return undefined;
  }, source);
}

const packageJson = readJsonIfExists('package.json');
const packageScriptResults = requiredPackageScripts.map((scriptName) => ({
  scriptName,
  ok: Boolean(packageJson && packageJson.scripts && packageJson.scripts[scriptName]),
}));

const fileResults = requiredFiles.map((item) => ({
  ...item,
  ok: exists(item.path),
}));

const originReport = readJsonIfExists('output/audit/stable-package-origin-audit-v1.json');
const originRoot = originReport && !originReport.__parseError
  ? (originReport.activePackageRoot || getByPath(originReport, 'summary.activePackageRoot') || getByPath(originReport, 'runtime.activePackageRoot'))
  : null;
const expectedPackageRoot = 'E:\\爱劳达纯净系统';
const originChecks = [
  {
    id: 'stable-package-origin-report-readable',
    ok: Boolean(originReport && !originReport.__parseError),
    actual: originReport && originReport.__parseError ? originReport.__parseError : 'readable',
  },
  {
    id: 'stable-package-origin-is-clean-e-drive-package',
    ok: originRoot ? String(originRoot).toLowerCase() === expectedPackageRoot.toLowerCase() : false,
    expected: expectedPackageRoot,
    actual: originRoot || 'missing',
  },
];

const findings = [
  ...fileResults.filter((item) => !item.ok).map((item) => ({
    level: 'P0',
    id: item.id,
    message: `Required ${item.layer} file is missing: ${item.path}`,
  })),
  ...packageScriptResults.filter((item) => !item.ok).map((item) => ({
    level: 'P0',
    id: item.scriptName,
    message: `Required package script is missing: ${item.scriptName}`,
  })),
  ...originChecks.filter((item) => !item.ok).map((item) => ({
    level: 'P1',
    id: item.id,
    message: `Stable package origin check failed. expected=${item.expected || 'readable'} actual=${item.actual}`,
  })),
];

const report = {
  generatedAt: new Date().toISOString(),
  cwd: root,
  policy: {
    mode: 'read-only',
    destructiveActionsPerformed: 0,
    scope: 'Phase 3 feature preservation gate before productization changes',
    nonLossPrinciple: 'Do not remove current ERP/CRM capabilities while improving UI, input flow, or module responsibility layout.',
    regionalFitPrinciple: 'Keep China SMB ERP habits and Vietnam-China cross-border trade requirements as first-class product constraints.',
  },
  requiredBusinessCapabilities,
  fileResults,
  packageScriptResults,
  originChecks,
  summary: {
    requiredFileCount: fileResults.length,
    requiredFilesOk: fileResults.filter((item) => item.ok).length,
    requiredPackageScriptCount: packageScriptResults.length,
    requiredPackageScriptsOk: packageScriptResults.filter((item) => item.ok).length,
    stablePackageOriginOk: originChecks.every((item) => item.ok),
    findingCount: findings.length,
    status: findings.length === 0 ? 'PASS' : 'FAIL',
  },
  findings,
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const lines = [
  '# Phase 3 Feature Preservation Gate',
  '',
  `- generatedAt: ${report.generatedAt}`,
  `- status: ${report.summary.status}`,
  `- destructiveActionsPerformed: ${report.policy.destructiveActionsPerformed}`,
  `- requiredFiles: ${report.summary.requiredFilesOk}/${report.summary.requiredFileCount}`,
  `- requiredPackageScripts: ${report.summary.requiredPackageScriptsOk}/${report.summary.requiredPackageScriptCount}`,
  `- stablePackageOriginOk: ${report.summary.stablePackageOriginOk}`,
  '',
  '## Non-loss Principle',
  '',
  report.policy.nonLossPrinciple,
  '',
  '## Regional Fit Principle',
  '',
  report.policy.regionalFitPrinciple,
  '',
  '## Required Business Capabilities',
  '',
  ...requiredBusinessCapabilities.map((item) => `- ${item}`),
  '',
  '## Findings',
  '',
  ...(findings.length ? findings.map((item) => `- ${item.level} ${item.id}: ${item.message}`) : ['- none']),
  '',
];
fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');

if (findings.length > 0) {
  console.error(JSON.stringify(report.summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(report.summary, null, 2));
