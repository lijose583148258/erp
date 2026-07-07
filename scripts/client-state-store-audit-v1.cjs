const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'client-state-store-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'client-state-store-audit-v1.md');

function read(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return '';
  return fs.readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function readJson(relativePath) {
  const text = read(relativePath);
  if (!text) return {};
  return JSON.parse(text);
}

function hasDependency(pkg, name) {
  return Boolean(
    (pkg.dependencies && Object.prototype.hasOwnProperty.call(pkg.dependencies, name)) ||
    (pkg.devDependencies && Object.prototype.hasOwnProperty.call(pkg.devDependencies, name)) ||
    (pkg.optionalDependencies && Object.prototype.hasOwnProperty.call(pkg.optionalDependencies, name))
  );
}

function check(id, passed, evidence) {
  return { id, passed: Boolean(passed), evidence };
}

function renderMarkdown(report) {
  return [
    '# Client State Store Audit v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    '',
    '| check | status | evidence |',
    '|---|---|---|',
    ...report.checks.map((item) => `| ${item.id} | ${item.passed ? 'pass' : 'fail'} | ${String(item.evidence).replace(/\|/g, '\\|')} |`),
    '',
  ].join('\n');
}

function main() {
  const pkg = readJson('package.json');
  const storeText = read('stores/dashboardUiStore.ts');
  const dashboardText = read('pages/Dashboard.tsx');
  const strictPilotText = read('tsconfig.strict.pilot.json');

  const checks = [
    check('zustand-dependency', hasDependency(pkg, 'zustand'), `zustand dependency=${hasDependency(pkg, 'zustand')}`),
    check('dashboard-store-file', Boolean(storeText), 'stores/dashboardUiStore.ts exists'),
    check(
      'dashboard-store-uses-zustand',
      /from\s+['"]zustand['"]/.test(storeText) && /create<DashboardUiState>/.test(storeText),
      'store imports zustand create and declares DashboardUiState',
    ),
    check(
      'dashboard-store-actions',
      /applyOverviewSnapshot/.test(storeText) &&
        /setChartDataFromTrends/.test(storeText) &&
        /setChartBox/.test(storeText) &&
        /resetDashboardUi/.test(storeText),
      'store exposes dashboard snapshot, chart, layout, and reset actions',
    ),
    check(
      'dashboard-page-adopts-store',
      /useDashboardUiStore/.test(dashboardText) && /from\s+['"]\.\.\/stores\/dashboardUiStore['"]/.test(dashboardText),
      'pages/Dashboard.tsx imports and uses useDashboardUiStore',
    ),
    check(
      'dashboard-page-no-local-state-for-store-slice',
      !/useState\s*\(/.test(dashboardText) &&
        !/\b(?:setStats|setTasks|setInventoryAlerts|setSystemStatus|setChartData)\s*\(/.test(dashboardText),
      'Dashboard no longer keeps migrated dashboard UI slices in local useState',
    ),
    check(
      'strict-pilot-covers-store',
      /stores\/dashboardUiStore\.ts/.test(strictPilotText) && /pages\/Dashboard\.tsx/.test(strictPilotText),
      'tsconfig.strict.pilot.json includes store and dashboard page',
    ),
  ];

  const failed = checks.filter((item) => !item.passed);
  const report = {
    schemaVersion: 1,
    auditId: 'client-state-store-audit-v1',
    generatedAt: new Date().toISOString(),
    status: failed.length ? 'fail' : 'pass',
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

  console.log(`Client state store audit status=${report.status}`);
  console.log(`Report: ${JSON_REPORT}`);
  if (failed.length) {
    console.error(`Failed checks: ${failed.map((item) => item.id).join(', ')}`);
    process.exitCode = 1;
  }
}

main();
