const path = require('path');

const ACTIVE_ROOTS = new Set([
  'app',
  'backend/src',
  'backend/prisma',
  'components',
  'pages',
  'public',
  'scripts',
  'services',
  'translations',
  'utils',
]);

const ACTIVE_ROOT_FILES = new Set([
  'App.tsx',
  'constants.tsx',
  'eslint.config.mjs',
  'index.css',
  'index.html',
  'index.tsx',
  'package.json',
  'tailwind.config.cjs',
  'translations.ts',
  'tsconfig.json',
  'types.ts',
  'vite.config.ts',
  'Dockerfile',
  'docker-compose.yml',
  'nginx.conf',
  'packaging.bat',
  'postcss.config.cjs',
  '启动系统.bat',
  '停止服务.bat',
  '正式启动.bat',
  '稳定启动.bat',
]);

const IGNORED_TOP_LEVEL_DIRS = new Set([
  '.git',
  '.playwright',
  '.playwright-cli',
  '.playwright-daemon',
  '.vite-cache',
  '.vscode',
  'backups',
  'dist',
  'logs',
  'node_modules',
  'output',
  'uploads',
  '历史归档',
  '文档归档',
  '测试',
]);

const IGNORED_TOP_LEVEL_PREFIXES = [
  'AilaoDa_Stable_Package',
];

const QUARANTINE_DIR_NAMES = new Set([
  'quarantine',
  '99_隔离区',
]);

const SOURCE_EXTENSIONS = new Set([
  '.bat',
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.mjs',
  '.prisma',
  '.ps1',
  '.ts',
  '.tsx',
  '.yml',
  '.yaml',
]);

const OBSOLETE_ACTIVE_PATHS = new Map([
  ['refactor.cjs', 'One-off rewrite script. It can rewrite audit files and must stay quarantined.'],
  ['refactor2.cjs', 'One-off rewrite script. It can rewrite audit files and must stay quarantined.'],
  ['playwright-test.cjs', 'Old browser test with stale selectors and mojibake expectations.'],
  ['playwright-smoke.cjs', 'Old root smoke test replaced by governed scripts/cdp-core-pages-smoke-audit-v1.cjs.'],
  ['scripts/browser-acceptance-audit.cjs', 'Deprecated wrapper for v3. It can mislead people into using old entry names.'],
  ['scripts/browser-acceptance-audit-v2.cjs', 'Deprecated wrapper for v3. It can mislead people into using old entry names.'],
  ['scripts/start-stable.ps1', 'Deprecated launcher wrapper. Current stable entry is scripts/start-stable-v2.ps1.'],
  ['backend/complete-server.js', 'Legacy mock backend. Current backend entry is backend/src/server.ts.'],
  ['backend/simple-server.js', 'Legacy mock backend. Current backend entry is backend/src/server.ts.'],
  ['backend/scripts/fix-db.js', 'Legacy database repair script. Current repair entry is npm run db:manage -- repair.'],
  ['backend/scripts/fix-db.ts', 'Legacy database repair script. Current repair entry is npm run db:manage -- repair.'],
  ['backend/src/controllers/timber.controller.ts', 'Unused legacy timber controller. Current disabled endpoint lives in routes/timber.routes.ts.'],
  ['backend/src/utils/TimberEngine.ts', 'Unused legacy timber calculator. Current barter logic lives in /api/barter.'],
]);

const GOVERNED_LEGACY_COMPATIBILITY_PATHS = new Map([
  ['backend/src/routes/timber.routes.ts', 'Intentional 410 Gone route so old /api/timber calls cannot silently work.'],
  ['pages/TimberWorkspace.tsx', 'Compatibility shell that redirects old timber imports to BarterWorkspaceView.'],
]);

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function normalizeRel(filePath) {
  return toPosix(filePath).replace(/^\.\/+/, '');
}

function isIgnoredTopLevel(relPath) {
  const normalized = normalizeRel(relPath);
  const first = normalized.split('/')[0];
  return IGNORED_TOP_LEVEL_DIRS.has(first)
    || IGNORED_TOP_LEVEL_PREFIXES.some(prefix => first.startsWith(prefix));
}

function hasQuarantineSegment(relPath) {
  return normalizeRel(relPath).split('/').some(segment => QUARANTINE_DIR_NAMES.has(segment));
}

function isSourceLike(relPath) {
  const normalized = normalizeRel(relPath);
  const ext = path.extname(normalized);
  return SOURCE_EXTENSIONS.has(ext) || path.basename(normalized).startsWith('.env');
}

function isActiveRootFile(relPath) {
  return ACTIVE_ROOT_FILES.has(normalizeRel(relPath));
}

function isUnderActiveRoot(relPath) {
  const normalized = normalizeRel(relPath);
  return [...ACTIVE_ROOTS].some(root => normalized === root || normalized.startsWith(`${root}/`));
}

function isActiveSource(relPath) {
  const normalized = normalizeRel(relPath);
  if (!isSourceLike(normalized)) return false;
  if (isIgnoredTopLevel(normalized)) return false;
  if (hasQuarantineSegment(normalized)) return false;
  if (OBSOLETE_ACTIVE_PATHS.has(normalized)) return false;
  return isActiveRootFile(normalized) || isUnderActiveRoot(normalized);
}

module.exports = {
  ACTIVE_ROOT_FILES,
  ACTIVE_ROOTS,
  GOVERNED_LEGACY_COMPATIBILITY_PATHS,
  IGNORED_TOP_LEVEL_DIRS,
  OBSOLETE_ACTIVE_PATHS,
  QUARANTINE_DIR_NAMES,
  hasQuarantineSegment,
  isActiveSource,
  isIgnoredTopLevel,
  isSourceLike,
  normalizeRel,
  toPosix,
};
