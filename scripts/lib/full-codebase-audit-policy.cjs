const EXCLUDED_DIRS = new Set([
  '.git',
  '.vite-cache',
  'node_modules',
  'dist',
  'output',
  'logs',
  'backups',
  'uploads',
  '.playwright',
  '.playwright-cli',
  '.playwright-daemon',
]);

const EXCLUDED_DIR_PREFIXES = [
  'AilaoDa_Stable_Package',
];

const ACTIVE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.cjs',
  '.mjs',
  '.json',
  '.prisma',
  '.css',
  '.html',
  '.ps1',
  '.bat',
  '.md',
  '.yml',
  '.yaml',
  '.toml',
  '.env',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.cjs',
  '.mjs',
  '.prisma',
  '.css',
  '.html',
  '.ps1',
  '.bat',
]);

module.exports = {
  ACTIVE_EXTENSIONS,
  EXCLUDED_DIR_PREFIXES,
  EXCLUDED_DIRS,
  SOURCE_EXTENSIONS,
};
