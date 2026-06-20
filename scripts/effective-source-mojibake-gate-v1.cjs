/**
 * Effective source mojibake gate for AilaoDa ERP+CRM.
 *
 * This script scans only current effective source areas. Generated output,
 * runtime packages, historical archives, logs, uploads, backups, and
 * quarantined legacy probes are intentionally excluded to avoid report-layer
 * false positives.
 */
const fs = require('fs');
const path = require('path');
const { isActiveSource } = require('./lib/active-source-scope.cjs');

const ROOT = process.cwd();

const SOURCE_ROOTS = [
  'app',
  'backend',
  'components',
  'pages',
  'public',
  'scripts',
  'services',
  'translations',
  'utils',
];

const ROOT_SOURCE_FILES = [
  'App.tsx',
  'constants.tsx',
  'index.css',
  'index.html',
  'index.tsx',
  'package.json',
  'postcss.config.cjs',
  'tailwind.config.cjs',
  'translations.ts',
  'tsconfig.json',
  'types.ts',
  'vite.config.ts',
  'Dockerfile',
  'docker-compose.yml',
  'nginx.conf',
  'packaging.bat',
  '启动系统.bat',
  '稳定启动.bat',
  '正式启动.bat',
  '停止服务.bat',
];

const EXCLUDED_DIR_NAMES = new Set([
  '.git',
  '.vite-cache',
  '.playwright',
  '.playwright-cli',
  '.playwright-daemon',
  'node_modules',
  'dist',
  'output',
  'logs',
  'backups',
  'uploads',
  'quarantine',
  'AilaoDa_Stable_Package',
]);

const EXCLUDED_DIR_PREFIXES = [
  'AilaoDa_Stable_Package_previous_',
];

const EXCLUDED_ABSOLUTE_PARTS = [
  `${path.sep}历史归档${path.sep}`,
  `${path.sep}文档归档${path.sep}`,
  `${path.sep}测试${path.sep}`,
];

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.cjs',
  '.mjs',
  '.css',
  '.html',
  '.ps1',
  '.bat',
  '.md',
  '.json',
  '.prisma',
  '.yml',
  '.yaml',
]);

const MOJIBAKE_PATTERNS = [
  { name: 'replacement-character', regex: /\uFFFD/ },
  { name: 'gbk-mojibake-common', regex: /(?:\u951f\u65a4\u62f7|\u951f|\u9416|\u95c3|\u59af|\u9359|\u8930\u6385|\u4e0d\u941e|\u848b\u6d60|\u8364\u568e|\u7459\u5928|\u6748\u6371|\u6d93\u8364|\u6960\u5c96|\u934b|\u935a|\u941c|\u9470|\u9348|\u93c4|\u9201|\u9983|\u760b)/ },
  { name: 'latin1-utf8-mojibake', regex: /(?:\u00c3.|\u00c2.|\u00e2\u20ac[\u0080-\u2122]?)/ },
];

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function rel(filePath) {
  return toPosix(path.relative(ROOT, filePath));
}

function shouldSkipDir(fullPath, dirName) {
  if (EXCLUDED_DIR_NAMES.has(dirName)) return true;
  if (EXCLUDED_DIR_PREFIXES.some(prefix => dirName.startsWith(prefix))) return true;
  return EXCLUDED_ABSOLUTE_PARTS.some(part => fullPath.includes(part));
}

function walk(dir, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(full, entry.name)) continue;
      walk(full, files);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    if (!isActiveSource(rel(full))) continue;
    files.push(full);
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function main() {
  const files = [];
  for (const sourceRoot of SOURCE_ROOTS) {
    const full = path.join(ROOT, sourceRoot);
    if (fs.existsSync(full)) walk(full, files);
  }
  for (const fileName of ROOT_SOURCE_FILES) {
    const full = path.join(ROOT, fileName);
    if (fs.existsSync(full) && isActiveSource(rel(full))) files.push(full);
  }

  const findings = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of MOJIBAKE_PATTERNS) {
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(text);
      if (!match) continue;
      findings.push({
        file: rel(file),
        line: lineOf(text, match.index),
        pattern: pattern.name,
        sample: match[0].slice(0, 80),
      });
    }
  }

  const result = {
    status: findings.length === 0 ? 'passed' : 'failed',
    scannedFiles: files.length,
    findings,
  };

  console.log(JSON.stringify(result, null, 2));
  if (findings.length > 0) {
    process.exitCode = 1;
  }
}

main();
