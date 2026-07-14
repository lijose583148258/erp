const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const resolveFile = (flag, label) => {
  const value = valueFor(flag);
  const absolute = path.resolve(value || '');
  if (!value || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`${label} file does not exist.`);
  return absolute;
};
const reportPath = resolveFile('--report', 'Observability report');
const evidencePath = resolveFile('--evidence', 'Enterprise evidence');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8').replace(/^\uFEFF/, ''));
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8').replace(/^\uFEFF/, ''));
const reportSha256 = crypto.createHash('sha256').update(fs.readFileSync(reportPath)).digest('hex');
const finishedMs = Date.parse(String(report.finishedAt || ''));

if (report.status !== 'passed') throw new Error('Observability report is not passed.');
if (!Number.isFinite(finishedMs) || finishedMs > Date.now() + 300_000 || Date.now() - finishedMs > 7 * 86_400_000) {
  throw new Error('Observability report is stale or has an invalid timestamp.');
}
if (report.environment !== evidence.environment || report.changeTicket !== evidence.evidenceId
  || report.commitSha !== evidence.commitSha || report.imageDigest !== evidence.imageDigest) {
  throw new Error('Observability report identity does not match enterprise evidence.');
}
if (!Array.isArray(report.checks) || report.checks.some(check => check?.status !== 'passed')) {
  throw new Error('Observability report contains missing or failed checks.');
}
const count = name => report.checks.filter(check => check?.name === name).length;
for (const name of [
  'two-prometheus-application-targets',
  'required-alert-rules-loaded',
  'telemetry-export-envelope',
  'synthetic-alert-submitted',
  'alert-delivery-receipt',
  'alert-resolution-receipt',
]) {
  if (count(name) !== 1) throw new Error(`Observability report is missing ${name}.`);
}
if (count('application-trace-probe') < 2 || count('ha-trace-backend-readback') < 4) {
  throw new Error('Observability report does not cover two applications and all HA traces.');
}
if (Number(report.serviceMonitorTargets) < 2 || report.alertRulesLoaded !== true
  || report.noDroppedSpanRegression !== true || report.failoverTracesPresent !== true
  || report.alertDelivered !== true || report.alertResolved !== true
  || Number(report.traceCount) < 4 || !String(report.receiptId || '').trim()) {
  throw new Error('Observability targets, telemetry, traces, or alert receipts are incomplete.');
}
const bound = evidence.observabilityDrill;
if (evidence.observability?.bothApplicationTargetsUp !== true
  || evidence.observability?.serviceMonitorTargets < 2
  || evidence.observability?.alertRulesLoaded !== true
  || evidence.observability?.alertsDelivered !== true
  || evidence.observability?.alertDeliveryDrill !== true
  || evidence.observability?.failoverTracesPresent !== true
  || evidence.observability?.droppedSpanRegression !== false
  || evidence.observability?.reportSha256 !== reportSha256
  || bound?.status !== 'passed'
  || bound?.environment !== evidence.environment
  || bound?.changeTicket !== evidence.evidenceId
  || bound?.commitSha !== evidence.commitSha
  || bound?.imageDigest !== evidence.imageDigest
  || bound?.traceCount !== report.traceCount
  || bound?.receiptId !== report.receiptId
  || bound?.reportSha256 !== reportSha256) {
  throw new Error('Enterprise evidence is not fully bound to the observability report.');
}
console.log('Observability admission evidence: PASSED');
