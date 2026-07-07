const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CONTRACT_PATH = path.join(ROOT, 'docs', 'openapi.yaml');
const SERVER_PATH = path.join(ROOT, 'backend', 'src', 'server.ts');
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'openapi-contract-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'openapi-contract-audit-v1.md');

function read(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function has(text, pattern) {
  return pattern.test(text);
}

function lineOf(text, needle) {
  const lines = text.split('\n');
  const index = lines.findIndex((line) => line.includes(needle));
  return index >= 0 ? index + 1 : null;
}

function listServerMounts(serverText) {
  const mounts = [];
  const regex = /app\.use\(\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = regex.exec(serverText))) {
    if (match[1].startsWith('/api')) mounts.push(match[1]);
  }
  return Array.from(new Set(mounts)).sort();
}

function pathIsDocumented(contractText, routePath) {
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^  ${escaped}:\\s*$`, 'm').test(contractText);
}

function tagIsDocumented(contractText, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^  - name: ${escaped}\\s*$`, 'm').test(contractText);
}

function buildChecks(contractText, serverText) {
  const requiredPaths = [
    '/api/health',
    '/api/v1/health',
    '/api/ready',
    '/api/v1/ready',
    '/api/livez',
    '/api/v1/livez',
    '/metrics',
    '/api/auth/login',
    '/api/v1/auth/login',
    '/api/auth/me',
    '/api/v1/auth/me',
    '/api/dashboard',
    '/api/v1/dashboard',
    '/api/dashboard/trends',
    '/api/v1/dashboard/trends',
    '/api/customers',
    '/api/v1/customers',
    '/api/orders',
    '/api/v1/orders',
    '/api/collections/summary',
    '/api/v1/collections/summary',
    '/api/procurement/orders',
    '/api/v1/procurement/orders',
    '/api/warehouses/stock-balances',
    '/api/v1/warehouses/stock-balances',
    '/api/production/summary',
    '/api/v1/production/summary',
    '/api/finance/summary',
    '/api/v1/finance/summary',
    '/api/commercial/readiness',
    '/api/v1/commercial/readiness',
    '/api/audit',
    '/api/v1/audit',
  ];
  const requiredTags = [
    'Health',
    'Auth',
    'Dashboard',
    'Customers',
    'Orders',
    'Collections',
    'Procurement',
    'Warehouse',
    'Production',
    'Finance',
    'Commercial',
    'Audit',
  ];

  const checks = [
    {
      id: 'contract-file',
      passed: Boolean(contractText),
      evidence: `docs/openapi.yaml exists=${Boolean(contractText)}`,
    },
    {
      id: 'openapi-version',
      passed: has(contractText, /^openapi:\s*3\.(0|1)\./m),
      evidence: `openapi line=${lineOf(contractText, 'openapi:') || 'missing'}`,
    },
    {
      id: 'contract-status',
      passed: has(contractText, /^\s*x-contract-status:\s*(seed|partial|generated|published)\s*$/m),
      evidence: `x-contract-status line=${lineOf(contractText, 'x-contract-status:') || 'missing'}`,
    },
    {
      id: 'bearer-auth',
      passed: has(contractText, /^\s*bearerAuth:\s*$/m) && has(contractText, /^\s*scheme:\s*bearer\s*$/m),
      evidence: `bearerAuth line=${lineOf(contractText, 'bearerAuth:') || 'missing'}`,
    },
    {
      id: 'source-evidence',
      passed: contractText.includes('backend/src/server.ts') && Boolean(serverText),
      evidence: `server source present=${Boolean(serverText)}`,
    },
  ];

  for (const routePath of requiredPaths) {
    checks.push({
      id: `path:${routePath}`,
      passed: pathIsDocumented(contractText, routePath),
      evidence: `${routePath} documented=${pathIsDocumented(contractText, routePath)}`,
    });
  }

  for (const tag of requiredTags) {
    checks.push({
      id: `tag:${tag}`,
      passed: tagIsDocumented(contractText, tag),
      evidence: `${tag} tag documented=${tagIsDocumented(contractText, tag)}`,
    });
  }

  const serverMounts = listServerMounts(serverText);
  checks.push({
    id: 'server-mount-inventory',
    passed: serverMounts.length >= 20,
    evidence: `api mounts=${serverMounts.length}; sample=${serverMounts.slice(0, 12).join(', ')}`,
  });

  return checks;
}

function renderMarkdown(report) {
  return [
    '# OpenAPI Contract Audit v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    `- contract: ${report.contractPath}`,
    `- passed: ${report.summary.passed}`,
    `- failed: ${report.summary.failed}`,
    '',
    '| check | status | evidence |',
    '|---|---|---|',
    ...report.checks.map((check) => `| ${check.id} | ${check.passed ? 'pass' : 'fail'} | ${String(check.evidence).replace(/\|/g, '\\|')} |`),
    '',
  ].join('\n');
}

function main() {
  const contractText = read(CONTRACT_PATH);
  const serverText = read(SERVER_PATH);
  const checks = buildChecks(contractText, serverText);
  const failed = checks.filter((check) => !check.passed);
  const report = {
    schemaVersion: 1,
    auditId: 'openapi-contract-audit-v1',
    generatedAt: new Date().toISOString(),
    status: failed.length ? 'fail' : 'pass',
    contractPath: 'docs/openapi.yaml',
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
    checks,
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(MD_REPORT, renderMarkdown(report));

  console.log(`OpenAPI contract audit status=${report.status}`);
  console.log(`Report: ${JSON_REPORT}`);
  if (failed.length) {
    console.error(`Failed checks: ${failed.map((check) => check.id).join(', ')}`);
    process.exitCode = 1;
  }
}

main();
