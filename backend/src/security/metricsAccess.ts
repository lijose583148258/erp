import crypto from 'crypto';
import fs from 'fs';

const getBearerToken = (authorization: string | undefined) => {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
};

export const hasValidMetricsBearerToken = (authorization: string | undefined) => {
  const configured = String(process.env.AILAODA_METRICS_BEARER_TOKEN || '').trim();
  const secretFile = String(process.env.AILAODA_METRICS_BEARER_TOKEN_FILE || '').trim();
  let expected = configured;
  if (!expected && secretFile) {
    try {
      expected = fs.readFileSync(secretFile, 'utf8').trim();
    } catch {
      expected = '';
    }
  }
  const received = getBearerToken(authorization);
  if (!expected || !received) return false;

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(received, 'utf8');
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};
