/**
 * Full codebase audit for AilaoDa ERP+CRM.
 *
 * The script is read-only. It separates active source from generated/runtime/
 * historical areas, then reports structure, entrypoints, routing, permissions,
 * encoding, hardcoded runtime risks, oversized files, duplicate names, and
 * script hazards. The goal is evidence, not a false-green verdict.
 */
const fs = require('fs');
const path = require('path');
const { isActiveSource } = require('./lib/active-source-scope.cjs');
const {
  ACTIVE_EXTENSIONS,
  EXCLUDED_DIR_PREFIXES,
  EXCLUDED_DIRS,
  SOURCE_EXTENSIONS,
} = require('./lib/full-codebase-audit-policy.cjs');
const { buildFullCodebaseAuditMarkdown } = require('./lib/full-codebase-audit-report.cjs');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'full-codebase-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'full-codebase-audit-v1.md');
const STARTED_AT = new Date();

const GOVERNED_RUNTIME_SCRIPT_FILES = new Set([
  'check-timeboxed-health.ps1',
  'scripts/clean-dist-v1.ps1',
  'scripts/start-cdp-browser.ps1',
  'scripts/start-stable-v2.ps1',
  'scripts/stop-runtime.ps1',
  '启动系统.bat',
]);

const GOVERNED_NAMED_ACTIVE_FILES = new Set([
  'scripts/clean-dist-v1.cjs',
  'scripts/clean-dist-v1.ps1',
  'scripts/legacy-interface-disconnect-audit-v1.cjs',
]);

const HISTORICAL_DIR_NAMES = new Set([
  '历史归档',
  '文档归档',
  '测试',
  '99_隔离区',
  'quarantine',
]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toPosix(rel) {
  return rel.split(path.sep).join('/');
}

function rel(file) {
  return toPosix(path.relative(ROOT, file));
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function isDisabledLegacySource(item, text) {
  if ((item.rel === 'backend/complete-server.js' || item.rel === 'backend/simple-server.js')
    && /Legacy mock backend/.test(text)
    && /\[legacy mock backend disabled\]/.test(text)
    && /process\.exit\(1\)/.test(text)) {
    return true;
  }

  if ((item.rel === 'refactor.cjs' || item.rel === 'refactor2.cjs')
    && /\[legacy one-off refactor disabled\]/.test(text)
    && /process\.exit\(1\)/.test(text)) {
    return true;
  }

  if ((item.rel === 'backend/scripts/fix-db.js' || item.rel === 'backend/scripts/fix-db.ts')
    && /\[legacy db repair disabled\]/.test(text)
    && /process\.exit\(1\)/.test(text)) {
    return true;
  }

  return false;
}

function walk(dir, bucket, flags = { historical: false }) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nextHistorical = flags.historical || HISTORICAL_DIR_NAMES.has(entry.name);
      const isExcludedByPrefix = EXCLUDED_DIR_PREFIXES.some(prefix => entry.name.startsWith(prefix));
      if (!nextHistorical && (EXCLUDED_DIRS.has(entry.name) || isExcludedByPrefix)) {
        bucket.excludedDirs.push(rel(full));
        continue;
      }
      walk(full, bucket, { historical: nextHistorical });
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!ACTIVE_EXTENSIONS.has(ext) && !entry.name.startsWith('.env')) continue;

    const stat = fs.statSync(full);
    const item = {
      path: full,
      rel: rel(full),
      name: entry.name,
      ext,
      bytes: stat.size,
      historical: flags.historical,
    };
    if (flags.historical) bucket.historicalFiles.push(item);
    else bucket.activeFiles.push(item);
  }
}

function countLines(text) {
  return text.length === 0 ? 0 : text.split(/\r?\n/).length;
}

function addFinding(findings, priority, category, title, file, line, detail, evidence = {}) {
  findings.push({ priority, category, title, file, line, detail, evidence });
}

function lineOf(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function findMatches(text, regex, limit = 20) {
  const matches = [];
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) && matches.length < limit) {
    matches.push({ line: lineOf(text, match.index), value: match[0].slice(0, 180) });
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
  }
  return matches;
}

function classifyFile(item) {
  const parts = item.rel.split('/');
  if (parts[0] === 'backend') return 'backend';
  if (parts[0] === 'pages') return 'frontend-page';
  if (parts[0] === 'components') return 'frontend-component';
  if (parts[0] === 'services') return 'frontend-service';
  if (parts[0] === 'utils') return 'frontend-utils';
  if (parts[0] === 'app') return 'frontend-app';
  if (parts[0] === 'scripts') return 'script';
  if (parts[0] === 'translations') return 'translation';
  if (parts[0] === '爱劳达软件治理中心') return 'governance';
  return 'root-or-config';
}

function scanRoutes(activeSourceFiles, findings, routeAudit) {
  const routeFiles = activeSourceFiles.filter(item => item.rel.startsWith('backend/src/routes/') && item.rel.endsWith('.ts'));
  for (const item of routeFiles) {
    const text = safeRead(item.path);
    if (!text) continue;
    const hasRouterUseAuthenticate = /router\.use\([^)]*authenticate/.test(text);
    const routeLines = text.split(/\r?\n/);
    let routeCount = 0;
    let permissionRoutes = 0;
    let fixedRoleRoutes = 0;
    let manualRoleGuardRoutes = 0;
    let unauthenticatedCandidates = 0;
    routeLines.forEach((line, idx) => {
      if (!/router\.(get|post|put|patch|delete)\s*\(/.test(line)) return;
      routeCount += 1;
      const localWindow = routeLines.slice(idx, Math.min(routeLines.length, idx + 8)).join('\n');
      if (/authorizePermission\s*\(/.test(localWindow)) permissionRoutes += 1;
      if (/authorize\s*\(/.test(localWindow)) fixedRoleRoutes += 1;
      const hasManualRoleExpression = /\[[^\]]*['"`]admin['"`][^\]]*\]\.includes\s*\([^)]*role|role\s*[!=]==\s*['"`](admin|manager|sales|warehouse|finance)['"`]/.test(localWindow);
      const looksLikeManualAuthorization = /403|Forbidden|权限不足|requiredPermissions|not authorized/i.test(localWindow);
      if (hasManualRoleExpression && looksLikeManualAuthorization) {
        manualRoleGuardRoutes += 1;
      }
      const hasInlineAuth = /authenticate\s*,|authorizePermission\s*\(|authorize\s*\(/.test(localWindow);
      const isPublicAuthRoute = item.name === 'auth.routes.ts' && /\/(login|register|refresh|logout|profile|change-password)/.test(localWindow);
      if (!hasRouterUseAuthenticate && !hasInlineAuth && !isPublicAuthRoute) {
        unauthenticatedCandidates += 1;
        addFinding(
          findings,
          'P1',
          'permission',
          'Route may lack explicit authentication or permission guard',
          item.rel,
          idx + 1,
          line.trim(),
        );
      }
    });
    routeAudit.push({
      file: item.rel,
      routeCount,
      hasRouterUseAuthenticate,
      permissionRoutes,
      fixedRoleRoutes,
      manualRoleGuardRoutes,
      unauthenticatedCandidates,
    });
    if (fixedRoleRoutes > 0) {
      addFinding(
        findings,
        'P1',
        'permission',
        'Route file still uses fixed role authorize() guard',
        item.rel,
        null,
        `fixedRoleRoutes=${fixedRoleRoutes}`,
      );
    }
    if (manualRoleGuardRoutes > 0) {
      addFinding(
        findings,
        'P1',
        'permission',
        'Route file still uses manual role checks instead of permission middleware',
        item.rel,
        null,
        `manualRoleGuardRoutes=${manualRoleGuardRoutes}`,
      );
    }
  }
}

function summarizeFindings(findings) {
  const counts = {};
  for (const finding of findings) {
    counts[finding.priority] = (counts[finding.priority] || 0) + 1;
  }
  return counts;
}

function isAuditOrTestAsset(item) {
  const file = item.rel.toLowerCase();
  const name = item.name.toLowerCase();
  if (file.startsWith('测试/')) return true;
  if (file.startsWith('playwright-')) return true;
  if (file.startsWith('backend/src/database/seed')) return true;
  if (file.includes('/database/manage-db')) return true;
  if (file.includes('/stress_test')) return true;
  if (file.startsWith('backend/scripts/')) return true;
  if (!file.startsWith('scripts/')) return false;

  return /(audit|smoke|test|probe|verify|regression|debug|performance|consistency|reconcile|permission|scope|role|browser|api|chain|screenshot|dual-port|e2e|collection|procurement|orders|shipping|barter|production|receipt|customer|contract|supplier|dashboard|asset|money|backup|concurrency|cdp|ui)/i.test(name);
}

function isConsoleHeavyUtilityAsset(item) {
  const file = item.rel.toLowerCase();
  return isAuditOrTestAsset(item)
    || file.startsWith('backend/scripts/')
    || file.startsWith('backend/prisma/migrations/')
    || file.startsWith('backend/src/database/')
    || file === 'backend/src/stress_test.ts';
}

function isRuntimePolicyAuditAsset(item) {
  return item.rel === 'scripts/stable-entrypoint-policy-audit-v1.cjs';
}

function main() {
  ensureDir(OUTPUT_DIR);
  const bucket = { activeFiles: [], historicalFiles: [], excludedDirs: [] };
  walk(ROOT, bucket);

  const activeSourceFiles = bucket.activeFiles.filter(item => (
    (SOURCE_EXTENSIONS.has(item.ext) || item.name.startsWith('.env')) && isActiveSource(item.rel)
  ));
  const findings = [];
  const routeAudit = [];
  const domainCounts = {};
  const extensionCounts = {};
  const nameMap = new Map();
  const largestFiles = [];
  const oversizedFiles = [];
  const legacyNamedFiles = [];
  const sourceLineStats = [];
  const disabledLegacyFiles = [];
  const suspiciousLegacyNamedFiles = [];
  const governedNamedActiveFiles = [];
  const testCredentialAssets = [];
  const consoleHeavyUtilityAssets = [];
  const governedRuntimeScriptAssets = [];

  for (const item of activeSourceFiles) {
    const text = safeRead(item.path);
    if (text === null) continue;
    if (isDisabledLegacySource(item, text)) {
      disabledLegacyFiles.push(item.rel);
      continue;
    }
    const isSelf = item.rel === rel(__filename);
    const lines = countLines(text);
    const domain = classifyFile(item);
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    extensionCounts[item.ext || item.name] = (extensionCounts[item.ext || item.name] || 0) + 1;
    sourceLineStats.push({ file: item.rel, lines, bytes: item.bytes, domain });
    largestFiles.push({ file: item.rel, lines, bytes: item.bytes, domain });
    if (lines >= 600 || item.bytes >= 45_000) {
      oversizedFiles.push({ file: item.rel, lines, bytes: item.bytes, domain });
      addFinding(findings, lines >= 1200 || item.bytes >= 80_000 ? 'P1' : 'P2', 'maintainability', 'Oversized source file should be split', item.rel, null, `${lines} lines, ${item.bytes} bytes`);
    }

    const base = item.name.toLowerCase();
    if (!nameMap.has(base)) nameMap.set(base, []);
    nameMap.get(base).push(item.rel);

    if (/(^|[._-])(bak|old|legacy|tmp|temp|fix|clean|current)([._-]|$)/i.test(item.name)) {
      legacyNamedFiles.push(item.rel);
      const isAuditOrTest = isAuditOrTestAsset(item);
      const isGovernedName = isAuditOrTest || GOVERNED_NAMED_ACTIVE_FILES.has(item.rel);
      if (isGovernedName) {
        governedNamedActiveFiles.push(item.rel);
      } else {
        suspiciousLegacyNamedFiles.push(item.rel);
        const priority = item.rel.startsWith('scripts/') ? 'P3' : 'P2';
        addFinding(findings, priority, 'stale-file', 'Legacy/temporary naming remains in active tree', item.rel, null, item.name);
      }
    }

    const badEncodingMatches = isSelf ? [] : [
      ...findMatches(text, /\uFFFD/g, 10),
      ...findMatches(text, /(?:\u00c3.|\u00c2.|\u00e2\u20ac.|\u951f\u65a4\u62f7|\u934b|\u935a|\u941c|\u9470|\u9348|\u93c4|\u9201|\u9983|\u760b|\uFFFD)/g, 10),
    ];
    if (badEncodingMatches.length > 0) {
      addFinding(findings, 'P1', 'encoding', 'Possible real mojibake marker in active file', item.rel, badEncodingMatches[0].line, badEncodingMatches[0].value, { matches: badEncodingMatches.slice(0, 5) });
    }

    const zhizaiMatches = isSelf ? [] : findMatches(text, /\u667a\u4ed4|zhizai/gi, 10);
    if (zhizaiMatches.length > 0 && !item.rel.startsWith('爱劳达软件治理中心/')) {
      addFinding(findings, 'P1', 'wrong-project', 'Active file references Zhizai', item.rel, zhizaiMatches[0].line, zhizaiMatches[0].value);
    }

    const externalMatches = findMatches(text, /https?:\/\/(?:cdn\.|fonts\.googleapis|fonts\.gstatic|unpkg|jsdelivr|cdnjs|tailwindcss)/gi, 10);
    if (externalMatches.length > 0) {
      addFinding(findings, 'P1', 'offline', 'External CDN/font dependency in active source', item.rel, externalMatches[0].line, externalMatches[0].value, { matches: externalMatches });
    }

    const dangerousShellMatches = isSelf || isRuntimePolicyAuditAsset(item)
      ? []
      : findMatches(text, /\b(taskkill|Stop-Process|Remove-Item|rd\s+\/s\s+\/q|Start-Process|cmd\s+\/k)\b/gi, 20);
    if (dangerousShellMatches.length > 0 && (item.ext === '.ps1' || item.ext === '.bat' || item.rel.startsWith('scripts/'))) {
      if (GOVERNED_RUNTIME_SCRIPT_FILES.has(item.rel)) {
        governedRuntimeScriptAssets.push({
          file: item.rel,
          line: dangerousShellMatches[0].line,
          operation: dangerousShellMatches[0].value,
          count: dangerousShellMatches.length,
        });
      } else {
        addFinding(findings, 'P2', 'runtime-script', 'Script contains process/file operation requiring ownership guard', item.rel, dangerousShellMatches[0].line, dangerousShellMatches[0].value, { matches: dangerousShellMatches.slice(0, 8) });
      }
    }

    const globalNodeKill = isSelf || isRuntimePolicyAuditAsset(item)
      ? []
      : findMatches(text, /taskkill\s+\/F\s+\/IM\s+node\.exe|Stop-Process[^\n]+node/gi, 5);
    if (globalNodeKill.length > 0) {
      addFinding(findings, 'P0', 'runtime-script', 'Global Node process kill can break other projects', item.rel, globalNodeKill[0].line, globalNodeKill[0].value);
    }

    const hardcodedPasswordMatches = findMatches(text, /(admin123|sales123|finance123|manager123|warehouse123|Audit12345)/g, 20);
    const isAuditOrTest = isAuditOrTestAsset(item);
    if (hardcodedPasswordMatches.length > 0 && !isAuditOrTest) {
      addFinding(findings, 'P1', 'credential', 'Hardcoded demo password outside audit/test/seed files', item.rel, hardcodedPasswordMatches[0].line, hardcodedPasswordMatches[0].value);
    } else if (hardcodedPasswordMatches.length > 0 && isAuditOrTest) {
      testCredentialAssets.push({
        file: item.rel,
        line: hardcodedPasswordMatches[0].line,
        sample: hardcodedPasswordMatches[0].value,
        count: hardcodedPasswordMatches.length,
      });
    }

    const anyMatches = findMatches(text, /:\s*any\b|as\s+any\b|Record<string,\s*any>/g, 50);
    if (anyMatches.length >= 8) {
      addFinding(findings, 'P2', 'typescript', 'High any usage weakens contract safety', item.rel, anyMatches[0].line, `${anyMatches.length} any-like usages`);
    }

    const todoMatches = findMatches(text, /\b(TODO|FIXME|HACK|XXX)\b/gi, 20);
    if (!isSelf && todoMatches.length > 0) {
      addFinding(findings, 'P3', 'maintenance-note', 'TODO/FIXME/HACK marker remains', item.rel, todoMatches[0].line, todoMatches[0].value, { matches: todoMatches.slice(0, 5) });
    }

    const consoleMatches = findMatches(text, /console\.(log|warn|error|debug)\s*\(/g, 20);
    if (consoleMatches.length >= 6 && item.ext !== '.cjs') {
      if (isConsoleHeavyUtilityAsset(item)) {
        consoleHeavyUtilityAssets.push({
          file: item.rel,
          line: consoleMatches[0].line,
          count: consoleMatches.length,
        });
      } else {
        addFinding(findings, 'P3', 'observability', 'High console usage in non-script source', item.rel, consoleMatches[0].line, `${consoleMatches.length} console calls`);
      }
    }
  }

  scanRoutes(activeSourceFiles, findings, routeAudit);

  const duplicateNames = Array.from(nameMap.entries())
    .filter(([, files]) => files.length > 1)
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name));
  const suspiciousDuplicateNames = [];
  const governedDuplicateNames = [];

  for (const dup of duplicateNames) {
    const activeDup = dup.files.filter(file => !file.startsWith('历史归档/'));
    const isCrossLayerPair = activeDup.length === 2
      && activeDup.some(file => file.startsWith('backend/src/'))
      && activeDup.some(file => /^(services|utils)\//.test(file));
    const isCommonBarrel = /^(index|types)\.(ts|tsx|js|cjs|mjs)$/i.test(dup.name);
    const isSourceDuplicate = activeDup.length >= 2 && /\.(ts|tsx|js|cjs|mjs)$/i.test(dup.name);
    if (isSourceDuplicate && !isCrossLayerPair && !isCommonBarrel) {
      suspiciousDuplicateNames.push({ ...dup, activeFiles: activeDup });
      addFinding(findings, 'P2', 'duplication', 'Duplicate active source basename can confuse maintenance', activeDup[0], null, `${dup.name}: ${activeDup.join(', ')}`);
    } else if (isSourceDuplicate) {
      governedDuplicateNames.push({
        ...dup,
        activeFiles: activeDup,
        reason: isCommonBarrel ? 'common-barrel-or-types-entry' : 'frontend-backend-layer-pair',
      });
    }
  }

  largestFiles.sort((a, b) => b.lines - a.lines);
  oversizedFiles.sort((a, b) => b.lines - a.lines);
  sourceLineStats.sort((a, b) => b.lines - a.lines);

  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const backendPackageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend', 'package.json'), 'utf8'));

  const report = {
    meta: {
      startedAt: STARTED_AT.toISOString(),
      finishedAt: new Date().toISOString(),
      root: ROOT,
      script: rel(__filename),
      scope: {
        activeFiles: bucket.activeFiles.length,
        activeSourceFiles: activeSourceFiles.length,
        historicalFiles: bucket.historicalFiles.length,
        excludedDirs: bucket.excludedDirs,
      },
    },
    package: {
      name: packageJson.name,
      version: packageJson.version,
      scripts: packageJson.scripts,
      dependencies: Object.keys(packageJson.dependencies || {}).sort(),
      devDependencies: Object.keys(packageJson.devDependencies || {}).sort(),
      backendName: backendPackageJson.name,
      backendScripts: backendPackageJson.scripts,
    },
    structure: {
      domainCounts,
      extensionCounts,
      topLargestFiles: largestFiles.slice(0, 35),
      oversizedFiles,
      legacyNamedFiles: legacyNamedFiles.sort(),
      suspiciousLegacyNamedFiles: suspiciousLegacyNamedFiles.sort(),
      governedNamedActiveFiles: governedNamedActiveFiles.sort(),
      disabledLegacyFiles: disabledLegacyFiles.sort(),
      testCredentialAssets: testCredentialAssets.sort((a, b) => a.file.localeCompare(b.file)),
      consoleHeavyUtilityAssets: consoleHeavyUtilityAssets.sort((a, b) => a.file.localeCompare(b.file)),
      governedRuntimeScriptAssets: governedRuntimeScriptAssets.sort((a, b) => a.file.localeCompare(b.file)),
      duplicateNames: duplicateNames.slice(0, 80),
      suspiciousDuplicateNames: suspiciousDuplicateNames.slice(0, 80),
      governedDuplicateNames: governedDuplicateNames.slice(0, 80),
    },
    routeAudit,
    findings: findings.sort((a, b) => {
      const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
      return (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9)
        || a.category.localeCompare(b.category)
        || a.file.localeCompare(b.file);
    }),
  };
  report.summary = {
    findingCounts: summarizeFindings(report.findings),
    activeSourceFiles: activeSourceFiles.length,
    oversizedFiles: oversizedFiles.length,
    routeFiles: routeAudit.length,
    duplicateNameGroups: suspiciousDuplicateNames.length,
    duplicateNameGroupsAll: duplicateNames.length,
    governedDuplicateNameGroups: governedDuplicateNames.length,
    legacyNamedFiles: suspiciousLegacyNamedFiles.length,
    legacyNamedFilesAll: legacyNamedFiles.length,
    governedNamedActiveFiles: governedNamedActiveFiles.length,
    disabledLegacyFiles: disabledLegacyFiles.length,
    testCredentialAssets: testCredentialAssets.length,
    consoleHeavyUtilityAssets: consoleHeavyUtilityAssets.length,
    governedRuntimeScriptAssets: governedRuntimeScriptAssets.length,
  };
  report.status = report.summary.findingCounts.P0 ? 'failed' : report.findings.length ? 'warning' : 'passed';

  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(MD_REPORT, buildFullCodebaseAuditMarkdown(report, JSON_REPORT, MD_REPORT), 'utf8');

  console.log(JSON.stringify({
    status: report.status,
    summary: report.summary,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));

  if (report.status === 'failed') process.exitCode = 1;
}

main();
