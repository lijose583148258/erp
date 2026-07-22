const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const reportsDirValue = valueFor('--reports-dir');
const evidenceValue = valueFor('--evidence');
if (!reportsDirValue || !evidenceValue) throw new Error('Missing --reports-dir or --evidence.');
const reportsDir = path.resolve(reportsDirValue);
const evidencePath = path.resolve(evidenceValue);
if (!fs.existsSync(reportsDir) || !fs.statSync(reportsDir).isDirectory()) throw new Error('AI reports directory does not exist.');
if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) throw new Error('Enterprise evidence file does not exist.');
const files = {
  runtime: path.join(reportsDir, 'ai-governed-runtime-audit-v1.json'),
  adminBrowser: path.join(reportsDir, 'crm-ai-assistant-browser-audit-report-v1.json'),
  salesBrowser: path.join(reportsDir, 'crm-ai-assistant-browser-audit-report-v1-sales.json'),
  governedBrowser: path.join(reportsDir, 'crm-ai-assistant-browser-audit-report-v1-governed.json'),
  contract: path.join(reportsDir, 'ai-governance-contract-attestation.json'),
};
for (const [name, file] of Object.entries(files)) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${name} AI report does not exist.`);
}
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const reports = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, read(file)]));
const hashes = Object.fromEntries(Object.entries(files).map(([name, file]) => [
  name,
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
]));
const evidence = read(evidencePath);
const identityMatches = report => report.environment === evidence.environment
  && report.evidenceId === evidence.evidenceId
  && report.commitSha === evidence.commitSha
  && report.imageDigest === evidence.imageDigest;
const assertFresh = (name, report, identityRequired = true) => {
  const finishedMs = Date.parse(String(report.finishedAt || report.generatedAt || ''));
  const ageMs = Date.now() - finishedMs;
  if (!Number.isFinite(finishedMs) || ageMs < -300_000 || ageMs > 7 * 86_400_000) {
    throw new Error(`${name} report is stale or has an invalid timestamp.`);
  }
  if (report.status !== 'passed' || (identityRequired && !identityMatches(report))) {
    throw new Error(`${name} report status or release identity is invalid.`);
  }
};

assertFresh('AI runtime', reports.runtime);
const runtimeChecks = new Set((reports.runtime.checks || [])
  .filter(check => check?.status === 'passed').map(check => check.name));
for (const required of [
  'dedicated-audit-login',
  'default-local-only',
  'shared-budget-and-circuit-configured',
  'sentinel-shared-ai-limit',
  'client-provider-fields-rejected-or-limited',
  'ai-prometheus-outcomes',
  'metrics-do-not-leak-prompts',
]) {
  if (!runtimeChecks.has(required)) throw new Error(`AI runtime report is missing ${required}.`);
}
if ((reports.runtime.checks || []).some(check => check?.status !== 'passed')
  || !Array.isArray(reports.runtime.instances) || new Set(reports.runtime.instances).size < 2) {
  throw new Error('AI runtime report does not prove two-instance governed local operation.');
}

const requiredBrowserSteps = [
  'browser-external-ai-policy-redteam',
  'assert-browser-external-ai-disabled',
  'assert-hidden-data-request-refused',
  'assert-server-governed-ai-fallback',
  'click-ai-quick-analysis',
];
for (const [name, report] of [
  ['AI admin browser', reports.adminBrowser],
  ['AI sales browser', reports.salesBrowser],
  ['AI governed browser', reports.governedBrowser],
]) {
  assertFresh(name, report);
  const passed = new Set((report.steps || []).filter(step => step?.result === 'passed').map(step => step.step));
  if (requiredBrowserSteps.some(step => !passed.has(step))
    || (report.steps || []).some(step => step?.result === 'failed')
    || !Array.isArray(report.consoleErrors) || report.consoleErrors.length !== 0) {
    throw new Error(`${name} report does not prove the governed browser boundary.`);
  }
}
if (!/admin/i.test(String(reports.adminBrowser.roleLabel || ''))
  || !/sales/i.test(String(reports.salesBrowser.roleLabel || ''))
  || !/admin|governed/i.test(String(reports.governedBrowser.roleLabel || ''))) {
  throw new Error('AI browser reports do not cover the required admin and sales roles.');
}

assertFresh('AI contract', reports.contract, false);
const requiredContractChecks = [
  'local-only-default', 'sensitive-input-refusal', 'obfuscated-input-refusal',
  'prompt-injection-refusal', 'aggregate-context-allowlist', 'client-provider-field-rejection',
  'provider-failure-fallback', 'redirect-deny', 'bounded-safe-output',
  'unsafe-output-rejection', 'oversized-output-rejection', 'prompt-free-metrics',
  'durable-audit-fail-closed', 'sanitized-pre-dispatch-audit',
  'budget-fail-closed', 'budget-exhaustion', 'shared-circuit-open', 'circuit-threshold-open',
];
const contractChecks = new Set(reports.contract.checks || []);
if (reports.contract.schemaVersion !== 1
  || reports.contract.repository !== 'lijose583148258/erp'
  || reports.contract.workflow !== 'AI Governance Contract'
  || reports.contract.commitSha !== evidence.commitSha
  || reports.contract.providerMode !== 'mocked'
  || Number(reports.contract.paidModelCalls) !== 0
  || requiredContractChecks.some(check => !contractChecks.has(check))
  || !/^https:\/\/github\.com\/lijose583148258\/erp\/actions\/runs\/[0-9]+$/.test(String(reports.contract.runUrl || ''))) {
  throw new Error('AI zero-cost contract attestation is incomplete or does not match the release.');
}

const binding = {
  status: 'passed',
  environment: evidence.environment,
  evidenceId: evidence.evidenceId,
  commitSha: evidence.commitSha,
  imageDigest: evidence.imageDigest,
  verifiedAt: new Date().toISOString(),
  externalEnabled: false,
  paidModelCalls: 0,
  runtimeReportSha256: hashes.runtime,
  adminBrowserReportSha256: hashes.adminBrowser,
  salesBrowserReportSha256: hashes.salesBrowser,
  governedBrowserReportSha256: hashes.governedBrowser,
  contractReportSha256: hashes.contract,
};
if (args.includes('--bind')) {
  evidence.ai = {
    ...evidence.ai,
    externalEnabled: false,
    roleIsolationPassed: true,
    aggregateOnlyBoundaryPassed: true,
    dailyBudgetEnforced: true,
    circuitBreakerPassed: true,
    promptFreeTelemetryPassed: true,
    localFallbackPassed: true,
    externalGatewayAllowlistPassed: false,
    secretManagerBacked: false,
    redTeamPassed: false,
    outputSafetyPassed: true,
    responseLimitPassed: true,
    redirectBoundaryPassed: true,
    serverInputSafetyPassed: true,
    contextAllowlistPassed: true,
  };
  evidence.aiDrill = binding;
  const temporary = `${evidencePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, evidencePath);
} else {
  const current = evidence.aiDrill;
  for (const [key, value] of Object.entries(binding)) {
    if (key === 'verifiedAt') continue;
    if (current?.[key] !== value) throw new Error('Enterprise evidence is not bound to the governed AI reports.');
  }
  if (evidence.ai?.externalEnabled !== false
    || evidence.ai?.roleIsolationPassed !== true
    || evidence.ai?.aggregateOnlyBoundaryPassed !== true
    || evidence.ai?.dailyBudgetEnforced !== true
    || evidence.ai?.circuitBreakerPassed !== true
    || evidence.ai?.promptFreeTelemetryPassed !== true
    || evidence.ai?.localFallbackPassed !== true
    || evidence.ai?.outputSafetyPassed !== true
    || evidence.ai?.responseLimitPassed !== true
    || evidence.ai?.redirectBoundaryPassed !== true
    || evidence.ai?.serverInputSafetyPassed !== true
    || evidence.ai?.contextAllowlistPassed !== true) {
    throw new Error('Governed AI admission fields are incomplete.');
  }
}
console.log('Governed AI evidence: PASSED (external provider disabled, paid calls 0)');
