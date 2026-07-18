const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const verifier = path.join(__dirname, 'verify-production-approvals.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-approval-contract-'));
const trustDir = path.join(root, 'trust');
const receiptsDir = path.join(root, 'receipts');
fs.mkdirSync(trustDir);
fs.mkdirSync(receiptsDir);
const roles = ['platformOwner', 'databaseOwner', 'securityOwner', 'businessPilotOwner'];
const stable = value => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
    : value;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

try {
  const observedAt = new Date(Date.now() - 60_000).toISOString();
  const evidencePath = path.join(root, 'evidence.json');
  const evidence = {
    schemaVersion: 1,
    environment: 'formal-pilot',
    evidenceId: 'CHG-12345',
    commitSha: 'a'.repeat(40),
    imageDigest: `sha256:${'b'.repeat(64)}`,
    observedAt,
    providerProfile: { status: 'passed', sha256: 'c'.repeat(64) },
    approvals: {},
  };
  write(evidencePath, evidence);
  const evidenceCore = structuredClone(evidence);
  delete evidenceCore.approvals;
  const evidenceCoreSha256 = hash(Buffer.from(JSON.stringify(stable(evidenceCore))));
  const profile = { approvals: {} };

  for (const [index, role] of roles.entries()) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyFile = `${role}.pem`;
    const publicKeyBytes = publicKey.export({ type: 'spki', format: 'pem' });
    fs.writeFileSync(path.join(trustDir, publicKeyFile), publicKeyBytes);
    profile.approvals[role] = {
      issuer: `enterprise-${role}`,
      publicKeyFile,
      publicKeySha256: hash(publicKeyBytes),
    };
    const payload = {
      schemaVersion: 1,
      role,
      issuer: profile.approvals[role].issuer,
      approver: `approver-${index + 1}`,
      approvedAt: new Date().toISOString(),
      environment: evidence.environment,
      evidenceId: evidence.evidenceId,
      commitSha: evidence.commitSha,
      imageDigest: evidence.imageDigest,
      evidenceCoreSha256,
      decision: 'approved',
    };
    const signature = crypto.sign(null, Buffer.from(JSON.stringify(stable(payload))), privateKey).toString('base64');
    write(path.join(receiptsDir, `${role}.json`), { payload, signature });
  }
  const profilePath = path.join(root, 'profile.json');
  write(profilePath, profile);
  const baseArgs = [
    verifier,
    '--provider-profile', profilePath,
    '--trust-dir', trustDir,
    '--receipts-dir', receiptsDir,
    '--evidence', evidencePath,
  ];
  const bind = spawnSync(process.execPath, [...baseArgs, '--bind'], { encoding: 'utf8' });
  assert.equal(bind.status, 0, bind.stderr);
  const bound = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.equal(bound.approvals.status, 'passed');
  assert.equal(Object.keys(bound.approvals.receipts).length, 4);
  assert.equal(spawnSync(process.execPath, baseArgs, { encoding: 'utf8' }).status, 0);

  const receiptPath = path.join(receiptsDir, 'securityOwner.json');
  const originalReceipt = fs.readFileSync(receiptPath, 'utf8');
  const tampered = JSON.parse(originalReceipt);
  tampered.payload.decision = 'approved-without-review';
  write(receiptPath, tampered);
  assert.notEqual(spawnSync(process.execPath, baseArgs, { encoding: 'utf8' }).status, 0, 'tampered approval must be rejected');
  fs.writeFileSync(receiptPath, originalReceipt);

  const modifiedEvidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  modifiedEvidence.postApprovalMutation = true;
  write(evidencePath, modifiedEvidence);
  assert.notEqual(spawnSync(process.execPath, baseArgs, { encoding: 'utf8' }).status, 0, 'post-approval evidence mutation must be rejected');
  console.log('Production approval contract: PASSED');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
