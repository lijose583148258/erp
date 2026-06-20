import type { TableData } from './tableImport.service';

export type ImportModuleKey =
  | 'customers'
  | 'suppliers'
  | 'salesOrderLines'
  | 'productionBomLines'
  | 'warehouseOpeningStock'
  | 'purchaseOrderLines'
  | 'barterBatches';

export type ImportFieldType = 'text' | 'number' | 'date' | 'boolean' | 'enum' | 'json';

export interface ImportFieldSpec {
  key: string;
  label: string;
  aliases: string[];
  type: ImportFieldType;
  required?: boolean;
  enumValues?: string[];
  example?: string;
  note?: string;
}

export interface ImportModuleSpec {
  key: ImportModuleKey;
  label: string;
  mode: 'excel-first' | 'form-first' | 'dual-track';
  uniqueKeys: string[];
  maxRows: number;
  fields: ImportFieldSpec[];
  warnings?: string[];
}

export interface ImportValidationError {
  row: number;
  field?: string;
  message: string;
}

export interface ImportPreviewRow {
  row: number;
  data: Record<string, string | number | boolean | null>;
  errors: ImportValidationError[];
}

export interface ImportPreviewResult {
  module: ImportModuleKey;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: ImportValidationError[];
  rows: ImportPreviewRow[];
}

const commonNameAliases = ['名称', 'name', 'Name', '公司名称', 'company', 'Company'];

const moduleSpecs: Record<ImportModuleKey, ImportModuleSpec> = {
  customers: {
    key: 'customers',
    label: '客户主数据',
    mode: 'dual-track',
    uniqueKeys: ['nameZh', 'nameEn', 'nameVi', 'licenseNumber'],
    maxRows: 500,
    warnings: ['客户导入只处理客户作用域，不混入供应商。多地址和多联系人建议使用子表模板。'],
    fields: [
      { key: 'nameZh', label: '中文名', aliases: ['中文名', '客户中文名', 'name_zh', 'nameZh', ...commonNameAliases], type: 'text', required: true, example: '爱牢达客户有限公司' },
      { key: 'nameEn', label: '英文名', aliases: ['英文名', '客户英文名', 'name_en', 'nameEn'], type: 'text', example: 'Ailao Customer Co., Ltd.' },
      { key: 'nameVi', label: '越文名', aliases: ['越文名', '客户越文名', 'name_vi', 'nameVi'], type: 'text', example: 'Cong ty Khach hang Ailao' },
      { key: 'licenseNumber', label: '营业执照/税号', aliases: ['营业执照', '统一社会信用代码', '税号', 'licenseNumber', 'taxNo'], type: 'text', example: 'PENDING' },
      { key: 'contactName', label: '主联系人', aliases: ['联系人', '主联系人', 'contactName'], type: 'text', example: '张经理' },
      { key: 'contactPhone', label: '联系电话', aliases: ['电话', '手机号', '联系电话', 'contactPhone'], type: 'text', example: '13800138000' },
      { key: 'address', label: '主地址', aliases: ['地址', '主地址', 'address'], type: 'text', example: '越南胡志明市工业园区88号' },
      { key: 'riskLevel', label: '风险等级', aliases: ['风险等级', 'riskLevel'], type: 'enum', enumValues: ['low', 'medium', 'high', 'critical'], example: 'low' },
    ],
  },
  suppliers: {
    key: 'suppliers',
    label: '供应商主数据',
    mode: 'dual-track',
    uniqueKeys: ['nameZh', 'nameEn', 'nameVi', 'licenseNumber'],
    maxRows: 500,
    warnings: ['供应商导入只处理供应商作用域，不混入客户搜索结果。'],
    fields: [
      { key: 'nameZh', label: '中文名', aliases: ['中文名', '供应商中文名', 'nameZh', ...commonNameAliases], type: 'text', required: true, example: '爱牢达供应商总部' },
      { key: 'nameEn', label: '英文名', aliases: ['英文名', '供应商英文名', 'nameEn'], type: 'text', example: 'Ailao Supplier' },
      { key: 'nameVi', label: '越文名', aliases: ['越文名', '供应商越文名', 'nameVi'], type: 'text', example: 'Nha cung cap Ailao' },
      { key: 'category', label: '供应商分类', aliases: ['分类', '供应商分类', 'category'], type: 'text', example: '化工原料' },
      { key: 'contact', label: '主联系人', aliases: ['联系人', '主联系人', 'contact'], type: 'text', example: '李采购' },
      { key: 'leadTimeDays', label: '交期天数', aliases: ['交期', '交期天数', 'leadTimeDays'], type: 'number', example: '7' },
      { key: 'riskLevel', label: '风险等级', aliases: ['风险等级', 'riskLevel'], type: 'enum', enumValues: ['low', 'medium', 'high'], example: 'low' },
    ],
  },
  salesOrderLines: {
    key: 'salesOrderLines',
    label: '销售订单明细',
    mode: 'excel-first',
    uniqueKeys: ['productName', 'batchNo'],
    maxRows: 500,
    fields: [
      { key: 'productName', label: '品名', aliases: ['品名', '产品名称', 'productName'], type: 'text', required: true, example: '胶水 A' },
      { key: 'packagingSpec', label: '规格', aliases: ['规格', '包装规格', 'packagingSpec'], type: 'text', example: '25kg/桶' },
      { key: 'quantity', label: '数量', aliases: ['数量', 'quantity', 'qty'], type: 'number', required: true, example: '20' },
      { key: 'unit', label: '单位', aliases: ['单位', 'unit'], type: 'text', example: '桶' },
      { key: 'unitPrice', label: '单价', aliases: ['单价', 'unitPrice', 'price'], type: 'number', required: true, example: '180' },
      { key: 'discount', label: '折扣', aliases: ['折扣', 'discount'], type: 'number', example: '0' },
      { key: 'taxAmount', label: '税额', aliases: ['税额', 'taxAmount'], type: 'number', example: '23' },
      { key: 'batchNo', label: '批号', aliases: ['批号', '批次', 'batchNo'], type: 'text', example: 'BATCH-2026-001' },
    ],
  },
  productionBomLines: {
    key: 'productionBomLines',
    label: '生产 BOM 原料明细',
    mode: 'excel-first',
    uniqueKeys: ['materialCode', 'materialName'],
    maxRows: 500,
    fields: [
      { key: 'materialName', label: '物料名称', aliases: ['物料名称', '原料名称', 'materialName'], type: 'text', example: '可留空' },
      { key: 'materialCode', label: '保密代号/编码', aliases: ['保密代号', '物料编码', '原料编码', 'materialCode'], type: 'text', example: 'R-001' },
      { key: 'ingredientRole', label: '组分角色', aliases: ['组分角色', '角色', 'ingredientRole'], type: 'enum', enumValues: ['main_resin', 'modifier_resin', 'tackifier', 'curing_agent', 'crosslinker', 'solvent', 'diluent', 'pigment', 'surfactant', 'defoamer', 'thickener', 'preservative', 'ph_adjuster', 'catalyst', 'additive', 'recycled', 'package', 'other'], example: 'main_resin' },
      { key: 'dosageMode', label: '计量模式', aliases: ['计量模式', 'dosageMode'], type: 'enum', enumValues: ['fixed', 'percentage'], example: 'percentage' },
      { key: 'percentage', label: '百分比', aliases: ['百分比', '比例', 'percentage'], type: 'number', example: '70' },
      { key: 'quantityPerUnit', label: '单耗', aliases: ['单耗', 'quantityPerUnit'], type: 'number', example: '700' },
      { key: 'unit', label: '单位', aliases: ['单位', 'unit'], type: 'text', example: 'kg' },
      { key: 'lossRate', label: '损耗率', aliases: ['损耗率', 'lossRate'], type: 'number', example: '1.2' },
      { key: 'processStage', label: '工艺阶段', aliases: ['工艺阶段', 'processStage'], type: 'text', example: '预混' },
    ],
  },
  warehouseOpeningStock: {
    key: 'warehouseOpeningStock',
    label: '仓储期初/盘点库存',
    mode: 'dual-track',
    uniqueKeys: ['warehouseCode', 'locationCode', 'productName', 'batchNo'],
    maxRows: 500,
    warnings: ['期初库存和盘点导入必须生成库存凭证，不能直接覆盖库存余额。'],
    fields: [
      { key: 'warehouseCode', label: '仓库编码', aliases: ['仓库编码', 'warehouseCode'], type: 'text', required: true, example: 'WH-MAIN' },
      { key: 'locationCode', label: '库位编码', aliases: ['库位编码', 'locationCode'], type: 'text', required: true, example: 'LOC-RAW' },
      { key: 'productName', label: '产品/物料名称', aliases: ['产品名称', '物料名称', 'productName'], type: 'text', required: true, example: '环氧树脂' },
      { key: 'batchNo', label: '批号', aliases: ['批号', '批次', 'batchNo'], type: 'text', required: true, example: 'OPEN-2026-001' },
      { key: 'quantity', label: '数量', aliases: ['数量', 'quantity'], type: 'number', required: true, example: '1000' },
      { key: 'unit', label: '单位', aliases: ['单位', 'unit'], type: 'text', example: 'kg' },
      { key: 'unitCost', label: '成本单价', aliases: ['成本单价', 'unitCost'], type: 'number', example: '12.5' },
      { key: 'expiryDate', label: '效期', aliases: ['效期', '到期日', 'expiryDate'], type: 'date', example: '2026-12-31' },
    ],
  },
  purchaseOrderLines: {
    key: 'purchaseOrderLines',
    label: '采购订单明细',
    mode: 'dual-track',
    uniqueKeys: ['item'],
    maxRows: 500,
    fields: [
      { key: 'item', label: '采购品名', aliases: ['采购品名', '物料名称', 'item'], type: 'text', required: true, example: '环氧树脂' },
      { key: 'quantity', label: '数量', aliases: ['数量', 'quantity'], type: 'number', required: true, example: '1000' },
      { key: 'unit', label: '单位', aliases: ['单位', 'unit'], type: 'text', example: 'kg' },
      { key: 'price', label: '单价', aliases: ['单价', 'price'], type: 'number', required: true, example: '12.5' },
      { key: 'eta', label: '预计到货', aliases: ['预计到货', 'eta'], type: 'date', example: '2026-05-01' },
    ],
  },
  barterBatches: {
    key: 'barterBatches',
    label: '货抵分批交付/抵扣',
    mode: 'dual-track',
    uniqueKeys: ['batchNo', 'side'],
    maxRows: 500,
    warnings: ['货抵导入只作为明细草稿，最终抵扣仍需人工确认市场价快照和差额现金。'],
    fields: [
      { key: 'side', label: '方向', aliases: ['方向', 'side'], type: 'enum', enumValues: ['our', 'counterparty'], required: true, example: 'counterparty' },
      { key: 'batchNo', label: '批号', aliases: ['批号', '批次', 'batchNo'], type: 'text', required: true, example: 'BARTER-001' },
      { key: 'itemName', label: '货物名称', aliases: ['货物名称', '品名', 'itemName'], type: 'text', required: true, example: '板材' },
      { key: 'quantity', label: '数量', aliases: ['数量', 'quantity'], type: 'number', required: true, example: '600' },
      { key: 'unit', label: '单位', aliases: ['单位', 'unit'], type: 'text', example: '方' },
      { key: 'unitPrice', label: '估值单价', aliases: ['估值单价', 'unitPrice'], type: 'number', required: true, example: '380' },
      { key: 'currency', label: '币种', aliases: ['币种', 'currency'], type: 'enum', enumValues: ['CNY', 'USD', 'VND'], example: 'CNY' },
    ],
  },
};

export const importExportCenterService = {
  getModuleSpecs(): ImportModuleSpec[] {
    return Object.values(moduleSpecs);
  },

  getModuleSpec(module: ImportModuleKey): ImportModuleSpec {
    return moduleSpecs[module];
  },

  buildTemplateCsv(module: ImportModuleKey): string {
    const spec = this.getModuleSpec(module);
    const header = spec.fields.map((field) => escapeCsv(field.label)).join(',');
    const example = spec.fields.map((field) => escapeCsv(field.example || '')).join(',');
    return `${header}\r\n${example}\r\n`;
  },

  validateTable(module: ImportModuleKey, table: TableData): ImportPreviewResult {
    const spec = this.getModuleSpec(module);
    const headerMap = createHeaderMap(spec, table.headers);
    const errors: ImportValidationError[] = [];

    if (table.rows.length > spec.maxRows) {
      errors.push({
        row: spec.maxRows + 1,
        message: `单次最多导入 ${spec.maxRows} 行，超出部分需要拆分文件。`,
      });
    }

    for (const field of spec.fields) {
      if (field.required && headerMap[field.key] == null) {
        errors.push({ row: 1, field: field.key, message: `缺少必填列：${field.label}` });
      }
    }

    const rows = table.rows.slice(0, spec.maxRows).map((row, index) => {
      const rowErrors: ImportValidationError[] = [];
      const data: Record<string, string | number | boolean | null> = {};

      for (const field of spec.fields) {
        const columnIndex = headerMap[field.key];
        const rawValue = columnIndex == null ? '' : String(row[columnIndex] ?? '').trim();
        const value = coerceValue(rawValue, field);

        if (field.required && (rawValue === '' || value == null)) {
          rowErrors.push({ row: index + 2, field: field.key, message: `${field.label}不能为空` });
        }

        if (rawValue && field.type === 'number' && typeof value !== 'number') {
          rowErrors.push({ row: index + 2, field: field.key, message: `${field.label}必须是数字` });
        }

        if (rawValue && field.type === 'enum' && field.enumValues && !field.enumValues.includes(String(value))) {
          rowErrors.push({
            row: index + 2,
            field: field.key,
            message: `${field.label}必须是以下值之一：${field.enumValues.join(', ')}`,
          });
        }

        data[field.key] = value;
      }

      if (module === 'productionBomLines' && !data.materialName && !data.materialCode) {
        rowErrors.push({
          row: index + 2,
          field: 'materialCode',
          message: 'BOM 原料明细至少需要填写物料名称或保密代号/编码',
        });
      }

      errors.push(...rowErrors);
      return { row: index + 2, data, errors: rowErrors };
    });

    return {
      module,
      totalRows: table.rows.length,
      validRows: rows.filter((row) => row.errors.length === 0).length,
      invalidRows: rows.filter((row) => row.errors.length > 0).length,
      errors,
      rows,
    };
  },
};

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '');

const createHeaderMap = (spec: ImportModuleSpec, headers: string[]) => {
  const normalizedHeaders = headers.map(normalizeHeader);
  const map: Record<string, number | undefined> = {};

  for (const field of spec.fields) {
    const names = [field.label, field.key, ...field.aliases].map(normalizeHeader);
    map[field.key] = normalizedHeaders.findIndex((header) => names.includes(header));
    if (map[field.key] === -1) map[field.key] = undefined;
  }

  return map;
};

const coerceValue = (value: string, field: ImportFieldSpec) => {
  if (!value) return null;

  if (field.type === 'number') {
    const numeric = Number(value.replace(/,/g, ''));
    return Number.isFinite(numeric) ? numeric : value;
  }

  if (field.type === 'boolean') {
    if (['true', '1', '是', 'yes', 'y'].includes(value.toLowerCase())) return true;
    if (['false', '0', '否', 'no', 'n'].includes(value.toLowerCase())) return false;
    return value;
  }

  return value;
};

const escapeCsv = (value: string) => {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
};

export default importExportCenterService;
