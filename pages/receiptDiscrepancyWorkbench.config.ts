import type {
  ReceiptDiscrepancyCase,
  ReceiptToleranceAction,
  ReceiptToleranceCounterpartyType,
  ReceiptToleranceDiscrepancyType,
  ReceiptToleranceRule,
  ReceiptToleranceSourceType,
} from '../services/receiptDiscrepancy.service';

export type ActiveTab = 'cases' | 'rules';

export type RuleDraft = {
  name: string;
  sourceType: ReceiptToleranceSourceType;
  discrepancyType: ReceiptToleranceDiscrepancyType;
  counterpartyType: ReceiptToleranceCounterpartyType;
  productName: string;
  quantityTolerancePercent: number;
  quantityToleranceAbs: number;
  actionWithinTolerance: ReceiptToleranceAction;
  actionOutsideTolerance: ReceiptToleranceAction;
  priority: number;
  requiresQualityCheck: boolean;
  note: string;
};

export const initialRuleDraft: RuleDraft = {
  name: '',
  sourceType: 'all',
  discrepancyType: 'all',
  counterpartyType: 'all',
  productName: '',
  quantityTolerancePercent: 0,
  quantityToleranceAbs: 0,
  actionWithinTolerance: 'warn',
  actionOutsideTolerance: 'manual_review',
  priority: 100,
  requiresQualityCheck: false,
  note: '',
};

export const sourceTypeLabels: Record<string, string> = {
  all: '全部来源',
  purchase_receipt: '采购收货',
  shipment_receipt: '客户签收',
};

export const discrepancyTypeLabels: Record<string, string> = {
  all: '全部差异',
  short_shipped: '到货短少',
  quality_rejected: '质量拒收',
  damaged: '破损',
  wrong_item: '错货',
  over_received: '超收',
  late_delivery: '迟交',
  document_mismatch: '单据不符',
  customer_short_signed: '客户短签',
  customer_damaged: '客户签收破损',
  other: '其他',
};

export const actionLabels: Record<string, string> = {
  allow: '自动放行',
  warn: '预警保留',
  block: '阻止处理',
  manual_review: '人工评审',
};

export const statusLabels: Record<string, string> = {
  pending: '待处理',
  in_review: '评审中',
  resolved: '已关闭',
  cancelled: '已取消',
  active: '启用',
  inactive: '停用',
};

export const counterpartyLabels: Record<string, string> = {
  all: '全部对象',
  supplier: '供应商',
  customer: '客户',
};

export const discrepancyTypeOptions: ReceiptToleranceDiscrepancyType[] = [
  'all',
  'short_shipped',
  'quality_rejected',
  'damaged',
  'wrong_item',
  'over_received',
  'late_delivery',
  'document_mismatch',
  'customer_short_signed',
  'customer_damaged',
  'other',
];

export const actionOptions: ReceiptToleranceAction[] = ['warn', 'manual_review', 'allow', 'block'];

export const formatNumber = (value: number | null | undefined, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
};

export const buildCaseSearchText = (row: ReceiptDiscrepancyCase) => [
  row.caseNo,
  row.businessRef,
  row.counterpartyName,
  row.productName,
  row.reason,
  discrepancyTypeLabels[row.discrepancyType],
  statusLabels[row.status],
  actionLabels[row.toleranceAction],
].filter(Boolean).join(' ');

export const buildRuleSearchText = (row: ReceiptToleranceRule) => [
  row.ruleNo,
  row.name,
  sourceTypeLabels[row.sourceType],
  discrepancyTypeLabels[row.discrepancyType],
  counterpartyLabels[row.counterpartyType],
  row.productName,
  actionLabels[row.actionWithinTolerance],
  actionLabels[row.actionOutsideTolerance],
].filter(Boolean).join(' ');
