import type { CurrentUser } from '../types';

export type AIModelPrivacyMode = 'local-only' | 'external-allowed';

export interface SafeAIContext {
  currency?: string;
  language?: string;
  currentPage?: string;
  currentUser?: Pick<CurrentUser, 'id' | 'name' | 'role' | 'segment'>;
  visibleCounts?: Record<string, number>;
  t?: Record<string, string>;
}

export interface AISafetyDecision {
  allowed: boolean;
  reason?: string;
  sensitive: boolean;
}

export const AI_EXTERNAL_ENABLED_KEY = 'ailao.ai.externalEnabled';

const normalizeForSafety = (value: string): string => {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@._%+\-\u4e00-\u9fff]/gu, '');
};

const SENSITIVE_TERMS = [
  '客户',
  '客户名称',
  '联系人',
  '联系电话',
  '手机号',
  '手机',
  '电话',
  '邮箱',
  '地址',
  '营业执照',
  '税号',
  '统一社会信用代码',
  '订单',
  '合同',
  '发票',
  '回款',
  '付款',
  '欠款',
  '逾期',
  '授信',
  '信用额度',
  '金额',
  '价格',
  '单价',
  '银行',
  '账户',
  '账号',
  '供应商',
  '采购',
  '发货',
  '物流',
  '运单',
  '追踪',
  '批次',
  '配方',
  '原料',
  'bom',
  '成本',
  '利润',
  '财务',
  '应收',
  '应付',
  '收款',
  'customer',
  'client',
  'contact',
  'phone',
  'email',
  'address',
  'license',
  'tax',
  'invoice',
  'order',
  'contract',
  'payment',
  'amount',
  'bank',
  'supplier',
  'vendor',
  'shipment',
  'tracking',
  'formula',
  'cost',
  'margin',
  'finance',
  'receivable',
  'payable',
];

const HIDDEN_DATA_REQUEST_TERMS = [
  '全部',
  '所有',
  '完整',
  '导出',
  '列出',
  '明细',
  '手机号',
  '电话',
  '地址',
  '营业执照',
  '税号',
  '客户名单',
  '客户有哪些',
  '客户名称',
  '客户姓名',
  '客户详情',
  '客户资料',
  '联系人是谁',
  '联系方式',
  '公海',
  '私海',
  '内部池',
  '客户池',
  '供应商有哪些',
  '供应商名称',
  '供应商联系人',
  '供应商详情',
  '供应商资料',
  '采购联系人',
  '付款账号',
  '银行账号',
  '订单明细',
  '回款明细',
  '供应商明细',
  '财务明细',
  'all',
  'export',
  'dump',
  'list',
  'full',
  'complete',
  'customerlist',
  'customernames',
  'clientnames',
  'customerdetails',
  'customerrecords',
  'suppliernames',
  'vendornames',
  'suppliercontacts',
  'vendorcontacts',
  'supplierdetails',
  'vendordetails',
  'bankaccount',
  'paymentaccount',
  'contactlist',
  'publicpool',
  'privatepool',
  'internalpool',
  'orderdetail',
  'paymentdetail',
  'financedetail',
];

const SENSITIVE_PATTERNS = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /(?:\+?\d[\d\s-]{7,}\d)/,
  /\b[A-Z]{2,}-?\d{4,}\b/i,
];

const DANGEROUS_CONTEXT_KEYS = new Set([
  'customers',
  'orders',
  'samples',
  'shipments',
  'payments',
  'finance',
  'contracts',
  'suppliers',
  'users',
  'team',
  'auditLogs',
  'rawData',
]);

export const isExternalAIEnabled = (): boolean => {
  try {
    return window.localStorage.getItem(AI_EXTERNAL_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
};

export const setExternalAIEnabled = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(AI_EXTERNAL_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    // Keep local-only mode if storage is unavailable.
  }
};

const includesAnyTerm = (value: string, terms: string[]): boolean => {
  const normalized = normalizeForSafety(value);
  return terms.some(term => normalized.includes(normalizeForSafety(term)));
};

export const containsSensitiveBusinessData = (value: string): boolean => {
  if (!value) return false;
  return includesAnyTerm(value, SENSITIVE_TERMS)
    || SENSITIVE_PATTERNS.some(pattern => pattern.test(value));
};

export const isHiddenDataRequest = (value: string): boolean => {
  if (!value) return false;
  return includesAnyTerm(value, HIDDEN_DATA_REQUEST_TERMS);
};

export const canSendToExternalAI = (prompt: string, systemPrompt?: string): AISafetyDecision => {
  const combined = `${systemPrompt || ''}\n${prompt || ''}`;
  const sensitive = containsSensitiveBusinessData(combined);

  if (!isExternalAIEnabled()) {
    return {
      allowed: false,
      sensitive,
      reason: '外部 AI 当前处于关闭状态。为了避免客户、订单、金额、地址、联系人、配方、成本等业务数据外发，请继续使用本地规则引擎。',
    };
  }

  if (sensitive) {
    return {
      allowed: false,
      sensitive,
      reason: '已检测到客户、订单、金额、地址、联系人、供应商、配方、成本或财务等敏感业务信息，已阻止发送到外部 AI。',
    };
  }

  return { allowed: true, sensitive };
};

const countIfArray = (value: unknown): number | undefined => Array.isArray(value) ? value.length : undefined;

export const buildSafeAIContext = (contextData: Record<string, unknown> = {}): SafeAIContext => {
  const visibleCounts: Record<string, number> = {};

  for (const [key, value] of Object.entries(contextData)) {
    if (DANGEROUS_CONTEXT_KEYS.has(key)) {
      const count = countIfArray(value);
      if (count !== undefined) visibleCounts[key] = count;
    }
  }

  const currentUser = contextData.currentUser as CurrentUser | undefined;

  return {
    currency: typeof contextData.currency === 'string' ? contextData.currency : undefined,
    language: typeof contextData.language === 'string' ? contextData.language : undefined,
    currentPage: typeof contextData.currentPage === 'string' ? contextData.currentPage : undefined,
    currentUser: currentUser
      ? {
          id: currentUser.id,
          name: currentUser.name,
          role: currentUser.role,
          segment: currentUser.segment,
        }
      : undefined,
    visibleCounts,
    t: contextData.t && typeof contextData.t === 'object'
      ? contextData.t as Record<string, string>
      : undefined,
  };
};

export const unauthorizedDataRefusal = '我不能展示或推断当前角色无权查看的客户、订单、联系人、地址、金额、供应商或财务明细。请切换到有权限的角色，或在对应业务页面按权限查看。';
