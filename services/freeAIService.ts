/**
 * 增强版本地规则引擎 - 支持表格识别和智能填写
 * 无需API密钥，完全本地运行
 */

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

// ==================== 原有AI命令处理 ====================

/**
 * 智能规则引擎 - 处理用户命令
 */
export const processAICmd = async (message: string, contextData: ContextData): Promise<string> => {
  const msg = message.toLowerCase().trim();

  // 表格上传相关
  if (msg.includes('上传') || msg.includes('导入') || msg.includes('表格') || msg.includes('excel')) {
    return '📊 表格智能识别功能\n\n' +
      '请上传包含数据的 Excel 或 CSV 文件，我会：\n' +
      '✅ 自动识别表格类型（客户、订单、样品、物流）\n' +
      '✅ 智能解析表格内容\n' +
      '✅ 生成预填写的表单供您确认\n' +
      '✅ 一键批量导入系统\n\n' +
      '💡 支持的文件格式：.xlsx, .xls, .csv';
  }

  // 样品相关
  if (msg.includes('样品') || msg.includes('sample')) {
    if (msg.includes('申请') || msg.includes('寄') || msg.includes('送')) {
      return '✅ 已为您打开样品申请表单。\n\n请填写：\n• 客户名称\n• 样品名称和规格\n• 数量和重量\n• 快递地址';
    }
    if (msg.includes('查询') || msg.includes('状态')) {
      const samples = toContextArray(contextData.samples);
      return `📝 当前有 ${samples.length} 个样品申请\n\n建议在"样品管理"模块查看详细状态。`;
    }
  }

  // 订单相关
  if (msg.includes('订单') || msg.includes('下单') || msg.includes('order')) {
    if (msg.includes('新建') || msg.includes('创建') || msg.includes('录入')) {
      return '✅ 已为您打开订单创建页面。\n\n录入步骤：\n1. 选择客户\n2. 添加产品和数量\n3. 设置价格和账期\n4. 保存订单';
    }
    const orders = toContextArray(contextData.orders);
    const total = sumOrderAmount(orders);
    return `📊 订单统计：\n• 总订单数: ${orders.length}\n• 总金额: ¥${total.toLocaleString()}\n\n在"销售订单"模块可查看详情。`;
  }

  // 销售分析
  if (msg.includes('分析') || msg.includes('销售') || msg.includes('业绩')) {
    const orders = toContextArray(contextData.orders);
    const total = sumOrderAmount(orders);
    const avgOrder = orders.length > 0 ? total / orders.length : 0;

    return `📈 销售分析报告：\n\n` +
      `• 订单总数: ${orders.length} 笔\n` +
      `• 销售总额: ¥${total.toLocaleString()}\n` +
      `• 平均订单: ¥${avgOrder.toLocaleString()}\n\n` +
      `💡 建议：${orders.length > 0 ? '继续保持！关注大客户维护。' : '开始录入订单数据。'}`;
  }

  // 风险和逾期
  if (msg.includes('风险') || msg.includes('逾期') || msg.includes('催')) {
    return `⚠️ 风险管理建议：\n\n` +
      `1. 查看"核心风控"模块的逾期预警\n` +
      `2. 关注逾期超过30天的客户\n` +
      `3. 及时跟进回款情况\n` +
      `4. 对高风险客户暂停发货`;
  }

  // 客户相关
  if (msg.includes('客户') || msg.includes('crm')) {
    const customers = toContextArray(contextData.customers);
    if (msg.includes('新增') || msg.includes('添加')) {
      return '✅ 已为您打开客户创建表单。\n\n请填写：\n• 公司名称\n• 联系人信息\n• 营业执照\n• 信用额度';
    }
    return `👥 客户管理：\n• 总客户数: ${customers.length}\n\n在"客户管理"模块可查看和编辑客户信息。`;
  }

  // 发货物流
  if (msg.includes('发货') || msg.includes('物流') || msg.includes('出货')) {
    return `🚚 物流管理：\n\n` +
      `• 在"出货物流"模块安排发货\n` +
      `• 上传物流单据\n` +
      `• 跟踪运输状态`;
  }

  // 汇率换算
  if (msg.includes('汇率') || msg.includes('换算') || msg.includes('美元') || msg.includes('越南盾')) {
    return `💱 参考汇率（仅供参考）：\n\n` +
      `• 1 USD ≈ 7.2 CNY\n` +
      `• 1 CNY ≈ 3,500 VND\n` +
      `• 1 USD ≈ 25,200 VND\n\n` +
      `💡 系统支持自动换算，在订单中选择币种即可。`;
  }

  // 帮助信息
  if (msg.includes('帮助') || msg.includes('help') || msg.includes('功能')) {
    return `🤖 我可以帮您：\n\n` +
      `📊 表格智能识别：\n` +
      `• "上传表格" - 批量导入数据\n` +
      `• 自动识别客户、订单、样品等\n\n` +
      `📝 业务操作：\n` +
      `• "创建订单" - 录入新销售单\n` +
      `• "申请样品" - 寄送样品\n` +
      `• "添加客户" - 新增客户资料\n\n` +
      `📈 数据分析：\n` +
      `• "分析销售" - 查看业绩统计\n` +
      `• "风险检查" - 逾期预警\n` +
      `• "汇率换算" - 货币转换\n\n` +
      `💡 直接输入您的需求，我会智能识别！`;
  }

  // 默认回复
  return `🤖 收到您的消息："${message}"\n\n` +
    `我可以帮您：\n` +
    `• 📊 上传表格批量导入数据\n` +
    `• 📝 创建订单和样品申请\n` +
    `• 📈 分析销售数据\n` +
    `• 🔍 查看风险预警\n` +
    `• 👥 管理客户信息\n\n` +
    `💡 试试说："帮我上传客户表格"`;
};

/**
 * 风险洞察分析
 */
export const getRiskInsight = async (customerData: unknown): Promise<string> => {
  const customer = toRecord(customerData);
  const name = String(customer.name || '该客户');
  const creditLimit = getNumericField(customer, 'creditLimit');
  const overdueAmount = getNumericField(customer, 'overdueAmount');
  const overdueDays = getNumericField(customer, 'overdueDays');
  const totalOrders = getNumericField(customer, 'totalOrders');
  const totalAmount = getNumericField(customer, 'totalAmount');

  // 严重逾期
  if (overdueDays > 60 || overdueAmount > creditLimit) {
    return `🔴 高风险警告：\n\n` +
      `${name}存在严重信用问题：\n` +
      `• 逾期天数: ${overdueDays} 天\n` +
      `• 逾期金额: ¥${overdueAmount.toLocaleString()}\n` +
      `• 信用额度: ¥${creditLimit.toLocaleString()}\n\n` +
      `⚠️ 建议措施：\n` +
      `1. 立即暂停所有发货\n` +
      `2. 启动法务催收程序\n` +
      `3. 考虑计提坏账准备\n` +
      `4. 列入黑名单观察`;
  }

  // 中度风险
  if (overdueDays > 30 || overdueAmount > creditLimit * 0.5) {
    return `🟡 中度风险提示：\n\n` +
      `${name}需要重点关注：\n` +
      `• 逾期天数: ${overdueDays} 天\n` +
      `• 逾期金额: ¥${overdueAmount.toLocaleString()}\n` +
      `• 已用额度: ${((overdueAmount / creditLimit) * 100).toFixed(1)}%\n\n` +
      `💡 建议措施：\n` +
      `1. 加强催收力度\n` +
      `2. 新订单要求预付款\n` +
      `3. 每周跟进回款进度\n` +
      `4. 评估是否降低信用额度`;
  }

  // 轻微逾期
  if (overdueDays > 0 || overdueAmount > 0) {
    return `🟢 低风险提醒：\n\n` +
      `${name}有轻微逾期：\n` +
      `• 逾期天数: ${overdueDays} 天\n` +
      `• 逾期金额: ¥${overdueAmount.toLocaleString()}\n\n` +
      `💡 建议措施：\n` +
      `1. 友好提醒付款\n` +
      `2. 了解延迟原因\n` +
      `3. 保持正常合作关系`;
  }

  // 优质客户
  if (totalOrders > 10 && overdueAmount === 0) {
    return `✅ 优质客户：\n\n` +
      `${name}信用记录优秀：\n` +
      `• 累计订单: ${totalOrders} 笔\n` +
      `• 累计金额: ¥${totalAmount.toLocaleString()}\n` +
      `• 付款记录: 无逾期\n\n` +
      `💡 建议措施：\n` +
      `1. 可考虑提高信用额度\n` +
      `2. 提供更优惠的账期\n` +
      `3. 加强客户关系维护\n` +
      `4. 争取更多订单`;
  }

  // 正常客户
  return `✅ 信用良好：\n\n` +
    `${name}当前状态正常：\n` +
    `• 无逾期记录\n` +
    `• 付款及时\n` +
    `• 可正常合作\n\n` +
    `💡 继续保持良好的合作关系`;
};

export default {
  parseTableFile,
  recognizeAndParseTable,
  processAICmd,
  getRiskInsight,
  analyzeContractFile: async (file: File): Promise<AnalyzedContractFile> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const fileName = file.name.toLowerCase();
        let type: 'sales' | 'purchase' = 'sales';
        if (fileName.includes('采购') || fileName.includes('purchase')) type = 'purchase';
        resolve({
          title: file.name.replace(/\.[^/.]+$/, ""),
          type,
          totalAmount: null,
          currency: null,
          signedAt: null,
          confidence: 0,
          metadata: {
            ocr_engine: 'Rules-V5-Vision',
            notice: '需人工补充金额、币种、签署日期等信息',
          },
        });
      }, 800);
    });
  },
  analyzeProductLabel: async (_file: File): Promise<AnalyzedProductLabel> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          name: null,
          cas: null,
          grade: null,
          batchNo: null,
          confidence: 0,
          scannedAt: new Date().toISOString(),
          notice: '需人工识别产品标签内容',
        });
      }, 600);
    });
  }
};
