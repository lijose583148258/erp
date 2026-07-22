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
  { name: 'private-use-character', regex: /[\uE000-\uF8FF]/u },
  { name: 'gbk-mojibake-common', regex: /(?:\u951f\u65a4\u62f7|\u951f|\u9416|\u95c3|\u59af|\u9359|\u8930\u6385|\u4e0d\u941e|\u848b\u6d60|\u8364\u568e|\u7459\u5928|\u6748\u6371|\u6d93\u8364|\u6960\u5c96|\u934b|\u935a|\u941c|\u9470|\u9348|\u93c4|\u9201|\u9983|\u760b)/ },
  { name: 'gbk-mojibake-production-label', regex: /(?:\u93cd\u56e7\u566f|\u93b5\u5f52\u567a|\u9357\u66da\u7d85|\u6e1a\u5b2a)/u },
  { name: 'latin1-utf8-mojibake', regex: /(?:\u00c3.|\u00c2.|\u00e2\u20ac[\u0080-\u2122]?)/ },
];

const APPROVED_MOJIBAKE_LITERAL_BLOCKS = new Map([
  [
    'backend/src/database/runtime-data-repair.ts',
    ['const PRODUCTION_MOJIBAKE_REPLACEMENTS', 'const PRODUCTION_TEXT_REPAIR_TARGETS'],
  ],
]);

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

function isApprovedRepairLiteral(relativePath, text, index) {
  const boundaries = APPROVED_MOJIBAKE_LITERAL_BLOCKS.get(relativePath);
  if (!boundaries) return false;
  const start = text.indexOf(boundaries[0]);
  const end = text.indexOf(boundaries[1], start + boundaries[0].length);
  return start !== -1 && end !== -1 && index >= start && index < end;
}

function scanText(relativePath, text) {
  const findings = [];
  for (const pattern of MOJIBAKE_PATTERNS) {
    const flags = pattern.regex.flags.includes('g') ? pattern.regex.flags : `${pattern.regex.flags}g`;
    const matcher = new RegExp(pattern.regex.source, flags);
    for (const match of text.matchAll(matcher)) {
      if (isApprovedRepairLiteral(relativePath, text, match.index)) continue;
      findings.push({
        file: relativePath,
        line: lineOf(text, match.index),
        pattern: pattern.name,
        sample: match[0].slice(0, 80),
      });
    }
  }
  return findings;
}

function assertDetectorContract() {
  const corrupted = [
    'label="\u93cd\u56e7\u566f\u93b5\u5f52\u567a"',
    'placeholder="\u6e1a\u5b2a\ue6e7 1000"',
    'label="\u93b5\u5f52\u567a\u9357\u66da\u7d85"',
  ];
  for (const fixture of corrupted) {
    if (scanText('pages/fixture.tsx', fixture).length === 0) {
      throw new Error(`Mojibake detector contract missed fixture: ${fixture}`);
    }
  }
  if (scanText('pages/fixture.tsx', 'label="标准批量" placeholder="例如 1000"').length) {
    throw new Error('Mojibake detector contract rejected valid Chinese UI copy.');
  }
  const approvedRepair = [
    'const PRODUCTION_MOJIBAKE_REPLACEMENTS = [',
    "  ['\u6e1a\u5b2a\ue6e7', '例如'],",
    '];',
    'const PRODUCTION_TEXT_REPAIR_TARGETS = [];',
  ].join('\n');
  if (scanText('backend/src/database/runtime-data-repair.ts', approvedRepair).length) {
    throw new Error('Mojibake detector rejected the governed runtime repair literal block.');
  }
  const leakedRepair = `${approvedRepair}\nconst leaked = '\u6e1a\u5b2a\ue6e7';`;
  if (scanText('backend/src/database/runtime-data-repair.ts', leakedRepair).length === 0) {
    throw new Error('Mojibake detector exemption leaked beyond the governed repair literal block.');
  }
}

function main() {
  assertDetectorContract();
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
    findings.push(...scanText(rel(file), text));
  }

  const result = {
    status: findings.length === 0 ? 'passed' : 'failed',
    scannedFiles: files.length,
    detectorFixtures: 3,
    findings,
  };

  console.log(JSON.stringify(result, null, 2));
  if (findings.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { scanText };
