import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  importExportCenterService,
  type ImportFieldSpec,
  type ImportModuleKey,
} from '../services/importExportCenter.service';
import type { TableData } from '../services/tableImport.service';

type FindingLevel = 'P0' | 'P1' | 'P2';

interface Finding {
  level: FindingLevel;
  area: string;
  message: string;
}

interface CheckResult {
  name: string;
  status: 'passed' | 'failed';
  details?: Record<string, unknown>;
}

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const REPORT_PATH = path.join(OUTPUT_DIR, 'import-export-standardization-audit-v1.json');
const MD_PATH = path.join(OUTPUT_DIR, 'import-export-standardization-audit-v1.md');

const expectedModules: ImportModuleKey[] = [
  'customers',
  'suppliers',
  'salesOrderLines',
  'productionBomLines',
  'warehouseOpeningStock',
  'purchaseOrderLines',
  'barterBatches',
];

const requiredModuleFields: Record<ImportModuleKey, string[]> = {
  customers: ['nameZh', 'nameEn', 'nameVi', 'contactName', 'contactPhone', 'address'],
  suppliers: ['nameZh', 'nameEn', 'nameVi', 'category', 'contact', 'leadTimeDays', 'riskLevel'],
  salesOrderLines: ['productName', 'quantity', 'unitPrice'],
  productionBomLines: ['materialCode', 'ingredientRole', 'dosageMode', 'unit', 'lossRate'],
  warehouseOpeningStock: ['warehouseCode', 'locationCode', 'productName', 'batchNo', 'quantity'],
  purchaseOrderLines: ['item', 'quantity', 'price', 'eta'],
  barterBatches: ['side', 'batchNo', 'itemName', 'quantity', 'unitPrice'],
};

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function parseTemplate(csv: string): TableData {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  return {
    headers: parseCsvLine(lines[0] || ''),
    rows: lines.slice(1).map(parseCsvLine),
  };
}

function valueForField(field: ImportFieldSpec): string {
  if (field.example) return field.example;
  if (field.enumValues?.length) return field.enumValues[0];
  if (field.type === 'number') return '1';
  if (field.type === 'boolean') return 'true';
  if (field.type === 'date') return '2026-04-23';
  return `${field.label || field.key}-示例`;
}

function buildValidTable(module: ImportModuleKey): TableData {
  const spec = importExportCenterService.getModuleSpec(module);
  return {
    headers: spec.fields.map((field) => field.label),
    rows: [spec.fields.map(valueForField)],
  };
}

function buildRows(specFields: ImportFieldSpec[], count: number): string[][] {
  const row = specFields.map(valueForField);
  return Array.from({ length: count }, () => [...row]);
}

function addFinding(findings: Finding[], level: FindingLevel, area: string, message: string) {
  findings.push({ level, area, message });
}

function assert(condition: unknown, findings: Finding[], level: FindingLevel, area: string, message: string) {
  if (!condition) addFinding(findings, level, area, message);
}

function scanFakePersistenceClaims(findings: Finding[]) {
  const activeUiFiles = [
    path.join(ROOT, 'pages', 'TableImportTest.tsx'),
    path.join(ROOT, 'components', 'TableImport.tsx'),
    path.join(ROOT, 'components', 'DataTable.tsx'),
    path.join(ROOT, 'components', 'ui', 'EnterpriseDataGrid.tsx'),
  ];
  const forbiddenClaims = [
    /数据已保存到系统/,
    /导入成功！/,
    /已导入，由 UI 反馈用户/,
  ];

  for (const filePath of activeUiFiles) {
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, 'utf8');
    for (const pattern of forbiddenClaims) {
      if (pattern.test(text)) {
        addFinding(
          findings,
          'P0',
          'fake-persistence',
          `${path.relative(ROOT, filePath)} 存在会误导用户的导入已保存文案：${pattern}`,
        );
      }
    }
  }
}

function auditModule(module: ImportModuleKey, findings: Finding[], checks: CheckResult[]) {
  const spec = importExportCenterService.getModuleSpec(module);
  const fieldKeys = new Set(spec.fields.map((field) => field.key));
  const requiredFields = spec.fields.filter((field) => field.required);

  assert(Boolean(spec.label), findings, 'P1', module, '模块缺少显示名称');
  assert(spec.maxRows > 0 && spec.maxRows <= 500, findings, 'P1', module, '单次导入上限必须在 1-500 行之间');
  assert(spec.uniqueKeys.length > 0, findings, 'P1', module, '模块缺少唯一键策略');

  for (const field of requiredModuleFields[module]) {
    assert(fieldKeys.has(field), findings, 'P1', module, `模板缺少业务关键字段 ${field}`);
  }

  const template = parseTemplate(importExportCenterService.buildTemplateCsv(module));
  const templateHeaderSet = new Set(template.headers);
  for (const field of spec.fields) {
    assert(templateHeaderSet.has(field.label), findings, 'P1', module, `模板缺少列 ${field.label}`);
  }
  checks.push({
    name: `${module}:template`,
    status: template.headers.length === spec.fields.length && template.rows.length >= 1 ? 'passed' : 'failed',
    details: { headers: template.headers.length, fields: spec.fields.length, examples: template.rows.length },
  });

  const valid = importExportCenterService.validateTable(module, buildValidTable(module));
  assert(valid.invalidRows === 0, findings, 'P0', module, `标准模板示例行不应失败，实际失败 ${valid.invalidRows} 行`);
  checks.push({ name: `${module}:valid-example`, status: valid.invalidRows === 0 ? 'passed' : 'failed' });

  for (const requiredField of requiredFields) {
    const missingTable = buildValidTable(module);
    const index = missingTable.headers.indexOf(requiredField.label);
    if (index >= 0) {
      missingTable.headers.splice(index, 1);
      missingTable.rows = missingTable.rows.map((row) => {
        const next = [...row];
        next.splice(index, 1);
        return next;
      });
      const missingResult = importExportCenterService.validateTable(module, missingTable);
      assert(
        missingResult.errors.some((error) => error.field === requiredField.key),
        findings,
        'P0',
        module,
        `缺少必填列 ${requiredField.label} 时没有被拦截`,
      );
    }
  }

  const numericField = spec.fields.find((field) => field.type === 'number');
  if (numericField) {
    const invalidNumberTable = buildValidTable(module);
    const index = invalidNumberTable.headers.indexOf(numericField.label);
    invalidNumberTable.rows[0][index] = 'not-a-number';
    const invalidNumber = importExportCenterService.validateTable(module, invalidNumberTable);
    assert(
      invalidNumber.errors.some((error) => error.field === numericField.key),
      findings,
      'P0',
      module,
      `数字列 ${numericField.label} 输入非法值时没有被拦截`,
    );
  }

  const enumField = spec.fields.find((field) => field.type === 'enum');
  if (enumField) {
    const invalidEnumTable = buildValidTable(module);
    const index = invalidEnumTable.headers.indexOf(enumField.label);
    invalidEnumTable.rows[0][index] = '__invalid_enum__';
    const invalidEnum = importExportCenterService.validateTable(module, invalidEnumTable);
    assert(
      invalidEnum.errors.some((error) => error.field === enumField.key),
      findings,
      'P0',
      module,
      `枚举列 ${enumField.label} 输入非法值时没有被拦截`,
    );
  }

  const overflowTable = buildValidTable(module);
  overflowTable.rows = buildRows(spec.fields, spec.maxRows + 1);
  const overflow = importExportCenterService.validateTable(module, overflowTable);
  assert(
    overflow.rows.length === spec.maxRows && overflow.errors.some((error) => /最多导入/.test(error.message)),
    findings,
    'P1',
    module,
    '超出导入上限时没有生成可解释的截断错误',
  );
}

function auditProductionBomCodeOnly(findings: Finding[], checks: CheckResult[]) {
  const table = importExportCenterService.getModuleSpec('productionBomLines');
  const headers = table.fields.map((field) => field.label);
  const row = table.fields.map((field) => {
    if (field.key === 'materialName') return '';
    if (field.key === 'materialCode') return 'R-001';
    return valueForField(field);
  });
  const result = importExportCenterService.validateTable('productionBomLines', { headers, rows: [row] });
  assert(result.invalidRows === 0, findings, 'P0', 'productionBomLines', '保密配方只填原料代号时应允许通过');

  const emptyRow = table.fields.map((field) => {
    if (field.key === 'materialName' || field.key === 'materialCode') return '';
    return valueForField(field);
  });
  const emptyResult = importExportCenterService.validateTable('productionBomLines', { headers, rows: [emptyRow] });
  assert(emptyResult.invalidRows === 1, findings, 'P0', 'productionBomLines', 'BOM 物料名和代号都为空时必须拦截');
  checks.push({ name: 'productionBomLines:code-only-secret-material', status: result.invalidRows === 0 && emptyResult.invalidRows === 1 ? 'passed' : 'failed' });
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const startedAt = new Date();
  const findings: Finding[] = [];
  const checks: CheckResult[] = [];
  const specs = importExportCenterService.getModuleSpecs();
  const actualModules = specs.map((spec) => spec.key);

  for (const module of expectedModules) {
    assert(actualModules.includes(module), findings, 'P0', 'module-registry', `缺少导入导出模块 ${module}`);
  }
  for (const module of actualModules) {
    assert(expectedModules.includes(module), findings, 'P2', 'module-registry', `存在未纳入阶段 3 清单的导入导出模块 ${module}`);
  }

  for (const module of expectedModules) {
    if (actualModules.includes(module)) auditModule(module, findings, checks);
  }
  auditProductionBomCodeOnly(findings, checks);
  scanFakePersistenceClaims(findings);

  const status = findings.some((finding) => finding.level === 'P0') ? 'failed' : findings.length ? 'warning' : 'passed';
  const report = {
    audit: 'import-export-standardization-audit-v1',
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    expectedModules,
    actualModules,
    checks,
    findings,
  };
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    MD_PATH,
    [
      '# 导入导出标准化审计',
      '',
      `- 状态：${status}`,
      `- 模块数：${actualModules.length}`,
      `- P0 问题：${findings.filter((finding) => finding.level === 'P0').length}`,
      `- 报告：${path.relative(ROOT, REPORT_PATH)}`,
      '',
      '## 检查点',
      ...checks.map((check) => `- ${check.status === 'passed' ? 'PASS' : 'FAIL'} ${check.name}`),
      '',
      '## 发现',
      ...(findings.length ? findings.map((finding) => `- ${finding.level} ${finding.area}: ${finding.message}`) : ['- 无']),
      '',
    ].join('\n'),
    'utf8',
  );

  console.log(JSON.stringify({ status, findings: findings.length, reportPath: REPORT_PATH }, null, 2));
  if (status === 'failed') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
