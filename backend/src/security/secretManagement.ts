import crypto from 'crypto';

export type ManagedSecretSource = 'env' | 'ephemeral-dev';

export type ManagedSecretStatus = {
  name: string;
  configured: boolean;
  source: ManagedSecretSource | 'missing';
  minLength: number;
  length: number;
  issues: string[];
};

type ResolveSecretOptions = {
  minLength: number;
  requiredInProduction: boolean;
  allowEphemeralDev: boolean;
};

const ephemeralSecrets = new Map<string, string>();

const PLACEHOLDER_PATTERNS = [
  'replace_with',
  'your-secret',
  'your_secret',
  'changeme',
  'change-me',
  'default',
  'password',
  'secret-key-change-in-production',
];

const isProduction = () => process.env.NODE_ENV === 'production';

export const getSecretQualityIssues = (secret: string | undefined, minLength: number) => {
  const value = String(secret || '').trim();
  const normalized = value.toLowerCase();
  const issues: string[] = [];

  if (!value) issues.push('missing');
  if (value && value.length < minLength) issues.push(`shorter_than_${minLength}`);
  if (value && PLACEHOLDER_PATTERNS.some(pattern => normalized.includes(pattern))) {
    issues.push('placeholder');
  }

  return issues;
};

export const resolveManagedSecret = (name: string, options: ResolveSecretOptions) => {
  const configured = String(process.env[name] || '').trim();
  const issues = getSecretQualityIssues(configured, options.minLength);

  if (configured) {
    if (options.requiredInProduction && isProduction() && issues.length > 0) {
      throw new Error(`${name} must be a non-placeholder value of at least ${options.minLength} characters in production`);
    }
    return { value: configured, source: 'env' as const, status: getManagedSecretStatus(name, options) };
  }

  if (options.requiredInProduction && isProduction()) {
    throw new Error(`${name} must be configured in production`);
  }

  if (!options.allowEphemeralDev) {
    throw new Error(`${name} is not configured`);
  }

  if (!ephemeralSecrets.has(name)) {
    ephemeralSecrets.set(name, crypto.randomBytes(48).toString('base64url'));
  }

  return { value: ephemeralSecrets.get(name) as string, source: 'ephemeral-dev' as const, status: getManagedSecretStatus(name, options) };
};

export const getManagedSecretStatus = (name: string, options: Pick<ResolveSecretOptions, 'minLength'>): ManagedSecretStatus => {
  const configured = String(process.env[name] || '').trim();
  const hasEphemeral = ephemeralSecrets.has(name);
  const source: ManagedSecretStatus['source'] = configured ? 'env' : hasEphemeral ? 'ephemeral-dev' : 'missing';
  const valueForStatus = configured || (hasEphemeral ? ephemeralSecrets.get(name) || '' : '');
  return {
    name,
    configured: Boolean(configured),
    source,
    minLength: options.minLength,
    length: valueForStatus.length,
    issues: getSecretQualityIssues(configured, options.minLength),
  };
};

const JWT_SECRET_OPTIONS: ResolveSecretOptions = {
  minLength: 32,
  requiredInProduction: true,
  allowEphemeralDev: true,
};

export const getJwtSecret = () => resolveManagedSecret('JWT_SECRET', JWT_SECRET_OPTIONS).value;
export const getJwtSecretStatus = () => getManagedSecretStatus('JWT_SECRET', JWT_SECRET_OPTIONS);

export const clearEphemeralSecretsForTests = () => {
  ephemeralSecrets.clear();
};
