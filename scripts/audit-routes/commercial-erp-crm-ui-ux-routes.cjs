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

const rawProductReadinessCriteria = [
  {
    id: 'DASH-01',
    dimension: 'executive-cockpit',
    weight: 8,
    benchmark: 'SAP Fiori analytical list page, ERPNext dashboards, Power BI CFO workspace',
    criterion: 'Owner dashboard first screen covers what changed, what needs action, revenue, margin/profit, collections, receivables, cash/balance, sales pipeline, inventory or fulfillment risk, production bottlenecks, customer concentration, and exception backlog.',
    evidence: ['dashboard screenshot', 'visible KPI inventory', 'missing KPI list'],
  },
  {
    id: 'DASH-02',
    dimension: 'executive-cockpit',
    weight: 6,
    benchmark: 'SAP Fiori global KPI tags/cards and analytical card drill-down',
    criterion: 'KPI cards show title, unit/currency, period, trend or YoY/MoM context, status meaning, freshness, and a drill-down path.',
    evidence: ['KPI card screenshot', 'period/unit text', 'drill-down URL or unavailable marker'],
  },
  {
    id: 'DASH-03',
    dimension: 'executive-cockpit',
    weight: 5,
    benchmark: 'Metabase dashboard filters and Superset dashboard filters',
    criterion: 'Dashboard filter scope is clear for date, company, customer, warehouse, owner, or role filters; local card filters cannot be mistaken for global filters.',
    evidence: ['filter UI screenshot', 'applied filter state', 'scope note'],
  },
  {
    id: 'DASH-04',
    dimension: 'executive-cockpit',
    weight: 4,
    benchmark: 'Enterprise BI state handling',
    criterion: 'Dashboard shows loading, empty, error, no-permission, and data freshness states without silently presenting fake zero values.',
    evidence: ['state screenshot or unavailable marker', 'error/freshness text'],
  },
  {
    id: 'METRIC-01',
    dimension: 'semantic-metrics',
    weight: 8,
    benchmark: 'Superset semantic metrics, Metabase models, ERP finance metric governance',
    criterion: 'Executive KPIs expose or document metric meaning, formula or source, period, owner, freshness, and source-record traceability instead of relying on ambiguous card labels.',
    evidence: ['metric definition note', 'source/drill-down path', 'freshness text or unavailable marker'],
  },
  {
    id: 'ROLE-01',
    dimension: 'role-aware-experience',
    weight: 6,
    benchmark: 'Salesforce dynamic dashboards, SuiteCRM role dashboards, ERP permission-aware workspaces',
    criterion: 'Dashboard and high-risk modules make role and permission scope clear for owner, sales, finance, warehouse, production, and admin users.',
    evidence: ['role/user context note', 'permission state screenshot or unavailable marker'],
  },
  {
    id: 'FLOW-01',
    dimension: 'analytical-flow',
    weight: 7,
    benchmark: 'SAP Fiori analytical list page, ERPNext dashboard/report/list separation, Metabase drill-through',
    criterion: 'KPI or chart insight can move to a report, filtered list, or source record without losing the business context that explained the risk.',
    evidence: ['KPI-to-list path', 'filtered route state', 'unavailable marker'],
  },
  {
    id: 'FILTER-01',
    dimension: 'smart-filter',
    weight: 7,
    benchmark: 'Odoo search filters, SAP Fiori filter bar',
    criterion: 'Lists support structured filters beyond keyword search, including field search, predefined filters, custom filters, grouping, and clear/apply controls.',
    evidence: ['filter panel screenshot', 'selected filter text', 'result count'],
  },
  {
    id: 'FILTER-02',
    dimension: 'smart-filter',
    weight: 6,
    benchmark: 'MUI X filter model, AG Grid column filters, TanStack Table filtering',
    criterion: 'Advanced filters are typed: date ranges, amount ranges, status multi-select, customer/SKU/warehouse/owner facets, empty/non-empty, archived/inactive states, and permission-safe facet values where relevant.',
    evidence: ['typed filter controls', 'before/after route state', 'permission-safe facet note'],
  },
  {
    id: 'FILTER-03',
    dimension: 'smart-filter',
    weight: 5,
    benchmark: 'Odoo favorites and SAP Fiori variant management',
    criterion: 'Applied filters are visible as removable chips or summary text and are ready for saved view/default view behavior.',
    evidence: ['chip/summary screenshot', 'clear-one and clear-all state'],
  },
  {
    id: 'FILTER-04',
    dimension: 'smart-filter',
    weight: 4,
    benchmark: 'Metabase dashboard parameters and shareable filter state',
    criterion: 'Critical query state is URL-safe or restorable after refresh so a filtered business view can be shared or revisited.',
    evidence: ['URL before/after', 'refresh state note'],
  },
  {
    id: 'MOBILE-01',
    dimension: 'mobile-operations',
    weight: 6,
    benchmark: 'React-admin mobile list pattern, PatternFly mobile toolbar guidance',
    criterion: 'Mobile lists use a business card or task-shaped layout with primary title, status, amount/date/owner metadata, and one or two primary actions.',
    evidence: ['375px or 390px screenshot', 'card/list layout note'],
  },
  {
    id: 'MOBILE-02',
    dimension: 'mobile-operations',
    weight: 5,
    benchmark: 'WCAG 2.2 target size minimum and mobile design norms',
    criterion: 'Touch targets, filter drawers, bottom actions, and sticky controls are reachable and do not overlap core content on small screens.',
    evidence: ['mobile screenshot', 'overlap/tap target note'],
  },
  {
    id: 'MOBILE-03',
    dimension: 'mobile-operations',
    weight: 4,
    benchmark: 'SAP Fiori responsive table and enterprise mobile list patterns',
    criterion: 'Mobile does not rely only on squeezed desktop tables or horizontal overflow for core operational records.',
    evidence: ['overflow screenshot', 'detail/expanded field path note'],
  },
  {
    id: 'MOBILE-04',
    dimension: 'mobile-operations',
    weight: 5,
    benchmark: 'Power BI mobile optimized reports, owner mobile dashboard patterns',
    criterion: 'Owner mobile view prioritizes the few KPIs and exceptions that can be reviewed in minutes, rather than mirroring the full desktop cockpit.',
    evidence: ['mobile owner summary screenshot', 'first-screen KPI note'],
  },
  {
    id: 'DARK-01',
    dimension: 'accessibility-theme',
    weight: 8,
    benchmark: 'WCAG 2.2 contrast minimum',
    criterion: 'Dark mode text meets 4.5:1 for normal text and 3:1 for large text; key non-text UI indicators meet 3:1.',
    evidence: ['theme screenshot', 'foreground/background pair note'],
  },
  {
    id: 'DARK-02',
    dimension: 'accessibility-theme',
    weight: 5,
    benchmark: 'WCAG and SAP Fiori accessibility guidance',
    criterion: 'Status meaning is not color-only; success, warning, danger, overdue, and exception states include text, icon, or shape cues.',
    evidence: ['status component screenshot', 'meaning text/icon note'],
  },
  {
    id: 'A11Y-01',
    dimension: 'accessibility-theme',
    weight: 5,
    benchmark: 'WCAG keyboard, focus, accessible name, and enterprise app accessibility guidance',
    criterion: 'High-value routes expose visible focus states, understandable button/control names, keyboard-reachable primary actions, and no motion-only or color-only meaning.',
    evidence: ['focus/control screenshot', 'keyboard or accessible-name note'],
  },
  {
    id: 'LANG-01',
    dimension: 'language-encoding',
    weight: 7,
    benchmark: 'Multilingual enterprise software text hygiene',
    criterion: 'Chinese, English, and Vietnamese UI text is readable and free of mojibake, truncated labels, mixed placeholder copy, or stale route titles that mislead operators.',
    evidence: ['language screenshot', 'matched text', 'mojibake finding or clean note'],
  },
  {
    id: 'TABLE-01',
    dimension: 'enterprise-table',
    weight: 7,
    benchmark: 'Carbon data table, AG Grid, MUI X, Material data tables',
    criterion: 'Enterprise tables support sorting, pagination or virtualization, column visibility, density, selection, batch action governance, and export boundaries.',
    evidence: ['toolbar/table screenshot', 'enabled/disabled action note'],
  },
  {
    id: 'TABLE-02',
    dimension: 'enterprise-table',
    weight: 5,
    benchmark: 'Ant Design alignment and Material data table guidance',
    criterion: 'Numeric, money, date, status, and long-text columns are formatted and aligned for fast scanning without broken layout.',
    evidence: ['table screenshot', 'format/alignment note'],
  },
  {
    id: 'TABLE-03',
    dimension: 'enterprise-table',
    weight: 6,
    benchmark: 'Appsmith table server-side mode, AG Grid server-side filtering, TanStack manual filtering',
    criterion: 'Large operational lists have a credible server-side or scalable path for pagination, sorting, filtering, stable row IDs, and refresh without misleading client-only behavior.',
    evidence: ['pagination/filter mode note', 'row identity note', 'scale limitation or server-side evidence'],
  },
  {
    id: 'IMPORT-01',
    dimension: 'import-ux',
    weight: 8,
    benchmark: 'Odoo import/export and ERPNext data import',
    criterion: 'Import flows provide template/sample guidance, field mapping, required-field hints, CSV/XLSX handling, and date/number/encoding notes.',
    evidence: ['import entry screenshot', 'template/mapping note'],
  },
  {
    id: 'IMPORT-02',
    dimension: 'import-ux',
    weight: 7,
    benchmark: 'Odoo and ERPNext data import validation',
    criterion: 'Uploads are previewed and validated before commit, with row/column errors, duplicate/update policy, and failed-row export evidence.',
    evidence: ['preview screenshot', 'error row/export note'],
  },
  {
    id: 'STATE-01',
    dimension: 'states-exceptions',
    weight: 6,
    benchmark: 'Enterprise loading, empty, error, forbidden, timeout, and freshness state patterns',
    criterion: 'Critical commercial routes show honest loading, empty, error, forbidden, timeout, and data-freshness states instead of fake zero values, stale success, NaN, or undefined text.',
    evidence: ['state screenshot or unavailable marker', 'freshness/error text'],
  },
  {
    id: 'REPORT-01',
    dimension: 'report-hygiene',
    weight: 5,
    benchmark: 'Evidence-first audit reporting and anti-false-green review',
    criterion: 'The audit report separates route-render health from product maturity, includes screenshot paths, scope guard evidence, missing criteria, and does not mark screenshot-only evidence as ready.',
    evidence: ['commercial report JSON', 'markdown report', 'scope guard evidence'],
  },
  {
    id: 'AI-01',
    dimension: 'ai-governance',
    weight: 8,
    benchmark: 'OpenAI agent runtime guardrails, ERP role isolation, CRM AI red-team evidence',
    criterion: 'AI assistant and AI settings expose a clear privacy boundary: local/rules mode by default, external AI opt-in, sensitive data blocked, and refusal states visible to operators.',
    evidence: ['AI settings screenshot', 'privacy gate state', 'refusal screenshot or script evidence'],
  },
  {
    id: 'AI-02',
    dimension: 'ai-governance',
    weight: 7,
    benchmark: 'Enterprise AI permission isolation and auditability',
    criterion: 'AI answers and actions respect role, customer pool, finance, supplier, formula, and audit boundaries; natural language must not bypass API/UI permissions.',
    evidence: ['role-based AI screenshot', 'ai-isolation red-team evidence', 'permission audit report'],
  },
  {
    id: 'AI-03',
    dimension: 'ai-assisted-operations',
    weight: 6,
    benchmark: 'Human-in-the-loop ERP import/OCR and assistant workflows',
    criterion: 'AI OCR, Smart Form Fill, table import, and assistant write suggestions stay in preview/draft mode until a user confirms, with duplicate/error/read-back guidance.',
    evidence: ['OCR/import preview screenshot', 'human confirmation note', 'failed-row/read-back marker'],
  },
  {
    id: 'AI-04',
    dimension: 'ai-runtime-evaluation',
    weight: 5,
    benchmark: 'Agent tracing/evaluation practices and ERP audit reporting',
    criterion: 'AI features have reproducible eval/red-team scripts, browser evidence for high-risk roles, and traceable reports before being called commercially safe.',
    evidence: ['ai-security regression', 'crm AI browser audit', 'permission AI audit'],
  },
  {
    id: 'AI-05',
    dimension: 'ai-command-bar-governance',
    weight: 5,
    benchmark: 'Planner/executor/verifier agent runtime patterns with ERP permission gates',
    criterion: 'Future AI command-bar work separates planner, executor, and verifier roles, starts with navigation/read-only query intents, and blocks hidden writes or permission bypass.',
    evidence: ['future-only governance matrix', 'allowed intent registry or unavailable marker', 'permission gate evidence or unavailable marker'],
  },
  {
    id: 'AI-06',
    dimension: 'ai-analytics-governance',
    weight: 5,
    benchmark: 'Governed AI analytics with canonical metrics, source links, confidence, and unavailable markers',
    criterion: 'Future AI analytics explains canonical metrics with source links, confidence/unavailable markers, and no fabricated KPI, customer, finance, formula, or inventory details.',
    evidence: ['future-only governance matrix', 'metric source contract or unavailable marker', 'anti-fabrication eval evidence or unavailable marker'],
  },
  {
    id: 'POLICY-01',
    dimension: 'offline-policy',
    weight: 4,
    benchmark: 'Service worker security guidance and ERP stale-data policy',
    criterion: 'PWA/offline behavior is either explicitly out of scope with a stale-data/security policy note, or reviewed with clear cache, auth, conflict, and freshness boundaries.',
    evidence: ['offline policy note', 'service worker unavailable marker'],
  },
];

const CRITERIA_APPLICABILITY = {
  'DASH-01': { moduleIds: ['dashboard', 'financeAnalytics'], viewports: Object.keys(VIEWPORTS) },
  'DASH-02': { moduleIds: ['dashboard', 'financeAnalytics'], viewports: Object.keys(VIEWPORTS) },
  'DASH-03': { moduleIds: ['dashboard', 'financeAnalytics'], viewports: ['desktop'] },
  'DASH-04': { moduleIds: ['dashboard', 'financeAnalytics'], viewports: Object.keys(VIEWPORTS) },
  'METRIC-01': { moduleIds: ['dashboard', 'financeAnalytics'], viewports: Object.keys(VIEWPORTS) },
  'ROLE-01': { moduleIds: ['dashboard', 'financeAnalytics', 'team', 'audit'], viewports: Object.keys(VIEWPORTS) },
  'FLOW-01': { moduleIds: ['dashboard', 'financeAnalytics'], viewports: Object.keys(VIEWPORTS) },
  'FILTER-01': { moduleGroups: ['sales', 'supply', 'production', 'governance', 'overview'], viewports: ['desktop'] },
  'FILTER-02': { moduleGroups: ['sales', 'supply', 'production', 'governance', 'overview'], viewports: ['desktop'] },
  'FILTER-03': { moduleGroups: ['sales', 'supply', 'production', 'governance', 'overview'], viewports: ['desktop'] },
  'FILTER-04': { moduleGroups: ['sales', 'supply', 'production', 'governance', 'overview'], viewports: ['desktop'] },
  'MOBILE-01': { moduleGroups: ['overview', 'sales', 'supply', 'production', 'governance'], viewports: ['mobile-390', 'mobile-375'] },
  'MOBILE-02': { moduleGroups: ['overview', 'sales', 'supply', 'production', 'governance'], viewports: ['mobile-390', 'mobile-375'] },
  'MOBILE-03': { moduleGroups: ['overview', 'sales', 'supply', 'production', 'governance'], viewports: ['mobile-390', 'mobile-375'] },
  'MOBILE-04': { moduleIds: ['dashboard', 'financeAnalytics'], viewports: ['mobile-390', 'mobile-375'] },
  'DARK-01': { moduleGroups: ['overview', 'sales', 'supply', 'production', 'governance'], themes: ['dark'] },
  'DARK-02': { moduleGroups: ['overview', 'sales', 'supply', 'production', 'governance'], themes: ['dark', 'light'] },
  'A11Y-01': { moduleGroups: ['overview', 'sales', 'supply', 'production', 'governance'], viewports: Object.keys(VIEWPORTS) },
  'LANG-01': { moduleGroups: ['overview', 'sales', 'supply', 'production', 'governance'], locales: ['zh', 'en', 'vi'] },
  'TABLE-01': { moduleGroups: ['sales', 'supply', 'production', 'governance', 'overview'], viewports: ['desktop'] },
  'TABLE-02': { moduleGroups: ['sales', 'supply', 'production', 'governance', 'overview'], viewports: ['desktop'] },
  'TABLE-03': { moduleGroups: ['sales', 'supply', 'production', 'governance', 'overview'], viewports: ['desktop'] },
  'IMPORT-01': { moduleIds: ['orders', 'crm', 'procurement'], viewports: ['desktop'] },
  'IMPORT-02': { moduleIds: ['orders', 'crm', 'procurement'], viewports: ['desktop'] },
  'STATE-01': { moduleGroups: ['overview', 'sales', 'supply', 'production', 'governance'], viewports: Object.keys(VIEWPORTS) },
  'REPORT-01': { reportLevel: true },
  'AI-01': { moduleIds: ['settings'], viewports: Object.keys(VIEWPORTS) },
  'AI-02': { moduleIds: ['settings', 'crm', 'team'], viewports: Object.keys(VIEWPORTS) },
  'AI-03': { moduleIds: ['settings', 'orders', 'contracts', 'shipping'], viewports: Object.keys(VIEWPORTS) },
  'AI-04': { moduleIds: ['settings'], reportLevel: true },
  'AI-05': { reportLevel: true },
  'AI-06': { reportLevel: true },
  'POLICY-01': { policyLevel: true },
};

const productReadinessCriteria = rawProductReadinessCriteria.map((criterion) => ({
  ...criterion,
  appliesTo: CRITERIA_APPLICABILITY[criterion.id] || { manualReview: true },
}));

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
