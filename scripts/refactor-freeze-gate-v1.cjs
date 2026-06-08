const fs = require('fs');
const path = require('path');
const {
  isActiveSource,
  isIgnoredTopLevel,
  isSourceLike,
  normalizeRel,
  toPosix,
} = require('./lib/active-source-scope.cjs');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'refactor-freeze-gate-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'refactor-freeze-gate-v1.md');

const CODE_EXTENSIONS = new Set(['.cjs', '.css', '.js', '.jsx', '.mjs', '.ps1', '.ts', '.tsx']);

const RUNTIME_ROOTS = [
  'app/',
  'backend/src/',
  'components/',
  'pages/',
  'services/',
  'utils/',
  'translations/',
];

const WATCHLIST = new Map([
  ['pages/sales-orders/useSalesOrders.ts', 'Sales order UI hook: split only when changing order/payment interaction.'],
  ['backend/src/services/collection.service.ts', 'Receivable/payment service: split only with API + browser readback evidence.'],
  ['backend/src/services/order-workspace.service.ts', 'Order workbench read model: split only when report/read model ownership changes.'],
  ['backend/src/services/finance-summary.service.ts', 'Finance summary: split only when finance formula evidence exists.'],
  ['pages/ProductionWorkspaceV2.tsx', 'Production shell: prefer extracting UI pieces only with browser proof.'],
  ['pages/crm/useCRM.tsx', 'CRM master-data hook: split only when preserving multi-name/address/contact flows.'],
]);

function rel(fullPath) {
  return normalizeRel(toPosix(path.relative(ROOT, fullPath)));
}

function walk(dir, files = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const relative = rel(full);
    if (entry.isDirectory()) {
      if (!isIgnoredTopLevel(relative)) walk(full, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isSourceLike(relative)) continue;
    if (!isActiveSource(relative)) continue;
    if (!CODE_EXTENSIONS.has(path.extname(entry.name))) continue;
    files.push(full);
  }
  return files;
}

function countLines(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r\n|\r|\n/).length;
}

function classify(relativePath) {
  const normalized = normalizeRel(relativePath);
  if (normalized.startsWith('scripts/')) return 'audit-script';
  if (normalized.startsWith('translations/')) return 'translation';
  if (RUNTIME_ROOTS.some(root => normalized.startsWith(root)) || ['App.tsx', 'index.tsx', 'types.ts'].includes(normalized)) {
    return 'runtime';
  }
  return 'other-active';
}

function thresholds(kind) {
  if (kind === 'audit-script') return { soft: 600, hard: 900 };
  if (kind === 'translation') return { soft: 900, hard: 1600 };
  if (kind === 'runtime') return { soft: 500, hard: 650 };
  return { soft: 600, hard: 900 };
}

function main() {
  const files = walk(ROOT);
  const items = files.map(filePath => {
    const relativePath = rel(filePath);
    const kind = classify(relativePath);
    const limits = thresholds(kind);
    const lines = countLines(filePath);
    const watchReason = WATCHLIST.get(relativePath) || '';
    let level = 'ok';
    let decision = 'no refactor needed';

    if (lines > limits.hard) {
      level = 'blocker';
      decision = 'requires explicit refactor plan before further feature work';
    } else if (lines > limits.soft || watchReason) {
      level = 'watch';
      decision = 'do not split unless a real bug or active change touches this boundary';
    }

    return {
      path: relativePath,
      kind,
      lines,
      softLimit: limits.soft,
      hardLimit: limits.hard,
      level,
      decision,
      watchReason,
    };
  }).sort((a, b) => b.lines - a.lines);

  const blockers = items.filter(item => item.level === 'blocker');
  const watch = items.filter(item => item.level === 'watch');
  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      purpose: 'Freeze broad refactors. Split only when evidence shows a real maintenance or runtime risk.',
    },
    status: blockers.length === 0 ? 'passed' : 'failed',
    summary: {
      scannedFiles: items.length,
      blockers: blockers.length,
      watch: watch.length,
      largest: items.slice(0, 20),
    },
    policy: {
      runtime: 'Runtime files above 650 lines block broad feature work; 500-650 lines are watch-only, not automatic split targets.',
      auditScripts: 'Audit scripts can be longer because they are not runtime business code; split only if repeated false positives appear.',
      translations: 'Translation dictionaries are not split by line count unless lookup ownership becomes unclear.',
      financeStockPayment: 'Money, stock, payment, order status, and permissions must not be split without API and browser readback evidence.',
    },
    blockers,
    watch,
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const md = [];
  md.push('# Refactor Freeze Gate v1');
  md.push('');
  md.push(`- status: ${report.status}`);
  md.push(`- generated: ${report.meta.generatedAt}`);
  md.push(`- scanned files: ${report.summary.scannedFiles}`);
  md.push(`- blockers: ${report.summary.blockers}`);
  md.push(`- watch: ${report.summary.watch}`);
  md.push('');
  md.push('## Policy');
  for (const [key, value] of Object.entries(report.policy)) {
    md.push(`- ${key}: ${value}`);
  }
  md.push('');
  md.push('## Blockers');
  if (blockers.length === 0) md.push('- none');
  for (const item of blockers) {
    md.push(`- ${item.path} (${item.lines} lines): ${item.decision}`);
  }
  md.push('');
  md.push('## Watch List');
  if (watch.length === 0) md.push('- none');
  for (const item of watch.slice(0, 40)) {
    const reason = item.watchReason ? ` reason=${item.watchReason}` : '';
    md.push(`- ${item.path} (${item.lines} lines, ${item.kind}): ${item.decision}${reason}`);
  }
  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');

  console.log(JSON.stringify({
    status: report.status,
    summary: report.summary,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));

  if (report.status !== 'passed') process.exitCode = 1;
}

main();
