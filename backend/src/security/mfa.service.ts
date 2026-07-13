import crypto from 'crypto';

export type MfaDecision =
  | { required: false; reason: 'not_configured' | 'role_not_required' }
  | { required: true; ok: true }
  | { required: true; ok: false; reason: 'missing_code' | 'invalid_code' | 'missing_secret' };

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

const parseList = (value?: string) =>
  String(value || '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);

export const getMfaRequiredRoles = () => parseList(process.env.AILAODA_MFA_REQUIRED_ROLES);

const decodeBase32 = (value: string) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = value.replace(/[\s=-]/g, '').toUpperCase();
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;

  let bits = '';
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) return null;
    bits += index.toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
};

const decodeSecret = (secret: string) => decodeBase32(secret) || Buffer.from(secret, 'utf8');

export const generateTotpCode = (secret: string, timestampMs = Date.now()) => {
  const counter = Math.floor(timestampMs / 1000 / TOTP_STEP_SECONDS);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', decodeSecret(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
};

export const verifyTotpCode = (secret: string, code: string, timestampMs = Date.now(), windowSteps = 1) => {
  const normalizedCode = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalizedCode)) return false;

  for (let step = -windowSteps; step <= windowSteps; step += 1) {
    const candidate = generateTotpCode(secret, timestampMs + step * TOTP_STEP_SECONDS * 1000);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(normalizedCode))) return true;
  }
  return false;
};

export const evaluateLoginMfa = (role: string, code?: string): MfaDecision => {
  const requiredRoles = getMfaRequiredRoles();
  if (requiredRoles.length === 0) return { required: false, reason: 'not_configured' };
  if (!requiredRoles.includes(String(role || '').toLowerCase())) return { required: false, reason: 'role_not_required' };

  const secret = String(process.env.AILAODA_MFA_TOTP_SECRET || '').trim();
  if (!secret) return { required: true, ok: false, reason: 'missing_secret' };
  if (!code) return { required: true, ok: false, reason: 'missing_code' };
  if (!verifyTotpCode(secret, code)) return { required: true, ok: false, reason: 'invalid_code' };
  return { required: true, ok: true };
};
