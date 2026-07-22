const assert = require('node:assert/strict');
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

console.log('Browser UI/UX Audit Contract: PASS');
console.log('- config parsing, route normalization, report rendering, and multilingual mojibake boundaries verified');
