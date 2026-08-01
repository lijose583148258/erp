const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findMojibake } = require('./lib/audit-utils.cjs');
const {
  FALLBACK_ROUTES,
  VIEWPORTS,
  normalizeRoute,
  parseConfig,
} = require('./lib/browser-ui-ux-audit-config.cjs');
const {
  addFinding,
  createRun,
  pruneAuditRuns,
  renderMarkdown,
  safeName,
} = require('./lib/browser-ui-ux-audit-report.cjs');

assert.equal(normalizeRoute('/#orders'), '#orders');
assert.equal(normalizeRoute('/production'), '#/production');
assert.equal(normalizeRoute('#/crm'), '#crm');
assert.equal(safeName('#financeAnalytics/details'), 'financeAnalytics_details');

const config = parseConfig({
  APP_URL: 'https://erp.example.test/',
  UI_UX_AUDIT_ROUTES: '/#orders, production, #/crm',
  UI_UX_AUDIT_MAX_ROUTES: '5',
  UI_UX_AUDIT_FAIL_ON_WARNINGS: 'true',
  UI_UX_AUDIT_IGNORE_HTTP_PATTERN: 'health|metrics',
  UI_UX_AUDIT_COLOR_SCHEME: 'dark',
  UI_UX_AUDIT_KEEP_RUNS: '3',
});
assert.deepEqual(config.forcedRoutes, ['#orders', '#production', '#crm']);
assert.equal(config.maxRoutes, 5);
assert.equal(config.failOnWarnings, true);
assert.equal(config.failOnConsoleErrors, true);
assert.equal(config.ignoreHttpPattern.test('/health'), true);
assert.equal(config.colorScheme, 'dark');
assert.equal(config.keepRuns, 3);
assert.throws(() => parseConfig({ UI_UX_AUDIT_MAX_ROUTES: '0' }), /integer >= 1/);
assert.throws(() => parseConfig({ UI_UX_AUDIT_COLOR_SCHEME: 'sepia' }), /must be one of/);
assert.throws(() => parseConfig({ UI_UX_AUDIT_KEEP_RUNS: '0' }), /integer >= 1/);
assert.throws(() => parseConfig({ UI_UX_AUDIT_IGNORE_HTTP_PATTERN: '[' }), /not a valid regex/);

const run = createRun(config, { fallbackRoutes: FALLBACK_ROUTES, viewports: VIEWPORTS });
assert.equal(run.report.appUrl, 'https://erp.example.test/');
assert.equal(run.report.viewports.length, 8);
assert.equal(run.report.fallbackRoutes.length, 20);
const retentionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ailao-ui-audit-retention-'));
for (const name of ['20260801000000000-1-aaaaaa', '20260801000000001-1-bbbbbb', 'unrelated-folder']) {
  fs.mkdirSync(path.join(retentionRoot, name));
}
fs.utimesSync(path.join(retentionRoot, '20260801000000000-1-aaaaaa'), new Date(1), new Date(1));
fs.utimesSync(path.join(retentionRoot, '20260801000000001-1-bbbbbb'), new Date(2), new Date(2));
assert.deepEqual(pruneAuditRuns(retentionRoot, 1), ['20260801000000000-1-aaaaaa']);
assert.equal(fs.existsSync(path.join(retentionRoot, '20260801000000001-1-bbbbbb')), true);
assert.equal(fs.existsSync(path.join(retentionRoot, 'unrelated-folder')), true);
fs.rmSync(retentionRoot, { recursive: true, force: true });
addFinding(run.report, { severity: 'error', code: 'CONTRACT_ERROR', route: '#orders', viewport: 'mobile-sm' });
const markdown = renderMarkdown(run.report, 'failed');
assert.match(markdown, /CONTRACT_ERROR/);
assert.match(markdown, /#orders/);

assert.equal(findMojibake('ÀÉ 化工 — Đăng nhập'), null, 'legitimate multilingual text must not be treated as mojibake');
assert.deepEqual(findMojibake('bad\uFFFDtext'), { code: 'replacement-character', sample: '\uFFFD' });
assert.equal(findMojibake('label="\u93cd\u56e7\u566f"').code, 'known-encoding-sequence');
assert.equal(findMojibake('private \uE6E7').code, 'private-use-character');

const productionBomSource = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'production', 'ProductionBomSection.tsx'), 'utf8');
const materialLookupSource = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'production', 'MaterialLookupField.tsx'), 'utf8');
const completionModalSource = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'production', 'CompleteWorkOrderModal.tsx'), 'utf8');
const qualityInspectionSource = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'production', 'ProductionQualityInspectionPanel.tsx'), 'utf8');
const productionWorkspaceSource = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'ProductionWorkspaceV2.tsx'), 'utf8');
const uiAuditSource = fs.readFileSync(path.resolve(__dirname, 'browser-ui-ux-audit-v2.cjs'), 'utf8');
const financeWorkspaceSource = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'FinanceAnalyticsWorkspaceV2.tsx'), 'utf8');
const financeLedgerSource = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'finance', 'FinanceLedgerPanel.tsx'), 'utf8');
const financeCashflowSource = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'finance', 'FinanceCashflowPanel.tsx'), 'utf8');
const adjustmentRecordSource = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'adjustment', 'AdjustmentRecordTable.tsx'), 'utf8');
const dealerAnalyticsSource = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'DealerAnalytics.tsx'), 'utf8');
const pageShellSource = fs.readFileSync(path.resolve(__dirname, '..', 'components', 'ui', 'PageShell.tsx'), 'utf8');
const documentGuideSource = fs.readFileSync(path.resolve(__dirname, '..', 'components', 'ui', 'DocumentInputGuide.tsx'), 'utf8');
const taskNavigatorSource = fs.readFileSync(path.resolve(__dirname, '..', 'components', 'ui', 'WorkspaceTaskNavigator.tsx'), 'utf8');
const dataTableSource = fs.readFileSync(path.resolve(__dirname, '..', 'components', 'DataTable.tsx'), 'utf8');
const enterpriseGridSource = fs.readFileSync(path.resolve(__dirname, '..', 'components', 'ui', 'EnterpriseDataGrid.tsx'), 'utf8');
const columnVisibilitySource = fs.readFileSync(path.resolve(__dirname, '..', 'components', 'ui', 'ColumnVisibilityMenu.tsx'), 'utf8');
const productionAuditHelpersSource = fs.readFileSync(path.resolve(__dirname, 'lib', 'production-browser-audit-helpers.cjs'), 'utf8');
const crmCreateModalSource = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'crm', 'CRMCreateModal.tsx'), 'utf8');
const crmFormCardsSource = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'crm', 'CRMCustomerFormCards.tsx'), 'utf8');
const crmCreatePreviewSource = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'crm', 'CRMCreatePreviewPanel.tsx'), 'utf8');
const salesLineGridSource = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'sales-orders', 'SalesOrderLineGrid.tsx'), 'utf8');
const productionBomLineGridSource = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'production', 'ProductionBomLineGrid.tsx'), 'utf8');
const productionBomMobileRowsSource = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'production', 'ProductionBomMobileRows.tsx'), 'utf8');
assert.match(productionBomSource, /relative z-10[\s\S]*md:sticky md:bottom-4/, 'mobile BOM save panel must remain in document flow and only become sticky from desktop width');
assert.match(productionBomSource, /motion-reduce:transition-none/, 'BOM primary action must respect reduced-motion preference');
assert.match(productionBomSource, /data-mobile-card-list/, 'saved BOM versions need task-oriented mobile cards');
assert.match(productionBomSource, /hidden overflow-x-auto no-scrollbar md:block/, 'saved BOM table must stay tablet/desktop only');
assert.match(materialLookupSource, /role="combobox"/);
assert.match(materialLookupSource, /aria-activedescendant/);
assert.match(materialLookupSource, /event\.key === 'ArrowDown'/);
assert.match(materialLookupSource, /event\.key === 'ArrowUp'/);
assert.match(materialLookupSource, /event\.key === 'Enter'/);
assert.match(materialLookupSource, /role="option"/);
assert.match(materialLookupSource, /aria-selected=/);
assert.match(completionModalSource, /role="dialog"/);
assert.match(completionModalSource, /aria-modal="true"/);
assert.match(completionModalSource, /hidden w-full text-left max-w-full sm:table/, 'completion stock table must not force horizontal mobile scrolling');
assert.match(completionModalSource, /production-complete-mobile-picks/, 'completion picks need a task-oriented mobile layout');
assert.match(completionModalSource, /flex flex-col-reverse[\s\S]*sm:flex-row/, 'mobile completion actions must remain reachable and preserve primary-action order');
assert.match(completionModalSource, /fixed inset-0 z-\[100\]/, 'completion modal must stay above the global mobile navigation');
assert.doesNotMatch(completionModalSource, /production-complete-confirm[\s\S]{0,600}hover:scale/, 'completion action must not use decorative scaling');
assert.match(qualityInspectionSource, /aria-label="质检流程进度"/, 'quality inspection needs an explicit workflow hierarchy');
assert.match(qualityInspectionSource, /grid grid-cols-3/, 'quality workflow steps must remain visible without a hidden dropdown');
assert.match(qualityInspectionSource, /isOwnInspection[\s\S]*职责分离/, 'self-review must be explained before the user reaches a rejected action');
assert.match(qualityInspectionSource, /motion-reduce:transition-none/, 'quality workflow feedback must respect reduced-motion preference');
assert.doesNotMatch(productionWorkspaceSource, /duration-1000|slide-in-from-bottom/, 'frequent ERP workspaces must not delay interaction with decorative one-second entrance motion');
assert.doesNotMatch(uiAuditSource, /page\.addStyleTag/, 'reduced-motion emulation must not inject CSP-blocked style elements');
assert.match(uiAuditSource, /MOBILE_COMPLEX_TABLE_WITHOUT_CARD_ALTERNATIVE/, 'generic audit must detect complex mobile tables without task cards');
assert.match(uiAuditSource, /:visible:not\(\[role="combobox"\]\)/, 'safe search audit must not mutate hidden or business combobox fields');
assert.match(uiAuditSource, /PAGE_SHELL_H1_COUNT_INVALID/, 'generic audit must reject ambiguous governed page-title hierarchy');
assert.match(uiAuditSource, /ENTERPRISE_TABLE_NAME_MISSING/, 'generic audit must reject unnamed governed business tables');
assert.match(uiAuditSource, /REDUCED_MOTION_NOT_HONORED/, 'generic audit must measure reduced-motion behavior instead of trusting source classes');
assert.match(uiAuditSource, /GOVERNED_TAB_ARROW_KEY_FAILED/, 'generic audit must operate governed task tabs with a real arrow key');
assert.match(uiAuditSource, /GRID_COLUMN_MENU_CLIPPED/, 'generic audit must open and measure governed table column menus');
assert.match(uiAuditSource, /COMPLEX_ROUTE_GUIDANCE_MISSING/, 'high-risk routes must not silently lose task or input guidance');
assert.match(uiAuditSource, /COMPLEX_DIALOG_SAVE_IMPACT_MISSING/, 'complex dialogs must explain their save boundary');
assert.match(uiAuditSource, /COMPLEX_FIELD_PLACEHOLDER_ONLY/, 'placeholder-only complex inputs must be detected');
assert.match(uiAuditSource, /auditComplexEntryDialog/, 'generic UI audit must open a real complex entry dialog');
assert.match(uiAuditSource, /complex-entry-advanced/, 'generic UI audit must inspect low-frequency advanced fields separately');
assert.match(pageShellSource, /data-page-shell/);
assert.match(pageShellSource, /role="tab"/);
assert.match(pageShellSource, /event\.key === 'ArrowRight'/);
assert.match(pageShellSource, /motion-reduce:transition-none/);
assert.doesNotMatch(pageShellSource, /transition-all|uppercase italic/, 'page hierarchy must not use broad motion or decorative all-uppercase italic titles');
assert.match(documentGuideSource, /data-document-input-guide/);
assert.match(documentGuideSource, /<ol aria-label="填写步骤"/);
assert.match(taskNavigatorSource, /data-workspace-task-navigator/);
assert.match(taskNavigatorSource, /role="tablist"/);
assert.match(taskNavigatorSource, /aria-selected=/);
assert.match(taskNavigatorSource, /event\.key === 'ArrowDown'/);
assert.doesNotMatch(taskNavigatorSource, /transition-all|hover:-translate/, 'frequent task navigation must not move or animate every property');
for (const [name, source] of [['legacy data table', dataTableSource], ['enterprise grid', enterpriseGridSource]]) {
  assert.match(source, /data-enterprise-grid/, `${name} must opt into governed table self-checks`);
  assert.match(source, /data-grid-state=/, `${name} must distinguish loading, empty, and ready states`);
  assert.match(source, /aria-(?:label|labelledby)=/, `${name} must expose its business object name`);
}
assert.doesNotMatch(dataTableSource, /shadow-sm overflow-hidden/, 'legacy table column menu must not be clipped by the table surface');
assert.match(dataTableSource, /ColumnVisibilityMenu/, 'legacy table must use the shared viewport-aware column menu');
assert.match(enterpriseGridSource, /ColumnVisibilityMenu/, 'enterprise grid must use the shared viewport-aware column menu');
assert.match(columnVisibilitySource, /createPortal\(menu, document\.body\)/, 'column menu must escape scroll-container clipping through a portal');
assert.match(columnVisibilitySource, /position: position|style=\{\{ left: position\.left, top: position\.top \}\}/, 'column menu must use measured viewport coordinates');
assert.match(columnVisibilitySource, /availableBelow[\s\S]*availableAbove[\s\S]*openAbove/, 'column menu must flip above when the lower viewport has insufficient room');
assert.match(productionAuditHelpersSource, /\[data-testid="\$\{testId\}"\]:visible/, 'production desk audit must target the visible task tab');
assert.match(productionAuditHelpersSource, /desk\.click\(\{ timeout: Math\.min\(timeout, 5000\) \}\)/, 'production desk click must fail before the enclosing audit timebox');
assert.match(productionAuditHelpersSource, /aria-selected[\s\S]*=== 'true'/, 'production desk audit must verify the task tab became active');
assert.match(crmCreateModalSource, /data-form-section="company-master"/, 'CRM onboarding must expose named business sections');
assert.match(crmCreateModalSource, /aria-expanded=\{showAdvanced\}/, 'CRM advanced fields must expose their disclosure state');
assert.match(crmCreateModalSource, /第 1 步[\s\S]*第 2 步[\s\S]*第 3 步[\s\S]*第 4 步/, 'CRM onboarding must follow a visible human workflow');
assert.doesNotMatch(crmCreateModalSource, /className="[^"]*animate-in(?![^"]*motion-safe:)/, 'CRM modal motion must be opt-in for users who allow motion');
assert.match(crmCreatePreviewSource, /data-save-impact/, 'CRM onboarding must explain what saving creates');
assert.match(crmCreatePreviewSource, /不会自动创建订单、授信审批或发货任务/, 'CRM onboarding must explain downstream non-effects');
assert.match(crmFormCardsSource, /地址用途[\s\S]*站点标签[\s\S]*国家 \/ 地区代码/, 'CRM address fields need visible relationship labels');
assert.match(crmFormCardsSource, /联系人姓名[\s\S]*角色 \/ 职务[\s\S]*电话[\s\S]*邮箱[\s\S]*常用语言/, 'CRM contact fields need visible relationship labels');
assert.match(salesLineGridSource, /data-mobile-card-list/, 'sales-order lines need a mobile task-card representation');
assert.match(salesLineGridSource, /aria-label="销售订单商品明细表"/, 'sales-order line table needs a stable business name');
assert.match(productionBomMobileRowsSource, /data-mobile-card-list/, 'BOM line editing needs a mobile task-card representation');
assert.match(productionBomLineGridSource, /aria-label="生产配方原料明细表"/, 'BOM line table needs a stable business name');
for (const [name, source] of [['workspace', financeWorkspaceSource], ['ledger', financeLedgerSource], ['cashflow', financeCashflowSource]]) {
  assert.match(source, /data-mobile-card-list/, `finance ${name} needs a visible mobile task-card alternative`);
  assert.match(source, /hidden overflow-x-auto[^"\n]*md:block/, `finance ${name} tables must stay desktop/tablet only`);
  assert.doesNotMatch(source, /transition-all|duration-500|slide-in-from-bottom/, `finance ${name} must not retain broad or decorative motion`);
}
for (const [name, source] of [['adjustment', adjustmentRecordSource], ['dealer analytics', dealerAnalyticsSource]]) {
  assert.match(source, /data-mobile-card-list/, `${name} needs a visible mobile task-card alternative`);
  assert.match(source, /hidden overflow-x-auto[^"\n]*md:block/, `${name} table must stay desktop/tablet only`);
}
assert.match(adjustmentRecordSource, /min-h-11 w-full/, 'mobile adjustment detail action needs a reliable touch target');
assert.match(dealerAnalyticsSource, /MobileRecordState/, 'dealer analytics must explain loading and empty mobile states');

console.log('Browser UI/UX Audit Contract: PASS');
console.log('- config parsing, route normalization, report rendering, and multilingual mojibake boundaries verified');
console.log('- production, finance, adjustment, and dealer task-card hierarchy plus reduced motion and keyboard semantics verified');
