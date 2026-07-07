const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'dashboard-shared-contract-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'dashboard-shared-contract-audit-v1.md');

const CONTRACT_PATH = path.join(ROOT, 'shared', 'contracts', 'dashboard.ts');
const FRONTEND_SERVICE_PATH = path.join(ROOT, 'services', 'dashboard.service.ts');
const BACKEND_ROUTE_PATH = path.join(ROOT, 'backend', 'src', 'routes', 'dashboard.routes.ts');
const BACKEND_GENERATED_CONTRACT_PATH = path.join(ROOT, 'backend', 'src', 'types', 'generated', 'dashboard.contract.ts');

const REQUIRED_ARRAYS = [
  'dashboardOverviewSectionKeys',
  'dashboardOverviewMetricKeys',
  'dashboardPeriodSummaryKeys',
  'dashboardRecentOrderKeys',
  'dashboardInventoryAlertKeys',
  'dashboardSystemStatusKeys',
  'dashboardTrendKeys',
];

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function read(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function lineOf(text, needle) {
  const lines = String(text || '').split('\n');
  const index = lines.findIndex((line) => line.includes(needle));
  return index >= 0 ? index + 1 : null;
}

function extractConstArray(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`export\\s+const\\s+${escaped}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s+as\\s+const`));
  if (!match) return [];
  return Array.from(match[1].matchAll(/['"]([^'"]+)['"]/g)).map((item) => item[1]);
}

function tokenPresent(text, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b\\s*[:},]`).test(text);
}

function missingTokens(text, tokens) {
  return tokens.filter((token) => !tokenPresent(text, token));
}

function stripGeneratedHeader(text) {
  return String(text || '')
    .replace(/^\/\*[\s\S]*?Generated from shared\/contracts\/dashboard\.ts[\s\S]*?\*\/\n*/, '')
    .trim();
}

function check(id, passed, evidence) {
  return { id, passed: Boolean(passed), evidence };
}

function renderMarkdown(report) {
  return [
    '# Dashboard Shared Contract Audit v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    `- adoption: ${report.adoptionLevel}`,
    `- contract: ${report.paths.contract}`,
    `- backend generated contract: ${report.paths.backendGeneratedContract}`,
    `- frontend service: ${report.paths.frontendService}`,
    `- backend route: ${report.paths.backendRoute}`,
    '',
    '| check | status | evidence |',
    '|---|---|---|',
    ...report.checks.map((item) => `| ${item.id} | ${item.passed ? 'pass' : 'fail'} | ${String(item.evidence).replace(/\|/g, '\\|')} |`),
    '',
  ].join('\n');
}

function main() {
  const contractText = read(CONTRACT_PATH);
  const backendGeneratedContractText = read(BACKEND_GENERATED_CONTRACT_PATH);
  const frontendText = read(FRONTEND_SERVICE_PATH);
  const backendText = read(BACKEND_ROUTE_PATH);
  const arrays = Object.fromEntries(REQUIRED_ARRAYS.map((name) => [name, extractConstArray(contractText, name)]));
  const generatedContractMatchesShared = Boolean(contractText) &&
    stripGeneratedHeader(backendGeneratedContractText) === contractText.trim();

  const overviewSectionMissing = missingTokens(backendText, arrays.dashboardOverviewSectionKeys || []);
  const overviewMetricMissing = missingTokens(backendText, arrays.dashboardOverviewMetricKeys || []);
  const periodMissing = missingTokens(backendText, arrays.dashboardPeriodSummaryKeys || []);
  const recentOrderMissing = missingTokens(backendText, arrays.dashboardRecentOrderKeys || []);
  const inventoryAlertMissing = missingTokens(backendText, arrays.dashboardInventoryAlertKeys || []);
  const systemStatusMissing = missingTokens(backendText, arrays.dashboardSystemStatusKeys || []);
  const trendMissing = missingTokens(backendText, arrays.dashboardTrendKeys || []);

  const frontendImportsSharedContract = /from\s+['"]\.\.\/shared\/contracts\/dashboard['"]/.test(frontendText);
  const frontendHasLocalDashboardInterfaces = /export\s+interface\s+Dashboard(?:Overview|Trend)\b/.test(frontendText);
  const backendImportsSharedContract = /from\s+['"][^'"]*shared\/contracts\/dashboard['"]/.test(backendText);
  const backendImportsGeneratedContract = /from\s+['"][^'"]*types\/generated\/dashboard\.contract['"]/.test(backendText);
  const backendHasCompileTimeContract = backendImportsSharedContract ||
    (backendImportsGeneratedContract && generatedContractMatchesShared);

  const checks = [
    check('contract-file', Boolean(contractText), `shared/contracts/dashboard.ts exists=${Boolean(contractText)}`),
    check(
      'contract-types',
      /export\s+interface\s+DashboardOverview\b/.test(contractText) && /export\s+interface\s+DashboardTrend\b/.test(contractText),
      `DashboardOverview line=${lineOf(contractText, 'interface DashboardOverview') || 'missing'}; DashboardTrend line=${lineOf(contractText, 'interface DashboardTrend') || 'missing'}`,
    ),
    ...REQUIRED_ARRAYS.map((name) => check(`contract-array:${name}`, arrays[name].length > 0, `${name} keys=${arrays[name].join(',') || 'none'}`)),
    check(
      'frontend-imports-shared-contract',
      frontendImportsSharedContract,
      `services/dashboard.service.ts shared import=${frontendImportsSharedContract}`,
    ),
    check(
      'frontend-no-local-dashboard-interfaces',
      !frontendHasLocalDashboardInterfaces,
      `local DashboardOverview/DashboardTrend interfaces=${frontendHasLocalDashboardInterfaces}`,
    ),
    check(
      'frontend-return-types',
      /Promise<DashboardOverview>/.test(frontendText) && /Promise<DashboardTrend\[]>/.test(frontendText),
      'dashboard service promises use shared DashboardOverview and DashboardTrend',
    ),
    check('backend-route-file', Boolean(backendText), `backend route exists=${Boolean(backendText)}`),
    check(
      'backend-generated-contract-file',
      Boolean(backendGeneratedContractText),
      `backend generated contract exists=${Boolean(backendGeneratedContractText)}`,
    ),
    check(
      'backend-generated-contract-matches-shared',
      generatedContractMatchesShared,
      `generated mirror matches shared contract=${generatedContractMatchesShared}`,
    ),
    check(
      'backend-imports-compile-time-contract',
      backendHasCompileTimeContract,
      `shared import=${backendImportsSharedContract}; generated import=${backendImportsGeneratedContract}`,
    ),
    check(
      'backend-response-types',
      /DashboardOverview/.test(backendText) && /DashboardTrend\[]/.test(backendText),
      'backend route response payload is bound to DashboardOverview and DashboardTrend[]',
    ),
    check(
      'backend-overview-section-coverage',
      overviewSectionMissing.length === 0,
      `missing=${overviewSectionMissing.join(',') || 'none'}`,
    ),
    check(
      'backend-overview-metric-coverage',
      overviewMetricMissing.length === 0,
      `missing=${overviewMetricMissing.join(',') || 'none'}`,
    ),
    check(
      'backend-period-summary-coverage',
      periodMissing.length === 0,
      `missing=${periodMissing.join(',') || 'none'}`,
    ),
    check(
      'backend-recent-order-coverage',
      recentOrderMissing.length === 0,
      `missing=${recentOrderMissing.join(',') || 'none'}`,
    ),
    check(
      'backend-inventory-alert-coverage',
      inventoryAlertMissing.length === 0,
      `missing=${inventoryAlertMissing.join(',') || 'none'}`,
    ),
    check(
      'backend-system-status-coverage',
      systemStatusMissing.length === 0,
      `missing=${systemStatusMissing.join(',') || 'none'}`,
    ),
    check(
      'backend-trend-coverage',
      trendMissing.length === 0,
      `missing=${trendMissing.join(',') || 'none'}`,
    ),
  ];

  const failed = checks.filter((item) => !item.passed);
  const adoptionLevel = backendHasCompileTimeContract && frontendImportsSharedContract
    ? backendImportsSharedContract
      ? 'frontend-and-backend-compile-time'
      : 'frontend-and-backend-compile-time-generated-contract'
    : frontendImportsSharedContract && failed.length === 0
      ? 'frontend-compile-time-backend-source-audited'
      : 'incomplete';
  const report = {
    schemaVersion: 1,
    auditId: 'dashboard-shared-contract-audit-v1',
    generatedAt: new Date().toISOString(),
    status: failed.length ? 'fail' : 'pass',
    adoptionLevel,
    paths: {
      contract: toPosix(path.relative(ROOT, CONTRACT_PATH)),
      backendGeneratedContract: toPosix(path.relative(ROOT, BACKEND_GENERATED_CONTRACT_PATH)),
      frontendService: toPosix(path.relative(ROOT, FRONTEND_SERVICE_PATH)),
      backendRoute: toPosix(path.relative(ROOT, BACKEND_ROUTE_PATH)),
    },
    facts: {
      frontendImportsSharedContract,
      backendImportsSharedContract,
      backendImportsGeneratedContract,
      generatedContractMatchesShared,
      backendHasCompileTimeContract,
    },
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
    checks,
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(MD_REPORT, renderMarkdown(report), 'utf8');

  console.log(`Dashboard shared contract audit status=${report.status}`);
  console.log(`Adoption: ${report.adoptionLevel}`);
  console.log(`Report: ${JSON_REPORT}`);
  if (failed.length) {
    console.error(`Failed checks: ${failed.map((item) => item.id).join(', ')}`);
    process.exitCode = 1;
  }
}

main();
