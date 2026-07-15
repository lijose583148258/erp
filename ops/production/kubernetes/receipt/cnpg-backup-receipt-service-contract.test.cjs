const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const service = path.join(__dirname, 'cnpg-backup-receipt-service.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-cnpg-receipt-contract-'));
const receipts = path.join(root, 'receipts');
const publicKeyFile = path.join(root, 'public.pem');
const tokenFile = path.join(root, 'token');
const stdoutFile = path.join(root, 'stdout.log');
const stderrFile = path.join(root, 'stderr.log');
fs.mkdirSync(receipts, { mode: 0o700 });
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(publicKeyFile, publicKey.export({ type: 'spki', format: 'pem' }));
const publicKeySha256 = crypto.createHash('sha256').update(fs.readFileSync(publicKeyFile)).digest('hex');
const token = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(tokenFile, token, { mode: 0o440 });
fs.chmodSync(tokenFile, 0o440);

const namespace = 'pilot';
const backupId = 'ailaoda-backup-contract';
const issuer = 'provider-backup-control-plane';
const receiptFile = path.join(receipts, `${namespace}--${backupId}.json`);
const sign = overrides => {
  const now = Date.now();
  const payload = {
    namespace,
    backupId,
    cluster: 'pilot-db',
    objectStoreBackupId: 'barman-20260715t020100',
    encrypted: true,
    checksumVerified: true,
    checksumAlgorithm: 'barman-manifest',
    manifestSha256: 'a'.repeat(64),
    completedAt: new Date(now - 20_000).toISOString(),
    recoveryPointAt: new Date(now - 10_000).toISOString(),
    issuedAt: new Date(now - 5_000).toISOString(),
    issuer,
    ...overrides,
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  return {
    schemaVersion: 1,
    payload: payloadBytes.toString('base64url'),
    signature: crypto.sign(null, payloadBytes, privateKey).toString('base64url'),
  };
};
const writeReceipt = envelope => {
  if (fs.existsSync(receiptFile)) fs.chmodSync(receiptFile, 0o600);
  fs.writeFileSync(receiptFile, `${JSON.stringify(envelope)}\n`, { mode: 0o444 });
  fs.chmodSync(receiptFile, 0o444);
};
writeReceipt(sign());

const port = 28000 + Math.floor(Math.random() * 4000);
const stdoutFd = fs.openSync(stdoutFile, 'w');
const stderrFd = fs.openSync(stderrFile, 'w');
const child = spawn(process.execPath, [service], {
  env: {
    ...process.env,
    CNPG_RECEIPT_HOST: '127.0.0.1',
    CNPG_RECEIPT_PORT: String(port),
    CNPG_RECEIPT_DIR: receipts,
    CNPG_RECEIPT_PUBLIC_KEY_FILE: publicKeyFile,
    CNPG_RECEIPT_AUTH_TOKEN_FILE: tokenFile,
    CNPG_RECEIPT_ISSUER: issuer,
    CNPG_RECEIPT_MAX_AGE_HOURS: '1',
  },
  stdio: ['ignore', stdoutFd, stderrFd],
});
const deadline = Date.now() + 5000;
let stdout = '';
while (!stdout.includes('listening') && Date.now() < deadline) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  stdout = fs.readFileSync(stdoutFile, 'utf8');
}
if (!stdout.includes('listening')) {
  child.kill('SIGTERM');
  const startupError = fs.readFileSync(stderrFile, 'utf8');
  throw new Error(`Receipt service did not start: ${startupError}`);
}

const baseUrl = `http://127.0.0.1:${port}`;
const request = (pathname, authorization = `Bearer ${token}`) => fetch(`${baseUrl}${pathname}`, {
  headers: authorization ? { authorization } : {},
  signal: AbortSignal.timeout(3000),
});
(async () => {
  try {
    const health = await request('/health', '');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: 'available',
      verifier: 'ed25519',
      issuer,
      publicKeySha256,
    });

    const unauthorized = await request(`/v1/cnpg/backups/${namespace}/${backupId}`, '');
    assert.equal(unauthorized.status, 401);

    const accepted = await request(`/v1/cnpg/backups/${namespace}/${backupId}`);
    assert.equal(accepted.status, 200);
    const payload = await accepted.json();
    assert.equal(payload.backupId, backupId);
    assert.equal(payload.cluster, 'pilot-db');
    assert.equal(payload.encrypted, true);
    assert.equal(payload.checksumVerified, true);
    assert.equal(payload.manifestSha256, 'a'.repeat(64));

    const envelope = sign();
    const decoded = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8'));
    decoded.encrypted = false;
    envelope.payload = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    writeReceipt(envelope);
    const tampered = await request(`/v1/cnpg/backups/${namespace}/${backupId}`);
    assert.equal(tampered.status, 422);
    assert.equal((await tampered.json()).error, 'receipt_signature_invalid');

    const old = Date.now() - 3_600_000 * 2;
    writeReceipt(sign({
      completedAt: new Date(old - 20_000).toISOString(),
      recoveryPointAt: new Date(old - 10_000).toISOString(),
      issuedAt: new Date(old).toISOString(),
    }));
    const stale = await request(`/v1/cnpg/backups/${namespace}/${backupId}`);
    assert.equal(stale.status, 422);
    assert.equal((await stale.json()).error, 'receipt_timing_invalid');

    writeReceipt(sign());
    const malformed = await request('/v1/cnpg/backups/pilot/%ZZ');
    assert.equal(malformed.status, 400);
    const stillHealthy = await request('/health', '');
    assert.equal(stillHealthy.status, 200);

    const finalStdout = fs.readFileSync(stdoutFile, 'utf8');
    const finalStderr = fs.readFileSync(stderrFile, 'utf8');
    assert(!finalStdout.includes(token));
    assert(!finalStderr.includes(token));
    console.log('Signed CNPG backup receipt service contract: PASSED');
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
