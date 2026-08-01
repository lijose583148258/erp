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
