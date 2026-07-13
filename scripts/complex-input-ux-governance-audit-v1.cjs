const fs = require('fs');
const path = require('path');

const root = process.cwd();
const outputDir = path.join(root, 'output', 'audit');
const jsonPath = path.join(outputDir, 'complex-input-ux-governance-audit-v1.json');
const mdPath = path.join(outputDir, 'complex-input-ux-governance-audit-v1.md');

const modules = [
  {
    id: 'dashboard',
    page: 'pages/Dashboard.tsx',
    targetPattern: 'overview-page',
    inputModel: 'read-only dashboard',
    mustHave: ['role-based KPI', 'drill-down entry', 'no direct business write'],
    priority: 'P2',
  },
  {
    id: 'crm',
    page: 'pages/CRM.tsx',
    targetPattern: 'master-data object page',
    inputModel: 'simple create + advanced drawer',
    mustHave: ['multi-name', 'multi-address', 'multi-contact', 'pool ownership', 'audit trail'],
    priority: 'P0',
  },
  {
    id: 'orders',
    page: 'pages/SalesOrders.tsx',
    targetPattern: 'document header + line grid',
    inputModel: 'header form + editable detail grid',
    mustHave: ['customer lookup', 'order lines', 'save readback', 'status action boundary', 'payment link'],
    priority: 'P0',
  },
  {
    id: 'collections',
    page: 'pages/collections/CollectionCenterView.tsx',
    targetPattern: 'workbench + ledger',
    inputModel: 'action modal + ledger readback',
    mustHave: ['partial payment', 'verification', 'promise payment', 'overdue search', 'conflict guard'],
    priority: 'P0',
  },
  {
    id: 'adjustment',
    page: 'pages/adjustment/AdjustmentCenterView.tsx',
    targetPattern: 'adjustment voucher + ledger',
    inputModel: 'voucher form + approval/posting ledger',
    mustHave: ['domain boundary', 'reason required', 'post/reverse', 'audit trace'],
    priority: 'P0',
  },
  {
    id: 'financeAnalytics',
    page: 'pages/FinanceAnalyticsWorkspaceV2.tsx',
    targetPattern: 'analytics + correct action entry',
    inputModel: 'read-only analytics + adjustment entry',
    mustHave: ['do not fake payment', 'AR adjustment boundary', 'aging/cashflow readback', 'export'],
    priority: 'P0',
  },
  {
    id: 'contracts',
    page: 'pages/Contracts.tsx',
    targetPattern: 'contract object page',
    inputModel: 'contract header + clauses/files + fulfillment links',
    mustHave: ['counterparty', 'currency', 'attachments', 'fulfillment links', 'audit'],
    priority: 'P2',
  },
  {
    id: 'barter',
    page: 'pages/BarterWorkspaceView.tsx',
    supportGlobs: ['pages/barter'],
    targetPattern: 'agreement + batch ledger',
    inputModel: 'agreement form + partial offset grid + posting ledger',
    mustHave: ['valuation snapshot', 'partial delivery', 'partial offset', 'stock closure', 'reverse'],
    priority: 'P0',
  },
  {
    id: 'samples',
    page: 'pages/Samples.tsx',
    targetPattern: 'request + follow-up ledger',
    inputModel: 'simple request form + status ledger',
    mustHave: ['request', 'send-out', 'test feedback', 'follow-up', 'RMA link'],
    priority: 'P2',
  },
  {
    id: 'shipping',
    page: 'pages/Shipping.tsx',
    supportGlobs: ['pages/shipping'],
    targetPattern: 'shipping document + POD workbench',
    inputModel: 'shipment header + package/detail grid + receipt action',
    mustHave: ['shipment', 'POD/OCR', 'stock deduction', 'discrepancy link', 'readback'],
    priority: 'P1',
  },
  {
    id: 'discrepancies',
    page: 'pages/ReceiptDiscrepancyWorkbench.tsx',
    targetPattern: 'exception workbench',
    inputModel: 'case action + reason + closure',
    mustHave: ['short receipt', 'reject', 'tolerance', 'action chain', 'RMA link'],
    priority: 'P1',
  },
  {
    id: 'rma',
    page: 'pages/RMA.tsx',
    targetPattern: 'case object page',
    inputModel: 'case form + action timeline',
    mustHave: ['return', 'replacement', 'compensation', 'approval', 'closure'],
    priority: 'P2',
  },
  {
    id: 'team',
    page: 'pages/TeamManagement.tsx',
    targetPattern: 'admin configuration',
    inputModel: 'role form + permission matrix',
    mustHave: ['role assignment', 'permission points', 'super admin boundary', 'audit'],
    priority: 'P1',
  },
  {
    id: 'assets',
    page: 'pages/Assets.tsx',
    targetPattern: 'asset ledger',
    inputModel: 'asset master + movement ledger',
    mustHave: ['asset master', 'borrow/return', 'movement', 'batch trace'],
    priority: 'P2',
  },
  {
    id: 'production',
    page: 'pages/ProductionWorkspace.tsx',
    secondaryPage: 'pages/ProductionWorkspaceV2.tsx',
    supportGlobs: ['pages/production'],
    targetPattern: 'formula/BOM + work order + batch ledger',
    inputModel: 'formula header + ingredient grid + work-order execution wizard',
    mustHave: ['10-line chemical BOM', 'code-only materials', 'work-order consumption', 'finished goods inbound', 'anti-fake-completion'],
    priority: 'P0',
  },
  {
    id: 'warehouse',
    page: 'pages/WarehouseWorkspace.tsx',
    supportGlobs: ['pages/warehouse'],
    targetPattern: 'inventory workbench',
    inputModel: 'warehouse/location master + stock movement ledger',
    mustHave: ['warehouse', 'location', 'stock ledger', 'transfer', 'negative-stock guard'],
    priority: 'P0',
  },
  {
    id: 'procurement',
    page: 'pages/Procurement.tsx',
    supportGlobs: ['pages/procurement'],
    targetPattern: 'supplier + purchase document + receiving',
    inputModel: 'supplier master + PO header/detail + receiving action',
    mustHave: ['supplier lookup', 'PO lines', 'partial receipt', 'inbound', 'discrepancy/RMA link'],
    priority: 'P0',
  },
  {
    id: 'audit',
    page: 'pages/AuditLogs.tsx',
    targetPattern: 'read-only audit log',
    inputModel: 'filter table only',
    mustHave: ['filters', 'actor', 'action', 'timestamp', 'no business writes'],
    priority: 'P1',
  },
];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return '';
  return fs.readFileSync(absolutePath, 'utf8');
}

function readDirectorySource(relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  if (!fs.existsSync(absoluteDirectory)) return '';
  const chunks = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (/\.(tsx?|jsx?|cjs|mjs)$/.test(entry.name)) {
        chunks.push(fs.readFileSync(fullPath, 'utf8'));
      }
    }
  };
  visit(absoluteDirectory);
  return chunks.join('\n');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function inspectModule(module) {
  const primary = read(module.page);
  const secondary = module.secondaryPage ? read(module.secondaryPage) : '';
  const support = (module.supportGlobs || []).map(readDirectorySource).join('\n');
  const text = `${primary}\n${secondary}\n${support}`;
  const fileOk = exists(module.page) && (!module.secondaryPage || exists(module.secondaryPage));
  const hasGuide = text.includes('DocumentInputGuide') || text.includes('WorkspaceTaskNavigator');
  const hasGrid = text.includes('EnterpriseDataGrid') || text.includes('DataTable') || text.includes('<table') || text.includes('LineGrid') || text.includes('Editor') || text.includes('Panel');
  const hasActionBoundary = text.includes('ReasonDialog') || text.includes('StatusBadge') || text.includes('post') || text.includes('reverse') || text.includes('approve') || text.includes('transfer') || text.includes('receipt') || text.includes('audit');
  const hasReadbackHint = /readback|回读|loadData|onChanged|refresh|刷新/.test(text);
  const risks = [];

  if (!fileOk) risks.push('entry file missing');
  if (['P0', 'P1'].includes(module.priority) && !hasGuide) risks.push('missing explicit guide/navigator');
  if (module.inputModel.includes('grid') && !hasGrid) risks.push('expected detail grid not detected');
  if (module.mustHave.some(item => ['post/reverse', 'partial offset', 'work-order consumption', 'partial receipt'].includes(item)) && !hasActionBoundary) {
    risks.push('action boundary not obvious');
  }
  if (['P0', 'P1'].includes(module.priority) && !hasReadbackHint) risks.push('readback evidence not obvious');

  return {
    ...module,
    fileOk,
    signals: {
      hasGuide,
      hasGrid,
      hasActionBoundary,
      hasReadbackHint,
    },
    risks,
    status: risks.length ? 'needs-review' : 'ok',
  };
}

const results = modules.map(inspectModule);
const p0P1Risks = results.filter(item => ['P0', 'P1'].includes(item.priority) && item.risks.length);
const needsReviewCount = results.filter(item => item.status !== 'ok').length;
const report = {
  generatedAt: new Date().toISOString(),
  cwd: root,
  researchBasis: [
    'SAP Fiori: list report/object page/wizard/overview page separation; object pages should be role-based, coherent, simple, adaptive.',
    'Business Central: document and journal workflows separate templates, batches, lines, posting, and review.',
    'Odoo: order/invoice forms commonly use parent form plus one2many line tables for child records.',
    'Chinese SMB ERP pattern: quick document entry, header/detail lines, save draft/post, audit/reverse, inventory and AR/AP ledger readback.',
  ],
  localPrinciples: [
    'Keep existing AilaoDa functions; do not simplify by deleting business capability.',
    'China/Vietnam cross-border fit is mandatory: multi-language names, multiple legal/logistics/billing addresses, CNY/VND/USD, exchange-rate snapshot, barter trade.',
    'Complex pages must say whether the user is editing master data, detail lines, actions, ledger, or audit.',
  ],
  results,
  summary: {
    moduleCount: results.length,
    ok: results.filter(item => item.status === 'ok').length,
    needsReview: needsReviewCount,
    p0P1RiskCount: p0P1Risks.length,
    status: needsReviewCount === 0 ? 'passed' : 'completed-with-prioritized-findings',
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const md = [
  '# Complex Input UX Governance Audit',
  '',
  `- generatedAt: ${report.generatedAt}`,
  `- status: ${report.summary.status}`,
  `- modules: ${report.summary.moduleCount}`,
  `- ok: ${report.summary.ok}`,
  `- needsReview: ${report.summary.needsReview}`,
  `- p0P1RiskCount: ${report.summary.p0P1RiskCount}`,
  '',
  '## Research Basis',
  '',
  ...report.researchBasis.map(item => `- ${item}`),
  '',
  '## Local Principles',
  '',
  ...report.localPrinciples.map(item => `- ${item}`),
  '',
  '## Module Matrix',
  '',
  '| Module | Priority | Target Pattern | Input Model | Signals | Risks |',
  '| --- | --- | --- | --- | --- | --- |',
  ...results.map(item => `| ${item.id} | ${item.priority} | ${item.targetPattern} | ${item.inputModel} | guide=${item.signals.hasGuide}; grid=${item.signals.hasGrid}; action=${item.signals.hasActionBoundary}; readback=${item.signals.hasReadbackHint} | ${item.risks.join('; ') || 'none'} |`),
  '',
].join('\n');

fs.writeFileSync(mdPath, `${md}\n`, 'utf8');
console.log(JSON.stringify(report.summary, null, 2));
