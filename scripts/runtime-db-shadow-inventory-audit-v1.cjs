const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  classifyShadowDb,
  isGovernedShadowDb,
  shadowDbGovernanceNote,
} = require('./lib/runtime-db-governance.cjs');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'runtime-db-shadow-inventory-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'runtime-db-shadow-inventory-audit-v1.md');

const DB_FILE_RE = /\.(db|sqlite|sqlite3)(-journal)?$/i;
const IGNORED_DIR_NAMES = new Set([
  '.git',
  '.playwright',
  'node_modules',
  'dist',
  'output',
  'backups',
  '历史归档',
  '文档归档',
]);

function toPosix(filePath) {
  return filePath.replace(/\\/g, '/');
}

function normalize(filePath) {
  return path.resolve(filePath).replace(/\\/g, '/');
}

function rel(filePath) {
  return toPosix(path.relative(ROOT, filePath));
}

function isIgnoredDirectory(entryName) {
  return IGNORED_DIR_NAMES.has(entryName) || /^AilaoDa_Stable_Package/.test(entryName);
}

function resolveRuntimeDbCandidates() {
  return [
    process.env.AILAODA_RUNTIME_DB_PATH,
    path.join('D:\\', 'AilaoDaRuntime', 'stable.db'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'AilaoDaRuntime', 'stable.db') : '',
    process.env.TEMP ? path.join(process.env.TEMP, 'AilaoDaRuntime', 'stable.db') : '',
    path.join(os.tmpdir(), 'AilaoDaRuntime', 'stable.db'),
    path.join(ROOT, 'runtime-data', 'stable.db'),
  ]
    .filter(Boolean)
    .map(normalize);
}

function selectActiveRuntimeDb(candidates) {
  const existing = candidates.find(candidate => fs.existsSync(candidate));
  return existing || candidates[0] || null;
}

function walkDbFiles(dirPath, files = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (isIgnoredDirectory(entry.name)) continue;
      walkDbFiles(fullPath, files);
      continue;
    }
    if (!entry.isFile() || !DB_FILE_RE.test(entry.name)) continue;
    const stat = fs.statSync(fullPath);
    files.push({
      path: normalize(fullPath),
      relativePath: rel(fullPath),
      bytes: stat.size,
      lastWriteTime: stat.mtime.toISOString(),
    });
  }

  return files;
}

function readTextIfExists(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return '';
  return fs.readFileSync(fullPath, 'utf8');
}

function checkStartupReferences(findings) {
  const inspected = [
    'package.json',
    'scripts/start-stable-v2.ps1',
    'backend/src/config/runtime.ts',
    'backend/src/config/database.ts',
    '.env.production.example',
    'backend/.env.example',
  ];
  const forbiddenPatterns = [
    {
      pattern: /DATABASE_URL\s*=\s*file:(?:\.\/)?(?:backend\/)?prisma\/(?:dev|main|fresh|recovered)\.db/i,
      message: 'DATABASE_URL must not point to backend/prisma historical SQLite files',
    },
    {
      pattern: /set\s+["']?DATABASE_URL=.*backend[\\/]+prisma[\\/]+(?:dev|main|fresh|recovered)\.db/i,
      message: 'launcher must not set DATABASE_URL to backend/prisma historical SQLite files',
    },
  ];

  for (const relativePath of inspected) {
    const text = readTextIfExists(relativePath).replace(/\\/g, '/');
    if (!text) continue;
    for (const rule of forbiddenPatterns) {
      if (rule.pattern.test(text)) {
        findings.push({
          level: 'P0',
          area: 'startup-reference',
          file: relativePath,
          message: rule.message,
        });
      }
    }
  }
}

function writeReports(report) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const md = [];
  md.push('# Runtime DB Shadow Inventory Audit v1');
  md.push('');
  md.push(`- status: ${report.status}`);
  md.push(`- generated: ${report.generatedAt}`);
  md.push(`- active runtime db: ${report.activeRuntimeDb || 'not resolved'}`);
  md.push(`- shadow db files: ${report.summary.shadowDbFiles}`);
  md.push(`- governed shadow db files: ${report.summary.governedShadowDbFiles}`);
  md.push(`- unresolved shadow db files: ${report.summary.unresolvedShadowDbFiles}`);
  md.push(`- P0 findings: ${report.summary.p0Findings}`);
  md.push(`- P2 findings: ${report.summary.p2Findings}`);
  md.push('');
  md.push('## Findings');
  if (report.findings.length === 0) md.push('- none');
  for (const finding of report.findings) {
    md.push(`- ${finding.level} ${finding.area}${finding.file ? ` ${finding.file}` : ''}: ${finding.message}`);
  }
  md.push('');
  md.push('## Shadow Databases');
  if (report.shadowDatabases.length === 0) md.push('- none');
  for (const item of report.shadowDatabases) {
    md.push(`- ${item.relativePath} | ${item.classification} | ${item.bytes} bytes`);
  }
  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');
}

function main() {
  const runtimeCandidates = resolveRuntimeDbCandidates();
  const activeRuntimeDb = selectActiveRuntimeDb(runtimeCandidates);
  const activeRuntimeDbInRoot = activeRuntimeDb && activeRuntimeDb.startsWith(normalize(ROOT) + '/');
  const repoDbFiles = walkDbFiles(ROOT).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const findings = [];

  if (!activeRuntimeDb) {
    findings.push({
      level: 'P0',
      area: 'runtime-path',
      message: 'No runtime database candidate could be resolved',
    });
  } else if (!fs.existsSync(activeRuntimeDb)) {
    findings.push({
      level: 'P1',
      area: 'runtime-path',
      message: `Active runtime database candidate does not exist yet: ${activeRuntimeDb}`,
    });
  }

  if (activeRuntimeDb && /\/backend\/prisma\//i.test(activeRuntimeDb)) {
    findings.push({
      level: 'P0',
      area: 'runtime-path',
      message: `Active runtime database must not live under backend/prisma: ${activeRuntimeDb}`,
    });
  }

  checkStartupReferences(findings);

  const shadowDatabases = repoDbFiles
    .filter(item => item.path !== activeRuntimeDb)
    .map(item => {
      const classification = classifyShadowDb(item.relativePath);
      const governed = isGovernedShadowDb(item.relativePath);
      return {
        ...item,
        classification,
        governance: governed ? 'governed-quarantined' : 'unresolved',
        governanceNote: shadowDbGovernanceNote(classification),
      };
    });

  for (const item of shadowDatabases) {
    const isJournal = /-journal$/i.test(item.relativePath);
    if (item.governance === 'governed-quarantined') {
      findings.push({
        level: 'P3',
        area: isJournal ? 'governed-shadow-db-journal' : 'governed-shadow-db',
        file: item.relativePath,
        message: `${item.classification} is a governed quarantined database artifact; ${item.governanceNote}`,
      });
      continue;
    }
    findings.push({
      level: 'P2',
      area: isJournal ? 'shadow-db-journal' : 'shadow-db',
      file: item.relativePath,
      message: `${item.classification} is not the active runtime database and must stay quarantined from startup/migration chains`,
    });
  }

  const hasP0 = findings.some(finding => finding.level === 'P0');
  const governedShadowDbFiles = shadowDatabases.filter(item => item.governance === 'governed-quarantined').length;
  const unresolvedShadowDbFiles = shadowDatabases.length - governedShadowDbFiles;
  const report = {
    name: 'Runtime DB Shadow Inventory Audit',
    version: '1.0',
    generatedAt: new Date().toISOString(),
    status: hasP0 ? 'failed' : 'passed',
    activeRuntimeDb,
    activeRuntimeDbInRoot,
    runtimeCandidates,
    summary: {
      repoDbFiles: repoDbFiles.length,
      shadowDbFiles: shadowDatabases.length,
      governedShadowDbFiles,
      unresolvedShadowDbFiles,
      p0Findings: findings.filter(finding => finding.level === 'P0').length,
      p1Findings: findings.filter(finding => finding.level === 'P1').length,
      p2Findings: findings.filter(finding => finding.level === 'P2').length,
      p3Findings: findings.filter(finding => finding.level === 'P3').length,
    },
    findings,
    shadowDatabases,
    reports: {
      json: JSON_REPORT,
      markdown: MD_REPORT,
    },
  };

  writeReports(report);
  console.log(JSON.stringify({
    status: report.status,
    activeRuntimeDb: report.activeRuntimeDb,
    summary: report.summary,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));

  if (report.status !== 'passed') process.exitCode = 1;
}

main();
