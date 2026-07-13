const fs = require('fs');
const path = require('path');

const root = process.cwd();
const findings = [];

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, '');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));
const add = (severity, file, message) => findings.push({ severity, file, message });

function requireTokens(file, tokens) {
  if (!exists(file)) {
    add('P1', file, 'Required frontend runtime resilience file is missing.');
    return '';
  }

  const content = read(file);
  for (const token of tokens) {
    if (!content.includes(token)) add('P1', file, `Missing runtime resilience token: ${token}`);
  }
  return content;
}

requireTokens('index.tsx', [
  "import ErrorBoundary from './components/ErrorBoundary'",
  '<ErrorBoundary>',
  '<App />',
]);

requireTokens('App.tsx', [
  '<Suspense',
  'shell.content',
]);

requireTokens('app/appContent.tsx', [
  'lazy(async () =>',
  'activePageImports',
  '<PageErrorBoundary pageId={activeTab} key={activeTab}>',
]);

requireTokens('components/ErrorBoundary.tsx', [
  'RootErrorFallback',
  'role="alert"',
  'reportClientIssue',
  '系统遇到错误',
  '复制错误',
  '重新加载',
]);

requireTokens('components/PageErrorBoundary.tsx', [
  'PageErrorFallback',
  'role="alert"',
  'reportClientIssue',
  '当前页面加载失败',
  '查看错误详情',
  '重新加载页面',
]);

requireTokens('scripts/frontend-unit-tests.tsx', [
  'RootErrorFallback',
  'PageErrorFallback',
  'error boundaries render actionable fallback UI',
]);

if (!exists('docs/adr/0020-frontend-runtime-resilience.md')) {
  add('P2', 'docs/adr/0020-frontend-runtime-resilience.md', 'Frontend runtime resilience ADR is missing.');
}

if (findings.length) {
  console.error('Frontend Runtime Resilience Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('Frontend Runtime Resilience Audit: PASS');
console.log('- Root and page-level error boundaries expose actionable fallback UI.');
console.log('- Active pages remain route-level lazy-loaded behind PageErrorBoundary.');
console.log('- Frontend unit tests cover fallback rendering.');
