const { buildProductReadinessCriteria } = require('./commercial-erp-crm-ui-ux-criteria.cjs');

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  'mobile-390': { width: 390, height: 844 },
  'mobile-375': { width: 375, height: 812 },
};

const SAMPLING_MATRIX = {
  viewports: Object.entries(VIEWPORTS).map(([id, size]) => ({ id, ...size })),
  requiredThemes: ['light', 'dark'],
  requiredLocales: ['zh', 'en', 'vi'],
  manualEvidenceRequired: [
    'Record theme and locale for each reviewed screenshot or mark an explicit unsampled reason.',
    'Capture focus/accessibility notes for high-value routes during manual review.',
  ],
};

const COMMON_ROUTE_CRITERIA = ['STATE-01', 'A11Y-01', 'LANG-01'];
const EXECUTIVE_CRITERIA = ['DASH-01', 'DASH-02', 'DASH-03', 'DASH-04', 'METRIC-01', 'ROLE-01', 'FLOW-01'];
const LIST_CRITERIA = ['FILTER-01', 'FILTER-02', 'FILTER-03', 'FILTER-04', 'TABLE-01', 'TABLE-02', 'TABLE-03'];
const THEME_CRITERIA = ['DARK-01', 'DARK-02'];
const MOBILE_CRITERIA = ['MOBILE-01', 'MOBILE-02', 'MOBILE-03'];
const OWNER_MOBILE_CRITERIA = ['MOBILE-04'];
const IMPORT_CRITERIA = ['IMPORT-01', 'IMPORT-02'];
const FINANCE_CRITERIA = ['DASH-01', 'DASH-02', 'DASH-04', 'METRIC-01', 'ROLE-01', 'FLOW-01'];
const GOVERNANCE_CRITERIA = ['ROLE-01', 'STATE-01', 'A11Y-01', 'LANG-01'];
const AI_CRITERIA = ['AI-01', 'AI-02', 'AI-03', 'AI-04'];

const MODULES = [
  {
    id: 'dashboard',
    hash: '#dashboard',
    title: 'AilaoDa Business Cockpit',
    expected: ['AilaoDa Business Cockpit', 'Overview'],
    category: 'executive-readiness',
    group: 'overview',
    risk: 'high',
    weight: 9,
    tags: ['commercial', 'executive', 'navigation', 'kpi'],
  },
  {
    id: 'crm',
    hash: '#crm',
    title: 'Customer Relationship and Credit Files',
    expected: ['Customer Relationship and Credit Files', 'Customers'],
    category: 'crm-readiness',
    group: 'sales',
    risk: 'critical',
    weight: 10,
    tags: ['commercial', 'crm', 'customer-master', 'credit'],
  },
  {
    id: 'orders',
    hash: '#orders',
    title: 'Sales Order Center',
    expected: ['Sales Order Center', 'Sales Orders'],
    category: 'order-readiness',
    group: 'sales',
    risk: 'critical',
    weight: 10,
    tags: ['commercial', 'orders', 'revenue', 'operating-table'],
  },
  {
    id: 'collections',
    hash: '#collections',
    title: 'Collections and Verification Center',
    expected: ['Collections and Verification Center', 'Collections'],
    category: 'cash-readiness',
    group: 'sales',
    risk: 'critical',
    weight: 10,
    tags: ['commercial', 'collections', 'cash', 'finance'],
  },
  {
    id: 'financeAnalytics',
    hash: '#financeAnalytics',
    title: 'Finance Operations Analytics',
    expected: ['Finance Operations Analytics', 'Finance'],
    category: 'finance-readiness',
    group: 'overview',
    risk: 'critical',
    weight: 10,
    tags: ['commercial', 'finance', 'analytics', 'risk'],
  },
  {
    id: 'contracts',
    hash: '#contracts',
    title: 'Contract Management Center',
    expected: ['Contract Management Center', 'Contracts'],
    category: 'contract-readiness',
    group: 'sales',
    risk: 'high',
    weight: 8,
    tags: ['commercial', 'contracts', 'documents', 'fulfillment'],
  },
  {
    id: 'shipping',
    hash: '#shipping',
    title: 'Shipping, Logistics, and POD',
    expected: ['Shipping, Logistics, and POD', 'Shipping'],
    mobileExpected: ['SHIPPING', 'Logistics tracking'],
    category: 'fulfillment-readiness',
    group: 'supply',
    risk: 'critical',
    weight: 10,
    tags: ['commercial', 'shipping', 'pod', 'inventory'],
  },
  {
    id: 'discrepancies',
    hash: '#discrepancies',
    title: 'Receiving and Shipping Discrepancy Workbench',
    expected: ['Receiving and Shipping Discrepancy Workbench', 'Discrepancy'],
    mobileExpected: ['EXCEPTION GOVERNANCE', '\u6536\u53d1\u8d27\u5dee\u5f02\u5de5\u4f5c\u53f0'],
    category: 'exception-readiness',
    group: 'supply',
    risk: 'high',
    weight: 8,
    tags: ['commercial', 'discrepancy', 'exception', 'quality'],
  },
  {
    id: 'production',
    hash: '#production',
    title: 'Production Formulas and Work Orders',
    expected: ['Production Formulas and Work Orders', 'Production'],
    mobileExpected: ['PRODUCTION FORMULAS AND WORK ORDERS', 'MANAGE CHEMICAL BOM'],
    category: 'production-readiness',
    group: 'production',
    risk: 'critical',
    weight: 10,
    tags: ['commercial', 'production', 'bom', 'work-order'],
  },
  {
    id: 'warehouse',
    hash: '#warehouse',
    title: 'Warehouse, Locations, and Inventory',
    expected: ['Warehouse, Locations, and Inventory', 'Warehouse'],
    category: 'inventory-readiness',
    group: 'supply',
    risk: 'critical',
    weight: 10,
    tags: ['commercial', 'warehouse', 'inventory', 'stock'],
  },
  {
    id: 'procurement',
    hash: '#procurement',
    title: 'Procurement, Suppliers, and Receiving',
    expected: ['Procurement, Suppliers, and Receiving', 'Procurement'],
    category: 'procurement-readiness',
    group: 'supply',
    risk: 'high',
    weight: 8,
    tags: ['commercial', 'procurement', 'supplier', 'receiving'],
  },
  {
    id: 'barter',
    hash: '#barter',
    title: 'Goods Offset Payment / Barter Trade',
    expected: ['Goods Offset Payment / Barter Trade', 'Barter'],
    category: 'settlement-readiness',
    group: 'sales',
    risk: 'high',
    weight: 8,
    tags: ['commercial', 'barter', 'settlement', 'offset'],
  },
  {
    id: 'team',
    hash: '#team',
    title: 'Users, Roles, and Permissions',
    expected: ['Users, Roles, and Permissions', 'Org & Roles'],
    mobileExpected: ['\u7ec4\u7ec7\u6743\u9650', '\u521b\u5efa\u8d26\u53f7'],
    category: 'governance-readiness',
    group: 'governance',
    risk: 'critical',
    weight: 9,
    tags: ['commercial', 'permissions', 'rbac', 'governance'],
  },
  {
    id: 'audit',
    hash: '#audit',
    title: 'System Audit and Operation Logs',
    expected: ['System Audit and Operation Logs', 'Audit Logs'],
    category: 'audit-readiness',
    group: 'governance',
    risk: 'high',
    weight: 8,
    tags: ['commercial', 'audit', 'logs', 'governance'],
  },
  {
    id: 'settings',
    hash: '#settings',
    title: 'System Settings and AI Governance',
    expected: ['System Settings', 'AI Settings'],
    mobileExpected: ['AI Settings', 'Privacy gate'],
    category: 'ai-governance-readiness',
    group: 'governance',
    risk: 'high',
    weight: 8,
    tags: ['commercial', 'settings', 'ai', 'privacy', 'governance'],
  },
];

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function criteriaIdsForModule(module, viewportId) {
  const criteria = [...COMMON_ROUTE_CRITERIA, ...THEME_CRITERIA];

  if (module.id === 'dashboard') {
    criteria.push(...EXECUTIVE_CRITERIA);
  } else if (module.id === 'financeAnalytics') {
    criteria.push(...FINANCE_CRITERIA, ...LIST_CRITERIA);
  } else if (module.id === 'settings') {
    criteria.push(...GOVERNANCE_CRITERIA, ...AI_CRITERIA);
  } else if (module.group === 'governance') {
    criteria.push(...GOVERNANCE_CRITERIA, 'TABLE-01', 'TABLE-02');
  } else {
    criteria.push(...LIST_CRITERIA);
  }

  if (['orders', 'crm', 'procurement'].includes(module.id)) {
    criteria.push(...IMPORT_CRITERIA);
  }

  if (viewportId.startsWith('mobile')) {
    criteria.push(...MOBILE_CRITERIA);
    if (['dashboard', 'financeAnalytics'].includes(module.id)) {
      criteria.push(...OWNER_MOBILE_CRITERIA);
    }
  }

  return unique(criteria);
}

function evidenceRequiredForCriteria(criteriaIds, viewportId) {
  const evidence = [
    'route screenshot',
    'matched expected text',
    'console/page/network failure summary',
    'theme and locale value or explicit unsampled reason',
  ];

  if (criteriaIds.some((id) => id.startsWith('DASH') || id === 'METRIC-01' || id === 'FLOW-01')) {
    evidence.push('KPI inventory and missing executive metric notes');
    evidence.push('drill-down or unavailable marker');
  }
  if (criteriaIds.some((id) => id.startsWith('FILTER'))) {
    evidence.push('filter before/after state');
    evidence.push('URL refresh/restoration note');
  }
  if (criteriaIds.some((id) => id.startsWith('TABLE'))) {
    evidence.push('table toolbar, sorting, pagination, export, and scale note');
  }
  if (viewportId.startsWith('mobile')) {
    evidence.push('mobile card/overflow/touch-target note');
  }
  if (criteriaIds.some((id) => id.startsWith('IMPORT'))) {
    evidence.push('import template, preview, duplicate, and failed-row evidence or unavailable marker');
  }
  if (criteriaIds.some((id) => id.startsWith('AI'))) {
    evidence.push('AI privacy gate, role isolation, refusal, and eval evidence');
  }
  if (criteriaIds.some((id) => id.startsWith('DARK'))) {
    evidence.push('dark-mode foreground/background contrast pair and WCAG threshold note');
    evidence.push('status meaning not color-only evidence');
  }

  return unique(evidence);
}

function actionEvidenceForCriteria(criteriaIds) {
  const actions = [];
  if (criteriaIds.some((id) => id.startsWith('FILTER'))) {
    actions.push('filter-before-after');
    actions.push('url-refresh-state');
  }
  if (criteriaIds.some((id) => id.startsWith('TABLE'))) {
    actions.push('sort-pagination-export-boundary');
  }
  if (criteriaIds.some((id) => id.startsWith('MOBILE'))) {
    actions.push('mobile-overflow-or-card-note');
  }
  if (criteriaIds.includes('A11Y-01')) {
    actions.push('focus-and-accessible-name-note');
  }
  if (criteriaIds.some((id) => id.startsWith('AI'))) {
    actions.push('ai-privacy-settings-and-refusal-evidence');
  }
  return unique(actions);
}

function expandRoute(module, viewportId) {
  const criteriaIds = criteriaIdsForModule(module, viewportId);
  return {
    id: `${module.id}-${viewportId}`,
    hash: module.hash,
    title: `${module.title} (${viewportId})`,
    expected: viewportId.startsWith('mobile') && module.mobileExpected ? module.mobileExpected : module.expected,
    category: module.category,
    severity: module.risk === 'critical' ? 'blocker' : 'error',
    tags: [...module.tags, module.group, module.risk, viewportId],
    viewport: VIEWPORTS[viewportId],
    commercial: {
      moduleId: module.id,
      group: module.group,
      risk: module.risk,
      viewport: viewportId,
      weight: module.weight,
      criteriaIds,
      evidenceRequired: evidenceRequiredForCriteria(criteriaIds, viewportId),
      actionEvidence: actionEvidenceForCriteria(criteriaIds),
      sampling: {
        viewport: { id: viewportId, ...VIEWPORTS[viewportId] },
        requiredThemes: SAMPLING_MATRIX.requiredThemes,
        requiredLocales: SAMPLING_MATRIX.requiredLocales,
        manualEvidenceRequired: true,
      },
    },
  };
}

const routes = MODULES.flatMap((module) => Object.keys(VIEWPORTS).map((viewportId) => expandRoute(module, viewportId)));


const productReadinessCriteria = buildProductReadinessCriteria(VIEWPORTS);

const approvedSkillAndAgentSupport = {
  localSkills: [
    'erp-commercial-product-manager (.agents/skills/erp-commercial-product-manager)',
    'erp-enterprise-ui-designer (.agents/skills/erp-enterprise-ui-designer)',
    'erp-team-rd-coordinator (.agents/skills/erp-team-rd-coordinator)',
    'erp-codebase-scout (.agents/skills/erp-codebase-scout)',
    'erp-enterprise-software-delivery (.agents/skills/erp-enterprise-software-delivery)',
    'erp-ai-feature-governance (.agents/skills/erp-ai-feature-governance)',
    'erp-evidence-first-reasoning (.agents/skills/erp-evidence-first-reasoning)',
    'erp-ui-audit',
    'erp-audit-roles',
    'erp-anti-hallucination-review',
    'erp-system-architecture',
    'frontend-skill',
    'security-best-practices',
  ],
  subagents: [
    'Product R&D / PM explorer',
    'Enterprise UI/UX explorer',
    'Codebase integration explorer',
    'Enterprise delivery/SRE explorer when release, observability, dependency, or validation risk appears',
    'AI feature governance explorer when assistant, OCR, import, external model, or permission-isolation risk appears',
    'Evidence-first reasoning verifier when claims, audit scores, screenshots, or readiness language need proof',
  ],
  guardrails: [
    'read-only unless a later task grants a narrow disjoint write set',
    'no external agent runtime or prompt-pack installs',
    'no browser extensions or unknown GitHub scripts',
    'no PR1 runner foundation, CI workflow, backend/base, or stale stash edits',
    'main controller must inspect conclusions and rerun relevant commands',
    'do not claim exact Claude/Fable compatibility unless the local skill exists and is inspectable',
    'AI feature implementation belongs in a separate focused PR unless the current task explicitly changes PR2 scope',
  ],
};

const commercialAuditConfig = {
  schemaVersion: 1,
  auditId: 'commercial-erp-crm-ui-ux-v1',
  scope: [
    'commercial ERP/CRM UI/UX audit only',
    'uses PR1 isolated parallel Playwright runner as foundation',
    'adds audit route definitions, commercial-readiness scoring, evidence collection, screenshots, and report generation',
    'must not modify PR1 runner behavior unless required by PR2 audit and narrowly scoped',
    'must not include unrelated CI/base/backend fixes',
    'must not restore old mixed stash content',
  ],
  nonGoals: [
    'PostgreSQL migration',
    'TypeScript strict-mode rollout',
    'frontend directory restructuring',
    'frontend state-management replacement',
    'OpenAPI or Swagger implementation',
    'frontend unit-test foundation',
    'PWA or service-worker rollout',
    'Docker image optimization',
    'JSON field normalization',
    'backend layering or base runtime refactor',
    'CI workflow changes',
    'PR1 isolated runner behavior changes',
  ],
  groups: ['overview', 'sales', 'supply', 'production', 'governance'],
  viewports: Object.keys(VIEWPORTS),
  samplingMatrix: SAMPLING_MATRIX,
  scoring: {
    minScore: 85,
    routeRenderedWeight: 50,
    screenshotWeight: 20,
    browserHealthWeight: 25,
    metadataWeight: 5,
  },
  productReadinessCriteria,
  approvedSkillAndAgentSupport,
};

module.exports = routes;
module.exports.routes = routes;
module.exports.ROUTES = routes;
module.exports.commercialAuditConfig = commercialAuditConfig;
module.exports.productReadinessCriteria = productReadinessCriteria;
module.exports.approvedSkillAndAgentSupport = approvedSkillAndAgentSupport;
