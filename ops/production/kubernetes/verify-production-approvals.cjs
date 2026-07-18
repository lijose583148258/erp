const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const roles = ['platformOwner', 'databaseOwner', 'securityOwner', 'businessPilotOwner'];
const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const fail = message => { throw new Error(message); };
const resolvePath = (flag, label, type) => {
  const value = valueFor(flag);
  if (!value) fail(`Missing ${flag}.`);
  const absolute = path.resolve(value);
  if (!fs.existsSync(absolute)) fail(`${label} does not exist.`);
  const stats = fs.statSync(absolute);
  if (type === 'file' ? !stats.isFile() : !stats.isDirectory()) fail(`${label} is not a ${type}.`);
  return fs.realpathSync(absolute);
};
const profilePath = resolvePath('--provider-profile', 'Provider profile', 'file');
const trustDir = resolvePath('--trust-dir', 'Approval trust directory', 'directory');
const receiptsDir = resolvePath('--receipts-dir', 'Approval receipts directory', 'directory');
const evidencePath = resolvePath('--evidence', 'Enterprise evidence', 'file');
const bind = args.includes('--bind');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha256Buffer = value => crypto.createHash('sha256').update(value).digest('hex');
const sha256File = file => sha256Buffer(fs.readFileSync(file));
const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
};
const exactKeys = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} contains missing or unsupported fields.`);
  }
};
const confinedFile = (root, fileName, label) => {
  if (path.basename(fileName) !== fileName || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(fileName)) {
    fail(`${label} filename is invalid.`);
  }
  const candidate = path.resolve(root, fileName);
  if (!candidate.startsWith(`${root}${path.sep}`) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    fail(`${label} file is missing.`);
  }
  const real = fs.realpathSync(candidate);
  if (!real.startsWith(`${root}${path.sep}`)) fail(`${label} resolves outside its directory.`);
  return real;
};

const profile = readJson(profilePath);
const evidence = readJson(evidencePath);
exactKeys(profile.approvals, roles, 'Provider approval trust');
const evidenceCore = structuredClone(evidence);
delete evidenceCore.approvals;
const evidenceCoreSha256 = sha256Buffer(Buffer.from(JSON.stringify(stable(evidenceCore))));
const evidenceObservedMs = Date.parse(String(evidence.observedAt || ''));
if (!Number.isFinite(evidenceObservedMs)) fail('Enterprise evidence observedAt is invalid.');
const now = Date.now();
const receiptSummary = {};
const approvers = new Set();

for (const role of roles) {
  const trust = profile.approvals[role];
  exactKeys(trust, ['issuer', 'publicKeyFile', 'publicKeySha256'], `Approval trust ${role}`);
  const issuer = String(trust.issuer || '').trim();
  if (issuer.length < 3 || /replace|example|changeme/i.test(issuer)) fail(`Approval issuer is invalid: ${role}.`);
  if (!/^[0-9a-f]{64}$/.test(String(trust.publicKeySha256 || ''))) fail(`Approval public key hash is invalid: ${role}.`);
  const publicKeyPath = confinedFile(trustDir, String(trust.publicKeyFile || ''), `Approval public key ${role}`);
  if (sha256File(publicKeyPath) !== trust.publicKeySha256) fail(`Approval public key hash mismatch: ${role}.`);
  let publicKey;
  try { publicKey = crypto.createPublicKey(fs.readFileSync(publicKeyPath)); } catch { fail(`Approval public key is invalid: ${role}.`); }
  if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') fail(`Approval public key must be Ed25519: ${role}.`);

  const receiptPath = confinedFile(receiptsDir, `${role}.json`, `Approval receipt ${role}`);
  const receipt = readJson(receiptPath);
  exactKeys(receipt, ['payload', 'signature'], `Approval receipt ${role}`);
  exactKeys(receipt.payload, [
    'schemaVersion', 'role', 'issuer', 'approver', 'approvedAt', 'environment',
    'evidenceId', 'commitSha', 'imageDigest', 'evidenceCoreSha256', 'decision',
  ], `Approval payload ${role}`);
  const payload = receipt.payload;
  const approvedMs = Date.parse(String(payload.approvedAt || ''));
  if (payload.schemaVersion !== 1 || payload.role !== role || payload.issuer !== issuer
    || payload.environment !== evidence.environment || payload.evidenceId !== evidence.evidenceId
    || payload.commitSha !== evidence.commitSha || payload.imageDigest !== evidence.imageDigest
    || payload.evidenceCoreSha256 !== evidenceCoreSha256 || payload.decision !== 'approved'
    || !Number.isFinite(approvedMs) || approvedMs < evidenceObservedMs || approvedMs > now + 300_000
    || now - approvedMs > 8 * 86_400_000) {
    fail(`Approval payload does not match current evidence: ${role}.`);
  }
  const approver = String(payload.approver || '').trim();
  if (approver.length < 3 || /replace|example|changeme/i.test(approver) || approvers.has(approver)) {
    fail(`Approval identity is missing, placeholder, or duplicated: ${role}.`);
  }
  approvers.add(approver);
  let signature;
  try { signature = Buffer.from(String(receipt.signature || ''), 'base64'); } catch { fail(`Approval signature encoding is invalid: ${role}.`); }
  if (signature.length !== 64 || !crypto.verify(null, Buffer.from(JSON.stringify(stable(payload))), publicKey, signature)) {
    fail(`Approval signature verification failed: ${role}.`);
  }
  receiptSummary[role] = {
    issuer,
    approver,
    approvedAt: new Date(approvedMs).toISOString(),
    receiptSha256: sha256File(receiptPath),
  };
}

if (bind) {
  evidence.approvals = {
    status: 'passed',
    evidenceCoreSha256,
    verifiedAt: new Date().toISOString(),
    receipts: receiptSummary,
  };
  const temporary = `${evidencePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, evidencePath);
} else {
  exactKeys(evidence.approvals, ['status', 'evidenceCoreSha256', 'verifiedAt', 'receipts'], 'Bound approvals');
  exactKeys(evidence.approvals.receipts, roles, 'Bound approval receipts');
  if (evidence.approvals.status !== 'passed' || evidence.approvals.evidenceCoreSha256 !== evidenceCoreSha256
    || !Number.isFinite(Date.parse(String(evidence.approvals.verifiedAt || '')))
    || JSON.stringify(stable(evidence.approvals.receipts)) !== JSON.stringify(stable(receiptSummary))) {
    fail('Enterprise evidence is not bound to the verified approval receipts.');
  }
}

process.stdout.write(`${JSON.stringify({
  status: 'passed',
  evidenceCoreSha256,
  approvalCount: roles.length,
  approvers: [...approvers],
})}\n`);
