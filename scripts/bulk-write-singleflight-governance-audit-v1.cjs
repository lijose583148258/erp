const fs = require('fs');
const path = require('path');
const { isActiveSource, normalizeRel } = require('./lib/active-source-scope.cjs');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'bulk-write-singleflight-governance-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'bulk-write-singleflight-governance-audit-v1.md');

const GOVERNED_OPERATIONS = [
  {
    id: 'collection-overdue-full-sync',
    file: 'backend/src/services/collection-state.service.ts',
    risk: 'P0',
    reason: 'Full customer overdue sync writes many customer rows and can hit SQLite write locks under concurrent calls.',
    requiredTokens: [
      'syncAllCustomerOverdueAmountsInFlight',
      'runSyncAllCustomerOverdueAmounts',
      'withDbRetry',
    ],
  },
  {
    id: 'system-backup-restore-exclusive-service',
    file: 'backend/src/services/backup.service.ts',
    risk: 'P0',
    reason: 'Backup and restore touch the active SQLite database file and must never run concurrently.',
    requiredTokens: [
      'runExclusiveBackupOperation',
      'BACKUP_OPERATION_IN_PROGRESS',
      'performBackupExclusive',
      'restoreBackupExclusive',
    ],
  },
  {
    id: 'system-backup-restore-conflict-http',
    file: 'backend/src/controllers/system.controller.ts',
    risk: 'P0',
    reason: 'Concurrent backup/restore conflicts must be a controlled business conflict, not a 500.',
    requiredTokens: [
      'getBackupOperationConflictMessage',
      '409',
    ],
  },
  {
    id: 'customer-import-row-bounded-retry',
    file: 'backend/src/controllers/customer/customer-io.controller.ts',
    risk: 'P1',
    reason: 'Batch customer import writes many records and must stay bounded and retry individual row transactions.',
    requiredTokens: [
      'buildCustomerImportData',
      'for (const customer of validCustomers',
      'withDbRetry',
    ],
  },
  {
    id: 'currency-sync-cache-only',
    file: 'backend/src/services/currency.service.ts',
    risk: 'P2',
    reason: 'Currency sync can be concurrent, but should remain cache-only and timeboxed because it calls external networks.',
    requiredTokens: [
      'AbortSignal.timeout',
      'setCache',
      'FALLBACK_RATES',
    ],
    forbiddenTokens: [
      'prisma.',
      '$transaction',
      'updateMany',
      'createMany',
      'deleteMany',
    ],
  },
];

const RISKY_PUBLIC_PATTERNS = [
  /\b(syncAll|syncRates|restoreBackup|performBackup|importCustomers|createReminderBatch|recalculate|rebuild|repair|cleanupOldBackups)\b/,
  /\b(createMany|updateMany|deleteMany)\s*\(/,
];

const SAFE_WATCHLIST_PATTERNS = [
  /syncAgreementProgress/,
  /syncBarterAgreementProgress/,
  /syncOrderShipmentState/,
  /syncB2BSalesStatusToPurchase/,
  /syncOrderDisputeShipmentHold/,
  /syncCustomerOverdueAmount/,
  /BackupService\.(performBackup|restoreBackup)/,
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function readRel(relPath) {
  const abs = path.join(ROOT, relPath);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

function evaluateGovernedOperation(operation) {
  const text = readRel(operation.file);
  const findings = [];
  if (!text) {
    findings.push({
      level: operation.risk,
      id: operation.id,
      file: operation.file,
      message: 'Governed bulk operation file is missing.',
    });
    return {
      ...operation,
      status: 'failed',
      missingTokens: operation.requiredTokens,
      forbiddenHits: [],
      findings,
    };
  }

  const missingTokens = operation.requiredTokens.filter(token => !text.includes(token));
  const forbiddenHits = (operation.forbiddenTokens || []).filter(token => text.includes(token));

  for (const token of missingTokens) {
    findings.push({
      level: operation.risk,
      id: operation.id,
      file: operation.file,
      message: `Missing required guard token: ${token}`,
    });
  }

  for (const token of forbiddenHits) {
    findings.push({
      level: operation.risk,
      id: operation.id,
      file: operation.file,
      message: `Forbidden token appears in this guarded operation: ${token}`,
    });
  }

  return {
    ...operation,
    status: findings.length > 0 ? 'failed' : 'passed',
    missingTokens,
    forbiddenHits,
    findings,
  };
}

function discoverRiskyActiveFiles() {
  const backendSrc = path.join(ROOT, 'backend', 'src');
  return walk(backendSrc)
    .filter(file => file.endsWith('.ts'))
    .map(file => ({
      abs: file,
      rel: normalizeRel(toPosix(path.relative(ROOT, file))),
      text: fs.readFileSync(file, 'utf8'),
    }))
    .filter(file => isActiveSource(file.rel))
    .flatMap(file => {
      const matches = [];
      const lines = file.text.split(/\r?\n/);
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import ')) return;
        if (!RISKY_PUBLIC_PATTERNS.some(pattern => pattern.test(line))) return;
        const isDatabaseCli = file.rel.startsWith('backend/src/database/') || file.rel.endsWith('/stress_test.ts') || file.rel === 'backend/src/stress_test.ts';
        const isRouteWrapper = file.rel.startsWith('backend/src/routes/');
        const isUpdateManyClaim = /\b(updateMany)\s*\(/.test(line) && /\b(claim|retryClaim|updated|updateOrderResult)\b/i.test(line);
        matches.push({
          file: file.rel,
          line: index + 1,
          text: trimmed,
          governed: GOVERNED_OPERATIONS.some(operation => operation.file === file.rel),
          safeLocalSync: SAFE_WATCHLIST_PATTERNS.some(pattern => pattern.test(line)) || isDatabaseCli || isRouteWrapper || isUpdateManyClaim,
          hasRetryOrExclusiveGuard: /withDbRetry|InFlight|runExclusive|BACKUP_OPERATION_IN_PROGRESS|AbortSignal\.timeout/.test(file.text)
            || /BackupService\.(performBackup|restoreBackup)/.test(line),
          isDatabaseCli,
          isRouteWrapper,
          isUpdateManyClaim,
        });
      });
      return matches;
    });
}

function buildMarkdown(report) {
  const lines = [
    '# Bulk Write Singleflight Governance Audit v1',
    '',
    `- status: ${report.status}`,
    `- governed operations: ${report.summary.governedOperations}`,
    `- failed governed operations: ${report.summary.failedGovernedOperations}`,
    `- risky active matches: ${report.summary.riskyActiveMatches}`,
    `- ungoverned P0 findings: ${report.summary.p0Findings}`,
    '',
    '## Governed Operations',
    '',
  ];

  for (const operation of report.governedOperations) {
    lines.push(`- ${operation.status.toUpperCase()} ${operation.risk} ${operation.id}: ${operation.file}`);
    if (operation.missingTokens.length) {
      lines.push(`  - missing: ${operation.missingTokens.join(', ')}`);
    }
    if (operation.forbiddenHits.length) {
      lines.push(`  - forbidden: ${operation.forbiddenHits.join(', ')}`);
    }
  }

  lines.push('', '## Watchlist', '');
  for (const item of report.watchlist.slice(0, 80)) {
    lines.push(`- ${item.file}:${item.line} ${item.text}`);
  }

  if (report.watchlist.length === 0) {
    lines.push('- none');
  }

  lines.push('', '## Findings', '');
  for (const finding of report.findings) {
    lines.push(`- ${finding.level} ${finding.id} ${finding.file}: ${finding.message}`);
  }
  if (report.findings.length === 0) {
    lines.push('- none');
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  ensureDir(OUTPUT_DIR);

  const governedOperations = GOVERNED_OPERATIONS.map(evaluateGovernedOperation);
  const findings = governedOperations.flatMap(operation => operation.findings);
  const riskyMatches = discoverRiskyActiveFiles();
  const watchlist = riskyMatches.filter(match => !match.governed);

  for (const match of watchlist) {
    const isRuntimeBulkWrite = !match.isDatabaseCli
      && !match.isRouteWrapper
      && !match.isUpdateManyClaim
      && /syncAll|restoreBackup|performBackup|rebuild|repair|createMany|deleteMany/.test(match.text);
    if (!match.safeLocalSync && !match.hasRetryOrExclusiveGuard && isRuntimeBulkWrite) {
      findings.push({
        level: 'P1',
        id: 'ungoverned-bulk-write-watch',
        file: match.file,
        line: match.line,
        message: `Risky bulk/write-looking line lacks an obvious retry, exclusive, or timebox guard: ${match.text}`,
      });
    }
  }

  const p0Findings = findings.filter(finding => finding.level === 'P0').length;
  const status = p0Findings > 0 ? 'failed' : 'passed';
  const report = {
    name: 'bulk-write-singleflight-governance-audit-v1',
    status,
    generatedAt: new Date().toISOString(),
    summary: {
      governedOperations: governedOperations.length,
      failedGovernedOperations: governedOperations.filter(operation => operation.status !== 'passed').length,
      riskyActiveMatches: riskyMatches.length,
      watchlistMatches: watchlist.length,
      p0Findings,
      findingCount: findings.length,
    },
    governedOperations,
    watchlist,
    findings,
  };

  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(MD_REPORT, buildMarkdown(report), 'utf8');

  console.log(JSON.stringify({
    status: report.status,
    summary: report.summary,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));

  if (report.status !== 'passed') {
    process.exitCode = 1;
  }
}

main();
