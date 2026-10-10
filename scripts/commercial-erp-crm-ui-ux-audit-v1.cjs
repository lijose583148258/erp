const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { evaluateCommercialAuditStatus, scoreReport } = require('./lib/commercial-ui-ux-scoring.cjs');
const {
  buildAiFutureWorkGovernanceMatrix,
  buildFuturePrLeadDispositions,
  getRecommendedFollowUpOrder,
} = require('./lib/commercial-ui-ux-governance.cjs');

const ROOT = process.cwd();
const ROUTES_FILE = path.join(ROOT, 'scripts', 'audit-routes', 'commercial-erp-crm-ui-ux-routes.cjs');
const ROUTES_MODULE = require(ROUTES_FILE);
const ROUTES = Array.isArray(ROUTES_MODULE) ? ROUTES_MODULE : ROUTES_MODULE.routes;
const COMMERCIAL_CONFIG = ROUTES_MODULE.commercialAuditConfig || {};
const RUNNER = path.join(ROOT, 'scripts', 'parallel-isolated-playwright-audit-v1.cjs');
const DEFAULT_APP_URL = 'http://127.0.0.1:5001/';

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);
  const random = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${process.pid}-${random}`;
}

function parseNumberEnv(name, defaultValue, min = 0) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`${name} must be a number >= ${min}`);
  }
  return value;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${value}\n`, 'utf8');
}

function toRepoRelative(filePath) {
  if (!filePath) return null;
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function normalizePathForReport(filePath) {
  if (!filePath) return null;
  return path.resolve(filePath).replace(/\\/g, '/');
}

function gitScopeEvidence() {
  const result = spawnSync('git', ['status', '--porcelain=v1'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  const statusEntries = result.status === 0
    ? result.stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean)
    : [];
  const changedFiles = statusEntries
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, '/'));
  const forbiddenPatterns = [
    /^\.github\//,
    /^backend\//,
    /^scripts\/parallel-isolated-playwright-audit-v1\.cjs$/,
    /^scripts\/lib\/isolated-playwright-/,
  ];
  const forbiddenFiles = changedFiles.filter((file) => forbiddenPatterns.some((pattern) => pattern.test(file)));
  return {
    statusEntries,
    changedFiles,
    forbiddenFiles,
    status: forbiddenFiles.length ? 'failed' : 'passed',
  };
}

function summarizeCriteriaByDimension(criteria) {
  return criteria.reduce((summary, item) => {
    const dimension = item.dimension || 'uncategorized';
    if (!summary[dimension]) {
      summary[dimension] = {
        criteria: 0,
        totalWeight: 0,
        ids: [],
      };
    }
    summary[dimension].criteria += 1;
    summary[dimension].totalWeight += Number(item.weight || 0);
    summary[dimension].ids.push(item.id);
    return summary;
  }, {});
}

function summarizeCriteriaMapping(criteria, coveredCriteriaIds) {
  const covered = new Set(coveredCriteriaIds || []);
  const routeBound = criteria.filter((item) => !item.appliesTo?.reportLevel && !item.appliesTo?.policyLevel);
  return {
    routeBoundCriteriaTotal: routeBound.length,
    coveredCriteriaIds: Array.from(covered).sort(),
    unmappedRouteCriteriaIds: routeBound
      .filter((item) => !covered.has(item.id))
      .map((item) => item.id)
      .sort(),
    reportLevelCriteriaIds: criteria.filter((item) => item.appliesTo?.reportLevel).map((item) => item.id),
    policyLevelCriteriaIds: criteria.filter((item) => item.appliesTo?.policyLevel).map((item) => item.id),
  };
}

function markdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function buildCommercialReport({ runId, runRoot, startedAt, runnerResult, parallelReport, runnerReportPath }) {
  const minScore = parseNumberEnv('COMMERCIAL_UI_UX_MIN_SCORE', COMMERCIAL_CONFIG.scoring?.minScore || 85, 0);
  const scoring = parallelReport
    ? scoreReport(parallelReport, { routes: ROUTES, scoringConfig: COMMERCIAL_CONFIG.scoring, minScore })
    : {
      score: 0,
      minScore,
      routes: [],
      missingRoutes: ROUTES.map((route) => route.id),
      missingScreenshots: ROUTES.map((route) => route.id),
      duplicateRoutes: [],
      unknownRoutes: [],
      duplicateWorkers: [],
      blockers: [],
      groupsCovered: [],
      criteriaCovered: [],
      screenshots: [],
    };
  const scopeEvidence = gitScopeEvidence();
  const runnerPassed = runnerResult.status === 0 && parallelReport?.status === 'passed';
  const productReadinessCriteria = Array.isArray(COMMERCIAL_CONFIG.productReadinessCriteria)
    ? COMMERCIAL_CONFIG.productReadinessCriteria
    : [];
  const approvedSkillAndAgentSupport = COMMERCIAL_CONFIG.approvedSkillAndAgentSupport || {};
  const futurePrLeadDispositions = buildFuturePrLeadDispositions();
  const aiFutureWorkGovernanceMatrix = buildAiFutureWorkGovernanceMatrix();
  const status = evaluateCommercialAuditStatus({
    runnerPassed,
    scoring,
    scopeStatus: scopeEvidence.status,
  });

  return {
    schemaVersion: 1,
    auditId: COMMERCIAL_CONFIG.auditId || 'commercial-erp-crm-ui-ux-v1',
    runId,
    status,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    appUrl: process.env.APP_URL || DEFAULT_APP_URL,
    scope: COMMERCIAL_CONFIG.scope || [],
    nonGoals: COMMERCIAL_CONFIG.nonGoals || [],
    routeConfig: toRepoRelative(ROUTES_FILE),
    runnerFoundation: {
      command: `node ${toRepoRelative(RUNNER)}`,
      reportPath: normalizePathForReport(runnerReportPath),
      status: parallelReport?.status || 'missing-report',
      exitCode: runnerResult.status,
      signal: runnerResult.signal || null,
      error: runnerResult.error ? String(runnerResult.error.message || runnerResult.error) : null,
    },
    scoring: {
      score: scoring.score,
      minScore: scoring.minScore,
      readiness: scoring.score >= 95 ? 'ready' : scoring.score >= scoring.minScore ? 'watch' : 'blocked',
      readinessScope: 'route-evidence-only',
      scoreMeaning: 'route-evidence-health-only',
      groupsCovered: scoring.groupsCovered,
      criteriaCovered: scoring.criteriaCovered,
      routesTotal: ROUTES.length,
      routesScored: scoring.routes.length,
      missingRoutes: scoring.missingRoutes,
      missingScreenshots: scoring.missingScreenshots,
      duplicateRoutes: scoring.duplicateRoutes,
      unknownRoutes: scoring.unknownRoutes,
      duplicateWorkers: scoring.duplicateWorkers,
      blockers: scoring.blockers.map((route) => ({
        routeId: route.routeId,
        moduleId: route.moduleId,
        viewport: route.viewport,
        score: route.score,
        error: route.error,
      })),
    },
    scopeGuardEvidence: scopeEvidence,
    architectureEvidence: {
      backendLayering: {
        label: 'backend layering',
        command: 'npm run audit:backend:layering',
        status: 'separate-gate-required',
        reason: 'Commercial route evidence does not replace backend controller/service boundary verification.',
      },
    },
    approvedSkillAndAgentSupport,
    aiGovernance: {
      status: 'future-only-matrix',
      scope: 'PR2 documents and audits AI governance requirements only; it does not implement assistant, OCR, import, command-bar, analytics, or agent runtime behavior.',
      matrix: aiFutureWorkGovernanceMatrix,
    },
    productReadinessRubric: {
      status: 'manual-review-required',
      scoreScale: 'Per criterion: 0=missing or unsafe, 1=partial or weakly evidenced, 2=mature enough for commercial operator review. Optional 0-5 dimension summaries are derived from these criteria, not from the route health score.',
      reason: 'The automated runner verifies route evidence health. Product maturity criteria require screenshot review, action evidence, theme/locale notes, and missing-capability review; route render alone must not be marked commercially ready.',
      evidenceRecordTemplate: {
        criterionId: 'DASH-01',
        score: '0|1|2',
        routeId: 'dashboard-desktop',
        viewport: 'desktop',
        theme: 'light|dark|unsampled',
        locale: 'zh|en|vi|unsampled',
        evidencePath: 'absolute screenshot or report path',
        missingOrUnavailable: false,
        weakEvidence: true,
        notes: 'manual reviewer note',
      },
      darkModeContrastTemplate: {
        criterionId: 'DARK-01',
        routeId: 'dashboard-desktop',
        foreground: '#ffffff',
        background: '#111827',
        ratio: '4.50',
        wcagThreshold: '4.5 normal text / 3.0 large text or non-text UI',
        pass: true,
        statusMeaningNotColorOnly: true,
        evidencePath: 'absolute screenshot path',
      },
      criteriaTotal: productReadinessCriteria.length,
      dimensions: summarizeCriteriaByDimension(productReadinessCriteria),
      mapping: summarizeCriteriaMapping(productReadinessCriteria, scoring.criteriaCovered),
      criteria: productReadinessCriteria,
    },
    routes: scoring.routes,
    evidence: {
      outputRoot: normalizePathForReport(runRoot),
      isolatedParallelReport: normalizePathForReport(runnerReportPath),
      screenshots: scoring.screenshots,
    },
    externalAuditDisposition: {
      source: 'user-provided external AI audit note',
      disposition: 'review-lead-only-for-pr2',
      reason: 'Architecture/backend recommendations are outside the PR2 commercial UI/UX audit scope guard.',
      futurePrLeadDispositions,
      outOfScopeLeadExamples: futurePrLeadDispositions.map((lead) => lead.label),
      correctedEngineeringReadinessFindings: futurePrLeadDispositions.map((lead) => ({
        area: lead.id,
        evidence: lead.currentEvidence,
        followUp: lead.futureLane,
      })),
      recommendedFollowUpOrder: getRecommendedFollowUpOrder(),
    },
  };
}

function renderMarkdown(report) {
  const lines = [
    '# Commercial ERP/CRM UI/UX Audit v1',
    '',
    `Status: **${report.status}**`,
    `Run ID: \`${report.runId}\``,
    `App URL: \`${report.appUrl}\``,
    `Route evidence health score: **${report.scoring.score} / 100**`,
    `Route evidence readiness: **route-evidence ${report.scoring.readiness}**`,
    '',
    '## Scope Guard',
    '',
    ...report.scope.map((item) => `- ${item}`),
    '',
    '## Non-goals',
    '',
    ...report.nonGoals.map((item) => `- ${item}`),
    '',
    '## Runner Foundation',
    '',
    `- command: \`${report.runnerFoundation.command}\``,
    `- runner status: \`${report.runnerFoundation.status}\``,
    `- runner exit code: \`${report.runnerFoundation.exitCode}\``,
    `- isolated report: \`${report.runnerFoundation.reportPath}\``,
    '',
    '## Route Evidence Health',
    '',
    `- routes configured: ${report.scoring.routesTotal}`,
    `- routes scored: ${report.scoring.routesScored}`,
    `- groups covered: ${report.scoring.groupsCovered.join(', ') || 'none'}`,
    `- criteria covered by routes: ${report.scoring.criteriaCovered.join(', ') || 'none'}`,
    `- missing routes: ${report.scoring.missingRoutes.length ? report.scoring.missingRoutes.join(', ') : 'none'}`,
    `- missing screenshots: ${report.scoring.missingScreenshots.length ? report.scoring.missingScreenshots.join(', ') : 'none'}`,
    `- duplicate routes: ${report.scoring.duplicateRoutes.length ? report.scoring.duplicateRoutes.join(', ') : 'none'}`,
    `- unknown routes: ${report.scoring.unknownRoutes.length ? report.scoring.unknownRoutes.join(', ') : 'none'}`,
    `- duplicate workers: ${report.scoring.duplicateWorkers.length ? report.scoring.duplicateWorkers.join(', ') : 'none'}`,
    `- blocker routes: ${report.scoring.blockers.length}`,
    '',
    '| Route | Viewport | Group | Risk | Health Score | Criteria | Screenshot |',
    '|---|---:|---|---|---:|---|---|',
    ...report.routes.map((route) => [
      route.routeId,
      route.viewport,
      route.group,
      route.risk,
      route.score,
      (route.criteriaIds || []).join(', '),
      route.screenshot ? 'yes' : 'no',
    ].join(' | ')).map((row) => `| ${row} |`),
    '',
    '## Scope Guard Evidence',
    '',
    `- forbidden changed files: ${report.scopeGuardEvidence.forbiddenFiles.length ? report.scopeGuardEvidence.forbiddenFiles.join(', ') : 'none'}`,
    '',
    '## Approved Skills And Agents',
    '',
    'Trusted local skills:',
    ...(report.approvedSkillAndAgentSupport.localSkills || []).map((item) => `- ${item}`),
    '',
    'Allowed subagents:',
    ...(report.approvedSkillAndAgentSupport.subagents || []).map((item) => `- ${item}`),
    '',
    'Guardrails:',
    ...(report.approvedSkillAndAgentSupport.guardrails || []).map((item) => `- ${item}`),
    '',
    '## AI Future Work Governance Matrix',
    '',
    report.aiGovernance.scope,
    '',
    '| Surface | Lane | Status | Default Mode | External Opt-in | Human Confirmation | Planner/Executor/Verifier | Eval/Red-team Evidence | Future PR |',
    '|---|---|---|---|---|---|---|---|---|',
    ...report.aiGovernance.matrix.map((item) => `| ${[
      item.aiSurface,
      item.featureLane,
      item.status,
      item.defaultMode,
      item.externalModelOptInRequired ? 'yes' : 'no',
      item.humanConfirmationRequired ? 'yes' : 'no',
      item.plannerExecutorVerifierRequired ? 'yes' : 'no',
      item.evalRedTeamEvidence,
      item.futurePR,
    ].map(markdownCell).join(' | ')} |`),
    '',
    '## Product Readiness Criteria',
    '',
    `Criteria status: \`${report.productReadinessRubric.status}\``,
    `Score scale: ${report.productReadinessRubric.scoreScale}`,
    report.productReadinessRubric.reason,
    `Unmapped route criteria: ${report.productReadinessRubric.mapping.unmappedRouteCriteriaIds.length ? report.productReadinessRubric.mapping.unmappedRouteCriteriaIds.join(', ') : 'none'}`,
    `Report-level criteria: ${report.productReadinessRubric.mapping.reportLevelCriteriaIds.join(', ') || 'none'}`,
    `Policy-level criteria: ${report.productReadinessRubric.mapping.policyLevelCriteriaIds.join(', ') || 'none'}`,
    '',
    '| ID | Dimension | Weight | Applies To | Criterion | Evidence |',
    '|---|---|---:|---|---|---|',
    ...report.productReadinessRubric.criteria.map((item) => [
      item.id,
      item.dimension,
      item.weight,
      JSON.stringify(item.appliesTo || {}),
      item.criterion,
      (item.evidence || []).join(', '),
    ].join(' | ')).map((row) => `| ${row} |`),
    '',
    '## External Audit Disposition',
    '',
    `The provided external AI audit is treated as ${report.externalAuditDisposition.disposition}.`,
    report.externalAuditDisposition.reason,
    '',
    'Out-of-scope leads:',
    ...report.externalAuditDisposition.outOfScopeLeadExamples.map((item) => `- ${item}`),
    '',
    'Future PR lead dispositions:',
    '',
    '| ID | PR2 Decision | Current Evidence | Future Lane | Evidence Commands |',
    '|---|---|---|---|---|',
    ...report.externalAuditDisposition.futurePrLeadDispositions.map((item) => `| ${[
      item.id,
      item.pr2Decision,
      item.currentEvidence,
      item.futureLane,
      (item.evidenceCommands || []).join('; '),
    ].map(markdownCell).join(' | ')} |`),
    '',
    'Corrected engineering-readiness findings:',
    ...report.externalAuditDisposition.correctedEngineeringReadinessFindings.map((item) =>
      `- ${item.area}: ${item.evidence} Follow-up: ${item.followUp}`,
    ),
    '',
    'Recommended follow-up order:',
    ...report.externalAuditDisposition.recommendedFollowUpOrder.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## Screenshot Index',
    '',
    ...(report.evidence.screenshots.length
      ? report.evidence.screenshots.map((item) => `- ${item.routeId}: \`${item.path}\``)
      : ['No screenshots captured.']),
    '',
    '## Reproduction',
    '',
    '```powershell',
    '# Frontend strict ratchet scope is defined in tsconfig.strict.json',
    'npm run typecheck:strict',
    'npm run audit:commercial:ui-ux',
    '```',
    '',
  ];
  return lines.join(os.EOL);
}

function main() {
  const startedAt = Date.now();
  const runId = process.env.COMMERCIAL_UI_UX_RUN_ID || createRunId();
  const runRoot = path.join(ROOT, 'output', 'commercial-ui-ux-audit', runId);
  const isolatedOutputRoot = path.join(runRoot, 'isolated-playwright');
  ensureDir(runRoot);

  const env = {
    ...process.env,
    APP_URL: process.env.APP_URL || DEFAULT_APP_URL,
    PLAYWRIGHT_USERNAME: process.env.PLAYWRIGHT_USERNAME || 'commercial_ui_ux_audit_admin',
    PLAYWRIGHT_PASSWORD: process.env.PLAYWRIGHT_PASSWORD || 'AuditSmoke12345!',
    ISOLATED_PLAYWRIGHT_ROUTES_FILE: ROUTES_FILE,
    ISOLATED_PLAYWRIGHT_OUTPUT_ROOT: isolatedOutputRoot,
    ISOLATED_PLAYWRIGHT_WORKERS: process.env.COMMERCIAL_UI_UX_WORKERS || process.env.ISOLATED_PLAYWRIGHT_WORKERS || '2',
    ISOLATED_PLAYWRIGHT_FAIL_ON_CONSOLE_ERRORS: process.env.ISOLATED_PLAYWRIGHT_FAIL_ON_CONSOLE_ERRORS || '1',
    ISOLATED_PLAYWRIGHT_FAIL_ON_HTTP_FAILURES: process.env.ISOLATED_PLAYWRIGHT_FAIL_ON_HTTP_FAILURES || '1',
  };

  const runnerResult = spawnSync(process.execPath, [RUNNER], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });

  const runnerReportPath = path.join(isolatedOutputRoot, 'parallel-report.json');
  const parallelReport = readJson(runnerReportPath);
  const report = buildCommercialReport({
    runId,
    runRoot,
    startedAt,
    runnerResult,
    parallelReport,
    runnerReportPath,
  });
  const jsonPath = path.join(runRoot, 'commercial-ui-ux-report-v1.json');
  const mdPath = path.join(runRoot, 'commercial-ui-ux-report-v1.md');
  const summaryPath = path.join(runRoot, 'summary.txt');
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  writeText(summaryPath, [
    `status=${report.status}`,
    `runId=${report.runId}`,
    `score=${report.scoring.score}`,
    `readiness=route-evidence-${report.scoring.readiness}`,
    `readinessScope=${report.scoring.readinessScope}`,
    `report=${normalizePathForReport(jsonPath)}`,
    `markdown=${normalizePathForReport(mdPath)}`,
    `isolatedReport=${normalizePathForReport(runnerReportPath)}`,
  ].join(os.EOL));

  if (report.status !== 'passed') {
    console.error(`Commercial ERP/CRM UI/UX audit failed. Report: ${jsonPath}`);
    process.exit(1);
  }
  console.log(`Commercial ERP/CRM UI/UX audit passed. Report: ${jsonPath}`);
}

main();
