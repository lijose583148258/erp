const REDACTED_LOG_VALUE = '[REDACTED]';
const TRUNCATED_LOG_VALUE = '[TRUNCATED]';
const MAX_LOG_DEPTH = 4;
const MAX_LOG_ARRAY_ITEMS = 50;
const MAX_LOG_OBJECT_KEYS = 50;
const MAX_LOG_STRING_LENGTH = 4_000;
const MAX_LOG_METADATA_LENGTH = 16_000;

const sensitiveLogKeys = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'cookies',
  'setcookie',
  'password',
  'oldpassword',
  'newpassword',
  'currentpassword',
  'mfacode',
  'otp',
  'totp',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'clientsecret',
  'jwtsecret',
  'privatekey',
  'credential',
  'credentials',
  'session',
  'sessionid',
  'csrftoken',
  'signature',
  'passphrase',
  'recoverycode',
  'backupcode',
  'secretaccesskey',
  'dataurl',
]);

function normalizeLogKey(key: string) {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isSensitiveLogKey(key: string) {
  const normalized = normalizeLogKey(key);
  return sensitiveLogKeys.has(normalized)
    || normalized.endsWith('password')
    || normalized.endsWith('secret')
    || normalized.endsWith('token')
    || normalized.endsWith('apikey')
    || normalized.endsWith('privatekey');
}

export function redactLogText(value: string) {
  const redacted = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED_LOG_VALUE}`)
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:/\s]+:)[^@\s/]+@/gi, `$1${REDACTED_LOG_VALUE}@`)
    .replace(
      /(["']?(?:authorization|cookie|password|oldPassword|newPassword|currentPassword|mfaCode|otp|totp|token|accessToken|refreshToken|apiKey|secret|clientSecret|jwtSecret|privateKey|credential|sessionId|csrfToken|signature|passphrase|recoveryCode|backupCode|secretAccessKey|dataUrl)["']?\s*[:=]\s*["']?)([^"',\s}&]+)/gi,
      `$1${REDACTED_LOG_VALUE}`,
    );

  return redacted.length > MAX_LOG_STRING_LENGTH
    ? `${redacted.slice(0, MAX_LOG_STRING_LENGTH)}${TRUNCATED_LOG_VALUE}`
    : redacted;
}

export function sanitizeLogValue(
  value: unknown,
  key = '',
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (isSensitiveLogKey(key)) return REDACTED_LOG_VALUE;
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') return redactLogText(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return value.toString();

  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactLogText(value.message),
      stack: value.stack ? redactLogText(value.stack) : undefined,
    };
  }

  if (typeof value !== 'object') return redactLogText(String(value));
  if (depth >= MAX_LOG_DEPTH) return TRUNCATED_LOG_VALUE;
  if (seen.has(value)) return '[CIRCULAR]';

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const sanitized = value
        .slice(0, MAX_LOG_ARRAY_ITEMS)
        .map(item => sanitizeLogValue(item, '', depth + 1, seen));
      if (value.length > MAX_LOG_ARRAY_ITEMS) sanitized.push(TRUNCATED_LOG_VALUE);
      return sanitized;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    const sanitized: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of entries.slice(0, MAX_LOG_OBJECT_KEYS)) {
      sanitized[entryKey] = sanitizeLogValue(entryValue, entryKey, depth + 1, seen);
    }
    if (entries.length > MAX_LOG_OBJECT_KEYS) sanitized.__truncated__ = TRUNCATED_LOG_VALUE;
    return sanitized;
  } finally {
    seen.delete(value);
  }
}

export function formatLogEntry(info: Record<string, unknown>) {
  const {
    level = 'info',
    message = '',
    timestamp: logTimestamp = '',
    stack,
    ...metadata
  } = info;
  const primary = redactLogText(String(stack || message));
  let metadataText = '';
  try {
    const safeMetadata = sanitizeLogValue(metadata) as Record<string, unknown>;
    if (Object.keys(safeMetadata).length > 0) {
      const serialized = JSON.stringify(safeMetadata);
      metadataText = serialized.length <= MAX_LOG_METADATA_LENGTH
        ? ` ${serialized}`
        : ` ${JSON.stringify({
          logMetadataPreview: serialized.slice(0, MAX_LOG_METADATA_LENGTH),
          logMetadataTruncated: true,
        })}`;
    }
  } catch {
    metadataText = ` ${JSON.stringify({ logMetadata: '[UNSERIALIZABLE]' })}`;
  }
  return `${logTimestamp} [${level}]: ${primary}${metadataText}`;
}
