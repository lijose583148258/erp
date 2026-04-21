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

export const recognizeAndParseTable = (tableData: TableData): ParsedFormData => {
  const { headers, rows } = tableData;
  const type = detectTableType(headers);

  switch (type) {
    case 'customer':
      return parseCustomerTable(headers, rows);
    case 'order':
      return parseOrderTable(headers, rows);
    case 'sample':
      return parseSampleTable(headers, rows);
    case 'shipment':
      return parseShipmentTable(headers, rows);
    default:
      return parseGenericTable(headers, rows);
  }
};

const detectTableType = (headers: string[]): ParsedFormType => {
  const headerText = headers.join(' ').toLowerCase();

  const customerKeywords = ['客户', 'customer', '公司', 'company', '联系人', 'contact', '信用', 'credit'];
  const customerScore = customerKeywords.filter(kw => headerText.includes(kw)).length;

  const orderKeywords = ['订单', 'order', '产品', 'product', '数量', 'quantity', '金额', 'amount', '价格', 'price', 'cas', '纯度', 'purity', '批次', 'batch', '等级', 'grade'];
  const orderScore = orderKeywords.filter(kw => headerText.includes(kw)).length;

  const sampleKeywords = ['样品', 'sample', '规格', 'spec', '寄送', 'ship', '申请', 'apply'];
  const sampleScore = sampleKeywords.filter(kw => headerText.includes(kw)).length;

  const shipmentKeywords = ['物流', 'logistics', '运单', 'tracking', '发货', 'shipment', '快递', 'express'];
  const shipmentScore = shipmentKeywords.filter(kw => headerText.includes(kw)).length;

  const scores = {
    customer: customerScore,
    order: orderScore,
    sample: sampleScore,
    shipment: shipmentScore,
  };

  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return 'unknown';

  return (Object.keys(scores) as ParsedFormType[]).find(key => key !== 'unknown' && scores[key as keyof typeof scores] === maxScore) || 'unknown';
};

const parseCustomerTable = (headers: string[], rows: string[][]): ParsedFormData => {
  const customers: ParsedFormRecord[] = [];
  const warnings: string[] = [];

  const fieldMap = createFieldMap(headers, {
    name: ['客户名称', '公司名称', 'customer', 'company', 'name', '往来单位'],
    contact: ['联系人', 'contact', '负责人'],
    phone: ['电话', 'phone', 'tel', '手机'],
    email: ['邮箱', 'email', 'mail'],
    address: ['地址', 'address', '详细地址'],
    creditLimit: ['信用额度', 'credit', 'limit', '额度'],
    paymentTerms: ['账期', 'payment', 'terms', '付款方式'],
    businessLicense: ['营业执照', 'license', '统一社会信用代码'],
  });

  rows.forEach((row, index) => {
    if (row.every(cell => !cell)) return;

    const name = getFieldValue(row, fieldMap.name);
    const customer: ParsedFormRecord = {
      name,
      contactPerson: getFieldValue(row, fieldMap.contact),
      phone: getFieldValue(row, fieldMap.phone),
      email: getFieldValue(row, fieldMap.email),
      address: getFieldValue(row, fieldMap.address),
      creditLimit: parseNumber(getFieldValue(row, fieldMap.creditLimit)),
      paymentTerms: getFieldValue(row, fieldMap.paymentTerms) || '30天',
      businessLicense: getFieldValue(row, fieldMap.businessLicense),
      riskLevel: 'low',
      status: 'active',
    };

    if (!name) {
      warnings.push(`第 ${index + 2} 行：缺少客户名称`);
    } else {
      customers.push(customer);
    }
  });

  return {
    type: 'customer',
    confidence: 0.9,
    data: customers,
    suggestions: [
      `识别到 ${customers.length} 个客户记录`,
      '建议检查信用额度和账期设置',
      '确认联系方式是否准确',
    ],
    warnings,
  };
};

const parseOrderTable = (headers: string[], rows: string[][]): ParsedFormData => {
  const orders: ParsedFormRecord[] = [];
  const warnings: string[] = [];

  const fieldMap = createFieldMap(headers, {
    customer: ['客户', 'customer', '往来单位', '公司'],
    product: ['产品', 'product', '商品', '货物', '品名'],
    quantity: ['数量', 'quantity', 'qty', '件数'],
    unit: ['单位', 'unit', '计量单位'],
    price: ['单价', 'price', '价格'],
    amount: ['金额', 'amount', '总价', '总金额'],
    currency: ['币种', 'currency', '货币'],
    paymentTerms: ['账期', 'payment', '付款方式'],
    deliveryDate: ['交货日期', 'delivery', 'date', '发货日期'],
    casNo: ['cas', 'cas号', 'cas no', 'cas number', '化学文摘号'],
    purity: ['纯度', 'purity', '含量', '浓度'],
    batchNo: ['批次', 'batch', '批号', 'lot', 'lot number'],
    grade: ['等级', 'grade', '级别', '规格等级'],
  });

  rows.forEach((row, index) => {
    if (row.every(cell => !cell)) return;

    const quantity = parseNumber(getFieldValue(row, fieldMap.quantity));
    const price = parseNumber(getFieldValue(row, fieldMap.price));
    const amount = parseNumber(getFieldValue(row, fieldMap.amount)) || (quantity * price);

    const customerName = getFieldValue(row, fieldMap.customer);
    const productName = getFieldValue(row, fieldMap.product);
    const order: ParsedFormRecord = {
      customerName,
      items: [{
        productName,
        quantity,
        unit: getFieldValue(row, fieldMap.unit) || '吨',
        unitPrice: price,
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

    if (!customerName || !productName) {
      warnings.push(`第 ${index + 2} 行：缺少客户名称或产品名称`);
    } else {
      orders.push(order);
    }
  });

  return {
    type: 'order',
    confidence: 0.85,
    data: orders,
    suggestions: [
      `识别到 ${orders.length} 个订单记录`,
      '建议核对产品规格和价格',
      '确认交货日期是否合理',
      '已自动识别生物科技相关字段（CAS号、纯度、批次号）',
    ],
    warnings,
  };
};

const parseSampleTable = (headers: string[], rows: string[][]): ParsedFormData => {
  const samples: ParsedFormRecord[] = [];
  const warnings: string[] = [];

  const fieldMap = createFieldMap(headers, {
    customer: ['客户', 'customer', '往来单位'],
    product: ['产品', 'product', '样品名称', '品名'],
    spec: ['规格', 'spec', 'specification'],
    quantity: ['数量', 'quantity', 'qty'],
    weight: ['重量', 'weight'],
    address: ['地址', 'address', '寄送地址', '收货地址'],
    contact: ['联系人', 'contact', '收件人'],
    phone: ['电话', 'phone', '手机'],
  });

  rows.forEach((row, index) => {
    if (row.every(cell => !cell)) return;

    const customerName = getFieldValue(row, fieldMap.customer);
    const productName = getFieldValue(row, fieldMap.product);
    const sample: ParsedFormRecord = {
      customerName,
      productName,
      specification: getFieldValue(row, fieldMap.spec),
      quantity: parseNumber(getFieldValue(row, fieldMap.quantity)),
      weight: getFieldValue(row, fieldMap.weight),
      shippingAddress: getFieldValue(row, fieldMap.address),
      contactPerson: getFieldValue(row, fieldMap.contact),
      contactPhone: getFieldValue(row, fieldMap.phone),
      status: 'pending',
      requestDate: new Date().toISOString().split('T')[0],
    };

    if (!customerName || !productName) {
      warnings.push(`第 ${index + 2} 行：缺少客户或产品信息`);
    } else {
      samples.push(sample);
    }
  });

  return {
    type: 'sample',
    confidence: 0.88,
    data: samples,
    suggestions: [
      `识别到 ${samples.length} 个样品申请`,
      '建议确认寄送地址和联系方式',
      '检查样品规格是否完整',
    ],
    warnings,
  };
};

const parseShipmentTable = (headers: string[], rows: string[][]): ParsedFormData => {
  const shipments: ParsedFormRecord[] = [];
  const warnings: string[] = [];

  const fieldMap = createFieldMap(headers, {
    trackingNumber: ['运单号', 'tracking', '物流单号', '快递单号'],
    customer: ['客户', 'customer', '收货人', '往来单位'],
    orderNumber: ['订单号', 'order', '参考号'],
    carrier: ['承运商', 'carrier', '物流公司', '快递公司'],
    shipDate: ['发货日期', 'ship date', '发货时间'],
    deliveryDate: ['预计送达', 'delivery', '到货日期'],
    status: ['状态', 'status'],
  });

  rows.forEach((row, index) => {
    if (row.every(cell => !cell)) return;

    const trackingNumber = getFieldValue(row, fieldMap.trackingNumber);
    const shipment: ParsedFormRecord = {
      trackingNumber,
      customerName: getFieldValue(row, fieldMap.customer),
      orderReference: getFieldValue(row, fieldMap.orderNumber),
      carrier: getFieldValue(row, fieldMap.carrier) || '顺丰速运',
      shipDate: getFieldValue(row, fieldMap.shipDate),
      estimatedDelivery: getFieldValue(row, fieldMap.deliveryDate),
      status: getFieldValue(row, fieldMap.status) || 'in_transit',
    };

    if (!trackingNumber) {
      warnings.push(`第 ${index + 2} 行：缺少运单号`);
    } else {
      shipments.push(shipment);
    }
  });

  return {
    type: 'shipment',
    confidence: 0.87,
    data: shipments,
    suggestions: [
      `识别到 ${shipments.length} 个物流记录`,
      '建议核对运单号是否正确',
      '确认物流状态是否需要更新',
    ],
    warnings,
  };
};

const parseGenericTable = (headers: string[], rows: string[][]): ParsedFormData => {
  const data = rows.map(row => {
    const obj: ParsedFormRecord = {};
    headers.forEach((header, index) => {
      obj[header] = row[index] || '';
    });
    return obj;
  });

  return {
    type: 'unknown',
    confidence: 0.5,
    data,
    suggestions: [
      '无法自动识别表格类型',
      '请手动选择数据类型',
      '或调整表格列名以便识别',
    ],
    warnings: ['表格格式未识别，请检查列名是否标准'],
  };
};

const createFieldMap = (headers: string[], fieldKeywords: Record<string, string[]>): Record<string, number[]> => {
  const map: Record<string, number[]> = {};

  Object.keys(fieldKeywords).forEach(field => {
    const keywords = fieldKeywords[field];
    map[field] = headers
      .map((header, index) => {
        const headerLower = header.toLowerCase();
        return keywords.some(kw => headerLower.includes(kw.toLowerCase())) ? index : -1;
      })
      .filter(index => index !== -1);
  });

  return map;
};

const getFieldValue = (row: string[], columnIndexes: number[]): string => {
  for (const index of columnIndexes) {
    if (index >= 0 && index < row.length && row[index]) {
      return String(row[index]).trim();
    }
  }
  return '';
};

const parseNumber = (value: string): number => {
  if (!value) return 0;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  const num = parseFloat(cleaned);
  return Number.isNaN(num) ? 0 : num;
};

export const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const toContextArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export const getNumericField = (value: unknown, field: string): number => {
  const record = toRecord(value);
  const numericValue = Number(record[field] ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

export const sumOrderAmount = (orders: unknown[]): number =>
  orders.reduce((sum, order) => sum + getNumericField(order, 'totalAmount'), 0);
