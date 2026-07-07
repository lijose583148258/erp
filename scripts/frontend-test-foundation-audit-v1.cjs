const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'frontend-test-foundation-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'frontend-test-foundation-audit-v1.md');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const WALK_EXCLUDED_DIRS = new Set(['.git', 'backend', 'dist', 'node_modules', 'output', 'utils/quarantine']);

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

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

function listFiles(startDir, predicate = () => true, bucket = []) {
  const fullStart = path.join(ROOT, startDir);
  if (!fs.existsSync(fullStart)) return bucket;
  const entries = fs.readdirSync(fullStart, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(fullStart, entry.name);
    const relativePath = toPosix(path.relative(ROOT, full));
    if (entry.isDirectory()) {
      if (WALK_EXCLUDED_DIRS.has(entry.name) || WALK_EXCLUDED_DIRS.has(relativePath)) continue;
      listFiles(relativePath, predicate, bucket);
      continue;
    }
    if (entry.isFile() && predicate(relativePath, full)) bucket.push(relativePath);
  }
  return bucket;
}

function check(id, passed, evidence) {
  return { id, passed: Boolean(passed), evidence };
}

function renderMarkdown(report) {
  return [
    '# Frontend Test Foundation Audit v1',
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
  const scripts = pkg.scripts || {};
  const vitestConfig = read('vitest.config.ts');
  const setupText = read('tests/setup.ts');
  const testFiles = listFiles('.', (file) => {
    if (!SOURCE_EXTENSIONS.has(path.extname(file))) return false;
    return /\.(test|spec)\.(tsx?|jsx?)$/.test(file);
  });
  const testingLibraryFiles = testFiles.filter((file) => /@testing-library\/react/.test(read(file)));

  const requiredDeps = [
    'vitest',
    '@testing-library/react',
    '@testing-library/jest-dom',
    '@testing-library/user-event',
    'jsdom',
  ];
  const missingDeps = requiredDeps.filter((name) => !hasDependency(pkg, name));

  const checks = [
    check('required-dependencies', missingDeps.length === 0, `missing=${missingDeps.join(',') || 'none'}`),
    check(
      'vitest-script',
      /\bvitest\s+run\b/.test(String(scripts['test:frontend:vitest'] || '')) &&
        /test:frontend:vitest/.test(String(scripts['test:frontend:unit'] || '')),
      `test:frontend:vitest=${scripts['test:frontend:vitest'] || 'missing'}; test:frontend:unit=${scripts['test:frontend:unit'] || 'missing'}`,
    ),
    check(
      'vitest-config',
      /environment:\s*['"]jsdom['"]/.test(vitestConfig) && /setupFiles:\s*\[\s*['"]\.\/tests\/setup\.ts['"]/.test(vitestConfig),
      'vitest.config.ts uses jsdom and tests/setup.ts',
    ),
    check(
      'testing-library-setup',
      /@testing-library\/jest-dom\/vitest/.test(setupText),
      'tests/setup.ts installs jest-dom matchers for Vitest',
    ),
    check(
      'testing-library-component-test',
      testingLibraryFiles.length > 0,
      `testing-library test files=${testingLibraryFiles.join(', ') || 'none'}`,
    ),
  ];

  const failed = checks.filter((item) => !item.passed);
  const report = {
    schemaVersion: 1,
    auditId: 'frontend-test-foundation-audit-v1',
    generatedAt: new Date().toISOString(),
    status: failed.length ? 'fail' : 'pass',
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
    facts: {
      testFiles,
      testingLibraryFiles,
    },
    checks,
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(MD_REPORT, renderMarkdown(report), 'utf8');

  console.log(`Frontend test foundation audit status=${report.status}`);
  console.log(`Report: ${JSON_REPORT}`);
  if (failed.length) {
    console.error(`Failed checks: ${failed.map((item) => item.id).join(', ')}`);
    process.exitCode = 1;
  }
}

main();
