const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'mobile-card-data-view-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'mobile-card-data-view-audit-v1.md');

function read(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return '';
  return fs.readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function check(id, passed, evidence) {
  return { id, passed: Boolean(passed), evidence };
}

function renderMarkdown(report) {
  return [
    '# Mobile Card Data View Audit v1',
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
  const enterpriseGrid = read('components/ui/EnterpriseDataGrid.tsx');
  const dataTable = read('components/DataTable.tsx');
  const uiIndex = read('components/ui/index.ts');
  const readiness = read('scripts/engineering-production-readiness-audit-v1.cjs');

  const enterpriseMobileProps =
    /mobileCard\?:\s*\(row:\s*T\)\s*=>\s*React\.ReactNode/.test(enterpriseGrid) &&
    /mobilePrimaryText\?:/.test(enterpriseGrid) &&
    /mobileSecondaryText\?:/.test(enterpriseGrid) &&
    /mobileStatus\?:/.test(enterpriseGrid) &&
    /mobileMeta\?:/.test(enterpriseGrid) &&
    /mobileActions\?:/.test(enterpriseGrid);
  const dataTableMobileProps =
    /mobileCard\?:\s*\(row:\s*T,\s*index:\s*number\)\s*=>\s*React\.ReactNode/.test(dataTable) &&
    /mobilePrimaryText\?:/.test(dataTable) &&
    /mobileSecondaryText\?:/.test(dataTable) &&
    /mobileStatus\?:/.test(dataTable) &&
    /mobileMeta\?:/.test(dataTable) &&
    /mobileActions\?:/.test(dataTable);

  const checks = [
    check(
      'enterprise-mobile-contract',
      /export\s+interface\s+MobileCardMetaItem/.test(enterpriseGrid) && enterpriseMobileProps,
      'EnterpriseDataGrid exports mobile meta type and accepts mobile card props',
    ),
    check(
      'enterprise-auto-card-renderer',
      /renderMobileCard/.test(enterpriseGrid) &&
        /getDefaultMobileMeta/.test(enterpriseGrid) &&
        /data-mobile-card="true"/.test(enterpriseGrid) &&
        /data-mobile-card-view="true"/.test(enterpriseGrid),
      'EnterpriseDataGrid has default mobile card renderer and DOM evidence markers',
    ),
    check(
      'enterprise-mobile-table-switch',
      /md:hidden/.test(enterpriseGrid) && /hidden\s+overflow-x-auto\s+md:block/.test(enterpriseGrid),
      'EnterpriseDataGrid hides desktop table on mobile and shows cards',
    ),
    check(
      'enterprise-interaction-parity',
      /-mobile-card/.test(enterpriseGrid) &&
        /onRowClick\?\.\(row\)/.test(enterpriseGrid) &&
        /role=\{onRowClick \? 'button' : undefined\}/.test(enterpriseGrid) &&
        /mobileActions/.test(enterpriseGrid),
      'Enterprise mobile cards preserve test id suffix, row click, keyboard role, and actions',
    ),
    check(
      'datatable-mobile-contract',
      /export\s+interface\s+DataTableMobileCardMetaItem/.test(dataTable) && dataTableMobileProps,
      'DataTable exports mobile meta type and accepts mobile card props',
    ),
    check(
      'datatable-auto-card-renderer',
      /renderMobileCard/.test(dataTable) &&
        /getDefaultMobileMeta/.test(dataTable) &&
        /data-mobile-card="true"/.test(dataTable) &&
        /data-mobile-card-view="true"/.test(dataTable),
      'DataTable has default mobile card renderer and DOM evidence markers',
    ),
    check(
      'datatable-mobile-table-switch',
      /md:hidden/.test(dataTable) && /hidden md:block/.test(dataTable),
      'DataTable hides desktop table on mobile and shows cards',
    ),
    check(
      'ui-index-exports-mobile-types',
      /MobileCardMetaItem/.test(uiIndex) && /MobileCardMetaTone/.test(uiIndex),
      'components/ui/index.ts exports EnterpriseDataGrid mobile card types',
    ),
    check(
      'readiness-audit-not-token-only',
      /hasMobileCardDataViewBaseline/.test(readiness) &&
        /hasMobileCardDataViewAuditScript/.test(readiness) &&
        !/status:\s*hasMobileCardView\s*\?\s*'present'\s*:\s*'gap'/.test(readiness),
      'engineering readiness audit requires component evidence, not only a CSS token',
    ),
  ];

  const failed = checks.filter((item) => !item.passed);
  const report = {
    schemaVersion: 1,
    auditId: 'mobile-card-data-view-audit-v1',
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

  console.log(`Mobile card data view audit status=${report.status}`);
  console.log(`Report: ${JSON_REPORT}`);
  if (failed.length) {
    console.error(`Failed checks: ${failed.map((item) => item.id).join(', ')}`);
    process.exitCode = 1;
  }
}

main();
