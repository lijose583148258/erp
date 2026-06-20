const fs = require('fs');
const path = require('path');
const { isActiveSource } = require('./lib/active-source-scope.cjs');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'document-responsibility-gate-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'document-responsibility-gate-v1.md');

const SOURCE_ROOTS = ['pages', 'components'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

const DOCUMENT_RULES = [
  {
    code: 'customer-create-owned-by-crm',
    document: 'customer-master-data',
    patterns: [/新增客户/g, /新建客户/g, /客户建档/g],
    allowedPrefixes: ['pages/CRM.tsx', 'pages/crm/'],
    severity: 'P0',
    message: 'Customer creation must stay in CRM/customer master-data screens.',
  },
  {
    code: 'supplier-create-owned-by-procurement',
    document: 'supplier-master-data',
    patterns: [/新增供应商/g, /新建供应商/g, /供应商建档/g],
    allowedPrefixes: ['pages/Procurement.tsx', 'pages/procurement/'],
    severity: 'P0',
    message: 'Supplier creation must stay in procurement/supplier master-data screens.',
  },
  {
    code: 'barter-create-owned-by-barter',
    document: 'barter-settlement',
    patterns: [/新建货抵/g, /货抵结算/g, /换货贸易/g],
    allowedPrefixes: ['pages/BarterWorkspace.tsx', 'pages/BarterWorkspaceView.tsx', 'pages/barter/', 'components/navigation/moduleRegistry.ts'],
    severity: 'P0',
    message: 'Barter settlement creation must stay in the barter workspace.',
  },
  {
    code: 'production-bom-owned-by-production',
    document: 'production-bom-formula',
    patterns: [/BOM管理/g, /BOM明细/g, /化工配方/g, /配方明细/g],
    allowedPrefixes: ['pages/ProductionWorkspace.tsx', 'pages/ProductionWorkspaceV2.tsx', 'pages/production/'],
    severity: 'P0',
    message: 'BOM/formula editing must stay in production screens.',
  },
  {
    code: 'warehouse-master-owned-by-warehouse',
    document: 'warehouse-master-data',
    patterns: [/新增仓库/g, /新增库位/g, /仓库管理/g, /库位管理/g],
    allowedPrefixes: ['pages/WarehouseWorkspace.tsx', 'pages/warehouse/'],
    severity: 'P0',
    message: 'Warehouse and location master-data actions must stay in warehouse management.',
  },
  {
    code: 'shipping-create-owned-by-shipping',
    document: 'shipping-document',
    patterns: [/新建发货/g, /发货登记/g, /签收登记/g],
    allowedPrefixes: ['pages/Shipping.tsx'],
    severity: 'P0',
    message: 'Shipping and receipt-sign actions must stay in shipping screens.',
  },
  {
    code: 'receipt-discrepancy-owned-by-discrepancy-workbench',
    document: 'receipt-discrepancy',
    patterns: [/差异处理/g, /收发货差异/g],
    allowedPrefixes: [
      'pages/ReceiptDiscrepancyWorkbench.tsx',
      'pages/receiptDiscrepancyWorkbench.columns.tsx',
      'pages/receiptDiscrepancyWorkbench.config.ts',
      'components/navigation/moduleRegistry.ts',
    ],
    severity: 'P0',
    message: 'Receipt discrepancy processing must stay in the discrepancy workbench.',
  },
];

const LEGACY_NAME_RULES = [
  {
    code: 'no-visible-timber-era-label',
    patterns: [/木材/g],
    allowedPrefixes: ['pages/TimberWorkspace.tsx'],
    severity: 'P0',
    message: 'Old timber-specific wording must not reappear in active user-facing screens; use barter/payment-in-goods wording.',
  },
  {
    code: 'timber-compat-only',
    patterns: [/\btimber\b/gi],
    allowedPrefixes: [
      'pages/TimberWorkspace.tsx',
      'backend/src/routes/timber.routes.ts',
      'scripts/legacy-interface-disconnect-audit-v1.cjs',
      'scripts/lib/active-source-scope.cjs',
    ],
    severity: 'P1',
    message: 'Timber references should be compatibility-only, not active business wording.',
  },
];

const LOCAL_CONFLICT_RULES = [
  {
    code: 'bom-management-detail-split',
    requiredPatterns: [/BOM管理/, /BOM明细/],
    severity: 'P1',
    message: 'BOM management and BOM line-detail wording appear in the same file; confirm the page separates header/formula list from editable line grid.',
  },
  {
    code: 'customer-supplier-create-mixed',
    requiredPatterns: [/新增客户|新建客户|客户建档/, /新增供应商|新建供应商|供应商建档/],
    severity: 'P1',
    message: 'Customer and supplier creation labels appear in the same file; confirm master-data duties are not merged into one confusing entry.',
  },
];

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function rel(filePath) {
  return toPosix(path.relative(ROOT, filePath));
}

function walk(dir, files) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'output'].includes(entry.name)) continue;
      walk(full, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    const relative = rel(full);
    if (!isActiveSource(relative)) continue;
    files.push(full);
  }
}

function isAllowed(relative, allowedPrefixes) {
  return allowedPrefixes.some(prefix => relative === prefix || relative.startsWith(prefix));
}

function isCommentLike(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('*/');
}

function isBoundaryReference(line) {
  return /不直接|不替代|交给|进入|承接|分别负责|说明|只记录|再进入/.test(line);
}

function findPatternHits(text, patterns) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isCommentLike(line)) continue;
    if (isBoundaryReference(line)) continue;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        hits.push({
          line: index + 1,
          excerpt: line.trim().slice(0, 180),
          pattern: pattern.toString(),
        });
      }
    }
  }
  return hits;
}

function addFinding(findings, severity, rule, file, hit, message, extra = {}) {
  findings.push({
    severity,
    rule,
    file,
    line: hit ? hit.line : 1,
    message,
    excerpt: hit ? hit.excerpt : '',
    ...extra,
  });
}

function buildMarkdown(report) {
  const lines = [
    '# Document Responsibility Gate v1',
    '',
    `- status: ${report.status}`,
    `- scannedFiles: ${report.scannedFiles}`,
    `- p0Count: ${report.summary.p0Count}`,
    `- p1Count: ${report.summary.p1Count}`,
    `- destructiveActionsPerformed: 0`,
    '',
    '## Findings',
    '',
  ];

  if (!report.findings.length) {
    lines.push('No document responsibility conflicts were found by this gate.');
  } else {
    lines.push('| Severity | Rule | File | Line | Message |');
    lines.push('| --- | --- | --- | ---: | --- |');
    for (const finding of report.findings) {
      lines.push(`| ${finding.severity} | ${finding.rule} | ${finding.file} | ${finding.line} | ${finding.message.replace(/\|/g, '/')} |`);
    }
  }

  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- This is a conservative static gate. It does not decide final UX quality by itself.');
  lines.push('- P0 means a likely document ownership leak. P1 means a page needs human review before changing behavior.');
  lines.push('- This script is report-only and never edits data or source files.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const files = [];
  for (const root of SOURCE_ROOTS) walk(path.join(ROOT, root), files);

  const findings = [];
  const inventory = [];

  for (const file of files) {
    const relative = rel(file);
    const text = fs.readFileSync(file, 'utf8');

    for (const rule of DOCUMENT_RULES) {
      const hits = findPatternHits(text, rule.patterns);
      if (!hits.length) continue;
      inventory.push({
        file: relative,
        document: rule.document,
        hits: hits.length,
        allowed: isAllowed(relative, rule.allowedPrefixes),
      });
      if (!isAllowed(relative, rule.allowedPrefixes)) {
        for (const hit of hits.slice(0, 5)) {
          addFinding(findings, rule.severity, rule.code, relative, hit, rule.message, {
            document: rule.document,
          });
        }
      }
    }

    for (const rule of LEGACY_NAME_RULES) {
      const hits = findPatternHits(text, rule.patterns);
      if (!hits.length || isAllowed(relative, rule.allowedPrefixes)) continue;
      for (const hit of hits.slice(0, 5)) {
        addFinding(findings, rule.severity, rule.code, relative, hit, rule.message);
      }
    }

    for (const rule of LOCAL_CONFLICT_RULES) {
      const matched = rule.requiredPatterns.every(pattern => {
        pattern.lastIndex = 0;
        return pattern.test(text);
      });
      if (!matched) continue;
      addFinding(findings, rule.severity, rule.code, relative, null, rule.message);
    }
  }

  const p0Count = findings.filter(item => item.severity === 'P0').length;
  const p1Count = findings.filter(item => item.severity === 'P1').length;
  const report = {
    status: p0Count > 0 ? 'failed' : (p1Count > 0 ? 'review' : 'passed'),
    mode: 'report-only',
    summary: {
      p0Count,
      p1Count,
      scannedFiles: files.length,
      inventoryItems: inventory.length,
      destructiveActionsPerformed: 0,
    },
    scannedFiles: files.length,
    findings,
    inventory,
    reports: {
      json: JSON_REPORT,
      markdown: MD_REPORT,
    },
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(MD_REPORT, buildMarkdown(report), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (p0Count > 0) process.exitCode = 1;
}

main();
