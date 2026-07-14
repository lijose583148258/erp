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
  if (!value) throw new Error(`Missing ${flag}.`);
  const absolute = path.resolve(value);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`${label} file does not exist.`);
  return absolute;
};
const reportPath = resolveFile('--report', 'Backup report');
const evidencePath = resolveFile('--evidence', 'Enterprise evidence');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8').replace(/^\uFEFF/, ''));
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8').replace(/^\uFEFF/, ''));
const reportHash = crypto.createHash('sha256').update(fs.readFileSync(reportPath)).digest('hex');
const finishedMs = Date.parse(String(report.finishedAt || ''));
if (report.status !== 'passed') throw new Error('Backup restore report is not passed.');
if (!Number.isFinite(finishedMs) || finishedMs > Date.now() + 300_000 || Date.now() - finishedMs > 7 * 86_400_000) {
  throw new Error('Backup restore report is stale or has an invalid timestamp.');
}
if (report.environment !== evidence.environment || report.changeTicket !== evidence.evidenceId
  || report.commitSha !== evidence.commitSha || report.imageDigest !== evidence.imageDigest) {
  throw new Error('Backup restore report identity does not match enterprise evidence.');
}
if (report.checksumVerified !== true || report.encrypted !== true || report.markerReadback !== true
  || report.schemaCompatible !== true || report.cleanupVerified !== true) {
  throw new Error('Backup integrity, restore readback, schema, or cleanup evidence is incomplete.');
}
if (!Number.isFinite(Number(report.restoreRtoSeconds)) || Number(report.restoreRtoSeconds) <= 0
  || !Number.isFinite(Number(report.markerAgeSeconds)) || Number(report.markerAgeSeconds) < 0) {
  throw new Error('Backup RPO/RTO evidence is invalid.');
}
if (evidence.postgres?.backupRestoreReadback !== true || evidence.backupDrill?.status !== 'passed'
  || evidence.backupDrill?.reportSha256 !== reportHash || evidence.backupDrill?.cleanupVerified !== true) {
  throw new Error('Enterprise evidence is not bound to the backup restore report.');
}
console.log('Backup restore evidence: PASSED');
