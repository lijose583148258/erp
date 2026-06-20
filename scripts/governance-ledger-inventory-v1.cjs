const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const GOVERNANCE_DIR = path.join(ROOT, '爱劳达软件治理中心', '04_清理清单');
const JSON_REPORT = path.join(OUTPUT_DIR, 'governance-ledger-inventory-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'governance-ledger-inventory-v1.md');
const GOVERNANCE_REPORT = path.join(GOVERNANCE_DIR, '旧入口脚本报告治理台账-当前版.md');

const ACTIVE_ENTRYPOINTS = new Set([
  'AilaoDa_Stable_Package/启动系统.bat',
  'AilaoDa_Stable_Package/稳定启动.bat',
  'AilaoDa_Stable_Package/scripts/start-stable-v2.ps1',
  'AilaoDa_Stable_Package/scripts/stop-runtime.ps1',
  'AilaoDa_Stable_Package/scripts/check-runtime.ps1',
  'scripts/start-stable-v2.ps1',
  'scripts/stop-runtime.ps1',
  'scripts/check-runtime.ps1',
  'scripts/package-stable.ps1',
]);

const REVIEW_HINTS = [
  'debug',
  'focused',
  'probe',
  'e2e-smoke',
  'dual-port-audit.cjs',
];

const SCRIPT_CLASSIFICATION_OVERRIDES = {
  'ai-security-regression.ts': 'manual-audit-asset',
  'customer-name-regression.ts': 'manual-audit-asset',
  'effective-source-mojibake-gate-v1.cjs': 'active-governance-gate',
  'product-batch-shadow-stock-reconcile-v1.cjs': 'manual-audit-asset',
  'ui-screenshot.cjs': 'manual-audit-asset',
  'browser-cdp-probe.cjs': 'runtime-diagnostic-probe',
  'browser-runtime-probe.cjs': 'runtime-diagnostic-probe',
  'crm-dom-probe-v1.cjs': 'manual-diagnostic-probe',
  'e2e-smoke.cjs': 'legacy-smoke-review-before-use',
  'procurement-debug-v1.cjs': 'manual-diagnostic-probe',
  'warehouse-filter-network-probe.cjs': 'manual-diagnostic-probe',
};

function toProjectPath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const out = [];
  const stack = [dirPath];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        stack.push(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }
  return out;
}

function npmReferencedScriptFiles(packageJson) {
  const files = new Set();
  for (const command of Object.values(packageJson.scripts || {})) {
    const matches = String(command).matchAll(/(?:\.\\|\.\/)?scripts[\\/]([A-Za-z0-9_.-]+\.(?:cjs|mjs|js|ts|tsx|ps1))/g);
    for (const match of matches) files.add(match[1]);
  }
  return files;
}

function classifyScript(fileName, referencedFiles) {
  const lower = fileName.toLowerCase();
  if (SCRIPT_CLASSIFICATION_OVERRIDES[fileName]) return SCRIPT_CLASSIFICATION_OVERRIDES[fileName];
  if (referencedFiles.has(fileName)) return 'active-npm-entry';
  if (lower.includes('audit') || lower.includes('verify')) return 'manual-audit-asset';
  if (lower.includes('start') || lower.includes('stop') || lower.includes('check') || lower.includes('package')) return 'runtime-support-asset';
  if (lower.includes('repair') || lower.includes('clean')) return 'manual-repair-asset';
  if (REVIEW_HINTS.some((hint) => lower.includes(hint))) return 'review-before-use';
  return 'unclassified-review-needed';
}

function classifyEntrypoint(projectPath) {
  if (ACTIVE_ENTRYPOINTS.has(projectPath)) return 'active-or-support';
  if (projectPath.includes('AilaoDa_Stable_Package_previous_')) return 'historical-package-isolated';
  if (projectPath.endsWith('.bat') || projectPath.endsWith('.ps1')) return 'manual-review-before-use';
  return 'other';
}

function collectEntrypoints() {
  return listFiles(ROOT)
    .filter((filePath) => /\.(bat|ps1)$/i.test(filePath))
    .map((filePath) => {
      const projectPath = toProjectPath(filePath);
      const stat = fs.statSync(filePath);
      return {
        path: projectPath,
        classification: classifyEntrypoint(projectPath),
        bytes: stat.size,
        lastWriteTime: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function collectReports() {
  const governanceFiles = listFiles(path.join(ROOT, '爱劳达软件治理中心'))
    .filter((filePath) => /\.(md|json)$/i.test(filePath));
  const auditFiles = listFiles(path.join(ROOT, 'output', 'audit'))
    .filter((filePath) => /\.(md|json|jsonl)$/i.test(filePath));
  return {
    governanceFileCount: governanceFiles.length,
    auditFileCount: auditFiles.length,
    latestGovernanceFiles: governanceFiles
      .map((filePath) => ({ path: toProjectPath(filePath), lastWriteTime: fs.statSync(filePath).mtime.toISOString() }))
      .sort((a, b) => b.lastWriteTime.localeCompare(a.lastWriteTime))
      .slice(0, 30),
    latestAuditFiles: auditFiles
      .map((filePath) => ({ path: toProjectPath(filePath), lastWriteTime: fs.statSync(filePath).mtime.toISOString() }))
      .sort((a, b) => b.lastWriteTime.localeCompare(a.lastWriteTime))
      .slice(0, 30),
  };
}

function collectHistoricalPackages() {
  return fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('AilaoDa_Stable_Package_previous_'))
    .map((entry) => {
      const fullPath = path.join(ROOT, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        path: entry.name,
        classification: 'historical-package-isolated',
        lastWriteTime: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.path.localeCompare(a.path));
}

function writeReports(report) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(GOVERNANCE_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const counts = report.summary.scriptClassifications;
  const lines = [
    '# 旧入口、脚本、报告治理台账',
    '',
    `- generatedAt: ${report.generatedAt}`,
    `- status: ${report.status}`,
    `- scriptFiles: ${report.summary.scriptFiles}`,
    `- entrypoints: ${report.summary.entrypoints}`,
    `- historicalPackages: ${report.summary.historicalPackages}`,
    '',
    '## 使用原则',
    '',
    '- 当前运行只认 `AilaoDa_Stable_Package` 和 `http://127.0.0.1:5001/`。',
    '- `previous` 稳定包只保留为历史隔离参考，不能作为默认入口。',
    '- 未在 npm scripts 中注册的审计脚本不等于删除对象，但每日审计不能直接依赖它。',
    '- `debug`、`probe`、`focused`、旧双端口脚本必须人工确认后才能运行。',
    '',
    '## 脚本分类统计',
    '',
    '| classification | count |',
    '| --- | ---: |',
  ];
  for (const [classification, count] of Object.entries(counts)) {
    lines.push(`| ${classification} | ${count} |`);
  }

  lines.push('', '## 重点入口分类', '', '| path | classification |', '| --- | --- |');
  for (const item of report.entrypoints.filter((entry) => entry.classification !== 'historical-package-isolated').slice(0, 80)) {
    lines.push(`| ${item.path} | ${item.classification} |`);
  }

  lines.push('', '## 需要复核后再用的脚本', '', '| file | classification |', '| --- | --- |');
  for (const item of report.scripts.filter((script) => script.classification.includes('review')).slice(0, 80)) {
    lines.push(`| ${item.file} | ${item.classification} |`);
  }

  lines.push('', '## 最近治理报告', '', '| file | lastWriteTime |', '| --- | --- |');
  for (const item of report.reports.latestGovernanceFiles.slice(0, 20)) {
    lines.push(`| ${item.path} | ${item.lastWriteTime} |`);
  }

  lines.push('', '## 下一步', '');
  lines.push('- 新增壳或安装器前，先更新本台账。');
  lines.push('- 如果要断开旧入口，先将入口改为明确失败提示，不直接删除历史资料。');
  lines.push('- 每日审计只使用 `active-npm-entry` 和 `runtime-support-asset`。');

  const md = `${lines.join('\n')}\n`;
  fs.writeFileSync(MD_REPORT, md, 'utf8');
  fs.writeFileSync(GOVERNANCE_REPORT, md, 'utf8');
}

function main() {
  const packageJson = readJson(path.join(ROOT, 'package.json'));
  const referencedFiles = npmReferencedScriptFiles(packageJson);
  const scriptsDir = path.join(ROOT, 'scripts');
  const scripts = fs.readdirSync(scriptsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const stat = fs.statSync(path.join(scriptsDir, entry.name));
      return {
        file: entry.name,
        classification: classifyScript(entry.name, referencedFiles),
        npmReferenced: referencedFiles.has(entry.name),
        bytes: stat.size,
        lastWriteTime: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));

  const scriptClassifications = scripts.reduce((acc, item) => {
    acc[item.classification] = (acc[item.classification] || 0) + 1;
    return acc;
  }, {});

  const report = {
    name: 'Governance Ledger Inventory',
    version: '1.0',
    generatedAt: new Date().toISOString(),
    status: 'passed',
    activeRuntime: {
      stablePackage: 'AilaoDa_Stable_Package',
      entryUrl: 'http://127.0.0.1:5001/',
      runtimeDb: 'D:/AilaoDaRuntime/stable.db',
    },
    summary: {
      npmScriptCount: Object.keys(packageJson.scripts || {}).length,
      npmReferencedScriptFiles: referencedFiles.size,
      scriptFiles: scripts.length,
      scriptClassifications,
      entrypoints: collectEntrypoints().length,
      historicalPackages: collectHistoricalPackages().length,
    },
    scripts,
    entrypoints: collectEntrypoints(),
    historicalPackages: collectHistoricalPackages(),
    reports: collectReports(),
    outputs: {
      json: toProjectPath(JSON_REPORT),
      markdown: toProjectPath(MD_REPORT),
      governanceMarkdown: toProjectPath(GOVERNANCE_REPORT),
    },
  };

  writeReports(report);
  console.log(JSON.stringify({
    status: report.status,
    summary: report.summary,
    outputs: report.outputs,
  }, null, 2));
}

main();
