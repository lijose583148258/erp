import { parseTableFile, type TableData } from './tableImport.service';
import {
  getNumericField,
  recognizeAndParseTable,
  sumOrderAmount,
  toContextArray,
  toRecord,
  type ContextData,
} from './freeAI/tableRecognition';

export { parseTableFile };
export { recognizeAndParseTable } from './freeAI/tableRecognition';
export type { TableData };
export type {
  ContextData,
  ParsedFormData,
  ParsedFormRecord,
  ParsedFormType,
} from './freeAI/tableRecognition';

export interface AnalyzedContractFile {
  title: string;
  type: 'sales' | 'purchase';
  totalAmount: number | null;
  currency: string | null;
  signedAt: string | null;
  confidence: number;
  metadata: {
    ocr_engine: string;
    notice: string;
  };
}

export interface AnalyzedProductLabel {
  name: string | null;
  cas: string | null;
  grade: string | null;
  batchNo: string | null;
  confidence: number;
  scannedAt: string;
  notice: string;
}

export const processAICmd = async (message: string, contextData: ContextData): Promise<string> => {
  const msg = message.toLowerCase().trim();

  if (containsAny(msg, ['上传', '导入', '表格', 'excel', 'csv'])) {
    return [
      '表格导入可以识别客户、订单、样品和物流数据。',
      '请先上传 CSV 或 Excel 文件，系统会展示预览结果；确认无误后再导入。',
      '导入前请重点核对客户名称、产品、数量、金额和联系方式。',
    ].join('\n');
  }

  if (containsAny(msg, ['样品', 'sample'])) {
    const sampleCount = toContextArray(contextData.samples).length;
    return `当前可见样品申请共 ${sampleCount} 条。请到样品管理页面查看明细和状态。`;
  }

  if (containsAny(msg, ['订单', '下单', 'order'])) {
    const orders = toContextArray(contextData.orders);
    const total = sumOrderAmount(orders);
    return `当前可见订单共 ${orders.length} 条，总金额约 ${formatMoney(total)}。请到销售订单页面查看明细。`;
  }

  if (containsAny(msg, ['客户', 'crm', 'customer'])) {
    const customerCount = toContextArray(contextData.customers).length;
    return `当前可见客户共 ${customerCount} 个。请到客户管理页面查看和维护客户资料。`;
  }

  if (containsAny(msg, ['分析', '销售', '业绩'])) {
    const orders = toContextArray(contextData.orders);
    const total = sumOrderAmount(orders);
    const average = orders.length ? total / orders.length : 0;
    return [
      '销售概览：',
      `订单数：${orders.length}`,
      `总金额：${formatMoney(total)}`,
      `平均订单：${formatMoney(average)}`,
      '这里只展示汇总数据，客户和订单明细请按权限进入对应页面查看。',
    ].join('\n');
  }

  if (containsAny(msg, ['风险', '逾期', '催收'])) {
    return [
      '风险检查建议：',
      '1. 先看核心风控中的逾期预警。',
      '2. 优先处理逾期超过 30 天或超信用额度客户。',
      '3. 新订单、发货和回款动作必须按权限回读确认。',
    ].join('\n');
  }

  return [
    `已收到：${message}`,
    '我可以协助表格导入、订单汇总、客户数量统计和风险检查。',
    '涉及客户、订单、财务或联系人明细时，请到对应业务页面按权限查看。',
  ].join('\n');
};

export const getRiskInsight = async (customerData: unknown): Promise<string> => {
  const customer = toRecord(customerData);
  const name = String(customer.name || customer.displayName || '该客户');
  const creditLimit = getNumericField(customer, 'creditLimit');
  const overdueAmount = getNumericField(customer, 'overdueAmount');
  const overdueDays = getNumericField(customer, 'overdueDays');
  const totalOrders = getNumericField(customer, 'totalOrders');
  const totalAmount = getNumericField(customer, 'totalAmount');

  if (overdueDays > 60 || (creditLimit > 0 && overdueAmount > creditLimit)) {
    return [
      `${name} 为高风险客户。`,
      `逾期天数：${overdueDays} 天`,
      `逾期金额：${formatMoney(overdueAmount)}`,
      '建议暂停新发货，转入管理层复核，并保留催收记录。',
    ].join('\n');
  }

  if (overdueDays > 30 || (creditLimit > 0 && overdueAmount > creditLimit * 0.5)) {
    return [
      `${name} 为中风险客户。`,
      `逾期天数：${overdueDays} 天`,
      `逾期金额：${formatMoney(overdueAmount)}`,
      '建议加强回款跟进，新订单优先采用预付款或缩短账期。',
    ].join('\n');
  }

  if (overdueDays > 0 || overdueAmount > 0) {
    return [
      `${name} 有轻微逾期。`,
      `逾期天数：${overdueDays} 天`,
      `逾期金额：${formatMoney(overdueAmount)}`,
      '建议提醒客户付款，并记录沟通结果。',
    ].join('\n');
  }

  if (totalOrders > 10 && overdueAmount === 0) {
    return [
      `${name} 信用表现良好。`,
      `累计订单：${totalOrders} 笔`,
      `累计金额：${formatMoney(totalAmount)}`,
      '可评估更稳定的账期或重点维护策略。',
    ].join('\n');
  }

  return `${name} 当前无明显信用异常，可按常规流程继续合作。`;
};

const analyzeContractFile = async (file: File): Promise<AnalyzedContractFile> => {
  const fileName = file.name.toLowerCase();
  const type = fileName.includes('采购') || fileName.includes('purchase') ? 'purchase' : 'sales';

  return {
    title: file.name.replace(/\.[^/.]+$/, ''),
    type,
    totalAmount: null,
    currency: null,
    signedAt: null,
    confidence: 0,
    metadata: {
      ocr_engine: 'Local-Rules',
      notice: '本地规则仅识别文件类型；金额、币种、签署日期等合同要素需要人工核对。',
    },
  };
};

const analyzeProductLabel = async (_file: File): Promise<AnalyzedProductLabel> => ({
  name: null,
  cas: null,
  grade: null,
  batchNo: null,
  confidence: 0,
  scannedAt: new Date().toISOString(),
  notice: '本地模式不会自动读取图片内容，请人工核对产品名称、CAS、等级和批号。',
});

const containsAny = (message: string, keywords: string[]): boolean =>
  keywords.some((keyword) => message.includes(keyword.toLowerCase()));

const formatMoney = (amount: number): string =>
  `¥${amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;

export default {
  parseTableFile,
  recognizeAndParseTable,
  processAICmd,
  getRiskInsight,
  analyzeContractFile,
  analyzeProductLabel,
};
