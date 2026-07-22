const fs = require('fs');
const os = require('os');
const path = require('path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function safeName(value) {
  return String(value || 'root')
    .replace(/^#\/?/, '')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '') || 'root';
}

function createRun(config, { fallbackRoutes, viewports }) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);
  const runId = `${stamp}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const root = path.join(process.cwd(), 'output', 'ui-ux-audit', runId);
  const report = {
    runId,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    durationMs: 0,
    appUrl: config.appUrl,
    routes: [],
    discoveredRoutes: [],
    fallbackRoutes,
    skippedRoutes: [],
    viewports: viewports.map(({ id, width, height }) => ({ id, width, height })),
    summary: { routesAudited: 0, viewportRuns: 0, stateRuns: 0, errors: 0, warnings: 0, info: 0, screenshots: 0 },
    results: [],
    findings: [],
    artifacts: { screenshots: [], traces: [], rawDom: [] },
  };
  return { runId, root, report, startedAt: Date.now() };
}

function addFinding(report, finding) {
  report.findings.push({
    severity: finding.severity || 'warning',
    category: finding.category || 'runtime',
    code: finding.code || 'AUDIT_FINDING',
    message: finding.message || 'Audit finding',
    route: finding.route || '',
    viewport: finding.viewport || '',
    state: finding.state || 'initial',
    selector: finding.selector || null,
    bbox: finding.bbox || null,
    screenshot: finding.screenshot || null,
    details: finding.details || {},
  });
}

function groupBy(items, key) {
  return items.reduce((groups, item) => {
    const value = item[key] || 'unknown';
    groups[value] = groups[value] || [];
    groups[value].push(item);
    return groups;
  }, {});
}

function renderFindingList(items) {
  if (!items.length) return 'No findings.';
  return items.slice(0, 50).map((item) => `- ${item.severity.toUpperCase()} [${item.category}/${item.code}] ${item.route} ${item.viewport} ${item.state}: ${item.message}`).join('\n');
}

function renderGroups(groups) {
  const keys = Object.keys(groups).sort();
  if (!keys.length) return 'No findings.';
  return keys.map((key) => [`### ${key}`, renderFindingList(groups[key])].join('\n\n')).join('\n\n');
}

function renderMarkdown(report, status) {
  const topErrors = report.findings.filter((item) => item.severity === 'error').slice(0, 10);
  const groupedByRoute = groupBy(report.findings, 'route');
  const groupedByViewport = groupBy(report.findings, 'viewport');
  const mobileIssues = report.findings.filter((item) => /^mobile/.test(item.viewport));
  const accessibilityIssues = report.findings.filter((item) => item.category === 'accessibility');
  const consoleNetworkIssues = report.findings.filter((item) => item.category === 'console' || item.category === 'network');

  return [
    '# Browser UI/UX Audit v2', '',
    `Status: **${status}**`,
    `Run ID: \`${report.runId}\``,
    `App URL: \`${report.appUrl}\``, '',
    '## Executive Summary', '',
    `Routes audited: ${report.summary.routesAudited}`,
    `Viewport runs: ${report.summary.viewportRuns}`,
    `State runs: ${report.summary.stateRuns}`,
    `Errors: ${report.summary.errors}`,
    `Warnings: ${report.summary.warnings}`,
    `Screenshots: ${report.summary.screenshots}`, '',
    '## Top Blocking Errors', '',
    topErrors.length ? topErrors.map((item, index) => `${index + 1}. [${item.code}] ${item.route} ${item.viewport} ${item.message}`).join('\n') : 'No blocking errors.', '',
    '## Findings By Route', '', renderGroups(groupedByRoute), '',
    '## Findings By Viewport', '', renderGroups(groupedByViewport), '',
    '## Mobile Issues', '', renderFindingList(mobileIssues), '',
    '## Accessibility Issues', '', renderFindingList(accessibilityIssues), '',
    '## Console And Network Issues', '', renderFindingList(consoleNetworkIssues), '',
    '## Screenshot Index', '',
    report.artifacts.screenshots.map((item) => `- ${item}`).join('\n') || 'No screenshots captured.', '',
    '## Reproduction Command', '', '```powershell', 'npm run test:browser:ui-ux', '```', '',
  ].join('\n');
}

function writeReports(run, status) {
  const { report } = run;
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - run.startedAt;
  report.summary.errors = report.findings.filter((item) => item.severity === 'error').length;
  report.summary.warnings = report.findings.filter((item) => item.severity === 'warning').length;
  report.summary.info = report.findings.filter((item) => item.severity === 'info').length;
  report.summary.routesAudited = report.routes.length;

  const reportJson = path.join(run.root, 'report.json');
  const reportMd = path.join(run.root, 'report.md');
  const summaryTxt = path.join(run.root, 'summary.txt');
  atomicWrite(reportJson, JSON.stringify(report, null, 2));
  atomicWrite(reportMd, renderMarkdown(report, status));
  atomicWrite(summaryTxt, [
    `status=${status}`,
    `runId=${report.runId}`,
    `routes=${report.routes.length}`,
    `errors=${report.summary.errors}`,
    `warnings=${report.summary.warnings}`,
    `screenshots=${report.summary.screenshots}`,
    `report=${reportJson}`,
  ].join(os.EOL));
  return { reportJson, reportMd, summaryTxt };
}

module.exports = { addFinding, atomicWrite, createRun, ensureDir, renderMarkdown, safeName, writeReports };
