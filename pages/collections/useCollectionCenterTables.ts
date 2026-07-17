import { useMemo } from 'react';
import type { Column } from '../../components/DataTable';
import {
  CollectionDisputeRecord,
  CollectionHoldRecord,
  CollectionLedgerRecord,
  CollectionMilestoneRecord,
  CollectionOverdueRecord,
  CollectionPromiseRecord,
} from '../../src/services/collections.service';
import {
  exportRows,
  formatDateTime,
  getCollectionCustomerLabel,
  getPromiseTiming,
} from './collectionCenter.helpers';
import type { CollectionCenterState } from './useCollectionCenter';

const holdScopeLabelMap: Record<string, string> = {
  'customer-credit': '客户授信',
  'customer-shipment': '客户发货',
  'order-shipment': '订单发货',
};

const holdSourceLabelMap: Record<string, string> = {
  manual: '人工设置',
  system: '系统生成',
  dispute: '争议联动',
};

const ledgerStatusLabelMap: Record<string, string> = {
  verified: '已核销',
  pending: '待核销',
};

const promiseStatusLabelMap: Record<string, string> = {
  open: '待兑现',
  kept: '已兑现',
  missed: '已失约',
  cancelled: '已取消',
};

const disputeStatusLabelMap: Record<string, string> = {
  open: '待处理',
  reviewing: '处理中',
  resolved: '已解决',
  rejected: '已驳回',
  withdrawn: '已撤回',
};

const riskLevelLabelMap: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '关键风险',
};

export const holdStatusLabel = (active: boolean) => (active ? '生效中' : '已释放');

export const useCollectionCenterTables = (state: CollectionCenterState) => {
  const { formatPrice } = state;

  const ledgerColumns = useMemo<Column<CollectionLedgerRecord>[]>(() => [
    { header: '收款单', key: 'id', accessor: (row) => `#${row.id}` },
    { header: '订单号', key: 'orderNo', accessor: 'orderNo' },
    { header: '客户', key: 'customer', accessor: (row) => getCollectionCustomerLabel(row) },
    { header: '金额', key: 'amount', accessor: (row) => formatPrice(row.amount) },
    { header: '方式', key: 'method', accessor: 'method' },
    { header: '状态', key: 'status', accessor: (row) => ledgerStatusLabelMap[row.status] || row.status },
    { header: '录入时间', key: 'createdAt', accessor: (row) => formatDateTime(row.createdAt) },
  ], [formatPrice]);

  const overdueColumns = useMemo<Column<CollectionOverdueRecord>[]>(() => [
    { header: '订单号', key: 'orderNo', accessor: 'orderNo' },
    { header: '客户', key: 'customer', accessor: (row) => getCollectionCustomerLabel(row) },
    { header: '逾期天数', key: 'daysOverdue', accessor: (row) => `${row.daysOverdue} 天` },
    { header: '未收金额', key: 'outstanding', accessor: (row) => formatPrice(row.outstanding) },
    { header: '风险', key: 'riskLevel', accessor: (row) => riskLevelLabelMap[row.riskLevel] || row.riskLevel },
    { header: '下一动作', key: 'nextAction', accessor: 'nextAction' },
  ], [formatPrice]);

  const milestoneColumns = useMemo<Column<CollectionMilestoneRecord>[]>(() => [
    { header: '里程碑', key: 'title', accessor: 'title' },
    { header: '合同号', key: 'contractNo', accessor: 'contractNo' },
    { header: '客户', key: 'customer', accessor: (row) => getCollectionCustomerLabel(row) },
    { header: '目标金额', key: 'targetAmount', accessor: (row) => formatPrice(row.targetAmount) },
    { header: '已收金额', key: 'paidAmount', accessor: (row) => formatPrice(row.paidAmount) },
    { header: '剩余金额', key: 'remainingAmount', accessor: (row) => formatPrice(row.remainingAmount) },
  ], [formatPrice]);

  const promiseColumns = useMemo<Column<CollectionPromiseRecord>[]>(() => [
    { header: '承诺单', key: 'promiseNo', accessor: 'promiseNo' },
    { header: '客户', key: 'customer', accessor: (row) => getCollectionCustomerLabel(row) },
    { header: '订单号', key: 'orderNo', accessor: 'orderNo' },
    { header: '承诺金额', key: 'promisedAmount', accessor: (row) => formatPrice(row.promisedAmount) },
    { header: '承诺时间', key: 'promisedAt', accessor: (row) => formatDateTime(row.promisedAt) },
    { header: '时效', key: 'timing', accessor: (row) => getPromiseTiming(row.promisedAt) },
    { header: '状态', key: 'status', accessor: (row) => promiseStatusLabelMap[row.status] || row.status },
  ], [formatPrice]);

  const disputeColumns = useMemo<Column<CollectionDisputeRecord>[]>(() => [
    { header: '争议单', key: 'disputeNo', accessor: 'disputeNo' },
    { header: '客户', key: 'customer', accessor: (row) => getCollectionCustomerLabel(row) },
    { header: '订单号', key: 'orderNo', accessor: 'orderNo' },
    { header: '争议金额', key: 'disputedAmount', accessor: (row) => row.disputedAmount === null ? '-' : formatPrice(row.disputedAmount) },
    { header: '原因', key: 'reason', accessor: 'reason' },
    { header: '状态', key: 'status', accessor: (row) => disputeStatusLabelMap[row.status] || row.status },
  ], [formatPrice]);

  const holdColumns = useMemo<Column<CollectionHoldRecord>[]>(() => [
    { header: '范围', key: 'scope', accessor: (row) => holdScopeLabelMap[row.scope] || row.scope },
    { header: '客户', key: 'customer', accessor: (row) => getCollectionCustomerLabel(row) },
    { header: '订单号', key: 'orderNo', accessor: (row) => row.orderNo || '-' },
    { header: '原因', key: 'reason', accessor: (row) => row.reason || '-' },
    { header: '来源', key: 'source', accessor: (row) => row.source ? (holdSourceLabelMap[row.source] || row.source) : '-' },
    { header: '状态', key: 'status', accessor: (row) => holdStatusLabel(row.status) },
  ], []);

  const exportPromises = () => exportRows('回款中心_承诺付款执行表.xlsx', state.sortedPromises.map((row) => ({
    承诺单: row.promiseNo,
    客户: getCollectionCustomerLabel(row),
    订单号: row.orderNo,
    承诺金额: row.promisedAmount,
    承诺时间: formatDateTime(row.promisedAt),
    状态: promiseStatusLabelMap[row.status] || row.status,
  })));

  const exportDisputes = () => exportRows('回款中心_争议处理表.xlsx', state.sortedDisputes.map((row) => ({
    争议单: row.disputeNo,
    客户: getCollectionCustomerLabel(row),
    订单号: row.orderNo,
    争议金额: row.disputedAmount ?? '',
    原因: row.reason,
    状态: disputeStatusLabelMap[row.status] || row.status,
  })));

  const exportHolds = () => exportRows('回款中心_追款拦截表.xlsx', state.sortedHolds.map((row) => ({
    范围: holdScopeLabelMap[row.scope] || row.scope,
    客户: getCollectionCustomerLabel(row),
    订单号: row.orderNo || '',
    原因: row.reason || '',
    来源: row.source ? (holdSourceLabelMap[row.source] || row.source) : '',
    状态: holdStatusLabel(row.status),
  })));

  return {
    ledgerColumns,
    overdueColumns,
    milestoneColumns,
    promiseColumns,
    disputeColumns,
    holdColumns,
    exportPromises,
    exportDisputes,
    exportHolds,
  };
};
