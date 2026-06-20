import { toApiRecord, toNumberValue, toStringValue } from '../utils/apiMapping';
import { isHiddenDataRequest, unauthorizedDataRefusal } from './aiSecurity';

type TranslationMap = Record<string, string | undefined>;
type ContextRecord = Record<string, unknown>;

interface ContextData {
  orders?: ContextRecord[];
  customers?: ContextRecord[];
  samples?: ContextRecord[];
  visibleCounts?: Record<string, number>;
  currentPage?: string;
  t?: TranslationMap;
  [key: string]: unknown;
}

const visibleCount = (contextData: ContextData, key: string, fallbackValue?: unknown): number => {
  const safeCount = contextData.visibleCounts?.[key];
  if (Number.isFinite(safeCount)) return Number(safeCount);
  return Array.isArray(fallbackValue) ? fallbackValue.length : 0;
};

export const processAICmd = async (message: string, contextData: ContextData): Promise<string> => {
  const text = message.trim();
  const normalized = text.toLowerCase();
  const t = contextData.t || {};

  if (isHiddenDataRequest(text)) {
    return unauthorizedDataRefusal;
  }

  if (normalized.includes('上传') || normalized.includes('导入') || normalized.includes('表格') || normalized.includes('excel')) {
    return [
      t.aiImportOpen || '可以上传 Excel 或 CSV 表格。',
      '',
      t.aiImportSupport || '系统会先识别表格类型并展示预览，确认后才写入业务数据库。',
      '请先核对字段、行数和异常提示，避免重复导入。',
    ].join('\n');
  }

  if (normalized.includes('sample') || normalized.includes('样品')) {
    const sampleCount = visibleCount(contextData, 'samples', contextData.samples);
    return `当前可见样品申请 ${sampleCount} 条。样品明细请进入样品模块按当前角色权限查看。`;
  }

  if (normalized.includes('order') || normalized.includes('订单') || normalized.includes('下单')) {
    const orderCount = visibleCount(contextData, 'orders', contextData.orders);
    return `当前可见订单 ${orderCount} 条。金额、客户和订单明细不在 AI 聊天中展开，请进入销售订单模块查看。`;
  }

  if (normalized.includes('分析') || normalized.includes('销售') || normalized.includes('业绩')) {
    const orderCount = visibleCount(contextData, 'orders', contextData.orders);
    const customerCount = visibleCount(contextData, 'customers', contextData.customers);
    return [
      t.aiAnalysisReport || '经营概览',
      '',
      `当前可见订单数：${orderCount}`,
      `当前可见客户数：${customerCount}`,
      'AI 只提供数量级提示，不展示客户名称、联系人、金额或财务明细。',
    ].join('\n');
  }

  if (normalized.includes('风险') || normalized.includes('逾期') || normalized.includes('催收')) {
    return [
      t.aiRiskAlert || '风险处理建议',
      '',
      '1. 进入回款或风控模块查看逾期清单。',
      '2. 按客户、订单、责任人逐条核对。',
      '3. 涉及止货、授信或催收动作时，保留原因和操作记录。',
    ].join('\n');
  }

  if (normalized.includes('crm') || normalized.includes('客户')) {
    const customerCount = visibleCount(contextData, 'customers', contextData.customers);
    return `当前可见客户 ${customerCount} 个。客户名称、联系人、电话、地址和客户池归属请在 CRM 模块按权限查看。`;
  }

  if (normalized.includes('帮助') || normalized.includes('help') || normalized.includes('功能')) {
    return [
      t.aiHelpTitle || '我可以协助这些操作',
      '',
      '1. 说明当前页面的操作路径。',
      '2. 提醒订单、回款、仓储、生产等模块的下一步。',
      '3. 辅助表格导入前的字段核对。',
      '4. 对敏感明细只给入口提示，不在聊天中展开。',
    ].join('\n');
  }

  return [
    `${t.aiTip || '智能助手'}：已收到“${text}”。`,
    '',
    '我可以帮你定位功能入口、说明操作步骤、提醒风险处理顺序。',
    '如果需要查看具体客户、订单、金额或财务明细，请到对应模块按权限打开。',
  ].join('\n');
};

export const getRiskInsight = async (customerData: unknown, t: TranslationMap): Promise<string> => {
  const data = toApiRecord(customerData);
  const name = toStringValue(data.name, t.customerName || '该客户');
  const creditLimit = toNumberValue(data.creditLimit);
  const overdueAmount = toNumberValue(data.overdueAmount);
  const overdueDays = toNumberValue(data.overdueDays);
  const totalOrders = toNumberValue(data.totalOrders);
  const totalAmount = toNumberValue(data.totalAmount);

  if (overdueDays > 60 || overdueAmount > creditLimit) {
    return [
      t.aiInsightHigh || '高风险提醒',
      '',
      `${name}`,
      `${t.longestDelay || '逾期天数'}：${overdueDays}`,
      `${t.totalOverdue || '逾期金额'}：${overdueAmount.toLocaleString()}`,
      '',
      `${t.aiInsightAdvice || '建议'}：暂停发货，进入风控或回款模块复核。`,
    ].join('\n');
  }

  if (overdueDays > 30 || overdueAmount > creditLimit * 0.5) {
    return [
      t.aiInsightMedium || '中风险提醒',
      '',
      `${name}`,
      `${t.longestDelay || '逾期天数'}：${overdueDays}`,
      `${t.aiInsightAdvice || '建议'}：加强催收，复核授信额度和账期。`,
    ].join('\n');
  }

  if (overdueDays > 0 || overdueAmount > 0) {
    return [
      t.aiInsightLow || '低风险提醒',
      '',
      `${name}`,
      `${t.totalOverdue || '逾期金额'}：${overdueAmount.toLocaleString()}`,
    ].join('\n');
  }

  if (totalOrders > 10 && overdueAmount === 0) {
    return [
      t.aiInsightExcellent || '优质客户',
      '',
      `${name}`,
      `${t.totalVolume || '累计订单'}：${totalOrders}`,
      `${t.totalAmount || '累计金额'}：${totalAmount.toLocaleString()}`,
    ].join('\n');
  }

  return `${t.aiInsightNormal || '信用状态正常'}\n\n${name}`;
};

export const processVoiceInput = async (_audioData: Blob): Promise<string> => '语音识别功能开发中。';

export const getFormSuggestions = (fieldName: string, context: unknown): string[] => {
  const source = toApiRecord(context);
  const recentCustomers = Array.isArray(source.recentCustomers)
    ? source.recentCustomers.map(item => String(item)).filter(Boolean)
    : [];
  const suggestions: Record<string, string[]> = {
    customerName: recentCustomers.length ? recentCustomers : ['上海化工有限公司', '北京贸易公司'],
    productName: ['聚乙烯', '聚丙烯', '聚氯乙烯', 'PET 树脂'],
    unit: ['吨', '千克', '立方米', '件'],
    paymentTerms: ['30 天', '60 天', '90 天', '现款现货'],
  };

  return suggestions[fieldName] || [];
};

export default {
  processAICmd,
  getRiskInsight,
  processVoiceInput,
  getFormSuggestions,
};
