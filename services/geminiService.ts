// 免费规则引擎AI服务 - 替代Gemini
// 无需API密钥，完全本地运行
import { toApiRecord, toNumberValue, toStringValue, toUnknownArray } from '../utils/apiMapping';
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

const getVisibleCount = (contextData: ContextData, key: string, fallbackValue?: unknown): number => {
  const safeCount = contextData.visibleCounts?.[key];
  if (Number.isFinite(safeCount)) return Number(safeCount);
  return Array.isArray(fallbackValue) ? fallbackValue.length : 0;
};

/**
 * 智能规则引擎 - 处理用户命令
 */
export const processAICmd = async (message: string, contextData: ContextData): Promise<string> => {
  const msg = message.toLowerCase().trim();
  const t = contextData.t || {};

  if (isHiddenDataRequest(message)) {
    return unauthorizedDataRefusal;
  }

  // 样品相关
  if (msg.includes('样品') || msg.includes('sample')) {
    if (msg.includes('申请') || msg.includes('寄') || msg.includes('送')) {
      return `✅ ${t.newSampleRequest || '已为您打开样品申请表单'}。\n\n${t.aiImportHint || '请填写必填项'}`;
    }
    const sampleCount = getVisibleCount(contextData, 'samples', contextData.samples);
    return `📦 ${t.sampleInsightsPrefix || '当前可见'} ${sampleCount} ${t.sampleInsightsSuffix || '个样品申请'}。如需查看明细，请到样品模块按当前角色权限打开。`;
  }

  // 订单相关
  if (msg.includes('订单') || msg.includes('下单') || msg.includes('order')) {
    if (msg.includes('新建') || msg.includes('创建') || msg.includes('录入')) {
      return `✅ ${t.actNewOrder || '已为您打开订单创建页面'}`;
    }
    const orderCount = getVisibleCount(contextData, 'orders', contextData.orders);
    return `${t.aiOrderStats || '📊 订单统计'}：\n• 当前可见订单数: ${orderCount}\n• 金额和客户明细请到订单模块按权限查看，AI 不直接展开敏感明细。`;
  }

  // 销售分析
  if (msg.includes('分析') || msg.includes('销售') || msg.includes('业绩')) {
    const orderCount = getVisibleCount(contextData, 'orders', contextData.orders);
    const customerCount = getVisibleCount(contextData, 'customers', contextData.customers);

    return `${t.aiAnalysisReport || '📈 销售分析报告'}：\n\n` +
      `• 当前可见订单数: ${orderCount}\n` +
      `• 当前可见客户数: ${customerCount}\n` +
      `• 金额、客户名称、联系人和订单明细不在聊天里展开，请到对应模块按权限查看。`;
  }

  // 风险和逾期
  if (msg.includes('风险') || msg.includes('逾期') || msg.includes('催款')) {
    return `${t.aiRiskAlert || '⚠️ 风险管理建议'}：\n\n1. ${t.riskCheck || '查看预警'}\n2. ${t.blindspotAgingAction || '分层催收'}`;
  }

  // 客户相关
  if (msg.includes('客户') || msg.includes('crm')) {
    if (msg.includes('新增') || msg.includes('添加')) {
      return `✅ ${t.addCustomer || '添加客户'}`;
    }
    const customerCount = getVisibleCount(contextData, 'customers', contextData.customers);
    return `${t.aiCustomerMgmt || '👥 客户管理'}：\n• 当前可见客户数: ${customerCount}\n• 客户名称、联系人、地址和池归属明细请到 CRM 模块按权限查看。`;
  }

  // 帮助信息
  if (msg.includes('帮助') || msg.includes('help') || msg.includes('功能')) {
    return `${t.aiHelpTitle || '🤖 我可以帮您'}：\n\n` +
      `📝 ${t.aiHelpOps || '业务操作'}\n` +
      `📊 ${t.aiHelpAnalysis || '数据分析'}\n\n` +
      `💡 ${t.aiHelpTip || '直接输入您的需求'}`;
  }

  // 默认回复
  return `🤖 ${t.aiTip || '智能助手'}: "${message}"\n\n${t.aiHelpTip || '试试说："帮我分析一下本月销售情况"'}`;
};

/**
 * 风险洞察分析
 */
export const getRiskInsight = async (customerData: unknown, t: TranslationMap): Promise<string> => {
  const data = toApiRecord(customerData);
  const name = toStringValue(data.name, t.customerName || '该客户');
  const creditLimit = toNumberValue(data.creditLimit);
  const overdueAmount = toNumberValue(data.overdueAmount);
  const overdueDays = toNumberValue(data.overdueDays);
  const totalOrders = toNumberValue(data.totalOrders);
  const totalAmount = toNumberValue(data.totalAmount);

  // 严重逾期
  if (overdueDays > 60 || overdueAmount > creditLimit) {
    return `${t.aiInsightHigh || '🔴 高风险警告'}：\n\n` +
      `${name}\n` +
      `• ${t.longestDelay || '逾期天数'}: ${overdueDays}\n` +
      `• ${t.totalOverdue || '逾期金额'}: ¥${overdueAmount.toLocaleString()}\n\n` +
      `⚠️ ${t.aiInsightAdvice || '建议措施'}:\n1. ${t.blindspotAgingAction || '暂停发货'}`;
  }

  // 中度风险
  if (overdueDays > 30 || overdueAmount > creditLimit * 0.5) {
    return `${t.aiInsightMedium || '🟡 中度风险提示'}：\n\n` +
      `${name}\n` +
      `• ${t.longestDelay || '逾期天数'}: ${overdueDays}\n\n` +
      `💡 ${t.aiInsightAdvice || '建议措施'}:\n1. ${t.riskCheck || '加强催收'}`;
  }

  // 轻微逾期
  if (overdueDays > 0 || overdueAmount > 0) {
    return `${t.aiInsightLow || '🟢 低风险提醒'}：\n\n` +
      `${name}\n` +
      `• ${t.totalOverdue || '逾期金额'}: ¥${overdueAmount.toLocaleString()}`;
  }

  // 优质客户
  if (totalOrders > 10 && overdueAmount === 0) {
    return `${t.aiInsightExcellent || '✅ 优质客户'}：\n\n` +
      `${name}\n` +
      `• ${t.totalVolume || '累计订单'}: ${totalOrders}\n` +
      `• ${t.totalAmount || '累计金额'}: ¥${totalAmount.toLocaleString()}`;
  }

  // 正常客户
  return `${t.aiInsightNormal || '✅ 信用良好'}：\n\n${name}`;
};

/**
 * 语音输入处理（预留接口）
 */
export const processVoiceInput = async (_audioData: Blob): Promise<string> => {
  // 这里可以集成浏览器的 Web Speech API
  // 或者使用免费的语音识别服务
  return '语音识别功能开发中...';
};

/**
 * 智能表单填写建议
 */
export const getFormSuggestions = (fieldName: string, context: unknown): string[] => {
  const source = toApiRecord(context);
  const recentCustomers = toUnknownArray(source.recentCustomers).map(item => String(item)).filter(Boolean);
  const suggestions: Record<string, string[]> = {
    customerName: recentCustomers.length ? recentCustomers : ['上海化工有限公司', '北京贸易公司'],
    productName: ['聚乙烯', '聚丙烯', '聚氯乙烯', 'PET树脂'],
    unit: ['吨', '千克', '立方米', '件'],
    paymentTerms: ['30天', '60天', '90天', '现款现货'],
  };

  return suggestions[fieldName] || [];
};

export default {
  processAICmd,
  getRiskInsight,
  processVoiceInput,
  getFormSuggestions,
};
