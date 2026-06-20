const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'release-worktree-change-inventory-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'release-worktree-change-inventory-v1.md');

function runGit(args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: ROOT, encoding: 'utf8' }).replace(/\r?\n$/, '');
}

function parseStatusLine(line) {
  return {
    raw: line,
    status: line.slice(0, 2),
    path: line.slice(3),
  };
}

function readStatus() {
  return runGit(['status', '--short'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseStatusLine);
}

function readNumstat() {
  const rows = runGit(['diff', '--numstat']).split(/\r?\n/).filter(Boolean);
  const map = new Map();
  for (const row of rows) {
    const [added, deleted, file] = row.split(/\t/);
    map.set(file, {
      added: added === '-' ? null : Number(added || 0),
      deleted: deleted === '-' ? null : Number(deleted || 0),
    });
  }
  return map;
}

const GROUPS = [
  {
    id: 'release_freeze_and_packaging',
    title: '发布冻结与打包闸门',
    risk: 'P0',
    match: (file) => file === 'package.json' || file.includes('package-') || file.includes('release-freeze') || file.includes('deploy-clean-runtime') || file.includes('clean-runtime') || file.includes('start-stable') || file.includes('phase3-package') || file.includes('runtime-schema-repair'),
    verification: ['audit:release:freeze', 'audit:package:origin', 'audit:clean-runtime', 'check:runtime'],
  },
  {
    id: 'auth_team_permissions',
    title: '账号、角色、权限与默认凭据',
    risk: 'P0',
    match: (file) => file.includes('auth') || file.includes('team') || file.includes('role') || file.includes('permission') || file.includes('forcepasswordchange') || file.includes('manage-db') || file.includes('seed'),
    verification: ['audit:auth:default-credentials', 'audit:team:account-lifecycle', 'audit:permissions:system-ui', 'audit:permissions:role-audit-diff'],
  },
  {
    id: 'crm_sales_masterdata',
    title: 'CRM、销售订单与主数据可用性',
    risk: 'P1',
    match: (file) => file.includes('crm') || file.includes('salesorder') || file.includes('sales-orders') || file.includes('customer') || file.includes('validators/orders'),
    verification: ['audit:masterdata:search-readback', 'audit:orders:browser'],
  },
  {
    id: 'procurement_inputs',
    title: '采购与供应商输入治理',
    risk: 'P1',
    match: (file) => file.includes('procurement') || file.includes('supplierworkspace') || file.includes('purchaseorderworkspace'),
    verification: ['audit:procurement:browser'],
  },
  {
    id: 'shared_ui_usability',
    title: '通用 UI 可用性与防崩溃',
    risk: 'P1',
    match: (file) => file.includes('components/') || file.includes('index.css') || file.includes('usedialogfocus') || file.includes('useappshell') || file === 'app.tsx',
    verification: ['npm run build', 'audit:ui:unsaved-changes', 'audit:ui:theme-switch'],
  },
  {
    id: 'governance_docs',
    title: '治理中心文档与审计记录',
    risk: 'P2',
    match: (file) => file.includes('爱劳达软件治理中心/') || file.includes('治理中心/'),
    verification: ['manual review', 'mojibake triage'],
  },
  {
    id: 'audit_scripts',
    title: '审计脚本与测试夹具',
    risk: 'P1',
    match: (file) => file.includes('scripts/'),
    verification: ['node --check changed scripts', 'targeted npm audit scripts'],
  },
  {
    id: 'runtime_config',
    title: '运行配置与环境样例',
    risk: 'P1',
    match: (file) => file.startsWith('.env') || file.includes('apimapping') || file === 'types.ts' || file.includes('api.types'),
    verification: ['npm run build', 'check:runtime'],
  },
];

function classify(file) {
  const normalized = file.toLowerCase();
  return GROUPS.find((group) => group.match(normalized)) || {
    id: 'unclassified',
    title: '未分类变更',
    risk: 'P0',
    verification: ['manual classification required'],
  };
}

function summarize(entries, numstat) {
  const groups = new Map();
  for (const entry of entries) {
    const group = classify(entry.path);
    const current = groups.get(group.id) || {
      id: group.id,
      title: group.title,
      risk: group.risk,
      files: [],
      verification: group.verification,
      added: 0,
      deleted: 0,
    };
    const stats = numstat.get(entry.path) || {};
    current.files.push({ path: entry.path, status: entry.status.trim() || entry.status, added: stats.added, deleted: stats.deleted });
    if (typeof stats.added === 'number') current.added += stats.added;
    if (typeof stats.deleted === 'number') current.deleted += stats.deleted;
    groups.set(group.id, current);
  }
  return Array.from(groups.values()).sort((a, b) => {
    const riskRank = { P0: 0, P1: 1, P2: 2 };
    return riskRank[a.risk] - riskRank[b.risk] || b.files.length - a.files.length || a.title.localeCompare(b.title);
  });
}

function writeReports(report) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const lines = [
    '# 发布冻结工作树变更盘点 v1',
    '',
    `- generatedAt: ${report.generatedAt}`,
    `- status: ${report.status}`,
    `- totalChanges: ${report.totalChanges}`,
    `- p0Groups: ${report.groups.filter((item) => item.risk === 'P0').length}`,
    '',
    '## 判定',
    '',
    report.status === 'clean'
      ? '- 工作树无变更，可以进入冻结候选。'
      : '- 工作树仍有变更，不能进入最终冻结；必须按下方分组补齐验证或收敛变更。',
  ];

  for (const group of report.groups) {
    lines.push('', `## ${group.risk} ${group.title}`, '');
    lines.push(`- files: ${group.files.length}`);
    lines.push(`- diff: +${group.added}/-${group.deleted}`);
    lines.push(`- verification: ${group.verification.join(', ')}`);
    for (const file of group.files) {
      const diff = typeof file.added === 'number' ? ` +${file.added}/-${file.deleted}` : '';
      lines.push(`- ${file.status}: ${file.path}${diff}`);
    }
  }

  fs.writeFileSync(MD_REPORT, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const entries = readStatus();
  const groups = summarize(entries, readNumstat());
  const report = {
    name: 'Release Worktree Change Inventory',
    version: 1,
    generatedAt: new Date().toISOString(),
    status: entries.length === 0 ? 'clean' : 'dirty',
    totalChanges: entries.length,
    groups,
    outputs: {
      json: path.relative(ROOT, JSON_REPORT).split(path.sep).join('/'),
      markdown: path.relative(ROOT, MD_REPORT).split(path.sep).join('/'),
    },
  };

  writeReports(report);
  console.log(JSON.stringify({
    status: report.status,
    totalChanges: report.totalChanges,
    groups: report.groups.map((group) => ({ id: group.id, risk: group.risk, files: group.files.length })),
    outputs: report.outputs,
  }, null, 2));

  if (report.status !== 'clean') process.exitCode = 1;
}

main();
