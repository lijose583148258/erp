import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';

let envLoaded = false;

const candidateEnvFiles = [
  path.resolve(process.cwd(), 'backend', '.env.local'),
  path.resolve(process.cwd(), 'backend', '.env.production'),
  path.resolve(process.cwd(), 'backend', '.env'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env.production'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
];

const backendRoot = path.resolve(__dirname, '../..');
const projectRoot = path.resolve(backendRoot, '..');

const loadEnvFile = (filePath: string) => {
  if (!fs.existsSync(filePath)) return;
  dotenv.config({ path: filePath, override: false });
};

export const loadRuntimeEnv = () => {
  if (envLoaded) return;
  candidateEnvFiles.forEach(loadEnvFile);
  envLoaded = true;
};

loadRuntimeEnv();

const parseList = (value?: string) =>
  (value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

const expandWindowsEnvVars = (value: string) =>
  value.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] || '');

const sanitizeEnvPathValue = (value: string) =>
  value
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '');

const resolveProjectRuntimePath = (value: string) => {
  const cleaned = sanitizeEnvPathValue(expandWindowsEnvVars(value));
  if (!cleaned) return projectRoot;
  return path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(projectRoot, cleaned);
};

const defaultRuntimeDbCandidates = [
  path.join('D:\\', 'AilaoDaRuntime', 'stable.db'),
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'AilaoDaRuntime', 'stable.db') : '',
  path.join(os.tmpdir(), 'AilaoDaRuntime', 'stable.db'),
  path.join(projectRoot, 'runtime-data', 'stable.db'),
].filter(Boolean) as string[];

const ensureWritableDir = (dirPath: string) => {
  fs.mkdirSync(dirPath, { recursive: true });
  fs.accessSync(dirPath, fs.constants.W_OK);
};

const isTruthy = (value?: string) =>
  ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const normalizeDeploymentMode = (value?: string) => {
  const mode = String(value || 'local').trim().toLowerCase();
  if (mode === 'local' || mode === 'private' || mode === 'saas') return mode;
  throw new Error(`Invalid AILAODA_DEPLOYMENT_MODE '${value}'. Use local, private, or saas.`);
};

const detectDatabaseEngine = (value?: string) => {
  const raw = sanitizeEnvPathValue(value || '');
  if (!raw || raw.toLowerCase().startsWith('file:')) return 'sqlite';
  if (/^postgres(?:ql)?:\/\//i.test(raw)) return 'postgresql';
  return 'unknown';
};

const isForbiddenSqliteRuntimeDbPath = (candidatePath: string) => {
  const normalized = path.resolve(candidatePath).replace(/\\/g, '/').toLowerCase();
  const prismaRoot = path.join(backendRoot, 'prisma').replace(/\\/g, '/').toLowerCase();
  return normalized.startsWith(`${prismaRoot}/`);
};

const resolveSqliteDbPath = () => {
  const raw = sanitizeEnvPathValue(process.env.DATABASE_URL || '');
  if (raw && !raw.toLowerCase().startsWith('file:')) return null;

  const configuredFilePath = raw
    ? sanitizeEnvPathValue(expandWindowsEnvVars(raw.replace(/^file:/i, '')))
    : '';

  const runtimeDbCandidates = [
    sanitizeEnvPathValue(process.env.AILAODA_RUNTIME_DB_PATH || ''),
    configuredFilePath,
    ...defaultRuntimeDbCandidates,
  ].filter(Boolean) as string[];

  for (const dbPath of runtimeDbCandidates) {
    const candidatePath = path.isAbsolute(dbPath) ? dbPath : path.resolve(backendRoot, dbPath);
    try {
      if (isForbiddenSqliteRuntimeDbPath(candidatePath) && !isTruthy(process.env.AILAODA_ALLOW_LEGACY_PRISMA_DB)) {
        continue;
      }
      ensureWritableDir(path.dirname(candidatePath));
      return candidatePath;
    } catch {
      continue;
    }
  }

  return null;
};

export const runtime = {
  backendRoot,
  projectRoot,
  nodeEnv: process.env.NODE_ENV || 'development',
  deploymentMode: normalizeDeploymentMode(process.env.AILAODA_DEPLOYMENT_MODE),
  databaseEngine: detectDatabaseEngine(process.env.DATABASE_URL),
  port: Number(process.env.PORT || 5001),
  corsOrigins: parseList(process.env.CORS_ORIGIN),
  backupDir: resolveProjectRuntimePath(process.env.BACKUP_DIR || 'backups'),
  logDir: resolveProjectRuntimePath(process.env.LOG_DIR || 'logs'),
  uploadDir: resolveProjectRuntimePath(process.env.UPLOAD_DIR || 'runtime-uploads'),
  frontendDistDir: resolveProjectRuntimePath(process.env.FRONTEND_DIST_DIR || 'dist'),
  serveFrontend: String(process.env.SERVE_FRONTEND ?? 'true').toLowerCase() !== 'false',
  trustProxy: String(process.env.TRUST_PROXY ?? 'false').toLowerCase() !== 'false',
  sqliteDbPath: resolveSqliteDbPath(),
};

export const assertRuntimeDeploymentPolicy = () => {
  if (runtime.nodeEnv !== 'production') return;

  if (runtime.deploymentMode === 'saas' && runtime.databaseEngine !== 'postgresql') {
    throw new Error('SaaS deployment requires PostgreSQL DATABASE_URL. Refusing to start with SQLite.');
  }

  if (runtime.databaseEngine === 'postgresql') {
    throw new Error('PostgreSQL DATABASE_URL is configured, but this runtime package is built with the SQLite Prisma provider. Build a PostgreSQL-specific server artifact before SaaS deployment.');
  }
};

export const getAllowedOrigins = () => {
  const runtimeOrigins = [
    `http://127.0.0.1:${runtime.port}`,
    `http://localhost:${runtime.port}`,
  ];
  const devOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];
  const allowDevOrigins = runtime.nodeEnv !== 'production'
    || ['1', 'true', 'yes'].includes(String(process.env.AILAODA_ALLOW_DEV_ORIGINS || '').toLowerCase());

  return Array.from(new Set([
    ...runtimeOrigins,
    ...runtime.corsOrigins,
    ...(allowDevOrigins ? devOrigins : []),
  ]));
};

export const getBackupDir = () => runtime.backupDir;
export const getSqliteDbPath = () => runtime.sqliteDbPath;
export const getFrontendDistDir = () => runtime.frontendDistDir;
export const getUploadDir = () => runtime.uploadDir;
