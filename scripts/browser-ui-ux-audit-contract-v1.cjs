const assert = require('node:assert/strict');
const fs = require('node:fs');
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
});
assert.deepEqual(config.forcedRoutes, ['#orders', '#production', '#crm']);
assert.equal(config.maxRoutes, 5);
assert.equal(config.failOnWarnings, true);
assert.equal(config.failOnConsoleErrors, true);
assert.equal(config.ignoreHttpPattern.test('/health'), true);
assert.equal(config.colorScheme, 'dark');
assert.throws(() => parseConfig({ UI_UX_AUDIT_MAX_ROUTES: '0' }), /integer >= 1/);
assert.throws(() => parseConfig({ UI_UX_AUDIT_COLOR_SCHEME: 'sepia' }), /must be one of/);
assert.throws(() => parseConfig({ UI_UX_AUDIT_IGNORE_HTTP_PATTERN: '[' }), /not a valid regex/);

const run = createRun(config, { fallbackRoutes: FALLBACK_ROUTES, viewports: VIEWPORTS });
assert.equal(run.report.appUrl, 'https://erp.example.test/');
assert.equal(run.report.viewports.length, 8);
assert.equal(run.report.fallbackRoutes.length, 20);
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
assert.match(productionBomSource, /relative z-10[\s\S]*md:sticky md:bottom-4/, 'mobile BOM save panel must remain in document flow and only become sticky from desktop width');
assert.match(productionBomSource, /motion-reduce:transition-none/, 'BOM primary action must respect reduced-motion preference');
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

console.log('Browser UI/UX Audit Contract: PASS');
console.log('- config parsing, route normalization, report rendering, and multilingual mojibake boundaries verified');
console.log('- BOM/quality workflow hierarchy, completion task cards, reduced motion, and keyboard material lookup semantics verified');
