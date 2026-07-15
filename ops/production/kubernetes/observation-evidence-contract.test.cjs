const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const verifier = path.join(__dirname, 'verify-pilot-observation-evidence.cjs');
const observationRunner = path.join(__dirname, 'run-continuous-observation.cjs');
const dailyRecorder = path.join(__dirname, 'record-pilot-daily-review.cjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-observation-contract-'));
const dailyDir = path.join(tempRoot, 'daily');
fs.mkdirSync(dailyDir, { recursive: true });
const commitSha = 'a'.repeat(40);
const imageDigest = 'sha256:' + 'b'.repeat(64);
const collectorImageDigest = 'sha256:' + 'e'.repeat(64);
const aiCollectorHash = hashFile => crypto.createHash('sha256').update(fs.readFileSync(hashFile)).digest('hex');
const aiCollectorSha256 = aiCollectorHash(path.join(__dirname, 'capture-pilot-ai-governance-review.cjs'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

try {
  const continuousPath = path.join(tempRoot, 'continuous.json');
  const firstCheckedMs = Date.now() - 6 * 86_400_000;
  const continuousFinishedMs = firstCheckedMs;
  const continuousStartedMs = continuousFinishedMs - 28_800_000;
  write(continuousPath, {
    status: 'passed',
    environment: 'formal-pilot',
    evidenceId: 'CHG-12345',
    startedAt: new Date(continuousStartedMs).toISOString(),
    finishedAt: new Date(continuousFinishedMs).toISOString(),
    durationMs: 28_800_000,
    commitSha,
    imageDigest,
    collectorImageDigest,
    checks: [{ name: 'contract', status: 'passed' }],
    summary: {
      failures: 0,
      p95Ms: 100,
      readinessSamples: 480,
      readinessSemanticFailures: 0,
      instanceRequests: { 'https://app-a.example': 100, 'https://app-b.example': 100 },
      components: Object.fromEntries([
        'object-storage', 'search-primary', 'search-secondary', 'prometheus', 'tempo', 'alertmanager',
      ].map(name => [name, { url: `https://${name}.example/health`, probes: 480, failures: 0, lastStatus: 200 }])),
    },
  });
  const continuousHash = hash(continuousPath);
  const ledgerPath = path.join(tempRoot, 'ledger.json');
  for (let day = 0; day < 7; day += 1) {
    const checkedAt = new Date(firstCheckedMs + day * 86_400_000).toISOString();
    const date = checkedAt.slice(0, 10);
    const sourceDir = path.join(tempRoot, 'sources', date);
    fs.mkdirSync(sourceDir, { recursive: true });
    const alertPath = path.join(sourceDir, 'alert.json');
    const reconciliationPath = path.join(sourceDir, 'reconciliation.json');
    const incidentPath = path.join(sourceDir, 'incident.json');
    const aiGovernancePath = path.join(sourceDir, 'ai-governance.json');
    write(alertPath, {
      schemaVersion: 1,
      status: 'passed',
      reviewedAt: checkedAt,
      reviewer: 'platform-owner',
      deliveryVerified: true,
      unresolvedCriticalAlerts: 0,
    });
    write(reconciliationPath, {
      schemaVersion: 1,
      status: 'passed',
      checkedAt,
      reviewer: 'finance-owner',
      unreconciledBusinessWrites: 0,
    });
    write(incidentPath, {
      schemaVersion: 1,
      status: 'passed',
      checkedAt,
      reviewer: 'pilot-owner',
      unresolvedIncidents: 0,
    });
    write(aiGovernancePath, {
      schemaVersion: 1,
      status: 'passed',
      checkedAt,
      reviewer: 'ai-governance-owner',
      source: 'runtime-probe',
      collectorImageDigest,
      collectorSha256: aiCollectorSha256,
      instances: ['https://app-a.example', 'https://app-b.example'],
      externalAiEnabled: false,
      paidModelCalls: 0,
      metricsBeforeSha256: 'c'.repeat(64),
      metricsAfterSha256: 'd'.repeat(64),
      governedAiRequests: day === 0 ? 5 : 2,
      budgetBreaches: 0,
      privacyIncidents: 0,
      crossTenantLeaks: 0,
      unresolvedAiIncidents: 0,
      fallbackVerified: true,
    });
    execFileSync(process.execPath, [
      dailyRecorder,
      '--environment', 'formal-pilot',
      '--commit-sha', commitSha,
      '--image-digest', imageDigest,
      '--date', date,
      '--checked-at', checkedAt,
      '--continuous-report', continuousPath,
      '--alert-review', alertPath,
      '--reconciliation', reconciliationPath,
      '--incident-review', incidentPath,
      '--ai-governance-review', aiGovernancePath,
      '--daily-output', path.join(dailyDir, date + '.json'),
      '--ledger', ledgerPath,
    ], { stdio: 'pipe' });
  }
  const evidencePath = path.join(tempRoot, 'evidence.json');
  write(evidencePath, {
    environment: 'formal-pilot',
    evidenceId: 'CHG-12345',
    commitSha,
    imageDigest,
    observation: {
      continuousHours: 0,
      stagedPilotDays: 0,
      zeroUnreconciledBusinessWrites: false,
      alertReviewCompleted: false,
      aiGovernanceReviewCompleted: false,
      governedAiRequests: 0,
      collectorImageDigest: '',
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
  assert.equal(evidence.observation.aiGovernanceReviewCompleted, true);
  assert.equal(evidence.observation.governedAiRequests, 17);
  assert.equal(evidence.observation.collectorImageDigest, collectorImageDigest);
  assert.equal(evidence.observation.continuousReportSha256, continuousHash);
  assert.equal(evidence.observation.pilotLedgerSha256, hash(ledgerPath));

  const continuousOriginal = fs.readFileSync(continuousPath, 'utf8');
  const readinessTampered = JSON.parse(continuousOriginal);
  readinessTampered.summary.readinessSemanticFailures = 1;
  write(continuousPath, readinessTampered);
  let readinessRejected = false;
  try {
    execFileSync(process.execPath, args.filter(value => value !== '--bind'), { stdio: 'pipe' });
  } catch {
    readinessRejected = true;
  }
  assert.equal(readinessRejected, true, 'semantic PostgreSQL/Redis readiness failure must be rejected');
  fs.writeFileSync(continuousPath, continuousOriginal);

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

  const shortRunReport = path.join(tempRoot, 'short-run.json');
  let shortRunRejected = false;
  try {
    execFileSync(process.execPath, [observationRunner], {
      env: {
        ...process.env,
        OBSERVATION_OUTPUT: shortRunReport,
        OBSERVATION_DURATION_MS: '1000',
        OBSERVATION_ENVIRONMENT: 'formal-pilot',
        OBSERVATION_EVIDENCE_ID: 'CHG-12345',
        OBSERVATION_COMMIT_SHA: commitSha,
        OBSERVATION_IMAGE_DIGEST: imageDigest,
        OBSERVATION_COLLECTOR_IMAGE_DIGEST: collectorImageDigest,
      },
      stdio: 'pipe',
    });
  } catch {
    shortRunRejected = true;
  }
  assert.equal(shortRunRejected, true, 'observation shorter than eight hours must be rejected');
  const shortRun = JSON.parse(fs.readFileSync(shortRunReport, 'utf8'));
  assert.equal(shortRun.status, 'failed');
  assert.match(shortRun.error, /between 8 and 24 hours/);
  console.log('Pilot observation evidence contract: PASSED');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
