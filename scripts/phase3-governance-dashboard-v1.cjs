const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'phase3-governance-dashboard-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'phase3-governance-dashboard-v1.md');
const GOVERNANCE_MD = path.join(ROOT, '爱劳达软件治理中心', '10_主线任务', '阶段3稳定运行治理看板-当前版.md');

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function readJson(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function latestJson(relativeDir, pattern) {
  const dir = path.join(ROOT, relativeDir);
  if (!fs.existsSync(dir)) return null;
  const candidates = fs.readdirSync(dir)
    .filter(name => pattern.test(name))
    .map(name => {
      const fullPath = path.join(dir, name);
      const stat = fs.statSync(fullPath);
      return {
        relativePath: normalizePath(path.relative(ROOT, fullPath)),
        fullPath,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!candidates.length) return null;
  return {
    path: candidates[0].relativePath,
    data: JSON.parse(fs.readFileSync(candidates[0].fullPath, 'utf8')),
  };
}

function statusOf(data) {
  if (!data) return 'missing';
  return String(data.status || data.result || 'unknown').toLowerCase();
}

function isPass(status) {
  return ['passed', 'pass', 'ok', 'success'].includes(String(status).toLowerCase());
}

function isWarning(status) {
  return ['warning', 'warnings', 'passed_with_warnings'].includes(String(status).toLowerCase());
}

function summarizeFindings(findings = []) {
  const counts = {};
  for (const finding of findings || []) {
    const level = String(finding.level || finding.priority || 'unknown').toUpperCase();
    counts[level] = (counts[level] || 0) + 1;
  }
  return counts;
}

function evidenceItem({ id, title, source, status, summary, details = {}, watch = [] }) {
  return {
    id,
    title,
    source,
    status: status || 'missing',
    summary,
    details,
    watch,
  };
}

function collectDashboard() {
  const phase3Package = latestJson('output/audit', /^phase3-package-e-audit-\d+\.json$/);
  const phase3Daily = latestJson('output/audit/phase3-daily', /^phase3-daily-stability-\d+\.json$/);
  const humanFlow = readJson('output/playwright/browser-human-flow-audit-report-v1.json');
  const productionBrowser = readJson('output/playwright/production-browser-audit-report-v1.json');
  const backupRetention = readJson('output/audit/backup-retention-governance-audit-v1.json');
  const backupRestore = readJson('output/audit/runtime-write-backup-restore-readback-audit-v1.json');
  const writeRestart = readJson('output/audit/runtime-write-read-restart-audit-v1.json');
  const shadowDb = readJson('output/audit/runtime-db-shadow-inventory-audit-v1.json');
  const dbIntegrity = readJson('output/audit/runtime-db-integrity-audit-v1.json');
  const deployment = readJson('output/audit/deployment-migration-readiness-audit-v1.json');
  const fullCodebase = readJson('output/audit/full-codebase-audit-v1.json');
  const distAssets = readJson('output/audit/dist-entry-asset-audit-v1.json');
  const roleAccount = readJson('output/playwright/role-account-governance-audit-report-v1.json');
  const roleUi = readJson('output/playwright/role-management-ui-browser-audit-report-v1.json');
  const dynamicRole = readJson('output/playwright/dynamic-role-rbac-audit-report-v1.json');
  const customerScope = readJson('output/playwright/customer-data-scope-audit-report-v1.json');
  const crmAi = readJson('output/playwright/crm-permission-ai-audit-report-v1.json');

  const phase3PackageData = phase3Package?.data || null;
  const phase3DailyData = phase3Daily?.data || null;
  const humanModules = Array.isArray(humanFlow?.modules) ? humanFlow.modules : [];
  const backupCheck = (backupRetention?.checks || []).find(check => check.step === 'runtime-backup-telemetry') || {};

  const items = [
    evidenceItem({
      id: 'phase3-package-e',
      title: 'Phase 3 总包',
      source: phase3Package?.path || null,
      status: statusOf(phase3PackageData),
      summary: phase3PackageData
        ? `${phase3PackageData.summary?.passed || 0}/${phase3PackageData.summary?.total || 0} tasks passed, stuck ${phase3PackageData.summary?.stuck || 0}`
        : 'missing latest Phase 3 package report',
      details: { summary: phase3PackageData?.summary || null },
    }),
    evidenceItem({
      id: 'daily-stability',
      title: '每日稳定台账',
      source: phase3Daily?.path || null,
      status: statusOf(phase3DailyData),
      summary: phase3DailyData
        ? `consecutive passes ${phase3DailyData.ledger?.consecutivePasses || 0}, core endpoints ${phase3DailyData.steps?.find(step => step.step === 'core-module-smoke')?.endpoints?.length || 0}`
        : 'missing daily stability report',
      details: { ledger: phase3DailyData?.ledger || null },
    }),
    evidenceItem({
      id: 'browser-human-flow',
      title: '浏览器级人工流',
      source: 'output/playwright/browser-human-flow-audit-report-v1.json',
      status: statusOf(humanFlow),
      summary: humanFlow
        ? `${humanModules.filter(module => module.status === 'passed').length}/${humanModules.length} modules passed, console errors ${humanFlow.consoleErrors?.length || 0}`
        : 'missing browser human-flow report',
      details: {
        modules: humanModules.map(module => ({
          name: module.name || module.module,
          status: module.status,
          evidence: module.evidence?.length || 0,
        })),
      },
    }),
    evidenceItem({
      id: 'production-deep-browser',
      title: '生产 BOM 深浏览器链',
      source: 'output/playwright/production-browser-audit-report-v1.json',
      status: statusOf(productionBrowser),
      summary: productionBrowser
        ? `${productionBrowser.steps?.filter(step => step.result === 'passed').length || 0} production browser steps passed`
        : 'missing production browser report',
    }),
    evidenceItem({
      id: 'write-restart',
      title: '写入-重启-回读',
      source: 'output/audit/runtime-write-read-restart-audit-v1.json',
      status: statusOf(writeRestart),
      summary: writeRestart
        ? `db path changed: ${Boolean(writeRestart.summary?.databasePathChanged || writeRestart.databasePathChanged)}, mismatches: ${writeRestart.summary?.fingerprintMismatches ?? writeRestart.fingerprintMismatches ?? 'unknown'}`
        : 'missing write-restart report',
      details: { summary: writeRestart?.summary || null },
    }),
    evidenceItem({
      id: 'write-backup-restore',
      title: '写入-备份-恢复-回读',
      source: 'output/audit/runtime-write-backup-restore-readback-audit-v1.json',
      status: statusOf(backupRestore),
      summary: backupRestore
        ? `manifest ${backupRestore.summary?.manifestVerified ? 'verified' : 'unknown'}, mismatches ${backupRestore.summary?.businessMismatches ?? 'unknown'}`
        : 'missing backup restore report',
      details: { summary: backupRestore?.summary || null },
    }),
    evidenceItem({
      id: 'backup-retention',
      title: '备份容量与保留策略',
      source: 'output/audit/backup-retention-governance-audit-v1.json',
      status: statusOf(backupRetention),
      summary: backupRetention
        ? `backup ${backupCheck.backupCount || 0} db files, ${backupCheck.backupTotalMB || 0} MB, findings ${backupRetention.findings?.length || 0}`
        : 'missing backup retention report',
      details: {
        backupDirectoryStats: backupCheck.backupDirectoryStats || null,
        backupRetention: backupCheck.backupRetention || null,
        findings: backupRetention?.findings || [],
      },
      watch: (backupRetention?.findings || []).map(finding => `${finding.level || 'P?'} ${finding.area}: ${finding.message}`),
    }),
    evidenceItem({
      id: 'runtime-db-integrity',
      title: '运行库完整性',
      source: 'output/audit/runtime-db-integrity-audit-v1.json',
      status: statusOf(dbIntegrity),
      summary: dbIntegrity
        ? `integrity ${dbIntegrity.summary?.integrityStatus}, FK violations ${dbIntegrity.summary?.foreignKeyViolationCount}, schema issues ${dbIntegrity.summary?.schemaIssueCount}`
        : 'missing DB integrity report',
      details: { summary: dbIntegrity?.summary || null },
    }),
    evidenceItem({
      id: 'shadow-db',
      title: '影子库隔离',
      source: 'output/audit/runtime-db-shadow-inventory-audit-v1.json',
      status: statusOf(shadowDb),
      summary: shadowDb
        ? `active ${shadowDb.activeRuntimeDb}, P0 ${shadowDb.summary?.p0Findings || 0}, P2 ${shadowDb.summary?.p2Findings || 0}`
        : 'missing shadow DB report',
      details: { summary: shadowDb?.summary || null },
      watch: shadowDb?.summary?.p2Findings ? [`P2 shadow DB files remain quarantined: ${shadowDb.summary.p2Findings}`] : [],
    }),
    evidenceItem({
      id: 'deployment-readiness',
      title: '服务器迁移准备度',
      source: 'output/audit/deployment-migration-readiness-audit-v1.json',
      status: statusOf(deployment),
      summary: deployment
        ? `findings ${deployment.findings?.length || 0}`
        : 'missing deployment readiness report',
    }),
    evidenceItem({
      id: 'full-codebase',
      title: '全仓代码治理',
      source: 'output/audit/full-codebase-audit-v1.json',
      status: statusOf(fullCodebase),
      summary: fullCodebase
        ? `active source ${fullCodebase.summary?.activeSourceFiles}, oversized ${fullCodebase.summary?.oversizedFiles}, findings ${JSON.stringify(fullCodebase.summary?.findingCounts || {})}`
        : 'missing full codebase report',
      details: { summary: fullCodebase?.summary || null },
    }),
    evidenceItem({
      id: 'dist-assets',
      title: '构建产物资源',
      source: 'output/audit/dist-entry-asset-audit-v1.json',
      status: statusOf(distAssets),
      summary: distAssets
        ? `assets ${distAssets.summary?.referencedAssets}/${distAssets.summary?.allAssets}, stale ${distAssets.summary?.staleAssets}, missing ${distAssets.summary?.missingAssets}`
        : 'missing dist asset report',
      details: { summary: distAssets?.summary || null },
    }),
    evidenceItem({
      id: 'permissions-ai',
      title: '权限与 AI 数据隔离',
      source: 'output/playwright/*permission*scope*role*ai*.json',
      status: [roleAccount, roleUi, dynamicRole, customerScope, crmAi].every(item => isPass(statusOf(item))) ? 'passed' : 'failed',
      summary: `role account ${statusOf(roleAccount)}, role UI ${statusOf(roleUi)}, dynamic RBAC ${statusOf(dynamicRole)}, customer scope ${statusOf(customerScope)}, CRM AI ${statusOf(crmAi)}`,
      details: {
        roleAccount: statusOf(roleAccount),
        roleUi: statusOf(roleUi),
        dynamicRole: statusOf(dynamicRole),
        customerScope: statusOf(customerScope),
        crmAi: statusOf(crmAi),
      },
    }),
  ];

  const missing = items.filter(item => item.status === 'missing');
  const failed = items.filter(item => !isPass(item.status) && !isWarning(item.status) && item.status !== 'missing');
  const warnings = items.filter(item => isWarning(item.status) || item.watch.length > 0);
  const hardBlockers = failed.concat(missing);
  const generatedAt = new Date().toISOString();

  return {
    name: 'Phase 3 Governance Dashboard',
    version: '1.0',
    generatedAt,
    status: hardBlockers.length > 0 ? 'failed' : warnings.length > 0 ? 'watch' : 'passed',
    decision: hardBlockers.length > 0
      ? 'not-ready'
      : warnings.length > 0
        ? 'ready-for-local-soak-with-watchlist'
        : 'ready-for-local-soak',
    summary: {
      total: items.length,
      passed: items.filter(item => isPass(item.status)).length,
      warning: warnings.length,
      failed: failed.length,
      missing: missing.length,
      watchItems: warnings.flatMap(item => item.watch.map(text => ({ id: item.id, text }))),
      findingCounts: {
        backupRetention: summarizeFindings(backupRetention?.findings || []),
        shadowDb: summarizeFindings(shadowDb?.findings || []),
        dbIntegrity: summarizeFindings(dbIntegrity?.findings || []),
      },
    },
    items,
    reports: {
      json: normalizePath(JSON_REPORT),
      markdown: normalizePath(MD_REPORT),
      governanceMarkdown: normalizePath(GOVERNANCE_MD),
    },
  };
}

function writeMarkdown(dashboard) {
  const lines = [
    '# 阶段3稳定运行治理看板',
    '',
    `- 生成时间：${dashboard.generatedAt}`,
    `- 总状态：${dashboard.status}`,
    `- 判定：${dashboard.decision}`,
    `- 证据项：${dashboard.summary.passed}/${dashboard.summary.total} 通过，${dashboard.summary.warning} 个观察项，${dashboard.summary.failed} 个失败，${dashboard.summary.missing} 个缺失`,
    '',
    '## 总览表',
    '',
    '| 模块 | 状态 | 证据 | 摘要 |',
    '| --- | --- | --- | --- |',
  ];

  for (const item of dashboard.items) {
    lines.push(`| ${item.title} | ${item.status} | ${item.source || '-'} | ${String(item.summary || '').replace(/\|/g, '/')} |`);
  }

  lines.push('', '## 观察项');
  if (dashboard.summary.watchItems.length === 0) {
    lines.push('- 暂无观察项。');
  } else {
    for (const item of dashboard.summary.watchItems) {
      lines.push(`- ${item.id}: ${item.text}`);
    }
  }

  lines.push('', '## 结论');
  if (dashboard.decision === 'ready-for-local-soak-with-watchlist') {
    lines.push('- 可以继续本地稳定运行试跑，但需要持续观察备份保留策略和影子库隔离提示。');
  } else if (dashboard.decision === 'ready-for-local-soak') {
    lines.push('- 当前证据支持进入本地稳定运行试跑。');
  } else {
    lines.push('- 当前缺少关键证据或存在失败项，不能宣称已达阶段3。');
  }

  lines.push('', '## 下一步建议');
  lines.push('- 保持 `npm run audit:phase3:dashboard` 作为每轮治理收口命令。');
  lines.push('- 若本地备份继续增长，先设置 `BACKUP_MAX_FILES` / `BACKUP_MAX_TOTAL_MB`，再由备份服务自动轮转。');
  lines.push('- 影子库仍保留在仓库内但已隔离，后续可做非破坏式归档说明或迁出计划。');

  return `${lines.join('\n')}\n`;
}

function writeReports(dashboard) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(dashboard, null, 2)}\n`, 'utf8');
  const markdown = writeMarkdown(dashboard);
  fs.writeFileSync(MD_REPORT, markdown, 'utf8');
  fs.mkdirSync(path.dirname(GOVERNANCE_MD), { recursive: true });
  fs.writeFileSync(GOVERNANCE_MD, markdown, 'utf8');
}

function main() {
  const dashboard = collectDashboard();
  writeReports(dashboard);
  console.log(JSON.stringify({
    status: dashboard.status,
    decision: dashboard.decision,
    summary: dashboard.summary,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
    governanceMarkdown: GOVERNANCE_MD,
  }, null, 2));
  if (dashboard.status === 'failed') process.exitCode = 1;
}

main();
