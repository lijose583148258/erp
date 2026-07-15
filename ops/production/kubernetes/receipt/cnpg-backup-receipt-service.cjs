#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const host = String(process.env.CNPG_RECEIPT_HOST || '0.0.0.0').trim();
const port = Number(process.env.CNPG_RECEIPT_PORT || 8080);
const receiptDir = path.resolve(String(process.env.CNPG_RECEIPT_DIR || ''));
const publicKeyFile = path.resolve(String(process.env.CNPG_RECEIPT_PUBLIC_KEY_FILE || ''));
const authTokenFile = path.resolve(String(process.env.CNPG_RECEIPT_AUTH_TOKEN_FILE || ''));
const issuer = String(process.env.CNPG_RECEIPT_ISSUER || '').trim();
const maxAgeHours = Math.max(1, Number(process.env.CNPG_RECEIPT_MAX_AGE_HOURS || 24));
const maxClockSkewSeconds = Math.max(1, Number(process.env.CNPG_RECEIPT_MAX_CLOCK_SKEW_SECONDS || 300));

const fail = message => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
const fileExists = file => Boolean(file) && fs.existsSync(file) && fs.statSync(file).isFile();
const privateFile = file => process.platform === 'win32' || (fs.statSync(file).mode & 0o077) === 0;
const safeName = value => /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(value);
const exactKeys = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
if (!host || !Number.isInteger(port) || port < 1 || port > 65535) fail('Receipt host or port is invalid.');
if (!receiptDir || !fs.existsSync(receiptDir) || !fs.statSync(receiptDir).isDirectory()) fail('CNPG_RECEIPT_DIR is missing.');
if (!fileExists(publicKeyFile)) fail('CNPG receipt public key file is missing.');
if (!fileExists(authTokenFile) || !privateFile(authTokenFile)) {
  fail('CNPG receipt authentication token file is missing or not private.');
}
if (!issuer || issuer.length > 128) fail('CNPG_RECEIPT_ISSUER is required.');
const authToken = fs.readFileSync(authTokenFile, 'utf8').trim();
if (authToken.length < 32) fail('CNPG receipt authentication token must contain at least 32 characters.');
let publicKey;
try { publicKey = crypto.createPublicKey(fs.readFileSync(publicKeyFile)); }
catch { fail('CNPG receipt public key is invalid.'); }
if (publicKey.asymmetricKeyType !== 'ed25519') fail('CNPG receipt public key must be Ed25519.');

const constantTimeEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const send = (response, status, body) => {
  const bytes = Buffer.from(`${JSON.stringify(body)}\n`);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': bytes.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(bytes);
};
const receiptPath = (namespace, backupId) => path.join(receiptDir, `${namespace}--${backupId}.json`);
const loadReceipt = (namespace, backupId) => {
  const target = receiptPath(namespace, backupId);
  if (!fileExists(target)) return { status: 404, error: 'receipt_not_found' };
  if (process.platform !== 'win32' && (fs.statSync(target).mode & 0o022) !== 0) {
    return { status: 422, error: 'receipt_file_is_writable' };
  }
  let envelope;
  try { envelope = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return { status: 422, error: 'receipt_envelope_invalid' }; }
  if (!exactKeys(envelope, ['schemaVersion', 'payload', 'signature']) || envelope.schemaVersion !== 1
    || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') {
    return { status: 422, error: 'receipt_envelope_invalid' };
  }
  let payloadBytes;
  let signature;
  let payload;
  try {
    payloadBytes = Buffer.from(envelope.payload, 'base64url');
    signature = Buffer.from(envelope.signature, 'base64url');
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    return { status: 422, error: 'receipt_encoding_invalid' };
  }
  if (!crypto.verify(null, payloadBytes, publicKey, signature)) {
    return { status: 422, error: 'receipt_signature_invalid' };
  }
  const required = [
    'namespace', 'backupId', 'cluster', 'objectStoreBackupId', 'encrypted',
    'checksumVerified', 'checksumAlgorithm', 'manifestSha256',
    'completedAt', 'recoveryPointAt', 'issuedAt', 'issuer',
  ];
  if (!exactKeys(payload, required)
    || payload.namespace !== namespace || payload.backupId !== backupId
    || !safeName(payload.cluster) || !String(payload.objectStoreBackupId || '').trim()
    || payload.issuer !== issuer || payload.encrypted !== true || payload.checksumVerified !== true
    || !['sha256', 'barman-manifest'].includes(payload.checksumAlgorithm)
    || !/^[0-9a-f]{64}$/.test(String(payload.manifestSha256 || ''))) {
    return { status: 422, error: 'receipt_claims_invalid' };
  }
  const completedAt = Date.parse(String(payload.completedAt || ''));
  const recoveryPointAt = Date.parse(String(payload.recoveryPointAt || ''));
  const issuedAt = Date.parse(String(payload.issuedAt || ''));
  const now = Date.now();
  const skewMs = maxClockSkewSeconds * 1000;
  if (![completedAt, recoveryPointAt, issuedAt].every(Number.isFinite)
    || recoveryPointAt < completedAt || issuedAt < completedAt
    || issuedAt > now + skewMs || now - issuedAt > maxAgeHours * 3_600_000) {
    return { status: 422, error: 'receipt_timing_invalid' };
  }
  return { status: 200, payload };
};

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    send(response, 200, { status: 'available', verifier: 'ed25519' });
    return;
  }
  const authorization = String(request.headers.authorization || '');
  if (!authorization.startsWith('Bearer ')
    || !constantTimeEqual(authorization.slice(7), authToken)) {
    send(response, 401, { error: 'unauthorized' });
    return;
  }
  let pathname;
  try { pathname = new URL(request.url, 'http://receipt.invalid').pathname; }
  catch { send(response, 400, { error: 'invalid_path' }); return; }
  const match = pathname.match(/^\/v1\/cnpg\/backups\/([^/]+)\/([^/]+)$/);
  if (request.method !== 'GET' || !match) {
    send(response, 404, { error: 'not_found' });
    return;
  }
  const namespace = decodeURIComponent(match[1]);
  const backupId = decodeURIComponent(match[2]);
  if (!safeName(namespace) || !safeName(backupId)) {
    send(response, 400, { error: 'invalid_identity' });
    return;
  }
  const result = loadReceipt(namespace, backupId);
  send(response, result.status, result.payload || { error: result.error });
});
server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
server.listen(port, host, () => {
  process.stdout.write(`CNPG backup receipt verifier listening on ${host}:${port}\n`);
});
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
