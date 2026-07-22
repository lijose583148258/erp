const fs = require('fs');
const path = require('path');

function countIssues(route) {
  return (
    (route.consoleErrors || []).length +
    (route.pageErrors || []).length +
    (route.httpFailures || []).length +
    (route.failedRequests || []).length
  );
}

function screenshotNameFor(routeId) {
  return `${String(routeId).replace(/[^a-z0-9_-]/gi, '_')}.png`;
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function resolveRouteScreenshot(route, workerOutputDir) {
  if (!workerOutputDir) return null;
  const workerRoot = path.resolve(workerOutputDir);
  const candidate = route.screenshot
    ? path.resolve(workerRoot, route.screenshot)
    : path.resolve(workerRoot, 'screenshots', screenshotNameFor(route.id));
  if (!isPathInside(workerRoot, candidate) || !fs.existsSync(candidate)) return null;

  try {
    const realRoot = fs.realpathSync(workerRoot);
    const realCandidate = fs.realpathSync(candidate);
    if (!isPathInside(realRoot, realCandidate) || !fs.statSync(realCandidate).isFile()) return null;
    return realCandidate;
  } catch {
    return null;
  }
}

function scoreRoute(route, metadata, workerOutputDir, weights = {}) {
  const screenshotAbsolute = resolveRouteScreenshot(route, workerOutputDir);
  const scoring = {
    routeRendered: route.status === 'passed',
    screenshotCaptured: Boolean(screenshotAbsolute),
    browserHealthy: countIssues(route) === 0,
    metadataPresent: Boolean(metadata?.commercial),
  };
  const routeRenderedWeight = weights.routeRenderedWeight || 50;
  const screenshotWeight = weights.screenshotWeight || 20;
  const browserHealthWeight = weights.browserHealthWeight || 25;
  const metadataWeight = weights.metadataWeight || 5;
  const totalPossible = routeRenderedWeight + screenshotWeight + browserHealthWeight + metadataWeight;
  const earned =
    (scoring.routeRendered ? routeRenderedWeight : 0) +
    (scoring.screenshotCaptured ? screenshotWeight : 0) +
    (scoring.browserHealthy ? browserHealthWeight : 0) +
    (scoring.metadataPresent ? metadataWeight : 0);
  const commercialWeight = Number(metadata?.commercial?.weight || 1);

  return {
    routeId: route.id,
    moduleId: metadata?.commercial?.moduleId || route.id,
    title: route.title,
    hash: route.hash,
    category: route.category,
    group: metadata?.commercial?.group || 'unknown',
    risk: metadata?.commercial?.risk || route.severity || 'unknown',
    viewport: metadata?.commercial?.viewport || 'unknown',
    commercialWeight,
    criteriaIds: metadata?.commercial?.criteriaIds || [],
    evidenceRequired: metadata?.commercial?.evidenceRequired || [],
    actionEvidence: metadata?.commercial?.actionEvidence || [],
    sampling: metadata?.commercial?.sampling || null,
    score: Number(((earned / totalPossible) * 100).toFixed(2)),
    weightedEarned: earned * commercialWeight,
    weightedPossible: totalPossible * commercialWeight,
    checks: scoring,
    matchedText: route.matchedText || null,
    issueCount: countIssues(route),
    error: route.error || null,
    screenshot: screenshotAbsolute ? screenshotAbsolute.replace(/\\/g, '/') : null,
  };
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function scoreReport(parallelReport, { routes: configuredRoutes, scoringConfig = {}, minScore = 85 }) {
  const metadata = Object.fromEntries(configuredRoutes.map((route) => [route.id, route]));
  const workers = Array.isArray(parallelReport.workers) ? parallelReport.workers : [];
  const runnerRoutes = Array.isArray(parallelReport.routes) ? parallelReport.routes : [];
  const duplicateWorkers = duplicateValues(workers.map((worker) => worker.workerId));
  const workerDirs = Object.fromEntries(workers.map((worker) => [worker.workerId, worker.outputDir]));
  const scoredRoutes = runnerRoutes.map((route) =>
    scoreRoute(route, metadata[route.id], workerDirs[route.workerId], scoringConfig),
  );
  const routeIds = scoredRoutes.map((route) => route.routeId);
  const configuredIds = new Set(configuredRoutes.map((route) => route.id));
  const weightedEarned = scoredRoutes.reduce((sum, route) => sum + route.weightedEarned, 0);
  const weightedPossible = scoredRoutes.reduce((sum, route) => sum + route.weightedPossible, 0);
  const score = weightedPossible > 0 ? Number(((weightedEarned / weightedPossible) * 100).toFixed(2)) : 0;
  const missingRoutes = configuredRoutes.filter((route) => !routeIds.includes(route.id));
  const blockers = scoredRoutes.filter((route) => route.risk === 'critical' && route.score < 100);
  const missingScreenshots = scoredRoutes.filter((route) => !route.screenshot);
  const groupsCovered = Array.from(new Set(scoredRoutes.map((route) => route.group))).sort();
  const criteriaCovered = Array.from(new Set(scoredRoutes.flatMap((route) => route.criteriaIds || []))).sort();
  const screenshots = scoredRoutes
    .filter((route) => route.screenshot)
    .map((route) => ({ routeId: route.routeId, moduleId: route.moduleId, viewport: route.viewport, path: route.screenshot }));

  return {
    score,
    minScore,
    routes: scoredRoutes,
    missingRoutes: missingRoutes.map((route) => route.id),
    missingScreenshots: missingScreenshots.map((route) => route.routeId),
    duplicateRoutes: duplicateValues(routeIds),
    unknownRoutes: [...new Set(routeIds.filter((routeId) => !configuredIds.has(routeId)))].sort(),
    duplicateWorkers,
    blockers,
    groupsCovered,
    criteriaCovered,
    screenshots,
  };
}

function evaluateCommercialAuditStatus({ runnerPassed, scoring, scopeStatus }) {
  return runnerPassed &&
    scoring.score >= scoring.minScore &&
    scoring.missingRoutes.length === 0 &&
    scoring.missingScreenshots.length === 0 &&
    scoring.duplicateRoutes.length === 0 &&
    scoring.unknownRoutes.length === 0 &&
    scoring.duplicateWorkers.length === 0 &&
    scoring.blockers.length === 0 &&
    scopeStatus === 'passed'
    ? 'passed'
    : 'failed';
}

module.exports = { countIssues, evaluateCommercialAuditStatus, resolveRouteScreenshot, scoreReport, scoreRoute };
