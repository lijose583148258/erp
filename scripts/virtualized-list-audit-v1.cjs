const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'virtualized-list-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'virtualized-list-audit-v1.md');

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
    '# Virtualized List Audit v1',
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
  const gridText = read('components/ui/EnterpriseDataGrid.tsx');
  const readinessText = read('scripts/engineering-production-readiness-audit-v1.cjs');
  const packageLockText = read('package-lock.json');

  const checks = [
    check(
      'react-virtual-dependency',
      hasDependency(pkg, '@tanstack/react-virtual'),
      `@tanstack/react-virtual dependency=${hasDependency(pkg, '@tanstack/react-virtual')}`,
    ),
    check(
      'lockfile-records-react-virtual',
      /node_modules\/@tanstack\/react-virtual/.test(packageLockText),
      'package-lock.json records node_modules/@tanstack/react-virtual',
    ),
    check(
      'enterprise-grid-imports-virtualizer',
      /import\s+\{\s*useVirtualizer\s*\}\s+from\s+['"]@tanstack\/react-virtual['"]/.test(gridText),
      'EnterpriseDataGrid imports useVirtualizer from @tanstack/react-virtual',
    ),
    check(
      'enterprise-grid-exposes-controls',
      /virtualizeRows\?:\s*boolean/.test(gridText) &&
        /virtualizationThreshold\?:\s*number/.test(gridText) &&
        /virtualizeRows\s*=\s*true/.test(gridText) &&
        /virtualizationThreshold\s*=\s*30/.test(gridText),
      'EnterpriseDataGrid exposes virtualizeRows and virtualizationThreshold props with defaults',
    ),
    check(
      'enterprise-grid-scroll-ref',
      /tableScrollRef\s*=\s*useRef<HTMLDivElement>\(null\)/.test(gridText) &&
        /getScrollElement:\s*\(\)\s*=>\s*tableScrollRef\.current/.test(gridText),
      'virtualizer reads from the table scroll container ref',
    ),
    check(
      'enterprise-grid-server-paging-guard',
      /shouldVirtualizeRows\s*=\s*virtualizeRows\s*&&\s*!isServerPaged\s*&&\s*pageData\.length\s*>=\s*virtualizationThreshold/.test(gridText),
      'virtualization is explicitly disabled for server-paged tables',
    ),
    check(
      'enterprise-grid-uses-virtualizer',
      /useVirtualizer\(\{[\s\S]*count:\s*pageData\.length[\s\S]*estimateSize:\s*\(\)\s*=>\s*52[\s\S]*overscan:\s*8/.test(gridText),
      'EnterpriseDataGrid configures count, row estimate, and overscan',
    ),
    check(
      'enterprise-grid-renders-virtual-window',
      /virtualRows\.map/.test(gridText) &&
        /virtualPaddingTop/.test(gridText) &&
        /virtualPaddingBottom/.test(gridText) &&
        /data-virtualized/.test(gridText) &&
        /data-virtual-row-count/.test(gridText),
      'rendered table includes virtual window evidence and spacer rows',
    ),
    check(
      'readiness-audit-not-dependency-only',
      /hasVirtualizedLargeListBaseline/.test(readinessText) &&
        /hasVirtualizedListAuditScript/.test(readinessText) &&
        !/status:\s*rootDeps\.virtual\.length\s*\?\s*'present'\s*:\s*'gap'/.test(readinessText),
      'engineering readiness audit requires adoption evidence, not only dependency presence',
    ),
  ];

  const failed = checks.filter((item) => !item.passed);
  const report = {
    schemaVersion: 1,
    auditId: 'virtualized-list-audit-v1',
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

  console.log(`Virtualized list audit status=${report.status}`);
  console.log(`Report: ${JSON_REPORT}`);
  if (failed.length) {
    console.error(`Failed checks: ${failed.map((item) => item.id).join(', ')}`);
    process.exitCode = 1;
  }
}

main();
