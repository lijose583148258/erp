const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const GOVERNANCE_DIR = path.join(ROOT, '爱劳达软件治理中心', '10_主线任务');
const STABLE_PACKAGE_DIR = path.join(ROOT, 'AilaoDa_Stable_Package');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const JSON_REPORT = path.join(OUTPUT_DIR, 'stable-baseline-freeze-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'stable-baseline-freeze-v1.md');
const GOVERNANCE_REPORT = path.join(GOVERNANCE_DIR, '本地试跑基线冻结-当前版.md');

const IMPORTANT_FILES = [
  'PACKAGE_CONTENTS.txt',
  '启动系统.bat',
  '稳定启动.bat',
  'dist/index.html',
  'backend/dist/server.js',
  'scripts/start-stable-v2.ps1',
  'scripts/stop-runtime.ps1',
  'scripts/check-runtime.ps1',
  '.env.production.example',
];

const LATEST_REPORTS = {
  phase3Readiness: path.join(OUTPUT_DIR, 'phase3-readiness-audit-v1.json'),
  phase3Dashboard: path.join(OUTPUT_DIR, 'phase3-governance-dashboard-v1.json'),
  packageOrigin: path.join(OUTPUT_DIR, 'stable-package-origin-audit-v1.json'),
  packageRuntimeOrigin: path.join(STABLE_PACKAGE_DIR, 'output', 'audit', 'stable-runtime-origin-v1.json'),
  runtimeCheck: path.join(OUTPUT_DIR, 'runtime-check-v1.json'),
  dbIntegrity: path.join(OUTPUT_DIR, 'runtime-db-integrity-audit-v1.json'),
  shadowDb: path.join(OUTPUT_DIR, 'runtime-db-shadow-inventory-audit-v1.json'),
};

function toProjectPath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { parseError: String(error.message || error) };
  }
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  const stat = fs.statSync(filePath);
  return {
    path: toProjectPath(filePath),
    bytes: stat.size,
    lastWriteTime: stat.mtime.toISOString(),
    sha256: hash.digest('hex'),
  };
}

function walkFiles(dirPath, options = {}) {
  if (!fs.existsSync(dirPath)) return [];
  const skipNames = new Set(options.skipNames || []);
  const out = [];
  const stack = [dirPath];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (skipNames.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }
  return out;
}

function directoryStats(label, relativePath) {
  const dirPath = path.join(STABLE_PACKAGE_DIR, relativePath);
  const files = walkFiles(dirPath);
  let bytes = 0;
  let newest = null;
  for (const file of files) {
    const stat = fs.statSync(file);
    bytes += stat.size;
    const time = stat.mtime.toISOString();
    if (!newest || time > newest) newest = time;
  }
  return {
    label,
    path: toProjectPath(dirPath),
    exists: fs.existsSync(dirPath),
    fileCount: files.length,
    bytes,
    newest,
  };
}

function findExeFiles() {
  const result = [];
  const files = walkFiles(ROOT, { skipNames: new Set(['node_modules', '.git']) });
  for (const file of files) {
    if (path.extname(file).toLowerCase() === '.exe') {
      result.push({
        path: toProjectPath(file),
        bytes: fs.statSync(file).size,
        lastWriteTime: fs.statSync(file).mtime.toISOString(),
      });
    }
  }
  return result;
}

function summarizeReports() {
  const reports = {};
  for (const [key, filePath] of Object.entries(LATEST_REPORTS)) {
    const data = readJsonIfExists(filePath);
    reports[key] = {
      path: toProjectPath(filePath),
      exists: fs.existsSync(filePath),
      status: data?.status || data?.decision || data?.summary?.status || null,
      decision: data?.decision || data?.dashboardDecision?.decision || null,
      summary: data?.summary || null,
      parseError: data?.parseError || null,
    };
  }
  return reports;
}

function writeReports(report) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(GOVERNANCE_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const lines = [
    '# 本地试跑基线冻结',
    '',
    `- generatedAt: ${report.generatedAt}`,
    `- status: ${report.status}`,
    `- baselineId: ${report.baselineId}`,
    `- stablePackage: ${report.stablePackage.path}`,
    `- entryUrl: ${report.entryUrl}`,
    `- runtimeDb: ${report.runtimeDb}`,
    `- exeFilesFound: ${report.exeFiles.length}`,
    '',
    '## 判定',
    '',
    report.exeFiles.length > 0
      ? '- 当前冻结对象是稳定本地包 + 桌面 EXE P0 壳；它不是完整安装器。'
      : '- 当前冻结对象是稳定本地包，不是真正 EXE 壳。',
    '- 后续壳、每日审计、服务器迁移准备，都必须以本基线作为默认运行对象。',
    '- 历史包和影子库不删除，只允许作为隔离参考，不能作为运行入口。',
    '',
    '## 关键文件指纹',
    '',
    '| file | bytes | sha256 |',
    '| --- | ---: | --- |',
  ];

  for (const item of report.importantFileFingerprints) {
    if (!item) continue;
    lines.push(`| ${item.path} | ${item.bytes} | ${item.sha256} |`);
  }

  lines.push('', '## 稳定包目录统计', '', '| scope | files | bytes | newest |', '| --- | ---: | ---: | --- |');
  for (const item of report.packageStats) {
    lines.push(`| ${item.label} | ${item.fileCount} | ${item.bytes} | ${item.newest || 'missing'} |`);
  }

  lines.push('', '## 最近验收报告摘要', '', '| report | exists | status | decision |', '| --- | --- | --- | --- |');
  for (const [key, item] of Object.entries(report.latestReports)) {
    lines.push(`| ${key} | ${item.exists ? 'yes' : 'no'} | ${item.status || ''} | ${item.decision || ''} |`);
  }

  lines.push('', '## 下一步固定流程', '');
  lines.push('- 日常运行前：确认 `AilaoDa_Stable_Package` 是当前 5001 来源。');
  lines.push('- 每日试跑：执行 `npm run audit:daily:local-governance`。');
  lines.push('- 做 EXE 前：必须先通过本基线、台账、每日审计三项。');

  const md = `${lines.join('\n')}\n`;
  fs.writeFileSync(MD_REPORT, md, 'utf8');
  fs.writeFileSync(GOVERNANCE_REPORT, md, 'utf8');
}

function main() {
  const stablePackageExists = fs.existsSync(STABLE_PACKAGE_DIR);
  const importantFileFingerprints = IMPORTANT_FILES.map((relativePath) => hashFile(path.join(STABLE_PACKAGE_DIR, relativePath)));
  const missingImportantFiles = IMPORTANT_FILES
    .map((relativePath) => path.join(STABLE_PACKAGE_DIR, relativePath))
    .filter((filePath) => !fs.existsSync(filePath))
    .map(toProjectPath);

  const report = {
    name: 'Stable Baseline Freeze',
    version: '1.0',
    baselineId: `stable-package-${RUN_ID}`,
    generatedAt: new Date().toISOString(),
    status: stablePackageExists && missingImportantFiles.length === 0 ? 'frozen' : 'failed',
    entryUrl: 'http://127.0.0.1:5001/',
    runtimeDb: 'D:/AilaoDaRuntime/stable.db',
    stablePackage: {
      path: toProjectPath(STABLE_PACKAGE_DIR),
      exists: stablePackageExists,
    },
    missingImportantFiles,
    importantFileFingerprints,
    packageStats: [
      directoryStats('frontend-dist', 'dist'),
      directoryStats('backend-dist', path.join('backend', 'dist')),
      directoryStats('launch-scripts', 'scripts'),
      directoryStats('runtime-data', 'runtime-data'),
      directoryStats('uploads', 'uploads'),
      directoryStats('backups', 'backups'),
    ],
    latestReports: summarizeReports(),
    exeFiles,
    outputs: {
      json: toProjectPath(JSON_REPORT),
      markdown: toProjectPath(MD_REPORT),
      governanceMarkdown: toProjectPath(GOVERNANCE_REPORT),
    },
  };

  writeReports(report);
  console.log(JSON.stringify({
    status: report.status,
    baselineId: report.baselineId,
    missingImportantFiles: report.missingImportantFiles,
    exeFilesFound: report.exeFiles.length,
    outputs: report.outputs,
  }, null, 2));

  if (report.status !== 'frozen') process.exitCode = 1;
}

const exeFiles = findExeFiles();
main();
