const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const verifier = path.join(__dirname, 'verify-pilot-observation-evidence.cjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-observation-contract-'));
const dailyDir = path.join(tempRoot, 'daily');
fs.mkdirSync(dailyDir, { recursive: true });
const commitSha = 'a'.repeat(40);
const imageDigest = 'sha256:' + 'b'.repeat(64);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

try {
  const continuousPath = path.join(tempRoot, 'continuous.json');
  write(continuousPath, {
    status: 'passed',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T08:00:00Z',
    durationMs: 28_800_000,
    commitSha,
    imageDigest,
    checks: [{ name: 'contract', status: 'passed' }],
    summary: {
      failures: 0,
      p95Ms: 100,
      instanceRequests: { 'https://app-a.example': 100, 'https://app-b.example': 100 },
    },
  });
  const continuousHash = hash(continuousPath);
  const entries = [];
  for (let day = 1; day <= 7; day += 1) {
    const date = '2026-01-' + String(day).padStart(2, '0');
    const checkedAt = date + 'T23:00:00Z';
    const reportFile = date + '.json';
    const dailyPath = path.join(dailyDir, reportFile);
    write(dailyPath, {
      schemaVersion: 1,
      date,
      checkedAt,
      status: 'passed',
      commitSha,
      imageDigest,
      continuousReportSha256: continuousHash,
      alertReviewCompleted: true,
      unreconciledBusinessWrites: 0,
      serviceIncidentsResolved: true,
    });
    entries.push({
      date,
      checkedAt,
      status: 'passed',
      commitSha,
      imageDigest,
      reportFile,
      dailyReportSha256: hash(dailyPath),
      continuousReportSha256: continuousHash,
      alertReviewCompleted: true,
      unreconciledBusinessWrites: 0,
      serviceIncidentsResolved: true,
    });
  }
  const ledgerPath = path.join(tempRoot, 'ledger.json');
  write(ledgerPath, { schemaVersion: 1, environment: 'formal-pilot', entries });
  const evidencePath = path.join(tempRoot, 'evidence.json');
  write(evidencePath, {
    environment: 'formal-pilot',
    commitSha,
    imageDigest,
    observation: {
      continuousHours: 0,
      stagedPilotDays: 0,
      zeroUnreconciledBusinessWrites: false,
      alertReviewCompleted: false,
      machineVerified: false,
      continuousReportSha256: '',
      pilotLedgerSha256: '',
    },
  });
  const outputPath = path.join(tempRoot, 'verdict.json');
  const args = [
    verifier,
    '--continuous-report', continuousPath,
    '--ledger', ledgerPath,
    '--daily-reports-dir', dailyDir,
    '--evidence', evidencePath,
    '--output', outputPath,
    '--bind',
  ];
  execFileSync(process.execPath, args, { stdio: 'pipe' });
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const verdict = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(verdict.status, 'passed');
  assert.equal(evidence.observation.machineVerified, true);
  assert.equal(evidence.observation.continuousHours, 8);
  assert.equal(evidence.observation.stagedPilotDays, 7);
  assert.equal(evidence.observation.continuousReportSha256, continuousHash);
  assert.equal(evidence.observation.pilotLedgerSha256, hash(ledgerPath));

  const tampered = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  tampered.entries[0].dailyReportSha256 = '0'.repeat(64);
  write(ledgerPath, tampered);
  let rejected = false;
  try {
    execFileSync(process.execPath, args.filter(value => value !== '--bind'), { stdio: 'pipe' });
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, 'tampered daily report hash must be rejected');
  console.log('Pilot observation evidence contract: PASSED');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
