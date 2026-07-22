const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  evaluateCommercialAuditStatus,
  resolveRouteScreenshot,
  scoreReport,
  scoreRoute,
} = require('./lib/commercial-ui-ux-scoring.cjs');

const tempRoot = path.join(process.cwd(), 'output', `commercial-scoring-contract-${process.pid}`);
const workerRoot = path.join(tempRoot, 'worker');
const screenshotsDir = path.join(workerRoot, 'screenshots');
fs.mkdirSync(screenshotsDir, { recursive: true });

try {
  const fallbackScreenshot = path.join(screenshotsDir, 'route-a.png');
  fs.writeFileSync(fallbackScreenshot, 'fixture', 'utf8');
  const declaredScreenshot = path.join(workerRoot, 'declared.png');
  fs.writeFileSync(declaredScreenshot, 'fixture', 'utf8');
  const outsideScreenshot = path.join(tempRoot, 'outside.png');
  fs.writeFileSync(outsideScreenshot, 'fixture', 'utf8');

  assert.equal(resolveRouteScreenshot({ id: 'route-a' }, workerRoot), fs.realpathSync(fallbackScreenshot));
  assert.equal(resolveRouteScreenshot({ id: 'route-a', screenshot: 'declared.png' }, workerRoot), fs.realpathSync(declaredScreenshot));
  assert.equal(resolveRouteScreenshot({ id: 'route-a', screenshot: 'missing.png' }, workerRoot), null);
  assert.equal(resolveRouteScreenshot({ id: 'route-a', screenshot: '../outside.png' }, workerRoot), null);

  const metadata = {
    id: 'route-a',
    commercial: {
      moduleId: 'orders', group: 'sales', risk: 'critical', viewport: 'desktop',
      weight: 2, criteriaIds: ['ORD-01'], evidenceRequired: ['screenshot'], actionEvidence: [],
    },
  };
  const healthy = scoreRoute({ id: 'route-a', status: 'passed', workerId: 'w1' }, metadata, workerRoot, {});
  assert.equal(healthy.score, 100);
  assert.equal(healthy.checks.screenshotCaptured, true);

  const missingDeclared = scoreRoute(
    { id: 'route-a', status: 'passed', workerId: 'w1', screenshot: 'missing.png' },
    metadata,
    workerRoot,
    {},
  );
  assert.equal(missingDeclared.checks.screenshotCaptured, false);
  assert.equal(missingDeclared.screenshot, null);
  assert.equal(missingDeclared.score, 80);

  const configuredRoutes = [metadata];
  const cleanReport = scoreReport({
    workers: [{ workerId: 'w1', outputDir: workerRoot }],
    routes: [{ id: 'route-a', status: 'passed', workerId: 'w1' }],
  }, { routes: configuredRoutes, minScore: 85 });
  assert.equal(cleanReport.score, 100);
  assert.deepEqual(cleanReport.missingRoutes, []);
  assert.deepEqual(cleanReport.missingScreenshots, []);
  assert.deepEqual(cleanReport.duplicateRoutes, []);
  assert.deepEqual(cleanReport.unknownRoutes, []);
  assert.deepEqual(cleanReport.duplicateWorkers, []);
  assert.equal(evaluateCommercialAuditStatus({ runnerPassed: true, scoring: cleanReport, scopeStatus: 'passed' }), 'passed');

  const corruptedReport = scoreReport({
    workers: [
      { workerId: 'w1', outputDir: workerRoot },
      { workerId: 'w1', outputDir: workerRoot },
    ],
    routes: [
      { id: 'route-a', status: 'passed', workerId: 'w1' },
      { id: 'route-a', status: 'passed', workerId: 'w1' },
      { id: 'route-x', status: 'passed', workerId: 'w1' },
    ],
  }, { routes: configuredRoutes, minScore: 85 });
  assert.deepEqual(corruptedReport.duplicateRoutes, ['route-a']);
  assert.deepEqual(corruptedReport.unknownRoutes, ['route-x']);
  assert.deepEqual(corruptedReport.duplicateWorkers, ['w1']);
  assert.equal(evaluateCommercialAuditStatus({ runnerPassed: true, scoring: corruptedReport, scopeStatus: 'passed' }), 'failed');

  console.log('Commercial UI/UX Scoring Contract: PASS');
  console.log('- screenshot existence/containment and duplicate/unknown evidence integrity verified');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
