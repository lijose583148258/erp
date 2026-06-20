import type { TableData } from '../tableImport.service';

export type ParsedFormType = 'customer' | 'order' | 'sample' | 'shipment' | 'unknown';
export type ParsedFormRecord = Record<string, unknown>;

export interface ContextData {
  orders?: unknown[];
  customers?: unknown[];
  samples?: unknown[];
  currentPage?: string;
  [key: string]: unknown;
}

export interface ParsedFormData {
  type: ParsedFormType;
  confidence: number;
  data: ParsedFormRecord[];
  suggestions: string[];
  warnings: string[];
}

type FieldMap = Record<string, number[]>;

export const recognizeAndParseTable = (tableData: TableData): ParsedFormData => {
  const headers = tableData.headers.map((header) => header.trim());
  const rows = tableData.rows.map((row) => row.map((cell) => cell.trim()));
  const type = detectTableType(headers);

  if (type === 'customer') return parseCustomerTable(headers, rows);
  if (type === 'order') return parseOrderTable(headers, rows);
  if (type === 'sample') return parseSampleTable(headers, rows);
  if (type === 'shipment') return parseShipmentTable(headers, rows);
  return parseGenericTable(headers, rows);
};

const detectTableType = (headers: string[]): ParsedFormType => {
  const headerText = normalize(headers.join(' '));
  const scores: Record<Exclude<ParsedFormType, 'unknown'>, number> = {
    customer: countMatches(headerText, ['客户', '公司', '联系人', '信用', 'customer', 'company', 'contact', 'credit', 'khach hang']),
    order: countMatches(headerText, ['订单', '产品', '数量', '金额', '价格', '批次', 'order', 'product', 'quantity', 'amount', 'price', 'batch']),
    sample: countMatches(headerText, ['样品', '规格', '寄送', '申请', 'sample', 'spec', 'ship', 'apply']),
    shipment: countMatches(headerText, ['物流', '运单', '发货', '快递', 'shipment', 'tracking', 'carrier', 'express']),
  };

  const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return winner && winner[1] > 0 ? winner[0] as ParsedFormType : 'unknown';
};

const parseCustomerTable = (headers: string[], rows: string[][]): ParsedFormData => {
  const fieldMap = createFieldMap(headers, {
    name: ['客户名称', '客户', '公司名称', '往来单位', 'customer', 'company', 'name'],
    contactPerson: ['联系人', '负责人', 'contact'],
    phone: ['电话', '手机', 'phone', 'tel', 'mobile'],
    email: ['邮箱', 'email', 'mail'],
    address: ['地址', 'address'],
    creditLimit: ['信用额度', '额度', 'credit', 'limit'],
    paymentTerms: ['账期', '付款方式', 'payment', 'terms'],
    businessLicense: ['营业执照', '统一社会信用代码', 'license'],
  });

  const data = rowsToRecords(rows, (row, index, warnings) => {
    const name = getFieldValue(row, fieldMap.name);
    if (!name) {
      warnings.push(`第 ${index + 2} 行缺少客户名称。`);
      return null;
    }

    return {
      name,
      contactPerson: getFieldValue(row, fieldMap.contactPerson),
      phone: getFieldValue(row, fieldMap.phone),
      email: getFieldValue(row, fieldMap.email),
      address: getFieldValue(row, fieldMap.address),
      creditLimit: parseNumber(getFieldValue(row, fieldMap.creditLimit)),
      paymentTerms: getFieldValue(row, fieldMap.paymentTerms) || '30天',
      businessLicense: getFieldValue(row, fieldMap.businessLicense),
      riskLevel: 'low',
      status: 'active',
    };
  });

  return buildParsedResult('customer', 0.9, data.records, [
    `识别到 ${data.records.length} 条客户记录。`,
    '请核对信用额度、账期和联系方式。',
  ], data.warnings);
};

const parseOrderTable = (headers: string[], rows: string[][]): ParsedFormData => {
  const fieldMap = createFieldMap(headers, {
    customer: ['客户', '往来单位', '公司', 'customer', 'company'],
    product: ['产品', '商品', '货物', '品名', 'product', 'item'],
    quantity: ['数量', '件数', 'quantity', 'qty'],
    unit: ['单位', 'unit'],
    price: ['单价', '价格', 'price'],
    amount: ['金额', '总价', '总金额', 'amount', 'total'],
    currency: ['币种', '货币', 'currency'],
    paymentTerms: ['账期', '付款方式', 'payment'],
    deliveryDate: ['交货日期', '发货日期', 'delivery', 'date'],
    casNo: ['cas', 'cas号', 'cas no', 'cas number'],
    purity: ['纯度', '含量', '浓度', 'purity'],
    batchNo: ['批次', '批号', 'lot', 'batch'],
    grade: ['等级', '级别', '规格等级', 'grade'],
  });

  const data = rowsToRecords(rows, (row, index, warnings) => {
    const customerName = getFieldValue(row, fieldMap.customer);
    const productName = getFieldValue(row, fieldMap.product);
    if (!customerName || !productName) {
      warnings.push(`第 ${index + 2} 行缺少客户名称或产品名称。`);
      return null;
    }

    const quantity = parseNumber(getFieldValue(row, fieldMap.quantity));
    const unitPrice = parseNumber(getFieldValue(row, fieldMap.price));
    const amount = parseNumber(getFieldValue(row, fieldMap.amount)) || quantity * unitPrice;

    return {
      customerName,
      items: [{
        productName,
        quantity,
        unit: getFieldValue(row, fieldMap.unit) || '件',
        unitPrice,
        amount,
        casNo: getFieldValue(row, fieldMap.casNo),
        purity: getFieldValue(row, fieldMap.purity),
        batchNo: getFieldValue(row, fieldMap.batchNo),
        grade: getFieldValue(row, fieldMap.grade),
      }],
      totalAmount: amount,
      currency: getFieldValue(row, fieldMap.currency) || 'CNY',
      paymentTerms: getFieldValue(row, fieldMap.paymentTerms) || '30天',
      deliveryDate: getFieldValue(row, fieldMap.deliveryDate),
      status: 'pending',
    };
  });

  return buildParsedResult('order', 0.86, data.records, [
    `识别到 ${data.records.length} 条订单记录。`,
    '请核对产品规格、单价、数量和交货日期。',
  ], data.warnings);
};

const parseSampleTable = (headers: string[], rows: string[][]): ParsedFormData => {
  const fieldMap = createFieldMap(headers, {
    customer: ['客户', '往来单位', 'customer'],
    product: ['产品', '样品名称', '品名', 'product'],
    specification: ['规格', 'spec', 'specification'],
    quantity: ['数量', 'quantity', 'qty'],
    weight: ['重量', 'weight'],
    shippingAddress: ['地址', '寄送地址', '收货地址', 'address'],
    contactPerson: ['联系人', '收件人', 'contact'],
    contactPhone: ['电话', '手机', 'phone'],
  });

  const data = rowsToRecords(rows, (row, index, warnings) => {
    const customerName = getFieldValue(row, fieldMap.customer);
    const productName = getFieldValue(row, fieldMap.product);
    if (!customerName || !productName) {
      warnings.push(`第 ${index + 2} 行缺少客户或产品信息。`);
      return null;
    }

    return {
      customerName,
      productName,
      specification: getFieldValue(row, fieldMap.specification),
      quantity: parseNumber(getFieldValue(row, fieldMap.quantity)),
      weight: getFieldValue(row, fieldMap.weight),
      shippingAddress: getFieldValue(row, fieldMap.shippingAddress),
      contactPerson: getFieldValue(row, fieldMap.contactPerson),
      contactPhone: getFieldValue(row, fieldMap.contactPhone),
      status: 'pending',
      requestDate: new Date().toISOString().split('T')[0],
    };
  });

  return buildParsedResult('sample', 0.88, data.records, [
    `识别到 ${data.records.length} 条样品申请。`,
    '请核对样品规格、寄送地址和联系方式。',
  ], data.warnings);
};

const parseShipmentTable = (headers: string[], rows: string[][]): ParsedFormData => {
  const fieldMap = createFieldMap(headers, {
    trackingNumber: ['运单号', '物流单号', '快递单号', 'tracking'],
    customer: ['客户', '收货人', '往来单位', 'customer'],
    orderNumber: ['订单号', '参考号', 'order'],
    carrier: ['承运商', '物流公司', '快递公司', 'carrier'],
    shipDate: ['发货日期', '发货时间', 'ship date'],
    deliveryDate: ['预计送达', '到货日期', 'delivery'],
    status: ['状态', 'status'],
  });

  const data = rowsToRecords(rows, (row, index, warnings) => {
    const trackingNumber = getFieldValue(row, fieldMap.trackingNumber);
    if (!trackingNumber) {
      warnings.push(`第 ${index + 2} 行缺少运单号。`);
      return null;
    }

    return {
      trackingNumber,
      customerName: getFieldValue(row, fieldMap.customer),
      orderReference: getFieldValue(row, fieldMap.orderNumber),
      carrier: getFieldValue(row, fieldMap.carrier) || '未填写',
      shipDate: getFieldValue(row, fieldMap.shipDate),
      estimatedDelivery: getFieldValue(row, fieldMap.deliveryDate),
      status: getFieldValue(row, fieldMap.status) || 'in_transit',
    };
  });

  return buildParsedResult('shipment', 0.87, data.records, [
    `识别到 ${data.records.length} 条物流记录。`,
    '请核对运单号、承运商和物流状态。',
  ], data.warnings);
};

const parseGenericTable = (headers: string[], rows: string[][]): ParsedFormData => ({
  type: 'unknown',
  confidence: 0.5,
  data: rows.map((row) => Object.fromEntries(headers.map((header, index) => [header || `列${index + 1}`, row[index] || '']))),
  suggestions: [
    '暂未识别出表格类型。',
    '请检查表头是否包含客户、订单、样品或物流等关键词。',
  ],
  warnings: ['表格类型未确认，请人工核对后再导入。'],
});

const rowsToRecords = (
  rows: string[][],
  buildRecord: (row: string[], index: number, warnings: string[]) => ParsedFormRecord | null,
): { records: ParsedFormRecord[]; warnings: string[] } => {
  const records: ParsedFormRecord[] = [];
  const warnings: string[] = [];

  rows.forEach((row, index) => {
    if (row.every((cell) => !cell.trim())) return;
    const record = buildRecord(row, index, warnings);
    if (record) records.push(record);
  });

  return { records, warnings };
};

const buildParsedResult = (
  type: ParsedFormType,
  confidence: number,
  data: ParsedFormRecord[],
  suggestions: string[],
  warnings: string[],
): ParsedFormData => ({ type, confidence, data, suggestions, warnings });

const createFieldMap = (headers: string[], fieldKeywords: Record<string, string[]>): FieldMap => {
  const normalizedHeaders = headers.map(normalize);
  return Object.fromEntries(Object.entries(fieldKeywords).map(([field, keywords]) => [
    field,
    normalizedHeaders
      .map((header, index) => keywords.some((keyword) => header.includes(normalize(keyword))) ? index : -1)
      .filter((index) => index !== -1),
  ]));
};

const getFieldValue = (row: string[], columnIndexes: number[]): string => {
  for (const index of columnIndexes) {
    if (index >= 0 && index < row.length && row[index]) return row[index].trim();
  }
  return '';
};

const parseNumber = (value: string): number => {
  const cleaned = value.replace(/[^\d.-]/g, '');
  const numberValue = Number.parseFloat(cleaned);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const normalize = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();

const countMatches = (text: string, keywords: string[]): number =>
  keywords.filter((keyword) => text.includes(normalize(keyword))).length;

export const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const toContextArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export const getNumericField = (value: unknown, field: string): number => {
  const record = toRecord(value);
  const numericValue = Number(record[field] ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

export const sumOrderAmount = (orders: unknown[]): number =>
  orders.reduce<number>((sum, order) => sum + getNumericField(order, 'totalAmount'), 0);
